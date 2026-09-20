# Contributing to jev-x-kit

## Setup

```bash
git clone https://github.com/Kadihx/jev-x-kit.git
cd jev-x-kit && npm install && npm run build
npm test && npm run test:hub && npm run smoke
```

All three commands must pass with zero network, zero GPU and zero API key
(the deterministic offline simulator is the fallback for every backend).

## Before opening a PR

- `npm run build` — strict TypeScript, zero warnings.
- `npm test` — 27 unit tests (core + datacenter) must stay green.
- `npm run smoke` — 50-check end-to-end MCP client test.
- Add a test for new modules/tools under `tests/` — see `tests/core.test.mjs`
  and `tests/datacenter.test.mjs` for the existing patterns (`node:test`,
  no external test framework).
- New MCP tools go in `src/tools/registry.ts` and must have a
  `description` that states *when* to use the tool, not just what it does
  (Claude reaches for tools more reliably with prescriptive descriptions).

## Project structure

```
src/
  cli.ts  index.ts  hub-cli.ts   # CLI + MCP server + research-hub CLI
  core/       config, backend providers, fanout, gatekeeper, memory
  modules/    the 10 blueprint modules (planner, red-team, audit, ...)
  tools/      registry.ts — MCP tool definitions
  datacenter/ research-hub crawler/store/query engine
```

## Reporting bugs / requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. Include the output
of `node dist/cli.js info` (backend chain diagnosis) for anything
backend-related.

## License

By contributing, you agree your contributions are licensed under the MIT
License (see `LICENSE`).
