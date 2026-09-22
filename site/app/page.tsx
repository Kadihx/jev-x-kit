import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import WindowCard from "@/components/WindowCard";
import TerminalCard from "@/components/TerminalCard";
import ClockWidget from "@/components/ClockWidget";
import CoefficientBar from "@/components/CoefficientBar";
import CornerFrame from "@/components/CornerFrame";

const primitives = [
  {
    tag: "CHOICE",
    title: "Up to 255 options",
    body: "Picks from a defined option set. Returns probabilities + a calibrated confidence, never prose.",
  },
  {
    tag: "SCORE",
    title: "Fractional 1–10",
    body: "A sortable, comparable scalar (e.g. score: 7.235) instead of a paragraph of hedging.",
  },
  {
    tag: "NOUL",
    title: "Calibrated 0.0–1.0",
    body: "A Bernoulli probability for yes/no gates — RLCD-trained to actually mean what it says.",
  },
];

const problems = [
  ["Latency wall", "3–30s for a single yes/no routing decision, every time, on the critical path."],
  ["Cost explosion", "Agent loops burn $10–$50/session on micro-decisions routed to frontier models."],
  ["Schema breakage", "Free-text models hallucinate parameters and quietly break JSON parsers."],
  ["Context rot", "“Summarized” logs hallucinate file paths, commands and error codes."],
  ["Single-pass blind spot", "A model can't adversarially review its own plan for race conditions."],
  ["Vendor lock-in", "Paid-API-only tools leave offline and budget-constrained developers out."],
];

const features = [
  {
    title: "Non-Autoregressive",
    body: "Choice / Score / Noul — schema-validated, zero output tokens, zero parse errors.",
  },
  {
    title: "Winnow, Not Summarize",
    body: "Irrelevant log lines are deleted, never paraphrased. Paths, commands and error codes survive byte-identical.",
  },
  {
    title: "Self-Improving",
    body: "RLVR records tsc / test outcomes into .jev-skill-memory.json and auto-tunes the gatekeeper.",
  },
];

const backendChain = [
  { label: "OpenJev / vLLM", multiplier: 100, value: "$0 · Docker, local GPU" },
  { label: "LayA (ModernBERT)", multiplier: 100, value: "$0 · ~5ms on Apple Silicon" },
  { label: "Ollama (System-2)", multiplier: 100, value: "$0 · planner / red-team text" },
  { label: "Vercel AI Gateway", multiplier: 40, value: "free tier" },
  { label: "TypeSafe Jev (native)", multiplier: 1, value: "$0.042 / 1M in · $0 out", highlight: true },
];

const cliCommands = [
  ["info", "node dist/cli.js info", "backend + chain diagnosis"],
  ["decide", 'node dist/cli.js decide "run tsc first?" --options "yes,no"', "BELKİ gatekeeper call"],
  ["plan", 'node dist/cli.js plan "Ship an offline decision layer" --preset software-architecture', "hypothesis + anti-thesis + Jev score"],
  ["redteam", 'node dist/cli.js redteam "We cache everything forever"', "adversarial dual loop"],
  ["compact", 'node dist/cli.js compact --file build.log --goal "port binding error"', "Winnow lossless compaction"],
  ["audit", "node dist/cli.js audit .", "360° architecture / security / marketing scan"],
  ["verify", "node dist/cli.js verify --cwd .", "RLVR: tsc + tests → reward"],
];

const mcpTools = [
  ["jev_evaluate", "1", "Fan-out batch of Choice/Score/Noul in one pass"],
  ["jev_decide", "1", "BELKİ gatekeeper: execute / speculative / system2"],
  ["jev_plan", "2", "Ultra-planning: hypothesis + anti-thesis + 4-dim score"],
  ["jev_redteam", "3", "Adversarial dual loop: anti-theses, severity, arbitration"],
  ["jev_audit", "4", "360° scan: architecture / security / marketing / legal / budget"],
  ["jev_research", "5", "4 parallel channels + Jev re-rank, ~19x fewer tokens"],
  ["jev_compact", "5", "Winnow lossless context compaction (delete, never summarize)"],
  ["jev_github_mine", "6", "License audit + clean-room originality guard"],
  ["jev_verify", "8", "RLVR: run tsc/tests, record reward, auto-tune thresholds"],
  ["jev_guardrail", "9", "AutoMode pre-execution gate (allow / ask / block)"],
  ["hub_query", "hub", "FTS5 + Jev-ranked, cited answers from the research hub"],
  ["jev_competitor_scan", "new", "Paginated GitHub search, Noul-ranked against your own repo"],
];

const presets = [
  "software-architecture",
  "marketing-growth",
  "product-ux",
  "cost-model-router",
  "cybersecurity",
  "legal-compliance",
  "finance-valuation",
];

const benchmarkRows = [
  ["rate limiting strategies for a public REST API", "12", "2,413", "45,817", "19.0x", "3.5x"],
  ["vector database comparison for RAG pipelines", "12", "2,764", "45,817", "16.6x", "7.3x"],
  ["how to reduce React app bundle size", "10", "1,764", "38,181", "21.6x", "9.5x"],
];

export default function Home() {
  return (
    <main id="top">
      <NavBar />

      {/* HERO */}
      <section className="dot-bg relative overflow-hidden border-b border-ink/15 bg-pink-300 px-5 py-24 text-ink">
        <CornerFrame />
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-6">
          <span className="tag-pill bg-paper font-bold">v0.1.0 · MIT · 33 MCP tools</span>
          <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
            Your agent doesn&apos;t need
            <br />
            Opus to say <span className="underline decoration-wavy decoration-ink/40">yes</span>.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-ink/80 md:text-lg">
            jev-x-kit drops a non-autoregressive System-1 decision layer in front of
            every micro-decision your coding agent makes — Choice, Score and Noul
            primitives, schema-safe, $0 output tokens, 70–150ms. Runs 100% offline.
            No GPU. No API key required.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="win-shadow flex items-center border border-ink bg-ink px-4 py-2.5 font-mono text-sm text-lime-400">
              $ git clone https://github.com/Kadihx/jev-x-kit.git
            </div>
            <a
              href="https://github.com/Kadihx/jev-x-kit"
              target="_blank"
              rel="noreferrer"
              className="win-shadow border border-ink bg-paper px-4 py-2.5 text-sm font-bold hover:bg-white"
            >
              View on GitHub ↗
            </a>
          </div>
        </div>
      </section>

      {/* BIG MEASURED STAT */}
      <section className="border-b border-ink/15 bg-paper px-5 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-display text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            ~19x Fewer Tokens.
            <br />
            ~11x Fewer Tool Calls.
          </h2>
          <p className="mt-3 font-mono text-xs text-ink/50">
            *Measured on 3 real runs against live free APIs — not marketing copy.
            See{" "}
            <a href="#benchmark" className="underline">
              the full methodology
            </a>{" "}
            and reproduce every number yourself.
          </p>
        </div>
      </section>

      {/* THE COEFFICIENT */}
      <section id="coefficient" className="dot-bg relative border-b border-ink/15 bg-pink-500 px-5 py-24 text-ink">
        <CornerFrame />
        <div className="mx-auto max-w-5xl">
          <span className="tag-pill bg-paper font-bold">the coefficient</span>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight md:text-5xl">
            One float decides where every
            <br /> decision goes.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink/80 md:text-base">
            Every call into jev-x-kit resolves to a single calibrated confidence
            score — the coefficient. RLCD (Reinforcement Learning for Calibrated
            Decisions) trains it to be statistically honest, so the number you get
            back is the number you can route on.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {primitives.map((p) => (
              <WindowCard key={p.tag} title={p.tag} version="primitive">
                <div className="font-display text-lg font-bold">{p.title}</div>
                <p className="mt-2 text-xs leading-relaxed text-ink/70">{p.body}</p>
              </WindowCard>
            ))}
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
            <WindowCard title="BELKİ Gatekeeper" version="routing">
              <ul className="space-y-3 text-sm">
                <li className="flex items-center justify-between border-b border-ink/10 pb-2">
                  <span className="tag-pill bg-lime-400/70 font-bold">confidence &gt; 0.85</span>
                  <span className="font-mono text-xs">execute directly · $0 LLM cost</span>
                </li>
                <li className="flex items-center justify-between border-b border-ink/10 pb-2">
                  <span className="tag-pill font-bold">0.60 – 0.85</span>
                  <span className="font-mono text-xs">speculative fan-out · N sub-decisions</span>
                </li>
                <li className="flex items-center justify-between pb-1">
                  <span className="tag-pill font-bold">&lt; 0.60 &nbsp;(&ldquo;BELKİ&rdquo;)</span>
                  <span className="font-mono text-xs">escalate · System 2 or human</span>
                </li>
              </ul>
            </WindowCard>
            <ClockWidget />
          </div>

          <WindowCard title="Backend chain coefficient" version="$/1M tokens" className="mt-8">
            <div>
              {backendChain.map((b) => (
                <CoefficientBar
                  key={b.label}
                  label={b.label}
                  multiplier={b.multiplier}
                  value={b.value}
                  maxMultiplier={100}
                  highlight={b.highlight}
                />
              ))}
            </div>
            <p className="mt-3 text-[11px] text-ink/50">
              Auto-resolution order: typesafe_jev → openjev_local → laya_local →
              heuristic. The offline heuristic simulator always terminates the
              chain, so nothing ever fails closed — even with no network, no GPU
              and no API key.
            </p>
          </WindowCard>
        </div>
      </section>

      {/* MANIFESTO */}
      <section className="border-b border-ink/15 bg-paper px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-display text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            We took the boring
            <br /> path on purpose.
          </h2>
          <div className="mt-10 grid gap-x-10 gap-y-6 md:grid-cols-2">
            {problems.map(([title, body]) => (
              <div key={title} className="border-l-2 border-ink/20 pl-4">
                <div className="font-display text-sm font-bold">{title}</div>
                <p className="mt-1 text-xs leading-relaxed text-ink/60">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 grid gap-8 border-t border-ink/15 pt-10 md:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="border-l border-ink/20 pl-4">
                <div className="text-xs font-bold uppercase tracking-wide text-ink/50">
                  {f.title}
                </div>
                <p className="mt-2 text-sm leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SEE IT RUN */}
      <section className="dot-bg relative border-b border-ink/15 bg-ink px-5 py-24 text-paper">
        <CornerFrame dark />
        <div className="mx-auto max-w-5xl">
          <span className="tag-pill border-paper/30 bg-transparent text-paper">see it run</span>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight md:text-4xl">
            Real output. Same machine, zero network.
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <TerminalCard label="bash — jev info">
{`$ node dist/cli.js info
{
  "backend": {
    "id": "typesafe_jev",
    "label": "TypeSafe Jev API (POST /v1/systemone)",
    "pricePerMillionUsd": 0.042,
    "outputTokenCostUsd": 0,
    "local": false
  },
  "chain": [
    "typesafe_jev @ https://api.typesafe.ai/v1",
    "openjev_local @ http://localhost:8000/v1",
    "laya_local @ http://localhost:8000/v1",
    "selected: typesafe_jev"
  ],
  "tools": 33
}`}
            </TerminalCard>
            <TerminalCard label="bash — jev decide">
{`$ node dist/cli.js decide \\
    "run tsc before pushing?" --options "yes,no"
{
  "decision": {
    "question": "run tsc before pushing?",
    "route": "system2",
    "confidence": 0.22,
    "belki": true,
    "reason": "confidence 0.22 < 0.6
      (\\"BELKİ\\") -> System 2 cascade"
  },
  "selected": "yes",
  "probabilities": [0.61, 0.39]
}`}
            </TerminalCard>
          </div>
          <p className="mt-6 text-xs text-paper/40">
            Screenshots of the MCP tool calls inside Claude Code go here —
            dropped in straight from real sessions, not mockups.
          </p>
        </div>
      </section>

      {/* INSTALL */}
      <section id="install" className="border-b border-ink/15 bg-paper px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <span className="tag-pill font-bold">setup</span>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight">
            Install as a Claude Code plugin
          </h2>
          <p className="mt-2 text-sm text-ink/60">Thirty seconds. No account, no key required.</p>

          <TerminalCard label="bash" className="mt-8">
{`git clone https://github.com/Kadihx/jev-x-kit.git
cd jev-x-kit && npm install && npm run build

npm test            # 43 unit tests, offline simulator
npm run smoke       # 69-check end-to-end MCP client test`}
          </TerminalCard>

          <p className="mt-8 text-sm leading-relaxed text-ink/70">
            <code>.claude-plugin/plugin.json</code> is already wired up — it
            registers the <code>jev</code> skill and the{" "}
            <code>jev-super-agent</code> MCP server with 33 tools. Point Claude
            Code, Cursor, OpenCode or Continue.dev at this folder as a plugin, or
            hand-wire the MCP config yourself:
          </p>

          <TerminalCard label="mcp-config.json" className="mt-6">
{`{
  "mcpServers": {
    "jev-super-agent": {
      "command": "node",
      "args": ["/path/to/jev-x-kit/dist/index.js"],
      "env": {
        "JEV_BACKEND_PROVIDER": "auto",
        "OPENJEV_BASE_URL": "http://localhost:8000/v1",
        "JEV_LLM_BASE_URL": "http://localhost:11434/v1"
      }
    }
  }
}`}
          </TerminalCard>

          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
            <span className="tag-pill bg-lime-400/50 font-bold">one-click install</span>
            <code className="rounded bg-ink px-2 py-1 text-xs text-lime-400">
              npm run install-mcp
            </code>
            <span className="text-ink/60">
              detects Claude Desktop, Cursor and Continue.dev, merges (never
              overwrites) config, backs up originals to <code>.bak</code>.
            </span>
          </div>
        </div>
      </section>

      {/* USAGE */}
      <section id="usage" className="dot-bg relative border-b border-ink/15 bg-pink-100 px-5 py-24">
        <CornerFrame />
        <div className="mx-auto max-w-5xl">
          <span className="tag-pill bg-paper font-bold">usage tips</span>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight">
            CLI cheat sheet
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink/70">
            Scriptable, zero MCP client needed — every module is also a plain
            CLI command.
          </p>

          <div className="mt-8 grid gap-3 md:grid-cols-2">
            {cliCommands.map(([name, cmd, desc]) => (
              <WindowCard key={name} title={name}>
                <code className="block overflow-x-auto text-[11px] leading-relaxed text-ink/90">
                  {cmd}
                </code>
                <p className="mt-2 text-xs text-ink/60">{desc}</p>
              </WindowCard>
            ))}
          </div>

          <h3 className="mt-16 font-display text-2xl font-bold tracking-tight">
            MCP tools — 33 total, highlights below
          </h3>
          <div className="win-shadow mt-6 overflow-x-auto border border-ink/80 bg-paper">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="bg-bar text-paper">
                <tr>
                  <th className="px-3 py-2 font-bold">Tool</th>
                  <th className="px-3 py-2 font-bold">Module</th>
                  <th className="px-3 py-2 font-bold">What it does</th>
                </tr>
              </thead>
              <tbody>
                {mcpTools.map(([tool, mod, desc], i) => (
                  <tr key={tool} className={i % 2 ? "bg-ink/5" : ""}>
                    <td className="px-3 py-2 font-mono font-bold">{tool}</td>
                    <td className="px-3 py-2 font-mono text-ink/50">{mod}</td>
                    <td className="px-3 py-2">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mt-16 font-display text-2xl font-bold tracking-tight">
            7 multi-domain presets
          </h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {presets.map((p) => (
              <span key={p} className="tag-pill bg-paper font-mono">
                {p}
              </span>
            ))}
          </div>
          <p className="mt-3 max-w-2xl text-xs text-ink/60">
            Every preset injects rules, red-flags, checklists and a scoring
            rubric straight into Jev <code>state</code>, verbatim — no prompt
            engineering required.
          </p>
        </div>
      </section>

      {/* BENCHMARK */}
      <section id="benchmark" className="border-b border-ink/15 bg-paper px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <span className="tag-pill font-bold">benchmark</span>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight">
            jev_research vs. vanilla Claude Code
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink/70">
            One <code>jev_research</code> call fans four channels out{" "}
            <em>outside</em> Claude&apos;s context, ranks them with a $0 local
            Noul primitive, and returns only the ranked shortlist plus a
            synthesized brief.
          </p>

          <div className="win-shadow mt-8 overflow-x-auto border border-ink/80 bg-paper">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-bar text-paper">
                <tr>
                  <th className="px-3 py-2 font-bold">Query</th>
                  <th className="px-3 py-2 font-bold">Candidates</th>
                  <th className="px-3 py-2 font-bold">Tokens (jev)</th>
                  <th className="px-3 py-2 font-bold">Naive tokens</th>
                  <th className="px-3 py-2 font-bold">Reduction</th>
                  <th className="px-3 py-2 font-bold">Speed-up</th>
                </tr>
              </thead>
              <tbody>
                {benchmarkRows.map((row, i) => (
                  <tr key={row[0]} className={i % 2 ? "bg-ink/5" : ""}>
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-2 font-mono">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-ink/50">
            Every number is either measured on real live free APIs, or derived
            from this repo&apos;s own crawled corpus — nowhere is a number
            invented. Wall-clock speed-up assumes 3s/manual turn (conservative,
            change it and re-run if you disagree). Reproduce any row yourself
            with <code>node scripts/benchmark-vs-vanilla.mjs &quot;your query&quot;</code>.
            Full methodology in{" "}
            <a
              className="underline"
              href="https://github.com/Kadihx/jev-x-kit/blob/main/BENCHMARK.md"
              target="_blank"
              rel="noreferrer"
            >
              BENCHMARK.md
            </a>
            .
          </p>
        </div>
      </section>

      {/* BACKEND BENCHMARK */}
      <section id="backend-benchmark" className="border-b border-ink/15 bg-paper px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <span className="tag-pill font-bold">benchmark</span>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight">
            batch() vs. one-at-a-time: 4.24x
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink/70">
            Same 10-question battery, same real <code>typesafe_jev</code>{" "}
            backend, two ways of calling it: naive sequential calls (what a
            raw API integration looks like without the kit) vs. jev-x-kit&apos;s
            own <code>backend.batch()</code> (same-state questions merge into
            one HTTP call, different-state questions run concurrently).
          </p>

          <div className="win-shadow mt-8 overflow-x-auto border border-ink/80 bg-paper">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-bar text-paper">
                <tr>
                  <th className="px-3 py-2 font-bold">Backend</th>
                  <th className="px-3 py-2 font-bold">Sequential (10 calls)</th>
                  <th className="px-3 py-2 font-bold">batch() (1 call)</th>
                  <th className="px-3 py-2 font-bold">Speedup</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["heuristic (offline, $0)", "2.69ms", "0.36ms", "7.47x"],
                  ["typesafe_jev (real API)", "3,479ms", "821ms", "4.24x"],
                ].map((row, i) => (
                  <tr key={row[0]} className={i % 2 ? "bg-ink/5" : ""}>
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-2 font-mono">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-6 text-sm leading-relaxed text-ink/70">
            Also verified real vs. imaginary this session: <strong>LayA</strong>{" "}
            turns out to really exist — an open-source, self-hosted
            ModernBERT + RLCD decision model (
            <a className="underline" href="https://github.com/NandhaKishorM/laya" target="_blank" rel="noreferrer">
              github.com/NandhaKishorM/laya
            </a>
            ) — but it publishes no hosted endpoint, so it&apos;s not in the
            table above until it&apos;s actually running locally. No number is
            invented for a backend that wasn&apos;t reachable.
          </p>

          <p className="mt-4 text-[11px] leading-relaxed text-ink/50">
            Every number here is a real local measurement against the live
            TypeSafe Jev API, not a projection. Reproduce it yourself with{" "}
            <code>node scripts/backend-benchmark.mjs</code> (needs
            <code> TYPESAFE_JEV_API_KEY</code> in <code>.env</code> for the
            typesafe_jev row). Full methodology in{" "}
            <a
              className="underline"
              href="https://github.com/Kadihx/jev-x-kit/blob/main/artifacts/backend-benchmark-report.md"
              target="_blank"
              rel="noreferrer"
            >
              artifacts/backend-benchmark-report.md
            </a>
            .
          </p>
        </div>
      </section>

      {/* RESEARCH HUB */}
      <section className="dot-bg relative border-b border-ink/15 bg-pink-500 px-5 py-20 text-ink">
        <CornerFrame />
        <div className="mx-auto max-w-5xl">
          <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            Bonus: a research hub for rational thinking
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink/80">
            A nightly-crawled personal-development and rationality corpus — 11
            sources across mental-models, library and academic tiers, stored in
            SQLite + FTS5, ranked by Jev and cited VERIFIED / PROBABLE /
            REJECTED. Farnam Street, LessWrong, Derek Sivers, Julian Shapiro,
            Internet Archive, Gutenberg, Wikibooks, PhilArchive, PsyArXiv, CORE.
          </p>
          <TerminalCard label="bash — hub" className="mt-6">
{`npm run hub -- crawl                          # nightly, 02:00–06:00 Berlin
npm run hub -- query "second-order thinking"  # FTS5 + Jev-ranked, cited`}
          </TerminalCard>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-paper px-5 py-24 text-center">
        <h2 className="mx-auto max-w-2xl font-display text-4xl font-bold tracking-tight md:text-5xl">
          Give your agent a $0 System 1.
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="https://github.com/Kadihx/jev-x-kit"
            target="_blank"
            rel="noreferrer"
            className="win-shadow border border-ink bg-ink px-6 py-3 text-sm font-bold text-paper hover:bg-ink/80"
          >
            Star it on GitHub ↗
          </a>
          <div className="win-shadow border border-ink bg-paper px-6 py-3 font-mono text-sm">
            git clone github.com/Kadihx/jev-x-kit
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
