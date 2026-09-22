/**
 * Hermetic unit tests for the two JARVIS-style modules: intent triage and
 * auto-plan extraction. Fake backends only — no network, deterministic
 * assertions.
 */

import test from "node:test";
import assert from "node:assert/strict";

const { JarvisIntentTriage } = await import("../dist/modules/jarvis-intent-triage.js");
const { JarvisAutoPlan } = await import("../dist/modules/jarvis-plan-extractor.js");
const { ContextCompactor } = await import("../dist/modules/context-compactor.js");
const { System2Client } = await import("../dist/core/llm.js");

const baseFields = { latencyMs: 0, usage: { inputTokens: 0, costUsd: 0, pricePerMillionUsd: 0 }, schemaValid: true, synthetic: true, backend: "fake" };

/** A fully scriptable fake JevBackend: caller supplies per-kind response functions. */
function fakeBackend({ score = () => 5, noul = () => 0.5, choice = () => 0 } = {}) {
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
        const probabilities = r.options.map((_, oi) => (oi === selectedIndex ? 0.9 : 0.1 / Math.max(1, r.options.length - 1)));
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

/* --------------------------- JarvisIntentTriage ---------------------------- */

test("JarvisIntentTriage: high executable + high-confidence non-reasoning category routes local", async () => {
  const backend = fakeBackend({ noul: () => 0.9, choice: () => 0 }); // "system_control"
  const triage = new JarvisIntentTriage({ backend });
  const result = await triage.triage("turn off the living room lights");
  assert.equal(result.route, "local");
  assert.equal(result.intentCategory, "system_control");
});

test("JarvisIntentTriage: complex_reasoning_required always escalates even with high confidence", async () => {
  const backend = fakeBackend({ noul: () => 0.95, choice: () => 4 }); // "complex_reasoning_required"
  const triage = new JarvisIntentTriage({ backend });
  const result = await triage.triage("plan my entire product launch strategy");
  assert.equal(result.route, "system2");
  assert.equal(result.intentCategory, "complex_reasoning_required");
});

test("JarvisIntentTriage: low executable probability escalates regardless of category", async () => {
  const backend = fakeBackend({ noul: () => 0.2, choice: () => 1 }); // "media_playback"
  const triage = new JarvisIntentTriage({ backend });
  const result = await triage.triage("what's a good song for a rainy day");
  assert.equal(result.route, "system2");
});

/* ----------------------------- JarvisAutoPlan ------------------------------- */

test("JarvisAutoPlan: offline fallback extracts checklist + TODO/done lines and prioritizes pending", async () => {
  const backend = fakeBackend({
    noul: () => 1, // winnow keeps every line
    score: (r) => (r.state.includes("write tests") ? 9 : 3),
  });
  const compactor = new ContextCompactor({ backend });
  const autoPlan = new JarvisAutoPlan({ backend, llm: offlineLlm, compactor });

  const log = ["- [x] wire the MCP server", "- [ ] write tests", "TODO: add docs", "fixed the build error"].join("\n");
  const report = await autoPlan.extract(log);

  assert.equal(report.source, "offline-fallback");
  assert.ok(report.completed.some((t) => t.includes("wire the MCP server")));
  assert.ok(report.completed.some((t) => t.includes("fixed the build error")));
  assert.ok(report.pending.some((p) => p.text.includes("write tests")));
  assert.ok(report.pending.some((p) => p.text.includes("TODO: add docs")));
  // "write tests" scored 9, should sort above the TODO (scored 3)
  assert.equal(report.pending[0].text.includes("write tests"), true);
});

test("JarvisAutoPlan: toMarkdownLines produces a real checklist, no placeholders", async () => {
  const backend = fakeBackend({ noul: () => 1, score: () => 5 });
  const compactor = new ContextCompactor({ backend });
  const autoPlan = new JarvisAutoPlan({ backend, llm: offlineLlm, compactor });
  const report = await autoPlan.extract("- [x] done thing\n- [ ] pending thing");

  const lines = autoPlan.toMarkdownLines(report, "My Plan");
  const text = lines.join("\n");
  assert.ok(text.startsWith("# My Plan"));
  assert.ok(text.includes("- [ ] pending thing"));
  assert.ok(text.includes("- [x] done thing"));
  assert.ok(!text.includes("TBD") && !text.includes("undefined"));
});
