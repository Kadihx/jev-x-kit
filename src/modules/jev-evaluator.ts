/**
 * MODULE 1 — Jev Multi-Primitive Fan-Out Evaluator.
 *
 * One pass, three primitives, parallel fan-out: Choice (up to 255 options),
 * Score (fractional ordered scale) and Noul (calibrated probability).
 * Adds the "BELKİ" gatekeeper routing and optional memory recording.
 */

import { evaluateWithGate, type GateOutcome } from "../core/gatekeeper.js";
import { fanOut, type FanOutStats } from "../core/fanout.js";
import { loadMemory, recordDecision, saveMemory } from "../core/memory.js";
import { CHOICE_MAX_OPTIONS } from "../core/types.js";
import type {
  ChoiceResult,
  GatekeeperDecision,
  GatekeeperPolicy,
  JevBackend,
  JevRequest,
  JevResult,
} from "../core/types.js";

export interface EvaluatorDeps {
  backend: JevBackend;
  policy: GatekeeperPolicy;
  memoryPath?: string;
  concurrency?: number;
}

export interface BatchEvaluation {
  results: JevResult[];
  stats: FanOutStats;
  /** Sum of USD cost estimates for the whole batch (0 on local/heuristic). */
  costUsd: number;
  /** True when any result came from the deterministic simulator. */
  degraded: boolean;
}

export interface DecisionOutcome extends GateOutcome {
  memoryRecorded: boolean;
  policyUsed: GatekeeperPolicy;
}

export function validateRequest(request: JevRequest): void {
  if (!request.question || request.question.trim().length === 0) {
    throw new Error("question must be a non-empty string");
  }
  if (request.kind === "choice") {
    if (request.options.length === 0) throw new Error("choice requires at least one option");
    if (request.options.length > CHOICE_MAX_OPTIONS) {
      throw new Error(`choice supports at most ${CHOICE_MAX_OPTIONS} options (got ${request.options.length})`);
    }
  }
}

export class JevEvaluator {
  constructor(private readonly deps: EvaluatorDeps) {}

  /** Speculative batching: N questions, one parallel pass. */
  async evaluate(requests: JevRequest[]): Promise<BatchEvaluation> {
    if (requests.length === 0) throw new Error("requests must not be empty");
    for (const request of requests) validateRequest(request);

    const { results, stats } = await fanOut(
      requests.map((request) => () => this.dispatch(request)),
      this.deps.concurrency ?? 8,
    );

    return {
      results,
      stats,
      costUsd: round6(results.reduce((sum, r) => sum + r.usage.costUsd, 0)),
      degraded: results.some((r) => r.synthetic),
    };
  }

  /** Single decision through the "BELKİ" gatekeeper (execute / speculative / system2). */
  async decide(
    question: string,
    options: string[],
    opts: { state?: string; policy?: GatekeeperPolicy; persist?: boolean } = {},
  ): Promise<DecisionOutcome> {
    const policy = opts.policy ?? this.loadPolicy();
    const outcome = await evaluateWithGate(this.deps.backend, {
      kind: "choice",
      question,
      options,
      state: opts.state,
      policy,
    });

    let memoryRecorded = false;
    if (opts.persist !== false) {
      const memory = loadMemory(this.deps.memoryPath);
      recordDecision(memory, outcome.decision.route, outcome.primary.confidence, question);
      saveMemory(memory, this.deps.memoryPath);
      memoryRecorded = true;
    }

    return { ...outcome, memoryRecorded, policyUsed: policy };
  }

  /** Tuned policy from verified outcomes (falls back to configured defaults). */
  loadPolicy(): GatekeeperPolicy {
    const memory = loadMemory(this.deps.memoryPath);
    return {
      executeThreshold: memory.policy.executeThreshold ?? this.deps.policy.executeThreshold,
      escalateThreshold: memory.policy.escalateThreshold ?? this.deps.policy.escalateThreshold,
    };
  }

  private async dispatch(request: JevRequest): Promise<JevResult> {
    switch (request.kind) {
      case "choice":
        return this.deps.backend.choice(request);
      case "score":
        return this.deps.backend.score(request);
      case "noul":
        return this.deps.backend.noul(request);
    }
  }
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Convenience: route a single confidence value through the configured policy. */
export type { GatekeeperDecision, ChoiceResult };
