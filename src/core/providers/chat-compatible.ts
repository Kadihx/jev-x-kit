/**
 * OpenAI-compatible chat backend for Jev primitives.
 *
 * Works with every free/local endpoint that speaks /chat/completions:
 *  - OpenJev on vLLM        (docker run --gpus all -p 8000:8000 razorback16/openjev)
 *  - LayA local server      (python -m laya.serve --port 8000)
 *  - Ollama                 (http://localhost:11434/v1)
 *  - Vercel AI Gateway      (https://ai-gateway.vercel.sh/v1) -> typesafe/jev
 *
 * The kit never trusts free text: responses are strictly validated against the
 * Choice / Score / Noul schemas with one repair retry (blueprint §1.A.3).
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

export interface ChatCompatibleOptions {
  id: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  pricePerMillionUsd: number;
  local: boolean;
  timeoutMs?: number;
  concurrency?: number;
  /** Extra body fields, e.g. guided-decoding constraints on vLLM. */
  extra?: Record<string, unknown>;
}

const now = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

const SYSTEM_PROMPT =
  "You are Jev, a non-autoregressive decision head. You never write prose, explanations or markdown. " +
  "You emit exactly one minified JSON object that matches the requested schema and nothing else.";

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON object found in response");
  }
  return JSON.parse(text.slice(start, end + 1));
}

export class ChatCompatibleBackend implements JevBackend {
  readonly meta: BackendMeta;
  private readonly timeoutMs: number;
  private readonly concurrency: number;

  constructor(private readonly options: ChatCompatibleOptions) {
    this.meta = {
      id: options.id,
      label: options.label,
      pricePerMillionUsd: options.pricePerMillionUsd,
      outputTokenCostUsd: 0,
      local: options.local,
      synthetic: false,
    };
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.concurrency = options.concurrency ?? 8;
  }

  private async complete(messages: Array<{ role: string; content: string }>): Promise<string> {
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`;
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
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          max_tokens: 256,
          response_format: { type: "json_object" },
          messages,
          ...this.options.extra,
        }),
      });
      if (!response.ok) {
        throw new BackendError(`HTTP ${response.status} from ${url}`, this.meta.id);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new BackendError("malformed chat response (no message content)", this.meta.id);
      }
      return content;
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError(
        `request to ${url} failed: ${errorMessage(error)}`,
        this.meta.id,
        error,
      );
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
        costUsd: round((inputTokens / 1_000_000) * this.options.pricePerMillionUsd, 8),
        pricePerMillionUsd: this.options.pricePerMillionUsd,
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
    const numbered = req.options.map((option, i) => `${i}: ${option}`).join("\n");
    const state = req.state ? `\nState (verbatim):\n${req.state}` : "";
    const asked =
      `Question: ${req.question}\nOptions:\n${numbered}${state}\n` +
      `Respond with {"probabilities":[p0,p1,...]} with exactly ${req.options.length} numbers in [0,1] that sum to 1.`;

    const raw = await this.complete([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: asked },
    ]);
    const parsed = this.parseChoice(raw, req.options.length);
    return {
      id: req.id ?? `choice-${fnv1a(req.question).toString(16)}`,
      kind: "choice",
      question: req.question,
      options: req.options,
      selectedIndex: parsed.index,
      selected: req.options[parsed.index] ?? "",
      probabilities: parsed.probabilities.map((p) => round(p, 6)),
      confidence: round(parsed.probabilities[parsed.index] ?? 0, 6),
      ...this.usage(asked, started),
    };
  }

  private parseChoice(raw: string, expected: number): { probabilities: number[]; index: number } {
    try {
      const json = extractJson(raw) as {
        probabilities?: unknown;
        selected?: unknown;
        choice?: unknown;
      };
      if (Array.isArray(json.probabilities) && json.probabilities.length === expected) {
        const numbers = json.probabilities.map((p) => Number(p));
        if (numbers.every((n) => Number.isFinite(n) && n >= 0)) {
          const sum = numbers.reduce((a, b) => a + b, 0);
          if (sum > 0) {
            const probabilities = numbers.map((n) => n / sum);
            const index = probabilities.reduce(
              (best, p, i) => (p > probabilities[best] ? i : best),
              0,
            );
            return { probabilities, index };
          }
        }
      }
      const selectedRaw = json.selected ?? json.choice;
      if (selectedRaw !== undefined) {
        const index = Number(selectedRaw);
        if (Number.isInteger(index) && index >= 0 && index < expected) {
          const probabilities = new Array<number>(expected).fill(0.05 / Math.max(1, expected - 1));
          probabilities[index] = 0.95;
          return { probabilities, index };
        }
      }
      throw new Error("choice payload failed validation");
    } catch (error) {
      throw new SchemaViolationError(this.meta.id, errorMessage(error));
    }
  }

  async score(req: ScoreRequest): Promise<ScoreResult> {
    const started = now();
    const min = req.min ?? 1;
    const max = req.max ?? 10;
    const state = req.state ? `\nState (verbatim):\n${req.state}` : "";
    const asked =
      `Rate: ${req.question}${state}\n` +
      `Respond with {"score": <number>} where the scale is ${min} (worst) to ${max} (best). Fractions allowed.`;

    const raw = await this.complete([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: asked },
    ]);

    let score: number;
    try {
      const json = extractJson(raw) as { score?: unknown; value?: unknown };
      const value = Number(json.score ?? json.value);
      if (!Number.isFinite(value)) throw new Error("score is not numeric");
      if (value < min - 0.5 || value > max + 0.5)
        throw new Error(`score ${value} outside [${min},${max}]`);
      score = round(clamp(value, min, max), 3);
    } catch (error) {
      throw new SchemaViolationError(this.meta.id, errorMessage(error));
    }

    return {
      id: req.id ?? `score-${fnv1a(req.question).toString(16)}`,
      kind: "score",
      question: req.question,
      min,
      max,
      score,
      confidence: 0.8,
      signals: [],
      ...this.usage(asked, started),
    };
  }

  async noul(req: NoulRequest): Promise<NoulResult> {
    const started = now();
    const state = req.state ? `\nState (verbatim):\n${req.state}` : "";
    const asked =
      `Yes/no question: ${req.question}${state}\n` +
      `Respond with {"probability": <number between 0 and 1>} - the calibrated chance that the answer is "yes".`;

    const raw = await this.complete([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: asked },
    ]);

    let probability: number;
    try {
      const json = extractJson(raw) as {
        probability?: unknown;
        prob?: unknown;
        noul?: unknown;
        p?: unknown;
      };
      const value = Number(json.probability ?? json.prob ?? json.noul ?? json.p);
      if (!Number.isFinite(value)) throw new Error("probability is not numeric");
      if (value < 0 || value > 1) throw new Error(`probability ${value} outside [0,1]`);
      probability = round(value, 4);
    } catch (error) {
      throw new SchemaViolationError(this.meta.id, errorMessage(error));
    }

    return {
      id: req.id ?? `noul-${fnv1a(req.question).toString(16)}`,
      kind: "noul",
      question: req.question,
      probability,
      confidence: round(clamp(Math.abs(probability - 0.5) * 2 + 0.15, 0.05, 0.99), 4),
      signals: [],
      ...this.usage(asked, started),
    };
  }

  /** Speculative fan-out across the batch with bounded concurrency. */
  async batch(requests: JevRequest[]): Promise<JevResult[]> {
    return mapLimit(requests, this.concurrency, (request) => this.evaluate(request));
  }

  private async evaluate(request: JevRequest): Promise<JevResult> {
    if (request.kind === "choice") return this.choice(request);
    if (request.kind === "score") return this.score(request);
    return this.noul(request);
  }
}
