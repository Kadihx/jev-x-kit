/**
 * REAL backend test: Jev primitives + deep research through the locally
 * installed Ollama model (qwen2.5:3b) — the same OpenAI-compatible code path
 * that `openjev_local` uses, but with a real autoregressive model this time.
 *
 * Run:  ollama serve  +  node scripts/real-backend-test.mjs
 */

import { ChatCompatibleBackend } from "../dist/core/providers/chat-compatible.js";
import { System2Client } from "../dist/core/llm.js";
import { DeepResearcher } from "../dist/modules/jev-deep-researcher.js";
import { evaluateWithGate } from "../dist/core/gatekeeper.js";

const LLM = {
  baseUrl: "http://localhost:11434/v1",
  model: "qwen2.5:3b",
  timeoutMs: 180_000,
};

const backend = new ChatCompatibleBackend({
  id: "ollama_local",
  label: `Ollama qwen2.5:3b @ ${LLM.baseUrl}`,
  baseUrl: LLM.baseUrl,
  model: LLM.model,
  pricePerMillionUsd: 0,
  local: true,
  timeoutMs: LLM.timeoutMs,
  concurrency: 4,
});

const llm = new System2Client({
  baseUrl: LLM.baseUrl,
  model: LLM.model,
  timeoutMs: LLM.timeoutMs,
  enabled: true,
});

console.log("=".repeat(72));
console.log("BÖLÜM 1 — GERÇEK MODEL İLE JEV PRIMITIVE'LERİ (qwen2.5:3b)");
console.log("=".repeat(72));

const healthy = await backend.health();
console.log(`backend health: ${healthy}`);
if (!healthy) {
  console.error("Ollama erişilemiyor — 'ollama serve' çalışıyor mu?");
  process.exit(1);
}

// --- Choice: gerçek model karar veriyor ---
const t0 = Date.now();
const choice = await backend.choice({
  kind: "choice",
  question: "8GB VRAM'li bir GPU'da yerel ajan karar katmanı için hangi model boyutu mantıklı?",
  options: ["70B frontier model", "7-8B quantized model", "0.5-3B küçük model", "sadece bulut API"],
  state: "tek kullanıcı, offline çalışma şart, maliyet sıfır olmalı",
});
console.log(`\n[CHOICE] ${choice.latencyMs.toFixed(0)}ms`);
console.log(`  seçilen : ${choice.selected}`);
console.log(`  olasılıklar: ${choice.probabilities.map((p) => p.toFixed(3)).join(", ")}`);
console.log(`  confidence  : ${choice.confidence}`);
console.log(`  şema geçerli: ${choice.schemaValid}, backend: ${choice.backend}`);

// --- Score: gerçek model puanlıyor ---
const score = await backend.score({
  kind: "score",
  question: "Bir ajan framework'ünde tüm mikro kararları yerel küçük modele vermek ne kadar savunulabilir?",
  min: 1,
  max: 10,
  state: "offline şart, gizlilik önemli, ama planlama gibi görevler daha büyük model ister",
});
console.log(`\n[SCORE] ${score.latencyMs.toFixed(0)}ms -> ${score.score}/10 (confidence ${score.confidence})`);

// --- Noul: gerçek model olasılık veriyor ---
const noul = await backend.noul({
  kind: "noul",
  question: "Sadece 3B'lik bir model, kod üretiminde frontier modellerin kalitesine ulaşabilir mi?",
  state: "kod üretimi karmaşık çok adımlı reasoning gerektirir",
});
console.log(`\n[NOUL] ${noul.latencyMs.toFixed(0)}ms -> P(evet)=${noul.probability} (confidence ${noul.confidence})`);

// --- Gatekeeper: gerçek model kararıyla routing ---
const gate = await evaluateWithGate(backend, {
  kind: "choice",
  question: "Yeni bir özelliği doğrudan production'a almak yerine önce feature flag arkasına koymak?",
  options: ["direkt production", "feature flag arkasında", "staging'de 1 hafta test"],
  state: "kritik ödeme akışı, geri alınabilirlik önemli",
});
console.log(`\n[GATEKEEPER] route=${gate.decision.route}, confidence=${gate.decision.confidence}`);
console.log(`  seçim: ${gate.primary.selected}`);
console.log(`  gerekçe: ${gate.decision.reason}`);

console.log("\n" + "=".repeat(72));
console.log("BÖLÜM 2 — GERÇEK KONU ARAŞTIRMASI (4 kanal paralel)");
console.log("=".repeat(72));
const researcher = new DeepResearcher({
  backend,
  llm,
  concurrency: 4,
});

const topic = "diffusion language models non-autoregressive text generation";
console.log(`\nAraştırma konusu: "${topic}"`);
console.log("Kanallar: academic (arXiv) + code (GitHub/npm) + social (HN) + web (Wikipedia)\n");

const brief = await researcher.research(topic, { maxHits: 8 });
console.log(`Araştırma süresi: ${brief.latencyMs}ms`);
console.log(`\n--- KANAL BULGULARI (${brief.hits.length} sonuç) ---`);
for (const hit of brief.hits) {
  console.log(`  [${hit.channel}] ${hit.source === "network" ? "✓" : "⚠"} ${hit.title.slice(0, 70)}`);
  console.log(`      ${hit.url.slice(0, 90)}`);
}
console.log(`\n--- JEV RE-RANKING İLE EN İLGİLİ ${brief.ranked.length} SONUÇ ---`);
for (const hit of brief.ranked.slice(0, 5)) {
  console.log(`  ${hit.relevance.toFixed(2)} | ${hit.title.slice(0, 70)}`);
}
console.log("\n--- SENTEZ (yerel LLM ile) ---");
console.log(`kaynak: ${brief.synthesis.source}`);
console.log(brief.synthesis.brief.slice(0, 1800));

console.log("\n" + "=".repeat(72));
console.log("GERÇEK BACKEND TESTİ TAMAMLANDI ✓");
console.log("=".repeat(72));
