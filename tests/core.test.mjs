/**
 * Unit tests for the JEV core: deterministic primitives, gatekeeper routing,
 * winnow compaction, guardrails, memory auto-tuning, presets and feature
 * implementations. Run with: npm test (node --test tests/)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpMemory = path.join(os.tmpdir(), `jev-test-memory-${process.pid}.json`);
process.env.JEV_MEMORY_PATH = tmpMemory;
process.env.JEV_LLM_DISABLED = "true";

const { HeuristicBackend } = await import("../dist/core/providers/heuristic.js");
const { routeByConfidence, evaluateWithGate, speculate } = await import("../dist/core/gatekeeper.js");
const { mapLimit, fanOut, BackpressureRouter } = await import("../dist/core/fanout.js");
const { ngramJaccard, tokenize, softmax, estimateTokens } = await import("../dist/core/text.js");
const { loadPreset, listPresets, presetStateLines } = await import("../dist/core/presets.js");
const { defaultMemory, recordOutcome, optimizePolicy, loadMemory, saveMemory } = await import("../dist/core/memory.js");
const { ContextCompactor } = await import("../dist/modules/context-compactor.js");
const { ChiefOfStaff } = await import("../dist/modules/jev-dispatcher.js");
const { sanitize, prGate, edgeCases, rerank } = await import("../dist/modules/enterprise-features.js");
const { classifyLicense } = await import("../dist/modules/github-miner.js");
const { JevTrainingKit } = await import("../dist/modules/jev-training-kit.js");
const { scanProject, buildFindings } = await import("../dist/modules/jev-audit.js");

const backend = new HeuristicBackend();

test("heuristic choice is deterministic and probabilistic", async () => {
  const request = {
    kind: "choice",
    question: "Which database fits an offline-first single-user agent?",
    options: ["postgres cluster", "sqlite", "hosted mongo"],
  };
  const first = await backend.choice(request);
  const second = await backend.choice(request);
  assert.equal(first.selected, second.selected, "same input must give the same choice");
  assert.deepEqual(first.probabilities, second.probabilities);
  const sum = first.probabilities.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `probabilities must sum to ~1, got ${sum}`);
  assert.equal(first.confidence, Math.max(...first.probabilities));
  assert.ok(first.synthetic === true && first.usage.costUsd === 0);
});

test("heuristic score reacts to negative cues and stays bounded", async () => {
  const good = await backend.score({ kind: "score", question: "tests passing, coverage 92%, typed, atomic" });
  const bad = await backend.score({ kind: "score", question: "crashes with a null pointer race condition, flaky, TODO" });
  assert.ok(good.score > bad.score, `expected ${good.score} > ${bad.score}`);
  assert.ok(good.score <= 10 && bad.score >= 1);
});

test("heuristic noul stays calibrated and polarity-aware", async () => {
  // Same question polarity ("is it dangerous?") with opposite evidence.
  const safe = await backend.noul({
    kind: "noul",
    question: "Is executing this tool call dangerous or destructive?",
    state: "npm test passed, covered, deterministic, sandbox",
  });
  const unsafe = await backend.noul({
    kind: "noul",
    question: "Is executing this tool call dangerous or destructive?",
    state: "hardcoded secret, leak, vulnerable, destructive delete of root",
  });
  assert.ok(safe.probability < 0.5, `safe evidence must lower danger: ${safe.probability}`);
  assert.ok(unsafe.probability > 0.5, `unsafe evidence must raise danger: ${unsafe.probability}`);
  assert.ok(safe.probability >= 0 && unsafe.probability <= 1);

  // Opposite polarity ("will it succeed?") must flip the same evidence.
  const success = await backend.noul({
    kind: "noul",
    question: "Will the documented, tested, reversible change succeed?",
  });
  assert.ok(success.probability > 0.5, `positive-polarity question with positive cues: ${success.probability}`);
});

test("gatekeeper routes by the documented thresholds", () => {
  assert.equal(routeByConfidence("q", 0.95).route, "execute");
  assert.equal(routeByConfidence("q", 0.7).route, "speculative");
  const belki = routeByConfidence("q", 0.4);
  assert.equal(belki.route, "system2");
  assert.equal(belki.belki, true);
  assert.ok(belki.escalation?.payload.includes("q"));
});

test("speculative escalation produces three sub-decisions", async () => {
  const subs = speculate("Ship the change", "option A");
  assert.equal(subs.length, 3);
  assert.deepEqual(subs[0].options, ["yes", "no", "unknown"]);
  const outcome = await evaluateWithGate(backend, {
    kind: "choice",
    question: "Ship the hotfix without a full regression suite?",
    options: ["ship now", "wait for full suite"],
    policy: { executeThreshold: 0.99, escalateThreshold: 0.0 },
  });
  assert.ok(["execute", "speculative", "system2"].includes(outcome.decision.route));
  assert.ok(outcome.subChoices.length === 3 || outcome.decision.route !== "speculative");
});

test("fan-out preserves order and reports stats", async () => {
  const { results, stats } = await fanOut([1, 2, 3].map((n) => async () => n * 2));
  assert.deepEqual(results, [2, 4, 6]);
  assert.equal(stats.count, 3);
  assert.ok(stats.maxCallMs >= 0);
  const limited = await mapLimit([1, 2, 3, 4], 2, async (n) => n + 1);
  assert.deepEqual(limited, [2, 3, 4, 5]);
});

test("backpressure router queues beyond its limit", async () => {
  const router = new BackpressureRouter(1);
  let peak = 0;
  await Promise.all(
    [1, 2, 3].map(() =>
      router.run(async () => {
        peak = Math.max(peak, router.stats.active);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }),
    ),
  );
  assert.equal(peak, 1);
  assert.equal(router.stats.active, 0);
});

test("winnow compaction is lossless for kept lines and protective for anchors", async () => {
  const compactor = new ContextCompactor({ backend });
  const input = [
    "$ npm test",
    "irrelevant chatter about the weather forecast",
    "src/core/gatekeeper.ts",
    "Error: EADDRINUSE port 8000",
    "yet more chatter that should be deleted",
  ].join("\n");
  const report = await compactor.winnow(input, { goal: "fix the port binding error" });
  assert.ok(report.compacted.includes("$ npm test"));
  assert.ok(report.compacted.includes("Error: EADDRINUSE port 8000"));
  assert.ok(report.compacted.includes("src/core/gatekeeper.ts"));
  assert.ok(report.droppedLines >= 1);
  const kept = report.compacted.split("\n").filter((line) => line.trim().length > 0);
  for (const line of kept) assert.ok(input.includes(line), `line was rewritten: ${line}`);
  assert.ok(report.preservedAnchors.includes("command"));
  assert.ok(report.preservedAnchors.includes("error"));
});

test("winnowTranscript keeps positive results, drops negative-no-anchor ones, and anchor-overrides a negative-with-anchor one", async () => {
  const compactor = new ContextCompactor({ backend });
  const messages = [
    { role: "user", text: "kickoff" },
    { role: "assistant", toolCalls: [{ tool_use_id: "keep1", tool: "Bash", input: { command: "run tests, coverage, typed, atomic" } }] },
    { role: "user", toolResults: [{ tool_use_id: "keep1", text: "tests passing, coverage, typed, atomic, deterministic, reviewed" }] },
    { role: "assistant", toolCalls: [{ tool_use_id: "drop1", tool: "Read", input: { note: "legacy hack todo" } }] },
    { role: "user", toolResults: [{ tool_use_id: "drop1", text: "this hack is legacy spaghetti todo blocked slow unsupported" }] },
    { role: "assistant", toolCalls: [{ tool_use_id: "anchor1", tool: "Read", input: { note: "legacy hack todo" } }] },
    { role: "user", toolResults: [{ tool_use_id: "anchor1", text: "deprecated, hack, legacy, blocked, slow, spaghetti, unsupported, vulnerable" }] },
    { role: "assistant", text: "done" },
  ];
  const report = await compactor.winnowTranscript(messages, { preserveRecentMessages: 1 });

  assert.equal(report.totalPairs, 3);
  assert.equal(report.droppedPairs, 1, "the negative-cue, no-anchor pair must be dropped");
  assert.equal(report.anchorOverrides, 1, "the negative-cue, anchor-matching pair must be overridden to keep");
  assert.equal(report.keptCalls, 2);

  const idsPresent = new Set(
    report.messages.flatMap((m) => [...(m.toolCalls ?? []).map((c) => c.tool_use_id), ...(m.toolResults ?? []).map((r) => r.tool_use_id)]),
  );
  assert.ok(idsPresent.has("keep1"), "clearly-relevant pair must survive");
  assert.ok(idsPresent.has("anchor1"), "anchor-protected pair must survive despite negative Noul signal");
  assert.ok(!idsPresent.has("drop1"), "negative-cue pair with no anchor must be dropped");
});

test("guardrail blocks destructive calls and allows benign ones", async () => {
  const cos = new ChiefOfStaff({ backend });
  const blocked = await cos.guardrail("bash", "rm -rf /");
  assert.equal(blocked.decision, "block");
  const sql = await cos.guardrail("db_exec", "DROP TABLE users;");
  assert.equal(sql.decision, "block");
  const ask = await cos.guardrail("bash", "git push --force origin main");
  assert.equal(ask.decision, "ask");
  const ok = await cos.guardrail("bash", "npm test");
  assert.equal(ok.decision, "allow");
});

test("dispatcher picks a role from the catalog", async () => {
  const cos = new ChiefOfStaff({ backend });
  const decision = await cos.dispatch("Audit the repository security posture");
  assert.ok(["researcher", "planner", "implementer", "reviewer", "writer", "auditor"].includes(decision.role));
  assert.equal(decision.roleChoice.options[decision.roleChoice.selectedIndex], decision.role);
  assert.ok(decision.handoff.payload.requiredTools.length >= 1);
});

test("memory records RLVR rewards and auto-tunes thresholds", () => {
  const memory = defaultMemory();
  const bucket = memory.calibration.find((b) => b.from === 0.9);
  for (let i = 0; i < 6; i++) {
    recordOutcome(memory, { passed: true, confidence: 0.92, detail: "verified", question: "q" });
  }
  assert.equal(bucket.n, 6);
  assert.equal(bucket.observedRate, 1);
  assert.equal(memory.stats.reward, 6);
  const update = optimizePolicy(memory);
  assert.ok(update.policy.executeThreshold <= 0.85, "winning bucket should not raise the execute threshold");
  saveMemory(memory);
  const reloaded = loadMemory();
  assert.equal(reloaded.stats.successes, 6);
});

test("license classification gates copying", () => {
  assert.equal(classifyLicense("MIT").copyAllowed, true);
  assert.equal(classifyLicense("Apache-2.0").copyAllowed, true);
  assert.equal(classifyLicense("GPL-3.0").copyAllowed, false);
  assert.equal(classifyLicense("AGPL-3.0-only").klass, "copyleft");
  assert.equal(classifyLicense(null).klass, "unknown");
  assert.equal(classifyLicense(null).copyAllowed, false);
});

test("presets load with substance and inject state lines", () => {
  const presets = listPresets();
  assert.equal(presets.length, 7);
  assert.ok(presets.every((p) => p.available), "all preset files must exist");
  const preset = loadPreset("software-architecture");
  assert.ok(preset && preset.rules.length >= 5 && preset.redFlags.length >= 5);
  const lines = presetStateLines("cybersecurity", 12);
  assert.ok(lines.length > 3 && lines[0].includes("preset"));
});

test("privacy sanitizer masks PII and secrets", () => {
  const report = sanitize("mail me at ada@example.com, key sk-abcdefghijklmnop1234, ip 192.168.5.7");
  assert.ok(report.sanitized.includes("***@***"));
  assert.ok(report.sanitized.includes("REDACTED"));
  assert.ok(!report.sanitized.includes("192.168.5.7"));
  assert.equal(report.safeForExternalModel, false);
  assert.ok(report.detections.some((d) => d.kind === "email"));
});

test("rerank keeps the most relevant passages", async () => {
  const result = await rerank(
    backend,
    "gatekeeper confidence thresholds",
    ["The gatekeeper routes by calibrated confidence thresholds.", "Menemen is a Turkish breakfast dish."],
    1,
  );
  assert.equal(result.kept.length, 1);
  assert.equal(result.dropped, 1);
});

test("pr gate flags secrets, breaking changes and leftovers", () => {
  const report = prGate([
    {
      file: "src/auth.ts",
      patch: [
        "-export function login() {}",
        '+const apiKey = "sk-live-1234567890abcdef";',
        "+console.log(apiKey);",
      ].join("\n"),
    },
  ]);
  assert.equal(report.verdict, "block");
  assert.ok(report.findings.some((f) => f.severity === "high"));
  assert.ok(report.findings.some((f) => f.message.includes("console")));
});

test("edge case synthesizer is deterministic and bounded", () => {
  const cases = edgeCases("checkout flow", 12);
  assert.equal(cases.length, 12);
  assert.ok(cases.every((c) => c.steps.length >= 2 && c.expected.length > 5));
  assert.equal(cases[0].category, "input");
});

test("training kit labels rows and builds pairs at zero cost", async () => {
  const kit = new JevTrainingKit({ backend });
  const labeled = await kit.label(["tests passing", "hardcoded secret leak"], {
    mode: "noul",
    question: "Is this sample safe to ship?",
    writeFile: false,
  });
  assert.equal(labeled.labels.length, 2);
  assert.equal(labeled.costUsd, 0);
  assert.equal(labeled.labels[0].label.kind, "noul");
  const pairs = await kit.preferencePairs(
    [{ prompt: "p", candidates: ["tests passing, typed, documented", "crashes, flaky, TODO"] }],
    { writeFile: false },
  );
  assert.equal(pairs.pairs.length, 1);
  assert.equal(pairs.pairs[0].chosen, "tests passing, typed, documented");
  const recipe = kit.distillRecipe("modernbert-421m");
  assert.equal(recipe.target, "modernbert-421m");
  assert.ok(recipe.commands.length >= 3);
});

test("audit scanner finds secrets and missing guardrails in a temp project", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-audit-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", dependencies: {} }));
  fs.writeFileSync(path.join(dir, "app.ts"), 'const apiKey = "sk-live-abcdef123456";\n// TODO: fix me\n');
  const scan = scanProject(dir);
  assert.ok(scan.scannedFiles >= 2);
  assert.ok(scan.secrets.length >= 1, "hardcoded key must be detected");
  const findings = buildFindings(scan);
  assert.ok(findings.some((f) => f.dimension === "security" && f.severity === "critical"));
  assert.ok(findings.some((f) => f.dimension === "architecture"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("text helpers behave", () => {
  assert.equal(ngramJaccard("a b c d e f", "a b c d e f"), 1);
  assert.equal(ngramJaccard("a b c d e f", "x y z w v u"), 0);
  assert.ok(tokenize("Masaüstü İçin JEV").includes("masaustu"));
  const probs = softmax([0, 0], 1);
  assert.ok(Math.abs(probs[0] - 0.5) < 1e-9);
  assert.equal(estimateTokens("abcd"), 1);
});
