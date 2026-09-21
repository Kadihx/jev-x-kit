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
