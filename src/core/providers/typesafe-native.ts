/**
 * Native TypeSafe Jev HTTP provider.
 *
 * Speaks the REAL TypeSafe API: a single `POST /v1/systemone` endpoint that
 * takes one shared `state` (the content) plus a map of named questions
 * (each `{type: noul|choice|score, instructions, criteria}`), and returns
 * answers keyed the same way, plus token usage for the whole call. This is
 * not the same shape earlier revisions of this file assumed (separate
 * /choice /score /noul endpoints) — that shape 404s against the live API;
 * verified against the real OpenAPI spec at https://api.typesafe.ai/openapi.json
 * and a live call on 2026-09-21.
 *
 * Batching semantics: the API only accepts ONE `state` per call, so requests
 * are grouped by identical `state` (multiple questions about the same
 * content go in one call — real batching, real savings); requests with
 * different `state` values are necessarily separate calls, run concurrently.
 *
 * Enable with JEV_BACKEND_PROVIDER=typesafe_jev and TYPESAFE_JEV_NATIVE=1 to
 * force this transport instead of the OpenAI-compatible gateway transport.
 */

import { BackendError, SchemaViolationError, errorMessage } from "../errors.js";
import { mapLimit } from "../fanout.js";
import { clamp, fnv1a, round } from "../text.js";
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

interface SystemOneAnswer {
  type: "noul" | "choice" | "score";
  noul?: number;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  score?: number;
}

interface SystemOneResponse {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

const now = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

export class NativeJevBackend implements JevBackend {
  readonly meta: BackendMeta = {
    id: "typesafe_jev",
    label: "TypeSafe Jev API (POST /v1/systemone)",
    pricePerMillionUsd: 0.042,
    outputTokenCostUsd: 0,
    local: false,
    synthetic: false,
  };
  private readonly timeoutMs: number;
  private readonly concurrency: number;

  constructor(private readonly options: NativeJevOptions) {
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.concurrency = options.concurrency ?? 8;
    if (options.pricePerMillionUsd !== undefined) {
      this.meta.pricePerMillionUsd = options.pricePerMillionUsd;
    }
  }

  private async post(body: unknown): Promise<SystemOneResponse> {
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/systemone`;
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
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new BackendError(`HTTP ${response.status} from ${url}${detail ? `: ${detail.slice(0, 200)}` : ""}`, this.meta.id);
      }
      return (await response.json()) as SystemOneResponse;
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError(`request to ${url} failed: ${errorMessage(error)}`, this.meta.id, error);
    } finally {
      clearTimeout(timer);
    }
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

  /** Build one named `SystemOneRequest` question entry for a request. */
  private buildQuestion(request: JevRequest): Record<string, unknown> {
    if (request.kind === "noul") {
      return { type: "noul", instructions: request.question };
    }
    if (request.kind === "choice") {
      const criteria: Record<string, string> = {};
      for (const option of request.options) criteria[option] = option;
      return { type: "choice", instructions: request.question, criteria };
    }
    const min = request.min ?? 1;
    const max = request.max ?? 10;
    const criteria: string[] = [];
    for (let level = min; level <= max; level++) criteria.push(String(level));
    return { type: "score", instructions: request.question, criteria };
  }

  private parseAnswer(
    request: JevRequest,
    answer: SystemOneAnswer,
    usage: { inputTokens: number; costUsd: number; latencyMs: number },
  ): JevResult {
    const base = {
      backend: this.meta.id,
      latencyMs: usage.latencyMs,
      schemaValid: true as const,
      synthetic: false as const,
      usage: { inputTokens: usage.inputTokens, costUsd: usage.costUsd, pricePerMillionUsd: this.meta.pricePerMillionUsd },
    };

    if (request.kind === "noul") {
      const value = Number(answer.noul);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new SchemaViolationError(this.meta.id, "noul answer missing/out of [0,1]");
      }
      return {
        id: request.id ?? `noul-${fnv1a(request.question).toString(16)}`,
        kind: "noul",
        question: request.question,
        probability: round(value, 4),
        confidence: round(clamp(Math.abs(value - 0.5) * 2 + 0.15, 0.05, 0.99), 4),
        signals: [],
        ...base,
      } satisfies NoulResult;
    }

    if (request.kind === "choice") {
      const probsRaw = answer.probabilities ?? {};
      const probabilities = request.options.map((o) => Number(probsRaw[o] ?? 0));
      const sum = probabilities.reduce((a, b) => a + b, 0);
      const normalized = sum > 0 ? probabilities.map((p) => p / sum) : probabilities;
      const byName = request.options.indexOf(answer.choice ?? "");
      const selectedIndex =
        byName >= 0 ? byName : normalized.reduce((best, p, i) => (p > normalized[best]! ? i : best), 0);
      if (selectedIndex < 0) throw new SchemaViolationError(this.meta.id, "choice answer did not match any option");
      return {
        id: request.id ?? `choice-${fnv1a(request.question).toString(16)}`,
        kind: "choice",
        question: request.question,
        options: request.options,
        selectedIndex,
        selected: request.options[selectedIndex] ?? answer.choice ?? "",
        probabilities: normalized.map((p) => round(p, 6)),
        confidence: round(answer.confidence ?? normalized[selectedIndex] ?? 0, 6),
        ...base,
      } satisfies ChoiceResult;
    }

    const min = request.min ?? 1;
    const max = request.max ?? 10;
    const level = Number(answer.score);
    if (!Number.isFinite(level)) throw new SchemaViolationError(this.meta.id, "score answer is not numeric");
    return {
      id: request.id ?? `score-${fnv1a(request.question).toString(16)}`,
      kind: "score",
      question: request.question,
      min,
      max,
      score: round(clamp(min + level, min, max), 3),
      confidence: Number(answer.confidence ?? 0.8),
      signals: [],
      ...base,
    } satisfies ScoreResult;
  }

  async batch(requests: JevRequest[]): Promise<JevResult[]> {
    if (requests.length === 0) return [];

    // The API takes exactly one shared `state` per call — group requests
    // that share the same state into a single multi-question call.
    const order: string[] = [];
    const groups = new Map<string, number[]>();
    requests.forEach((r, i) => {
      const key = r.state ?? "";
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(i);
    });

    const results = new Array<JevResult>(requests.length);
    await mapLimit(order, this.concurrency, async (state) => {
      const indices = groups.get(state)!;
      const questions: Record<string, unknown> = {};
      indices.forEach((idx) => {
        questions[`q${idx}`] = this.buildQuestion(requests[idx]!);
      });
      const startedGroup = now();
      const raw = await this.post({ state, questions });
      const latencyMs = round(now() - startedGroup, 3);
      const inputTokensPerItem = raw.usage.input_tokens / indices.length;
      const costUsd = round((inputTokensPerItem / 1_000_000) * this.meta.pricePerMillionUsd, 8);
      indices.forEach((idx) => {
        const answer = raw.answers[`q${idx}`];
        if (!answer) throw new SchemaViolationError(this.meta.id, `missing answer for q${idx}`);
        results[idx] = this.parseAnswer(requests[idx]!, answer, {
          inputTokens: Math.round(inputTokensPerItem),
          costUsd,
          latencyMs,
        });
      });
    });
    return results;
  }

  async choice(req: ChoiceRequest): Promise<ChoiceResult> {
    return (await this.batch([req]))[0] as ChoiceResult;
  }

  async score(req: ScoreRequest): Promise<ScoreResult> {
    return (await this.batch([req]))[0] as ScoreResult;
  }

  async noul(req: NoulRequest): Promise<NoulResult> {
    return (await this.batch([req]))[0] as NoulResult;
  }
}
