#!/usr/bin/env node
/**
 * Uzun süreli, tamamen bağımsız araştırma taraması. Claude Code oturumunu
 * hiç kullanmaz. GÜVENCE: gerçek TypeSafe Jev API parası harcanmaz — sadece
 * $0 yöntemler kullanılır.
 *
 * Alaka filtresi jev-x-kit'in heuristic backend'ini KULLANMIYOR: o backend
 * "tested/deprecated/error" gibi kod-kalite kelimelerine bakan bir
 * cue-word simülatörü, repo açıklamalarında bu kelimeler nadiren geçtiği
 * için pratikte her adayı "alakalı" sayıyordu (gerçek bug, ilk denemede
 * bulundu). Bunun yerine jev_skill_router'daki aynı teknik: konu ile
 * repo adı+açıklaması arasında kelime örtüşmesi (tokenOverlap) — basit,
 * deterministik, tamamen $0, ve bu iş için asıl doğru araç.
 *
 * FAZ 1 — GitHub: 3 kategori x 10 konu, her biri 20 sayfa (searchGithub),
 * TÜM adaylar tokenOverlap ile skorlanıp listeleniyor (Burak'ın isteği:
 * bulunan HER repo listelensin), en alakalı ilk 40'ı README çekip Score
 * ile derinlemesine değerlendiriliyor. "Sağlam" (VERIFIED) çıkanlar gh CLI
 * ile GitHub'da yıldızlanıyor (Burak'ın isteği, idea olarak kaydetsin).
 *
 * FAZ 2 — Pazarlama/SEO/reklam: jev_research (DeepResearcher), kişisel
 * AI asistan + esports ürünleri için pazarlama/SEO araştırması.
 *
 * Her konu bittiğinde diske yazar, sabah 08:00'a (Europe/Istanbul) kadar
 * sert zaman sınırıyla çalışır.
 *
 * Run: GITHUB_TOKEN=$(gh auth token) node scripts/deep-repo-research.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
process.env.JEV_BACKEND_PROVIDER = "heuristic"; // yine de zorluyoruz: Score derinlemesine geçiş bunu kullanıyor, API parası harcanmasın.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importAbs = (relPath) => import(pathToFileURL(path.join(root, relPath)).href);

const { searchGithub } = await importAbs("dist/modules/jev-competitor-scan.js");
const { DeepResearcher } = await importAbs("dist/modules/jev-deep-researcher.js");
const { loadConfig } = await importAbs("dist/core/config.js");
const { resolveBackend } = await importAbs("dist/core/providers/index.js");
const { System2Client } = await importAbs("dist/core/llm.js");
const { tokenize } = await importAbs("dist/core/text.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

function nextStopDeadline() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5, 0, 0));
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
const STOP_AT = nextStopDeadline();
const timeLeft = () => STOP_AT.getTime() - Date.now();
const pastDeadline = () => timeLeft() <= 0;

/** $0, deterministik, pure-JS kelime örtüşmesi — jev_skill_router'daki aynı teknik. */
function tokenOverlap(topicContext, text) {
  const a = new Set(tokenize(topicContext));
  const b = new Set(tokenize(text));
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

async function starRepo(fullName) {
  try {
    await execFileAsync("gh", ["api", "-X", "PUT", `user/starred/${fullName}`]);
    return true;
  } catch (e) {
    log(`  yıldızlama başarısız (${fullName}): ${e?.message ?? e}`);
    return false;
  }
}

/* ------------------------------ FAZ 1: GitHub ------------------------------ */

const GITHUB_CATEGORIES = {
  "jarvis-kisisel-asistan": {
    context: "jarvis personal ai assistant desktop voice always-on agent local llm computer control automation",
    topics: [
      "jarvis ai assistant", "personal ai assistant desktop", "voice assistant open source",
      "always on assistant agent", "local llm personal assistant", "ai agent computer control",
      "screen overlay ai assistant", "desktop automation ai agent", "multi agent orchestrator assistant",
      "ai butler home assistant",
    ],
  },
  "esports-valorant": {
    context: "esports valorant analytics coaching scouting tournament team management tactics performance",
    topics: [
      "valorant analytics tool", "valorant api stats", "esports tournament management",
      "valorant coaching tool", "esports scouting tool", "valorant team management",
      "esports performance tracker", "riot games api tool", "esports data pipeline", "valorant discord bot",
    ],
  },
  "akademi-egitim": {
    context: "student productivity syllabus education tutor course scheduler academic learning management",
    topics: [
      "student productivity ai", "syllabus parser ai", "education management system", "ai tutor assistant",
      "learning management system open source", "study planner app", "academic research assistant ai",
      "course scheduler app", "student task manager", "ai homework helper",
    ],
  },
};

const DEEP_DIVE_TOP_N = 40;
const VERIFIED_MIN_USEFULNESS = 7;

async function fetchReadme(fullName, githubToken) {
  try {
    const res = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
      headers: {
        accept: "application/vnd.github.raw+json",
        "user-agent": "jev-x-kit-deep-research",
        ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
      },
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 6000);
  } catch {
    return null;
  }
}

async function deepDive(backend, context, candidate, githubToken) {
  const readme = await fetchReadme(candidate.fullName, githubToken);
  if (!readme) return { ...candidate, readmeFound: false };
  const [usefulness] = await backend.batch([
    {
      kind: "score",
      question: "How useful/novel is this repo's real approach for someone building a similar system, based on its actual README content?",
      min: 1, max: 10,
      state: `context: ${context}\nrepo: ${candidate.fullName}\nreadme:\n${readme}`,
    },
  ]);
  return { ...candidate, readmeFound: true, usefulness: usefulness.score };
}

async function runGithubPhase(backend, githubToken) {
  const OUT_DIR = path.join(root, "artifacts", "deep-research");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [name, { context, topics }] of Object.entries(GITHUB_CATEGORIES)) {
    const outFile = path.join(OUT_DIR, `${name}.json`);
    const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : null;
    if (existing && existing.finishedAt) {
      log(`${name} zaten tamamen bitmiş (${existing.finishedAt}), atlanıyor.`);
      continue;
    }
    const report = existing ?? { category: name, topics: [], startedAt: new Date().toISOString() };
    const done = new Set(report.topics.map((t) => t.topic));

    for (const topic of topics) {
      if (pastDeadline()) { log(`08:00 sınırına ulaşıldı, FAZ 1 (${name}) burada duruyor.`); return; }
      if (done.has(topic)) { log(`${name} / "${topic}" zaten yapılmış, atlanıyor.`); continue; }

      log(`FAZ1 ${name} / "${topic}" taranıyor (20 sayfa GitHub)...`);
      let raw = [];
      try {
        raw = await searchGithub(topic, { windowDays: 3650, sortBy: "updated", pages: 20, perPage: 50, githubToken });
      } catch (e) {
        log(`  GitHub arama hatası: ${e?.message ?? e}`);
      }

      const allScored = raw
        .map((r) => ({ ...r, relevance: Math.round(tokenOverlap(context, `${r.fullName} ${r.description}`) * 10000) / 10000 }))
        .sort((a, b) => b.relevance - a.relevance);
      log(`  -> ${allScored.length} aday bulundu (tümü listeleniyor), ilk ${Math.min(DEEP_DIVE_TOP_N, allScored.length)} tanesi derinlemesine inceleniyor...`);

      const toDeepen = allScored.slice(0, DEEP_DIVE_TOP_N);
      const deepenedFullNames = new Set(toDeepen.map((c) => c.fullName));
      const deep = [];
      let starred = 0;
      for (const c of toDeepen) {
        if (pastDeadline()) break;
        const result = await deepDive(backend, context, c, githubToken);
        if (result.readmeFound && result.usefulness >= VERIFIED_MIN_USEFULNESS) {
          const ok = await starRepo(result.fullName);
          result.starred = ok;
          if (ok) starred++;
        }
        deep.push(result);
        await sleep(githubToken ? 800 : 2500);
      }

      const remainder = allScored.filter((c) => !deepenedFullNames.has(c.fullName));

      report.topics.push({
        topic,
        totalCandidates: allScored.length,
        deepDived: deep.sort((a, b) => (b.usefulness ?? 0) - (a.usefulness ?? 0)),
        remainder, // derinlemesine incelenmemiş ama listede duran adaylar (Burak'ın isteği: hepsi listelensin)
        starredCount: starred,
        finishedAt: new Date().toISOString(),
      });
      fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
      log(`  -> tamam: ${deep.length} derinlemesine incelendi, ${starred} tanesi yıldızlandı (usefulness>=${VERIFIED_MIN_USEFULNESS}).`);
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  }
}

/* --------------------------- FAZ 2: Pazarlama/SEO --------------------------- */

const MARKETING_TOPICS = [
  "AI personal assistant product marketing strategy",
  "SaaS landing page conversion best practices",
  "AI assistant app store optimization ASO",
  "personal AI assistant positioning vs competitors",
  "esports academy platform marketing strategy",
  "AI startup investor pitch deck best practices",
  "desktop AI assistant pricing strategy freemium",
  "developer tool SEO keyword strategy",
  "gaming coaching platform social media growth strategy",
  "esports academy Reddit Discord launch strategy",
];

async function runMarketingPhase(researcher) {
  const OUT_DIR = path.join(root, "artifacts", "deep-research");
  const outFile = path.join(OUT_DIR, "pazarlama-seo-reklam.json");
  const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : null;
  if (existing && existing.finishedAt) {
    log(`pazarlama-seo-reklam zaten tamamen bitmiş (${existing.finishedAt}), atlanıyor.`);
    return;
  }
  const report = existing ?? { category: "pazarlama-seo-reklam", topics: [], startedAt: new Date().toISOString() };
  const done = new Set(report.topics.map((t) => t.topic));

  for (const topic of MARKETING_TOPICS) {
    if (pastDeadline()) { log("08:00 sınırına ulaşıldı, FAZ 2 burada duruyor."); return; }
    if (done.has(topic)) { log(`pazarlama / "${topic}" zaten yapılmış, atlanıyor.`); continue; }

    log(`FAZ2 pazarlama / "${topic}" araştırılıyor (jev_research, 4 kanal)...`);
    let brief;
    try {
      brief = await researcher.research(topic, { maxHits: 15 });
    } catch (e) {
      log(`  jev_research hatası: ${e?.message ?? e}`);
      continue;
    }
    report.topics.push({ topic, hitCount: brief.ranked.length, ranked: brief.ranked, synthesis: brief.synthesis, finishedAt: new Date().toISOString() });
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
    log(`  -> tamam: ${brief.ranked.length} sonuç, synthesis kaynağı: ${brief.synthesis.source}`);
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
}

/* ------------------------------------- main -------------------------------------- */

async function main() {
  const config = loadConfig();
  const githubToken = process.env.GITHUB_TOKEN || config.githubToken;
  const resolved = await resolveBackend(config);
  const backend = resolved.backend;
  const llm = new System2Client(config.llm);
  const researcher = new DeepResearcher({ backend, llm, githubToken, braveKey: config.searchKeys.brave, twitterBearer: config.searchKeys.twitter });

  log(`backend: ${backend.meta.id} (para maliyeti: $${backend.meta.pricePerMillionUsd}/1M token) — heuristic'e zorlandı.`);
  log(`alaka filtresi: kelime örtüşmesi (tokenOverlap), heuristic Noul DEĞİL — ilk denemede o yanlış filtreydi, düzeltildi.`);
  log(`durma zamanı: ${STOP_AT.toISOString()} (08:00 Europe/Istanbul), şu an kalan süre: ${Math.round(timeLeft() / 60000)} dakika`);

  await runGithubPhase(backend, githubToken);
  if (!pastDeadline()) {
    log("FAZ 1 (GitHub) bitti, FAZ 2'ye (pazarlama/SEO/reklam) geçiliyor...");
    await runMarketingPhase(researcher);
  }
  log(pastDeadline() ? "08:00 sınırına ulaşıldı, çalışma durduruldu." : "TÜM FAZLAR TAMAMLANDI (08:00'dan önce bitti).");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
