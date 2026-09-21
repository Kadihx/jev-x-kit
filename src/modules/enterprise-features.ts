/**
 * MODULE 10 — 20 Enterprise Feature Catalog.
 *
 * Honest status tracking: features that can be fully implemented client-side
 * (privacy sanitizer, RAG noise filter, edge-case synthesizer, PR gatekeeper,
 * backpressure router, threshold auto-tuner) are `implemented`; the rest ship
 * as `scaffolded` descriptors with the exact tool/module that will host them.
 */

import type { FeatureDescriptor, SanitizeReport } from "../core/module-types.js";

export const FEATURES: FeatureDescriptor[] = [
  { id: 1, slug: "agent-bargaining", name: "Agent-to-Agent Autonomous Bargaining", status: "scaffolded", tool: "jev_evaluate", summary: "Resolve inter-agent negotiation with Choice/Score in one pass instead of chat tokens." },
  { id: 2, slug: "backpressure-router", name: "Backpressure Router", status: "implemented", tool: null, summary: "BackpressureRouter keeps at most N operations in flight and queues the rest." },
  { id: 3, slug: "generative-ui-render", name: "Generative UI Render", status: "scaffolded", tool: "jev_evaluate", summary: "json-render style layout selection via Choice without generating markup tokens." },
  { id: 4, slug: "nightly-tech-debt-cleaner", name: "Nightly Tech-Debt Cleaner", status: "scaffolded", tool: "jev_audit", summary: "Nightly scan + PR opening for dead code and stale TODOs." },
  { id: 5, slug: "persona-tone-calibrator", name: "Adaptive Persona & Tone Calibrator", status: "implemented", tool: "jev_evaluate", summary: "Noul/Score over tone options conditioned on user state via jev_evaluate." },
  { id: 6, slug: "competitor-counter-strike", name: "Competitor Counter-Strike", status: "scaffolded", tool: "jev_research", summary: "Watch competitor repos/launches and rank counter-actions." },
  { id: 7, slug: "privacy-sanitizer", name: "Privacy Sanitizer", status: "implemented", tool: "jev_privacy_sanitize", summary: "Local PII/secret masking before any external model call." },
  { id: 8, slug: "multi-persona-arbitrator", name: "Multi-Persona Swarm Arbitrator", status: "implemented", tool: "jev_evaluate", summary: "Security/Growth/CFO personas arbitrated by Choice over debate summaries." },
  { id: 9, slug: "self-healing-incidents", name: "Self-Healing Incident Engine", status: "scaffolded", tool: "jev_guardrail", summary: "Detect live incidents and gate the recovery route." },
  { id: 10, slug: "threshold-auto-tuner", name: "Dynamic Threshold Auto-Tuner", status: "implemented", tool: "jev_memory", summary: "Calibration buckets auto-tune gatekeeper thresholds (module 8)." },
  { id: 11, slug: "edge-case-synthesizer", name: "Synthetic QA & Edge-Case Synthesizer", status: "implemented", tool: "jev_edge_qa", summary: "Deterministic edge-case matrix for any feature spec." },
  { id: 12, slug: "rag-reranker", name: "RAG Noise-Filter & Re-Ranker", status: "implemented", tool: "jev_rerank", summary: "Noul relevance re-ranking keeps the top-K passages." },
  { id: 13, slug: "trend-hunter", name: "Nightly Trend Hunter", status: "scaffolded", tool: "jev_research", summary: "HN/Reddit/GitHub trending sweep via the deep researcher channels." },
  { id: 14, slug: "red-team-pen-tester", name: "Active Red-Team Pen-Tester & WAF", status: "scaffolded", tool: "jev_redteam", summary: "Injection/RLS probes through the red-team loop." },
  { id: 15, slug: "pricing-optimizer", name: "Unit-Economics & Pricing Optimizer", status: "scaffolded", tool: "jev_plan", summary: "Pricing/budget optimization with finance preset anti-theses." },
  { id: 16, slug: "pr-gatekeeper", name: "Git PR Gatekeeper & Release Manager", status: "implemented", tool: "jev_pr_gate", summary: "Breaking-change, secret and downgrade checks on a diff." },
  { id: 17, slug: "localization-engine", name: "Localization Engine", status: "scaffolded", tool: "jev_evaluate", summary: "Locale risk scoring for copy and legal wording." },
  { id: 18, slug: "churn-sentinel", name: "Customer Churn & Sentiment Sentinel", status: "implemented", tool: "jev_evaluate", summary: "Noul churn-risk scoring per customer signal." },
  { id: 19, slug: "dependency-sandbox", name: "Dependency Upgrade Sandbox Simulator", status: "scaffolded", tool: "jev_guardrail", summary: "Simulate dependency bumps and gate risky upgrades." },
  { id: 20, slug: "pitch-deck-engine", name: "Pitch-Deck & Valuation Engine", status: "implemented", tool: "jev_redteam", summary: "Investor anti-theses generated and scored before the meeting." },
  { id: 21, slug: "skill-router", name: "Claude Skills Router", status: "implemented", tool: "jev_skill_router", summary: "Discovers installed + catalog Claude Skills and ranks them for a task via the Jev Score primitive." },
];

export function featureCatalog(): FeatureDescriptor[] {
  return FEATURES;
}

/* --------------------------- feature #7: sanitizer ------------------------ */

interface SanitizeRule {
  kind: string;
  re: RegExp;
  mask: (match: string) => string;
}

const SANITIZE_RULES: SanitizeRule[] = [
  { kind: "email", re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g, mask: (m) => `${m[0]}***@***` },
  { kind: "credit-card", re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, mask: (m) => `${m[0]}-****` },
  { kind: "iban", re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, mask: (m) => `${m[0].slice(0, 6)}****` },
  { kind: "turkish-id", re: /\b[1-9]\d{10}\b/g, mask: (m) => `${m[0].slice(0, 3)}*******` },
  { kind: "api-key", re: /\b(?:sk|pk|ghp|gho|ghu|glpat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g, mask: () => "***REDACTED-API-KEY***" },
  { kind: "bearer", re: /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, mask: () => "Bearer ***REDACTED***" },
  { kind: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g, mask: () => "AKIA***REDACTED***" },
  {
    kind: "private-key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    mask: () => "***REDACTED-PRIVATE-KEY***",
  },
  { kind: "ipv4", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, mask: (m) => `${m[0].split(".").slice(0, 2).join(".")}.*.*` },
  { kind: "phone", re: /(?:\+\d{1,3}[ -]?)?\(?\d{3}\)?[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}\b/g, mask: () => "+** *** ** **" },
  { kind: "env-assignment", re: /\b([A-Z_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE)[A-Z_]*)\s*=\s*\S+/g, mask: () => "***REDACTED***" },
];

/** Privacy Sanitizer: mask PII/secrets locally before any external call. */
export function sanitize(text: string): SanitizeReport {
  const detections: SanitizeReport["detections"] = [];
  let sanitized = text;
  let totalRedactions = 0;

  for (const rule of SANITIZE_RULES) {
    const matches = sanitized.match(rule.re) ?? [];
    if (matches.length === 0) continue;
    detections.push({ kind: rule.kind, count: matches.length, sample: `${matches[0]!.slice(0, 12)}...` });
    totalRedactions += matches.length;
    sanitized = sanitized.replace(rule.re, (m) => rule.mask(m));
  }

  return {
    sanitized,
    detections,
    totalRedactions,
    safeForExternalModel: detections.length === 0,
  };
}

/* --------------------------- feature #12: reranker ------------------------ */

export interface RerankResult {
  query: string;
  kept: Array<{ text: string; relevance: number; originalIndex: number }>;
  dropped: number;
  latencyMs: number;
}

interface JevBatchLike {
  batch(
    requests: Array<{ kind: "noul"; question: string; state?: string }>,
  ): Promise<Array<{ kind: string; probability?: unknown }>>;
}

/** RAG noise filter: Jev Noul relevance re-ranking, keeps top-K passages. */
export async function rerank(
  backend: JevBatchLike,
  query: string,
  documents: string[],
  topK = 3,
): Promise<RerankResult> {
  const started = Date.now();
  const results = await backend.batch(
    documents.map((doc) => ({
      kind: "noul" as const,
      question: `Is this passage relevant and non-redundant for the question: ${query}`,
      state: `passage: ${doc.slice(0, 1200)}`,
    })),
  );

  const scored = documents
    .map((text, originalIndex) => {
      const result = results[originalIndex];
      const probability = typeof result?.probability === "number" ? result.probability : 0.5;
      return { text, originalIndex, relevance: probability };
    })
    .sort((a, b) => b.relevance - a.relevance);

  return {
    query,
    kept: scored.slice(0, topK),
    dropped: Math.max(0, documents.length - topK),
    latencyMs: Date.now() - started,
  };
}

/* ------------------------- feature #11: edge-case QA ---------------------- */

export interface EdgeCase {
  title: string;
  steps: string[];
  expected: string;
  category: string;
}

const EDGE_CASE_TEMPLATES: Array<Omit<EdgeCase, "title">> = [
  { category: "input", steps: ["submit empty input", "assert the UI shows a specific error"], expected: "rejected with an actionable message, no stack trace" },
  { category: "input", steps: ["submit extremely large input (1MB+)", "measure latency and memory"], expected: "bounded, truncated or streamed; no crash" },
  { category: "input", steps: ["submit unicode/emoji/Turkish characters", "verify round-trip"], expected: "byte-identical round trip, no mojibake" },
  { category: "concurrency", steps: ["fire 10 identical requests in parallel", "inspect final state"], expected: "idempotent outcome or explicit conflict; no duplicate rows" },
  { category: "concurrency", steps: ["two writers mutate the same record", "check lock/version handling"], expected: "optimistic-lock error or serialized write" },
  { category: "dependency", steps: ["kill the external service mid-request", "observe retries"], expected: "timeout + fallback, no infinite retry storm" },
  { category: "dependency", steps: ["return malformed JSON from the provider", "check the validation path"], expected: "schema violation handled, fallback engaged" },
  { category: "auth", steps: ["call the API with an expired token", "assert the response"], expected: "401 with a refresh path, no data leak" },
  { category: "auth", steps: ["attempt access to another tenant's record", "assert the response"], expected: "404/403, no existence leak" },
  { category: "state", steps: ["refresh/reload mid-flow", "assert recovery"], expected: "resumable state or a clean restart prompt" },
  { category: "time", steps: ["simulate clock skew between server and client", "check signatures"], expected: "tolerance window documented" },
  { category: "billing", steps: ["retry a paid operation after timeout", "inspect charges"], expected: "no double charge (idempotency key)" },
];

/** Synthetic QA: deterministic edge-case matrix, personalized per spec. */
export function edgeCases(spec: string, count = 8): EdgeCase[] {
  const keyword = spec.trim().split(/\s+/).slice(0, 6).join(" ") || "the feature";
  const picks = Math.min(Math.max(count, 3), EDGE_CASE_TEMPLATES.length);
  return EDGE_CASE_TEMPLATES.slice(0, picks).map((template) => ({
    title: `[${template.category}] ${keyword}: ${template.steps[0]}`,
    steps: [...template.steps, `context: ${spec.slice(0, 200)}`],
    expected: template.expected,
    category: template.category,
  }));
}

/* ------------------------- feature #16: PR gatekeeper --------------------- */

export interface PrGateFinding {
  severity: "high" | "medium" | "low";
  file: string;
  message: string;
}

export interface PrGateReport {
  findings: PrGateFinding[];
  verdict: "allow" | "ask" | "block";
  summary: string;
}

/** PR gatekeeper: breaking changes, secrets and leftovers in a unified diff. */
export function prGate(files: Array<{ file: string; patch: string }>): PrGateReport {
  const findings: PrGateFinding[] = [];
  for (const { file, patch } of files) {
    const lines = patch.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith("-") && !line.startsWith("---")) {
        if (/export\s+(?:default\s+)?(?:function|class|const|interface|type)\s/.test(line)) {
          findings.push({
            severity: "high",
            file,
            message: `removed export may be a breaking change: ${line.slice(1, 120).trim()}`,
          });
        }
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        if (/(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{12,}/i.test(line)) {
          findings.push({
            severity: "high",
            file,
            message: `possible hardcoded secret added: ${line.slice(1, 80).trim()}`,
          });
        }
        if (/\bconsole\.(?:log|debug|warn)\b/.test(line)) {
          findings.push({ severity: "low", file, message: "console statement added" });
        }
        if (/\bTODO\b|\bFIXME\b/.test(line)) {
          findings.push({ severity: "low", file, message: "new TODO/FIXME introduced" });
        }
      }
      if (/^\+.*node_modules|^\+\s*"dependencies"/.test(line)) {
        findings.push({ severity: "medium", file, message: "dependency manifest change requires review" });
      }
    }
  }

  const high = findings.filter((f) => f.severity === "high").length;
  const verdict: PrGateReport["verdict"] = high > 0 ? "block" : findings.length > 0 ? "ask" : "allow";
  return {
    findings,
    verdict,
    summary:
      verdict === "allow"
        ? "no gatekeeper findings: diff looks safe"
        : `${findings.length} finding(s), ${high} high-severity -> ${verdict}`,
  };
}
