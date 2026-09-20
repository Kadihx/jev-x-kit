/**
 * MODULE — Competitor / market scan.
 *
 * Searches GitHub for repos created within a recent window that match a
 * topic, ranks each candidate against this project's own positioning with a
 * Jev Noul fan-out (one pass, $0 on local/offline backends), then asks the
 * System-2 LLM for a concrete "who's the closest rival and what do they have
 * that we don't" synthesis. Keyless by default (unauthenticated GitHub
 * search API: 10 req/min) — pass `githubToken` for the authenticated limit.
 */

import { System2Client } from "../core/llm.js";
import { log } from "../core/log.js";
import type { JevBackend, NoulResult } from "../core/types.js";
import type { CompetitorCandidate, CompetitorReport } from "../core/module-types.js";

export interface CompetitorScanDeps {
  backend: JevBackend;
  llm: System2Client;
  githubToken?: string;
}

interface RawRepo {
  fullName: string;
  url: string;
  description: string;
  stars: number;
  language: string | null;
  createdAt: string;
  pushedAt: string;
}

const DEFAULT_OUR_DESCRIPTION =
  "Offline $0 decision layer for coding agents: Choice/Score/Noul primitives, " +
  "a confidence gatekeeper, ultra-planning, red-teaming, 4-channel research and " +
  "RLVR self-improvement, packaged as an MCP server + CLI + Claude Code plugin/skill.";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function searchGithubPage(
  query: string,
  sortBy: "stars" | "created" | "updated",
  page: number,
  perPage: number,
  githubToken: string | undefined,
  since: string | undefined,
): Promise<RawRepo[]> {
  const q = since ? `${query} created:>=${since}` : query;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=${sortBy}&order=desc&per_page=${perPage}&page=${page}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "jev-x-kit-competitor-scan",
      ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub search HTTP ${response.status} (page ${page})`);
  const json = (await response.json()) as {
    items?: Array<{
      full_name: string;
      html_url: string;
      description: string | null;
      stargazers_count: number;
      language: string | null;
      created_at: string;
      pushed_at: string;
    }>;
  };
  return (json.items ?? []).map((item) => ({
    fullName: item.full_name,
    url: item.html_url,
    description: item.description ?? "(no description)",
    stars: item.stargazers_count,
    language: item.language,
    createdAt: item.created_at,
    pushedAt: item.pushed_at,
  }));
}

/**
 * Multi-page GitHub search. GitHub caps search results at 1000 total, so
 * `pages * perPage` is clamped to that. Paces requests to stay under the
 * search API's rate limit (10 req/min unauthenticated, 30 req/min with a
 * token) instead of bursting and getting 403'd partway through a scan.
 */
async function searchGithub(
  query: string,
  opts: { windowDays?: number; sortBy?: "stars" | "created" | "updated"; pages?: number; perPage?: number; githubToken?: string },
): Promise<RawRepo[]> {
  const sortBy = opts.sortBy ?? "stars";
  const perPage = Math.min(Math.max(opts.perPage ?? 30, 1), 100);
  const maxPages = Math.max(1, Math.floor(1000 / perPage));
  const pages = Math.min(Math.max(opts.pages ?? 1, 1), maxPages);
  const since = opts.windowDays ? new Date(Date.now() - opts.windowDays * 86_400_000).toISOString().slice(0, 10) : undefined;
  const delayMs = opts.githubToken ? 2100 : 6100;

  const seen = new Set<string>();
  const all: RawRepo[] = [];
  for (let page = 1; page <= pages; page++) {
    let items: RawRepo[];
    try {
      items = await searchGithubPage(query, sortBy, page, perPage, opts.githubToken, since);
    } catch (error) {
      log.warn(`competitor scan: page ${page} failed, stopping pagination: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    if (items.length === 0) break;
    for (const item of items) {
      if (!seen.has(item.fullName)) {
        seen.add(item.fullName);
        all.push(item);
      }
    }
    if (page < pages) await sleep(delayMs);
  }
  return all;
}

export class CompetitorScanner {
  constructor(private readonly deps: CompetitorScanDeps) {}

  async scan(
    query: string,
    opts: {
      windowDays?: number;
      limit?: number;
      pages?: number;
      sortBy?: "stars" | "created" | "updated";
      ourRepo?: string;
      ourDescription?: string;
    } = {},
  ): Promise<CompetitorReport> {
    const started = Date.now();
    const windowDays = opts.windowDays ?? 2;
    const ourDescription = opts.ourDescription ?? DEFAULT_OUR_DESCRIPTION;

    let raw: RawRepo[] = [];
    try {
      raw = await searchGithub(query, {
        windowDays,
        sortBy: opts.sortBy ?? "stars",
        pages: opts.pages ?? 1,
        perPage: opts.limit ?? 15,
        githubToken: this.deps.githubToken,
      });
    } catch (error) {
      log.warn(`competitor scan: GitHub search failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const relevance = raw.length
      ? ((await this.deps.backend.batch(
          raw.map((r) => ({
            kind: "noul" as const,
            question: "Does this repo compete directly with ours for the same users and use-case?",
            state: `our project: ${ourDescription}\ncandidate: ${r.fullName} (${r.language ?? "?"}, ${r.stars} stars) — ${r.description}`,
          })),
        )) as NoulResult[])
      : [];

    const candidates: CompetitorCandidate[] = raw
      .map((r, i) => {
        const score = relevance[i]?.probability ?? 0.5;
        const tier: CompetitorCandidate["tier"] = score >= 0.85 ? "VERIFIED" : score >= 0.6 ? "PROBABLE" : "REJECTED";
        return { ...r, relevance: Math.round(score * 10000) / 10000, tier };
      })
      .sort((a, b) => b.relevance - a.relevance);

    const top = candidates.filter((c) => c.tier !== "REJECTED").slice(0, 8);
    const usable = top.length > 0 ? top : candidates.slice(0, 5);

    const synthesisText = await this.deps.llm.chatText(
      [
        {
          role: "system",
          content:
            "You are a competitive analyst for open-source developer tools. Be concrete and specific: name real features " +
            "the candidates have that our project lacks, identify the single closest direct competitor, and give one " +
            "actionable positioning recommendation. No generic praise, no fluff.",
        },
        {
          role: "user",
          content:
            `Our project:\n${ourDescription}\n\n` +
            `Candidate repos (name, stars, language, our-Noul-relevance, description):\n${usable
              .map((c) => `- ${c.fullName} (${c.stars}★, ${c.language ?? "?"}) [rel ${c.relevance}] ${c.description}`)
              .join("\n")}\n\n` +
            "Write: 1) closest direct competitor and why, 2) up to 5 concrete feature gaps we should consider closing, " +
            "3) one concrete positioning/marketing recommendation.",
        },
      ],
      900,
    );

    return {
      query,
      windowDays,
      ourRepo: opts.ourRepo ?? null,
      candidates,
      synthesis: synthesisText
        ? { source: "llm", brief: synthesisText }
        : { source: "offline-fallback", brief: usable.map((c) => `${c.fullName} (${c.stars}★): ${c.description}`).join("\n") },
      latencyMs: Date.now() - started,
    };
  }
}
