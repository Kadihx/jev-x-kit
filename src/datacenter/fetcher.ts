/**
 * Polite fetcher: per-host rate limiting, concurrency caps, retries with
 * backoff, honest user-agent. One scheduler per host shared by all callers.
 */

import type { SourcePolicy } from "./source-configs.js";
import { log } from "../core/log.js";

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  ms: number;
  fromCache: boolean;
}

interface CacheEntry {
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
  storedAt: number;
}

const CACHE_TTL_MS = 24 * 3600 * 1000;

class HostScheduler {
  private queue: Array<() => void> = [];
  private active = 0;
  private lastStart = 0;

  constructor(private readonly policy: SourcePolicy) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.policy.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      const now = Date.now();
      const wait = this.policy.rateLimitMs - (now - this.lastStart);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastStart = Date.now();
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const schedulers = new Map<string, HostScheduler>();
const memoryCache = new Map<string, CacheEntry>();

export function schedulerFor(host: string, policy: SourcePolicy): HostScheduler {
  let scheduler = schedulers.get(host);
  if (!scheduler) {
    scheduler = new HostScheduler(policy);
    schedulers.set(host, scheduler);
  }
  return scheduler;
}

export function clearCaches(): void {
  memoryCache.clear();
}

export async function politeFetch(
  url: string,
  policy: SourcePolicy,
  opts: { timeoutMs?: number; maxBytes?: number; retries?: number } = {},
): Promise<FetchResult> {
  const { timeoutMs = 15000, maxBytes = 2_000_000, retries = 2 } = opts;
  const host = new URL(url).hostname;
  const scheduler = schedulerFor(host, policy);

  const cached = memoryCache.get(url);
  if (cached && Date.now() - cached.storedAt < CACHE_TTL_MS) {
    return {
      url,
      finalUrl: cached.finalUrl,
      status: cached.status,
      contentType: cached.contentType,
      body: cached.body,
      ms: 0,
      fromCache: true,
    };
  }

  return scheduler.run(async () => {
    let attempt = 0;
    for (;;) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: { "user-agent": policy.userAgent, accept: "text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.1" },
        });
        const buffer = new Uint8Array(await response.arrayBuffer());
        const body = new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, maxBytes));
        const result: FetchResult = {
          url,
          finalUrl: response.url,
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          body,
          ms: Date.now() - started,
          fromCache: false,
        };
        if (response.status >= 200 && response.status < 300) {
          memoryCache.set(url, { status: result.status, contentType: result.contentType, body, finalUrl: result.finalUrl, storedAt: Date.now() });
        } else if (response.status === 429 && attempt < retries) {
          throw new Error("HTTP 429 rate limited");
        }
        return result;
      } catch (error) {
        if (attempt >= retries) throw error;
        const backoff = 1500 * 2 ** attempt;
        log.debug(`fetch retry ${attempt + 1}/${retries} for ${url} after ${backoff}ms`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        attempt++;
      } finally {
        clearTimeout(timer);
      }
    }
  });
}
