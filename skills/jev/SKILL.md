---
name: jev
description: Use when a coding agent needs a fast, $0 micro-decision (yes/no routing, confidence-gated execution), an adversarial plan review, a 4-channel research pass, lossless log compaction, or a repo/PR audit instead of ad-hoc free-text reasoning. Symptoms - "should I retry or escalate", "sanity-check this plan", "compact this giant log without losing paths/commands", "audit this repo before merge".
---

# Jev — offline decision layer

Wraps the Jev CLI (`node dist/cli.js <command>`, built from this repo) so routine
micro-decisions run through schema-validated primitives instead of free text.

## When to reach for which command

| Need | Command |
|---|---|
| Yes/no or multi-option routing with a confidence score | `decide "<question>" --options "a,b,c"` |
| Sanity-check / stress-test a plan before executing it | `redteam "<plan or assumption>"` |
| Multi-step plan with hypothesis + anti-thesis scoring | `plan "<goal>" --preset <preset>` |
| Shrink a huge log/context without losing paths, commands, errors | `compact --file <path> --goal "<what to keep>"` |
| Web/academic/code/social research, Jev-ranked | `research "<topic>"` |
| Repo-wide architecture/security/legal/budget scan | `audit <path>` |
| Discover/rank Claude Skills for a task (installed + catalog) | `skills "<task>" [--online]` |
| Pre-execution guardrail for a risky tool call | `guardrail --tool <tool> --args "<args>"` |
| Run tsc+tests and record a reward for self-tuning | `verify --cwd .` |
| TRL/GRPO reward from helpfulness - toxicity | `rljf --file <json with {prompts, completions}>` |
| Guardrail an agent action against its allowed scope | `scope-judge --intent "<intent>" --action "<action>" --rules "rule1\|rule2"` |
| Triage ad copy variants or a sales-call transcript | `marketing --mode ad_copy --variants "v1\|v2"` / `--mode sales_call --transcript "<chunk>"` |
| Score us vs competitors across derived dimensions | `competitor-matrix --file <json with {ourProductDescription, competitorTexts}>` |
| Route a command-bar/voice/chatbot request local vs System-2 | `jarvis-triage "<request>" [--state "<context>"]` |
| Extract a PROJECT_PLAN.md checklist from an agent chat log | `jarvis-auto-plan --file <log path> [--goal "<focus>"] [--writeTo PROJECT_PLAN.md]` |

Run `node dist/cli.js features` for the full feature catalog and
`node dist/cli.js info` to see which backend (local LLM / heuristic) is active.

## Notes

- 100% offline-capable: no API key or GPU required, deterministic heuristic
  backend is always available as a fallback.
- If an MCP server is configured (see this plugin's `mcpServers` entry), prefer
  the equivalent `jev_*` tools over shelling out to the CLI.
- Full command/tool reference: `README.md` at the repo root.
