/**
 * Native TypeSafe Jev HTTP provider.
 *
 * Speaks the non-autoregressive Jev API shape (choice / score / noul) instead
 * of the chat-completions proxy. Field names are parsed tolerantly because
 * hosted gateways occasionally rename payload keys.
 *
 * Enable with JEV_BACKEND_PROVIDER=typesafe_jev and TYPESAFE_JEV_NATIVE=1 to
 * force this transport instead of the OpenAI-compatible gateway transport.
 */

import { BackendError, SchemaViolationError, errorMessage } from "../errors.js";
import { mapLimit } from "../fanout.js";
import { clamp, estimateTokens, fnv1a, round } from "../text.js";
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

export interface NativeJevOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  concurrency?: number;
  /** Default $0.042 per 1M input tokens (blueprint §1.B); override for gateways. */
  pricePerMillionUsd?: number;
}

const now = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

export class NativeJevBackend implements JevBackend {
  readonly meta: BackendMeta = {
    id: "typesafe_jev",
    label: "TypeSafe Jev API (native choice/score/noul endpoints)",
    pricePerMillionUsd: 0.042,
    outputTokenCostUsd: 0,
    local: false,
    synthetic: false,
  };
  private readonly timeoutMs: number;
  private readonly concurrency: number;

  constructor(private readonly options: NativeJevOptions) {
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.concurrency = options.concurrency ?? 8;
    if (options.pricePerMillionUsd !== undefined) {
      this.meta.pricePerMillionUsd = options.pricePerMillionUsd;
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.options.model, ...(body as object) }),
      });
      if (!response.ok) throw new BackendError(`HTTP ${response.status} from ${url}`, this.meta.id);
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError(`request to ${url} failed: ${errorMessage(error)}`, this.meta.id, error);
    } finally {
      clearTimeout(timer);
    }
  }

  private usage(text: string, started: number) {
    const inputTokens = estimateTokens(text);
    return {
      latencyMs: round(now() - started, 3),
      usage: {
        inputTokens,
        costUsd: round((inputTokens / 1_000_000) * this.meta.pricePerMillionUsd, 8),
        pricePerMillionUsd: this.meta.pricePerMillionUsd,
      },
      schemaValid: true as const,
      synthetic: false as const,
      backend: this.meta.id,
    };
  }

  async health(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/models`, {
        signal: controller.signal,
        headers: this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {},
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async choice(req: ChoiceRequest): Promise<ChoiceResult> {
    const started = now();
    const body = {
      question: req.question,
      group: req.options,
      options: req.options,
      state: req.state,
    };
    const raw = await this.post<Record<string, unknown>>("choice", body);

    const rawProbs = (raw["probabilities"] ?? raw["probs"] ?? raw["distribution"]) as unknown;
    let probabilities: number[] | null = null;
    if (Array.isArray(rawProbs) && rawProbs.length === req.options.length) {
      const numbers = rawProbs.map((p) => Number(p));
      if (numbers.every((n) => Number.isFinite(n) && n >= 0)) {
        const sum = numbers.reduce((a, b) => a + b, 0);
        if (sum > 0) probabilities = numbers.map((n) => n / sum);
      }
    }

    let index = Number(raw["selected_index"] ?? raw["choice"] ?? raw["index"] ?? NaN);
    let resolvedProbs = probabilities;
    if (resolvedProbs) {
      const definite = resolvedProbs;
      index = definite.reduce((best, p, i) => (p > definite[best]! ? i : best), 0);
    } else if (Number.isInteger(index) && index >= 0 && index < req.options.length) {
      const oneHot = new Array<number>(req.options.length).fill(
        0.05 / Math.max(1, req.options.length - 1),
      );
      oneHot[index] = 0.95;
      resolvedProbs = oneHot;
    }
    if (!resolvedProbs) {
      throw new SchemaViolationError(
        this.meta.id,
        "choice response missing probabilities/selected index",
      );
    }

    return {
      id: req.id ?? `choice-${fnv1a(req.question).toString(16)}`,
      kind: "choice",
      question: req.question,
      options: req.options,
      selectedIndex: index,
      selected: req.options[index] ?? "",
      probabilities: resolvedProbs.map((p) => round(p, 6)),
      confidence: round(resolvedProbs[index] ?? 0, 6),
      ...this.usage(JSON.stringify(body), started),
    };
  }

  async score(req: ScoreRequest): Promise<ScoreResult> {
    const started = now();
    const min = req.min ?? 1;
    const max = req.max ?? 10;
    const body = { question: req.question, min, max, state: req.state };
    const raw = await this.post<Record<string, unknown>>("score", body);
    const nested = (raw["result"] ?? {}) as Record<string, unknown>;
    const value = Number(raw["score"] ?? raw["value"] ?? nested["score"]);
    if (!Number.isFinite(value)) {
      throw new SchemaViolationError(this.meta.id, "score is not numeric");
    }
    return {
      id: req.id ?? `score-${fnv1a(req.question).toString(16)}`,
      kind: "score",
      question: req.question,
      min,
      max,
      score: round(clamp(value, min, max), 3),
      confidence: Number(raw["confidence"] ?? nested["confidence"] ?? 0.8),
      signals: [],
      ...this.usage(JSON.stringify(body), started),
    };
  }

  async noul(req: NoulRequest): Promise<NoulResult> {
    const started = now();
    const body = { question: req.question, state: req.state };
    const raw = await this.post<Record<string, unknown>>("noul", body);
    const nested = (raw["result"] ?? {}) as Record<string, unknown>;
    const value = Number(raw["probability"] ?? raw["prob"] ?? raw["noul"] ?? nested["probability"]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new SchemaViolationError(this.meta.id, "probability outside [0,1]");
    }
    return {
      id: req.id ?? `noul-${fnv1a(req.question).toString(16)}`,
      kind: "noul",
      question: req.question,
      probability: round(value, 4),
      confidence: round(clamp(Math.abs(value - 0.5) * 2 + 0.15, 0.05, 0.99), 4),
      signals: [],
      ...this.usage(JSON.stringify(body), started),
    };
  }

  async batch(requests: JevRequest[]): Promise<JevResult[]> {
    return mapLimit(requests, this.concurrency, (request) => this.evaluate(request));
  }

  private async evaluate(request: JevRequest): Promise<JevResult> {
    if (request.kind === "choice") return this.choice(request);
    if (request.kind === "score") return this.score(request);
    return this.noul(request);
  }
}
