/**
 * MCP tool registry: 21 tools mapping 1:1 onto the framework modules.
 * Every handler returns plain JSON; failures are reported as structured
 * errors instead of crashing the stdio transport.
 */

import { loadConfig, type JevConfig } from "../core/config.js";
import { System2Client } from "../core/llm.js";
import { log } from "../core/log.js";
import { PRESET_FILES, listPresets } from "../core/presets.js";
import { loadMemory, memorySummary } from "../core/memory.js";
import { resolveBackend, type ResolvedBackend } from "../core/providers/index.js";
import { artifactsDir } from "../core/paths.js";
import { JevEvaluator } from "../modules/jev-evaluator.js";
import { JevPlanner } from "../modules/jev-planner.js";
import { JevRedTeam } from "../modules/jev-redteam.js";
import { JevAudit } from "../modules/jev-audit.js";
import { DeepResearcher } from "../modules/jev-deep-researcher.js";
import { ContextCompactor } from "../modules/context-compactor.js";
import { GithubMiner } from "../modules/github-miner.js";
import { JevTrainingKit } from "../modules/jev-training-kit.js";
import { SelfImprover } from "../modules/self-improver.js";
import { ChiefOfStaff, ROLE_CATALOG } from "../modules/jev-dispatcher.js";
import { CompetitorScanner } from "../modules/jev-competitor-scan.js";
import { CalibrationChecker } from "../modules/jev-calibration.js";
import { SkillRouter } from "../modules/jev-skill-router.js";
import { RljfReward } from "../modules/rljf-reward.js";
import { ScopeJudge } from "../modules/scope-judge.js";
import { MarketingCopilot, type MarketingTriageInput } from "../modules/marketing-copilot.js";
import { CompetitorIntelligence } from "../modules/competitor-intelligence.js";
import type { CalibrationCase, TranscriptMessage } from "../core/module-types.js";
import {
  edgeCases,
  featureCatalog,
  prGate,
  rerank,
  sanitize,
} from "../modules/enterprise-features.js";
import { SOURCES, getSource, type SourceCategory } from "../datacenter/source-configs.js";
import { crawlDatacenter, ingestRendered } from "../datacenter/crawler.js";
import { HubStore } from "../datacenter/store.js";
import { queryHub } from "../datacenter/query.js";
import type { JevRequest } from "../core/types.js";

export interface AppContext {
  config: JevConfig;
  resolved: ResolvedBackend;
  llm: System2Client;
  evaluator: JevEvaluator;
  planner: JevPlanner;
  redTeam: JevRedTeam;
  audit: JevAudit;
  researcher: DeepResearcher;
  compactor: ContextCompactor;
  miner: GithubMiner;
  training: JevTrainingKit;
  improver: SelfImprover;
  dispatcher: ChiefOfStaff;
  competitorScanner: CompetitorScanner;
  calibrationChecker: CalibrationChecker;
  skillRouter: SkillRouter;
  rljfReward: RljfReward;
  scopeJudge: ScopeJudge;
  marketingCopilot: MarketingCopilot;
  competitorIntelligence: CompetitorIntelligence;
}

export async function createContext(config: JevConfig = loadConfig()): Promise<AppContext> {
  const resolved = await resolveBackend(config);
  const llm = new System2Client(config.llm);
  const backend = resolved.backend;
  log.info(`backend: ${backend.meta.id} (${resolved.chain.join(" -> ")})`);

  return {
    config,
    resolved,
    llm,
    evaluator: new JevEvaluator({ backend, policy: config.policy, memoryPath: config.memoryPath, concurrency: config.concurrency }),
    planner: new JevPlanner({ backend, llm, concurrency: config.concurrency }),
    redTeam: new JevRedTeam({ backend, llm, concurrency: config.concurrency }),
    audit: new JevAudit({ backend, concurrency: config.concurrency }),
    researcher: new DeepResearcher({
      backend,
      llm,
      githubToken: config.githubToken,
      braveKey: config.searchKeys.brave,
      twitterBearer: config.searchKeys.twitter,
      concurrency: config.concurrency,
    }),
    compactor: new ContextCompactor({ backend, concurrency: config.concurrency }),
    miner: new GithubMiner({ backend, llm, githubToken: config.githubToken }),
    training: new JevTrainingKit({ backend, concurrency: config.concurrency }),
    improver: new SelfImprover({ memoryPath: config.memoryPath }),
    dispatcher: new ChiefOfStaff({ backend, memoryPath: config.memoryPath, concurrency: config.concurrency }),
    competitorScanner: new CompetitorScanner({ backend, llm, githubToken: config.githubToken }),
    calibrationChecker: new CalibrationChecker({ backend, policy: config.policy }),
    skillRouter: new SkillRouter({ backend }),
    rljfReward: new RljfReward({ backend }),
    scopeJudge: new ScopeJudge({ backend }),
    marketingCopilot: new MarketingCopilot({ backend }),
    competitorIntelligence: new CompetitorIntelligence({ backend, llm }),
  };
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/* ----------------------------- arg helpers ------------------------------- */

export const str = (args: Record<string, unknown>, key: string, fallback?: string): string => {
  const value = args[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing required string argument: ${key}`);
};

export const optStr = (args: Record<string, unknown>, key: string): string | undefined =>
  typeof args[key] === "string" && (args[key] as string).length > 0 ? (args[key] as string) : undefined;

export const numArg = (args: Record<string, unknown>, key: string, fallback: number): number => {
  const value = Number(args[key]);
  return Number.isFinite(value) ? value : fallback;
};

export const strArray = (args: Record<string, unknown>, key: string): string[] => {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
};

export const boolArg = (args: Record<string, unknown>, key: string, fallback = false): boolean =>
  typeof args[key] === "boolean" ? (args[key] as boolean) : fallback;

export const schema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const stringProp = (description: string) => ({ type: "string", description });
export const numberProp = (description: string) => ({ type: "number", description });
export const booleanProp = (description: string) => ({ type: "boolean", description });
export const arrayProp = (description: string, items: Record<string, unknown>) => ({
  type: "array",
  description,
  items,
});

/* ------------------------------ tool builder ------------------------------ */

export function buildTools(ctx: AppContext): ToolSpec[] {
  const tools: ToolSpec[] = [];

  tools.push({
    name: "jev_evaluate",
    title: "Jev multi-primitive fan-out evaluation",
    description:
      "Evaluate a batch of decisions in ONE parallel pass: choice (<=255 options), score (fractional scale) and noul (calibrated probability). Extra questions do not increase latency or cost.",
    inputSchema: schema(
      {
        requests: arrayProp("Primitive requests to evaluate in one fan-out.", {
          type: "object",
          properties: {
            id: stringProp("Optional caller-provided id."),
            kind: { type: "string", enum: ["choice", "score", "noul"] },
            question: stringProp("The decision question."),
            options: arrayProp("Options for kind=choice (max 255).", { type: "string" }),
            min: numberProp("Lower bound for kind=score (default 1)."),
            max: numberProp("Upper bound for kind=score (default 10)."),
            state: stringProp("Verbatim context appended to the evaluation."),
          },
          required: ["kind", "question"],
        }),
      },
      ["requests"],
    ),
    handler: async (args) => {
      const requests = (args["requests"] as JevRequest[]) ?? [];
      const batch = await ctx.evaluator.evaluate(requests);
      return {
        results: batch.results,
        stats: batch.stats,
        costUsd: batch.costUsd,
        degraded: batch.degraded,
        backend: ctx.resolved.backend.meta.id,
      };
    },
  });

  tools.push({
    name: "jev_decide",
    title: "Gatekeeper decision (execute / speculative / system2)",
    description:
      "Route one decision through the 'BELKİ' gatekeeper: confidence above the tuned threshold executes directly ($0 LLM), mid range triggers speculative sub-decisions, low confidence escalates to System 2.",
    inputSchema: schema(
      {
        question: stringProp("The decision question."),
        options: arrayProp("Candidate options.", { type: "string" }),
        state: stringProp("Verbatim context (memory/regression notes) for the evaluation."),
        persist: booleanProp("Persist the decision into .jev-skill-memory.json (default true)."),
      },
      ["question", "options"],
    ),
    handler: async (args) => {
      const outcome = await ctx.evaluator.decide(str(args, "question"), strArray(args, "options"), {
        state: optStr(args, "state") ?? ctx.improver.stateBlock(),
        persist: boolArg(args, "persist", true),
      });
      return {
        decision: outcome.decision,
        selected: outcome.primary.selected,
        probabilities: outcome.primary.probabilities,
        subChoices: outcome.subChoices.map((c) => ({
          question: c.question,
          selected: c.selected,
          confidence: c.confidence,
        })),
        memoryRecorded: outcome.memoryRecorded,
        backend: outcome.primary.backend,
        latencyMs: outcome.primary.latencyMs,
      };
    },
  });

  tools.push({
    name: "jev_plan",
    title: "Ultra-planning & spec engine",
    description:
      "Produce a steeled plan: System-2 hypothesis + hostile anti-thesis, scored by the Jev loop on feasibility, failure risk, cost and maintainability. Works offline with deterministic fallbacks.",
    inputSchema: schema(
      {
        goal: stringProp("What should be built or decided."),
        preset: stringProp(`Optional domain preset (${PRESET_FILES.map((p) => p.id).join(", ")}).`),
        context: arrayProp("Verbatim context lines (file lists, constraints, prior decisions).", { type: "string" }),
      },
      ["goal"],
    ),
    handler: async (args) =>
      ctx.planner.plan(str(args, "goal"), {
        preset: optStr(args, "preset"),
        context: strArray(args, "context"),
      }),
  });

  tools.push({
    name: "jev_redteam",
    title: "Adversarial red-teaming dual loop",
    description:
      "Generate concrete anti-theses against a thesis, score their severity/evidence with the Jev loop and arbitrate the safest route with residual risks and mitigations.",
    inputSchema: schema(
      {
        thesis: stringProp("The proposal, plan or implementation claim to attack."),
        context: arrayProp("Verbatim context lines.", { type: "string" }),
        maxAntiTheses: numberProp("How many anti-theses to generate (3-8, default 4)."),
      },
      ["thesis"],
    ),
    handler: async (args) =>
      ctx.redTeam.review(str(args, "thesis"), {
        context: strArray(args, "context"),
        maxAntiTheses: numArg(args, "maxAntiTheses", 4),
      }),
  });

  tools.push({
    name: "jev_audit",
    title: "360° diagnostic audit",
    description:
      "Scan a project directory and score five dimensions (architecture, security, marketing, legal, budget) with findings, evidence and ranked fix actions.",
    inputSchema: schema(
      {
        root: stringProp("Absolute path of the project to audit."),
        preset: stringProp("Optional preset id for the rubric context."),
      },
      ["root"],
    ),
    handler: async (args) => ctx.audit.run(str(args, "root"), { preset: optStr(args, "preset") }),
  });

  tools.push({
    name: "jev_skill_router",
    title: "Claude Skills discovery & routing",
    description:
      "Discover installed Claude Code Skills (project/user/plugin trees) plus not-yet-installed skills from local marketplace catalogs (and, if online=true, Anthropic's public catalog), then rank them for a task with the Jev Score primitive. Never installs anything itself — returns the exact `claude plugin` commands to run.",
    inputSchema: schema(
      {
        task: stringProp("The task or need to match a skill against."),
        limit: numberProp("Max ranked results per list (default 3)."),
        online: booleanProp("Also fetch the public fallback catalog over HTTPS (default false, fully offline)."),
      },
      ["task"],
    ),
    handler: async (args) =>
      ctx.skillRouter.route(str(args, "task"), {
        limit: numArg(args, "limit", 3),
        online: boolArg(args, "online", false),
      }),
  });

  tools.push({
    name: "jev_research",
    title: "Ultra-deep research (4 parallel channels)",
    description:
      "Sweep web (Wikipedia/Brave), academic (arXiv), code (GitHub/npm) and social (HN/X) channels in parallel, re-rank with Jev relevance and synthesize a cited brief. Free/keyless sources by default.",
    inputSchema: schema(
      {
        query: stringProp("Research question."),
        channels: arrayProp("Channels to use: web, academic, code, social.", {
          type: "string",
          enum: ["web", "academic", "code", "social"],
        }),
        maxHits: numberProp("Maximum ranked hits to keep (default 12)."),
      },
      ["query"],
    ),
    handler: async (args) => {
      const channels = (args["channels"] as Array<"web" | "academic" | "code" | "social"> | undefined)?.filter(
        Boolean,
      );
      return ctx.researcher.research(str(args, "query"), {
        channels: channels?.length ? channels : undefined,
        maxHits: numArg(args, "maxHits", 12),
      });
    },
  });

  tools.push({
    name: "jev_compact",
    title: "Winnow lossless context compaction",
    description:
      "Delete irrelevant log/grep/diff lines at $0 cost WITHOUT summarizing: kept lines are byte-identical. File paths, commands, error codes, URLs and diff headers are always preserved.",
    inputSchema: schema({
      text: stringProp("Raw multi-line text to compact."),
      file: stringProp("Alternative: absolute path of a file to compact."),
      goal: stringProp("What the context is for (relevance anchor)."),
      keepThreshold: numberProp("Noul keep threshold (default 0.5)."),
      maxLines: numberProp("Safety valve for huge inputs (default 1500)."),
    }),
    handler: async (args) => {
      const options = {
        goal: optStr(args, "goal"),
        keepThreshold: numArg(args, "keepThreshold", 0.5),
        maxLines: numArg(args, "maxLines", 1500),
      };
      const file = optStr(args, "file");
      if (file) return ctx.compactor.winnowFile(file, options);
      return ctx.compactor.winnow(str(args, "text"), options);
    },
  });

  tools.push({
    name: "jev_compact_transcript",
    title: "Winnow lossless compaction (tool-call/result aware)",
    description:
      "Like jev_compact but operates on a structured message transcript instead of flat text: pairs each tool call with its tool result by id, decides per-pair (keep both / keep call + truncate result / drop both) with two Noul questions, and never drops a result that matches a file-path/command/error/URL/diff anchor even if Noul says drop. First and last N messages are pinned untouched (preserveRecentMessages, default 6).",
    inputSchema: schema(
      {
        messages: arrayProp("Transcript messages.", {
          type: "object",
          properties: {
            role: stringProp("Message role (user/assistant/etc.)."),
            text: stringProp("Message text, if any."),
            toolCalls: arrayProp("Tool calls in this message.", {
              type: "object",
              properties: { tool_use_id: stringProp("Unique id."), tool: stringProp("Tool name."), input: {} },
              required: ["tool_use_id", "tool"],
            }),
            toolResults: arrayProp("Tool results in this message.", {
              type: "object",
              properties: { tool_use_id: stringProp("Matching call's id."), text: stringProp("Result text.") },
              required: ["tool_use_id", "text"],
            }),
          },
          required: ["role"],
        }),
        goal: stringProp("What the transcript is for (relevance anchor)."),
        keepThreshold: numberProp("Noul keep threshold (default 0.5)."),
        preserveRecentMessages: numberProp("Newest messages never touched (default 6)."),
        truncateHeadChars: numberProp("Characters of a truncated result kept (default 300)."),
      },
      ["messages"],
    ),
    handler: async (args) =>
      ctx.compactor.winnowTranscript((args["messages"] as TranscriptMessage[]) ?? [], {
        goal: optStr(args, "goal"),
        keepThreshold: numArg(args, "keepThreshold", 0.5),
        preserveRecentMessages: numArg(args, "preserveRecentMessages", 6),
        truncateHeadChars: numArg(args, "truncateHeadChars", 300),
      }),
  });

  tools.push({
    name: "jev_github_mine",
    title: "GitHub mining & clean-room inspiration",
    description:
      "Audit a repository license (permissive vs copyleft/unknown) and, for restricted licenses, extract an architecture-only clean-room spec with a 5-gram similarity guard proving originality.",
    inputSchema: schema(
      {
        repo: stringProp("owner/name, a GitHub URL, or a local project path."),
        similarityThreshold: numberProp("Max allowed n-gram Jaccard similarity (default 0.15)."),
      },
      ["repo"],
    ),
    handler: async (args) =>
      ctx.miner.mine(str(args, "repo"), { similarityThreshold: numArg(args, "similarityThreshold", 0.15) }),
  });

  tools.push({
    name: "jev_label_dataset",
    title: "Auto-dataset labeler ($0/row on local backends)",
    description:
      "Label raw rows with Jev primitives in one fan-out pass and write a JSONL dataset into artifacts/datasets for distillation.",
    inputSchema: schema(
      {
        rows: arrayProp("Raw data rows to label.", { type: "string" }),
        mode: { type: "string", enum: ["choice", "score", "noul"], description: "Label primitive (default choice)." },
        question: stringProp("Labeling question."),
        options: arrayProp("Options for mode=choice.", { type: "string" }),
        writeFile: booleanProp("Write the JSONL dataset (default true)."),
      },
      ["rows"],
    ),
    handler: async (args) => {
      const mode = (optStr(args, "mode") ?? "choice") as "choice" | "score" | "noul";
      const options = strArray(args, "options");
      return ctx.training.label(strArray(args, "rows"), {
        mode,
        question: optStr(args, "question"),
        options: options.length ? options : undefined,
        writeFile: boolArg(args, "writeFile", true),
      });
    },
  });

  tools.push({
    name: "jev_preference_pairs",
    title: "RLCD / DPO preference pair generator",
    description:
      "Score every candidate answer with the Jev Score primitive and emit chosen/rejected JSONL pairs for local DPO training.",
    inputSchema: schema(
      {
        items: arrayProp("Prompt + candidate answers.", {
          type: "object",
          properties: {
            prompt: stringProp("The task prompt."),
            candidates: arrayProp("Candidate answers to rank.", { type: "string" }),
          },
          required: ["prompt", "candidates"],
        }),
        writeFile: booleanProp("Write the JSONL file (default true)."),
      },
      ["items"],
    ),
    handler: async (args) =>
      ctx.training.preferencePairs((args["items"] as Array<{ prompt: string; candidates: string[] }>) ?? [], {
        writeFile: boolArg(args, "writeFile", true),
      }),
  });

  tools.push({
    name: "jev_distill_recipe",
    title: "SLM distillation recipe",
    description:
      "Emit a concrete LoRA distillation recipe (axolotl/unsloth + vLLM) for Qwen2.5-0.5B or a ModernBERT-421M decision head; optionally write the axolotl YAML into artifacts/training.",
    inputSchema: schema({
      target: { type: "string", enum: ["qwen2.5-0.5b", "modernbert-421m", "custom"], description: "Student model." },
      datasetFile: stringProp("Dataset JSONL path to reference."),
      writeYaml: booleanProp("Write artifacts/training/qwen-jev.yml (default false)."),
    }),
    handler: async (args) => {
      const target = (optStr(args, "target") ?? "qwen2.5-0.5b") as "qwen2.5-0.5b" | "modernbert-421m" | "custom";
      const datasetFile = optStr(args, "datasetFile") ?? "artifacts/datasets/labeled-choice.jsonl";
      const recipe = ctx.training.distillRecipe(target, datasetFile);
      let yamlFile: string | null = null;
      if (boolArg(args, "writeYaml", false)) {
        const { writeLinesAtomic } = await import("../core/paths.js");
        yamlFile = `${artifactsDir("training")}/qwen-jev.yml`;
        writeLinesAtomic(yamlFile, ctx.training.buildAxolotlYaml(datasetFile).split("\n"));
      }
      return { recipe, yamlFile };
    },
  });

  tools.push({
    name: "jev_verify",
    title: "RLVR verification (tsc + tests -> reward)",
    description:
      "Run verification commands (default: npx tsc --noEmit, npm test) in a working directory, record +1/-1 reward into the skill memory and auto-tune the gatekeeper thresholds.",
    inputSchema: schema({
      commands: arrayProp("Commands to run in order (default: npx tsc --noEmit, npm test).", { type: "string" }),
      cwd: stringProp("Working directory (default: this server's cwd)."),
      timeoutMs: numberProp("Per-command timeout in ms (default 180000)."),
      question: stringProp("What decision this verification validates (for memory)."),
    }),
    handler: async (args) => {
      const commands = strArray(args, "commands");
      return ctx.improver.verify(commands.length ? commands : undefined, {
        cwd: optStr(args, "cwd"),
        timeoutMs: numArg(args, "timeoutMs", 180_000),
        question: optStr(args, "question"),
      });
    },
  });

  tools.push({
    name: "jev_memory",
    title: "Self-improving memory (report / optimize / record / state)",
    description:
      "Inspect and steer the arena-style skill memory: calibration buckets, verified win rate, threshold auto-tuning and manual outcome recording.",
    inputSchema: schema({
      op: { type: "string", enum: ["report", "optimize", "record", "state"], description: "Operation to run." },
      passed: booleanProp("For op=record: did the verified outcome succeed?"),
      detail: stringProp("For op=record: human-readable detail."),
      confidence: numberProp("For op=record: the confidence the decision had."),
      question: stringProp("For op=record: the original decision question."),
    }),
    handler: async (args) => {
      switch (optStr(args, "op") ?? "report") {
        case "optimize":
          return ctx.improver.optimize();
        case "record":
          return ctx.improver.record(boolArg(args, "passed", true), {
            detail: optStr(args, "detail"),
            confidence: Number.isFinite(Number(args["confidence"])) ? Number(args["confidence"]) : undefined,
            question: optStr(args, "question"),
          });
        case "state":
          return { state: ctx.improver.stateBlock(), stats: ctx.improver.stats() };
        default:
          return ctx.improver.report();
      }
    },
  });

  tools.push({
    name: "jev_dispatch",
    title: "Chief-of-staff role dispatcher",
    description:
      "Read shared memory + task intent and pick the next agent role (researcher / planner / implementer / reviewer / writer / auditor) with a ready handoff payload.",
    inputSchema: schema(
      {
        task: stringProp("The task to route."),
        context: arrayProp("Verbatim context lines.", { type: "string" }),
      },
      ["task"],
    ),
    handler: async (args) => ctx.dispatcher.dispatch(str(args, "task"), { context: strArray(args, "context") }),
  });

  tools.push({
    name: "jev_guardrail",
    title: "AutoMode guardrail (pre-execution safety gate)",
    description:
      "Classify a tool call before execution: dangerous pattern blacklist + Jev Noul danger and Score severity produce an allow / ask / block verdict with reasons.",
    inputSchema: schema(
      {
        tool: stringProp("Tool name (bash, file_delete, git_push, ...)."),
        args: stringProp("Serialized arguments or raw command text."),
      },
      ["tool", "args"],
    ),
    handler: async (args) => ctx.dispatcher.guardrail(str(args, "tool"), str(args, "args")),
  });

  tools.push({
    name: "jev_privacy_sanitize",
    title: "Privacy sanitizer (feature #7)",
    description:
      "Mask PII and secrets (emails, cards, IBAN, Turkish ID, API keys, bearer tokens, private keys, env assignments) locally before anything is sent to an external model.",
    inputSchema: schema({ text: stringProp("Text to sanitize.") }, ["text"]),
    handler: async (args) => sanitize(str(args, "text")),
  });

  tools.push({
    name: "jev_rerank",
    title: "RAG noise filter & re-ranker (feature #12)",
    description: "Re-rank retrieved passages with Jev Noul relevance and keep the top-K, dropping the noise.",
    inputSchema: schema(
      {
        query: stringProp("The question the passages should answer."),
        documents: arrayProp("Candidate passages.", { type: "string" }),
        topK: numberProp("How many passages to keep (default 3)."),
      },
      ["query", "documents"],
    ),
    handler: async (args) =>
      rerank(ctx.resolved.backend, str(args, "query"), strArray(args, "documents"), numArg(args, "topK", 3)),
  });

  tools.push({
    name: "jev_edge_qa",
    title: "Synthetic QA edge-case matrix (feature #11)",
    description:
      "Generate a deterministic edge-case test matrix (input, concurrency, dependency, auth, state, time, billing) for a feature spec.",
    inputSchema: schema(
      {
        spec: stringProp("Feature or change description."),
        count: numberProp("Number of cases to emit (3-12, default 8)."),
      },
      ["spec"],
    ),
    handler: async (args) => ({
      spec: str(args, "spec"),
      cases: edgeCases(str(args, "spec"), numArg(args, "count", 8)),
    }),
  });

  tools.push({
    name: "jev_pr_gate",
    title: "PR gatekeeper (feature #16)",
    description:
      "Check a unified diff for breaking export removals, hardcoded secrets, console leftovers, new TODOs and dependency manifest changes; returns allow/ask/block.",
    inputSchema: schema(
      {
        files: arrayProp("Files with their unified diff patch.", {
          type: "object",
          properties: {
            file: stringProp("Path of the file."),
            patch: stringProp("Unified diff text for this file."),
          },
          required: ["file", "patch"],
        }),
      },
      ["files"],
    ),
    handler: async (args) => prGate((args["files"] as Array<{ file: string; patch: string }>) ?? []),
  });

  tools.push({
    name: "jev_features",
    title: "Enterprise feature catalog (module 10)",
    description: "List the 20 enterprise features with honest implemented/scaffolded status and their hosting tool.",
    inputSchema: schema({}),
    handler: async () => ({ features: featureCatalog(), roles: ROLE_CATALOG }),
  });

  tools.push({
    name: "hub_crawl",
    title: "Research hub crawler (personal-development knowledge base)",
    description:
      "Politely crawl the 11 curated sources (Farnam Street, LessWrong, Derek Sivers, Julian Shapiro, Internet Archive, Open Library, Project Gutenberg, Wikibooks, PhilArchive, PsyArXiv, CORE) into the local SQLite+FTS5 research hub. Respects robots.txt and each source's off-hours crawl window unless force=true.",
    inputSchema: schema({
      sources: arrayProp(`Source ids to limit the crawl to (default: all ${SOURCES.length}).`, { type: "string" }),
      maxItems: numberProp("Max items to discover per source (default 12)."),
      minWords: numberProp("Minimum word count to keep a fetched page (default 60)."),
      force: booleanProp("Bypass the off-hours crawl window (default false)."),
      dryRun: booleanProp("Preview robots.txt + discovery only, write nothing (default false)."),
      dbPath: stringProp("Alternative SQLite path (default data/research-hub.sqlite)."),
    }),
    handler: async (args) => {
      const ids = strArray(args, "sources");
      const sources = ids.length ? ids.map((id) => getSource(id)) : SOURCES;
      return crawlDatacenter(sources, {
        maxItems: numArg(args, "maxItems", 12),
        minWords: numArg(args, "minWords", 60),
        force: boolArg(args, "force", false),
        dryRun: boolArg(args, "dryRun", false),
        dbPath: optStr(args, "dbPath"),
        onlySources: ids.length ? ids : undefined,
      });
    },
  });

  tools.push({
    name: "hub_ingest_rendered",
    title: "Research hub browser-render bridge",
    description:
      "For sources whose pages are client-rendered (a plain fetch returns an empty app shell, e.g. LessWrong) and hub_crawl discovers nothing: render the page yourself (a browser tool such as claude-in-chrome, or WebFetch) and hand the resulting HTML here. Extracts, license-checks and stores it exactly like the crawler would — this is jev-x-kit's browser-use path, without carrying its own browser dependency.",
    inputSchema: schema(
      {
        source: stringProp(`Source id the page belongs to (${SOURCES.map((s) => s.id).join(", ")}).`),
        url: stringProp("Canonical URL of the rendered page."),
        html: stringProp("The rendered page's HTML (from your own browser/WebFetch tool)."),
        minWords: numberProp("Minimum word count to keep (default 60)."),
        dbPath: stringProp("Alternative SQLite path (default data/research-hub.sqlite)."),
      },
      ["source", "url", "html"],
    ),
    handler: async (args) =>
      ingestRendered(getSource(str(args, "source")), str(args, "url"), str(args, "html"), {
        minWords: numArg(args, "minWords", 60),
        dbPath: optStr(args, "dbPath"),
      }),
  });

  tools.push({
    name: "hub_query",
    title: "Research hub query (rationality / cognitive-psychology / philosophy)",
    description:
      "FTS5 search over the crawled research hub, re-ranked by Jev Noul relevance into VERIFIED/PROBABLE/REJECTED tiers, then synthesized into a cited, step-by-step answer that grounds claims in mental models and cognitive-science findings over popular advice.",
    inputSchema: schema(
      {
        query: stringProp("Study question."),
        limit: numberProp("Candidate passages pulled from FTS5 (default 25)."),
        topK: numberProp("Ranked passages kept for the answer (default 5)."),
        category: { type: "string", enum: ["mental-models", "library", "academic"], description: "Restrict to one source category." },
        dbPath: stringProp("Alternative SQLite path (default data/research-hub.sqlite)."),
      },
      ["query"],
    ),
    handler: async (args) => {
      const store = new HubStore(optStr(args, "dbPath"));
      try {
        return await queryHub(str(args, "query"), { store, backend: ctx.resolved.backend, llm: ctx.llm }, {
          limit: numArg(args, "limit", 25),
          topK: numArg(args, "topK", 5),
          category: optStr(args, "category") as SourceCategory | undefined,
        });
      } finally {
        store.close();
      }
    },
  });

  tools.push({
    name: "hub_stats",
    title: "Research hub stats",
    description: "Report document counts, word totals and last-crawl timestamps per source in the research hub.",
    inputSchema: schema({ dbPath: stringProp("Alternative SQLite path (default data/research-hub.sqlite).") }),
    handler: async (args) => {
      const store = new HubStore(optStr(args, "dbPath"));
      try {
        return store.stats();
      } finally {
        store.close();
      }
    },
  });

  tools.push({
    name: "jev_calibration_check",
    title: "Gatekeeper calibration check",
    description:
      "Feed known-answer Choice cases through the gatekeeper: buckets results by the same executeThreshold/escalateThreshold the gatekeeper uses, compares claimed confidence to real accuracy per bucket, and separately checks position bias (does the answer change when option order is reversed). Use to verify the 0.85/0.60 thresholds are actually trustworthy, not just configured.",
    inputSchema: schema(
      {
        cases: arrayProp("Known-answer test cases.", {
          type: "object",
          properties: {
            question: stringProp("The question to ask."),
            options: arrayProp("Candidate options.", { type: "string" }),
            correctIndex: numberProp("Index into options[] of the known-correct answer."),
            state: stringProp("Optional verbatim context."),
          },
          required: ["question", "options", "correctIndex"],
        }),
      },
      ["cases"],
    ),
    handler: async (args) => ctx.calibrationChecker.check((args["cases"] as CalibrationCase[]) ?? []),
  });

  tools.push({
    name: "jev_competitor_scan",
    title: "Competitor / market scan",
    description:
      "Search GitHub for repos created within a recent window that match a topic, rank each one against this project's own positioning with a Jev Noul fan-out ($0), and get a concrete 'closest rival + feature gaps + positioning move' synthesis. Use before a launch, or to spot newly-trending alternatives.",
    inputSchema: schema(
      {
        query: stringProp("Topic/keywords to search GitHub repos for (e.g. \"claude code plugin agent\")."),
        windowDays: numberProp("Only consider repos created within the last N days (default 2; 0 = no date filter, all-time)."),
        limit: numberProp("Results per page from GitHub search (default 15, max 100)."),
        pages: numberProp("How many pages to fetch and merge, oldest-rate-limited pacing applied between pages (default 1, max = 1000/limit)."),
        sortBy: { type: "string", enum: ["stars", "created", "updated"], description: "Sort order (default stars; use created for a 'newest repos first' census)." },
        ourRepo: stringProp("owner/name of our repo, for the report only (not fetched)."),
        ourDescription: stringProp("Our project's positioning blurb (default: this repo's own README tagline)."),
      },
      ["query"],
    ),
    handler: async (args) =>
      ctx.competitorScanner.scan(str(args, "query"), {
        windowDays: numArg(args, "windowDays", 2),
        limit: numArg(args, "limit", 15),
        pages: numArg(args, "pages", 1),
        sortBy: (optStr(args, "sortBy") as "stars" | "created" | "updated" | undefined) ?? "stars",
        ourRepo: optStr(args, "ourRepo"),
        ourDescription: optStr(args, "ourDescription"),
      }),
  });

  tools.push({
    name: "jev_rljf_reward",
    title: "RLJF reward calculator (TRL/GRPO-compatible)",
    description:
      "Reinforcement Learning from Jev Feedback: score every (prompt, completion) pair for helpfulness and toxicity in two flat batched fan-outs, then combine into reward = normalizedHelpfulness - toxicityProbability. Drop-in reward_funcs for a TRL GRPOTrainer loop.",
    inputSchema: schema(
      {
        prompts: arrayProp("Prompts.", { type: "string" }),
        completions: arrayProp("completions[i] = candidate generations for prompts[i].", {
          type: "array",
          items: { type: "string" },
        }),
        emitScript: booleanProp("Write a runnable TRL GRPOTrainer boilerplate script to artifacts/rljf_grpo.py (default false)."),
      },
      ["prompts", "completions"],
    ),
    handler: async (args) => {
      const completions = (args["completions"] as string[][] | undefined) ?? [];
      return ctx.rljfReward.reward(strArray(args, "prompts"), completions, {
        emitScript: boolArg(args, "emitScript", false),
      });
    },
  });

  tools.push({
    name: "jev_scope_judge",
    title: "Agent scope-violation guardrail (ScopeJudge)",
    description:
      "Classify a proposed agent action against its authorized scope rules with 3 parallel Noul checks (scope violation, irreversibility, credential leak) in one fan-out pass; returns allow / ask_human / block. Inspired by, not affiliated with, Dreadnode's ScopeJudge benchmark.",
    inputSchema: schema(
      {
        agentIntent: stringProp("What the agent is trying to accomplish."),
        proposedAction: stringProp("The concrete action the agent is about to take."),
        allowedScopeRules: arrayProp("The rules defining the agent's authorized scope.", { type: "string" }),
      },
      ["agentIntent", "proposedAction", "allowedScopeRules"],
    ),
    handler: async (args) =>
      ctx.scopeJudge.judge(str(args, "agentIntent"), str(args, "proposedAction"), strArray(args, "allowedScopeRules")),
  });

  tools.push({
    name: "jev_marketing_triage",
    title: "Marketing copilot (ad copy + sales-call triage)",
    description:
      "mode=ad_copy: batched Score (hookStrength/clarity/emotionalResonance) + batched Choice (primaryTrigger) over every ad variant. mode=sales_call: Choice (objectionType) + Noul (buyingSignalPresent) over a transcript chunk. Returns the raw primitive results plus a one-line recommendation per item.",
    inputSchema: schema(
      {
        mode: { type: "string", enum: ["ad_copy", "sales_call"], description: "Which triage mode to run." },
        adVariants: arrayProp("Ad copy variants (mode=ad_copy).", { type: "string" }),
        transcriptChunk: stringProp("Sales call transcript chunk (mode=sales_call)."),
      },
      ["mode"],
    ),
    handler: async (args) => {
      const mode = str(args, "mode") as MarketingTriageInput["mode"];
      const input: MarketingTriageInput =
        mode === "ad_copy"
          ? { mode: "ad_copy", adVariants: strArray(args, "adVariants") }
          : { mode: "sales_call", transcriptChunk: str(args, "transcriptChunk") };
      return ctx.marketingCopilot.triage(input);
    },
  });

  tools.push({
    name: "jev_competitor_matrix",
    title: "Competitor intelligence matrix",
    description:
      "Derive 5-8 comparison dimensions (System-2 hypothesis with a deterministic offline fallback) then rate our product and every competitor on every dimension in ONE batched Score pass. Returns the full matrix plus topGaps (largest gaps where we're behind) and topAdvantages (largest gaps where we're ahead), each with a one-line reason.",
    inputSchema: schema(
      {
        ourProductDescription: stringProp("Our product's positioning/description."),
        competitorTexts: {
          type: "object",
          description: "Map of competitor name -> description text.",
          additionalProperties: { type: "string" },
        },
      },
      ["ourProductDescription", "competitorTexts"],
    ),
    handler: async (args) =>
      ctx.competitorIntelligence.matrix(
        str(args, "ourProductDescription"),
        (args["competitorTexts"] as Record<string, string> | undefined) ?? {},
      ),
  });

  tools.push({
    name: "jev_backend_info",
    title: "Backend + environment info",
    description:
      "Report the resolved backend chain, pricing, gatekeeper policy, presets, memory summary and workspace paths so agents can self-diagnose the setup.",
    inputSchema: schema({}),
    handler: async () => {
      const memory = loadMemory(ctx.config.memoryPath);
      const backend = ctx.resolved.backend as unknown as { meta: unknown; notes?: string[] };
      return {
        backend: ctx.resolved.backend.meta,
        chain: ctx.resolved.chain,
        notes: Array.isArray(backend.notes) ? backend.notes : [],
        policy: memory.policy,
        llm: {
          enabled: ctx.config.llm.enabled,
          baseUrl: ctx.config.llm.baseUrl,
          model: ctx.config.llm.model,
        },
        presets: listPresets(),
        memory: memorySummary(memory),
        artifactsDir: artifactsDir(),
        features: {
          implemented: featureCatalog().filter((f) => f.status === "implemented").length,
          total: featureCatalog().length,
        },
      };
    },
  });

  return tools;
}
