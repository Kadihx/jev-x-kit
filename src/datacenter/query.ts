/**
 * Query engine — FTS5 search with Jev ranking on top.
 *
 * Two-stage retrieval:
 *   1. SQLite FTS5 (BM25) pulls candidate passages,
 *   2. the Jev evaluator scores relevance (Noul) in one fan-out pass and
 *      re-orders. Heuristic backend = $0; real backends = real calibration.
 *
 * Answer assembly follows the user's study directive:
 * rational models + cognitive-science findings first, pop advice never;
 * mental models and book notes cited directly; step-by-step logic.
 */

import { HubStore, type StoredDocument } from "./store.js";
import { sourcesByCategory, type SourceCategory } from "./source-configs.js";
import { loadConfig } from "../core/config.js";
import { resolveBackend } from "../core/providers/index.js";
import { System2Client } from "../core/llm.js";
import type { JevBackend } from "../core/types.js";

export interface RankedPassage {
  doc: StoredDocument;
  excerpt: string;
  relevance: number;
  backend: string;
  tier: "VERIFIED" | "PROBABLE" | "REJECTED";
}

export interface HubAnswer {
  query: string;
  passages: RankedPassage[];
  answer: { source: "llm" | "offline-fallback"; brief: string; citations: string[] };
  latencyMs: number;
  backend: string;
}

const MAX_EXCERPT_CHARS = 1200;

function excerptFor(content: string, query: string): string {
  const tokens = query.toLowerCase().split(/[\s,;:.!?()"]+/).filter((t) => t.length > 3);
  const lower = content.toLowerCase();
  let best = -1;
  for (const token of tokens.slice(0, 8)) {
    const index = lower.indexOf(token);
    if (index >= 0 && (best === -1 || index < best)) best = index;
  }
  const start = best === -1 ? 0 : Math.max(0, best - 300);
  return content.slice(start, start + MAX_EXCERPT_CHARS);
}

function tierFor(relevance: number): RankedPassage["tier"] {
  if (relevance >= 0.85) return "VERIFIED";
  if (relevance >= 0.6) return "PROBABLE";
  return "REJECTED";
}

export interface QueryDeps {
  store: HubStore;
  backend: JevBackend;
  llm: System2Client;
}

export async function queryHub(
  query: string,
  deps: QueryDeps,
  opts: { limit?: number; category?: SourceCategory; topK?: number } = {},
): Promise<HubAnswer> {
  const started = Date.now();
  const { limit = 25, topK = 5 } = opts;

  const allowed = opts.category ? new Set(sourcesByCategory(opts.category).map((s) => s.id)) : null;
  const candidates = deps.store.search(query, limit).filter((doc) => !allowed || allowed.has(doc.source));

  if (candidates.length === 0) {
    return {
      query,
      passages: [],
      answer: { source: "offline-fallback", brief: "No documents in the data center match this query yet. Run the crawler first.", citations: [] },
      latencyMs: Date.now() - started,
      backend: deps.backend.meta.id,
    };
  }

  // Stage 2: Jev relevance ranking (one fan-out pass).
  const relevance = await deps.backend.batch(
    candidates.map((doc) => ({
      kind: "noul" as const,
      question: "Is this archived passage relevant and trustworthy for answering the study question?",
      state: `question: ${query}\nsource: ${doc.source}\ntitle: ${doc.title}\nexcerpt: ${excerptFor(doc.content, query).slice(0, 500)}`,
    })),
  );

  const passages: RankedPassage[] = candidates
    .map((doc, i) => {
      const score = relevance[i]?.kind === "noul" ? (relevance[i] as { probability: number }).probability : 0.5;
      return {
        doc,
        excerpt: excerptFor(doc.content, query),
        relevance: Math.round(score * 10000) / 10000,
        backend: relevance[i]?.backend ?? deps.backend.meta.id,
        tier: tierFor(score),
      };
    })
    .sort((a, b) => b.relevance - a.relevance);

  const kept = passages.filter((p) => p.tier !== "REJECTED").slice(0, topK);
  const usable = kept.length > 0 ? kept : passages.slice(0, Math.min(2, passages.length));

  const brief = await deps.llm.chatText(
    [
      {
        role: "system",
        content:
          "You are a senior research assistant for personal development, rationality, cognitive psychology and philosophy. " +
          "Ground every claim in the provided passages and cite the source id in brackets like [fs-blog]. " +
          "Prefer rational models and cognitive-science findings over popular advice. Structure: 1) core model, 2) evidence, 3) concrete steps. Be concise.",
      },
      {
        role: "user",
        content:
          `Study question: ${query}\n\nPassages:\n${usable
            .map((p) => `[${p.doc.source}] ${p.doc.title} (${p.doc.url})\n${p.excerpt.slice(0, 600)}\nrelevance=${p.relevance}`)
            .join("\n---\n")}\n\nAnswer in English or Turkish matching the question language. Step-by-step, with citations.`,
      },
    ],
    900,
  );

  return {
    query,
    passages: passages.slice(0, topK + 3),
    answer: brief
      ? { source: "llm", brief, citations: usable.map((p) => p.doc.url) }
      : {
          source: "offline-fallback",
          brief: usable.map((p) => `[${p.doc.source}] ${p.doc.title} (${p.relevance}): ${p.excerpt.slice(0, 300)}`).join("\n\n"),
          citations: usable.map((p) => p.doc.url),
        },
    latencyMs: Date.now() - started,
    backend: deps.backend.meta.id,
  };
}

export async function defaultQueryDeps(dbPath?: string): Promise<QueryDeps & { close: () => void }> {
  const config = loadConfig();
  const resolved = await resolveBackend(config);
  const store = new HubStore(dbPath);
  return {
    store,
    backend: resolved.backend,
    llm: new System2Client(config.llm),
    close: () => store.close(),
  };
}
