/**
 * MODULE 5B — Winnow lossless context compactor.
 *
 * The rule (blueprint §1.A.4): NEVER summarize. Irrelevant lines are deleted
 * with $0 cost; every surviving line is byte-identical to the input. Lines
 * that carry structure (file paths, shell commands, error codes, URLs, diff
 * hunks, stack frames, test verdicts) are always protected.
 */

import fs from "node:fs";
import { round, tokenize } from "../core/text.js";
import type { JevBackend, NoulResult } from "../core/types.js";
import type { CompactionReport } from "../core/module-types.js";

export interface CompactorDeps {
  backend: JevBackend;
  concurrency?: number;
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "of", "to", "and", "or", "in", "on", "at", "it", "this",
  "that", "for", "with", "as", "be", "by", "from", "we", "i", "you", "they", "he", "she", "not", "but",
  "if", "then", "than", "so", "do", "does", "did", "have", "has", "had", "will", "would", "should",
]);

function meaningfulTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of tokenize(text)) {
    if (token.length > 1 && !STOPWORDS.has(token)) tokens.add(token);
  }
  return tokens;
}

export interface WinnowOptions {
  /** Why we are compacting; injected verbatim as evaluation state. */
  goal?: string;
  state?: string;
  /** Noul probability threshold above which a line is kept (default 0.5). */
  keepThreshold?: number;
  /** Maximum lines processed per call (safety valve for huge dumps). */
  maxLines?: number;
}

const ANCHOR_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "file-path", re: /(?:^|\s)(?:[\w.-]+\/)+[\w.-]+|\b[\w.-]+\.(?:ts|tsx|js|mjs|cjs|py|json|md|yml|yaml|toml|sql|env|lock)\b/ },
  { name: "command", re: /^\s*(?:\$|>|PS[ >])|^\s*(?:npm|npx|pnpm|yarn|node|deno|bun|git|docker|gh|python|pip|cargo|go|dotnet|tsc|vitest|jest|pytest)\b/i },
  { name: "error", re: /\b(?:error|exception|traceback|fatal|panic|ELIFECYCLE|E[A-Z]{2,}\d{0,4})\b/i },
  { name: "status-code", re: /\b(?:4\d\d|5\d\d)\b.*\b(?:status|http|response)\b|\bHTTP\/\d(?:\.\d)?\b/i },
  { name: "url", re: /https?:\/\/\S+/ },
  { name: "diff-header", re: /^(?:diff --git|index [0-9a-f]+|@@|\+\+\+|---)/ },
  { name: "stack-frame", re: /^\s*at\s+.+\(.+:\d+:\d+\)/ },
  { name: "test-verdict", re: /\b(?:PASS|FAIL|ok|not ok|Tests:|Test Suites:|assertion)\b/ },
  { name: "warning", re: /\b(?:warn|warning|deprecated|vulnerab)/i },
  { name: "version", re: /\bv?\d+\.\d+\.\d+\b/ },
];

function anchorMatches(line: string): string[] {
  return ANCHOR_PATTERNS.filter((p) => p.re.test(line)).map((p) => p.name);
}

export class ContextCompactor {
  constructor(private readonly deps: CompactorDeps) {}

  async winnow(input: string, opts: WinnowOptions = {}): Promise<CompactionReport> {
    const started = Date.now();
    const maxLines = opts.maxLines ?? 1500;
    const threshold = opts.keepThreshold ?? 0.5;
    const allLines = input.split(/\r?\n/);
    const lines = allLines.slice(0, maxLines);
    const truncated = allLines.length > maxLines;

    const structural = lines.map((line) => anchorMatches(line));
    const protectedFlags = lines.map((line, i) => structural[i]!.length > 0 || line.trim().length === 0);

    // One fan-out pass: Noul relevance per line (blank/protected lines skipped eagerly).
    const candidates = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => line.trim().length > 0 && !protectedFlags[index]);

    const evaluations = (await this.deps.backend.batch(
      candidates.map(({ line, index }) => ({
        kind: "noul" as const,
        question: "Is this log line relevant to the current engineering goal, error or file under discussion?",
        state: `goal: ${opts.goal ?? "(unspecified)"}\n${opts.state ?? ""}\nline: ${line}\nline-number: ${index + 1}`,
      })),
    )) as NoulResult[];

    // Neighbour-context boost: lines adjacent to a strong hit are kept too.
    const probability = new Array<number>(lines.length).fill(1);
    const goalTokens = meaningfulTokens(opts.goal ?? "");
    candidates.forEach(({ index, line }, i) => {
      let p = evaluations[i]!.probability;
      // When the model is effectively undecided (coin flip), fall back to a
      // deterministic lexical overlap between the goal and the line.
      if (Math.abs(p - 0.5) < 0.1 && goalTokens.size > 0) {
        const lineTokens = meaningfulTokens(line);
        let overlap = 0;
        for (const token of lineTokens) if (goalTokens.has(token)) overlap++;
        const ratio = overlap / Math.max(1, lineTokens.size);
        p = ratio >= 0.12 ? 0.6 : 0.35;
      }
      probability[index] = p;
    });
    for (let i = 0; i < lines.length; i++) {
      if (protectedFlags[i]) continue; // anchors never act as boost sources
      if (probability[i]! >= threshold) {
        if (i > 0 && !protectedFlags[i - 1]) probability[i - 1] = Math.max(probability[i - 1]!, 0.55);
        if (i + 1 < lines.length && !protectedFlags[i + 1]) {
          probability[i + 1] = Math.max(probability[i + 1]!, 0.55);
        }
      }
    }

    const kept: string[] = [];
    const dropped: string[] = [];
    const preservedAnchors = new Set<string>();
    let keptLines = 0;

    lines.forEach((line, i) => {
      const isProtected = protectedFlags[i]!;
      if (isProtected) {
        structural[i]!.forEach((name) => preservedAnchors.add(name));
      }
      const keep = line.trim().length === 0 || isProtected || probability[i]! >= threshold;
      if (keep) {
        kept.push(line);
        keptLines++;
      } else {
        dropped.push(line);
      }
    });

    const compacted =
      kept.join("\n") +
      (truncated ? `\n... (${allLines.length - maxLines} further lines not processed: maxLines=${maxLines})` : "");

    return {
      keptLines,
      droppedLines: dropped.length,
      bytesIn: Buffer.byteLength(input, "utf8"),
      bytesOut: Buffer.byteLength(compacted, "utf8"),
      preservedAnchors: [...preservedAnchors].sort(),
      compacted,
      droppedSample: dropped.slice(0, 10),
      method: "winnow",
      latencyMs: round(Date.now() - started, 3),
    };
  }

  /** Convenience wrapper for compacting a file from disk. */
  async winnowFile(file: string, opts: WinnowOptions = {}): Promise<CompactionReport & { file: string }> {
    const input = fs.readFileSync(file, "utf8");
    const report = await this.winnow(input, opts);
    return { ...report, file };
  }
}
