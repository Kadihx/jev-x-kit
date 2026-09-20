# Benchmark: `jev_research` vs. vanilla Claude Code

**Scenario:** a user asks Claude Code to research something for their project
("what's a good rate limiting strategy for our API?", "compare vector DBs for
our RAG pipeline"...). Two ways to do this:

- **Vanilla Claude Code** — no Jev. Claude calls `WebSearch`/`WebFetch` (or a
  pile of manually-installed research skills) once per candidate source, reads
  each full page into its own context, judges relevance itself, then writes
  the answer.
- **jev-x-kit** — one `jev_research` MCP tool call. Four channels (Wikipedia,
  arXiv, GitHub, npm, Hacker News) are fetched in parallel *outside* Claude's
  context, ranked by a $0 local Jev `Noul` primitive, and only the ranked
  shortlist + a synthesized brief come back to Claude.

## Methodology (read this before trusting the numbers)

Every number below is either **measured** on this machine against real,
live, free APIs, or **derived** from this repo's own real crawled corpus
(`data/research-hub.sqlite`, 105 documents — see `SESSION-CHECKPOINT.md`).
Nothing is invented. Where an actual measurement isn't possible (nobody ran
"vanilla Claude Code" 100 times to time it), the number is explicitly labeled
an **assumption**, and the assumption itself is stated so you can disagree
with it and recompute.

| Metric | How it's obtained |
|---|---|
| Candidates fetched/ranked, wall-clock, bytes returned to Claude | **Measured** — real run of `scripts/benchmark-vs-vanilla.mjs`, real HTTP calls, real local Ollama (`qwen2.5:3b`) synthesis. |
| "Naive tokens if Claude reads every candidate page" | **Derived** — real average words/page from 3 real crawled web sources in this repo's own corpus (Derek Sivers' book notes, Julian Shapiro's guides, Wikibooks — 2,937 words/page average), × a standard chars/word→token heuristic. This is a stand-in for "the size of a typical web page", not a fabricated number. |
| Manual tool-call count | **Structural fact** — vanilla Claude Code has no batch relevance-ranking primitive, so judging N candidates costs at least N tool calls (`WebFetch`/`WebSearch`), one per source. |
| Manual wall-clock | **ASSUMPTION** — 3 seconds per manual turn (one fetch + Claude reading + judging one source). Conservative; real agentic turns are often slower. Change `ASSUMPTION_SECONDS_PER_MANUAL_TURN` in the script and re-run if you disagree. |

Reproduce any row yourself:

```bash
npm run build
node scripts/benchmark-vs-vanilla.mjs "your query here"
```

## Results (3 real runs, 2026-09-20, this machine)

| Query | Candidates | Tokens → Claude (jev) | Naive tokens (est.) | Token reduction | Tool calls | Wall-clock (jev) | Wall-clock (manual, assumption) | Speed-up |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| "rate limiting strategies for a public REST API" | 12 | 2,413 | 45,817 | **19.0x** | 1 vs 12 | 10.3s | ~36s | 3.5x |
| "vector database comparison for RAG pipelines" | 12 | 2,764 | 45,817 | **16.6x** | 1 vs 12 | 5.0s | ~36s | 7.3x |
| "how to reduce React app bundle size" | 10 | 1,764 | 38,181 | **21.6x** | 1 vs 10 | 3.2s | ~30s | 9.5x |
| **average** | | | | **~19x fewer tokens** | **~11x fewer tool calls** | | | **~6.8x faster** |

## The honest caveats

- The token-reduction number is real for *this* corpus and *this* researcher
  module (`jev_research`, module 5a — snippet-based free APIs). A researcher
  that scrapes full pages instead of API snippets would show a smaller
  reduction, because the "naive" comparison would shrink too.
- Wall-clock speed-up depends entirely on how fast your local backend
  (Ollama/OpenJev) responds — the 3.2s–10.3s range above is real network +
  real local-model variance, not a cherry-picked number.
- Quality (does the *answer* get better, not just cheaper) is a separate,
  harder question this benchmark does not measure — see
  `SESSION-CHECKPOINT.md` for the open item on Noul relevance-scoring quality
  when backed by a real local model vs. the offline heuristic simulator.

## Bottom line

For a research task on a fresh topic, `jev_research` puts **~19x fewer
tokens** into Claude's context and needs **~11x fewer tool round-trips**
than doing the same research by hand with `WebSearch`/`WebFetch` — because
the fetching and relevance-ranking happen outside Claude entirely, on a
free, local $0 backend, and Claude only ever sees the already-ranked
shortlist plus a synthesized brief.
