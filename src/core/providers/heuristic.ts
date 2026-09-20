/**
 * Deterministic offline Jev simulator ("heuristic" backend).
 *
 * Purpose: the kit must stay 100% functional with zero network, zero GPU and
 * zero API keys (blueprint §5). This backend is a *simulation* of the
 * non-autoregressive primitives — it never emits free text, only the
 * Choice / Score / Noul schemas, with calibrated-looking confidences.
 *
 * Results are deterministic for identical inputs (seeded xorshift), which
 * makes the whole framework unit-testable offline.
 */

import type {
  BackendMeta,
  ChoiceRequest,
  ChoiceResult,
  JevBackend,
  JevRequest,
  JevResult,
  NoulRequest,
  NoulResult,
  ScoreRequest,
  ScoreResult,
} from "../types.js";
import {
  clamp,
  countCues,
  estimateTokens,
  fnv1a,
  round,
  seededRandom,
  sigmoid,
  softmax,
  tokenize,
} from "../text.js";

export const HEURISTIC_META: BackendMeta = {
  id: "heuristic",
  label: "Deterministic offline Jev simulator (free, no network)",
  pricePerMillionUsd: 0,
  outputTokenCostUsd: 0,
  local: true,
  synthetic: true,
};

const now = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

function baseFields(text: string, started: number) {
  return {
    latencyMs: round(now() - started, 3),
    usage: {
      inputTokens: estimateTokens(text),
      costUsd: 0,
      pricePerMillionUsd: 0,
    },
    schemaValid: true,
    synthetic: true,
    backend: HEURISTIC_META.id,
  };
}

/** Similarity signal used to rank options against the question. */
function optionAffinity(question: string, option: string, index: number, rng: () => number): number {
  const qTokens = new Set(tokenize(question));
  const oTokens = tokenize(option);
  let score = 0;

  if (oTokens.length > 0) {
    const overlap = oTokens.filter((t) => qTokens.has(t)).length;
    score += (overlap / oTokens.length) * 1.6;
  }

  const trimmed = option.trim().toLowerCase();
  if (trimmed.length >= 3 && question.toLowerCase().includes(trimmed)) score += 1.2;

  for (const token of tokenize(option)) {
    if ((/\d/.test(token) || token.length <= 4) && qTokens.has(token) && token.length > 1) {
      score += 0.35;
    }
  }

  const cues = countCues(option);
  score += cues.positive * 0.15 - cues.negative * 0.3;

  score += Math.min(oTokens.length, 8) * 0.02;

  // Deterministic tie-breaker keyed on the option content itself.
  score += ((fnv1a(option + index) % 1000) / 1000 - 0.5) * 0.04;
  score += (rng() - 0.5) * 0.02;

  return score;
}

export class HeuristicBackend implements JevBackend {
  readonly meta = HEURISTIC_META;

  async health(): Promise<boolean> {
    return true;
  }

  async choice(req: ChoiceRequest): Promise<ChoiceResult> {
    const started = now();
    const question = req.question ?? "";
    const options = req.options ?? [];
    const rng = seededRandom(`${question}|${options.join("|")}`);

    const raw = options.map((option, i) =>
      optionAffinity(`${question} ${req.state ?? ""}`, option, i, rng),
    );
    const probabilities = softmax(raw, 0.9).map((p) => round(p, 6));
    const maxIndex = probabilities.reduce((best, p, i) => (p > probabilities[best] ? i : best), 0);

    return {
      id: req.id ?? `choice-${fnv1a(question).toString(16)}`,
      kind: "choice",
      question,
      options,
      selectedIndex: options.length ? maxIndex : -1,
      selected: options[maxIndex] ?? "",
      probabilities,
      confidence: round(probabilities[maxIndex] ?? 0, 6),
      ...baseFields(`${question} ${options.join(" ")} ${req.state ?? ""}`, started),
    };
  }

  async score(req: ScoreRequest): Promise<ScoreResult> {
    const started = now();
    const min = req.min ?? 1;
    const max = req.max ?? 10;
    const question = `${req.question ?? ""} ${req.state ?? ""}`;
    const cues = countCues(question);
    const rng = seededRandom(`score|${question}`);

    let value = min + (max - min) * 0.5;
    value += cues.positive * ((max - min) * 0.045);
    value -= cues.negative * ((max - min) * 0.055);

    // Numeric evidence: percentages pull the score toward their own value.
    const pct = question.match(/(\d{1,3}(?:\.\d+)?)\s*%/g) ?? [];
    for (const p of pct.slice(0, 4)) {
      const v = parseFloat(p);
      if (Number.isFinite(v)) value += ((clamp(v, 0, 100) - 50) / 100) * (max - min) * 0.5;
    }

    value += (rng() - 0.5) * (max - min) * 0.06;
    value = clamp(value, min, max);

    const evidence = cues.positive + cues.negative + pct.length;
    const confidence = round(
      clamp(
        0.62 + evidence * 0.035 + (Math.abs(value - (min + max) / 2) / (max - min)) * 0.15,
        0.5,
        0.97,
      ),
      4,
    );

    return {
      id: req.id ?? `score-${fnv1a(question).toString(16)}`,
      kind: "score",
      question: req.question,
      min,
      max,
      score: round(value, 3),
      confidence,
      signals: [
        ...cues.matchedPositive.map((c) => `+${c}`),
        ...cues.matchedNegative.map((c) => `-${c}`),
      ],
      ...baseFields(question, started),
    };
  }

  async noul(req: NoulRequest): Promise<NoulResult> {
    const started = now();
    const text = `${req.question ?? ""} ${req.state ?? ""}`;
    const cues = countCues(text);
    const rng = seededRandom(`noul|${text}`);

    // Polarity: when the question itself asks about danger/failure, positive
    // cues are evidence AGAINST it and negative cues are evidence FOR it.
    const negativePolarity =
      /\b(?:danger|dangerous|harm|harmful|unsafe|risk|risky|fail|fails|failure|crash|regression|break|breaks|broken|destroy|destructive|irreversible|leak|exceed|hit|miss|violate|expose)\b/i.test(
        req.question ?? "",
      );
    const polarity = negativePolarity ? -1 : 1;

    const logit = polarity * (0.9 * cues.positive - 1.15 * cues.negative) + (rng() - 0.5) * 0.4;
    const probability = round(clamp(sigmoid(logit), 0.01, 0.99), 4);

    return {
      id: req.id ?? `noul-${fnv1a(text).toString(16)}`,
      kind: "noul",
      question: req.question,
      probability,
      confidence: round(clamp(Math.abs(probability - 0.5) * 2 + 0.15, 0.05, 0.99), 4),
      signals: [
        ...cues.matchedPositive.map((c) => `+${c}`),
        ...cues.matchedNegative.map((c) => `-${c}`),
      ],
      ...baseFields(text, started),
    };
  }

  /** Speculative fan-out: every question in the batch is evaluated in one pass. */
  async batch(requests: JevRequest[]): Promise<JevResult[]> {
    return Promise.all(requests.map((r) => this.evaluate(r)));
  }

  async evaluate(req: JevRequest): Promise<JevResult> {
    if (req.kind === "choice") return this.choice(req);
    if (req.kind === "score") return this.score(req);
    return this.noul(req);
  }
}
