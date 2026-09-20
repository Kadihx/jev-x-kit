/**
 * MODULE 4 — 360° Diagnostic Audit Engine.
 *
 * Walks the target project (node_modules/.git/dist excluded), runs lightweight
 * static checks in five dimensions (architecture, security, marketing, legal,
 * budget) and scores each dimension through the Jev loop. No external services,
 * no LLM required.
 */

import fs from "node:fs";
import path from "node:path";
import { fanOut } from "../core/fanout.js";
import { loadPreset, presetStateLines } from "../core/presets.js";
import { round } from "../core/text.js";
import type { JevBackend, ScoreResult } from "../core/types.js";
import type { AuditDimension, AuditDimensionId, AuditFinding, AuditReport } from "../core/module-types.js";

export interface AuditDeps {
  backend: JevBackend;
  concurrency?: number;
  /** Max files scanned (safety valve). */
  maxFiles?: number;
  maxFileBytes?: number;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next", "artifacts"]);
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".yml", ".yaml",
  ".toml", ".sql", ".env", ".example", ".html", ".css", ".prisma", ".sh", ".ps1", ".py",
]);

interface ScanFile {
  file: string;
  rel: string;
  ext: string;
}

interface ScanResult {
  files: ScanFile[];
  scannedFiles: number;
  readme: boolean;
  license: string | null;
  envExample: boolean;
  ci: boolean;
  testsCount: number;
  todos: number;
  secrets: Array<{ file: string; kind: string; sample: string }>;
  supabase: boolean;
  rlsMentions: number;
  indexHtml: string | null;
  packageJson: {
    name?: string;
    description?: string;
    license?: string;
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  } | null;
  cacheHits: number;
  privacyMentions: number;
}

export function scanProject(root: string, opts: { maxFiles?: number; maxFileBytes?: number } = {}): ScanResult {
  const maxFiles = opts.maxFiles ?? 600;
  const maxFileBytes = opts.maxFileBytes ?? 256 * 1024;
  const files: ScanFile[] = [];

  const walk = (dir: string): void => {
    if (files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (TEXT_EXT.has(ext) || entry.name === "LICENSE" || entry.name === ".env.example") {
          files.push({ file: path.join(dir, entry.name), rel: path.relative(root, path.join(dir, entry.name)), ext });
        }
      }
    }
  };
  walk(root);

  const result: ScanResult = {
    files,
    scannedFiles: 0,
    readme: false,
    license: null,
    envExample: false,
    ci: false,
    testsCount: 0,
    todos: 0,
    secrets: [],
    supabase: false,
    rlsMentions: 0,
    indexHtml: null,
    packageJson: null,
    cacheHits: 0,
    privacyMentions: 0,
  };

  const SECRET_PATTERNS: Array<{ kind: string; re: RegExp }> = [
    { kind: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
    { kind: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { kind: "generic-secret", re: /(?:api[_-]?key|secret|passw(?:or)?d|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i },
    { kind: "bearer-token", re: /Bearer\s+eyJ[A-Za-z0-9_-]{20,}/ },
  ];

  for (const scanFile of files) {
    result.scannedFiles++;
    const lower = scanFile.rel.toLowerCase();
    if (/(^|\/)readme\.md$/i.test(scanFile.rel)) result.readme = true;
    if (/(^|\/)license/i.test(lower) || /(^|\/)licence/i.test(lower)) result.license = scanFile.rel;
    if (lower.endsWith(".env.example") || lower.includes("env.example")) result.envExample = true;
    if (lower.includes(".github/workflows/") || lower.includes(".gitlab-ci") || lower.includes("azure-pipelines")) result.ci = true;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(lower) || lower.includes("__tests__/") || lower.startsWith("tests/")) result.testsCount++;
    if (lower.endsWith("index.html") && !result.indexHtml) result.indexHtml = scanFile.file;

    let content: string;
    try {
      const stats = fs.statSync(scanFile.file);
      if (stats.size > maxFileBytes) continue;
      content = fs.readFileSync(scanFile.file, "utf8");
    } catch {
      continue;
    }

    result.todos += (content.match(/\b(?:TODO|FIXME|HACK|XXX)\b/g) ?? []).length;
    if (/supabase/i.test(content)) result.supabase = true;
    if (/row level security|\brls\b/i.test(content)) result.rlsMentions++;
    result.cacheHits += (content.match(/\bcache\b/gi) ?? []).length;
    if (/privacy policy|kvkk|gdpr|kişisel veri/i.test(content)) result.privacyMentions++;

    if (lower.endsWith("package.json") && !result.packageJson) {
      try {
        result.packageJson = JSON.parse(content);
      } catch {
        /* ignore */
      }
    }

    for (const { kind, re } of SECRET_PATTERNS) {
      const match = content.match(re);
      if (match && result.secrets.length < 12) {
        result.secrets.push({
          file: scanFile.rel,
          kind,
          sample: match[0].slice(0, 40).replace(/["']/g, ""),
        });
      }
    }
  }

  return result;
}

const SEVERITY_RANK: Record<AuditFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function finding(
  dimension: AuditDimensionId,
  severity: AuditFinding["severity"],
  message: string,
  evidence: string,
  recommendation: string,
): AuditFinding {
  return { dimension, severity, message, evidence, recommendation };
}

export function buildFindings(scan: ScanResult): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const deps = Object.keys(scan.packageJson?.dependencies ?? {}).length;

  // Architecture
  if (scan.testsCount === 0) {
    findings.push(
      finding("architecture", "high", "No test files detected", "tests=0", "Add at least one happy-path and one failure-path test on the critical module."),
    );
  } else {
    findings.push(
      finding("architecture", "info", `${scan.testsCount} test files detected`, `tests=${scan.testsCount}`, "Keep tests aligned with critical paths, not coverage theatre."),
    );
  }
  if (!scan.ci) {
    findings.push(
      finding("architecture", "medium", "No CI workflow detected", "no workflows/CI file found", "Run typecheck + tests on every PR in CI."),
    );
  }
  if (scan.todos > 20) {
    findings.push(
      finding("architecture", "medium", `High TODO/FIXME density (${scan.todos})`, `todos=${scan.todos}`, "Triage stale TODOs into issues or delete them; debt markers rot fast."),
    );
  }
  if (deps > 60) {
    findings.push(
      finding("architecture", "low", `Large dependency surface (${deps} runtime deps)`, `dependencies=${deps}`, "Prune unused packages; every dependency is supply-chain risk."),
    );
  }

  // Security
  for (const secret of scan.secrets.slice(0, 5)) {
    findings.push(
      finding("security", "critical", `Possible hardcoded secret (${secret.kind})`, `${secret.file}: ${secret.sample}...`, "Move to environment/vault, rotate the value, purge from history."),
    );
  }
  if (scan.supabase && scan.rlsMentions === 0) {
    findings.push(
      finding("security", "critical", "Supabase in use but no RLS mention found", "supabase=true, rls-mentions=0", "Enable and test Row Level Security per table policy; verify with an anon-key request."),
    );
  }
  if (!scan.envExample) {
    findings.push(
      finding("security", "low", "No .env.example template found", "env.example missing", "Document required variables so new setups never guess secrets."),
    );
  }

  // Marketing
  if (!scan.readme) {
    findings.push(
      finding("marketing", "high", "No README found", "README missing", "Write a README with the one-line value proposition, quickstart and screenshots."),
    );
  }
  if (!scan.packageJson?.description) {
    findings.push(
      finding("marketing", "medium", "Project description missing", "package.json has no description", "State the pain and the promise in one sentence; reuse it everywhere."),
    );
  }

  // Legal
  if (!scan.license) {
    findings.push(
      finding("legal", "high", "No LICENSE file found", "license=null", "Add an explicit license; unknown licensing blocks downstream use."),
    );
  }
  if (!scan.packageJson?.license) {
    findings.push(
      finding("legal", "medium", "package.json declares no license", "license field missing", "Set the SPDX id in package.json so scanners can classify the project."),
    );
  }
  if (scan.privacyMentions === 0) {
    findings.push(
      finding("legal", "low", "No privacy/KVKK/GDPR language found", "privacy-mentions=0", "Add a data map and a retention statement before shipping user data features."),
    );
  }

  // Budget & router
  if (scan.cacheHits === 0) {
    findings.push(
      finding("budget", "medium", "No caching signals found", "cache-mentions=0", "Cache deterministic decisions so identical questions are never re-billed."),
    );
  }
  findings.push(
    finding("budget", "info", "Route micro-decisions to the Jev/system-1 layer", "preset: cost-model-router", "Keep frontier LLM calls for synthesis only; escalate on low confidence."),
  );

  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export class JevAudit {
  constructor(private readonly deps: AuditDeps) {}

  async run(root: string, opts: { preset?: string } = {}): Promise<AuditReport> {
    const started = Date.now();
    const scan = scanProject(root, {
      maxFiles: this.deps.maxFiles,
      maxFileBytes: this.deps.maxFileBytes,
    });
    const findings = buildFindings(scan);
    const presetId = opts.preset ?? "software-architecture";
    const preset = loadPreset(presetId);
    const presetLines = presetStateLines(presetId, 10);

    const dimensionIds: AuditDimensionId[] = ["architecture", "security", "marketing", "legal", "budget"];
    const evidenceFor = (id: AuditDimensionId): string =>
      [
        `preset: ${preset?.title ?? presetId}`,
        ...presetLines,
        `files-scanned: ${scan.scannedFiles}`,
        ...findings.filter((f) => f.dimension === id).map((f) => `[${f.severity}] ${f.message} (${f.evidence})`),
      ].join("\n");

    const { results } = await fanOut(
      dimensionIds.map((id) => () =>
        this.deps.backend.score({
          kind: "score" as const,
          question: `Readiness score for the ${id} dimension of this project (1 worst, 10 best)`,
          min: 1,
          max: 10,
          state: evidenceFor(id),
        }),
      ),
      this.deps.concurrency ?? 8,
    );

    const dimensions: AuditDimension[] = dimensionIds.map((id, i) => ({
      id,
      score: results[i] as ScoreResult,
      findings: findings.filter((f) => f.dimension === id),
    }));

    // Top actions: impact of fixing the highest-severity findings (fan-out, cap 4).
    const actionable = findings.filter((f) => f.severity !== "info").slice(0, 4);
    const impacts = (await this.deps.backend.batch(
      actionable.map((f) => ({
        kind: "score" as const,
        question: `How much does fixing this improve the project: ${f.message}`,
        min: 1,
        max: 10,
        state: `severity: ${f.severity}\nrecommendation: ${f.recommendation}\nfiles-scanned: ${scan.scannedFiles}`,
      })),
    )) as ScoreResult[];

    return {
      root,
      presetNotes: presetLines,
      dimensions,
      topActions: actionable.map((f, i) => ({
        action: `${f.severity.toUpperCase()}: ${f.message}`,
        impact: impacts[i] as ScoreResult,
      })),
      scannedFiles: scan.scannedFiles,
      latencyMs: round(Date.now() - started, 3),
    };
  }
}
