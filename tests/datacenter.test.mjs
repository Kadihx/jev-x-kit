/**
 * No-network verification suite for the data center.
 * Everything here runs offline: URL gating (robots parser), license engine,
 * store/dedupe logic, FTS ranking, hour windows and query-engine ranking with
 * the deterministic heuristic backend.
 *
 * Run: npm run build && npm run test:hub
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.JEV_LLM_DISABLED = "true";
const tmpDb = path.join(os.tmpdir(), `hub-test-${process.pid}.sqlite`);
process.env.HUB_DB_PATH = tmpDb;

const { SOURCES, getSource, isWithinHours, sourcesByCategory } = await import(
  "../dist/datacenter/source-configs.js"
);
const { isAllowed } = await import("../dist/datacenter/robots.js");
const { checkLicense } = await import("../dist/datacenter/license-engine.js");
const { HubStore } = await import("../dist/datacenter/store.js");
const { queryHub } = await import("../dist/datacenter/query.js");
const { HeuristicBackend } = await import("../dist/core/providers/heuristic.js");
const { System2Client } = await import("../dist/core/llm.js");

test("registry lists all 11 curated sources across 3 tiers", () => {
  assert.equal(SOURCES.length, 11);
  const ids = SOURCES.map((s) => s.id).sort();
  for (const expected of [
    "fs-blog", "lesswrong", "sivers", "julian",
    "openlibrary", "archive", "gutenberg", "wikibooks",
    "philarchive", "psyarxiv", "core",
  ]) {
    assert.ok(ids.includes(expected), `missing source: ${expected}`);
  }
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(sourcesByCategory("mental-models").length, 4);
  assert.equal(sourcesByCategory("library").length, 4);
  assert.equal(sourcesByCategory("academic").length, 3);
});

test("every source has discovery URLs, selectors and a crawl window", () => {
  for (const source of SOURCES) {
    assert.ok(source.discovery.length >= 1, `${source.id}: discovery missing`);
    assert.ok(source.selectors.card.length > 0, `${source.id}: card selector missing`);
    assert.ok(source.selectors.content.length > 0, `${source.id}: content selector missing`);
    assert.ok(source.policy.rateLimitMs >= 2000, `${source.id}: rate limit too aggressive`);
    assert.ok(source.policy.hours[0] === 2 && source.policy.hours[1] === 6, `${source.id}: window must be 02:00-06:00 Berlin`);
    assert.ok(source.policy.userAgent.includes("jev-research-archive"), `${source.id}: UA must identify the crawler`);
  }
});

test("nightly window is 02:00-06:00 Europe/Berlin", () => {
  const inWindow = new Date("2026-01-15T03:30:00+01:00");
  const outWindow = new Date("2026-01-15T14:00:00+01:00");
  assert.equal(isWithinHours([2, 6], inWindow), true);
  assert.equal(isWithinHours([2, 6], outWindow), false);
  assert.equal(isWithinHours([2, 6], new Date("2026-06-15T03:30:00+02:00")), true);
});

test("robots gate rejects malformed URLs without network", async () => {
  const bad = await isAllowed("not a url", "jev-research-archive/0.1");
  assert.equal(bad.allowed, false);
});

test("license engine: Gutenberg public domain, academic metadata-only", () => {
  const gutenberg = getSource("gutenberg");
  const full = checkLicense(gutenberg, {
    title: "Meditations — Marcus Aurelius",
    url: "https://www.gutenberg.org/ebooks/2680",
    content: "x".repeat(100),
  });
  assert.equal(full.decision, "full");
  assert.ok((full.license ?? "").includes("public-domain"));

  const phil = getSource("philarchive");
  const meta = checkLicense(phil, { title: "On practical reason", url: "https://philarchive.org/rec/XYZ", content: "x".repeat(100) });
  assert.equal(meta.decision, "metadata-only");

  const ol = getSource("openlibrary");
  const olMeta = checkLicense(ol, { title: "Some modern book", url: "https://openlibrary.org/books/OL1M", content: "x".repeat(100) });
  assert.equal(olMeta.decision, "metadata-only");

  const fsb = getSource("fs-blog");
  const page = checkLicense(fsb, { title: "Second-order thinking", url: "https://fs.blog/second-order-thinking/", content: "x".repeat(100) });
  assert.equal(page.decision, "full");
});

test("store: upsert dedupe by hash, FTS ranking, stats", () => {
  const store = new HubStore(tmpDb);
  const doc = {
    source: "fs-blog",
    url: "https://fs.blog/second-order-thinking/",
    title: "Second-Order Thinking",
    content: "second order thinking means considering consequences of consequences rationality mental models",
    content_hash: "aaa",
  };
  assert.equal(store.upsert(doc), "inserted");
  assert.equal(store.upsert(doc), "unchanged");
  assert.equal(
    store.upsert({ ...doc, title: "Second-Order Thinking (revised)", content: "second order thinking revised edition with new examples rationality", content_hash: "bbb" }),
    "updated",
  );
  store.upsert({
    source: "sivers",
    url: "https://sive.rs/bookX",
    title: "Cooking for Focus",
    content: "recipes and kitchen tips unrelated to cognition",
    content_hash: "ccc",
  });

  const ranked = store.search("second order thinking rationality");
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].url, "https://fs.blog/second-order-thinking/");

  const stats = store.stats();
  assert.equal(stats.total, 2);
  assert.ok(stats.sources.some((s) => s.source === "fs-blog" && s.docs === 1));

  store.markQuality("https://fs.blog/second-order-thinking/", 9, true);
  const recent = store.listRecent(5);
  const marked = recent.find((d) => d.url === "https://fs.blog/second-order-thinking/");
  assert.ok(marked, "marked document must be listed");
  assert.equal(marked.quality_score, 9);
  assert.equal(marked.verified, 1);

  const runId = store.beginRun(["fs-blog"]);
  store.finishRun(runId, []);
  assert.equal(store.runs(5).length, 1);
  store.close();
});

test("query engine: FTS + Jev ranking tiers passages offline", async () => {
  const store = new HubStore(tmpDb);
  const backend = new HeuristicBackend();
  const llm = new System2Client({ baseUrl: "http://localhost:9", model: "none", timeoutMs: 500, enabled: false });
  const answer = await queryHub("second order thinking rationality", { store, backend, llm }, { topK: 2 });
  assert.ok(answer.passages.length >= 1);
  assert.ok(["VERIFIED", "PROBABLE", "REJECTED"].includes(answer.passages[0].tier));
  assert.equal(answer.answer.source, "offline-fallback");
  assert.ok(answer.answer.citations.length >= 1);
  assert.ok(answer.latencyMs >= 0);
  store.close();
  // Windows holds the sqlite file briefly after close; retry the cleanup.
  for (let attempt = 0; attempt < 10 && fs.existsSync(tmpDb); attempt++) {
    try {
      fs.rmSync(tmpDb, { force: true });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
});
