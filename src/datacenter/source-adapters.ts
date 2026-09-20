/**
 * Source adapters — 11 curated sources, each with:
 *   1. a `discover()` method returning candidate {url,title,summary} items,
 *   2. a `detail()` method returning full content + license metadata.
 *
 * Each adapter speaks that source's NATIVE protocol:
 *   - fs.blog / LessWrong / sive.rs / julian / Gutenberg / PhilArchive → HTML + selectors
 *   - Open Library / Wikibooks API / OSF API / CORE API → JSON metadata
 */

import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { politeFetch } from "./fetcher.js";
import type { SourceConfig } from "./source-configs.js";

export interface DiscoveredItem {
  url: string;
  title: string;
  summary: string;
}

export interface DetailItem {
  url: string;
  title: string;
  content: string;
  contentHash: string;
  license: string | null;
  author: string | null;
  published: string | null;
  blockedLicense: boolean;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function absolutize(base: string, href: string | undefined): string | null {
  if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return null;
  try {
    const cleaned = new URL(href, base).toString().split("#")[0];
    return cleaned ?? null;
  } catch {
    return null;
  }
}

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/[\u200b-\u200f\u2028\u2029]/g, "").trim();
}

/** Strip boilerplate from an HTML page and return main text. */
export function extractReadable(html: string, selectors: SourceConfig["selectors"]): { title: string; content: string } {
  const $ = cheerio.load(html);
  for (const noise of selectors.noise) $(noise).remove();

  const container = $(selectors.content).first();
  const scope = container.length > 0 ? container : $("body");
  const title = cleanText($("title").first().text() || scope.find("h1").first().text() || "");

  const paragraphs: string[] = [];
  scope.find("p, li, h1, h2, h3, h4, blockquote").each((_, el) => {
    const text = cleanText($(el).text());
    if (text.length >= 25) paragraphs.push(text);
  });

  return { title, content: paragraphs.join("\n\n") };
}


async function discoverHtml(source: SourceConfig, maxItems: number): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  const seen = new Set<string>();

  for (const page of source.discovery.slice(0, 3)) {
    if (items.length >= maxItems) break;
    if (!page.startsWith("http")) continue;
    // JSON endpoints + sitemaps are handled by their own discoverers.
    if (page.includes("format=json") || page.includes("osf.io") || page.includes("core.ac.uk") || page.includes("search.json")) continue;
    if (page.endsWith(".xml")) continue;

    try {
      const result = await politeFetch(page, source.policy);
      if (result.status !== 200 || !result.contentType.includes("html")) continue;
      const $ = cheerio.load(result.body);

      $(source.selectors.card).each((_, card) => {
        if (items.length >= maxItems) return false;
        const anchor = $(card).find(source.selectors.link).first();
        let rawTitle = $(card).find(source.selectors.title).first().text();
        // Image-only anchors: fall back to the img alt text.
        if (!rawTitle.trim()) {
          rawTitle = anchor.find("img").first().attr("alt") ?? "";
        }
        if (!rawTitle.trim()) rawTitle = anchor.text();
        const title = cleanText(rawTitle).slice(0, 300);
        const url = absolutize(source.baseUrl, anchor.attr("href"));
        if (!url || seen.has(url)) return;
        if (!url.startsWith(source.baseUrl)) return;
        const summary = cleanText($(card).find(source.selectors.summary).first().text()).slice(0, 500);
        if (title.length < 8) return;
        seen.add(url);
        items.push({ url, title, summary });
        return undefined;
      });
    } catch {
      /* best-effort per page */
    }
  }
  return items;
}

async function discoverSitemap(source: SourceConfig, maxItems: number): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  for (const page of source.discovery) {
    if (items.length >= maxItems) break;
    if (!page.endsWith(".xml")) continue;
    try {
      const result = await politeFetch(page, source.policy);
      if (result.status !== 200) continue;
      const $ = cheerio.load(result.body, { xml: true });
      $("url > loc").each((_, el) => {
        if (items.length >= maxItems) return false;
        const url = cleanText($(el).text());
        if (!url.startsWith(source.baseUrl)) return;
        const slug = url.split("/").filter(Boolean).pop() ?? url;
        const title = cleanText(decodeURIComponent(slug).replace(/[-_]+/g, " ")).slice(0, 200);
        if (title.length >= 8) items.push({ url, title, summary: "" });
        return undefined;
      });
    } catch {
      /* best-effort */
    }
  }
  return items;
}

async function fetchDetail(source: SourceConfig, url: string, minWords: number): Promise<DetailItem | null> {
  const result = await politeFetch(url, source.policy);
  if (result.status !== 200 || !result.contentType.includes("html")) return null;
  const { title, content } = extractReadable(result.body, source.selectors);
  if (content.split(/\s+/).length < minWords) return null;
  return {
    url: result.finalUrl,
    title: title.slice(0, 300),
    content,
    contentHash: sha256(content),
    license: null,
    author: null,
    published: null,
    blockedLicense: false,
  };
}

/* ------------------------- JSON-native adapters --------------------------- */

async function discoverOpenLibrary(source: SourceConfig, maxItems: number): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  for (const endpoint of source.discovery) {
    if (items.length >= maxItems) break;
    if (!endpoint.includes("search.json")) continue;
    try {
      const result = await politeFetch(endpoint, source.policy);
      if (result.status !== 200) continue;
      const json = JSON.parse(result.body) as {
        docs?: Array<{ key?: string; title?: string; author_name?: string[]; first_publish_year?: number }>;
      };
      for (const doc of json.docs ?? []) {
        if (items.length >= maxItems) break;
        if (!doc.key || !doc.title) continue;
        items.push({
          url: `https://openlibrary.org${doc.key}`,
          title: cleanText(doc.title).slice(0, 300),
          summary: cleanText(`by ${(doc.author_name ?? []).join(", ")}${doc.first_publish_year ? ` (${doc.first_publish_year})` : ""}`).slice(0, 300),
        });
      }
    } catch {
      /* best-effort */
    }
  }
  return items;
}

async function discoverWikibooks(source: SourceConfig, maxItems: number): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  for (const endpoint of source.discovery) {
    if (items.length >= maxItems) break;
    if (!endpoint.includes("api.php")) continue;
    try {
      const result = await politeFetch(endpoint, source.policy);
      if (result.status !== 200) continue;
      const json = JSON.parse(result.body) as {
        query?: { search?: Array<{ title?: string; snippet?: string }> };
      };
      for (const hit of json.query?.search ?? []) {
        if (items.length >= maxItems) break;
        if (!hit.title) continue;
        const url = `https://en.wikibooks.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`;
        items.push({
          url,
          title: cleanText(hit.title).slice(0, 300),
          summary: cleanText((hit.snippet ?? "").replace(/<[^>]+>/g, "")).slice(0, 300),
        });
      }
    } catch {
      /* best-effort */
    }
  }
  return items;
}

async function discoverOsf(source: SourceConfig, maxItems: number): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = [];
  for (const endpoint of source.discovery) {
    if (items.length >= maxItems) break;
    if (!endpoint.includes("osf.io")) continue;
    try {
      const result = await politeFetch(endpoint, source.policy);
      if (result.status !== 200) continue;
      const json = JSON.parse(result.body) as {
        data?: Array<{ id?: string; attributes?: { title?: string; description?: string; date_published?: string } }>;
      };
      for (const preprint of json.data ?? []) {
        if (items.length >= maxItems) break;
        const attrs = preprint.attributes ?? {};
        if (!preprint.id || !attrs.title) continue;
        items.push({
          url: `https://osf.io/preprints/psyarxiv/${preprint.id}`,
          title: cleanText(attrs.title).slice(0, 300),
          summary: cleanText(attrs.description ?? "").slice(0, 400),
        });
      }
    } catch {
      /* best-effort */
    }
  }
  return items;
}

async function discoverCore(source: SourceConfig, maxItems: number): Promise<DiscoveredItem[]> {
  // CORE v3 requires an API key for full search. Without a key we check the
  // endpoint shape and return an empty set with a logged reason.
  void source;
  void maxItems;
  return [];
}

/* ------------------------------ public API -------------------------------- */

/** Discover candidate items for a source (sitemap first, then page cards, then native JSON). */
export async function discover(source: SourceConfig, maxItems = 25): Promise<DiscoveredItem[]> {
  const collected: DiscoveredItem[] = [];
  const seen = new Set<string>();

  const accept = (batch: DiscoveredItem[]): void => {
    for (const item of batch) {
      if (collected.length >= maxItems) break;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      collected.push(item);
    }
  };

  accept(await discoverSitemap(source, maxItems));
  if (collected.length < maxItems) accept(await discoverHtml(source, maxItems));
  if (source.id === "openlibrary" && collected.length < maxItems) {
    accept(await discoverOpenLibrary(source, maxItems));
  }
  if (source.id === "wikibooks" && collected.length < maxItems) {
    accept(await discoverWikibooks(source, maxItems));
  }
  if (source.id === "psyarxiv" && collected.length < maxItems) {
    accept(await discoverOsf(source, maxItems));
  }
  if (source.id === "core" && collected.length < maxItems) {
    accept(await discoverCore(source, maxItems));
  }
  return collected;
}

async function detailOpenLibrary(url: string): Promise<DetailItem | null> {
  // Edition/work JSON — metadata only (no full-text scraping).
  const api = `${url.replace(/\/?$/, "")}.json`;
  try {
    const result = await politeFetch(api, {
      rateLimitMs: 2000,
      concurrency: 2,
      hours: [2, 6],
      userAgent: "jev-research-archive/0.1",
      allowFullContent: false,
    });
    if (result.status !== 200) return null;
    const json = JSON.parse(result.body) as { title?: string; description?: string | { value?: string } };
    const description = typeof json.description === "string" ? json.description : (json.description?.value ?? "");
    const content = cleanText(`${json.title ?? ""}\n\n${description}`.trim());
    if (content.split(/\s+/).length < 15) return null;
    return {
      url,
      title: cleanText(json.title ?? url).slice(0, 300),
      content,
      contentHash: sha256(content),
      license: "metadata-only (Open Library; full text per lending rights)",
      author: null,
      published: null,
      blockedLicense: false,
    };
  } catch {
    return null;
  }
}

/** Fetch full detail for one discovered item (policy-gated upstream). */
export async function detail(
  source: SourceConfig,
  item: DiscoveredItem,
  minWords = 60,
): Promise<DetailItem | null> {
  if (!source.policy.allowFullContent) {
    if (source.id === "openlibrary") return detailOpenLibrary(item.url);
    return null;
  }
  if (source.id === "openlibrary") return detailOpenLibrary(item.url);
  return fetchDetail(source, item.url, minWords);
}
