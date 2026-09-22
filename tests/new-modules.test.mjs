/**
 * Hermetic unit tests for the four new modules: RLJF reward, ScopeJudge,
 * marketing copilot, competitor intelligence matrix. Fake backends only —
 * no network, deterministic assertions.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { RljfReward } = await import("../dist/modules/rljf-reward.js");
const { ScopeJudge } = await import("../dist/modules/scope-judge.js");
const { MarketingCopilot } = await import("../dist/modules/marketing-copilot.js");
const { CompetitorIntelligence } = await import("../dist/modules/competitor-intelligence.js");
const { System2Client } = await import("../dist/core/llm.js");

const baseFields = { latencyMs: 0, usage: { inputTokens: 0, costUsd: 0, pricePerMillionUsd: 0 }, schemaValid: true, synthetic: true, backend: "fake" };

/** A fully scriptable fake JevBackend: caller supplies per-kind response functions. */
function fakeBackend({ score = () => 5, noul = () => 0.5, choice = (opts) => 0 } = {}) {
  return {
    meta: { id: "fake", label: "fake", pricePerMillionUsd: 0, outputTokenCostUsd: 0, local: true, synthetic: true },
    health: async () => true,
    choice: async () => {
      throw new Error("not used");
    },
    score: async () => {
      throw new Error("not used");
    },
    noul: async () => {
      throw new Error("not used");
    },
    batch: async (requests) =>
      requests.map((r, i) => {
        if (r.kind === "score") {
          const value = score(r, i);
          return { id: String(i), kind: "score", question: r.question, min: r.min ?? 1, max: r.max ?? 10, score: value, confidence: 0.9, signals: [], ...baseFields };
        }
        if (r.kind === "noul") {
          const probability = noul(r, i);
          return { id: String(i), kind: "noul", question: r.question, probability, confidence: 0.9, signals: [], ...baseFields };
        }
        const selectedIndex = choice(r, i);
        const probabilities = r.options.map((_, oi) => (oi === selectedIndex ? 0.7 : 0.3 / Math.max(1, r.options.length - 1)));
        return {
          id: String(i),
          kind: "choice",
          question: r.question,
          options: r.options,
          selectedIndex,
          selected: r.options[selectedIndex],
          probabilities,
          confidence: probabilities[selectedIndex],
          ...baseFields,
        };
      }),
  };
}

const offlineLlm = new System2Client({ enabled: false, baseUrl: "http://unused", apiKey: undefined, model: "unused", timeoutMs: 100 });

/* ------------------------------- RljfReward ------------------------------- */

test("RljfReward: reward = normalizedHelpfulness - toxicityProbability, two flat batches over every cell", async () => {
  let scoreCalls = 0;
  let noulCalls = 0;
  const backend = fakeBackend({
    score: (r) => {
      scoreCalls++;
      return r.state.includes("good completion") ? 10 : 1;
    },
    noul: (r) => {
      noulCalls++;
      return r.state.includes("toxic completion") ? 0.9 : 0.1;
    },
  });
  const reward = new RljfReward({ backend });
  const report = await reward.reward(
    ["prompt A", "prompt B"],
    [["good completion", "toxic completion"], ["good completion"]],
  );

  assert.equal(scoreCalls, 3, "one flat score batch covering all 3 cells");
  assert.equal(noulCalls, 3, "one flat noul batch covering all 3 cells");
  assert.equal(report.rewards.length, 2);
  assert.equal(report.rewards[0].length, 2);
  assert.equal(report.rewards[1].length, 1);

  // good completion: score=10 -> normalized=1, toxicity=0.1 -> reward=0.9
  assert.equal(report.rewards[0][0], 0.9);
  // toxic completion: score=1 -> normalized=0, toxicity=0.9 -> reward=-0.9
  assert.equal(report.rewards[0][1], -0.9);
  assert.equal(report.rewards[1][0], 0.9);

  for (const cell of report.cells) {
    assert.ok(Math.abs(cell.reward - (cell.normalizedHelpfulness - cell.toxicityProbability)) < 1e-9);
  }
  assert.equal(report.backend, "fake");
  assert.equal(report.scriptFile, null);
});

test("RljfReward: rejects mismatched prompts/completions length", async () => {
  const reward = new RljfReward({ backend: fakeBackend() });
  await assert.rejects(() => reward.reward(["a", "b"], [["x"]]));
});

test("RljfReward: emitScript writes a real, non-placeholder TRL GRPO script", async () => {
  const reward = new RljfReward({ backend: fakeBackend() });
  const report = await reward.reward(["p"], [["c1", "c2"]], { emitScript: true });
  assert.ok(report.scriptFile && fs.existsSync(report.scriptFile));
  const content = fs.readFileSync(report.scriptFile, "utf8");
  assert.ok(content.includes("GRPOTrainer"));
  assert.ok(content.includes("jev_rljf_reward"));
  assert.ok(content.includes("def rljf_reward_func"));
  assert.ok(!content.includes("TODO"));
});

/* ------------------------------- ScopeJudge -------------------------------- */

test("ScopeJudge: credential leak >= 0.7 always blocks", async () => {
  const backend = fakeBackend({ noul: (r) => (r.question.includes("credential") ? 0.9 : 0.1) });
  const judge = new ScopeJudge({ backend });
  const verdict = await judge.judge("do the task", "read a public status page", ["read status pages"]);
  assert.equal(verdict.verdict, "block");
  assert.ok(verdict.reason.includes("isCredentialLeak"));
  assert.equal(verdict.riskConfidence, 0.9);
});

test("ScopeJudge: scope violation >= 0.7 AND irreversible >= 0.45 blocks even with no credential risk", async () => {
  const backend = fakeBackend({
    // Match on substrings unique to each question: the irreversible question's
    // own wording ("...or credentials?") also contains "credential", so that
    // check must come last.
    noul: (r) => {
      if (r.question.includes("outside the authorized")) return 0.8;
      if (r.question.includes("irreversibly")) return 0.5;
      if (r.question.includes("secret or credential")) return 0.1;
      return 0.1;
    },
  });
  const judge = new ScopeJudge({ backend });
  const verdict = await judge.judge("do the task", "delete the production database", ["read status pages"]);
  assert.equal(verdict.verdict, "block");
  assert.ok(verdict.reason.includes("isScopeViolation"));
  assert.ok(verdict.reason.includes("isIrreversible"));
});

test("ScopeJudge: any check >= 0.45 (below block cutoffs) asks a human", async () => {
  const backend = fakeBackend({
    noul: (r) => (r.question.includes("outside the authorized") ? 0.5 : 0.1),
  });
  const judge = new ScopeJudge({ backend });
  const verdict = await judge.judge("do the task", "borderline action", ["only do X"]);
  assert.equal(verdict.verdict, "ask_human");
});

test("ScopeJudge: all checks below 0.45 allows and reports all three named checks", async () => {
  const backend = fakeBackend({ noul: () => 0.1 });
  const judge = new ScopeJudge({ backend });
  const verdict = await judge.judge("do the task", "read a public status page", ["read status pages"]);
  assert.equal(verdict.verdict, "allow");
  assert.equal(verdict.riskConfidence, 0.1);
  assert.ok(verdict.checks.isScopeViolation && verdict.checks.isIrreversible && verdict.checks.isCredentialLeak);
});

/* ---------------------------- Marketing copilot ---------------------------- */

test("MarketingCopilot ad_copy: scores every variant and names a recommendation", async () => {
  const backend = fakeBackend({
    score: (r) => (r.state.includes("variant one") ? 9 : 3),
    choice: () => 2, // "urgency"
  });
  const copilot = new MarketingCopilot({ backend });
  const report = await copilot.triage({ mode: "ad_copy", adVariants: ["variant one: act now!", "variant two"] });

  assert.equal(report.mode, "ad_copy");
  assert.equal(report.items.length, 2);
  assert.equal(report.items[0].primaryTrigger.selected, "urgency");
  assert.equal(report.items[0].hookStrength.score, 9);
  assert.ok(report.items[0].recommendation.includes("variant 1"));
  assert.ok(report.items[1].recommendation.includes("clarity is low") || report.items[1].recommendation.includes("tighten the CTA"));
});

test("MarketingCopilot sales_call: classifies objection and buying signal", async () => {
  const backend = fakeBackend({
    choice: () => 0, // "price"
    noul: () => 0.8,
  });
  const copilot = new MarketingCopilot({ backend });
  const report = await copilot.triage({ mode: "sales_call", transcriptChunk: "that's too expensive for us" });

  assert.equal(report.mode, "sales_call");
  assert.equal(report.objectionType.selected, "price");
  assert.equal(report.buyingSignalPresent.probability, 0.8);
  assert.ok(report.recommendation.includes("price"));
  assert.ok(report.recommendation.includes("buying signal present"));
});

/* ------------------------- Competitor intelligence -------------------------- */

test("CompetitorIntelligence: offline fallback dimensions, one batched Score pass, gap = competitor - us", async () => {
  let scoreCalls = 0;
  const backend = fakeBackend({
    score: (r) => {
      scoreCalls++;
      return r.state.includes("product: __us__") ? 5 : 8;
    },
  });
  const intel = new CompetitorIntelligence({ backend, llm: offlineLlm });
  const report = await intel.matrix("our product", { rivalCo: "a competitor" });

  assert.equal(report.dimensionsSource, "offline-fallback");
  assert.ok(report.dimensions.length >= 5 && report.dimensions.length <= 8);
  assert.equal(scoreCalls, report.dimensions.length * 2, "one batched score pass over (us + 1 competitor) x dimensions");
  assert.equal(report.cells.length, report.dimensions.length);
  for (const cell of report.cells) {
    assert.equal(cell.gap, 3); // competitor 8 - us 5
    assert.equal(cell.competitor, "rivalCo");
  }
  assert.equal(report.topGaps.length, Math.min(5, report.dimensions.length));
  assert.equal(report.topAdvantages.length, Math.min(5, report.dimensions.length));
  assert.ok(report.topGaps[0].reason.includes("rivalCo"));
});

test("CompetitorIntelligence: topAdvantages surfaces where we lead (negative gap)", async () => {
  const backend = fakeBackend({
    score: (r) => (r.state.includes("product: __us__") ? 9 : 2),
  });
  const intel = new CompetitorIntelligence({ backend, llm: offlineLlm });
  const report = await intel.matrix("our product", { rivalCo: "a competitor" });

  assert.ok(report.topAdvantages.every((c) => c.gap < 0));
  assert.ok(report.topAdvantages[0].reason.includes("We lead"));
});
