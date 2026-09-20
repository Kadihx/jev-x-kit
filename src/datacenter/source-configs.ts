/**
 * Data-center source registry — 11 curated sources across 3 tiers.
 * Politeness baked in: every source has its own rate limit, concurrency
 * budget and off-hours window.
 */

export type SourceCategory =
  | "mental-models"
  | "library"
  | "academic";

export interface SourceSelectors {
  /** CSS selector that yields one "article card" per element. */
  card: string;
  /** Within a card: link to the full item. */
  link: string;
  /** Within a card: human-readable title. */
  title: string;
  /** Within a card: short description/summary. */
  summary: string;
  /** Selectors that mark the main content on a detail page. */
  content: string;
  /** Selectors to strip before extracting text (nav, ads, comments...). */
  noise: string[];
}

export interface SourcePolicy {
  /** Minimum delay between requests to this host (ms). */
  rateLimitMs: number;
  /** Max concurrent in-flight requests to this host. */
  concurrency: number;
  /** Crawl only inside this daily window (UTC hours, half-open). */
  hours: [number, number];
  /** Honest user-agent string. */
  userAgent: string;
  /** Whether we may fetch full detail pages (vs. discovery-only). */
  allowFullContent: boolean;
}

export interface SourceConfig {
  id: string;
  name: string;
  baseUrl: string;
  category: SourceCategory;
  description: string;
  /** Primary discovery URLs (sitemaps, catalogs, indexes). */
  discovery: string[];
  selectors: SourceSelectors;
  policy: SourcePolicy;
}

const BERLIN_TZ = "Europe/Berlin";

function hourInBerlin(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 12) % 24;
}

export function isWithinHours(hours: [number, number], date: Date = new Date()): boolean {
  const h = hourInBerlin(date);
  const [start, end] = hours;
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

const DEFAULT_POLICY: SourcePolicy = {
  rateLimitMs: 4000,
  concurrency: 2,
  hours: [2, 6],
  userAgent: "jev-research-archive/0.1 (+educational research archive; contact via repo)",
  allowFullContent: true,
};

const ACADEMIC_POLICY: SourcePolicy = {
  ...DEFAULT_POLICY,
  rateLimitMs: 6000,
  concurrency: 1,
};

const NOISE = ["script", "style", "nav", "header", "footer", "aside", ".sidebar", ".comments", "#comments", ".ad", ".ads", ".share", ".related"];
const DETAIL_CONTENT = "article, main, .content, .entry-content, #content, #bodyContent";

export const SOURCES: SourceConfig[] = [
  {
    id: "fs-blog",
    name: "Farnam Street",
    baseUrl: "https://fs.blog",
    category: "mental-models",
    description: "Mental models, decision making, cognitive biases — articles and book summaries.",
    discovery: ["https://fs.blog/sitemap.xml", "https://fs.blog/mental-models/", "https://fs.blog/blog/"],
    selectors: {
      card: "article, .post, .card",
      link: "a[href]",
      title: "h1, h2, h3, .title",
      summary: "p, .excerpt, .summary",
      content: ".entry-content, article, main",
      noise: NOISE,
    },
    policy: { ...DEFAULT_POLICY },
  },
  {
    id: "lesswrong",
    name: "LessWrong",
    baseUrl: "https://www.lesswrong.com",
    category: "mental-models",
    description: "Rationality, cognitive science, decision theory — posts and wiki tags.",
    discovery: ["https://www.lesswrong.com/sitemap.xml"],
    selectors: {
      card: "article, [class*='post'], [class*='Post']",
      link: "a[href]",
      title: "h1, h2, h3",
      summary: "p",
      content: "article, main, [class*='content']",
      noise: NOISE,
    },
    policy: { ...DEFAULT_POLICY, concurrency: 1 },
  },
  {
    id: "sivers",
    name: "Derek Sivers — Book Notes",
    baseUrl: "https://sive.rs",
    category: "mental-models",
    description: "300+ book notes on self-improvement, productivity, entrepreneurship, philosophy.",
    discovery: ["https://sive.rs/book"],
    selectors: {
      card: "li:has(a[href*='/book/'])",
      link: "a[href*='/book/']",
      title: "a, strong, h1, h2, h3",
      summary: "p, .summary",
      content: "article, main, #content, .content",
      noise: NOISE,
    },
    policy: { ...DEFAULT_POLICY },
  },
  {
    id: "julian",
    name: "Julian Shapiro Guides",
    baseUrl: "https://www.julian.com",
    category: "mental-models",
    description: "Step-by-step open guides on habits, focus, mental models, thinking.",
    discovery: ["https://www.julian.com/sitemap.xml", "https://www.julian.com/blog"],
    selectors: {
      card: "article, .post, li",
      link: "a[href]",
      title: "h1, h2, h3",
      summary: "p",
      content: "article, main, .prose",
      noise: NOISE,
    },
    policy: { ...DEFAULT_POLICY },
  },
  {
    id: "openlibrary",
    name: "Open Library",
    baseUrl: "https://openlibrary.org",
    category: "library",
    description: "Book metadata (editions/works) via search.json; full text only where lending/public-domain allows.",
    discovery: [
      "https://openlibrary.org/search.json?q=mental+models&limit=25",
      "https://openlibrary.org/search.json?q=self+help+philosophy&limit=25",
    ],
    selectors: {
      card: ".searchResultItem, article, li",
      link: "a[href*='/books/'], a[href*='/works/'], a[href]",
      title: "h1, h2, h3, .booktitle",
      summary: "p",
      content: DETAIL_CONTENT,
      noise: NOISE,
    },
    policy: { ...DEFAULT_POLICY, rateLimitMs: 2000, allowFullContent: false },
  },
  {
    id: "archive",
    name: "Internet Archive",
    baseUrl: "https://archive.org",
    category: "library",
    description: "Full-text public-domain books and texts via advancedsearch + full-text search inside.",
    discovery: ["https://archive.org/advancedsearch.php?q=mediatype%3Atexts+AND+%28stoic+OR+%22mental+models%22%29&fl%5B%5D=identifier&fl%5B%5D=title&rows=25&output=json"],
    selectors: {
      card: ".item, .collection-item, article",
      link: "a[href*='/details/']",
      title: ".title, h1, h2, h3",
      summary: ".description, p",
      content: "#theatre-ia, .book-content, main, article",
      noise: NOISE,
    },
    policy: { ...DEFAULT_POLICY, rateLimitMs: 2000, allowFullContent: true },
  },
  {
    id: "gutenberg",
    name: "Project Gutenberg",
    baseUrl: "https://www.gutenberg.org",
    category: "library",
    description: "70,000+ public-domain ebooks — Stoics, early self-improvement classics.",
    discovery: [
      "https://www.gutenberg.org/ebooks/search/?query=stoic",
      "https://www.gutenberg.org/ebooks/search/?query=marcus+aurelius",
    ],
    selectors: {
      card: "li.booklink, .booklink, article",
      link: "a[href*='/ebooks/']",
      title: ".title, h1, .booktitle",
      summary: ".subtitle, p",
      content: "body, main",
      noise: NOISE,
    },
    policy: { ...DEFAULT_POLICY, allowFullContent: true },
  },
  {
    id: "wikibooks",
    name: "Wikibooks",
    baseUrl: "https://www.wikibooks.org",
    category: "library",
    description: "Community open-license textbooks, self-management guides, practical how-tos.",
    discovery: [
      "https://www.wikibooks.org/w/api.php?action=query&list=search&srsearch=self%20improvement&format=json&srlimit=20",
    ],
    selectors: {
      card: ".mw-search-result, li",
      link: "a[href]",
      title: ".mw-search-result-heading, h1, h2",
      summary: ".searchresult, p",
      content: "#bodyContent, main",
      noise: NOISE,
    },
    policy: { ...DEFAULT_POLICY, rateLimitMs: 2000 },
  },
  {
    id: "philarchive",
    name: "PhilArchive",
    baseUrl: "https://philarchive.org",
    category: "academic",
    description: "Largest open philosophy preprint archive — mind, ethics, epistemology, practical reasoning.",
    discovery: ["https://philarchive.org/sitemap.xml"],
    selectors: {
      card: "article, .paper, .entry, li",
      link: "a[href*='/rec/'], a[href*='/archive/'], a[href]",
      title: "h1, h2, h3, .title",
      summary: ".abstract, p",
      content: ".abstract, article, main",
      noise: NOISE,
    },
    policy: { ...ACADEMIC_POLICY, allowFullContent: false },
  },
  {
    id: "psyarxiv",
    name: "PsyArXiv",
    baseUrl: "https://psyarxiv.com",
    category: "academic",
    description: "Behavioral science preprints — motivation, cognitive psychology, habit neuroscience.",
    discovery: ["https://api.osf.io/v2/preprints/?filter[provider]=psyarxiv&page[size]=25"],
    selectors: {
      card: "article, .preprint, li",
      link: "a[href]",
      title: "h1, h2, h3",
      summary: "p, .abstract",
      content: ".abstract, article, main",
      noise: NOISE,
    },
    policy: { ...ACADEMIC_POLICY, allowFullContent: false },
  },
  {
    id: "core",
    name: "CORE",
    baseUrl: "https://core.ac.uk",
    category: "academic",
    description: "Global aggregator of university open-access repositories — theses and research.",
    discovery: ["https://api.core.ac.uk/v3/search/works/?q=self+improvement+psychology&limit=25"],
    selectors: {
      card: "article, .result, li",
      link: "a[href]",
      title: "h1, h2, h3",
      summary: "p, .abstract",
      content: ".abstract, article, main",
      noise: NOISE,
    },
    policy: { ...ACADEMIC_POLICY, concurrency: 1, allowFullContent: false },
  },
];

export function getSource(id: string): SourceConfig {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) throw new Error(`unknown source: ${id}`);
  return source;
}

export function sourcesByCategory(category: SourceCategory): SourceConfig[] {
  return SOURCES.filter((s) => s.category === category);
}
