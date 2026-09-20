/**
 * MODULE — Gatekeeper calibration check.
 *
 * Answers the question the "BELKİ" gatekeeper's fixed thresholds (0.85 /
 * 0.60) never actually answer on their own: is claimed confidence *true*?
 * Feed it known-answer Choice cases; it buckets results by the same
 * thresholds the gatekeeper uses, compares claimed confidence to real
 * accuracy per bucket, and separately checks position bias (does the
 * answer change when option order is reversed, for the exact same
 * question and semantics).
 */

import type { ChoiceRequest, ChoiceResult, GatekeeperPolicy, JevBackend } from "../core/types.js";
import type { CalibrationBucket, CalibrationCase, CalibrationReport, OrderBiasExample } from "../core/module-types.js";

export interface CalibrationDeps {
  backend: JevBackend;
  policy: GatekeeperPolicy;
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export class CalibrationChecker {
  constructor(private readonly deps: CalibrationDeps) {}

  async check(cases: CalibrationCase[]): Promise<CalibrationReport> {
    if (cases.length === 0) throw new Error("cases must not be empty");

    const original = (await this.deps.backend.batch(
      cases.map(
        (c): ChoiceRequest => ({ kind: "choice", question: c.question, options: c.options, state: c.state }),
      ),
    )) as ChoiceResult[];

    const reversed = (await this.deps.backend.batch(
      cases.map(
        (c): ChoiceRequest => ({
          kind: "choice",
          question: c.question,
          options: [...c.options].reverse(),
          state: c.state,
        }),
      ),
    )) as ChoiceResult[];

    const records = cases.map((c, i) => ({
      case: c,
      result: original[i]!,
      correct: original[i]!.selectedIndex === c.correctIndex,
    }));

    const { executeThreshold, escalateThreshold } = this.deps.policy;
    const bucketDefs: Array<{ label: string; test: (confidence: number) => boolean }> = [
      { label: `< ${escalateThreshold} (system2 zone)`, test: (c) => c < escalateThreshold },
      { label: `${escalateThreshold}–${executeThreshold} (BELKİ / speculative zone)`, test: (c) => c >= escalateThreshold && c < executeThreshold },
      { label: `>= ${executeThreshold} (execute zone)`, test: (c) => c >= executeThreshold },
    ];

    const buckets: CalibrationBucket[] = bucketDefs.map((def) => {
      const inBucket = records.filter((r) => def.test(r.result.confidence));
      const avgConfidence = inBucket.length ? inBucket.reduce((s, r) => s + r.result.confidence, 0) / inBucket.length : 0;
      const accuracy = inBucket.length ? inBucket.filter((r) => r.correct).length / inBucket.length : 0;
      return {
        range: def.label,
        count: inBucket.length,
        avgConfidence: round4(avgConfidence),
        accuracy: round4(accuracy),
        calibrationGap: round4(avgConfidence - accuracy),
      };
    });

    const orderExamples: Array<OrderBiasExample & { flipped: boolean }> = cases.map((c, i) => ({
      question: c.question,
      originalSelected: original[i]!.selected,
      reversedSelected: reversed[i]!.selected,
      flipped: original[i]!.selected !== reversed[i]!.selected,
    }));
    const flippedCount = orderExamples.filter((e) => e.flipped).length;

    const overallAccuracy = round4(records.filter((r) => r.correct).length / records.length);
    const populated = buckets.filter((b) => b.count > 0);
    const worstGap = populated.length
      ? populated.reduce((a, b) => (Math.abs(b.calibrationGap) > Math.abs(a.calibrationGap) ? b : a))
      : null;

    let recommendation: string;
    if (!worstGap || Math.abs(worstGap.calibrationGap) < 0.05) {
      recommendation = worstGap
        ? `Well calibrated — worst bucket gap is only ${worstGap.calibrationGap} in "${worstGap.range}". No threshold change recommended.`
        : "No populated buckets to judge.";
    } else if (worstGap.calibrationGap > 0) {
      recommendation =
        `Overconfident in "${worstGap.range}": claims ${worstGap.avgConfidence} average confidence but only ` +
        `${worstGap.accuracy} accuracy. Consider raising executeThreshold so this zone escalates instead of executing.`;
    } else {
      recommendation =
        `Underconfident in "${worstGap.range}": claims ${worstGap.avgConfidence} average confidence but achieves ` +
        `${worstGap.accuracy} accuracy. Consider lowering executeThreshold to execute more often at this confidence level.`;
    }
    if (flippedCount > 0) {
      recommendation += ` Position bias detected: ${flippedCount}/${cases.length} cases changed their answer purely from reversing option order.`;
    }

    return {
      totalCases: cases.length,
      overallAccuracy,
      buckets,
      orderBias: {
        testedCases: cases.length,
        flippedCount,
        flipRate: round4(flippedCount / cases.length),
        examples: orderExamples.filter((e) => e.flipped).slice(0, 5).map(({ question, originalSelected, reversedSelected }) => ({ question, originalSelected, reversedSelected })),
      },
      recommendation,
      backend: original[0]?.backend ?? "unknown",
    };
  }
}
