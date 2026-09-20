/**
 * Backend resolver.
 *
 * `auto` walks the free-first chain: TypeSafe Jev (if a key exists) ->
 * OpenJev local (vLLM) -> LayA local -> deterministic heuristic simulator.
 * Whatever happens, the kit always returns valid primitives: if a real backend
 * fails or violates the schema, calls transparently fall back to the simulator
 * and the degradation is reported in `notes` + on every result (`synthetic`).
 */

import { loadConfig, type JevConfig } from "../config.js";
import { errorMessage } from "../errors.js";
import { log } from "../log.js";
import type {
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
import { ChatCompatibleBackend } from "./chat-compatible.js";
import { HeuristicBackend } from "./heuristic.js";
import { NativeJevBackend } from "./typesafe-native.js";

/** Wraps a primary backend with the simulator as a guaranteed fallback. */
export class ResilientBackend implements JevBackend {
  readonly notes: string[] = [];
  private failures = 0;

  constructor(
    private readonly primary: JevBackend | null,
    private readonly fallback: JevBackend,
  ) {}

  get meta() {
    return (this.primary && this.failures < 3 ? this.primary : this.fallback).meta;
  }

  private async call<T>(fn: (backend: JevBackend) => Promise<T>): Promise<T> {
    if (this.primary && this.failures < 3) {
      try {
        return await fn(this.primary);
      } catch (error) {
        this.failures++;
        const note = `[${this.primary.meta.id}] ${errorMessage(error)} -> falling back to ${this.fallback.meta.id}`;
        if (this.notes.length < 20) this.notes.push(note);
        log.warn(note);
      }
    }
    return fn(this.fallback);
  }

  async health(): Promise<boolean> {
    if (this.primary) {
      try {
        if (await this.primary.health()) return true;
      } catch {
        /* fall through */
      }
    }
    return this.fallback.health();
  }

  choice(req: ChoiceRequest): Promise<ChoiceResult> {
    return this.call((b) => b.choice(req));
  }

  score(req: ScoreRequest): Promise<ScoreResult> {
    return this.call((b) => b.score(req));
  }

  noul(req: NoulRequest): Promise<NoulResult> {
    return this.call((b) => b.noul(req));
  }

  batch(requests: JevRequest[]): Promise<JevResult[]> {
    return this.call((b) => b.batch(requests));
  }
}

export interface ResolvedBackend {
  backend: JevBackend;
  /** Human-readable resolution trace for `jev_backend_info`. */
  chain: string[];
}


function buildTypesafe(config: JevConfig, concurrency: number): JevBackend | null {
  if (!config.typesafe.apiKey) return null;
  const native = process.env.TYPESAFE_JEV_NATIVE === "1";
  if (native) {
    return new NativeJevBackend({
      baseUrl: config.typesafe.baseUrl,
      apiKey: config.typesafe.apiKey,
      model: config.typesafe.model,
      concurrency,
    });
  }
  return new ChatCompatibleBackend({
    id: "typesafe_jev",
    label: `TypeSafe Jev via gateway (${config.typesafe.baseUrl})`,
    baseUrl: config.typesafe.baseUrl,
    apiKey: config.typesafe.apiKey,
    model: config.typesafe.model,
    // $0.042 / 1M input tokens, zero output tokens (blueprint §1.B).
    pricePerMillionUsd: 0.042,
    local: false,
    timeoutMs: 6000,
    concurrency,
  });
}

function buildOpenJev(config: JevConfig, concurrency: number): JevBackend {
  return new ChatCompatibleBackend({
    id: "openjev_local",
    label: `OpenJev local vLLM (${config.openjev.baseUrl})`,
    baseUrl: config.openjev.baseUrl,
    apiKey: config.openjev.apiKey,
    model: config.openjev.model,
    pricePerMillionUsd: 0,
    local: true,
    extra: { chat_template_kwargs: { enable_thinking: false } },
    concurrency,
  });
}

function buildLaya(config: JevConfig, concurrency: number): JevBackend {
  return new ChatCompatibleBackend({
    id: "laya_local",
    label: `LayA local ModernBERT head (${config.laya.baseUrl})`,
    baseUrl: config.laya.baseUrl,
    model: config.laya.model,
    pricePerMillionUsd: 0,
    local: true,
    concurrency,
  });
}

export async function resolveBackend(config: JevConfig = loadConfig()): Promise<ResolvedBackend> {
  const heuristic = new HeuristicBackend();
  const chain: string[] = [];
  const { backendProvider, concurrency } = config;

  if (backendProvider === "heuristic") {
    return { backend: heuristic, chain: ["heuristic (explicit)"] };
  }

  if (backendProvider === "typesafe_jev") {
    const typesafe = buildTypesafe(config, concurrency);
    if (!typesafe) {
      chain.push("typesafe_jev skipped: no TYPESAFE_JEV_API_KEY / VERCEL_AI_GATEWAY_KEY");
      return { backend: new ResilientBackend(null, heuristic), chain };
    }
    chain.push(`typesafe_jev @ ${config.typesafe.baseUrl}`);
    return { backend: new ResilientBackend(typesafe, heuristic), chain };
  }

  if (backendProvider === "openjev_local") {
    const openjev = buildOpenJev(config, concurrency);
    chain.push(`openjev_local @ ${config.openjev.baseUrl}`);
    return { backend: new ResilientBackend(openjev, heuristic), chain };
  }

  if (backendProvider === "laya_local") {
    const laya = buildLaya(config, concurrency);
    chain.push(`laya_local @ ${config.laya.baseUrl}`);
    return { backend: new ResilientBackend(laya, heuristic), chain };
  }

  // auto: probe the free/local chain in order, first healthy backend wins.
  const typesafe = buildTypesafe(config, concurrency);
  if (typesafe) chain.push(`typesafe_jev @ ${config.typesafe.baseUrl} (probe)`);
  const openjev = buildOpenJev(config, concurrency);
  chain.push(`openjev_local @ ${config.openjev.baseUrl} (probe)`);
  const laya = buildLaya(config, concurrency);
  chain.push(`laya_local @ ${config.laya.baseUrl} (probe)`);

  for (const candidate of [typesafe, openjev, laya]) {
    if (!candidate) continue;
    const healthy = await candidate.health();
    if (healthy) {
      chain.push(`selected: ${candidate.meta.id}`);
      return { backend: new ResilientBackend(candidate, heuristic), chain };
    }
    chain.push(`${candidate.meta.id}: unreachable, skipping`);
  }

  chain.push("selected: heuristic (offline deterministic simulator)");
  return { backend: heuristic, chain };
}
