# jev-x-kit backend benchmark report

Generated: 2026-09-22T12:48:23.898Z

jev-x-kit is the constant measuring harness in this report — it is never one of the compared entries. The comparison is between the `JevBackend` implementations it can resolve (heuristic, laya_local and, only when run locally with a real key, typesafe_jev).

## Methodology

A fixed battery of 10 Choice/Score/Noul questions (5 choice, 3 score, 2 noul; the first 4 choice questions are reused verbatim from presets/calibration-sample.json) was run against every backend that this script could actually resolve and reach in the environment it ran in. Each backend was probed for real reachability first (a `.health()` call against its configured base URL); a backend that failed the probe is listed under Skipped instead of being scored, and no number is invented for it.

Latency is wall-clock per single (non-batched) primitive call, measured with `performance.now()` around the exact request. Calibration signals (confidence / probability / score / selected option) are whatever the backend actually returned — nothing here is a synthesized accuracy or quality number.

**Read this table for latency, not correctness.** `heuristic` is jev-x-kit's own deterministic $0 offline fallback — it is *supposed* to be near-instant and is *not* supposed to be factually smart (it has no real knowledge, only cheap text heuristics), so a low latency + wrong answers here is expected, not a defect. It is easy to misread this as "the fast backend is inaccurate" and assume that's LayA — it is not; LayA is a separate row (or a Skipped entry, see below) and was never confused with heuristic in this data.

## LayA — verification finding

LayA is real: an open-source, self-hosted, non-autoregressive typed-decision model (ModernBERT-large encoder + an RLCD-trained decision head) published at [github.com/NandhaKishorM/laya](https://github.com/NandhaKishorM/laya) and [huggingface.co/convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya), installable with `pip install laya` and served locally with `python -m laya.serve --port 8000` (matching this repo's own `src/core/config.ts` comment for `LAYA_BASE_URL`). It speaks the same choice/score/noul primitives as Jev.

It is **self-hosted only** — the project does not publish an official hosted production endpoint. A web search surfaced one third-party mirror (`laya.inference.zaitlabs.com`) claiming to proxy LayA with no account or API key required; this environment's network egress proxy blocked that domain outright (`EGRESS_BLOCKED`) when this script's author attempted to inspect it, and — independent of that block — it is an unaffiliated, unverified third party, not the LayA maintainers' own infrastructure, so it was not treated as a trustworthy `laya_local` endpoint for this benchmark even in principle. `config.laya.baseUrl` defaults to `http://localhost:8000/v1`, which is exactly what this script probed and found unreachable (see Skipped below): nothing is listening there in this cloud sandbox.

## Cerebellum — verification finding

The real `cerebellum-ai` npm package / `theredsix/cerebellum` GitHub repo exists, but it is a **browser-automation** library (Selenium-driven page navigation planned by an LLM, Claude 3.5 Sonnet only) with no Choice/Score/Noul interface at all, and its own README marks it **deprecated** in favor of `theredsix/agent-browser-protocol`. It cannot implement the `JevBackend` contract (`meta`/`health`/`choice`/`score`/`noul`/`batch`) without inventing an integration that does not exist upstream, so per this task's instructions it was **not** wired in as a benchmarkable backend. There is no real Cerebellum row in this report, and none should be fabricated.

## Results

| backend | label | local | synthetic | avg latency (ms) | avg confidence | errors |
|---|---|---|---|---|---|---|
| heuristic | Deterministic offline Jev simulator (free, no network) | true | true | 0.27 | 0.4834 | 0 |
| typesafe_jev | TypeSafe Jev API (POST /v1/systemone) | false | false | 347.91 | 0.913 | 0 |

### heuristic — per-question detail

| # | kind | question | latency (ms) | confidence | probability | score | selected |
|---|---|---|---|---|---|---|---|
| 1 | choice | What is the capital of France? | 1.27 | 0.25309 |  |  | Berlin |
| 2 | choice | Which of these numbers is prime? | 0.1 | 0.25391 |  |  | 7 |
| 3 | choice | Which planet is closest to the sun? | 0.07 | 0.252264 |  |  | Earth |
| 4 | choice | In HTTP, which status code means 'not found'? | 0.04 | 0.256094 |  |  | 301 |
| 5 | choice | Which storage fits an offline-first, single-user MCP agent? | 0.35 | 0.340318 |  |  | hosted mongo |
| 6 | score | How maintainable is a module with 95% test coverage and type | 0.23 | 0.97 |  | 10 |  |
| 7 | score | Severity of the worst plausible outcome if this tool call ex | 0.03 | 0.6217 |  | 5.396 |  |
| 8 | score | Clarity of this ad copy on a 1-10 scale. | 0.06 | 0.658 |  | 5.318 |  |
| 9 | noul | Will this change cause a regression in production? | 0.43 | 0.99 | 0.0386 |  |  |
| 10 | noul | Does this action irreversibly alter external state, data or  | 0.11 | 0.239 | 0.4555 |  |  |

### typesafe_jev — per-question detail

| # | kind | question | latency (ms) | confidence | probability | score | selected |
|---|---|---|---|---|---|---|---|
| 1 | choice | What is the capital of France? | 860.48 | 1 |  |  | Paris |
| 2 | choice | Which of these numbers is prime? | 305.66 | 1 |  |  | 7 |
| 3 | choice | Which planet is closest to the sun? | 276.19 | 1 |  |  | Mercury |
| 4 | choice | In HTTP, which status code means 'not found'? | 314.52 | 1 |  |  | 404 |
| 5 | choice | Which storage fits an offline-first, single-user MCP agent? | 286.42 | 1 |  |  | sqlite |
| 6 | score | How maintainable is a module with 95% test coverage and type | 304.86 | 0.65 |  | 8.47 |  |
| 7 | score | Severity of the worst plausible outcome if this tool call ex | 263.54 | 0.94 |  | 9.84 |  |
| 8 | score | Clarity of this ad copy on a 1-10 scale. | 293.23 | 0.64 |  | 8.56 |  |
| 9 | noul | Will this change cause a regression in production? | 316.32 | 0.91 | 0.12 |  |  |
| 10 | noul | Does this action irreversibly alter external state, data or  | 257.9 | 0.99 | 0.02 |  |  |

## Sequential calls vs jev-x-kit's `batch()` — is the kit actually speeding things up?

Same battery, two ways of driving the same backend: `sequential` calls `.choice()/.score()/.noul()` once per question, one at a time — what a naive integration looks like *without* using jev-x-kit's fan-out. `batch()` sends the whole battery through jev-x-kit's own `backend.batch()` in one call — same-state questions merge into a single HTTP request (see `typesafe-native.ts`'s state-grouping) and different-state questions run concurrently. This isolates the kit's own contribution from raw network/model latency.

| backend | sequential total (ms) | batch() total (ms) | speedup |
|---|---|---|---|
| heuristic | 2.69 | 0.36 | 7.47x |
| typesafe_jev | 3479.12 | 820.92 | 4.24x |

## Skipped

- **laya_local**: health check to http://localhost:8000/v1/models did not return 200
