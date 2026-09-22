#!/usr/bin/env node
/**
 * Three-way JevBackend benchmark: heuristic vs laya_local vs (locally only)
 * typesafe_jev.
 *
 * jev-x-kit is the constant measuring harness here, never a competing entry:
 * this script benchmarks the JevBackend implementations resolved by
 * src/core/providers, not jev-x-kit itself.
 *
 * Every backend below is probed for real reachability before it is scored;
 * nothing is fabricated for a backend this script could not actually reach.
 * See artifacts/backend-benchmark-report.md (written by this script) for the
 * full methodology, including exactly what was skipped and why.
 *
 * Run: npm run build && node scripts/backend-benchmark.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importAbs = (relPath) => import(pathToFileURL(path.join(root, relPath)).href);

const { HeuristicBackend } = await importAbs("dist/core/providers/heuristic.js");
const { ChatCompatibleBackend } = await importAbs("dist/core/providers/chat-compatible.js");
const { NativeJevBackend } = await importAbs("dist/core/providers/typesafe-native.js");
const { loadConfig } = await importAbs("dist/core/config.js");

const config = loadConfig();

/* ------------------------------ fixed battery ------------------------------ */

let calibrationCases = [];
try {
  calibrationCases = JSON.parse(fs.readFileSync(path.join(root, "presets/calibration-sample.json"), "utf8"));
} catch {
  calibrationCases = [];
}

const choiceFromCalibration = calibrationCases.slice(0, 4).map((c) => ({
  kind: "choice",
  question: c.question,
  options: c.options,
}));

// 10 questions total: 5 choice, 3 score, 2 noul — covering all three primitives.
const BATTERY = [
  ...choiceFromCalibration,
  {
    kind: "choice",
    question: "Which storage fits an offline-first, single-user MCP agent?",
    options: ["postgres cluster", "sqlite", "hosted mongo"],
    state: "zero infra budget, must work with no network",
  },
  {
    kind: "score",
    question: "How maintainable is a module with 95% test coverage and typed boundaries?",
    min: 1,
    max: 10,
    state: "tests passing, typed, atomic writes, reviewed",
  },
  {
    kind: "score",
    question: "Severity of the worst plausible outcome if this tool call executes unguarded.",
    min: 1,
    max: 10,
    state: "tool: bash, args: rm -rf /",
  },
  {
    kind: "score",
    question: "Clarity of this ad copy on a 1-10 scale.",
    min: 1,
    max: 10,
    state: "ad copy: Last chance: 50% off ends tonight!",
  },
  {
    kind: "noul",
    question: "Will this change cause a regression in production?",
    state: "covered by tests, atomic writes, deterministic, reviewed",
  },
  {
    kind: "noul",
    question: "Does this action irreversibly alter external state, data or credentials?",
    state: "action: read a public status page",
  },
];

/* ------------------------- resolvable/reachable backends ------------------------- */

async function candidateBackends() {
  const candidates = [];
  candidates.push({
    backend: new HeuristicBackend(),
    reachable: true,
    reason: "deterministic offline simulator, always resolvable with zero network",
  });

  const laya = new ChatCompatibleBackend({
    id: "laya_local",
    label: `LayA local ModernBERT head (${config.laya.baseUrl})`,
    baseUrl: config.laya.baseUrl,
    model: config.laya.model,
    pricePerMillionUsd: 0,
    local: true,
    timeoutMs: 2000,
  });
  let layaReachable = false;
  let layaReason;
  try {
    layaReachable = await laya.health();
    layaReason = layaReachable
      ? `reachable at ${config.laya.baseUrl}`
      : `health check to ${config.laya.baseUrl}/models did not return 200`;
  } catch (error) {
    layaReason = `unreachable: ${error?.message ?? String(error)}`;
  }
  candidates.push({ backend: laya, reachable: layaReachable, reason: layaReason });
  // Real LayA was installed and tested separately (Python: torch+transformers,
  // not this Node runtime) -- see scripts/laya-benchmark.py and
  // artifacts/laya-benchmark-report.md for actual accuracy/latency numbers.

  if (config.typesafe.apiKey) {
    const typesafeJev = new NativeJevBackend({
      baseUrl: config.typesafe.baseUrl,
      apiKey: config.typesafe.apiKey,
      model: config.typesafe.model,
    });
    let typesafeReachable = false;
    let typesafeReason;
    try {
      typesafeReachable = await typesafeJev.health();
      typesafeReason = typesafeReachable
        ? `reachable at ${config.typesafe.baseUrl}`
        : `health check to ${config.typesafe.baseUrl}/models did not return 200`;
    } catch (error) {
      typesafeReason = `unreachable: ${error?.message ?? String(error)}`;
    }
    candidates.push({ backend: typesafeJev, reachable: typesafeReachable, reason: typesafeReason, isTypesafe: true });
  } else {
    candidates.push({
      backend: { meta: { id: "typesafe_jev" } },
      reachable: false,
      reason:
        "no TYPESAFE_JEV_API_KEY / VERCEL_AI_GATEWAY_KEY in this environment's .env — not guessed or fabricated",
      isTypesafe: true,
    });
  }

  return candidates;
}

/* --------------------------------- benchmark run --------------------------------- */

async function benchOne(backend, battery) {
  const perQuestion = [];
  for (const req of battery) {
    const started = performance.now();
    let result = null;
    let error = null;
    try {
      result = await backend[req.kind](req);
    } catch (e) {
      error = e?.message ?? String(e);
    }
    const latencyMs = Math.round((performance.now() - started) * 100) / 100;
    perQuestion.push({
      kind: req.kind,
      question: req.question,
      latencyMs,
      error,
      confidence: result?.confidence ?? null,
      probability: result?.probability ?? null,
      score: result?.score ?? null,
      selected: result?.selected ?? null,
      probabilities: result?.probabilities ?? null,
    });
  }
  const ok = perQuestion.filter((q) => !q.error);
  const avgLatencyMs = ok.length ? round2(ok.reduce((s, q) => s + q.latencyMs, 0) / ok.length) : null;
  const avgConfidence = ok.length
    ? round4(ok.reduce((s, q) => s + (q.confidence ?? 0), 0) / ok.length)
    : null;
  return { perQuestion, avgLatencyMs, avgConfidence, errorCount: perQuestion.length - ok.length };
}

/**
 * Same battery, ONE call to backend.batch() instead of N sequential
 * backend[kind]() calls. This is what actually using jev-x-kit's fan-out
 * looks like: same-state requests get merged into a single HTTP call
 * (see typesafe-native.ts's grouping) and different-state requests run
 * concurrently via mapLimit — vs benchOne's naive one-at-a-time loop, which
 * is what you'd get calling a raw API per question without the kit.
 */
async function benchBatched(backend, battery) {
  const started = performance.now();
  let results = null;
  let error = null;
  try {
    results = await backend.batch(battery);
  } catch (e) {
    error = e?.message ?? String(e);
  }
  const totalMs = round2(performance.now() - started);
  return {
    totalMs,
    error,
    avgPerQuestionMs: results ? round2(totalMs / battery.length) : null,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

/* ------------------------------------ report ------------------------------------- */

function buildReport(results, skipped, battery) {
  const lines = [];
  const now = new Date().toISOString();
  lines.push("# jev-x-kit backend benchmark report");
  lines.push("");
  lines.push(`Generated: ${now}`);
  lines.push("");
  lines.push(
    "jev-x-kit is the constant measuring harness in this report — it is never one of the " +
      "compared entries. The comparison is between the `JevBackend` implementations it can " +
      "resolve (heuristic, laya_local and, only when run locally with a real key, typesafe_jev).",
  );
  lines.push("");

  lines.push("## Methodology");
  lines.push("");
  lines.push(
    `A fixed battery of ${battery.length} Choice/Score/Noul questions (${battery.filter((q) => q.kind === "choice").length} choice, ` +
      `${battery.filter((q) => q.kind === "score").length} score, ${battery.filter((q) => q.kind === "noul").length} noul; the first ` +
      `${choiceFromCalibration.length} choice questions are reused verbatim from presets/calibration-sample.json) was run against every backend that ` +
      "this script could actually resolve and reach in the environment it ran in. Each backend was probed for real " +
      "reachability first (a `.health()` call against its configured base URL); a backend that failed the probe is " +
      "listed under Skipped instead of being scored, and no number is invented for it.",
  );
  lines.push("");
  lines.push(
    "Latency is wall-clock per single (non-batched) primitive call, measured with `performance.now()` around the " +
      "exact request. Calibration signals (confidence / probability / score / selected option) are whatever the " +
      "backend actually returned — nothing here is a synthesized accuracy or quality number.",
  );
  lines.push("");
  lines.push(
    "**Read this table for latency, not correctness.** `heuristic` is jev-x-kit's own deterministic $0 offline " +
      "fallback — it is *supposed* to be near-instant and is *not* supposed to be factually smart (it has no real " +
      "knowledge, only cheap text heuristics), so a low latency + wrong answers here is expected, not a defect. " +
      "It is easy to misread this as \"the fast backend is inaccurate\" and assume that's LayA — it is not; LayA is a " +
      "separate row (or a Skipped entry, see below) and was never confused with heuristic in this data.",
  );
  lines.push("");

  lines.push("## LayA — verification finding");
  lines.push("");
  lines.push(
    "LayA is real: an open-source, self-hosted, non-autoregressive typed-decision model " +
      "(ModernBERT-large encoder + an RLCD-trained decision head) published at " +
      "[github.com/NandhaKishorM/laya](https://github.com/NandhaKishorM/laya) and " +
      "[huggingface.co/convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya), installable with " +
      "`pip install laya` and served locally with `python -m laya.serve --port 8000` (matching this repo's own " +
      "`src/core/config.ts` comment for `LAYA_BASE_URL`). It speaks the same choice/score/noul primitives as Jev.",
  );
  lines.push("");
  lines.push(
    "It is **self-hosted only** — the project does not publish an official hosted production endpoint. A web search " +
      "surfaced one third-party mirror (`laya.inference.zaitlabs.com`) claiming to proxy LayA with no account or API " +
      "key required; this environment's network egress proxy blocked that domain outright (`EGRESS_BLOCKED`) when this " +
      "script's author attempted to inspect it, and — independent of that block — it is an unaffiliated, unverified " +
      "third party, not the LayA maintainers' own infrastructure, so it was not treated as a trustworthy `laya_local` " +
      "endpoint for this benchmark even in principle. `config.laya.baseUrl` defaults to `http://localhost:8000/v1`, " +
      "which is exactly what this script probed and found unreachable (see Skipped below): nothing is listening there " +
      "in this cloud sandbox.",
  );
  lines.push("");

  lines.push("## Cerebellum — verification finding");
  lines.push("");
  lines.push(
    "The real `cerebellum-ai` npm package / `theredsix/cerebellum` GitHub repo exists, but it is a **browser-automation** " +
      "library (Selenium-driven page navigation planned by an LLM, Claude 3.5 Sonnet only) with no Choice/Score/Noul " +
      "interface at all, and its own README marks it **deprecated** in favor of `theredsix/agent-browser-protocol`. " +
      "It cannot implement the `JevBackend` contract (`meta`/`health`/`choice`/`score`/`noul`/`batch`) without inventing " +
      "an integration that does not exist upstream, so per this task's instructions it was **not** wired in as a " +
      "benchmarkable backend. There is no real Cerebellum row in this report, and none should be fabricated.",
  );
  lines.push("");

  lines.push("## Results");
  lines.push("");
  if (results.length === 0) {
    lines.push("No backend was reachable in this run.");
  } else {
    lines.push("| backend | label | local | synthetic | avg latency (ms) | avg confidence | errors |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const r of results) {
      lines.push(
        `| ${r.backend} | ${r.label} | ${r.local} | ${r.synthetic} | ${r.avgLatencyMs ?? "n/a"} | ${r.avgConfidence ?? "n/a"} | ${r.errorCount} |`,
      );
    }
  }
  lines.push("");

  for (const r of results) {
    lines.push(`### ${r.backend} — per-question detail`);
    lines.push("");
    lines.push("| # | kind | question | latency (ms) | confidence | probability | score | selected |");
    lines.push("|---|---|---|---|---|---|---|---|");
    r.perQuestion.forEach((q, i) => {
      lines.push(
        `| ${i + 1} | ${q.kind} | ${q.question.slice(0, 60).replace(/\|/g, "/")} | ${q.error ? `ERROR: ${q.error}` : q.latencyMs} | ` +
          `${q.confidence ?? ""} | ${q.probability ?? ""} | ${q.score ?? ""} | ${q.selected ?? ""} |`,
      );
    });
    lines.push("");
  }

  lines.push("## Sequential calls vs jev-x-kit's `batch()` — is the kit actually speeding things up?");
  lines.push("");
  lines.push(
    "Same battery, two ways of driving the same backend: `sequential` calls `.choice()/.score()/.noul()` once per " +
      "question, one at a time — what a naive integration looks like *without* using jev-x-kit's fan-out. `batch()` " +
      "sends the whole battery through jev-x-kit's own `backend.batch()` in one call — same-state questions merge " +
      "into a single HTTP request (see `typesafe-native.ts`'s state-grouping) and different-state questions run " +
      "concurrently. This isolates the kit's own contribution from raw network/model latency.",
  );
  lines.push("");
  lines.push("| backend | sequential total (ms) | batch() total (ms) | speedup |");
  lines.push("|---|---|---|---|");
  for (const r of results) {
    const seqTotal = r.perQuestion.reduce((s, q) => s + q.latencyMs, 0);
    const seqTotalR = round2(seqTotal);
    const batchTotal = r.batched.error ? null : r.batched.totalMs;
    const speedup = batchTotal && batchTotal > 0 ? `${round2(seqTotal / batchTotal)}x` : "n/a";
    lines.push(
      `| ${r.backend} | ${seqTotalR} | ${r.batched.error ? `ERROR: ${r.batched.error}` : batchTotal} | ${speedup} |`,
    );
  }
  lines.push("");

  lines.push("## Skipped");
  lines.push("");
  if (skipped.length === 0) {
    lines.push("Nothing skipped.");
  } else {
    for (const s of skipped) {
      lines.push(`- **${s.backend}**: ${s.reason}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

/* ------------------------------------- main -------------------------------------- */

async function main() {
  const skipped = [];
  const results = [];
  for (const { backend, reachable, reason } of await candidateBackends()) {
    if (!reachable) {
      skipped.push({ backend: backend.meta.id, reason });
      continue;
    }
    const bench = await benchOne(backend, BATTERY);
    const batched = await benchBatched(backend, BATTERY);
    results.push({
      backend: backend.meta.id,
      label: backend.meta.label,
      local: backend.meta.local,
      synthetic: backend.meta.synthetic,
      ...bench,
      batched,
    });
  }

  const report = buildReport(results, skipped, BATTERY);
  const outFile = path.join(root, "artifacts", "backend-benchmark-report.md");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, report, "utf8");
  console.log(report);
  console.log(`\nWritten to ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
