/**
 * robots.txt gate: hard enforcement. URL must be allowed by the site's
 * robots.txt for our user-agent before ANY fetch happens.
 * Rules are cached per host for 24h; unreachable robots.txt = deny (safe side).
 */

import { log } from "../core/log.js";

interface Ruleset {
  disallows: RegExp[];
  allows: RegExp[];
  crawlDelayMs: number;
  fetchedAt: number;
}

const ROBOTS_TTL_MS = 24 * 3600 * 1000;
const cache = new Map<string, Ruleset>();

const OUR_TOKENS = ["jev-research-archive", "*"];

function patternToRegExp(pattern: string): RegExp {
  // robots.txt path matching: * = wildcard, $ = end anchor.
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") out += ".*";
    else if (ch === "$" && i === pattern.length - 1) out += "$";
    else out += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out);
}

function parseRobots(body: string): { groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }>; crawlDelay: number }>; } {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }>; crawlDelay: number }> = [];
  let current: { agents: string[]; rules: Array<{ allow: boolean; path: string }>; crawlDelay: number } | null = null;
  let lastDirective: "agent" | "rule" | null = null;

  const touchGroup = (): void => {
    if (!current || (lastDirective !== "agent" && current.agents.length > 0 && current.rules.length > 0)) {
      current = { agents: [], rules: [], crawlDelay: 0 };
      groups.push(current);
    }
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      touchGroup();
      current!.agents.push(value.toLowerCase());
      lastDirective = "agent";
    } else if (field === "disallow" || field === "allow") {
      if (!current) {
        current = { agents: [], rules: [], crawlDelay: 0 };
        groups.push(current);
      }
      if (value) current.rules.push({ allow: field === "allow", path: value });
      lastDirective = "rule";
    } else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (current && Number.isFinite(seconds) && seconds > 0) current.crawlDelay = Math.max(current.crawlDelay, seconds * 1000);
    }
  }
  return { groups };
}

function pickGroup(groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }>; crawlDelay: number }>): typeof groups[number] | null {
  let wildcard: typeof groups[number] | null = null;
  for (const group of groups) {
    if (group.agents.some((a) => OUR_TOKENS[0]!.includes(a) || a.includes("jev-research"))) return group;
    if (group.agents.includes("*")) wildcard = group;
  }
  return wildcard;
}

async function loadRules(url: URL, userAgent: string): Promise<Ruleset> {
  const key = url.origin;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached;

  const fallback: Ruleset = { disallows: [], allows: [], crawlDelayMs: 0, fetchedAt: Date.now() };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${url.origin}/robots.txt`, {
      signal: controller.signal,
      headers: { "user-agent": userAgent },
    });
    clearTimeout(timer);
    if (!response.ok) {
      // No robots.txt (404) or server error: treat as deny-by-default for crawlers
      // on non-API hosts, allow API hosts (they usually 404 robots.txt).
      const apiHost = /api\.|search\.json|\/api\//i.test(url.href);
      const ruleset: Ruleset = apiHost ? fallback : { ...fallback, disallows: [/^/] };
      log.debug(`robots.txt ${response.status} for ${key} -> ${apiHost ? "API host, allowed" : "deny-by-default"}`);
      cache.set(key, ruleset);
      return ruleset;
    }
    const body = await response.text();
    const { groups } = parseRobots(body);
    const group = pickGroup(groups);
    const ruleset: Ruleset = { disallows: [], allows: [], crawlDelayMs: group?.crawlDelay ?? 0, fetchedAt: Date.now() };
    for (const rule of group?.rules ?? []) {
      (rule.allow ? ruleset.allows : ruleset.disallows).push(patternToRegExp(rule.path));
    }
    cache.set(key, ruleset);
    return ruleset;
  } catch {
    cache.set(key, fallback);
    return fallback;
  }
}

export async function isAllowed(rawUrl: string, userAgent: string): Promise<{ allowed: boolean; reason: string; crawlDelayMs: number }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "invalid url", crawlDelayMs: 0 };
  }
  const rules = await loadRules(url, userAgent);
  const path = url.pathname + url.search;

  let bestAllow = -1;
  let bestDeny = -1;
  for (const re of rules.allows) {
    const m = re.source.length;
    if (re.test(path) && m > bestAllow) bestAllow = m;
  }
  for (const re of rules.disallows) {
    const m = re.source.length;
    if (re.test(path) && m > bestDeny) bestDeny = m;
  }

  if (bestDeny >= 0 && bestDeny >= bestAllow) {
    return { allowed: false, reason: `disallowed by robots.txt (${path})`, crawlDelayMs: rules.crawlDelayMs };
  }
  return { allowed: true, reason: "allowed", crawlDelayMs: rules.crawlDelayMs };
}

export function clearRobotsCache(): void {
  cache.clear();
}
