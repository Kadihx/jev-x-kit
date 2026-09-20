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

## 2. GitHub'a yayınlandı (2026-09-20, ikinci oturum)

Repo public: **https://github.com/Kadihx/jev-x-kit** (gh ile oluşturuldu + push edildi).

- `.claude-plugin/plugin.json` + `skills/jev/SKILL.md` — repo artık doğrudan bir
  **Claude Code plugin/skill** olarak kurulabiliyor (`jev-super-agent` MCP
  server'ı otomatik kaydediyor), sadece MCP server + CLI değil.
- `package.json` → ad `jev-x-kit`, bin `jev`, repository/homepage/bugs alanları.
- `CLAUDE.md` (yeni) — kullanıcının verdiği araştırma yönergesini (fs.blog,
  LessWrong, Sivers, Julian, Internet Archive/Open Library, Gutenberg,
  Wikibooks, PhilArchive, PsyArXiv, CORE + "rasyonel modelleri popüler
  tavsiyeye tercih et, doğrudan atıf yap, adım adım mantık kur" çalışma
  yönergesi) kalıcı proje kuralı olarak yazılı hale getirdi.

## 3. Research Hub sertleştirme + ilk gerçek crawl (bu oturum)

- **MCP bağlantısı (TODO #4 tamam):** `hub_crawl`, `hub_query`, `hub_stats`
  `src/tools/registry.ts`'e eklendi (21 → **24 tool**). `AppContext`'e `llm`
  eklendi ki hub_query aynı çözülmüş backend'i tekrar-resolve etmeden kullansın.
- **Gerçek bug'lar bulundu ve düzeltildi** (canlı crawl + query testiyle):
  - `source-adapters.ts`: `allowFullContent:false` kaynaklarda (`psyarxiv`,
    `philarchive`) `detail()` her zaman `null` dönüyordu (sadece `openlibrary`
    özel-durumu vardı) → generic `detailMetadataOnly()` eklendi, ekstra fetch
    olmadan discovery'deki title+summary'den doküman üretiyor.
  - `archive` (Internet Archive) JSON `advancedsearch.php` yanıtı hiç
    parse edilmiyordu (generic HTML kart-scraper `content-type` html değil
    diye atlıyordu) → özel `discoverArchive()` eklendi (`response.docs[]`).
  - `store.ts` FTS5 `search()`: `"second-order thinking"` gibi tireli sorgular
    `no such column: order` hatasıyla çöküyordu (tire FTS5'te NOT operatörü) →
    tire de sanitize edilen karakterlere eklendi; ayrıca çok-terimli sorgular
    artık `OR` ile birleştiriliyor (önceki örtük `AND` neredeyse hiçbir doğal
    dil sorusuyla eşleşmiyordu — "habit formation dopamine" 0 sonuç veriyordu).
- **İlk gerçek crawl çalıştırıldı** (gündüz, `--force`, Berlin penceresi dışı):
  **105 belge**, 8/11 kaynak canlı: `sivers`(15) `julian`(15) `gutenberg`(15)
  `fs-blog`(15) `wikibooks`(14) `archive`(14) `psyarxiv`(15) `openlibrary`(2).
  `data/research-hub.sqlite` yerelde duruyor (repoya girmiyor, `.gitignore`
  zaten `data/*.sqlite*`'ı hariç tutuyor — kasıtlı: veri seti çalışma-zamanı
  verisi, kaynak kodu değil).
- **Bilinen açık kalan 3 kaynak** (kod hatası değil, dış engel):
  `lesswrong` (site artık Next.js SPA, statik `/sitemap.xml` yok — GraphQL API
  reverse-engineering gerekir), `philarchive` (WAF 403, bot engelleniyor),
  `core` (v3 API anahtarı gerektiriyor — `CORE_API_KEY` kararı bekliyor).
- **Uçtan uca doğrulama:** `qwen2.5:3b` (Ollama, yerelde açık) ile
  `stoic dichotomy of control` sorgusu → cevap kullanıcının yönergesindeki
  formatı birebir izledi: *core model → evidence [source-id] → concrete
  steps*. Retrieval kalitesi küçük korpus (105 belge) + heuristic Noul skorlayıcı
  ile gürültülü; gerçek kalite için Noul primitive'lerinin de bir System-2
  backend'e bağlanması (şu an sadece final sentez `System2Client`/Ollama
  kullanıyor, alaka skorlaması hâlâ `heuristic`) gerekir.

## 4. Bundan sonra kalanlar (öncelik sırasıyla)

1. **Retrieval kalitesi:** Noul relevance skorlamasını da gerçek bir backend'e
   bağla (şu an sadece cevap sentezi LLM kullanıyor) veya korpusu büyüt.
2. **lesswrong/philarchive/core:** GraphQL/WAF-bypass/API-anahtarı kararları —
   düşük öncelik, dış kaynaklı engeller.
3. **Zamanlanmış gece crawl'u:** Windows Task Scheduler ile
   `node dist/hub-cli.js crawl` (02:30 Berlin, **force olmadan** — psyarxiv'in
   OSF endpoint'i robots.txt tarafından reddediliyor, bu yüzden zamanlanmış
   (force'suz) koşularda psyarxiv atlanacak; bu kasıtlı ve nazik davranış).
4. **RLVR bağlantısı:** crawl metriklerini `.jev-skill-memory.json` döngüsüne
   bağla (başarılı crawl = +1 reward).
5. **Smoke test:** `hub_crawl`/`hub_query`/`hub_stats`'ı `scripts/smoke-test.mjs`'e
   ekle (şimdilik sadece CLI + manuel canlı testle doğrulandı).
