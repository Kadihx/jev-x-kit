/**
 * System 2 client (autoregressive LLM) for planner / red-team / researcher.
 *
 * Speaks OpenAI-compatible /chat/completions: Ollama, vLLM, OpenJev, Vercel AI
 * Gateway, LM Studio, llama.cpp server... If the endpoint is down, every
 * caller receives a deterministic offline fallback instead of an exception, so
 * the MCP tools never fail closed.
 */

import { errorMessage } from "./errors.js";
import { log } from "./log.js";
import type { JevConfig } from "./config.js";

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmJsonResult<T> {
  value: T;
  source: "llm" | "offline-fallback";
  error?: string;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object found");
  return JSON.parse(candidate.slice(start, end + 1));
}

export class System2Client {
  private probe: boolean | null = null;

  constructor(private readonly config: JevConfig["llm"]) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  async available(): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.probe !== null) return this.probe;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/models`, {
        signal: controller.signal,
        headers: this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {},
      });
      this.probe = response.ok;
    } catch {
      this.probe = false;
    } finally {
      clearTimeout(timer);
    }
    if (!this.probe) log.info(`System 2 LLM unreachable at ${this.config.baseUrl}; using offline fallbacks`);
    return this.probe;
  }

  private async request(messages: LlmMessage[], maxTokens: number): Promise<string> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.2,
          max_tokens: maxTokens,
          messages,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("empty completion");
      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ask the LLM for JSON; fall back deterministically when unavailable. */
  async chatJson<T>(
    messages: LlmMessage[],
    fallback: () => T,
    maxTokens = 1200,
  ): Promise<LlmJsonResult<T>> {
    if (!(await this.available())) {
      return { value: fallback(), source: "offline-fallback" };
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const attemptMessages =
          attempt === 0
            ? messages
            : [
                ...messages,
                {
                  role: "user" as const,
                  content: "Your previous reply was invalid. Reply with ONE valid JSON object only.",
                },
              ];
        const raw = await this.request(attemptMessages, maxTokens);
        return { value: extractJson(raw) as T, source: "llm" };
      } catch (error) {
        if (attempt === 1) {
          const message = errorMessage(error);
          log.warn(`System 2 JSON call failed: ${message}`);
          return { value: fallback(), source: "offline-fallback", error: message };
        }
      }
    }
    return { value: fallback(), source: "offline-fallback" };
  }

  /** Free-form completion (research synthesis, plans); null when unavailable. */
  async chatText(messages: LlmMessage[], maxTokens = 1200): Promise<string | null> {
    if (!(await this.available())) return null;
    try {
      return await this.request(messages, maxTokens);
    } catch (error) {
      log.warn(`System 2 text call failed: ${errorMessage(error)}`);
      return null;
    }
  }
}
