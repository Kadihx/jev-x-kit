/**
 * MODULE 8 — Arena-style Self-Improving Memory & RLVR Loop.
 *
 * Verifiable reward: `tsc`/`npm test` pass -> +1, fail -> -1. Outcomes update
 * the calibration buckets and the gatekeeper thresholds get auto-tuned, so the
 * system provably gets cheaper (more direct execution) as it proves itself.
 */

import { exec } from "node:child_process";
import { log } from "../core/log.js";
import {
  loadMemory,
  memorySummary,
  optimizePolicy,
  recordOutcome,
  saveMemory,
} from "../core/memory.js";
import { round } from "../core/text.js";
import type { DecisionRoute } from "../core/types.js";
import type { VerificationCommandResult, VerificationResult } from "../core/module-types.js";

export interface SelfImproverDeps {
  memoryPath?: string;
  defaultTimeoutMs?: number;
}

export interface VerifyOptions {
  cwd?: string;
  timeoutMs?: number;
  route?: DecisionRoute;
  confidence?: number;
  question?: string;
}

const DEFAULT_COMMANDS = ["npx tsc --noEmit", "npm test"];

async function runCommand(command: string, cwd: string, timeoutMs: number): Promise<VerificationCommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ""}${stderr ?? ""}`;
        resolve({
          command,
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          durationMs: Date.now() - started,
          tail: output.slice(-800),
        });
      },
    );
  });
}

export class SelfImprover {
  constructor(private readonly deps: SelfImproverDeps = {}) {}

  /** RLVR: run verification commands, record the reward, re-tune thresholds. */
  async verify(commands: string[] = DEFAULT_COMMANDS, opts: VerifyOptions = {}): Promise<VerificationResult> {
    const cwd = opts.cwd ?? process.cwd();
    const timeoutMs = opts.timeoutMs ?? this.deps.defaultTimeoutMs ?? 180_000;

    const results: VerificationCommandResult[] = [];
    for (const command of commands) {
      const result = await runCommand(command, cwd, timeoutMs);
      results.push(result);
      if (result.exitCode !== 0) break; // stop at first failure, keep it cheap
    }
    const passed = results.every((r) => r.exitCode === 0) && results.length > 0;

    const memory = loadMemory(this.deps.memoryPath);
    const before = { ...memory.policy };
    recordOutcome(memory, {
      passed,
      route: opts.route,
      confidence: opts.confidence,
      question: opts.question ?? `verify: ${commands.join(" && ")}`,
      detail: results.map((r) => `${r.command} -> exit ${r.exitCode} (${r.durationMs}ms)`).join("; "),
    });
    const update = optimizePolicy(memory);
    saveMemory(memory, this.deps.memoryPath);
    if (update.changed) {
      log.info(`policy auto-tuned: ${JSON.stringify(update.policy)} (${update.reason})`);
    }

    return {
      cwd,
      passed,
      reward: passed ? 1 : -1,
      commands: results,
      policyUpdate: {
        before,
        after: update.policy,
        changed: update.changed,
        reason: update.reason,
      },
    };
  }

  /** Manual outcome recording (e.g. user approved / rejected a dispatched action). */
  record(passed: boolean, opts: VerifyOptions & { detail?: string } = {}): Record<string, unknown> {
    const memory = loadMemory(this.deps.memoryPath);
    recordOutcome(memory, {
      passed,
      route: opts.route,
      confidence: opts.confidence,
      question: opts.question,
      detail: opts.detail ?? (passed ? "user approved" : "user rejected"),
    });
    const update = optimizePolicy(memory);
    saveMemory(memory, this.deps.memoryPath);
    return {
      recorded: passed ? "success(+1)" : "failure(-1)",
      policy: update.policy,
      changed: update.changed,
      reason: update.reason,
    };
  }

  /** Re-tune thresholds from stored calibration only. */
  optimize(): Record<string, unknown> {
    const memory = loadMemory(this.deps.memoryPath);
    const update = optimizePolicy(memory);
    saveMemory(memory, this.deps.memoryPath);
    return { ...update, updatedAt: memory.updatedAt };
  }

  report(): Record<string, unknown> {
    const memory = loadMemory(this.deps.memoryPath);
    return { memoryPath: this.deps.memoryPath ?? "(default)", ...memorySummary(memory) };
  }

  /** Compact state block injected into evaluator calls (regression avoidance). */
  stateBlock(limit = 5): string {
    const memory = loadMemory(this.deps.memoryPath);
    const failures = memory.events
      .filter((e) => e.kind === "failure")
      .slice(-limit)
      .map((e) => `prior-failure: ${e.question ?? "?"} (${e.detail.slice(0, 120)})`);
    return [
      `policy: execute>${memory.policy.executeThreshold} speculative>=${memory.policy.escalateThreshold}`,
      `reward: ${memory.stats.reward} (wins ${memory.stats.successes} / losses ${memory.stats.failures})`,
      ...failures,
    ].join("\n");
  }

  stats(): { reward: number; winRate: number | null } {
    const memory = loadMemory(this.deps.memoryPath);
    const total = memory.stats.successes + memory.stats.failures;
    return {
      reward: memory.stats.reward,
      winRate: total > 0 ? round(memory.stats.successes / total, 4) : null,
    };
  }
}
