/**
 * MODULE 3 — Adversarial Red-Teaming Dual Loop.
 *
 * A hostile reviewer generates anti-theses against the thesis; the Jev loop
 * then scores both sides and arbitrates (Choice + Score + Noul). The output
 * is a steeled verdict with residual risks and concrete mitigations.
 */

import { fanOut } from "../core/fanout.js";
import { System2Client } from "../core/llm.js";
import { round } from "../core/text.js";
import type { ChoiceResult, JevBackend, NoulResult, ScoreResult } from "../core/types.js";
import type { RedTeamReport } from "../core/module-types.js";

export interface RedTeamDeps {
  backend: JevBackend;
  llm: System2Client;
  concurrency?: number;
}

const OFFLINE_ANTI_THESES = [
  "The proposal relies on an external service that becomes unavailable at peak load.",
  "Concurrent writers create a race condition on shared state.",
  "The happy path is verified but the failure path silently corrupts data.",
  "Inference or infrastructure cost scales faster than the value delivered.",
  "There is no rollback path once the change reaches production.",
  "Licensing or compliance constraints invalidate the approach.",
];

interface AntiThesisDraft {
  antiTheses: string[];
}

export class JevRedTeam {
  constructor(private readonly deps: RedTeamDeps) {}

  async review(
    thesis: string,
    opts: { context?: string[]; maxAntiTheses?: number } = {},
  ): Promise<RedTeamReport> {
    const started = Date.now();
    const max = Math.min(opts.maxAntiTheses ?? 4, 8);
    const contextBlock = (opts.context ?? []).slice(0, 30).join("\n");

    // 1) Red-team generation (System 2 with deterministic offline fallback).
    const generated = await this.deps.llm.chatJson<AntiThesisDraft>(
      [
        { role: "system", content: "You are a red-team lead. Reply with one JSON object only." },
        {
          role: "user",
          content:
            `Thesis: ${thesis}\nContext (verbatim):\n${contextBlock}\n` +
            `Reply as {"antiTheses": string[]} with ${max} concrete, falsifiable ways this thesis fails. ` +
            `No generic advice; each item must name a mechanism and a trigger.`,
        },
      ],
      () => ({ antiTheses: OFFLINE_ANTI_THESES.slice(0, max) }),
    );

    const antiTheses = generated.value.antiTheses
      .filter((a) => typeof a === "string" && a.trim().length > 0)
      .slice(0, max)
      .map((statement, i) => ({ id: `A${i + 1}`, statement: statement.trim() }));

    // 2) Severity (Noul) + evidence strength (Score) in one fan-out pass.
    const { results } = await fanOut<ScoreResult | NoulResult>(
      [
        ...antiTheses.map((a) => () =>
          this.deps.backend.noul({
            kind: "noul" as const,
            question: `Is this anti-thesis a serious risk for the thesis "${thesis}"?`,
            state: `anti-thesis: ${a.statement}\n${contextBlock}`,
          }),
        ),
        ...antiTheses.map((a) => () =>
          this.deps.backend.score({
            kind: "score" as const,
            question: `Evidence strength for the anti-thesis against "${thesis}"`,
            state: `anti-thesis: ${a.statement}\n${contextBlock}`,
          }),
        ),
      ],
      this.deps.concurrency ?? 8,
    );

    const severities = results.filter((r): r is NoulResult => r.kind === "noul");
    const evidence = results.filter((r): r is ScoreResult => r.kind === "score");

    // 3) Arbitration between thesis and the strongest anti-thesis.
    const strongestIndex = severities.reduce(
      (best, s, i) => (s.probability > severities[best]!.probability ? i : best),
      0,
    );
    const arbitration: ChoiceResult = await this.deps.backend.choice({
      kind: "choice",
      question: `Which route is safest and most sustainable for: ${thesis}`,
      options: [
        "proceed with thesis as-is",
        "reject: adopt the anti-thesis",
        "proceed only with explicit mitigations",
      ],
      state: [
        `thesis: ${thesis}`,
        `strongest anti-thesis (${severities[strongestIndex]?.probability}): ${antiTheses[strongestIndex]?.statement ?? ""}`,
        ...antiTheses.map(
          (a, i) => `anti-thesis ${a.id}: severity=${severities[i]?.probability} evidence=${evidence[i]?.score}/10 ${a.statement}`,
        ),
        contextBlock,
      ].join("\n"),
    });

    const residualRisks = antiTheses
      .filter((_, i) => (severities[i]?.probability ?? 0) >= 0.5)
      .map((a) => a.statement);
    const mitigations =
      residualRisks.length > 0
        ? residualRisks.map((risk) => `Add a guard, test or fallback specifically covering: ${risk}`)
        : ["No residual risk above the 0.5 threshold; keep the verification command green."];

    return {
      thesis,
      antiTheses: antiTheses.map((a, i) => ({
        id: a.id,
        statement: a.statement,
        severity: severities[i] as NoulResult,
      })),
      arbitration,
      winner: arbitration.selectedIndex === 1 ? "anti-thesis" : "thesis",
      scoreboard: antiTheses.map((a, i) => ({
        id: a.id,
        statement: a.statement,
        score: evidence[i] as ScoreResult,
      })),
      residualRisks,
      mitigations,
      latencyMs: Date.now() - started,
    };
  }
}
