import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeCheat, detectLanguage, shingles, findDuplicate, categorize, slug, buildQueries, isOlderThan } from "../scripts/game-archive/lib.mjs";

test("cheat filter blocks cheats but keeps aim trainers", () => {
  assert.equal(looksLikeCheat("valorant-aimbot-free", "undetected"), true);
  assert.equal(looksLikeCheat("cs2-esp-wallhack"), true);
  assert.equal(looksLikeCheat("valorant 外挂 自瞄"), true);
  assert.equal(looksLikeCheat("fortnite-skin-changer"), true);
  assert.equal(looksLikeCheat("valorant-aim-trainer", "Practice flicks offline"), false);
  assert.equal(looksLikeCheat("cs2-demo-analyzer", "Parse demos and show heatmaps"), false);
});
test("language detection", () => {
  assert.equal(detectLanguage("这是一个用于瓦罗兰特的训练工具，帮助玩家提高瞄准"), "zh");
  assert.equal(detectLanguage("발로란트 에임 훈련 도구입니다 연습용"), "ko");
  assert.equal(detectLanguage("An aim trainer for Valorant"), "en");
});
test("near-copy READMEs are detected as duplicates", () => {
  const base = "Valorant tool. Features: fast, simple, safe. Download the latest release and run it on Windows 10 with admin rights today.";
  const kept = new Map([["a/a", shingles(base)]]);
  assert.equal(findDuplicate(shingles(base + " Contact me."), kept, 0.7), "a/a");
  assert.equal(findDuplicate(shingles("A totally different match analytics dashboard written in Rust with replay parsing support and charts"), kept, 0.8), null);
});
test("categorize / slug / queries / age", () => {
  assert.equal(categorize("cs2 aim trainer for flicks"), "Aim-Egitim");
  assert.equal(categorize("valorant lineups and tactics"), "Taktik-Strateji");
  assert.equal(categorize("something unrelated"), "Diger");
  assert.equal(slug("Özel Aim Eğitimi!"), "Ozel-Aim-Egitimi");
  assert.deepEqual(buildQueries({ names: ["cs2"] }, ["", "aim"]), ["cs2", "cs2 aim"]);
  assert.equal(isOlderThan("2020-01-01T00:00:00Z", 1000), true);
});
