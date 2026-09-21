# jev_skill_router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `jev_skill_router` MCP tool + `jev skills` CLI command that discovers installed and catalog-available Claude Code Skills and ranks them for a task using the existing Jev Score primitive + BELKİ zone semantics — plus fix `install-mcp.js` to also register jev-x-kit with Claude Code itself.

**Architecture:** New module `src/modules/jev-skill-router.ts` (`SkillRouter` class) does local filesystem discovery (project/user/plugin `SKILL.md` files), local marketplace-catalog discovery (`marketplace.json` + `install-counts-cache.json`), an optional explicit online fallback fetch of Anthropic's public catalog, and a two-stage rank (free token-overlap pre-filter → batched `backend.score`). It's wired into the existing `AppContext`/tool-registry/CLI patterns used by every other module — no new runtime dependencies.

**Tech Stack:** TypeScript (existing `tsc` build), Node built-ins only (`fs`, `path`, `os`, `https`, `child_process`), `node:test` for unit tests.

**Deviation from the approved spec (caught during planning, noted here for transparency):** the spec said the remote fallback catalog fetch could trigger *automatically* when zero local marketplaces exist. That would make `smoke-test.mjs` (and CI, which has no `~/.claude`) silently hit the network. Changed to: **the remote fetch only ever happens when the caller explicitly passes `online: true`.** Fully offline by default, matching the kit's own "100% offline-capable" claim. Not in scope: `site/app/page.tsx`'s "28 tools" marketing copy (separate Next.js app/deploy, tracked as a follow-up, not touched here).

---

### Task 1: Types

**Files:**
- Modify: `src/core/module-types.ts`

- [ ] **Step 1: Append the skill-router types to the end of the file**

```ts
/* Module — Claude Skills discovery & routing ------------------------------ */

export type SkillSource = "self" | "project" | "user" | "plugin-cache" | "plugin-marketplace";

export interface SkillEntry {
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  installed: true;
}

/**
 * One marketplace-listed plugin not yet installed locally. Represents a whole
 * plugin (marketplace.json granularity, which may bundle >=1 skill) — we only
 * have plugin-level metadata for anything we haven't installed.
 */
export interface CatalogSkillEntry {
  name: string;
  description: string;
  marketplace: string;
  homepage?: string;
  uniqueInstalls?: number;
  /** True when this entry came from the public fallback fetch, not a local marketplace.json. */
  viaRemoteFallback: boolean;
  installed: false;
}

export interface SkillMatch<T> {
  entry: T;
  relevance: ScoreResult;
  installCommand?: string[];
}

export interface SkillRouterReport {
  task: string;
  zone: "execute" | "speculative";
  matches: Array<SkillMatch<SkillEntry>>;
  catalogMatches: Array<SkillMatch<CatalogSkillEntry>>;
  scannedDirs: string[];
  usedRemoteCatalog: boolean;
  latencyMs: number;
}
```

- [ ] **Step 2: Build to confirm no type errors**

Run: `npm run build`
Expected: exits 0, no output (tsc is silent on success).

- [ ] **Step 3: Commit**

```bash
git add src/core/module-types.ts
git commit -m "feat: add SkillEntry/CatalogSkillEntry/SkillRouterReport types"
```

---

### Task 2: SkillRouter — local + catalog discovery

**Files:**
- Create: `src/modules/jev-skill-router.ts`
- Test: `tests/skill-router.test.mjs`

- [ ] **Step 1: Write the failing test for local discovery + catalog discovery**

Create `tests/skill-router.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { discoverInstalledSkills, discoverCatalogSkills } = await import(
  "../dist/modules/jev-skill-router.js"
);

function mkSkill(dir, name, description) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf8",
  );
}

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jev-skill-router-home-"));
}

test("discoverInstalledSkills finds project + user + plugin skills and dedups by name", () => {
  const home = tmpHome();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "jev-skill-router-project-"));
  mkSkill(path.join(cwd, ".claude", "skills", "proj-skill"), "proj-skill", "Handles project-local things");
  mkSkill(path.join(home, ".claude", "skills", "user-skill"), "user-skill", "Handles user-level things");
  mkSkill(
    path.join(home, ".claude", "plugins", "cache", "mp", "plugin-a", "1.0.0", "skills", "cached-skill"),
    "cached-skill",
    "Lives under the plugin cache tree",
  );
  // Malformed SKILL.md (no frontmatter) must be skipped, not crash the scan.
  fs.mkdirSync(path.join(home, ".claude", "skills", "broken"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "skills", "broken", "SKILL.md"), "no frontmatter here", "utf8");

  const { entries, scannedDirs } = discoverInstalledSkills({ cwd, home });

  assert.ok(entries.some((e) => e.name === "proj-skill" && e.source === "project"));
  assert.ok(entries.some((e) => e.name === "user-skill" && e.source === "user"));
  assert.ok(entries.some((e) => e.name === "cached-skill" && e.source === "plugin-cache"));
  assert.ok(!entries.some((e) => e.name === "broken"));
  assert.ok(scannedDirs.length >= 3);
});

test("discoverCatalogSkills reads a local marketplace.json, excludes installed names, stays offline without `online`", async () => {
  const home = tmpHome();
  const mpDir = path.join(home, ".claude", "plugins", "marketplaces", "testmp", ".claude-plugin");
  fs.mkdirSync(mpDir, { recursive: true });
  fs.writeFileSync(
    path.join(mpDir, "marketplace.json"),
    JSON.stringify({
      name: "testmp",
      plugins: [
        { name: "already-installed", description: "should be excluded" },
        { name: "new-plugin", description: "a plugin nobody has installed yet", homepage: "https://example.com" },
      ],
    }),
    "utf8",
  );

  const { entries, usedRemoteCatalog } = await discoverCatalogSkills(new Set(["already-installed"]), { home });

  assert.equal(usedRemoteCatalog, false);
  assert.ok(!entries.some((e) => e.name === "already-installed"));
  const found = entries.find((e) => e.name === "new-plugin");
  assert.ok(found);
  assert.equal(found.marketplace, "testmp");
  assert.equal(found.viaRemoteFallback, false);
});

test("discoverCatalogSkills returns empty + no network attempt when nothing local and online is not set", async () => {
  const home = tmpHome(); // no .claude/plugins/marketplaces at all
  const { entries, usedRemoteCatalog } = await discoverCatalogSkills(new Set(), { home });
  assert.deepEqual(entries, []);
  assert.equal(usedRemoteCatalog, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/skill-router.test.mjs`
Expected: FAIL — `Cannot find module '../dist/modules/jev-skill-router.js'`

- [ ] **Step 3: Implement discovery**

Create `src/modules/jev-skill-router.ts`:

```ts
/**
 * MODULE — Claude Skills discovery & routing.
 *
 * Finds installed SKILL.md files (project/user/plugin trees) and, on request,
 * not-yet-installed plugins from local marketplace.json catalogs or a public
 * fallback, then ranks them for a task with the existing Jev Score primitive.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { findRepoRoot } from "../core/paths.js";
import { tokenize } from "../core/text.js";
import type { JevBackend, ScoreResult } from "../core/types.js";
import type {
  CatalogSkillEntry,
  SkillEntry,
  SkillMatch,
  SkillRouterReport,
  SkillSource,
} from "../core/module-types.js";

export interface DiscoverOptions {
  cwd?: string;
  home?: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git"]);

function walkForSkillFiles(root: string, maxDepth: number): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        found.push(full);
      }
    }
  };
  walk(root, 0);
  return found;
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1]!;
  const clean = (s: string): string => s.trim().replace(/^["']|["']$/g, "");
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  const descMatch = block.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch ? clean(nameMatch[1]!) : undefined,
    description: descMatch ? clean(descMatch[1]!) : undefined,
  };
}

function discoveryRoots(opts: DiscoverOptions): Array<{ root: string; source: SkillSource; maxDepth: number }> {
  const home = opts.home ?? os.homedir();
  const cwd = opts.cwd ?? process.cwd();
  return [
    { root: path.join(findRepoRoot(), "skills"), source: "self", maxDepth: 3 },
    { root: path.join(cwd, ".claude", "skills"), source: "project", maxDepth: 3 },
    { root: path.join(home, ".claude", "skills"), source: "user", maxDepth: 3 },
    { root: path.join(home, ".claude", "plugins", "cache"), source: "plugin-cache", maxDepth: 7 },
    { root: path.join(home, ".claude", "plugins", "marketplaces"), source: "plugin-marketplace", maxDepth: 7 },
  ];
}

export function discoverInstalledSkills(opts: DiscoverOptions = {}): { entries: SkillEntry[]; scannedDirs: string[] } {
  const entries: SkillEntry[] = [];
  const scannedDirs: string[] = [];
  const seen = new Set<string>();

  for (const { root, source, maxDepth } of discoveryRoots(opts)) {
    if (!fs.existsSync(root)) continue;
    scannedDirs.push(root);
    for (const file of walkForSkillFiles(root, maxDepth)) {
      let raw: string;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const fm = parseFrontmatter(raw);
      if (!fm.name || !fm.description || seen.has(fm.name)) continue;
      seen.add(fm.name);
      entries.push({ name: fm.name, description: fm.description, source, path: file, installed: true });
    }
  }
  return { entries, scannedDirs };
}

interface MarketplacePluginRaw {
  name?: string;
  description?: string;
  homepage?: string;
}
interface MarketplaceJsonRaw {
  name: string;
  plugins?: MarketplacePluginRaw[];
}

const REMOTE_CATALOG_SOURCE = "anthropics/claude-plugins-public";
const REMOTE_CATALOG_URL =
  "https://raw.githubusercontent.com/anthropics/claude-plugins-public/main/.claude-plugin/marketplace.json";

function loadLocalMarketplaces(home: string): MarketplaceJsonRaw[] {
  const root = path.join(home, ".claude", "plugins", "marketplaces");
  if (!fs.existsSync(root)) return [];
  const out: MarketplaceJsonRaw[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = path.join(root, dir.name, ".claude-plugin", "marketplace.json");
    try {
      out.push(JSON.parse(fs.readFileSync(file, "utf8")) as MarketplaceJsonRaw);
    } catch {
      continue;
    }
  }
  return out;
}

function loadInstallCounts(home: string): Map<string, number> {
  const file = path.join(home, ".claude", "plugins", "install-counts-cache.json");
  const map = new Map<string, number>();
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
      counts?: Array<{ plugin: string; unique_installs: number }>;
    };
    for (const c of data.counts ?? []) map.set(c.plugin, c.unique_installs);
  } catch {
    // no cache yet — fine, popularity is a nice-to-have signal, not required.
  }
  return map;
}

function fetchRemoteCatalog(timeoutMs = 3000): Promise<MarketplaceJsonRaw | null> {
  return new Promise((resolve) => {
    const req = https.get(REMOTE_CATALOG_URL, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body) as MarketplaceJsonRaw);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** Never hits the network unless `opts.online` is explicitly true. */
export async function discoverCatalogSkills(
  installedNames: Set<string>,
  opts: DiscoverOptions & { online?: boolean } = {},
): Promise<{ entries: CatalogSkillEntry[]; usedRemoteCatalog: boolean }> {
  const home = opts.home ?? os.homedir();
  const counts = loadInstallCounts(home);
  const marketplaces = loadLocalMarketplaces(home).map((m) => ({ marketplace: m, viaRemoteFallback: false }));

  let usedRemoteCatalog = false;
  if (opts.online) {
    const remote = await fetchRemoteCatalog();
    if (remote) {
      marketplaces.push({ marketplace: remote, viaRemoteFallback: true });
      usedRemoteCatalog = true;
    }
  }

  const entries: CatalogSkillEntry[] = [];
  const seen = new Set<string>();
  for (const { marketplace, viaRemoteFallback } of marketplaces) {
    for (const plugin of marketplace.plugins ?? []) {
      if (!plugin.name || !plugin.description) continue;
      if (installedNames.has(plugin.name) || seen.has(plugin.name)) continue;
      seen.add(plugin.name);
      entries.push({
        name: plugin.name,
        description: plugin.description,
        marketplace: marketplace.name,
        homepage: plugin.homepage,
        uniqueInstalls: counts.get(`${plugin.name}@${marketplace.name}`),
        viaRemoteFallback,
        installed: false,
      });
    }
  }
  return { entries, usedRemoteCatalog };
}

export function installCommandFor(entry: CatalogSkillEntry): string[] {
  const cmds: string[] = [];
  if (entry.viaRemoteFallback) cmds.push(`claude plugin marketplace add ${REMOTE_CATALOG_SOURCE}`);
  cmds.push(`claude plugin install ${entry.name}@${entry.marketplace}`);
  return cmds;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/skill-router.test.mjs`
Expected: PASS — 3/3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/jev-skill-router.ts tests/skill-router.test.mjs
git commit -m "feat: add SkillRouter local + catalog discovery"
```

---

### Task 3: SkillRouter — ranking + route()

**Files:**
- Modify: `src/modules/jev-skill-router.ts`
- Test: `tests/skill-router.test.mjs`

- [ ] **Step 1: Write the failing test for ranking + route()**

Append to `tests/skill-router.test.mjs`:

```js
const { SkillRouter } = await import("../dist/modules/jev-skill-router.js");

function fakeBackend(scoreFor) {
  return {
    meta: { id: "fake", label: "fake", pricePerMillionUsd: 0, outputTokenCostUsd: 0, local: true, synthetic: true },
    health: async () => true,
    choice: async () => {
      throw new Error("not used");
    },
    score: async () => {
      throw new Error("not used");
    },
    noul: async () => {
      throw new Error("not used");
    },
    batch: async (requests) =>
      requests.map((r, i) => ({
        id: String(i),
        kind: "score",
        question: r.question,
        backend: "fake",
        latencyMs: 0,
        usage: { inputTokens: 0, costUsd: 0, pricePerMillionUsd: 0 },
        schemaValid: true,
        synthetic: true,
        min: 1,
        max: 10,
        score: scoreFor(r.state ?? ""),
        confidence: 1,
        signals: [],
      })),
  };
}

test("SkillRouter.route ranks a clearly-best skill into the execute zone", async () => {
  const home = tmpHome();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "jev-skill-router-project2-"));
  mkSkill(path.join(cwd, ".claude", "skills", "redteam-helper"), "redteam-helper", "sanity-check and stress-test a plan before executing it");
  mkSkill(path.join(cwd, ".claude", "skills", "unrelated"), "unrelated", "generate marketing emojis for social posts");

  const backend = fakeBackend((state) => (state.includes("redteam-helper") ? 9.5 : 2));
  const router = new SkillRouter({ backend });
  const report = await router.route("sanity-check my plan before I run it", { cwd, home, limit: 2 });

  assert.equal(report.zone, "execute");
  assert.equal(report.matches[0].entry.name, "redteam-helper");
  assert.equal(report.usedRemoteCatalog, false);
  assert.ok(report.latencyMs >= 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/skill-router.test.mjs`
Expected: FAIL — `SkillRouter is not a constructor` / undefined export.

- [ ] **Step 3: Implement ranking + route()**

Append to `src/modules/jev-skill-router.ts`:

```ts
function tokenOverlap(task: string, text: string): number {
  const a = new Set(tokenize(task));
  const b = new Set(tokenize(text));
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

async function rankCandidates<T extends { name: string; description: string }>(
  backend: JevBackend,
  task: string,
  candidates: T[],
  shortlistSize = 12,
): Promise<Array<{ entry: T; relevance: ScoreResult }>> {
  if (candidates.length === 0) return [];
  const shortlist = candidates
    .map((c) => ({ c, pre: tokenOverlap(task, `${c.name} ${c.description}`) }))
    .sort((a, b) => b.pre - a.pre)
    .slice(0, shortlistSize)
    .map((x) => x.c);

  const scores = (await backend.batch(
    shortlist.map((c) => ({
      kind: "score" as const,
      question: `How relevant is this Claude Code skill for the task: "${task}"?`,
      min: 1,
      max: 10,
      state: `skill: ${c.name}\ndescription: ${c.description}`,
    })),
  )) as ScoreResult[];

  return shortlist
    .map((entry, i) => ({ entry, relevance: scores[i]! }))
    .sort((a, b) => b.relevance.score - a.relevance.score);
}

const ZONE_GAP_THRESHOLD = 1.5;

export interface SkillRouterDeps {
  backend: JevBackend;
}

export class SkillRouter {
  constructor(private readonly deps: SkillRouterDeps) {}

  async route(
    task: string,
    opts: DiscoverOptions & { limit?: number; online?: boolean } = {},
  ): Promise<SkillRouterReport> {
    const started = Date.now();
    const limit = opts.limit ?? 3;

    const { entries: installed, scannedDirs } = discoverInstalledSkills(opts);
    const installedNames = new Set(installed.map((e) => e.name));
    const { entries: catalog, usedRemoteCatalog } = await discoverCatalogSkills(installedNames, opts);

    const rankedInstalled = await rankCandidates(this.deps.backend, task, installed);
    const rankedCatalog = await rankCandidates(this.deps.backend, task, catalog);

    const top = rankedInstalled[0];
    const second = rankedInstalled[1];
    const zone: SkillRouterReport["zone"] =
      top && (!second || top.relevance.score - second.relevance.score >= ZONE_GAP_THRESHOLD)
        ? "execute"
        : "speculative";

    const matches: Array<SkillMatch<SkillEntry>> = rankedInstalled
      .slice(0, limit)
      .map((r) => ({ entry: r.entry, relevance: r.relevance }));

    const catalogMatches: Array<SkillMatch<CatalogSkillEntry>> = rankedCatalog
      .slice(0, limit)
      .map((r) => ({ entry: r.entry, relevance: r.relevance, installCommand: installCommandFor(r.entry) }));

    return {
      task,
      zone,
      matches,
      catalogMatches,
      scannedDirs,
      usedRemoteCatalog,
      latencyMs: Date.now() - started,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/skill-router.test.mjs`
Expected: PASS — 4/4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/jev-skill-router.ts tests/skill-router.test.mjs
git commit -m "feat: add SkillRouter ranking and route()"
```

---

### Task 4: Wire into the MCP tool registry

**Files:**
- Modify: `src/tools/registry.ts`

- [ ] **Step 1: Add the import**

In `src/tools/registry.ts`, after the `CalibrationChecker` import (around line 25):

```ts
import { CalibrationChecker } from "../modules/jev-calibration.js";
import { SkillRouter } from "../modules/jev-skill-router.js";
```

- [ ] **Step 2: Add to `AppContext` and `createContext`**

In the `AppContext` interface, after `calibrationChecker: CalibrationChecker;`:

```ts
  calibrationChecker: CalibrationChecker;
  skillRouter: SkillRouter;
```

In `createContext`'s return object, after `calibrationChecker: new CalibrationChecker({ backend, policy: config.policy }),`:

```ts
    calibrationChecker: new CalibrationChecker({ backend, policy: config.policy }),
    skillRouter: new SkillRouter({ backend }),
```

- [ ] **Step 3: Register the MCP tool**

In `buildTools`, after the `jev_audit` tool block (before `jev_research`), insert:

```ts
  tools.push({
    name: "jev_skill_router",
    title: "Claude Skills discovery & routing",
    description:
      "Discover installed Claude Code Skills (project/user/plugin trees) plus not-yet-installed skills from local marketplace catalogs (and, if online=true, Anthropic's public catalog), then rank them for a task with the Jev Score primitive. Never installs anything itself — returns the exact `claude plugin` commands to run.",
    inputSchema: schema(
      {
        task: stringProp("The task or need to match a skill against."),
        limit: numberProp("Max ranked results per list (default 3)."),
        online: booleanProp("Also fetch the public fallback catalog over HTTPS (default false, fully offline)."),
      },
      ["task"],
    ),
    handler: async (args) =>
      ctx.skillRouter.route(str(args, "task"), {
        limit: numArg(args, "limit", 3),
        online: boolArg(args, "online", false),
      }),
  });
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/tools/registry.ts
git commit -m "feat: register jev_skill_router MCP tool"
```

---

### Task 5: CLI command + tool count

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add the `skills` command**

In `src/cli.ts`, after the `case "audit":` block and before `case "verify":`, insert:

```ts
    case "skills": {
      const task = positionals.join(" ") || flags.get("task") || "";
      print(
        await ctx.skillRouter.route(task, {
          limit: Number(flags.get("limit") ?? 3),
          online: flags.get("online") === "true",
        }),
      );
      return;
    }
```

- [ ] **Step 2: Bump the tool count and help text**

Change line 77 from:

```ts
      print({ backend: ctx.resolved.backend.meta, chain: ctx.resolved.chain, tools: 28 });
```

to:

```ts
      print({ backend: ctx.resolved.backend.meta, chain: ctx.resolved.chain, tools: 29 });
```

Change the `default:` help text (around line 192) from:

```ts
          "commands: info | decide | compact | audit | verify | label | guardrail | plan | redteam | memory | features | competitors | calibration\n",
```

to:

```ts
          "commands: info | decide | compact | audit | verify | label | guardrail | plan | redteam | memory | features | competitors | calibration | skills\n",
```

- [ ] **Step 3: Build and manually smoke it**

Run: `npm run build && node dist/cli.js skills "compact a giant log file" --limit 2`
Expected: JSON with `task`, `zone`, `matches`, `catalogMatches`, `scannedDirs`, `usedRemoteCatalog: false`, `latencyMs`.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add \"jev skills\" CLI command"
```

---

### Task 6: Feature catalog + skill doc

**Files:**
- Modify: `src/modules/enterprise-features.ts`
- Modify: `skills/jev/SKILL.md`

- [ ] **Step 1: Add feature #21**

In `src/modules/enterprise-features.ts`, after the `id: 20` entry, before the closing `];`:

```ts
  { id: 21, slug: "skill-router", name: "Claude Skills Router", status: "implemented", tool: "jev_skill_router", summary: "Discovers installed + catalog Claude Skills and ranks them for a task via the Jev Score primitive." },
```

- [ ] **Step 2: Add a row to the SKILL.md command table**

In `skills/jev/SKILL.md`, in the `## When to reach for which command` table, after the `audit <path>` row, add:

```markdown
| Discover/rank Claude Skills for a task (installed + catalog) | `skills "<task>" [--online]` |
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/enterprise-features.ts skills/jev/SKILL.md
git commit -m "docs: list jev_skill_router in the feature catalog and skill doc"
```

---

### Task 7: install-mcp.js — register with Claude Code too

**Files:**
- Modify: `scripts/install-mcp.js`

- [ ] **Step 1: Add the `execFileSync` import**

Change:

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
```

to:

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
```

- [ ] **Step 2: Register with Claude Code after the existing `targets` loop**

After the closing `}` of the `for (const target of targets)` loop, before the `if (!existsSync(entryPoint))` block, insert:

```js
try {
  execFileSync("claude", ["mcp", "get", "jev-super-agent"], { stdio: "pipe" });
  console.log("ok    Claude Code: already registered");
} catch (err) {
  if (err.code === "ENOENT") {
    console.log("skip  Claude Code: `claude` CLI not found on PATH");
  } else {
    try {
      execFileSync(
        "claude",
        ["mcp", "add", "jev-super-agent", "-s", "user", "-e", "JEV_BACKEND_PROVIDER=auto", "--", "node", entryPoint],
        { stdio: "inherit" },
      );
      console.log("added Claude Code: registered jev-super-agent (user scope)");
      changed++;
    } catch {
      console.log("skip  Claude Code: `claude mcp add` failed (see output above)");
    }
  }
}
```

- [ ] **Step 3: Run it and verify it reports "already registered"**

Run: `node scripts/install-mcp.js`
Expected: includes the line `ok    Claude Code: already registered` (it's already registered on this machine from earlier in the session).

- [ ] **Step 4: Commit**

```bash
git add scripts/install-mcp.js
git commit -m "fix: install-mcp.js now also registers jev-x-kit with Claude Code itself"
```

---

### Task 8: Smoke test

**Files:**
- Modify: `scripts/smoke-test.mjs`

- [ ] **Step 1: Add the tool name to the required-tools check**

Change:

```js
  for (const required of ["jev_evaluate", "jev_decide", "jev_plan", "jev_redteam", "jev_audit", "jev_guardrail"]) {
```

to:

```js
  for (const required of ["jev_evaluate", "jev_decide", "jev_plan", "jev_redteam", "jev_audit", "jev_guardrail", "jev_skill_router"]) {
```

- [ ] **Step 2: Add a call block after the `jev_evaluate` block (after its closing checks, before the module 2 comment)**

```js
  // Skill router: fully offline (online defaults to false), must not hang or throw
  const skillRouted = await call("jev_skill_router", { task: "sanity-check a plan before executing it", limit: 2 });
  check("skill router returns a valid zone", skillRouted.zone === "execute" || skillRouted.zone === "speculative");
  check("skill router reports scanned dirs", Array.isArray(skillRouted.scannedDirs));
  check("skill router stayed offline by default", skillRouted.usedRemoteCatalog === false);
```

- [ ] **Step 3: Run the full smoke suite**

Run: `npm run build && npm run smoke`
Expected: `SMOKE OK` with all checks passed, including the three new ones.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-test.mjs
git commit -m "test: cover jev_skill_router in the MCP smoke suite"
```

---

### Task 9: Full verification pass

- [ ] **Step 1: Run the full unit test suite**

Run: `npm run build && npm test`
Expected: all tests pass (existing `core.test.mjs` + `datacenter.test.mjs` + new `skill-router.test.mjs`).

- [ ] **Step 2: Run the smoke suite once more end-to-end**

Run: `npm run smoke`
Expected: `SMOKE OK`.

- [ ] **Step 3: Re-run install-mcp.js one last time to confirm idempotency**

Run: `node scripts/install-mcp.js`
Expected: no errors, `ok`/`skip` lines only, `0 config file(s) updated` for the file-based targets (already registered) plus the Claude Code `ok` line.
