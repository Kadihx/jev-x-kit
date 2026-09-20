/**
 * MODULE 5A — Ultra-Deep Researcher.
 *
 * Four parallel channels: web, academic, code (GitHub/npm) and social (HN,
 * optionally X/Brave). Default sources are keyless and free; unavailable
 * channels degrade to a structured query plan instead of failing.
 * Results are re-ranked with Jev Noul relevance and optionally synthesized by
 * the System-2 LLM.
 */

import { mapLimit } from "../core/fanout.js";
import { System2Client } from "../core/llm.js";
import { log } from "../core/log.js";
import type { JevBackend, NoulResult } from "../core/types.js";
import type { ResearchBrief, ResearchChannelId, ResearchHit } from "../core/module-types.js";

export interface ResearcherDeps {
  backend: JevBackend;
  llm: System2Client;
  githubToken?: string;
  braveKey?: string;
  twitterBearer?: string;
  concurrency?: number;
}

const FETCH_TIMEOUT_MS = 8000;

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "jev-super-agent-mcp", ...headers },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "jev-super-agent-mcp", ...headers },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function offlinePlan(channel: ResearchChannelId, query: string): ResearchHit[] {
  const plans: Record<ResearchChannelId, string[]> = {
    web: [
      `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`,
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    ],
    academic: [
      `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query.split(" ").join("+AND+"))}`,
      `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`,
    ],
    code: [
      `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`,
      `https://www.npmjs.com/search?q=${encodeURIComponent(query)}`,
    ],
    social: [
      `https://hn.algolia.com/?q=${encodeURIComponent(query)}`,
      `https://x.com/search?q=${encodeURIComponent(query)}`,
    ],
  };
  return plans[channel].map((url) => ({
    channel,
    title: `[offline plan] open this query in ${channel}`,
    url,
    snippet: `channel unavailable without network/keys; run this query manually for: ${query}`,
    source: "offline-fallback" as const,
  }));
}

/* ---------------------------- channel fetchers --------------------------- */

async function channelWeb(query: string, braveKey?: string): Promise<ResearchHit[]> {
  const hits: ResearchHit[] = [];
  try {
    const wiki = await fetchJson<{ query?: { search?: Array<{ title: string; snippet: string }> } }>(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=4&srsearch=${encodeURIComponent(query)}`,
    );
    for (const item of wiki.query?.search ?? []) {
      hits.push({
        channel: "web",
        title: item.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
        snippet: item.snippet.replace(/<[^>]+>/g, ""),
        source: "network",
      });
    }
  } catch (error) {
    log.debug(`wikipedia channel failed: ${String(error)}`);
  }
  if (braveKey) {
    try {
      const brave = await fetchJson<{ web?: { results?: Array<{ title: string; url: string; description: string }> } }>(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        { "x-subscription-token": braveKey },
      );
      for (const item of brave.web?.results ?? []) {
        hits.push({ channel: "web", title: item.title, url: item.url, snippet: item.description, source: "network" });
      }
    } catch (error) {
      log.debug(`brave channel failed: ${String(error)}`);
    }
  }
  return hits;
}

async function channelAcademic(query: string): Promise<ResearchHit[]> {
  try {
    const xml = await fetchText(
      `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query.split(/\s+/).join("+AND+"))}&max_results=4&sortBy=relevance`,
    );
    const entries = xml.split("<entry>").slice(1);
    return entries.map((entry) => {
      const title = (entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
      const url = (entry.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? "").trim();
      const summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
      return { channel: "academic" as const, title, url, snippet: summary.slice(0, 400), source: "network" as const };
    });
  } catch (error) {
    log.debug(`arxiv channel failed: ${String(error)}`);
    return [];
  }
}

async function channelCode(query: string, githubToken?: string): Promise<ResearchHit[]> {
  const hits: ResearchHit[] = [];
  try {
    const gh = await fetchJson<{
      items?: Array<{ full_name: string; html_url: string; description: string | null; stargazers_count: number }>;
    }>(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=4`, {
      ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
    });
    for (const item of gh.items ?? []) {
      hits.push({
        channel: "code",
        title: `${item.full_name} (${item.stargazers_count} stars)`,
        url: item.html_url,
        snippet: item.description ?? "(no description)",
        source: "network",
      });
    }
  } catch (error) {
    log.debug(`github channel failed: ${String(error)}`);
  }
  try {
    const npm = await fetchJson<{
      objects?: Array<{ package: { name: string; links?: { npm?: string; homepage?: string }; description?: string } }>;
    }>(`https://registry.npmjs.org/-/v1/search?size=4&text=${encodeURIComponent(query)}`);
    for (const item of npm.objects ?? []) {
      hits.push({
        channel: "code",
        title: `npm: ${item.package.name}`,
        url: item.package.links?.npm ?? item.package.links?.homepage ?? `https://www.npmjs.com/package/${item.package.name}`,
        snippet: item.package.description ?? "(no description)",
        source: "network",
      });
    }
  } catch (error) {
    log.debug(`npm channel failed: ${String(error)}`);
  }
  return hits;
}

async function channelSocial(query: string, twitterBearer?: string): Promise<ResearchHit[]> {
  const hits: ResearchHit[] = [];
  const search = async (q: string): Promise<ResearchHit[]> => {
    const found: ResearchHit[] = [];
    try {
      const hn = await fetchJson<{
        hits?: Array<{ title: string; url: string | null; objectID: string; points: number | null }>;
      }>(`https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=4&query=${encodeURIComponent(q)}`);
      for (const item of hn.hits ?? []) {
        found.push({
          channel: "social",
          title: item.title,
          url: item.url ?? `https://news.ycombinator.com/item?id=${item.objectID}`,
          snippet: `Hacker News story, ${item.points ?? 0} points`,
          source: "network",
        });
      }
    } catch (error) {
      log.debug(`hn channel failed: ${String(error)}`);
    }
    return found;
  };

  // Algolia AND-matches every word: long queries often return 0 hits, so
  // fall back to a trimmed 3-keyword query before giving up.
  let results = await search(query);
  if (results.length === 0) {
    const trimmed = query.trim().split(/\s+/).slice(0, 3).join(" ");
    if (trimmed.toLowerCase() !== query.trim().toLowerCase()) {
      results = await search(trimmed);
    }
  }
  hits.push(...results);
  if (twitterBearer) {
    try {
      const x = await fetchJson<{ data?: Array<{ id: string; text: string }> }>(
        `https://api.twitter.com/2/tweets/search/recent?max_results=10&query=${encodeURIComponent(query)}`,
        { authorization: `Bearer ${twitterBearer}` },
      );
      for (const tweet of (x.data ?? []).slice(0, 4)) {
        hits.push({
          channel: "social",
          title: `X post ${tweet.id}`,
          url: `https://x.com/i/status/${tweet.id}`,
          snippet: tweet.text,
          source: "network",
        });
      }
    } catch (error) {
      log.debug(`x channel failed: ${String(error)}`);
    }
  }
  return hits;
}

export class DeepResearcher {
  constructor(private readonly deps: ResearcherDeps) {}

  async research(
    query: string,
    opts: { channels?: ResearchChannelId[]; maxHits?: number } = {},
  ): Promise<ResearchBrief> {
    const started = Date.now();
    const channels = opts.channels ?? (["web", "academic", "code", "social"] as ResearchChannelId[]);
    const maxHits = opts.maxHits ?? 12;

    const collected = await mapLimit(channels, Math.min(this.deps.concurrency ?? 4, 4), async (channel) => {
      switch (channel) {
        case "web":
          return channelWeb(query, this.deps.braveKey);
        case "academic":
          return channelAcademic(query);
        case "code":
          return channelCode(query, this.deps.githubToken);
        case "social":
          return channelSocial(query, this.deps.twitterBearer);
      }
    });

    let hits: ResearchHit[] = collected.flat();
    if (hits.length === 0) {
      hits = channels.flatMap((channel) => offlinePlan(channel, query));
    }

    // Jev re-ranking: one fan-out pass of Noul relevance over the candidate pool.
    const toRank = hits.slice(0, maxHits * 2);
    const relevance = (await this.deps.backend.batch(
      toRank.map((hit) => ({
        kind: "noul" as const,
        question: `Is this result relevant and trustworthy for the research query: ${query}`,
        state: `title: ${hit.title}\nurl: ${hit.url}\nsnippet: ${hit.snippet.slice(0, 300)}`,
      })),
    )) as NoulResult[];

    const ranked = toRank
      .map((hit, i) => ({ ...hit, relevance: relevance[i]?.probability ?? 0.5 }))
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
      .slice(0, maxHits);

    // Synthesis (System 2), offline fallback lists what was found.
    const synthesis = await this.deps.llm.chatText([
      { role: "system", content: "You are a research synthesist. Be concise, cite URLs inline in parentheses." },
      {
        role: "user",
        content:
          `Research query: ${query}\nRanked sources:\n${ranked
            .map((h) => `- [${h.relevance}] ${h.title} ${h.url} :: ${h.snippet.slice(0, 200)}`)
            .join("\n")}\n\nWrite a brief (max 12 bullet points) with the strongest evidence and open questions.`,
      },
    ]);

    return {
      query,
      channels,
      hits,
      ranked,
      synthesis: synthesis
        ? { source: "llm", brief: synthesis, citations: ranked.map((h) => h.url) }
        : {
            source: "offline-fallback",
            brief: ranked.map((h) => `${h.title} (relevance ${h.relevance}) ${h.url}`).join("\n"),
            citations: ranked.map((h) => h.url),
          },
      latencyMs: Date.now() - started,
    };
  }
}
