#!/usr/bin/env node
/**
 * research-hub CLI — the knowledge data center operator console.
 *
 *   research-hub crawl [--source <id>...] [--max-items N] [--min-words N]
 *                      [--force] [--dry-run] [--db <path>]
 *   research-hub query "<question>" [--limit N] [--top N]
 *                      [--category mental-models|library|academic] [--db <path>]
 *   research-hub sources [--category <cat>]
 *   research-hub stats [--db <path>]
 *   research-hub runs [--db <path>] [--limit N]
 *   research-hub seed  (runs the registry verification suite, no network)
 */

import { errorMessage } from "./core/errors.js";
import { setLogLevel } from "./core/log.js";
import { loadConfig } from "./core/config.js";
import { SOURCES, sourcesByCategory, getSource, isWithinHours } from "./datacenter/source-configs.js";
import { crawlDatacenter } from "./datacenter/crawler.js";
import { HubStore, defaultDbPath } from "./datacenter/store.js";
import { queryHub, defaultQueryDeps } from "./datacenter/query.js";

function parseFlags(argv: string[]): { positionals: string[]; flags: Map<string, string[]> } {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const push = (key: string, value: string): void => {
    const list = flags.get(key) ?? [];
    list.push(value);
    flags.set(key, list);
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        push(key, next);
        i++;
      } else {
        push(key, "true");
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags };
}

const first = (flags: Map<string, string[]>, key: string): string | undefined => flags.get(key)?.[0];
const print = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseFlags(rest);
  const config = loadConfig();
  setLogLevel((first(flags, "log-level") as typeof config.logLevel) ?? "error");

  const dbPath = first(flags, "db") ?? process.env.HUB_DB_PATH ?? defaultDbPath();

  switch (command) {
    case "sources": {
      const category = first(flags, "category");
      const list = category ? sourcesByCategory(category as "mental-models" | "library" | "academic") : SOURCES;
      print(
        list.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          baseUrl: s.baseUrl,
          discovery: s.discovery,
          policy: s.policy,
          inWindow: isWithinHours(s.policy.hours),
        })),
      );
      return;
    }

    case "crawl": {
      const sources = flags.get("source")?.length ? flags.get("source")!.map((id) => getSource(id)) : SOURCES;
      const outcome = await crawlDatacenter(sources, {
        maxItems: Number(first(flags, "max-items") ?? 12),
        minWords: Number(first(flags, "min-words") ?? 60),
        force: flags.has("force"),
        dryRun: flags.has("dry-run"),
        dbPath,
        onlySources: flags.get("source"),
      });
      print(outcome);
      return;
    }

    case "query": {
      const question = positionals.join(" ") || first(flags, "q") || "";
      if (!question) throw new Error('query requires a question, e.g. research-hub query "second-order thinking"');
      const deps = await defaultQueryDeps(dbPath);
      try {
        const answer = await queryHub(question, deps, {
          limit: Number(first(flags, "limit") ?? 25),
          topK: Number(first(flags, "top") ?? 5),
          category: (first(flags, "category") as "mental-models" | "library" | "academic" | undefined) ?? undefined,
        });
        if (flags.has("json")) {
          print(answer);
          return;
        }
        process.stdout.write(`\nQ: ${answer.query}\nbackend: ${answer.backend} · ${answer.latencyMs}ms · answer-source: ${answer.answer.source}\n\n`);
        for (const passage of answer.passages.slice(0, 8)) {
          process.stdout.write(
            `[${passage.tier} ${passage.relevance.toFixed(2)}] ${passage.doc.source} :: ${passage.doc.title.slice(0, 90)}\n  ${passage.doc.url}\n`,
          );
        }
        process.stdout.write(`\n--- ANSWER ---\n${answer.answer.brief}\n\nCitations:\n`);
        for (const citation of answer.answer.citations) process.stdout.write(`  - ${citation}\n`);
      } finally {
        deps.close();
      }
      return;
    }

    case "stats": {
      const store = new HubStore(dbPath);
      try {
        print(store.stats());
      } finally {
        store.close();
      }
      return;
    }

    case "runs": {
      const store = new HubStore(dbPath);
      try {
        print(store.runs(Number(first(flags, "limit") ?? 10)));
      } finally {
        store.close();
      }
      return;
    }

    case "seed":
      print({ registry: SOURCES.length, categories: ["mental-models", "library", "academic"], note: "run tests/datacenter.test.mjs for the no-network suite" });
      return;

    default:
      process.stderr.write(
        "research-hub — knowledge data center console\n" +
          "  research-hub sources [--category <cat>]\n" +
          "  research-hub crawl [--source <id> ...] [--max-items N] [--min-words N] [--force] [--dry-run] [--db <path>]\n" +
          '  research-hub query "<question>" [--limit N] [--top N] [--category <cat>] [--db <path>] [--json]\n' +
          "  research-hub stats [--db <path>]\n" +
          "  research-hub runs [--db <path>]\n",
      );
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((error) => {
  process.stderr.write(`[hub:error] ${errorMessage(error)}\n`);
  process.exit(1);
});
