#!/usr/bin/env node
/**
 * Game repo archive: Oyun / Kategori / Başlık / (ACIKLAMA.md + kaynak kod).
 *
 *   node scripts/game-archive/run.mjs sweep  [--out DIR] [--game "Valorant"] [--dry]
 *   node scripts/game-archive/run.mjs update [--out DIR] [--game "Valorant"] [--dry]
 *
 * sweep  = Best Match ilk 20 sayfa + Recently Updated (son 2 aya kadar).
 * update = her 12 saatte bir: Recently Updated, son 12 saat; GUNCELLEME.txt'ye not.
 *
 * Gerekli: GITHUB_TOKEN (gh auth token). Opsiyonel LLM (başlık/özet/çeviri):
 *   JEV_LLM_BASE_URL + JEV_LLM_MODEL (+ JEV_LLM_API_KEY) veya TYPESAFE_JEV_API_KEY + TYPESAFE_JEV_BASE_URL.
 * Hile repoları arşive ALINMAZ. İndirilen kod asla çalıştırılmaz; ikili dosyalar silinir.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  looksLikeCheat, detectLanguage, shingles, findDuplicate, categorize, slug,
  heuristicSummary, isOlderThan, monthsToMs, buildQueries,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, "config.json"), "utf8"));

const args = process.argv.slice(2);
const mode = args[0];
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1]?.startsWith("--") || args[i + 1] === undefined ? true : args[i + 1]) : undefined; };
const outDir = path.resolve(flag("out") && flag("out") !== true ? flag("out") : path.join(here, "..", "..", "..", "game-repo-archive"));
const onlyGame = flag("game") && flag("game") !== true ? flag("game") : null;
const dry = Boolean(flag("dry"));
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

if (!["sweep", "update"].includes(mode)) { console.error("usage: run.mjs sweep|update [--out DIR] [--game NAME] [--dry]"); process.exit(2); }
if (!token) { console.error("GITHUB_TOKEN yok (gh auth token)."); process.exit(2); }

const ghHeaders = { accept: "application/vnd.github+json", "user-agent": "jev-x-kit-game-archive", authorization: `Bearer ${token}` };
async function gh(url, init = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...ghHeaders, ...(init.headers ?? {}) } });
    if ((res.status === 403 || res.status === 429) && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 30_000 * (attempt + 1);
      log(`rate limit (${res.status}), ${Math.round(wait / 1000)}s bekleniyor`); await sleep(wait); continue;
    }
    return res;
  }
}

async function searchPage(q, sort, page, perPage) {
  const sortPart = sort ? `&sort=${sort}&order=desc` : "";
  const res = await gh(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}${sortPart}&per_page=${perPage}&page=${page}`);
  if (!res?.ok) { log(`arama başarısız (${res?.status}) q="${q}" page=${page}`); return null; }
  return (await res.json()).items ?? [];
}

/** Best Match: sort yok. Recent: sort=updated, `stopWhenOlderMs` aşılınca durur. */
async function collect(query, { sort, pages, perPage, stopWhenOlderMs }) {
  const found = [];
  for (let page = 1; page <= pages; page++) {
    const items = await searchPage(query, sort, page, perPage);
    if (!items || items.length === 0) break;
    let reachedOld = false;
    for (const it of items) {
      if (stopWhenOlderMs && isOlderThan(it.pushed_at, stopWhenOlderMs)) { reachedOld = true; continue; }
      found.push(it);
    }
    if (reachedOld) break;
    await sleep(2100);
  }
  return found;
}

async function fetchReadme(full) {
  const res = await gh(`https://api.github.com/repos/${full}/readme`, { headers: { accept: "application/vnd.github.raw+json" } });
  return res?.ok ? (await res.text()).slice(0, 12_000) : "";
}

const BINARY = /\.(exe|dll|so|dylib|apk|ipa|msi|bat|cmd|scr|jar|bin|sys|drv|vmp|dmp)$/i;
function stripBinaries(dir) {
  let removed = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === ".git") fs.rmSync(p, { recursive: true, force: true }); else removed += stripBinaries(p); }
    else if (e.isSymbolicLink() || BINARY.test(e.name)) { fs.rmSync(p, { force: true }); removed++; }
  }
  return removed;
}

async function downloadSource(full, dest) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "garchive-"));
  const tgz = path.join(tmp, "src.tgz");
  try {
    const res = await gh(`https://api.github.com/repos/${full}/tarball`);
    if (!res?.ok) return { ok: false, reason: `tarball HTTP ${res?.status}` };
    fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    fs.mkdirSync(dest, { recursive: true });
    await execFileAsync("tar", ["-xzf", tgz, "--strip-components=1", "--no-same-owner", "-C", dest]);
    return { ok: true, removedBinaries: stripBinaries(dest) };
  } catch (e) { return { ok: false, reason: String(e.message ?? e).slice(0, 200) }; }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function llmConfig() {
  const base = process.env.JEV_LLM_BASE_URL ?? (process.env.TYPESAFE_JEV_API_KEY ? process.env.TYPESAFE_JEV_BASE_URL : undefined);
  const model = process.env.JEV_LLM_MODEL ?? process.env.TYPESAFE_JEV_MODEL;
  const key = process.env.JEV_LLM_API_KEY ?? process.env.TYPESAFE_JEV_API_KEY;
  return base && model ? { base: base.replace(/\/$/, ""), model, key } : null;
}
const llm = llmConfig();

async function describe(repo, readme, lang) {
  const fallback = { ...heuristicSummary(repo.description, readme), category: null, source: "heuristic" };
  if (!llm) return fallback;
  try {
    const res = await fetch(`${llm.base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(llm.key ? { authorization: `Bearer ${llm.key}` } : {}) },
      body: JSON.stringify({
        model: llm.model, temperature: 0, response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Repo README'sini (Çince/Korece/İngilizce olabilir) Türkçeye özetle. Sadece JSON dön: {\"title\": kısa-klasör-başlığı (en çok 6 kelime), \"short\": 1 cümle ne işe yarar, \"long\": 3-4 cümle işlev ve kullanım}. Uydurma yapma; README'de olmayanı yazma." },
          { role: "user", content: `repo: ${repo.full_name}\ndescription: ${repo.description ?? ""}\nlanguage-detected: ${lang}\nREADME:\n${readme.slice(0, 5000)}` },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const j = JSON.parse((await res.json()).choices?.[0]?.message?.content ?? "{}");
    if (!j.title || !j.short) return fallback;
    return { title: slug(j.title), short: String(j.short), long: String(j.long ?? j.short), category: null, source: "llm" };
  } catch { return fallback; }
}

// ---- state ----
const stateFile = path.join(outDir, "_config", "state.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : { repos: {}, duplicates: {}, skipped: {} };
const saveState = () => { if (!dry) { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 1)); } };

const keptShingles = new Map(); // game -> Map(full_name -> Set)

async function processRepo(game, repo, changes) {
  const full = repo.full_name;
  const known = state.repos[full];
  if (known && known.pushedAt === repo.pushed_at) return;
  if (state.skipped[full] && state.skipped[full].pushedAt === repo.pushed_at) return;
  if (repo.fork || repo.archived) { state.skipped[full] = { reason: repo.fork ? "fork" : "archived", pushedAt: repo.pushed_at }; return; }
  if (looksLikeCheat(repo.full_name, repo.description, ...(repo.topics ?? []))) { state.skipped[full] = { reason: "cheat", pushedAt: repo.pushed_at }; return; }

  const readme = await fetchReadme(full);
  if (looksLikeCheat(readme.slice(0, 3000))) { state.skipped[full] = { reason: "cheat(readme)", pushedAt: repo.pushed_at }; return; }

  const sh = shingles(readme);
  const gm = keptShingles.get(game) ?? new Map(); keptShingles.set(game, gm);
  if (!known) {
    const dupOf = findDuplicate(sh, gm, cfg.dupThreshold);
    if (dupOf) { state.duplicates[full] = { of: dupOf, game }; return; }
  }

  const lang = detectLanguage(readme || repo.description);
  const desc = await describe(repo, readme, lang);
  const category = categorize(`${repo.full_name} ${repo.description ?? ""} ${(repo.topics ?? []).join(" ")} ${readme.slice(0, 1500)}`);
  const folder = path.join(outDir, game, category, desc.title, full.split("/")[1]);
  const metaDir = path.dirname(folder);
  const oversize = repo.size > cfg.maxRepoSizeKB;

  changes.push({ full, game, category, kind: known ? "güncellendi" : "yeni", lang, oversize });
  if (dry) return;

  fs.mkdirSync(metaDir, { recursive: true });
  let sourceNote = "kaynak kod klasörde";
  if (oversize) {
    sourceNote = `kaynak kod EKLENMEDİ (boyut ${Math.round(repo.size / 1024)} MB > sınır). Tersine mühendislik analizi gerekli: ANALIZ-GEREKLI.md`;
    fs.writeFileSync(path.join(metaDir, "ANALIZ-GEREKLI.md"), `# ${full}\n\nKaynak kod boyut sınırı nedeniyle depoya alınmadı. Tersine mühendislik reposu ile çıkarılacak: ne yapıyor, nasıl yapıyor, biz nasıl yaparız.\n\nhttps://github.com/${full}\n`);
  } else {
    fs.rmSync(folder, { recursive: true, force: true });
    const dl = await downloadSource(full, folder);
    if (!dl.ok) sourceNote = `kaynak kod indirilemedi: ${dl.reason}`;
  }
  const lic = repo.license?.spdx_id ?? "belirtilmemiş";
  fs.writeFileSync(path.join(metaDir, "ACIKLAMA.md"), [
    "---", `repo: ${full}`, `oyun: ${game}`, `kategori: ${category}`, `dil: ${lang}`,
    `yildiz: ${repo.stargazers_count}`, `son_guncelleme: ${repo.pushed_at}`, `lisans: ${lic}`, `aciklama_kaynagi: ${desc.source}`, "---", "",
    `# ${desc.short}`, "", desc.long, "", `- GitHub: https://github.com/${full}`, `- Kaynak: ${sourceNote}`,
    lic === "belirtilmemiş" ? "- Uyarı: lisans belirtilmemiş; kullanmadan önce kontrol et." : `- Lisans: ${lic}`, "",
  ].join("\n"));
  state.repos[full] = { game, category, title: desc.title, pushedAt: repo.pushed_at, path: path.relative(outDir, folder), short: desc.short, lang };
  gm.set(full, sh);
  delete state.skipped[full];
}

function writeIndexAndUpdateLog(game, changes) {
  if (dry) return;
  const gdir = path.join(outDir, game);
  fs.mkdirSync(gdir, { recursive: true });
  if (mode === "update" && changes.length) {
    const lines = changes.map((c) => `  - [${c.kind}] ${c.full} (${c.category}, ${c.lang})`).join("\n");
    fs.appendFileSync(path.join(gdir, "GUNCELLEME.txt"), `${new Date().toISOString()}\n${lines}\n\n`);
  } else if (!fs.existsSync(path.join(gdir, "GUNCELLEME.txt"))) fs.writeFileSync(path.join(gdir, "GUNCELLEME.txt"), "");
  const rows = Object.entries(state.repos).filter(([, r]) => r.game === game)
    .sort((a, b) => a[1].category.localeCompare(b[1].category))
    .map(([full, r]) => `- [[${r.path}/../ACIKLAMA|${full}]] — **${r.category}** — ${r.short}`);
  fs.mkdirSync(path.join(outDir, "_index"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "_index", `${game}.md`), `# ${game}\n\n${rows.join("\n")}\n`);
}

for (const [game, def] of Object.entries(cfg.games)) {
  if (onlyGame && onlyGame.toLowerCase() !== game.toLowerCase()) continue;
  log(`=== ${game} (${mode}) ===`);
  const changes = [];
  const queries = buildQueries(def, cfg.keywords);
  const candidates = new Map();
  for (const q of queries) {
    if (mode === "sweep") {
      for (const it of await collect(q, { sort: null, pages: cfg.bestMatchPages, perPage: cfg.perPage })) candidates.set(it.full_name, it);
      for (const it of await collect(q, { sort: "updated", pages: cfg.maxRecentPages, perPage: 30, stopWhenOlderMs: monthsToMs(cfg.recentMonths) })) candidates.set(it.full_name, it);
    } else {
      for (const it of await collect(q, { sort: "updated", pages: cfg.maxRecentPages, perPage: 30, stopWhenOlderMs: cfg.updateWindowHours * 3_600_000 })) candidates.set(it.full_name, it);
    }
    log(`  "${q}" -> toplam aday ${candidates.size}`);
  }
  for (const repo of candidates.values()) {
    try { await processRepo(game, repo, changes); } catch (e) { log(`  hata ${repo.full_name}: ${e.message}`); }
  }
  writeIndexAndUpdateLog(game, changes);
  saveState();
  log(`${game}: ${changes.length} değişiklik, ${Object.keys(state.skipped).length} atlanan (toplam), ${Object.keys(state.duplicates).length} kopya`);
}
