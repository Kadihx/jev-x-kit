/**
 * Data-center crawler — politeness-first pipeline:
 *
 *   1. hour gate        (source window, default 02:00–06:00 Europe/Berlin)
 *   2. robots.txt gate  (deny-by-default, longest-match wins)
 *   3. discover         (sitemap → page cards → native JSON APIs)
 *   4. license check    (clean-room v2: full / metadata-only / deny)
 *   5. fetch + extract  (cheerio boilerplate stripping, ≥60 words)
 *   6. store            (SQLite upsert with hash dedupe)
 *
 * Nothing reaches the network unless gates 1 and 2 pass.
 */

import { isWithinHours, type SourceConfig } from "./source-configs.js";
import { isAllowed } from "./robots.js";
import { detail, discover } from "./source-adapters.js";
import { checkLicense } from "./license-engine.js";
import { HubStore, type CrawlStats } from "./store.js";
import { log } from "../core/log.js";
import { mapLimit } from "../core/fanout.js";

export interface CrawlOptions {
  maxItems?: number;
  minWords?: number;
  force?: boolean;
  dryRun?: boolean;
  dbPath?: string;
  onlySources?: string[];
}

export interface CrawlOutcome {
  stats: CrawlStats[];
  runId: number | null;
  total: number;
  dryRun: boolean;
}

export async function crawlDatacenter(
  sources: SourceConfig[],
  options: CrawlOptions = {},
): Promise<CrawlOutcome> {
  const { maxItems = 12, minWords = 60, force = false, dryRun = false, dbPath, onlySources } = options;
  const selected = onlySources?.length ? sources.filter((s) => onlySources.includes(s.id)) : sources;

  const store = new HubStore(dbPath);
  const started = Date.now();
  const runId = dryRun ? null : store.beginRun(selected.map((s) => s.id));
  const stats: CrawlStats[] = [];

  for (const source of selected) {
    const stat: CrawlStats = {
      source: source.id,
      discovered: 0,
      fetched: 0,
      stored: 0,
      skipped_unchanged: 0,
      blocked_license: 0,
      errors: 0,
      ms: 0,
    };
    const t0 = Date.now();

    // Gate 1: off-hours window.
    if (!force && !isWithinHours(source.policy.hours)) {
      log.warn(`[${source.id}] outside crawl window (policy ${source.policy.hours[0]}:00-${source.policy.hours[1]}:00 Berlin); use --force to override`);
      stat.ms = Date.now() - t0;
      stats.push(stat);
      continue;
    }

    // Gate 2: robots.txt for the discovery entry points.
    let robotsOk = true;
    for (const entry of source.discovery.slice(0, 2)) {
      const gate = await isAllowed(entry, source.policy.userAgent);
      if (!gate.allowed) {
        log.warn(`[${source.id}] robots.txt denies ${entry}: ${gate.reason}`);
        robotsOk = false;
        break;
      }
    }
    if (!robotsOk && !force) {
      stat.ms = Date.now() - t0;
      stats.push(stat);
      continue;
    }

    // Step 3: discovery.
    let items: Awaited<ReturnType<typeof discover>> = [];
    try {
      items = await discover(source, maxItems);
    } catch (error) {
      log.warn(`[${source.id}] discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      stat.errors++;
    }
    stat.discovered = items.length;

    // Steps 4–6: license, fetch, store (bounded concurrency per source).
    const results = await mapLimit(items, source.policy.concurrency, async (item) => {
      try {
        if (dryRun) return "dry" as const;
        if (!force) {
          const gate = await isAllowed(item.url, source.policy.userAgent);
          if (!gate.allowed) return "robots" as const;
        }
        const detailItem = await detail(source, item, minWords);
        if (!detailItem) return "empty" as const;

        const license = checkLicense(source, detailItem);
        if (license.decision === "deny") return "license" as const;
        const content = license.decision === "metadata-only"
          ? `${detailItem.title}\n\n${(item.summary || "No abstract available.").slice(0, 1500)}`
          : detailItem.content;

        stat.fetched++;
        return store.upsert({
          source: source.id,
          url: detailItem.url,
          title: detailItem.title,
          content,
          content_hash: detailItem.contentHash,
          license: license.license ?? detailItem.license,
          author: detailItem.author,
          published: detailItem.published,
        });
      } catch {
        stat.errors++;
        return "error" as const;
      }
    });

    for (const outcome of results) {
      if (outcome === "inserted" || outcome === "updated") stat.stored++;
      else if (outcome === "unchanged") stat.skipped_unchanged++;
      else if (outcome === "license") stat.blocked_license++;
    }

    stat.ms = Date.now() - t0;
    stats.push(stat);
    log.info(`[${source.id}] discovered=${stat.discovered} fetched=${stat.fetched} stored=${stat.stored} unchanged=${stat.skipped_unchanged} blocked=${stat.blocked_license} errors=${stat.errors} (${stat.ms}ms)`);
  }

  if (!dryRun && runId !== null) store.finishRun(runId, stats);
  const total = stats.reduce((a, s) => a + s.stored, 0);
  log.info(`crawl finished in ${Date.now() - started}ms: ${total} new/updated docs`);
  store.close();
  return { stats, runId, total, dryRun };
}
