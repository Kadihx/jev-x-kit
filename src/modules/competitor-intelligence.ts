/**
 * MODULE — Competitor Intelligence Matrix.
 *
 * Derives comparison dimensions with a System-2 hypothesis call and a
 * deterministic offline fallback (same pattern as jev-planner.ts /
 * jev-redteam.ts), then rates our product and every competitor on every
 * dimension in ONE batched Score fan-out and computes the per-cell gap.
 */

import { round } from "../core/text.js";
import { System2Client } from "../core/llm.js";
import type { JevBackend, ScoreResult } from "../core/types.js";
import type { CompetitorMatrixCell, CompetitorMatrixHighlight, CompetitorMatrixReport } from "../core/module-types.js";

export interface CompetitorIntelligenceDeps {
  backend: JevBackend;
  llm: System2Client;
}

interface DimensionsDraft {
  dimensions: string[];
}

const OFFLINE_DIMENSIONS = ["pricing", "onboarding", "integrations", "support", "performance", "security"];
const TOP_N = 5;

export class CompetitorIntelligence {
  constructor(private readonly deps: CompetitorIntelligenceDeps) {}

  async matrix(ourProductDescription: string, competitorTexts: Record<string, string>): Promise<CompetitorMatrixReport> {
    const started = Date.now();
    const competitors = Object.entries(competitorTexts);

    const drafted = await this.deps.llm.chatJson<DimensionsDraft>(
      [
        { role: "system", content: "You are a competitive-analysis analyst. Reply with one JSON object only." },
        {
          role: "user",
          content:
            `Our product:\n${ourProductDescription}\nCompetitors:\n` +
            competitors.map(([name, text]) => `${name}: ${text}`).join("\n") +
            `\nReply as {"dimensions": string[]} with 5-8 concrete SaaS comparison dimensions ` +
            `(e.g. pricing, onboarding, integrations, support, performance, security).`,
        },
      ],
      () => ({ dimensions: OFFLINE_DIMENSIONS }),
    );

    const dimensions = (drafted.value.dimensions.length ? drafted.value.dimensions : OFFLINE_DIMENSIONS).slice(0, 8);

    // Row 0 is our own product; the rest are competitors, in input order.
    const rows: Array<{ name: string; text: string }> = [
      { name: "__us__", text: ourProductDescription },
      ...competitors.map(([name, text]) => ({ name, text })),
    ];

    const requests = rows.flatMap((row) =>
      dimensions.map((dimension) => ({
        kind: "score" as const,
        question: `Rate this product on "${dimension}" (1 = very weak, 10 = best-in-class).`,
        min: 1,
        max: 10,
        state: `product: ${row.name}\ndescription: ${row.text}`,
      })),
    );
    const scores = (await this.deps.backend.batch(requests)) as ScoreResult[];

    const scoreGrid: ScoreResult[][] = rows.map((_, r) => dimensions.map((_, d) => scores[r * dimensions.length + d]!));
    const ourScores = scoreGrid[0]!;

    const cells: CompetitorMatrixCell[] = [];
    for (let r = 1; r < rows.length; r++) {
      const competitorName = rows[r]!.name;
      for (let d = 0; d < dimensions.length; d++) {
        const competitorScore = scoreGrid[r]![d]!;
        const ourScore = ourScores[d]!;
        cells.push({
          competitor: competitorName,
          dimension: dimensions[d]!,
          ourScore,
          competitorScore,
          gap: round(competitorScore.score - ourScore.score, 3),
        });
      }
    }

    const topGaps: CompetitorMatrixHighlight[] = [...cells]
      .sort((a, b) => b.gap - a.gap)
      .slice(0, TOP_N)
      .map((cell) => ({
        ...cell,
        reason: `${cell.competitor} scores ${cell.competitorScore.score}/10 on ${cell.dimension} vs our ${cell.ourScore.score}/10 — a ${Math.abs(cell.gap).toFixed(1)}pt gap to close`,
      }));
    const topAdvantages: CompetitorMatrixHighlight[] = [...cells]
      .sort((a, b) => a.gap - b.gap)
      .slice(0, TOP_N)
      .map((cell) => ({
        ...cell,
        reason: `We lead ${cell.competitor} on ${cell.dimension} by ${Math.abs(cell.gap).toFixed(1)}pt (${cell.ourScore.score}/10 vs ${cell.competitorScore.score}/10)`,
      }));

    return {
      dimensions,
      dimensionsSource: drafted.source === "llm" ? "llm" : "offline-fallback",
      ourProductDescription,
      matrix: {
        ourScores: dimensions.map((dimension, d) => ({ dimension, score: ourScores[d]! })),
        competitors: rows.slice(1).map((row, r) => ({
          competitor: row.name,
          scores: dimensions.map((dimension, d) => ({ dimension, score: scoreGrid[r + 1]![d]! })),
        })),
      },
      cells,
      topGaps,
      topAdvantages,
      latencyMs: Date.now() - started,
    };
  }
}
