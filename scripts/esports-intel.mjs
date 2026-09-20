/**
 * Esports Intelligence Agent — JEV multi-channel deep research + audit.
 *
 * Pipeline per pillar:
 *   1. DeepResearcher: parallel channels (arXiv / GitHub / npm / HN / Wikipedia + Reddit)
 *   2. Noul gate     : relevance in [0,1] per hit  -> VERIFIED >= 0.85 | PROBABLE >= 0.6 | REJECTED
 *   3. Claim extraction: System-2 LLM pulls key claims from the top hits
 *   4. Score check   : evidence strength 1-10 per claim
 *   5. Triangulation : claim must be supported by >= 2 independent channel types
 *
 * Output: artifacts/esports-intel-report.json + console summary.
 *
 * Run:  ollama serve  +  node scripts/esports-intel.mjs
 */

import fs from "node:fs";
import { ChatCompatibleBackend } from "../dist/core/providers/chat-compatible.js";
import { System2Client } from "../dist/core/llm.js";
import { DeepResearcher } from "../dist/modules/jev-deep-researcher.js";

const LLM = { baseUrl: "http://localhost:11434/v1", model: "qwen2.5:3b", timeoutMs: 180_000 };

const backend = new ChatCompatibleBackend({
  id: "ollama_local",
  label: "Ollama qwen2.5:3b",
  baseUrl: LLM.baseUrl,
  model: LLM.model,
  pricePerMillionUsd: 0,
  local: true,
  timeoutMs: LLM.timeoutMs,
  concurrency: 6,
});
const llm = new System2Client({ ...LLM, enabled: true });
const researcher = new DeepResearcher({ backend, llm, concurrency: 4 });

const PILLARS = [
  { id: "market", title: "Market & Industry Economics", query: "esports industry revenue market size sponsorship", channels: ["web", "social", "code"] },
  { id: "performance", title: "Player Performance & Tactical Analytics", query: "esports player performance analytics telemetry rating", channels: ["academic", "web"] },
  { id: "ai-coaching", title: "AI Coaching & Scouting Infrastructure", query: "AI esports coaching VOD analysis computer vision", channels: ["academic", "code"] },
  { id: "infrastructure", title: "Tournament & Ecosystem Infrastructure", query: "esports tournament anti-cheat matchmaking system", channels: ["code", "web"] },
  { id: "community", title: "Community, Social & Media", query: "esports streaming twitch fan engagement", channels: ["social", "web"] },
  { id: "prize-pools", title: "Prize Pool Dynamics", query: "The International Dota 2 prize pool esports earnings", channels: ["web"] },
];

/* ---------------- best-effort extra channel: Reddit (keyless) -------------- */

async function redditSentiment() {
  const subreddits = ["esports", "GlobalOffensive", "VALORANT", "leagueoflegends"];
  const out = [];
  for (const sub of subreddits) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=year&limit=4`, {
        signal: controller.signal,
        headers: { "user-agent": "jev-esports-intel/0.1 (research)" },
      });
      clearTimeout(timer);
      if (!response.ok) continue;
      const json = await response.json();
      for (const child of json?.data?.children ?? []) {
        const post = child.data ?? {};
        out.push({
          channel: "social",
          title: post.title ?? "(untitled)",
          url: `https://www.reddit.com${post.permalink ?? ""}`,
          snippet: `r/${sub} | score ${post.score ?? 0} | ${post.num_comments ?? 0} comments`,
          source: "network",
        });
      }
    } catch {
      /* degrade silently */
    }
  }
  return out;
}

/* ------------------------------ verification ------------------------------ */

function classifyTier(noul) {
  if (noul >= 0.85) return "VERIFIED";
  if (noul >= 0.6) return "PROBABLE";
  return "REJECTED";
}

const STOP = new Set(["the", "a", "an", "of", "in", "on", "for", "and", "or", "to", "with", "is", "are", "at", "by", "from"]);

function meaningfulTokens(text) {
  const set = new Set();
  for (const token of (text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (token.length > 2 && !STOP.has(token)) set.add(token);
  }
  return set;
}

/** Triangulation: does the claim share tokens with hits from >= 2 distinct channels? */
function triangulate(claim, hits) {
  const claimTokens = meaningfulTokens(claim);
  if (claimTokens.size === 0) return { triangulated: false, channels: [] };
  const channels = new Set();
  for (const hit of hits) {
    const hitTokens = meaningfulTokens(`${hit.title} ${hit.snippet}`);
    let overlap = 0;
    for (const token of claimTokens) if (hitTokens.has(token)) overlap++;
    if (overlap >= 2) channels.add(hit.channel);
  }
  return { triangulated: channels.size >= 2, channels: [...channels] };
}

async function extractClaims(pillar, hits) {
  const evidence = hits
    .slice(0, 6)
    .map((h) => `- [${h.channel}] ${h.title} :: ${h.snippet.slice(0, 160)} (${h.url})`)
    .join("\n");
  const result = await llm.chatJson(
    [
      { role: "system", content: "You are an esports intelligence analyst. Reply with ONE JSON object only." },
      {
        role: "user",
        content:
          `Pillar: ${pillar.title}\nEvidence from sources:\n${evidence}\n\n` +
          `Extract 3-4 key factual claims. Reply as {"claims":[{"text":string,"basedOn":url}]}. ` +
          `Only include claims traceable to the evidence above. The "basedOn" URL MUST be copied ` +
          `verbatim from one of the source URLs in parentheses above - never invent a URL.`,
      },
    ],
    () => ({ claims: hits.slice(0, 3).map((h) => ({ text: h.title, basedOn: h.url })) }),
    500,
  );
  const knownUrls = new Set(hits.map((h) => h.url));
  const claims = (result.value?.claims ?? []).slice(0, 4);
  return claims
    .filter((c) => c && typeof c.text === "string" && c.text.length > 10)
    .map((c) => ({
      text: c.text,
      basedOn: c.basedOn ?? "",
      source: result.source,
      // Provenance check: only claims pointing at a fetched hit are attributable.
      provenance: knownUrls.has(c.basedOn) ? "verified" : "fabricated",
    }));
}

/* --------------------------------- main ----------------------------------- */

const report = {
  generatedAt: new Date().toISOString(),
  backend: "ollama qwen2.5:3b (local, real inference)",
  pillars: [],
};

console.log("Reddit sentiment taramasi (r/esports, r/GlobalOffensive, r/VALORANT, r/leagueoflegends)...");
const redditHits = await redditSentiment();
console.log(`  Reddit: ${redditHits.length} top post bulundu`);

for (const pillar of PILLARS) {
  const t0 = Date.now();
  console.log(`\n=== PILLAR: ${pillar.title} ===`);
  const brief = await researcher.research(pillar.query, { channels: pillar.channels, maxHits: 10 });
  const hits = [...brief.hits];
  if (pillar.id === "community" && redditHits.length) hits.push(...redditHits.slice(0, 8));

  // Noul relevance gate: one fan-out pass over all hits.
  const relevance = await backend.batch(
    hits.map((h) => ({
      kind: "noul",
      question: "Is this source authoritative and relevant for an esports intelligence report on this pillar?",
      state: `pillar: ${pillar.title}\ntitle: ${h.title}\nurl: ${h.url}\nsnippet: ${h.snippet.slice(0, 200)}`,
    })),
  );

  const auditedHits = hits.map((hit, i) => {
    const noul = relevance[i]?.probability ?? 0.5;
    return { ...hit, noul, tier: classifyTier(noul) };
  });
  auditedHits.sort((a, b) => b.noul - a.noul);

  const counts = { VERIFIED: 0, PROBABLE: 0, REJECTED: 0 };
  for (const h of auditedHits) counts[h.tier]++;
  console.log(
    `hits=${auditedHits.length} | Noul gate: VERIFIED=${counts.VERIFIED} PROBABLE=${counts.PROBABLE} REJECTED=${counts.REJECTED} (${Date.now() - t0}ms)`,
  );

  const claims = await extractClaims(pillar, auditedHits.filter((h) => h.tier !== "REJECTED"));
  const scored = claims.length
    ? await backend.batch([
        ...claims.map((c) => ({
          kind: "score",
          question:
            "Empirical evidence strength of this claim for an esports intelligence report (10 = official API/primary data, 2 = anonymous blog)",
          state: `claim: ${c.text}\nsource: ${c.basedOn}`,
        })),
        ...claims.map((c) => ({
          kind: "noul",
          question: "Is this claim valid, current (2024-2026) and not an unverified rumor?",
          state: `claim: ${c.text}\nsource: ${c.basedOn}`,
        })),
      ])
    : [];
  const half = claims.length;
  const auditedClaims = claims.map((c, i) => {
    const evidenceScore = c.provenance === "fabricated" ? 2 : (scored[i]?.score ?? 5);
    const validity = c.provenance === "fabricated" ? 0.2 : (scored[half + i]?.probability ?? 0.5);
    const tri = triangulate(c.text, auditedHits.filter((h) => h.tier !== "REJECTED"));
    return { ...c, evidenceScore, validityNoul: validity, tier: classifyTier(validity), ...tri };
  });

  report.pillars.push({
    id: pillar.id,
    title: pillar.title,
    query: pillar.query,
    latencyMs: Date.now() - t0,
    synthesis: brief.synthesis,
    hits: auditedHits,
    claims: auditedClaims,
    gateCounts: counts,
  });

  for (const c of auditedClaims) {
    console.log(
      `  claim [${c.tier}] score=${c.evidenceScore}/10 triangulated=${c.triangulated ? c.channels.join("+") : "no"}`,
    );
    console.log(`    ${c.text.slice(0, 110)}`);
  }
}

fs.mkdirSync(new URL("../artifacts", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../artifacts/esports-intel-report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log("\nRAPOR: artifacts/esports-intel-report.json");
console.log("ESPORTS INTEL PIPELINE TAMAMLANDI OK");
