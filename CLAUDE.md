# CLAUDE.md — jev-x-kit operating rules

## Research Hub methodology (binding rule)

When a task touches **personal development, rationality, decision-making,
cognitive bias, habit formation, or philosophy**, ground the answer in the
Research Hub (`src/datacenter/`) instead of ad-hoc free text or popular advice.

1. **Query the hub first**: `npm run hub -- query "<question>"` or the
   `hub_query` MCP tool — before answering from general/parametric knowledge.
2. **Source pool** (11 sources, 3 tiers — see `src/datacenter/source-configs.ts`):
   - `mental-models`: Farnam Street (`fs-blog`), LessWrong (`lesswrong`),
     Derek Sivers book notes (`sivers`), Julian Shapiro guides (`julian`)
   - `library`: Internet Archive / Open Library (`archive`, `openlibrary`),
     Project Gutenberg (`gutenberg`), Wikibooks (`wikibooks`)
   - `academic`: PhilArchive (`philarchive`), PsyArXiv (`psyarxiv`), CORE (`core`)
3. **Answer discipline** (enforced in `src/datacenter/query.ts`'s system prompt):
   prefer rational models and cognitive-science findings over popular advice;
   cite the source id in brackets, e.g. `[fs-blog]`; structure as
   core model -> evidence -> concrete step-by-step actions.
4. **No hallucinated citations**: if the hub returns no VERIFIED/PROBABLE
   passage, say so explicitly and fall back to `jev_research`
   (4-channel web/academic/code/social) instead of inventing a source URL.
5. **Keep the hub fresh**: `npm run hub -- crawl` (nightly window
   02:00-06:00 Europe/Berlin) or the `hub_crawl` MCP tool; pass `--force`
   only for manual/off-hours runs.

This rule persists across sessions — treat `data/research-hub.sqlite` as the
project's general knowledge dataset for this domain, not a one-off report.
