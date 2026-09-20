/**
 * Configuration for the JEV Super Agent kit.
 *
 * Everything is environment-driven so the same build runs on Claude Code,
 * Cursor, Codex, OpenCode, Continue.dev, Ollama, vLLM or plain Node.
 * All defaults are 100% free / local friendly.
 */

import type { BackendProviderId, GatekeeperPolicy } from "./types.js";

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

export interface JevConfig {
  backendProvider: BackendProviderId;
  typesafe: {
    baseUrl: string;
    apiKey: string | undefined;
    model: string;
  };
  openjev: {
    baseUrl: string;
    apiKey: string | undefined;
    model: string;
  };
  laya: {
    baseUrl: string;
    model: string;
  };
  /** System-2 (autoregressive) LLM used by planner / red-team / researcher. */
  llm: {
    baseUrl: string;
    apiKey: string | undefined;
    model: string;
    timeoutMs: number;
    /** When false, modules run in deterministic offline mode instead of calling an LLM. */
    enabled: boolean;
  };
  policy: GatekeeperPolicy;
  memoryPath: string | undefined;
  concurrency: number;
  logLevel: "silent" | "error" | "warn" | "info" | "debug";
  /** Optional GitHub token for the miner (raises rate limits). */
  githubToken: string | undefined;
  /** Optional API keys for deep-research channels. */
  searchKeys: {
    brave: string | undefined;
    twitter: string | undefined;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): JevConfig {
  const provider = (env.JEV_BACKEND_PROVIDER ??
    "auto") as BackendProviderId;

  return {
    backendProvider: provider,
    typesafe: {
      // Vercel AI Gateway is OpenAI-compatible; direct TypeSafe API is the fallback default.
      baseUrl:
        env.TYPESAFE_JEV_BASE_URL ??
        (env.VERCEL_AI_GATEWAY_KEY
          ? "https://ai-gateway.vercel.sh/v1"
          : "https://api.typesafe.ai/v1"),
      apiKey: env.TYPESAFE_JEV_API_KEY ?? env.VERCEL_AI_GATEWAY_KEY,
      model: env.TYPESAFE_JEV_MODEL ?? "typesafe/jev",
    },
    openjev: {
      // razorback16/openjev: docker run --gpus all -p 8000:8000 razorback16/openjev
      baseUrl: env.OPENJEV_BASE_URL ?? "http://localhost:8000/v1",
      apiKey: env.OPENJEV_API_KEY,
      model: env.OPENJEV_MODEL ?? "openjev",
    },
    laya: {
      // NandhaKishorM/laya: python -m laya.serve --port 8000
      baseUrl: env.LAYA_BASE_URL ?? "http://localhost:8000/v1",
      model: env.LAYA_MODEL ?? "layalike",
    },
    llm: {
      // Ollama ships an OpenAI-compatible endpoint on /v1 by default.
      baseUrl: env.JEV_LLM_BASE_URL ?? "http://localhost:11434/v1",
      apiKey: env.JEV_LLM_API_KEY,
      model: env.JEV_LLM_MODEL ?? "qwen2.5:7b-instruct",
      timeoutMs: num(env.JEV_LLM_TIMEOUT_MS, 60_000),
      enabled: !bool(env.JEV_LLM_DISABLED, false),
    },
    policy: {
      executeThreshold: num(env.JEV_GATE_EXECUTE, 0.85),
      escalateThreshold: num(env.JEV_GATE_ESCALATE, 0.6),
    },
    memoryPath: env.JEV_MEMORY_PATH,
    concurrency: Math.max(1, num(env.JEV_CONCURRENCY, 8)),
    logLevel: (env.JEV_LOG_LEVEL ?? "warn") as JevConfig["logLevel"],
    githubToken: env.GITHUB_TOKEN,
    searchKeys: {
      brave: env.BRAVE_API_KEY,
      twitter: env.TWITTER_BEARER_TOKEN,
    },
  };
}
