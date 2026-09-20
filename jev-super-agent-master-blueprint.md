# MASTER BLUEPRINT: JEV SUPER AGENT SKILL & MCP FRAMEWORK (SINGLE DEFINITIVE EDITION)

> **Proje Adı**: `jev-super-agent-mcp` (Universal TypeSafe Jev & OpenJev Autonomous Decision, Deep Research, Ultra-Planning & Self-Improving Agent Framework)  
> **Desteklenen Platformlar**: Claude Code, Cursor, Codex, **OpenCode (Free)**, **Continue.dev (VS Code Free)**, **Ollama / vLLM (Local Free)**, MCP (Model Context Protocol) Uyumlu Tüm Ajanlar  
> **Temel Altyapı**: TypeSafe AI Jev / **OpenJev (DiffusionGemma / vLLM / jevlike / Laya / CUA-S1)** + Vercel AI Gateway Free Tier / Cloudflare Workers AI  

---

## 1. NEDEN BU SİSTEMİ KURUYORUZ? (KÖK PROBLEMLER VE ÇÖZÜM MİMARİSİ)

### A. Mevcut Ajan Sistemlerinin 6 Temel Tıkanıklığı (Kök Problemler)

1. **Gecikme Duvarı (Latency Wall)**:  
   Geleneksel üretken dil modelleri (LLM'ler) bir e-posta sınıflandırması, araç seçimi veya güvenlik denetimi gibi mikro kararlarda otoregresif olarak kelime kelime çıktı üretir. Tek bir basit "evet/hayır" veya kategori seçimi **3 ila 30 saniye** sürer [2, 219].

2. **Maliyet Patlaması (Token Cost Explosion)**:  
   Ajan döngülerinde (agentic loops) sürekli "Bu log önemli mi?", "Hangi kütüphane seçilmeli?", "Kodda hata var mı?" gibi sorular için pahalı frontier modeller (Claude Opus, GPT-6) çağrılır. Basit bir oturum **$10–$50** maliyet yaratır [18, 206, 216].

3. **Halüsinasyon ve Şema Bozulması (JSON Parse Errors)**:  
   LLM'ler serbest metin ürettiği için JSON formatını bozabilir, olmayan parametreler uydurabilir veya kural dışı cevaplar verebilir [1, 2, 210].

4. **Bağlam Kirlenmesi (Context Rot & Garbage)**:  
   `git diff`, `grep` veya terminal dökümleri özetlenme adı altında LLM'e verildiğinde, LLM dosya yollarını, komutları veya hata kodlarını değiştirerek halüsinasyona sebep olur [79, 85, 267, 280].

5. **Aşırı Özgüven ve Tek Geçişli Kör Noktalar (Single-Pass Blind Spot)**:  
   İster Sonnet ister Opus kullanılsın, model kendi ürettiği plana veya koda "Kendi açısından" baktığı için mantık hatalarını ve yarış koşullarını (race conditions) fark edemez [12, 14, 258].

6. **Ticari Bağımlılık ve Açık Kaynak İhtiyacı (Proprietary Lock-in)**:  
   Sadece TypeSafe API veya Claude Code gibi ücretli servislerle sınırlı kalmak, çevrimdışı (offline) çalışan veya bütçesiz geliştiricileri dışarıda bırakır. Sistem %100 ÜCRETSİZ ve YEREL (OpenCode, Ollama, vLLM, OpenJev, DiffusionGemma) çalışabilmelidir [50, 70, 203, 290].

---

### B. Çözüm: Non-Autoregressive System 1 Karar Katmanı

`jev-super-agent-mcp` kiti; **1.000.000 girdi token'ı = $0.042** (veya yerel modellerde **$0**), **çıktı token'ı = $0**, **70–150 ms** yanıt süresine sahip, **RLCD (Reinforcement Learning for Calibrated Decisions)** ile eğitilmiş **Sistem 1** karar modelini temel alır [2, 38, 57, 206].

* **Sözdizimi Garantisi**: Metin üretmez; sadece şeması tanımlanmış `Choice`, `Score` ve `Noul` değerlerini tek geçişte paralel olarak döner (%0 şema hatası) [1, 2, 68].
* **Kalibre Olasılıklar**: RLCD sayesinde model ürettiği olasılıklarda istatistiksel olarak dürüsttür (`confidence`) [37, 69, 221].

---

## 2. TEMEL SİSTEM MİMARİSİ VE KARAR AKIŞ ŞEMASI

```
                               ┌────────────────────────────────────────────────────────┐
                               │   Ajan İsteği (Claude Code, OpenCode, VS Code, Cursor)   │
                               └───────────────────────────┬────────────────────────────┘
                                                           │
                                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ MODÜL 1: JEV / OPENJEV MULTI-PRIMITIVE FAN-OUT EVALUATOR (~150 ms / ~70 ms GPU)                                        │
│ - Paralel Sorgulama: Choice (255 Seçenek), Score (1-10 Skalası), Noul (Olasılık) tek istekte [1, 25, 208, 278].           │
│ - "BELKİ" (Belirsizlik) Gatekeeper:                                                                                   │
│   • Güven Skoru > %85 ──► Doğrudan Kod / Araç Çalıştır ($0 LLM / $0 Çıktı Maliyeti) [27, 277].                          │
│   • Güven Skoru %60-%85 ──► Speculative Escalation (Sorguyu 3 alt karara bölüp tekrar değerlendir) [215].              │
│   • Güven Skoru < %60 ("BELKİ") ──► System 2 Cascade (LLM Çağrısı veya İnsan Onayı) [215, 277].                         │
└──────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────┘
                                                           │
         ┌─────────────────────────────────────────────────┼─────────────────────────────────────────────────┐
         ▼                                                 ▼                                                 ▼
┌──────────────────────────────────┐    ┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│ MODÜL 2: ULTRA-PLANNING & SPEC   │    │ MODÜL 3: ADVERSARIAL RED-TEAMING │    │ MODÜL 4: 360° DIAGNOSTIC AUDIT   │
│ - Sonnet + Jev Loop [246]        │    │ - Tez vs Anti-Tez Stres Testi    │    │ - Kod, Güvenlik, Pazarlama,      │
│ - Opus'tan 15x Hızlı, 40x Ucuz   │    │ - Çift Açılı Fan-Out Hakemliği   │    │   Hukuk, Bütçe Röntgeni         │
└────────────────┬─────────────────┘    └────────────────┬─────────────────┘    └────────────────┬─────────────────┘
                 │                                       │                                       │
                 └───────────────────────────────────────┼───────────────────────────────────────┘
                                                         │
                                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ MODÜL 5: ULTRA-DEEP RESEARCHER & CONTEXT COMPACTOR                                                                     │
│ - 4 Paralel Kanal: Web, Akademik (ArXiv/Kitap), GitHub/npm, X/Twitter [43, 211].                                       │
│ - Winnow Kayıpsız Bağlam Sıkıştırması: Logları özetlemez, alakasız satırları $0 maliyetle siler [79, 85, 280].        │
└────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────┘
                                                         │
                                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ MODÜL 6: GITHUB MINER & CLEAN-ROOM INSPIRATION ENGINE                                                                  │
│ - Lisans Taraması (MIT/Apache vs GPL/AGPL) [43].                                                                       │
│ - Clean-Room Mimari Çıkarım: GPL koda dokunmadan %100 orijinal, telifsiz yeni kod üretimi [48].                       │
└────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────┘
                                                         │
                                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ MODÜL 7: JEV TRAINING, LABELING & SLM DISTILLATION KIT (`jev-training-kit`)                                            │
│ - Auto-Dataset Labeler: Ham veriyi $0 maliyetle 150 ms'de etiketler [244].                                             │
│ - RLCD / DPO Tercih Verisi Üreticisi [221, 240].                                                                       │
│ - Yerel Model Distilasyonu: Jev yeteneğini Qwen2.5-0.5B / ModernBERT 421M yerel modellere aktarır [15, 34, 184].        │
└────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────┘
                                                         │
                                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ MODÜL 8: ARENA-STYLE SELF-IMPROVING MEMORY & RLVR LOOP                                                                 │
│ - Doğrulanabilir Ödül (RLVR): `tsc` derleme, `npm test` & Kullanıcı Onayı sinyalleri [4, 5].                         │
│ - Dinamik Hafıza (.jev-skill-memory.json): Başarısızlıkları kaydedip güven eşiklerini optimize eder [5, 220].         │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. DETAYLI MODÜL VE BECEERİ (FEATURE) BİLEŞENLERİ

### MODÜL 1: Jev Multi-Primitive Fan-Out Evaluator (`jev-evaluator.ts`)
* **3 Karar Primitifi [26, 68, 306]**:
  1. `Choice`: 255 seçeneğe kadar tanımlı gruptan seçim yapar (`probabilities`, `confidence`).
  2. `Score`: 2-10 adımlı sıralı ölçek üzerinde kesirli değer döndürer (`score: 1.035`).
  3. `Noul`: 0.0–1.0 arası kalibre edilmiş evet/hayır Bernoulli olasılığı üretir.
* **Speculative Batching / Fan-Out**: Tek bir istekte birden fazla soru bağımsız olarak paralel değerlendirilir. Ek soru sormak gecikmeyi veya maliyeti artırmaz [38, 209, 278].

---

### MODÜL 2: Ultra-Planning & Spec Engine (`jev-planner.ts`)
* **Sonnet + Jev Hipotezi**: Yeni bir özellik planlanırken Sonnet mimariyi çizer, Anti-Tez jeneratörü olası çökme noktalarını üretir, Jev 150 ms'de 4 boyutta puanlar [215, 246].
* **Sonuç**: Claude Opus 5'e kıyasla **15 kat daha hızlı (~2.1 sn vs 35 sn)**, **40 kat daha ucuz ($0.004 vs $0.176)** ve %0 halüsinasyonlu çelikleşmiş plan üretimi [246].

---

### MODÜL 3: Adversarial Red-Teaming Dual Loop (`jev-redteam.ts`)
* **Kırmızı Takım Sınavı**: Üretilen her çözüm için LLM bir Kırmızı Takım üyesi gibi davranarak Anti-Tezler türetir.
* **Jev Hakemliği**: Jev `Choice` ve `Score` ile Tez ve Anti-Tez'i yan yana koyarak en güvenli ve sürdürülebilir rotayı seçer [215, 246].

---

### MODÜL 4: 360° Diagnostic Audit Engine (`jev-audit.ts`)
Proje veya şirket sisteme bağlandığı an 5 boyutta anlık röntgen çeker:
1. **Teknik Mimari**: Karmaşıklık, test kapsama oranı (`supercov`), teknoloji borcu [80, 308].
2. **Güvenlik**: OWASP Top 10, Supabase RLS açıklandır, hardcoded şifreler [22, 23].
3. **Pazarlama & Growth**: SEO, mesajlaşma netliği, Show HN/Reddit kabul oranları [30, 210].
4. **Hukuk & Uyum**: Lisans ihlalleri, KVKK/GDPR uyumu [198].
5. **Bütçe & Router**: Hangi işlerin pahalı LLM'e, hangilerinin Jev/kod katmanına gideceğinin maliyet matrisi [85, 313].

---

### MODÜL 5: Ultra-Deep Researcher & Context Compactor (`jev-deep-researcher.ts` & `context-compactor.ts`)
* **4 Paralel Taram Kanalları**: Web, Akademik Makale/Kitap (ArXiv, PubMed), GitHub/npm/PyPI Kod Kütüphaneleri ve X/Twitter Gönderileri [43, 211].
* **Winnow Kayıpsız Bağlam Sıkıştırması**: Terminal veya arama loglarını özetlemez! Jev `Noul` ile alakasız satırları $0 maliyetle siler; dosya yolları, komutlar ve kodlar %100 kayıpsız korunur [79, 85, 280].

---

### MODÜL 6: GitHub Mining & Clean-Room Inspiration Engine (`github-miner.ts`)
* **Lisans Denetimi**:
  * *MIT / Apache-2.0 / BSD* \\(\rightarrow\\) Kod doğrudan kopyalanabilir ve projeye entegre edilir.
  * *GPL / AGPL / Telifli* \\(\rightarrow\\) **Clean-Room Inspiration Engine** devreye girer [48].
* **Clean-Room Çıkarım**: GPL koda dokunulmaz. Sadece mimari tasarım kalıpları ve akış şemaları soyutlanır. LLM bu şemadan **%100 orijinal, sıfırdan ve telifsiz** kod yazar [48].

---

### MODÜL 7: Jev Training, Labeling & SLM Distillation Kit (`jev-training-kit.ts`)
1. **Auto-Dataset Labeler**: Ham verileri Jev primitifleriyle 150 ms'de etiketler [244].
2. **RLCD / DPO Preference Generator**: Yerel modeller için tercih veri çiftleri üretir [221, 240].
3. **Yerel Model Distilasyonu**: Jev yeteneğini `vinnylarouge/jevlike`, `Laya` (ModernBERT-421M) veya `Qwen2.5-0.5B` yerel modellerine aktararak **5 ms hızlı, %100 çevrimdışı (offline)** çalışan karar başlıkları eğitir [15, 34, 184].

---

### MODÜL 8: Self-Improving Memory & RLVR Loop (`self-improver.ts`)
* **Doğrulanabilir Ödül (RLVR)**: `tsc` derleme ve `npm test` geçerse **+1 Ödül**, çökerse **-1 Yenilgi** [4, 5].
* **Dinamik Hafıza (`.jev-skill-memory.json`)**: Başarısızlıklar kaydedilir. Jev bir sonraki sorgularda bu geçmiş hataları `state` içinde görerek aynı hatayı tekrarlamaz [220].

---

### MODÜL 9: Chief of Staff Dispatcher & AutoMode Guardrail (`jev-dispatcher.ts`)
* **Chief of Staff**: Jev ortak hafızayı okur ve bir sonraki ajanı (researcher, writer, reviewer) seçer [274, 276].
* **AutoMode Guardrail**: `bash` veya dosya silme gibi tehlikeli araç çağrılarını Jev `Noul` / `Score` ile çalıştırmadan önce kilitler [278, 279, 334].

---

### MODÜL 10: 20 Kurumsal Dev Özellik Kataloğu

1. **Agent-to-Agent Autonomous Bargaining**: Ajanlar arası pazarlığı sohbet token'ı harcamadan 100 ms'de bitirir [218].
2. **Backpressure Router**: Anlık trafik sıçramalarında sistemi çökmeden korur ve yükü dengeler [36, 79].
3. **Generative UI-Render**: Arayüz ve diyagramları token üretmeden `json-render` ile 100 ms'de çizer [76, 86].
4. **Nightly Tech-Debt Cleaner**: Gece arka planda ölü kodları temizler ve PR açar [85, 305].
5. **Adaptive Persona & Tone Calibrator**: Kullanıcının psikolojisine göre iletişim tonunu ayarlar [171, 174].
6. **Competitor Counter-Strike**: Rakiplerin GitHub/ürün hamlelerini izleyip karşı aksiyon üretir [30, 210].
7. **Privacy Sanitizer**: Hassas verileri (PII, şifreler) dış modellere sızmadan yerel olarak maskeler.
8. **Multi-Persona Swarm Arbitrator**: Güvenlik, Growth ve CFO şapkalarıyla konsensüs sağlar [3, 204].
9. **Self-Healing Incident Engine**: Canlı sistemdeki hataları saniyesinde tespit edip kurtarma rotası başlatır [17, 278].
10. **Dynamic Threshold Auto-Tuner**: Karar başarılarına göre onay eşiklerini otomatize eder [221, 277].
11. **Synthetic QA & Edge-Case Synthesizer**: Uç durum test senaryoları üretir [284].
12. **RAG Noise-Filter & Re-Ranker**: Vektör arama gürültüsünü 100 ms'de süzüp 3 net parçayı seçer [23, 43].
13. **Nightly Trend Hunter**: Hacker News, Reddit ve GitHub Trending'i 7/24 tarar [30, 217].
14. **Active Red-Team Pen-Tester & WAF**: SQLi, Injection ve Supabase RLS açıklarını taranır [22, 23].
15. **Unit-Economics & Pricing Optimizer**: SaaS fiyatlandırma ve bütçe kullanımını optimize eder [215, 313].
16. **Git PR Gatekeeper & Release Manager**: PR'larda breaking change ve lisans kontrolü yapar [80, 308].
17. **Localization Engine**: Yerelleştirmede kültürel ve hukuki gafları engeller.
18. **Customer Churn & Sentiment Sentinel**: Müşteri kayıp riskini 150 ms'de ölçer [171, 233].
19. **Dependency Upgrade Sandbox Simulator**: Bağımlılık kırma risklerini simüle eder.
20. **Pitch-Deck & Valuation Engine**: Finansal verileri ve yatırımcı Anti-Tezlerini puanlar.

---

## 4. DEVASA SEKTÖREL VERİ KİTİ (MULTI-DOMAIN PRESETS)

Kitin içinde yer alan ve 7/24 otonom araştırma ajanıyla güncellenen hazır sektör kütüphaneleri:

* `preset-software-architecture.json`: SOLID, OWASP Top 10, Clean Code, `supercov` [80, 315].
* `preset-marketing-growth.json`: SaaS lansman teknikleri, Show HN/Reddit kuralları, CAC/LTV [30, 210].
* `preset-product-ux.json`: `json-render` standartları, onboarding adımları [76, 82].
* `preset-cost-model-router.json`: Model zorluk matrisleri ve bütçe haritaları [36, 313].
* `preset-cybersecurity.json`: CVSS zafiyet skorlama ve sızma testi matrisleri [22].
* `preset-legal-compliance.json`: KVKK, GDPR ve lisans uyumluluk matrisleri [198].
* `preset-finance-valuation.json`: Finansal marjlar ve değerleme Anti-Tezleri.

---

## 5. %100 ÜCRETSİZ, YEREL VE AÇIK KAYNAKLI SİSTEMLERE KURULUM REHBERİ (FREE & LOCAL SETUP GUIDE)

Bu kiti çalıştırmak için **ücretli bir API'ye veya Claude Code/Cursor aboneliğine zorunlu değilsiniz**. Tamamen ücretsiz ve yerel (local) ortamlara kurulum adımları:

---

### A. Ücretsiz & Yerel Ajan Platformlarına Kurulum (OpenCode, VS Code + Continue.dev)

#### 1. OpenCode veya VS Code (Continue.dev Extension) Entegrasyonu
`open-code` veya `Continue.dev` eklentisinde `mcp-config.json` dosyanıza şu sunucuyu ekleyin:

```json
{
  "mcpServers": {
    "jev-super-agent": {
      "command": "node",
      "args": ["/path/to/jev-super-agent-mcp/dist/index.js"],
      "env": {
        "JEV_BACKEND_PROVIDER": "openjev_local",
        "OPENJEV_BASE_URL": "http://localhost:8000/v1",
        "VERCEL_AI_GATEWAY_KEY": "optional_free_gateway_key"
      }
    }
  }
}
```

---

### B. %100 Ücretsiz Yerel Jev Model Alternatifleri (Local OpenJev Engines)

Bilgisayarınızda (Mac Apple Silicon, NVIDIA GPU veya CPU) sıfır ücretle çalıştırabileceğiniz **Açık Kaynak Jev Model Seçenekleri**:

#### 1. `razorback16/openjev` (vLLM + DiffusionGemma - En Hızlı Yerel Alternatif)
* **Özellik**: DiffusionGemma modelini vLLM uzerinde tek bir denoising adımıyla çalıştırarak Jev API'sini birebir taklit eder [290, 291].
* **Docker ile Tek Komutla Çalıştırma**:
  ```bash
  docker run --gpus all -p 8000:8000 razorback16/openjev
  ```
* **Hız**: RTX PRO 6000 / RTX 3090 üzerinde **~73 ms GPU latency** [291, 292].

#### 2. `NandhaKishorM/laya` (ModernBERT 421M RLCD Local Model)
* **Özellik**: ModernBERT-large üzerine eklenmiş RLCD ile eğitilmiş 421M parametreli yerel karar modeli [184, 202].
* **Hız**: Apple M3 Max Neural Engine / CoreML üzerinde **~5 ms yanıt süresi** [35, 184].
* **Çalıştırma**:
  ```bash
  git clone https://github.com/NandhaKishorM/laya
  cd laya && python -m laya.serve --port 8000
  ```

#### 3. `TheoLeeCJ/openjev` / `SemIf` (Logit Readout & WebGPU Browser-Native)
* **Özellik**: Qwen3.5-4B modelinin sonraki token lojitlerini metin üretmeden okur. Tarayıcı içinde WebGPU ile %100 ücretsiz çalışır [30, 61, 72, 305].
* **Erişim**: `https://openjev.com` veya yerel Python wrapper.

#### 4. `vinnylarouge/jevlike` (PyTorch Option-Attention Head)
* **Özellik**: Dondurulmuş bir Qwen2.5-0.5B veya bayt kodlayıcı üzerine eklenen hafif seçenek dikkat başlığı [15, 34, 304].
* **Hız**: Otoregresif modellere göre **100x hız artışı** [32, 265, 305].

#### 5. `trycua/CUA-S1` (706k params / 2.8 MB Ultra-Light Form & UI Model)
* **Özellik**: Bilgisayar ve ekran kullanımı (computer use) için eğitilmiş 2.8 MB boyutunda devrimsel mikro model [35, 284].

---

### C. Sıfır Maliyetli Ücretsiz Bulut Sağlayıcıları (Zero-Cost Cloud Options)

Eğer yerel GPU'nuz yoksa, şu **ücretsiz bulut katmanlarını** kullanabilirsiniz:

1. **Vercel AI Gateway (Free Tier)**:
   * Vercel AI Gateway hesabınızdan ücretsiz API Key alın.
   * `typesafe/jev` modeline Vercel üzerinden ücretsiz/düşük maliyetle erişin [165, 182].
2. **Cloudflare Workers AI (Free Tier)**:
   * Günde 10.000 ücretsiz nöral istek hakkı ile `auto-research-worker.ts` modülünü kesintisiz çalıştırın.
3. **HuggingFace Spaces (Free CPU/GPU Tier)**:
   * `multimodalart/jev-reproductions-tracker` üzerindeki hazır OpenJev Space'lerini ücretsiz API olarak kullanın [23, 198].

---

## 6. ÖZET VE BEKLENEN MÜHENDİSLİK ETKİSİ

This unified master blueprint guarantees:
* **%90 Token ve Maliyet Tasarrufu**: Ajan içi mikro kararlar otoregresif üretimsiz $0.042/1M token Jev veya $0 yerel OpenJev ile çözülür [25, 38, 206].
* **Milisaniyelik Yanıt Hızı**: Ajan kararları 3-30 saniye yerine **70-150 ms** içinde alınır [2, 208, 219].
* **%100 Özgür Entegrasyon**: Claude Code'dan VS Code Continue.dev'e, OpenCode'dan tamamen yerel Ollama/vLLM/OpenJev kurulumlarına kadar her yerde ücretsiz çalışır [290, 291].
* **Telif / Lisans Koruması**: "Clean-Room" motoru sayesinde GPL/kısıtlı repolardan telifsiz ilham alınır [48].
* **Kendi Kendini Geliştiren Akıl**: RLVR test/derleme geri bildirimleriyle ve `jev-training-kit` ile sistem gün geçtikçe daha da zeki hale gelir [4, 5, 221].

---
*Rapor Sonu - Gemini Notebook Master Architecture Blueprint v5 (Single Definitive Edition)*
