/**
 * MODULE 2 — Ultra-Planning & Spec Engine.
 *
 * Sonnet-class hypothesis + anti-thesis generation, arbitrated by the Jev
 * fan-out loop on four dimensions (feasibility, risk, cost, maintainability).
 * Offline fallbacks keep the planner useful without any LLM at all.
 */

import { fanOut } from "../core/fanout.js";
import { System2Client } from "../core/llm.js";
import { presetStateLines, loadPreset } from "../core/presets.js";
import { round } from "../core/text.js";
import type { JevBackend, NoulResult, ScoreResult } from "../core/types.js";
import type { PlanArtifact, PlanTask } from "../core/module-types.js";

export interface PlannerDeps {
  backend: JevBackend;
  llm: System2Client;
  preset?: string;
  concurrency?: number;
}

interface HypothesisDraft {
  architecture: string[];
  tasks: Array<{ title: string; detail?: string; estimate?: "S" | "M" | "L"; acceptance?: string[] }>;
}

interface AntiThesisDraft {
  failureModes: string[];
}

const OFFLINE_ARCHITECTURE = [
  "Thin transport layer (MCP tool) over a pure, dependency-light decision core.",
  "Type-safe schemas at every boundary; the model never emits unvalidated fields.",
  "Offline-first defaults: every external dependency has a deterministic fallback.",
  "Fan-out batching so N independent questions cost one round trip.",
  "Feature-flagged rollout with a one-commit rollback path.",
];

const OFFLINE_FAILURE_MODES = [
  "Race condition when two agents mutate the same state concurrently.",
  "Silent schema drift between the decision layer and its consumers.",
  "Cost blow-up when the escalation path is triggered for trivial questions.",
  "Operational blind spot: no verification command proves the feature works.",
  "Rollback path missing, so a bad release cannot be reverted quickly.",
];

function offlineTasks(goal: string): PlanTask[] {
  const base: Array<[string, string, "S" | "M" | "L"]> = [
    ["Spike & constraints", `Reduce "${goal}" to measurable constraints and a smallest viable slice.`, "S"],
    ["Decision layer wiring", "Implement Choice/Score/Noul calls with schema validation and offline fallback.", "M"],
    ["Integration & fan-out", "Batch independent evaluations; keep one round trip for the hot path.", "M"],
    ["Verification", "Wire tsc + tests as the verifiable reward (RLVR) for this feature.", "S"],
    ["Rollout & rollback", "Feature flag the change; document the one-command rollback.", "S"],
  ];
  return base.map(([title, detail, estimate], i) => ({
    id: `T${i + 1}`,
    title,
    detail,
    dependsOn: i === 0 ? [] : [`T${i}`],
    acceptance: [`"${title}" demonstrably done`, "typecheck + tests green after the step"],
    estimate,
  }));
}

export class JevPlanner {
  constructor(private readonly deps: PlannerDeps) {}

  async plan(goal: string, opts: { context?: string[]; preset?: string } = {}): Promise<PlanArtifact> {
    const started = Date.now();
    const presetId = opts.preset ?? this.deps.preset;
    const presetLines = presetId ? presetStateLines(presetId, 14) : [];
    const preset = presetId ? loadPreset(presetId) : null;
    const contextBlock = (opts.context ?? []).slice(0, 40).join("\n");

    // 1) Hypothesis (System 2) with offline fallback.
    const hypothesis = await this.deps.llm.chatJson<HypothesisDraft>(
      [
        { role: "system", content: "You are a staff engineer. Reply with one JSON object only." },
        {
          role: "user",
          content:
            `Goal: ${goal}\nContext (verbatim):\n${contextBlock}\nPreset rules:\n${presetLines.join("\n")}\n` +
            `Reply as {"architecture": string[], "tasks":[{"title":string,"detail":string,"estimate":"S"|"M"|"L","acceptance":string[]}]} with 3-6 architecture bullets and 3-6 tasks.`,
        },
      ],
      () => ({ architecture: OFFLINE_ARCHITECTURE, tasks: offlineTasks(goal) }),
    );

    // 2) Anti-thesis generator.
    const antiThesis = await this.deps.llm.chatJson<AntiThesisDraft>(
      [
        { role: "system", content: "You are a hostile reviewer. Reply with one JSON object only." },
        {
          role: "user",
          content:
            `Plan goal: ${goal}\nProposed architecture:\n${hypothesis.value.architecture.join("\n")}\n` +
            `Preset red flags:\n${(preset?.redFlags ?? []).join("\n")}\n` +
            `Reply as {"failureModes": string[]} with 3-5 concrete ways this plan fails in production.`,
        },
      ],
      () => ({
        failureModes: [...(preset?.redFlags ?? []).slice(0, 3), ...OFFLINE_FAILURE_MODES].slice(0, 5),
      }),
    );

    const state = [
      `goal: ${goal}`,
      ...hypothesis.value.architecture.map((a) => `arch: ${a}`),
      ...presetLines,
    ].join("\n");
    const riskState = [
      `goal: ${goal}`,
      ...antiThesis.value.failureModes.map((f) => `failure-mode: ${f}`),
    ].join("\n");

    // 3) Four-dimension Jev loop (one fan-out pass).
    const { results, stats } = await fanOut<ScoreResult | NoulResult>(
      [
        () =>
          this.deps.backend.score({
            kind: "score",
            question: `Feasibility of building this in one increment: ${goal}`,
            state,
          }),
        () =>
          this.deps.backend.noul({
            kind: "noul",
            question: `Will this plan hit a production failure? ${goal}`,
            state: riskState,
          }),
        () =>
          this.deps.backend.score({
            kind: "score",
            question: `Cost efficiency of this plan under free/local constraints: ${goal}`,
            state,
          }),
        () =>
          this.deps.backend.score({
            kind: "score",
            question: `Maintainability of the resulting architecture after 6 months: ${goal}`,
            state,
          }),
      ],
      this.deps.concurrency ?? 8,
    );

    const scoreResults = results.filter((r): r is ScoreResult => r.kind === "score");
    const risk = results.find((r): r is NoulResult => r.kind === "noul");
    const feasibility = scoreResults[0];
    const cost = scoreResults[1];
    const maintainability = scoreResults[2];
    if (!risk || !feasibility || !cost || !maintainability) {
      throw new Error("planner fan-out returned an incomplete dimension set");
    }

    // 4) Risk register fan-out (cap 4 failure modes).
    const riskModes = antiThesis.value.failureModes.slice(0, 4);
    const riskNouls = (await this.deps.backend.batch(
      riskModes.map((mode) => ({
        kind: "noul" as const,
        question: `Is this a realistic risk here: ${mode}`,
        state,
      })),
    )) as NoulResult[];

    // 5) Composite verdict.
    const composite = round(
      (feasibility.score / 10) * 0.35 +
        (1 - risk.probability) * 0.3 +
        (cost.score / 10) * 0.15 +
        (maintainability.score / 10) * 0.2,
      3,
    );
    const confidence = round(Math.min(feasibility.confidence, maintainability.confidence), 3);
    const go = composite >= 0.6 && risk.probability <= 0.6;

    const tasks: PlanTask[] = (hypothesis.value.tasks.length
      ? hypothesis.value.tasks
      : offlineTasks(goal)
    )
      .slice(0, 8)
      .map((task, i) => ({
        id: `T${i + 1}`,
        title: task.title,
        detail: task.detail ?? task.title,
        dependsOn: i === 0 ? [] : [`T${i}`],
        acceptance: task.acceptance ?? [`"${task.title}" verified by tests or explicit manual check`],
        estimate: task.estimate ?? "M",
      }));

    const costUsd = round(
      results.reduce((sum, r) => sum + r.usage.costUsd, 0),
      6,
    );

    return {
      goal,
      preset: presetId ?? null,
      hypothesis: {
        source: hypothesis.source === "llm" ? "llm" : "offline-fallback",
        architecture: hypothesis.value.architecture.slice(0, 8),
      },
      antiThesis: {
        source: antiThesis.source === "llm" ? "llm" : "offline-fallback",
        failureModes: antiThesis.value.failureModes.slice(0, 8),
      },
      dimensions: { feasibility, risk, cost, maintainability },
      verdict: {
        go,
        compositeScore: composite,
        confidence,
        rationale:
          `feasibility=${feasibility.score}/10, failure-probability=${risk.probability}, ` +
          `cost=${cost.score}/10, maintainability=${maintainability.score}/10 -> composite ${composite} ` +
          `(${stats.count} parallel Jev evaluations in ${stats.wallMs}ms)`,
      },
      tasks,
      riskRegister: riskModes.map((mode, i) => ({
        risk: mode,
        likelihood: riskNouls[i] as NoulResult,
        mitigation: `Add a verification or containment step for: ${mode}`,
      })),
      totalLatencyMs: Date.now() - started,
      estimatedCostUsd: costUsd,
    };
  }
}
