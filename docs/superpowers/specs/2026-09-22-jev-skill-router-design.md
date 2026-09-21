# jev_skill_router — Claude Skills entegrasyonu (tasarım)

## Bağlam

jev-x-kit zaten kendini bir Claude Code skill'i olarak paketliyor (`skills/jev/SKILL.md`
+ `.claude-plugin/plugin.json`). Eksik olan: kit'in, kurulu olan/olmayan **diğer**
Claude Skill'lerini görüp bir görev için en uygun olanı önerebilmesi — ve hiç skill'i
olmayan yeni kullanıcılar için bunu keşfedilebilir kılması.

Bu tasarım, oturumun başında yapıştırılan "System 1 Decision & Routing Engine"
metnindeki bazı maddelere (tri-tier confidence routing, skill routing at scale) karşılık
geliyor — ama o metindeki eğitilmiş model iddiaları (RLCD-ModernBERT-151M, SkillRouter
1.2B bi-encoder/cross-encoder, Cerebellum-2B Gated DeltaNet) **kapsam dışı**: bunlar
gerçek eğitilmiş checkpoint'ler gerektiriyor ve basit değil. `Cerebellum` ismi gerçekten
var (`theredsix/cerebellum`, npm `cerebellum-ai`) ama deprecated, ~26 haftalık indirmeli,
Claude 3.5 Sonnet'i planlayıcı olarak kullanan küçük bir tarayıcı-otomasyon kütüphanesi —
iddia edilen 2B parametreli model değil. Bu isimlere entegrasyon aranmıyor.

Bunun yerine: jev-x-kit'in zaten var olan Choice/Score primitive'leri ve BELKİ
gatekeeper'ı (`src/core/gatekeeper.ts`) yeniden kullanılarak, **gerçek ve doğrulanmış**
bir mekanizma üzerine (Claude Code'un `claude plugin` / `claude plugin marketplace` CLI'ı
ve `~/.claude/plugins/marketplaces/*/​.claude-plugin/marketplace.json` kataloğu) inşa
edilen ucuz bir skill-routing katmanı ekleniyor.

## Kapsam

**Dahil:**
1. Yeni modül: skill keşfi + sıralama (`jev_skill_router` MCP tool + `jev skills` CLI komutu).
2. `scripts/install-mcp.js`'e Claude Code desteği eklemek (şu an sadece Claude
   Desktop/Cursor/Continue.dev'i kaydediyor — Claude Code'u atlıyor, bu oturumda elle
   düzeltilen gerçek bir eksiklik).

**Dışında:** Eğitilmiş yerel model (ONNX/WebGPU), "dünyanın bütün skilleri"nin canlı
kapsamlı taraması (bkz. Hata yönetimi — sadece bilinen yerel + tek bir resmi uzak katalog),
Cerebellum/LayA/RLCD-ModernBERT entegrasyonu, MCP tool'un plugin kurulumunu bizzat
çalıştırması (güvenlik nedeniyle insanın/çağıran ajanın eline bırakılıyor).

## Mimari

### 1. Yerel keşif (`discoverInstalledSkills`)
Şu dizinlerdeki her `SKILL.md`'nin YAML frontmatter'ından (`name`, `description`) okunur:
- `<cwd>/.claude/skills/*/SKILL.md` (proje)
- `<home>/.claude/skills/*/SKILL.md` (kullanıcı, `claude plugin init` hedefi)
- `<home>/.claude/plugins/cache/**/skills/**/SKILL.md` (kurulu plugin'ler, cache ağacı)
- `<home>/.claude/plugins/marketplaces/**/{plugins,external_plugins}/**/skills/**/SKILL.md`
- jev-x-kit'in kendi `skills/*/SKILL.md`'si

İsimle dedup edilir. Bozuk/eksik frontmatter → o dosya atlanır, hata fırlatılmaz.

### 2. Katalog keşfi (`discoverCatalogSkills`)
Yerelde bulunan her `**/marketplaces/*/​.claude-plugin/marketplace.json` okunur; adım
1'de kurulu bulunan plugin adlarıyla karşılaştırılıp her giriş `installed: boolean` ile
işaretlenir. Varsa `~/.claude/plugins/install-counts-cache.json`'daki `unique_installs`
sayısı popülerlik sinyali olarak eklenir (tie-break için).

Yerelde hiç marketplace bulunamazsa (taze kurulum) **veya** çağıran `online: true`
geçerse: Anthropic'in herkese açık `anthropics/claude-plugins-public` deposundaki
`.claude-plugin/marketplace.json`'ı `https.get` ile (Node built-in, yeni bağımlılık yok,
~3sn timeout) çeker. Ağ hatası/timeout → sessizce boş katalog, asla hata fırlatmaz —
kit'in "100% offline-capable" iddiası bozulmaz, bu sadece isteğe bağlı bir zenginleştirme.

### 3. Sıralama (`rankSkills`)
`gatekeeper.ts`'teki BELKİ mantığının yeniden kullanımı:
1. Ücretsiz ön-eleme: `text.ts`'teki `tokenize` + Jaccard ile görev metni × her skill'in
   `name+description`'ı arasında skor, en iyi ~12 aday kısa listeye alınır (Zone 1, $0).
2. Kısa liste `backend.score` ile toplu (batch) puanlanır (1–10, görev + açıklama
   verilerek) — aktif backend ne ise (heuristic/yerel LLM/TypeSafe Jev) o kullanılır,
   modüle özel yeni bir backend yok.
3. #1 ile #2 arasındaki fark **>= 1.5 puan** (10 üzerinden) ise tek kesin öneri döner
   (execute zone); fark bundan küçükse top-3 döner ve seçim çağırana bırakılır
   (speculative zone). Bu, `routeByConfidence`'daki execute/speculative ayrımıyla aynı
   zihniyet — ayrı bir kavram icat edilmiyor — ama Score çıktısı (1-10) Choice'un
   confidence'ından (0-1) farklı ölçekte olduğu için kendi sabit eşiğini kullanır.

### Kurulum güvenliği
Kurulu olmayan bir katalog eşleşmesi önerildiğinde araç, doğrulanmış gerçek komutları
düz metin olarak döndürür:
```
claude plugin marketplace add <marketplace source>   # marketplace zaten ekli değilse
claude plugin install <name>@<marketplace>
```
Araç bu komutları **kendisi asla çalıştırmaz** — `jev-dispatcher.ts`'teki
`DANGER_RULES`'da "global-install" zaten `ask` seviyesinde; bir MCP tool'un
`~/.claude/plugins` global state'ini sessizce değiştirmesi kit'in kendi güvenlik
felsefesiyle çelişir. Çağıran ajan komutu gösterip kullanıcı onayıyla çalıştırır.

## Veri modeli (`src/core/module-types.ts`'e eklenecek)

```ts
export interface SkillEntry {
  name: string;
  description: string;
  source: "project" | "user" | "plugin-cache" | "plugin-marketplace" | "self";
  path: string;
  installed: true;
}

export interface CatalogSkillEntry {
  name: string;
  description: string;
  marketplace: string;
  homepage?: string;
  uniqueInstalls?: number;
  installed: false;
}

export interface SkillMatch {
  entry: SkillEntry | CatalogSkillEntry;
  relevance: ScoreResult;
  installCommand?: string[]; // only present when installed === false
}

export interface SkillRouterReport {
  task: string;
  zone: "execute" | "speculative";
  matches: SkillMatch[];       // installed skills, ranked
  catalogMatches: SkillMatch[]; // not-yet-installed suggestions
  scannedDirs: string[];
  usedRemoteCatalog: boolean;
  latencyMs: number;
}
```

## Yüzeyler

- Yeni modül: `src/modules/jev-skill-router.ts` → `class SkillRouter`
- Yeni MCP tool `jev_skill_router` (`src/tools/registry.ts`), girdi
  `{ task: string; limit?: number; online?: boolean }`
- Yeni CLI komutu: `jev skills "<görev>" [--online] [--limit N]`
- `skills/jev/SKILL.md`'deki komut tablosuna bir satır eklenir
- `src/modules/enterprise-features.ts`'teki `featureCatalog`'a yeni feature girişi

## install-mcp.js düzeltmesi

`scripts/install-mcp.js`'teki `targets` listesine Claude Code eklenir: `claude mcp add
jev-super-agent -s user -e JEV_BACKEND_PROVIDER=auto -- node <entryPoint>` komutunu
`child_process.execFileSync("claude", [...])` ile çalıştıran bir adım (Claude Desktop
gibi dosya bulunamazsa sessizce atlanır — `claude` CLI PATH'te yoksa hata fırlatmadan
"skip" mesajı basılır). Bu, bugün bu oturumda elle yapılan adımın script'e taşınmış hali.

## Hata yönetimi

- Bulunamayan dizin → boş liste, hata yok.
- Bozuk YAML frontmatter → o dosya atlanır, log'a debug satırı.
- Uzak marketplace fetch başarısız/timeout → boş katalog, `usedRemoteCatalog: false`.
- `claude` CLI PATH'te yoksa (install-mcp fix) → o hedef "skip" olarak raporlanır, script
  diğer hedeflere devam eder.

## Test

- `tests/skill-router.test.mjs`: geçici fixture dizinleriyle (gerçek `~/.claude` taranmadan)
  frontmatter parse + heuristic ön-eleme + zone hesaplama testleri.
- `scripts/smoke-test.mjs`'e: `jev_skill_router` tool'unun registry'de olduğu ve zararsız
  bir görevle çağrıldığında `SkillRouterReport` şeklinde döndüğü kontrolü (offline, ağ yok).
- Canlı network testi CI'a bağlanmaz; `--online` bayrağı sadece `test:real`/manuel
  kullanım için.
