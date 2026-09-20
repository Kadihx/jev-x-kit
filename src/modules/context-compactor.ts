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
import type { CompactionReport, TranscriptCompactionReport, TranscriptMessage } from "../core/module-types.js";

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

  /**
   * Structured variant: operates on a message transcript (a tool-use/
   * tool-result-aware shape close to what an agent harness like Claude Code
   * actually keeps in memory) instead of flat text. Same doctrine as
   * `winnow()` — never rewrite, only delete — but the unit of decision is a
   * tool-call/tool-result pair, matched by `tool_use_id`, with two Noul
   * questions per pair (keep the call? keep the result verbatim?) instead of
   * one per line. Anchors (file paths, commands, errors, URLs, diff headers —
   * the same `ANCHOR_PATTERNS` `winnow()` uses) act as a deterministic
   * safety net: a result matching an anchor is kept even if Noul says drop.
   */
  async winnowTranscript(
    messages: TranscriptMessage[],
    opts: WinnowOptions & { preserveRecentMessages?: number; truncateHeadChars?: number } = {},
  ): Promise<TranscriptCompactionReport> {
    const started = Date.now();
    const threshold = opts.keepThreshold ?? 0.5;
    const preserveRecent = opts.preserveRecentMessages ?? 6;
    const truncateHeadChars = opts.truncateHeadChars ?? 300;
    const bytesIn = Buffer.byteLength(JSON.stringify(messages), "utf8");

    const pinned = new Set<number>();
    if (messages.length > 0) pinned.add(0);
    for (let i = Math.max(0, messages.length - preserveRecent); i < messages.length; i++) pinned.add(i);

    interface Pair {
      messageIndex: number;
      call: { tool_use_id: string; tool: string; input?: unknown };
      result?: { tool_use_id: string; text: string };
    }
    const resultById = new Map<string, { tool_use_id: string; text: string }>();
    for (const m of messages) for (const r of m.toolResults ?? []) resultById.set(r.tool_use_id, r);

    const pairs: Pair[] = [];
    messages.forEach((m, mi) => {
      if (pinned.has(mi)) return;
      for (const call of m.toolCalls ?? []) {
        pairs.push({ messageIndex: mi, call, result: resultById.get(call.tool_use_id) });
      }
    });

    const evaluations = pairs.length
      ? ((await this.deps.backend.batch(
          pairs.flatMap((p) => [
            {
              kind: "noul" as const,
              question: "Knowing this tool call was made (with its input), does that fact still matter for the rest of the task?",
              state: `goal: ${opts.goal ?? "(unspecified)"}\ntool: ${p.call.tool}\ninput: ${JSON.stringify(p.call.input ?? {}).slice(0, 500)}`,
            },
            {
              kind: "noul" as const,
              question: "Is this tool result's content still needed verbatim, or would re-running the tool be just as good?",
              state: `goal: ${opts.goal ?? "(unspecified)"}\ntool: ${p.call.tool}\nresult: ${(p.result?.text ?? "").slice(0, 800)}`,
            },
          ]),
        )) as NoulResult[])
      : [];

    let keptCalls = 0;
    let truncatedResults = 0;
    let droppedPairs = 0;
    let anchorOverrides = 0;
    const decisions = new Map<string, "keep" | "truncate" | "drop">();

    pairs.forEach((p, i) => {
      const keepCall = evaluations[i * 2]!.probability;
      const keepResult = evaluations[i * 2 + 1]!.probability;
      const resultAnchors = p.result ? anchorMatches(p.result.text) : [];
      const hasAnchor = resultAnchors.length > 0;

      if (keepResult >= threshold || hasAnchor) {
        if (hasAnchor && keepResult < threshold) anchorOverrides++;
        decisions.set(p.call.tool_use_id, "keep");
        keptCalls++;
      } else if (keepCall >= threshold) {
        decisions.set(p.call.tool_use_id, "truncate");
        keptCalls++;
        truncatedResults++;
      } else {
        decisions.set(p.call.tool_use_id, "drop");
        droppedPairs++;
      }
    });

    const outputMessages: TranscriptMessage[] = [];
    messages.forEach((m, mi) => {
      if (pinned.has(mi)) {
        outputMessages.push(m);
        return;
      }
      const toolCalls = (m.toolCalls ?? []).filter((c) => decisions.get(c.tool_use_id) !== "drop");
      const toolResults = (m.toolResults ?? [])
        .filter((r) => decisions.get(r.tool_use_id) !== "drop")
        .map((r) =>
          decisions.get(r.tool_use_id) === "truncate"
            ? { ...r, text: `${r.text.slice(0, truncateHeadChars)}\n[…truncated by Winnow, ${r.text.length - truncateHeadChars} more chars…]` }
            : r,
        );
      const hasContent = (m.text && m.text.trim().length > 0) || toolCalls.length > 0 || toolResults.length > 0;
      if (hasContent) outputMessages.push({ ...m, toolCalls: toolCalls.length ? toolCalls : undefined, toolResults: toolResults.length ? toolResults : undefined });
    });

    const bytesOut = Buffer.byteLength(JSON.stringify(outputMessages), "utf8");

    return {
      totalMessages: messages.length,
      outputMessages: outputMessages.length,
      totalPairs: pairs.length,
      keptCalls,
      truncatedResults,
      droppedPairs,
      anchorOverrides,
      bytesIn,
      bytesOut,
      messages: outputMessages,
      latencyMs: round(Date.now() - started, 3),
    };
  }
}
