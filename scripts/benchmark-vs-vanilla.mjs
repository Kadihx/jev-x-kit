#!/usr/bin/env node
/**
 * Benchmark: jev_research (this repo) vs. "vanilla" Claude Code doing the
 * same research task by hand (WebSearch/WebFetch + inline reasoning, no
 * local decision layer).
 *
 * This does NOT fabricate numbers. Every figure below is either:
 *   (a) measured directly from a real run against real free APIs
 *       (Wikipedia, arXiv, GitHub, npm, Hacker News), or
 *   (b) derived from this repo's own real crawled corpus (research-hub.sqlite,
 *       105 real documents, average word count per source taken from
 *       `npm run hub -- stats`), used as an empirical stand-in for "the size
 *       of a typical web page Claude would have to WebFetch and read".
 * Anything that is an assumption rather than a measurement is labeled ASSUMPTION.
 *
 * Usage: node scripts/benchmark-vs-vanilla.mjs "<research query>"
 */

import { createContext } from "../dist/tools/registry.js";

const AVG_TOKENS_PER_WORD = 1.3; // standard rough English heuristic, not Claude-billing-exact
const ASSUMPTION_SECONDS_PER_MANUAL_TURN = 3; // conservative: one WebFetch + Claude reading + judging one source

// Real, measured average words/doc for 3 real crawled web sources (from
// `node dist/hub-cli.js stats` on this repo's actual research-hub.sqlite —
// sivers 41918/15, julian 43709/15, wikibooks 43418/14 words/doc).
const REAL_AVG_WORDS_PER_WEBPAGE = Math.round((41918 / 15 + 43709 / 15 + 43418 / 14) / 3);

async function main() {
  const query = process.argv.slice(2).join(" ") || "rate limiting strategies for a public REST API";
  console.log(`Query: "${query}"\n`);

  const ctx = await createContext();
  const started = Date.now();
  const brief = await ctx.researcher.research(query, { maxHits: 12 });
  const wallClockMs = Date.now() - started;

  const candidatesConsidered = brief.hits.length;
  const returnedToClaudeJson = JSON.stringify(brief);
  const returnedToClaudeChars = returnedToClaudeJson.length;
  const returnedToClaudeTokensEst = Math.round((returnedToClaudeChars / 4)); // chars/4, standard rough estimate

  const naiveFullPageWordsTotal = candidatesConsidered * REAL_AVG_WORDS_PER_WEBPAGE;
  const naiveTokensEst = Math.round(naiveFullPageWordsTotal * AVG_TOKENS_PER_WORD);

  const jevToolCalls = 1;
  const manualToolCalls = candidatesConsidered; // one WebFetch/WebSearch per candidate, minimum
  const manualSecondsEst = manualToolCalls * ASSUMPTION_SECONDS_PER_MANUAL_TURN;

  console.log("=== MEASURED (real run, this machine, right now) ===");
  console.log(`  channels queried:              ${brief.channels.join(", ")}`);
  console.log(`  candidates fetched+ranked:      ${candidatesConsidered}`);
  console.log(`  wall-clock (jev_research):      ${wallClockMs} ms`);
  console.log(`  bytes returned to Claude:       ${returnedToClaudeChars} chars (~${returnedToClaudeTokensEst} tokens, chars/4 est.)`);
  console.log(`  answer source:                  ${brief.synthesis.source}`);
  console.log();
  console.log("=== DERIVED FROM THIS REPO'S REAL CORPUS ===");
  console.log(`  real avg words/page (3 crawled sources): ${REAL_AVG_WORDS_PER_WEBPAGE}`);
  console.log(`  naive "Claude reads every candidate":    ~${naiveTokensEst.toLocaleString()} tokens`);
  console.log();
  console.log("=== ASSUMPTION-LABELED (not measured) ===");
  console.log(`  manual tool calls (1/candidate):         ${manualToolCalls}`);
  console.log(`  @ ${ASSUMPTION_SECONDS_PER_MANUAL_TURN}s/turn assumption ->        ~${manualSecondsEst}s wall-clock`);
  console.log();
  console.log("=== RATIOS ===");
  console.log(`  token reduction:   ${(naiveTokensEst / Math.max(returnedToClaudeTokensEst, 1)).toFixed(1)}x fewer tokens hit Claude's context`);
  console.log(`  tool-call count:   ${manualToolCalls}x fewer tool round-trips (${jevToolCalls} vs ${manualToolCalls})`);
  console.log(`  wall-clock:        ${(manualSecondsEst / (wallClockMs / 1000)).toFixed(1)}x faster (measured jev vs assumption-based manual)`);

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
