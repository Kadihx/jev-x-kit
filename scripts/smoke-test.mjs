#!/usr/bin/env node
/**
 * End-to-end smoke test: spawns the built MCP server over stdio with the
 * official MCP client, lists the tools and exercises every module.
 *
 * Run: npm run build && npm run smoke
 */

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(root, "dist", "index.js");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  stderr: "pipe",
  env: {
    ...process.env,
    JEV_BACKEND_PROVIDER: "heuristic",
    JEV_LLM_DISABLED: "true",
    JEV_LOG_LEVEL: "error",
    JEV_MEMORY_PATH: path.join(root, "artifacts", "smoke-memory.json"),
  },
});

const client = new Client({ name: "jev-smoke", version: "0.0.0" });

function payload(result) {
  const text = result.content?.find((part) => part.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

let calls = 0;
async function call(name, args = {}) {
  calls++;
  const result = await client.callTool({ name, arguments: args });
  const data = payload(result);
  if (result.isError) {
    throw new Error(`tool ${name} returned an error: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data;
}

const checks = [];
function check(label, condition, detail = "") {
  assert.ok(condition, `${label} failed ${detail}`);
  checks.push(label);
}

await client.connect(transport);

try {
  // 1) Tool discovery
  const listed = await client.listTools();
  check("tools/list exposes >= 20 tools", listed.tools.length >= 20, `got ${listed.tools.length}`);
  const names = listed.tools.map((t) => t.name);
  for (const required of ["jev_evaluate", "jev_decide", "jev_plan", "jev_redteam", "jev_audit", "jev_guardrail"]) {
    check(`tool registered: ${required}`, names.includes(required));
  }

  // 2) Module 1: fan-out evaluator (3 primitives in one pass)
  const evaluated = await call("jev_evaluate", {
    requests: [
      { kind: "choice", question: "Which storage should the agent use for decisions?", options: ["postgres", "sqlite", "json file"], state: "offline first, single user" },
      { kind: "score", question: "How maintainable is the current module structure after tests=24 and typed boundaries?", min: 1, max: 10 },
      { kind: "noul", question: "Will this change cause a regression in production?", state: "covered by tests, atomic writes, deterministic" },
    ],
  });
  const choice = evaluated.results.find((r) => r.kind === "choice");
  const score = evaluated.results.find((r) => r.kind === "score");
  const noul = evaluated.results.find((r) => r.kind === "noul");
  check("evaluate returns 3 results", evaluated.results.length === 3);
  check("choice probabilities sum to 1", Math.abs(choice.probabilities.reduce((a, b) => a + b, 0) - 1) < 0.01);
  check("choice confidence == max probability", Math.abs(choice.confidence - Math.max(...choice.probabilities)) < 1e-9);
  check("score stays within [1,10]", score.score >= 1 && score.score <= 10);
  check("noul stays within [0,1]", noul.probability >= 0 && noul.probability <= 1);
  check("batch wall time recorded", typeof evaluated.stats.wallMs === "number");

  // 3) Gatekeeper decision persists to memory
  const decided = await call("jev_decide", {
    question: "Should the agent run npx tsc before committing?",
    options: ["run tsc first", "skip tsc", "run tests only"],
    persist: true,
  });
  check("decide returns a route", ["execute", "speculative", "system2"].includes(decided.decision.route));
  check("decide persists memory", decided.memoryRecorded === true);

  // 4) Module 2: planner
  const planned = await call("jev_plan", {
    goal: "Ship a deterministic offline decision layer behind the MCP server",
    preset: "software-architecture",
    context: ["repo: jev-x-kit", "constraint: zero budget", "constraint: offline first"],
  });
  check(
    "plan has 4 scored dimensions",
    Boolean(planned.dimensions?.feasibility && planned.dimensions?.risk && planned.dimensions?.cost && planned.dimensions?.maintainability),
  );
  check("plan has tasks", Array.isArray(planned.tasks) && planned.tasks.length >= 3);
  check("plan verdict has rationale", typeof planned.verdict?.rationale === "string");

  // 5) Module 3: red-team
  const red = await call("jev_redteam", {
    thesis: "We replace all frontier LLM calls with the local Jev decision layer",
    maxAntiTheses: 4,
  });
  check("redteam returns anti-theses", red.antiTheses.length >= 3);
  check("redteam arbitration picked a side", ["thesis", "anti-thesis"].includes(red.winner));
  check("redteam mitigations present", red.mitigations.length >= 1);

  // 6) Module 4: audit (scans this repo)
  const audit = await call("jev_audit", { root, preset: "software-architecture" });
  check("audit covers 5 dimensions", audit.dimensions.length === 5);
  check("audit scanned files", audit.scannedFiles > 5, `scanned=${audit.scannedFiles}`);
  check("audit produced ranked actions", audit.topActions.length >= 1);

  // 7) Module 5b: winnow compaction keeps anchors and drops noise losslessly
  const log = [
    "npm test",
    "PASS tests/core.test.mjs",
    "the weather is lovely this weekend indeed",
    "lorem ipsum dolor sit amet consectetur",
    "src/modules/jev-planner.ts",
    "Error: ECONNREFUSED 127.0.0.1:8000",
    "banana pancakes smell great on sundays",
    "https://example.com/docs/jev",
  ].join("\n");
  const compacted = await call("jev_compact", { text: log, goal: "port binding ECONNREFUSED error" });
  check("compaction kept command line", compacted.compacted.includes("npm test"));
  check("compaction kept error line", compacted.compacted.includes("ECONNREFUSED"));
  check("compaction kept file path", compacted.compacted.includes("src/modules/jev-planner.ts"));
  check("compaction kept url", compacted.compacted.includes("https://example.com/docs/jev"));
  check("compaction dropped noise lines", compacted.droppedLines >= 2, `dropped=${compacted.droppedLines}`);
  check("compaction reports anchor classes", compacted.preservedAnchors.length >= 3);
  const keptLines = compacted.compacted.split("\n").filter((l) => l.trim().length > 0 && !l.startsWith("..."));
  check(
    "compaction is lossless for kept lines",
    keptLines.every((line) => log.split("\n").includes(line)),
    JSON.stringify(keptLines),
  );

  // 8) Module 6: github miner on a local path (offline safe)
  const mined = await call("jev_github_mine", { repo: root });
  check("miner classified the local license", typeof mined.license?.spdx === "string");

  // 9) Module 7: training kit (no file writes in the smoke run)
  const labeled = await call("jev_label_dataset", {
    rows: ["tests are passing and coverage is 87%", "this crashes with a null pointer race condition"],
    mode: "score",
    writeFile: false,
  });
  check("labeler produced rows", labeled.labels.length === 2);
  const pairs = await call("jev_preference_pairs", {
    items: [{ prompt: "Explain the gatekeeper", candidates: ["It routes by calibrated confidence thresholds.", "idk"] }],
    writeFile: false,
  });
  check("preference pairs generated", pairs.pairs.length === 1);
  const recipe = await call("jev_distill_recipe", { target: "qwen2.5-0.5b" });
  check("distill recipe has commands", recipe.recipe.commands.length >= 3);

  // 10) Module 8: RLVR verification with a trivially green command
  const verified = await call("jev_verify", {
    commands: ['node -e "process.exit(0)"'],
    cwd: root,
    question: "smoke verification",
  });
  check("verify gives reward +1 on green", verified.reward === 1 && verified.passed === true);
  check("verify returns a policy update", typeof verified.policyUpdate?.reason === "string");

  // 11) Module 9: dispatcher + guardrail
  const dispatched = await call("jev_dispatch", { task: "Research free vector databases and write a comparison" });
  check("dispatch selected a role", typeof dispatched.role === "string");
  const blocked = await call("jev_guardrail", { tool: "bash", args: "rm -rf /" });
  check("guardrail blocks rm -rf /", blocked.decision === "block", blocked.reason);
  const allowed = await call("jev_guardrail", { tool: "bash", args: "npm test" });
  check("guardrail allows npm test", allowed.decision === "allow", allowed.reason);

  // 12) Module 10: sanitizer, rerank, edge cases, PR gate, catalog
  const sanitized = await call("jev_privacy_sanitize", {
    text: "contact me at dev@example.com with key sk-abcdefghijklmnop123 from 10.20.30.40",
  });
  check("sanitizer masked the email", sanitized.sanitized.includes("***@***"));
  check("sanitizer redacted the key", sanitized.sanitized.includes("REDACTED"));
  const reranked = await call("jev_rerank", {
    query: "how does the gatekeeper pick an execution route",
    documents: [
      "The gatekeeper routes by calibrated confidence thresholds: execute above 0.85.",
      "Recipes for Turkish breakfast include menemen and simit.",
      "Speculative escalation splits a decision into sub-questions.",
    ],
    topK: 2,
  });
  check("rerank keeps topK", reranked.kept.length === 2);
  const edge = await call("jev_edge_qa", { spec: "new login flow", count: 5 });
  check("edge qa generated cases", edge.cases.length === 5);
  const pr = await call("jev_pr_gate", {
    files: [{ file: "src/auth.ts", patch: '+ const apiKey = "sk-live-1234567890abcdef";\n-export function login() {}' }],
  });
  check("pr gate blocks secret + breaking change", pr.verdict === "block");
  const features = await call("jev_features");
  check("feature catalog has 20 items", features.features.length === 20);

  // 13) Backend info self-diagnosis
  const info = await call("jev_backend_info");
  check("backend info resolves a chain", Array.isArray(info.chain) && info.chain.length >= 1);
  check(
    "all 7 presets are available",
    info.presets.filter((p) => p.available).length === 7,
    JSON.stringify(info.presets.map((p) => p.available)),
  );

  // 14) Memory report after all the activity
  const memory = await call("jev_memory", { op: "report" });
  check("memory tracks decisions", memory.stats.decisions > 0);
  check("memory tracks verified wins", memory.stats.successes > 0);

  console.log(`\nSMOKE OK — ${checks.length} checks passed, ${calls} tool calls, ${listed.tools.length} tools exposed`);
  for (const label of checks) console.log(`  [ok] ${label}`);
} finally {
  await client.close();
}
