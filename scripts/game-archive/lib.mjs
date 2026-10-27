// Pure helpers for the game repo archive: cheat filter, language detection,
// README de-duplication, categorisation, slugs. No network, no fs -> unit-testable.

// Cheat / malware-bait denylist. Aim *trainers* are legitimate and must pass,
// so "aim" alone is never matched; only cheat vocabulary is.
const CHEAT_EN = /\b(?:hacks?|hacking|cheats?|cheating|aim[\s-]?bot|aimbot|wall[\s-]?hack|wallhack|esp|triggerbot|trigger[\s-]?bot|spoofer|hwid|skin[\s-]?changer|skinchanger|unlock[\s-]?all|undetected|injector|dll[\s-]?inject\w*|external\s+cheat|internal\s+cheat|anti[\s-]?cheat\s+bypass|bypass(?:es)?|cracked?|nuker|exploit(?:s)?|mod[\s-]?menu|modded|mod[\s-]?apk|free\s+download|unban)\b/i;
const CHEAT_CJK = /外挂|辅助|作弊|透视|自瞄|破解|脚本注入|핵|치트|오토에임|チート|ハック/;

export function looksLikeCheat(...texts) {
  const joined = texts.filter(Boolean).join(" \n ");
  return CHEAT_EN.test(joined) || CHEAT_CJK.test(joined);
}

export function detectLanguage(text) {
  const s = (text ?? "").slice(0, 4000);
  const count = (re) => (s.match(re) ?? []).length;
  const han = count(/[一-鿿]/g), kana = count(/[぀-ヿ]/g), hangul = count(/[가-힯]/g), cyr = count(/[Ѐ-ӿ]/g);
  const letters = Math.max(count(/\p{L}/gu), 1);
  if (hangul / letters > 0.1) return "ko";
  if (kana / letters > 0.05) return "ja";
  if (han / letters > 0.1) return "zh";
  if (cyr / letters > 0.2) return "ru";
  return "en";
}

function normalizeReadme(text) {
  return (text ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")        // images / badges
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")      // links -> label
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shingles(text, k = 4) {
  const words = normalizeReadme(text).split(" ").filter(Boolean);
  const set = new Set();
  if (words.length < k) { if (words.length) set.add(words.join(" ")); return set; }
  for (let i = 0; i <= words.length - k; i++) set.add(words.slice(i, i + k).join(" "));
  return set;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Returns the full name of an already-kept repo whose README is a near-copy, else null. */
export function findDuplicate(shingleSet, kept, threshold = 0.8) {
  for (const [name, other] of kept) if (jaccard(shingleSet, other) >= threshold) return name;
  return null;
}

export const CATEGORIES = [
  ["Aim-Egitim",          /\b(aim[\s-]?trainer|aim\s+train\w*|aim\s+lab|reflex|flick|tracking\s+trainer|kovaak|training\s+(?:map|pack|tool|routine|code))\b|aim\s*(?:practice|trainer)/i],
  ["Coach-Analiz",        /\b(coach\w*|replay|demo\s*(?:parser|analy\w*|viewer)|vod|review|performance\s+analy\w*|heatmap|scout\w*|match\s+analy\w*)\b/i],
  ["Taktik-Strateji",     /\b(tactic\w*|strateg\w*|lineup\w*|utility|setup|playbook|meta|draft|team\s*comp\w*|build\s*order|macro)\b/i],
  ["Istatistik-Tracker",  /\b(stats?|statistics|tracker|leaderboard|rank\w*|profile|mmr|elo|api\s+wrapper|data\s*set)\b/i],
  ["Overlay-Arac",        /\b(overlay|hud|crosshair|widget|launcher|manager|companion|utility\s+app)\b/i],
  ["Bot-Otomasyon-AI",    /\b(discord\s+bot|bot|automation|ai|machine\s+learning|neural|yolo|detect\w*|reinforcement|rl\b|agent)\b/i],
  ["Ayar-Config",         /\b(config\w*|settings?|dotfiles|autoexec|binds?|sens\w*|dpi|optimi[sz]\w*|fps\s+boost)\b/i],
];

export function categorize(text) {
  for (const [name, re] of CATEGORIES) if (re.test(text)) return name;
  return "Diger";
}

export function slug(s, max = 48) {
  const out = (s ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
    .slice(0, max).replace(/-+$/g, "");
  return out || "repo";
}

/** Heuristic fallback when no LLM is configured: first meaningful README sentence. */
export function heuristicSummary(description, readme) {
  const plain = normalizeReadme(readme).slice(0, 600);
  const first = (description && description !== "(no description)") ? description : plain.split(/[.!?]\s/)[0];
  const title = slug(first.split(/\s+/).slice(0, 6).join(" "));
  return { title, short: first.slice(0, 160), long: plain.slice(0, 500) };
}

export function isOlderThan(iso, ms, now = Date.now()) {
  return now - Date.parse(iso) > ms;
}

export function monthsToMs(m) { return m * 30 * 86_400_000; }

export function buildQueries(game, keywords) {
  const out = [];
  for (const name of game.names) for (const kw of keywords) out.push(kw ? `${name} ${kw}` : name);
  return out;
}
