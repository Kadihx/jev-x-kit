/**
 * Hermetic unit test for MediaJudge — fake backend only, no network.
 */

import test from "node:test";
import assert from "node:assert/strict";

const { MediaJudge } = await import("../dist/modules/jev-media-judge.js");

const baseFields = { latencyMs: 0, usage: { inputTokens: 0, costUsd: 0, pricePerMillionUsd: 0 }, schemaValid: true, synthetic: true, backend: "fake" };

function fakeBackend({ score = () => 5, choice = () => 0 } = {}) {
  return {
    meta: { id: "fake", label: "fake", pricePerMillionUsd: 0, outputTokenCostUsd: 0, local: true, synthetic: true },
    health: async () => true,
    choice: async () => { throw new Error("not used"); },
    score: async () => { throw new Error("not used"); },
    noul: async () => { throw new Error("not used"); },
    batch: async (requests) =>
      requests.map((r, i) => {
        if (r.kind === "score") {
          const value = score(r, i);
          return { id: String(i), kind: "score", question: r.question, min: r.min ?? 1, max: r.max ?? 10, score: value, confidence: 0.9, signals: [], ...baseFields };
        }
        const selectedIndex = choice(r, i);
        const probabilities = r.options.map((_, oi) => (oi === selectedIndex ? 0.9 : 0.1 / Math.max(1, r.options.length - 1)));
        return { id: String(i), kind: "choice", question: r.question, options: r.options, selectedIndex, selected: r.options[selectedIndex], probabilities, confidence: probabilities[selectedIndex], ...baseFields };
      }),
  };
}

test("MediaJudge: judges a text description with Choice + Score, never sees media itself", async () => {
  const backend = fakeBackend({ choice: () => 0, score: () => 8.5 }); // "good"
  const judge = new MediaJudge({ backend });
  const result = await judge.judge(
    "CS2 clip review",
    "Player clears the site methodically, checks corners, wins the 1v1 clutch with good crosshair placement.",
  );

  assert.equal(result.rating.selected, "good");
  assert.equal(result.score.score, 8.5);
  assert.equal(result.context, "CS2 clip review");
  assert.ok(result.description.includes("clutch"));
});

test("MediaJudge: custom rating options and score label are honored", async () => {
  const backend = fakeBackend({ choice: () => 2, score: () => 3 });
  const judge = new MediaJudge({ backend });
  const result = await judge.judge("test", "some description", {
    ratingOptions: ["excellent", "fine", "needs-work"],
    scoreLabel: "positioning quality",
  });

  assert.equal(result.rating.options.length, 3);
  assert.equal(result.rating.selected, "needs-work");
});
