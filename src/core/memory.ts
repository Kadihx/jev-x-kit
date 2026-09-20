/**
 * Arena-style self-improving memory + RLVR bookkeeping (module 8 storage).
 *
 * Persisted as `.jev-skill-memory.json` in the repo root (override with
 * JEV_MEMORY_PATH). The gatekeeper thresholds are auto-tuned from observed
 * outcomes: verified wins (+1) widen the "execute" zone, failures (-1) force
 * more System-2 escalation.
 */

import path from "node:path";
import type {
  CalibrationBucket,
  DecisionRoute,
  GatekeeperPolicy,
  SkillMemory,
} from "./types.js";
import { DEFAULT_GATEKEEPER_POLICY } from "./types.js";
import { findRepoRoot, readJsonFile, writeJsonAtomic } from "./paths.js";
import { clamp, round } from "./text.js";

const MAX_EVENTS = 500;

export const CALIBRATION_RANGES: Array<[number, number]> = [
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.85],
  [0.85, 0.9],
  [0.9, 0.95],
  [0.95, 1.0],
];

function emptyBuckets(): CalibrationBucket[] {
  return CALIBRATION_RANGES.map(([from, to]) => ({
    from,
    to,
    predictedAvg: round((from + to) / 2, 3),
    observedRate: 0,
    n: 0,
  }));
}

export function memoryFilePath(override?: string): string {
  return override ?? process.env.JEV_MEMORY_PATH ?? path.join(findRepoRoot(), ".jev-skill-memory.json");
}

export function defaultMemory(policy: GatekeeperPolicy = DEFAULT_GATEKEEPER_POLICY): SkillMemory {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    policy: { ...policy },
    stats: {
      decisions: 0,
      executed: 0,
      speculative: 0,
      escalated: 0,
      successes: 0,
      failures: 0,
      reward: 0,
    },
    calibration: emptyBuckets(),
    events: [],
  };
}

export function loadMemory(override?: string): SkillMemory {
  const file = memoryFilePath(override);
  const raw = readJsonFile<Partial<SkillMemory>>(file);
  if (!raw || raw.version !== 1) return defaultMemory();
  const base = defaultMemory();
  return {
    ...base,
    ...raw,
    policy: { ...base.policy, ...(raw.policy ?? {}) },
    stats: { ...base.stats, ...(raw.stats ?? {}) },
    calibration: raw.calibration?.length ? raw.calibration : base.calibration,
    events: raw.events ?? [],
  };
}

export function saveMemory(memory: SkillMemory, override?: string): SkillMemory {
  memory.updatedAt = new Date().toISOString();
  writeJsonAtomic(memoryFilePath(override), memory);
  return memory;
}

export function recordDecision(
  memory: SkillMemory,
  route: DecisionRoute,
  confidence: number,
  question?: string,
): SkillMemory {
  memory.stats.decisions++;
  if (route === "execute") memory.stats.executed++;
  else if (route === "speculative") memory.stats.speculative++;
  else memory.stats.escalated++;
  memory.events.push({
    at: new Date().toISOString(),
    kind: "decision",
    route,
    confidence: round(confidence, 4),
    question,
    detail: `route=${route} confidence=${round(confidence, 4)}`,
    reward: 0,
  });
  trimEvents(memory);
  return memory;
}

export interface OutcomeInput {
  passed: boolean;
  route?: DecisionRoute;
  confidence?: number;
  question?: string;
  detail: string;
}

/** RLVR reward: verified pass -> +1 (win), verified fail -> -1 (defeat). */
export function recordOutcome(memory: SkillMemory, input: OutcomeInput): SkillMemory {
  if (input.passed) memory.stats.successes++;
  else memory.stats.failures++;
  memory.stats.reward += input.passed ? 1 : -1;

  memory.events.push({
    at: new Date().toISOString(),
    kind: input.passed ? "success" : "failure",
    route: input.route,
    confidence: input.confidence,
    question: input.question,
    detail: input.detail,
    reward: input.passed ? 1 : -1,
  });
  trimEvents(memory);

  if (input.confidence !== undefined) {
    const confidence = input.confidence;
    const bucket = memory.calibration.find((b) => confidence >= b.from && confidence < b.to);
    if (bucket) {
      const wins = bucket.observedRate * bucket.n + (input.passed ? 1 : 0);
      bucket.n++;
      bucket.observedRate = round(wins / bucket.n, 4);
    }
  }
  return memory;
}

function trimEvents(memory: SkillMemory): void {
  if (memory.events.length > MAX_EVENTS) {
    memory.events = memory.events.slice(-MAX_EVENTS);
  }
}

/**
 * Dynamic threshold auto-tuner (module 10 feature #10).
 * Calibrated buckets that over-deliver let the gatekeeper execute more cheaply;
 * buckets that under-deliver force more escalation.
 */
export function optimizePolicy(memory: SkillMemory): {
  changed: boolean;
  reason: string;
  policy: GatekeeperPolicy;
} {
  const policy: GatekeeperPolicy = { ...memory.policy };
  const before = { ...policy };
  const reasons: string[] = [];

  for (const bucket of memory.calibration) {
    if (bucket.n < 5) continue;
    if (bucket.observedRate >= 0.9 && bucket.to <= policy.executeThreshold + 0.05) {
      const next = round(clamp(Math.min(policy.executeThreshold, bucket.from + 0.01), 0.6, 0.95), 2);
      if (next !== policy.executeThreshold) {
        reasons.push(
          `bucket [${bucket.from},${bucket.to}) over-delivers (${bucket.observedRate}, n=${bucket.n}) -> executeThreshold ${policy.executeThreshold} -> ${next}`,
        );
        policy.executeThreshold = next;
      }
    } else if (bucket.observedRate <= 0.7) {
      const next = round(clamp(policy.executeThreshold + 0.02, 0.6, 0.95), 2);
      if (next !== policy.executeThreshold) {
        reasons.push(
          `bucket [${bucket.from},${bucket.to}) under-delivers (${bucket.observedRate}, n=${bucket.n}) -> executeThreshold ${policy.executeThreshold} -> ${next}`,
        );
        policy.executeThreshold = next;
      }
    }
  }

  policy.escalateThreshold = round(
    clamp(Math.min(policy.escalateThreshold, policy.executeThreshold - 0.1), 0.4, 0.9),
    2,
  );

  const changed =
    policy.executeThreshold !== before.executeThreshold ||
    policy.escalateThreshold !== before.escalateThreshold;
  memory.policy = policy;
  return {
    changed,
    reason: reasons.join("; ") || "insufficient verified outcomes; policy unchanged",
    policy,
  };
}

export function recentFailures(memory: SkillMemory, limit = 5): string[] {
  return memory.events
    .filter((e) => e.kind === "failure")
    .slice(-limit)
    .reverse()
    .map((e) => `${e.at} ${e.question ?? ""} -> ${e.detail}`);
}

export function memorySummary(memory: SkillMemory): Record<string, unknown> {
  const verifiedTotal = memory.stats.successes + memory.stats.failures;
  return {
    updatedAt: memory.updatedAt,
    policy: memory.policy,
    stats: memory.stats,
    verifiedWinRate: verifiedTotal > 0 ? round(memory.stats.successes / verifiedTotal, 4) : null,
    calibration: memory.calibration,
    recentFailures: recentFailures(memory),
  };
}
