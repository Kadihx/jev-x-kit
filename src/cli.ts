#!/usr/bin/env node
/**
 * jev-super-agent-mcp CLI — the same modules as the MCP server, scriptable.
 *
 * Usage:
 *   jev-super-agent-mcp info
 *   jev-super-agent-mcp decide "<question>" --options "a,b,c"
 *   jev-super-agent-mcp compact --file <path> --goal "why"
 *   jev-super-agent-mcp audit <root>
 *   jev-super-agent-mcp verify --cwd <dir> [--commands "npx tsc --noEmit|npm test"]
 *   jev-super-agent-mcp label --file <jsonl|txt> [--mode choice|score|noul]
 *   jev-super-agent-mcp guardrail --tool bash --args "<command>"
 *   jev-super-agent-mcp plan "<goal>" [--preset <id>]
 *   jev-super-agent-mcp redteam "<thesis>"
 *   jev-super-agent-mcp memory report|optimize|state
 *   jev-super-agent-mcp features
 *   jev-super-agent-mcp rljf --file <json with {prompts, completions}> [--emitScript true]
 *   jev-super-agent-mcp scope-judge --intent "<intent>" --action "<action>" --rules "rule1|rule2"
 *   jev-super-agent-mcp marketing --mode ad_copy --variants "v1|v2" | --mode sales_call --transcript "<chunk>"
 *   jev-super-agent-mcp competitor-matrix --file <json with {ourProductDescription, competitorTexts}>
 */

import fs from "node:fs";
import { errorMessage } from "./core/errors.js";
import { setLogLevel } from "./core/log.js";
import { loadConfig } from "./core/config.js";
import { createContext } from "./tools/registry.js";

function parseFlags(argv: string[]): { positionals: string[]; flags: Map<string, string> } {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, "true");
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags };
}

function readRows(file: string): string[] {
  const content = fs.readFileSync(file, "utf8");
  if (file.endsWith(".jsonl") || file.endsWith(".json")) {
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          return String(parsed.input ?? parsed.text ?? parsed.prompt ?? line);
        } catch {
          return line;
        }
      });
  }
  return content.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

const print = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseFlags(rest);
  const config = loadConfig();
  setLogLevel((flags.get("log-level") as typeof config.logLevel) ?? "error");
  const ctx = await createContext(config);

  switch (command) {
    case "info":
      print({ backend: ctx.resolved.backend.meta, chain: ctx.resolved.chain, tools: 35 });
      return;

    case "calibration": {
      const file = flags.get("file") ?? "presets/calibration-sample.json";
      const cases = JSON.parse(fs.readFileSync(file, "utf8"));
      print(await ctx.calibrationChecker.check(cases));
      return;
    }

    case "competitors":
      print(
        await ctx.competitorScanner.scan(positionals.join(" ") || flags.get("query") || "", {
          windowDays: Number(flags.get("days") ?? 2),
          limit: Number(flags.get("limit") ?? 15),
          pages: Number(flags.get("pages") ?? 1),
          sortBy: (flags.get("sort") as "stars" | "created" | "updated" | undefined) ?? "stars",
          ourRepo: flags.get("repo"),
        }),
      );
      return;

    case "decide": {
      const question = positionals.join(" ") || flags.get("question") || "";
      const options = (flags.get("options") ?? "yes,no").split(",");
      const outcome = await ctx.evaluator.decide(question, options, { state: ctx.improver.stateBlock() });
      print({
        decision: outcome.decision,
        selected: outcome.primary.selected,
        probabilities: outcome.primary.probabilities,
        subChoices: outcome.subChoices.map((c) => ({ q: c.question, selected: c.selected })),
      });
      return;
    }

    case "compact": {
      const file = flags.get("file");
      const goal = flags.get("goal");
      const report = file
        ? await ctx.compactor.winnowFile(file, { goal })
        : await ctx.compactor.winnow(flags.get("text") ?? positionals.join(" "), { goal });
      print({
        file: "file" in report ? report.file : null,
        keptLines: report.keptLines,
        droppedLines: report.droppedLines,
        bytesIn: report.bytesIn,
        bytesOut: report.bytesOut,
        savedPct: report.bytesIn > 0 ? Math.round((1 - report.bytesOut / report.bytesIn) * 1000) / 10 : 0,
        preservedAnchors: report.preservedAnchors,
        compacted: report.compacted,
      });
      return;
    }

    case "audit":
      print(await ctx.audit.run(positionals[0] ?? process.cwd(), { preset: flags.get("preset") }));
      return;

    case "jarvis-triage": {
      const input = positionals.join(" ") || flags.get("input") || "";
      print(await ctx.jarvisTriage.triage(input, { systemState: flags.get("state") }));
      return;
    }

    case "jarvis-auto-plan": {
      const file = flags.get("file");
      const logText = file ? fs.readFileSync(file, "utf8") : (flags.get("text") ?? positionals.join(" "));
      const report = await ctx.jarvisAutoPlan.extract(logText, { goal: flags.get("goal") });
      const writeTo = flags.get("writeTo") ?? "PROJECT_PLAN.md";
      fs.writeFileSync(writeTo, ctx.jarvisAutoPlan.toMarkdownLines(report, flags.get("title")).join("\n") + "\n", "utf8");
      print({ ...report, writtenTo: writeTo });
      return;
    }

    case "skills": {
      const task = positionals.join(" ") || flags.get("task") || "";
      print(
        await ctx.skillRouter.route(task, {
          limit: Number(flags.get("limit") ?? 3),
          online: flags.get("online") === "true",
        }),
      );
      return;
    }

    case "verify": {
      const commands = flags.get("commands")?.split("|").filter(Boolean);
      print(
        await ctx.improver.verify(commands?.length ? commands : undefined, {
          cwd: flags.get("cwd") ?? process.cwd(),
          timeoutMs: Number(flags.get("timeoutMs") ?? 180_000),
        }),
      );
      return;
    }

    case "label": {
      const file = flags.get("file");
      if (!file) throw new Error("label requires --file <jsonl|txt>");
      const rows = readRows(file).slice(0, Number(flags.get("limit") ?? 500));
      print(
        await ctx.training.label(rows, {
          mode: (flags.get("mode") as "choice" | "score" | "noul") ?? "choice",
          options: flags.get("options")?.split(","),
        }),
      );
      return;
    }

    case "guardrail":
      print(await ctx.dispatcher.guardrail(flags.get("tool") ?? "bash", flags.get("args") ?? positionals.join(" ")));
      return;

    case "plan":
      print(
        await ctx.planner.plan(flags.get("goal") ?? positionals.join(" "), {
          preset: flags.get("preset"),
          context: flags.get("context")?.split("|"),
        }),
      );
      return;

    case "redteam":
      print(await ctx.redTeam.review(flags.get("thesis") ?? positionals.join(" ")));
      return;

    case "memory":
      print(
        positionals[0] === "optimize"
          ? ctx.improver.optimize()
          : positionals[0] === "state"
            ? { state: ctx.improver.stateBlock(), stats: ctx.improver.stats() }
            : ctx.improver.report(),
      );
      return;

    case "features":
      print((await import("./modules/enterprise-features.js")).featureCatalog());
      return;

    case "rljf": {
      const file = flags.get("file");
      if (!file) throw new Error("rljf requires --file <json with {prompts, completions}>");
      const { prompts, completions } = JSON.parse(fs.readFileSync(file, "utf8"));
      print(await ctx.rljfReward.reward(prompts, completions, { emitScript: flags.get("emitScript") === "true" }));
      return;
    }

    case "scope-judge":
      print(
        await ctx.scopeJudge.judge(
          flags.get("intent") ?? positionals.join(" "),
          flags.get("action") ?? "",
          (flags.get("rules") ?? "").split("|").filter(Boolean),
        ),
      );
      return;

    case "marketing": {
      const mode = flags.get("mode") ?? "ad_copy";
      if (mode === "sales_call") {
        print(
          await ctx.marketingCopilot.triage({
            mode: "sales_call",
            transcriptChunk: flags.get("transcript") ?? positionals.join(" "),
          }),
        );
      } else {
        print(
          await ctx.marketingCopilot.triage({
            mode: "ad_copy",
            adVariants: (flags.get("variants") ?? "").split("|").filter(Boolean),
          }),
        );
      }
      return;
    }

    case "competitor-matrix": {
      const file = flags.get("file");
      if (!file) throw new Error("competitor-matrix requires --file <json with {ourProductDescription, competitorTexts}>");
      const { ourProductDescription, competitorTexts } = JSON.parse(fs.readFileSync(file, "utf8"));
      print(await ctx.competitorIntelligence.matrix(ourProductDescription, competitorTexts));
      return;
    }

    default:
      process.stderr.write(
        "jev-super-agent-mcp CLI\n" +
          "commands: info | decide | compact | audit | verify | label | guardrail | plan | redteam | memory | features | competitors | calibration | skills | rljf | scope-judge | marketing | competitor-matrix | jarvis-triage | jarvis-auto-plan\n",
      );
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((error) => {
  process.stderr.write(`[jev:error] ${errorMessage(error)}\n`);
  process.exit(1);
});
