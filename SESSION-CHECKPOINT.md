# 📦 jev-x-kit — Session Checkpoint (2026-09-20, UTC)

> Bu dosya bu oturumda yapılan her şeyi klasöre kaydeder ve bundan sonra
> yapılacakları listeler. Kodun kendisi `src/`, `tests/`, `scripts/`,
> `presets/`, `artifacts/` altında durur; burada sadece durum özeti var.

## 0. Klasör Durumu (doğrulanmış)

| Alan | Durum |
|---|---|
| Derleme (`npm run build`, tsc strict) | ✅ sıfır hata |
| Unit test (`npm test`) | ✅ 27/27 (core 20 + datacenter 7) |
| E2E smoke (`npm run smoke`) | ✅ 50 kontrol / 21 tool |
| Gerçek model testi (`npm run test:real`, Ollama `qwen2.5:3b`) | ✅ Choice/Score/Noul + Gatekeeper + 4-kanal araştırma |
| Esports intel pipeline (`scripts/esports-intel.mjs`) | ✅ 6 pillar + Noul/Score/triangülasyon, rapor `artifacts/` altında |
| Bağımlılıklar (`cheerio@1.2.0` eklendi) | ✅ `package.json` + `package-lock.json` güncel |

```
src/
  cli.ts  index.ts  hub-cli.ts            # MCP server + jev CLI + research-hub CLI
  core/      (config, errors, fanout, gatekeeper, llm, log, memory,
              module-types, paths, presets, text, types,
              providers: heuristic, chat-compatible, typesafe-native, index)
  modules/   (jev-evaluator, jev-planner, jev-redteam, jev-audit,
              jev-deep-researcher, context-compactor, github-miner,
              jev-training-kit, self-improver, jev-dispatcher,
              enterprise-features)
  tools/     (registry.ts — 21 MCP tool)
  datacenter/(source-configs, source-adapters, robots, fetcher,
              store, crawler, query, license-engine)   # YENİ: bilgi veri merkezi
tests/       (core.test.mjs 20 test, datacenter.test.mjs 7 test)
scripts/     (smoke-test, real-backend-test, warmup, esports-intel)
presets/     (7 sektör preset'i)
artifacts/   (esports raporları + smoke memory)
```

## 1. Bu Oturumda Yapılanlar (tamamlanan iş)

### A. JEV Super Agent MCP Framework (blueprint §1–§4)
- Modül 1–10'un tamamı TypeScript ile yazıldı: evaluator + "BELKİ" gatekeeper,
  ultra-planner, red-team dual loop, 360° audit, deep-researcher (4 kanal),
  Winnow kayıpsız compactor, GitHub miner + clean-room, training kit
  (labeler/DPO/distill recipe), RLVR self-improver, chief-of-staff + guardrail,
  20 enterprise özelliği.
- 21 MCP tool + CLI + 7 sektör preset'i + `.env.example` + README + LICENSE.
- Backend zinciri: `typesafe_jev → openjev_local → laya_local → heuristic`
  (çevrimdışı deterministik simülatör her zaman çalışır).

### B. Gerçek Model Doğrulaması (kullanıcının isteğiyle)
- Docker `razorback16/openjev` (26.1 GB) indirildi; RTX 3070'in 8 GB VRAM'i
  DiffusionGemma-26B için yetersiz kaldı (7.2 GiB istiyor) → vLLM başlamadı.
- Çözüm: makinedeki **Ollama + `qwen2.5:3b`** ile gerçek inference testi
  (`scripts/real-backend-test.mjs`): Choice 632 ms, Score 238 ms, Noul 251 ms,
  gatekeeper speculative→execute; 4-kanal araştırma (arXiv/GitHub/npm/HN/Wiki)
  + Jev re-rank + yerel LLM sentezi — hepsi gerçek veri.
- Bulunan bug düzeltildi: HN Algolia uzun sorguda 0 sonuç veriyordu →
  **otomatik sorgu-kısaltma fallback'i** eklendi.

### C. Esports Intelligence Raporu (kullanıcının prompt'uyla)
- `scripts/esports-intel.mjs`: 6 pillar × 4 kanal, Noul gate (≥0.85 VERIFIED),
  Score 1–10, triangülasyon. Çıktılar:
  `artifacts/ESPORTS-INTELLIGENCE-REPORT.md` + `esports-intel-report.json`.
- Protokol 2 olayı yakaladı: (1) AI-coaching pillar'ında 3B modelin uydurduğu
  kaynak URL'leri → 4 claim REJECTED; (2) Kyedae iddiasındaki çarpıtma.
  Bunlardan **URL provenance check** kuralı üretildi ve scripte işlendi.

### D. Bilgi Veri Merkezi (son istek — YENİ, bu oturumda başlandı)
Kullanıcının verdiği 11 kaynaklı araştırma-yönerge prompt'u için altyapı:
- `source-configs.ts` — **11 kaynak**, 3 kategori:
  mental-models (fs-blog, lesswrong, sivers, julian),
  library (openlibrary, archive, gutenberg, wikibooks),
  academic (philarchive, psyarxiv, core).
  Her kaynakta: discovery URL'leri, CSS seçiciler, hız limiti, eşzamanlılık,
  **02:00–06:00 Europe/Berlin** crawl penceresi, dürüst user-agent.
- `source-adapters.ts` — sitemap + sayfa kartı + JSON-API (Open Library,
  Wikibooks API, OSF/PsyArXiv, CORE) discovery; sive.rs görsel-alt-text
  fallback dahil (canlı testle doğrulandı: 482 kitap linki → 5/5 discovery).
- `robots.ts` — robots.txt zorunlu kapı (deny-by-default, longest-match).
- `fetcher.ts` — host başına rate-limit + concurrency + retry/backoff + önbellek.
- `store.ts` — `node:sqlite` + FTS5, hash dedupe (inserted/updated/unchanged),
  BM25 arama, crawl_runs kaydı. `data/research-hub.sqlite` yolunda durur.
- `crawler.ts` — 6 aşamalı pipeline (saat → robots → discovery → lisans →
  fetch → store), `--dry-run`/`--force` destekli.
- `query.ts` — FTS5 + Jev Noul re-rank + VERIFIED/PROBABLE/REJECTED tier'ları;
  kullanıcının çalışma yönergesine uygun cevap üretimi (rasyonel model önce,
  doğrudan atıf, adım adım mantık).
- `license-engine.ts` — clean-room v2: Gutenberg kamu malı tam metin;
  akademik + Open Library/CORE özet-künye; ücretsiz web/açık lisans tam metin.
- `src/hub-cli.ts` + `npm run hub` — `sources | crawl | query | stats | runs`.
- `tests/datacenter.test.mjs` — 7 çevrimdışı test (registry, pencere, robots,
  lisans, store/FTS, query tier'ları). **Şu an 7/7 yeşil.**

## 2. Bundan Sonra Yapılacaklar (öncelik sırasıyla)

1. **İlk gerçek crawl (gece penceresinde):**
   `npm run hub -- crawl --max-items 12` (02:00–06:00 Berlin) veya gündüz test
   için `--force`. Beklenen: ~11 kaynak × ~12 öğe ≈ 100+ belge, SQLite + FTS5.
2. **Canlı query doğrulaması:** `npm run hub -- query "second-order thinking"`,
   `... "habit formation dopamine"`, `... "stoic dichotomy of control"`;
   Jev tier'larının (VERIFIED/PROBABLE/REJECTED) anlamlı dağıldığını kontrol et.
3. **Kaynak adaptör sertleştirme:** fs.blog/LessWrong/Julian/PhilArchive/
   Gutenberg/archive.org/Wikibooks/OSF/CORE için tek tek `--source <id>`
   ile dry-run, seçici (selector) düzeltmeleri; CORE için API anahtarı kararı
   (`CORE_API_KEY` env veya discovery-dışı bırakma).
4. **MCP tool'larına bağlama:** `hub_crawl`, `hub_query`, `hub_stats` tool'larını
   `src/tools/registry.ts`'e ekle (şu an sadece CLI var) + smoke test'e ekle.
5. **Zamanlanmış gece crawl'u:** Windows Task Scheduler / cron ile
   `node dist/hub-cli.js crawl` (02:30 Berlin) + `hub_stats` raporu.
6. **Raporlama:** crawl metriklerini `.jev-skill-memory.json` RLVR döngüsüne
   bağla (başarılı crawl = +1 reward, eşik oto-ayarı).
7. **Opsiyonel:** `data/` klasörünün `.gitignore` durumunu netleştir (şu an
   sqlite dosyası repoya girebilir; büyükse ignore'a ekle), README'ye
   research-hub bölümünü yaz, `npm run hub` script açıklamasını ekle.
