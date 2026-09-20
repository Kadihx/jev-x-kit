/**
 * Text utilities shared by every module.
 *
 * Design rule (blueprint §1.A.4): context is NEVER rewritten or summarized.
 * Helpers here only tokenize / score / drop lines — they never mutate content.
 */

/** FNV-1a 32-bit hash. Deterministic across runs and platforms. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic 0..1 pseudo-random generator seeded by a string. */
export function seededRandom(seed: string): () => number {
  let state = fnv1a(seed) || 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

const TOKEN_RE = /[\p{L}\p{N}_-]+/gu;

const FOLD: Record<string, string> = {
  "\u0130": "i", // İ
  "\u0131": "i", // ı
  "\u015e": "s", // Ş
  "\u015f": "s", // ş
  "\u011e": "g", // Ğ
  "\u011f": "g", // ğ
  "\u00dc": "u", // Ü
  "\u00fc": "u", // ü
  "\u00d6": "o", // Ö
  "\u00f6": "o", // ö
  "\u00c7": "c", // Ç
  "\u00e7": "c", // ç
};

/** Unicode-aware tokenizer with Turkish-aware lowercasing + diacritic folding. */
export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase().replace(/[\u0130\u011e\u015e\u00dc\u00d6\u00c7\u0131\u011f\u015f\u00fc\u00f6\u00e7]/g, (ch) => FOLD[ch] ?? ch);
  return (lowered.match(TOKEN_RE) ?? []).map((t) => t.replace(/^-+|-+$/g, ""));
}

/** Jaccard similarity over n-grams — used for the clean-room originality guard. */
export function ngramJaccard(a: string, b: string, n = 5): number {
  const grams = (text: string): Set<string> => {
    const tokens = tokenize(text);
    const set = new Set<string>();
    for (let i = 0; i + n <= tokens.length; i++) set.add(tokens.slice(i, i + n).join(" "));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

export const POSITIVE_CUES = [
  "pass", "passed", "passing", "covered", "coverage", "test", "tests", "tested",
  "typed", "strict", "validated", "atomic", "idempotent", "cached", "cache",
  "retry", "timeout", "documented", "reviewed", "calibrated", "lossless",
  "deterministic", "sandbox", "isolated", "encrypted", "audited", "benchmark",
  "stable", "proven", "simple", "modular", "reversible",
] as const;

export const NEGATIVE_CUES = [
  "crash", "crashes", "race", "deadlock", "null", "undefined", "leak", "leaks",
  "flaky", "todo", "fixme", "hack", "deprecated", "vulnerable", "overflow",
  "unsafe", "unhandled", "panic", "broken", "failure", "failed", "bug",
  "regression", "hardcoded", "secret", "password", "gpl", "agpl", "unknown",
  "blocked", "slow", "spaghetti", "legacy", "unsupported",
] as const;

const POS_SET = new Set(POSITIVE_CUES as readonly string[]);
const NEG_SET = new Set(NEGATIVE_CUES as readonly string[]);

export interface CueCounts {
  positive: number;
  negative: number;
  matchedPositive: string[];
  matchedNegative: string[];
}

export function countCues(text: string): CueCounts {
  const tokens = new Set(tokenize(text));
  const matchedPositive: string[] = [];
  const matchedNegative: string[] = [];
  for (const t of tokens) {
    if (POS_SET.has(t)) matchedPositive.push(t);
    if (NEG_SET.has(t)) matchedNegative.push(t);
  }
  return {
    positive: matchedPositive.length,
    negative: matchedNegative.length,
    matchedPositive,
    matchedNegative,
  };
}

/** Sigmoid with numeric clamp. */
export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Rough token estimate used for $/1M-token accounting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Softmax over scores with temperature. */
export function softmax(scores: number[], temperature = 1): number[] {
  if (scores.length === 0) return [];
  const t = Math.max(temperature, 1e-6);
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / t));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}
