#!/usr/bin/env node
/**
 * Uzun süreli, tamamen bağımsız GitHub araştırma taraması. Claude Code
 * oturumunu (ve token bütçesini) hiç kullanmaz — jev-x-kit'in kendi
 * CompetitorScanner + JevBackend primitive'lerini (Noul/Score, $0.042/1M
 * token TypeSafe Jev veya offline heuristic) kullanarak sorguları tarar.
 *
 * İki aşamalı: (1) her konu için GitHub'ı sayfalar (varsayılan 20 sayfa,
 * ~1000 repo), her adayı Noul ile alaka skoruna göre VERIFIED/PROBABLE/
 * REJECTED'a ayırır — bu CompetitorScanner'ın zaten yaptığı şey, yeniden
 * yazılmadı. (2) REJECTED olmayan her aday için gerçek README'sini çeker ve
 * ikinci bir Score geçişiyle "bu yaklaşım gerçekten ne kadar faydalı/özgün"
 * diye derinlemesine değerlendirir — asıl zaman burada gidiyor, gerçek analiz.
 *
 * İlerleme her konudan sonra artifacts/deep-research/<kategori>.json'a
 * yazılır — kesintiye dayanıklı, süreç öldürülse bile o ana kadarki sonuç
 * diskte kalır.
 *
 * Run (arka planda, saatlerce sürebilir):
 *   npm run build
 *   GITHUB_TOKEN=$(gh auth token) node scripts/deep-repo-research.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importAbs = (relPath) => import(pathToFileURL(path.join(root, relPath)).href);

const { CompetitorScanner } = await importAbs("dist/modules/jev-competitor-scan.js");
const { loadConfig } = await importAbs("dist/core/config.js");
const { resolveBackend } = await importAbs("dist/core/providers/index.js");
const { System2Client } = await importAbs("dist/core/llm.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

const CATEGORIES = {
  "jarvis-kisisel-asistan": {
    ourDescription:
      "We are researching real open-source JARVIS-style personal AI assistants and always-on desktop agents " +
      "to learn architecture patterns, tool-calling designs, and safety/approval mechanisms.",
    topics: [
      "jarvis ai assistant",
      "personal ai assistant desktop",
      "voice assistant open source",
      "always on assistant agent",
      "local llm personal assistant",
      "ai agent computer control",
      "screen overlay ai assistant",
      "desktop automation ai agent",
      "multi agent orchestrator assistant",
      "ai butler home assistant",
    ],
  },
  "esports-valorant": {
    ourDescription:
      "We are researching real open-source esports/Valorant tooling — analytics, coaching, scouting and " +
      "team-management software — to learn what data pipelines and integrations this space actually builds.",
    topics: [
      "valorant analytics tool",
      "valorant api stats",
      "esports tournament management",
      "valorant coaching tool",
      "esports scouting tool",
      "valorant team management",
      "esports performance tracker",
      "riot games api tool",
      "esports data pipeline",
      "valorant discord bot",
    ],
  },
  "akademi-egitim": {
    ourDescription:
      "We are researching real open-source academic/education tooling — student productivity, syllabus " +
      "parsing, tutoring and course-management software — to learn real architecture patterns in this space.",
    topics: [
      "student productivity ai",
      "syllabus parser ai",
      "education management system",
      "ai tutor assistant",
      "learning management system open source",
      "study planner app",
      "academic research assistant ai",
      "course scheduler app",
      "student task manager",
      "ai homework helper",
    ],
  },
};

const OUT_DIR = path.join(root, "artifacts", "deep-research");
fs.mkdirSync(OUT_DIR, { recursive: true });

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

async function deepDive(candidate, ourDescription, backend, githubToken) {
  const readme = await fetchReadme(candidate.fullName, githubToken);
  if (!readme) return { ...candidate, readmeFound: false };
  const [usefulness] = await backend.batch([
    {
      kind: "score",
      question:
        "How useful/novel is this repo's real approach for someone building a similar system, based on its actual README content (not just the short description)?",
      min: 1,
      max: 10,
      state: `context: ${ourDescription}\nrepo: ${candidate.fullName}\nreadme:\n${readme}`,
    },
  ]);
  return { ...candidate, readmeFound: true, usefulness: usefulness.score, usefulnessSignals: usefulness.signals };
}

async function runCategory(scanner, backend, name, { ourDescription, topics }, githubToken) {
  const outFile = path.join(OUT_DIR, `${name}.json`);
  const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : null;
  const report = existing && !existing.finishedAt ? existing : { category: name, topics: [], startedAt: new Date().toISOString() };
  const doneTopics = new Set(report.topics.map((t) => t.topic));

  for (const topic of topics) {
    if (doneTopics.has(topic)) {
      log(`${name} / "${topic}" zaten yapılmış, atlanıyor (devam eden çalışma)`);
      continue;
    }
    log(`${name} / "${topic}" taranıyor (20 sayfa GitHub araması)...`);
    const scan = await scanner.scan(topic, {
      windowDays: 3650,
      pages: 20,
      limit: 50,
      sortBy: "updated",
      ourDescription,
    });
    log(`  -> ${scan.candidates.length} aday bulundu, derinlemesine inceleme başlıyor...`);

    const toDeepen = scan.candidates.filter((c) => c.tier !== "REJECTED");
    const deep = [];
    for (const c of toDeepen) {
      deep.push(await deepDive(c, ourDescription, backend, githubToken));
      await sleep(githubToken ? 800 : 2500);
    }

    const topicResult = {
      topic,
      totalCandidates: scan.candidates.length,
      verified: scan.candidates.filter((c) => c.tier === "VERIFIED").length,
      probable: scan.candidates.filter((c) => c.tier === "PROBABLE").length,
      synthesis: scan.synthesis,
      deepDive: deep.sort((a, b) => (b.usefulness ?? 0) - (a.usefulness ?? 0)),
      finishedAt: new Date().toISOString(),
    };
    report.topics.push(topicResult);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
    log(`  -> tamam: ${topicResult.verified} verified, ${topicResult.probable} probable, ${deep.length} README incelendi. Yazıldı: ${outFile}`);
  }

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  return report;
}

async function main() {
  const config = loadConfig();
  const githubToken = process.env.GITHUB_TOKEN || config.githubToken;
  if (!githubToken) {
    log("UYARI: GITHUB_TOKEN yok — 10 req/dk arama + 60 req/saat README limitiyle bu iş çok yavaş ilerler.");
  }
  const resolved = await resolveBackend(config);
  const backend = resolved.backend;
  const llm = new System2Client(config.llm);
  const scanner = new CompetitorScanner({ backend, llm, githubToken });
  log(`backend: ${backend.meta.id} (${resolved.chain.join(" -> ")})`);

  for (const [name, cfg] of Object.entries(CATEGORIES)) {
    await runCategory(scanner, backend, name, cfg, githubToken);
  }
  log("TÜM KATEGORİLER TAMAMLANDI");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
