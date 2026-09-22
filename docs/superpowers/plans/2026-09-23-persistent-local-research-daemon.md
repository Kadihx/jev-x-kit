# Persistent, Local, Learning Research Daemon — Architecture Plan

> Not yet implemented. This captures the architecture Burak asked to save
> tonight (2026-09-23) before building it. Tonight's `scripts/deep-repo-research.mjs`
> is a real, working ONE CYCLE of this — the plan below is about wrapping it
> (and `jev_research`) into something that runs forever, costs ~$0, and gets
> smarter about what it scans instead of repeating the same 30 queries blindly.

## Goal

A research process that runs **continuously on Burak's machine, outside any
Claude Code conversation**, so it never spends Claude Code tokens. When
Claude Code is later asked about findings, it reads a cheap local summary
instead of re-running research. Over time the system should get *better* at
choosing what to scan next, not just repeat a fixed list forever.

## What already exists and gets reused (no new concept)

- `CompetitorScanner` (`src/modules/jev-competitor-scan.ts`) — paginated
  GitHub search + Noul relevance scoring + LLM synthesis. Tonight's one-shot
  script already wraps this into "scan N topics, README-deep-dive the
  non-rejected hits." This becomes the **cycle body**.
- `DeepResearcher` / `jev_research` — 4-channel (web/academic/code/social)
  research, usable the same way for non-GitHub topics.
- `src/datacenter/crawler.ts` — already has a real scheduled-window pattern
  (nightly 02:00–06:00 Europe/Berlin) for the Research Hub. The daemon's
  scheduler should copy this pattern, not invent a new one.
- `config.llm.baseUrl` already **defaults to `http://localhost:11434/v1`**
  (Ollama) — every LLM synthesis step in the kit is already local-model-first
  by default. No code change needed for "use a local model instead of
  Claude/paid APIs" — it's already the default; it only becomes
  paid/Anthropic if someone explicitly points `JEV_LLM_BASE_URL` elsewhere.
- `BackendProviderId` already includes `openjev_local` / `laya_local` / the
  $0 heuristic fallback for the Choice/Score/Noul primitives themselves —
  the daemon should default `JEV_BACKEND_PROVIDER` to one of these (not
  `auto`, which currently prefers the paid-but-cheap `typesafe_jev`) so a
  24/7 process never bills anything by default.
- `SelfImprover` / RLVR (`jev_memory`) — the kit's existing pattern for
  "track real outcomes, auto-tune thresholds from them." The yield-tracking
  piece below is the same idea applied to research topics instead of
  gatekeeper confidence.

## New pieces needed

### 1. Outer scheduler (recurring, not one-shot)
Wrap `deep-repo-research.mjs`'s per-topic cycle body in an outer loop that
runs indefinitely: sleep until the next scheduled window (reuse
`datacenter/crawler.ts`'s window-check pattern), run one cycle over the
current topic list, sleep again. A plain long-lived `node` process (started
once, e.g. via Windows Task Scheduler "run at logon" or just left running),
**not** a Claude Code session and **not** a cloud routine — it must survive
without Claude Code open at all.

### 2. Cross-cycle dedup index
Right now a re-run rescans and re-README-fetches repos it already saw.
Needs a small persistent index (reuse the Research Hub's SQLite pattern —
one more table, not a new database) keyed by `fullName`, storing:
last-seen date, tier, usefulness score. Each cycle only deep-dives repos not
already indexed (or re-checks ones whose `pushedAt` changed since last seen,
since an active repo may have become more relevant).

### 3. Yield-based topic weighting ("learning" part)
Store per-topic history: how many VERIFIED/PROBABLE hits it produced last
N cycles. Topics with a rising or high hit rate get more pages/deeper
dives next cycle; topics that keep returning REJECTED-only get fewer pages
(down to a floor, never fully dropped — a dead query this month can wake up
later). This is a simple multi-armed-bandit-style adaptation, not a new ML
model — reuses the same Score primitive already in the kit to rate "was this
cycle's yield for topic X good" and feeds that into next cycle's page-count
per topic.

### 4. Local-model-first run profile
A documented env profile for 24/7 use:
`JEV_BACKEND_PROVIDER=openjev_local` (or `laya_local` once confirmed
reachable), `JEV_LLM_BASE_URL` left at its Ollama default. `typesafe_jev`
stays available as an opt-in **spot-check** pass (e.g., once a day, re-score
the day's top N candidates with the real backend to catch cases where the
local/heuristic backend was miscalibrated) rather than the default for every
call.

### 5. Cheap read-side for Claude Code
A small CLI query command (same shape as `hub-cli.ts query`) that lets a
future Claude Code session ask "what did the daemon find about X" and get
back the persisted top hits directly from the index/SQLite — one fast local
read, zero re-scanning, zero extra Claude tokens spent re-deriving anything
the daemon already figured out.

## Relationship to tonight's script

`scripts/deep-repo-research.mjs` (already running, one-shot, 3 categories ×
10 topics) is not thrown away — it becomes the cycle body called by the
scheduler in (1), once (2)-(3) are added so repeated cycles don't redo
finished work and start adapting which topics get attention.

## Explicit non-goals

- Not a Claude Code loop, not a scheduled cloud routine (`RemoteTrigger`) —
  those still cost tokens/billing per run and require an active session or
  Anthropic-side compute; the whole point is a local, free, always-on process.
- Not a new ML model or training run — "learning" here means adaptive query
  weighting + a growing indexed knowledge base, both already-existing jev-x-kit
  patterns (RLVR-style calibration, Research Hub persistence), not a new
  research direction.
