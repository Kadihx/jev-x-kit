/**
 * License engine (Clean-Room v2 — knowledge-tier version).
 *
 * Pages (free web content like fs.blog, LessWrong, Julian): full content OK
 * with source preservation + attribution.
 *
 * Books/editions (Open Library, Gutenberg): metadata-only, or full text only
 * when the item is provably public domain (Gutenberg = public domain by design).
 *
 * Academic (PhilArchive, PsyArXiv, OSF, CORE): abstracts/summaries only.
 * Full papers stay behind the publisher page; the hub stores title, abstract,
 * authors and the canonical URL — never the PDF.
 */

import type { SourceConfig } from "./source-configs.js";

export type LicenseDecision = "full" | "metadata-only" | "deny";

export interface LicenseCheck {
  decision: LicenseDecision;
  reason: string;
  license: string | null;
}

const PUBLIC_DOMAIN_HINTS = [
  "public domain",
  "marcus aurelius",
  "seneca",
  "epictetus",
  "epiktet",
  "aurelius",
  "meditations",
  "letters from a stoic",
  "enchiridion",
  "discourses",
];

export function checkLicense(
  source: SourceConfig,
  detail: { title: string; url: string; content: string },
): LicenseCheck {
  const haystack = `${source.name} ${detail.title} ${detail.url}`.toLowerCase();

  // 1) Project Gutenberg: public domain by design -> full text allowed.
  if (source.id === "gutenberg") {
    return {
      decision: "full",
      reason: "Project Gutenberg distributes public-domain works by design.",
      license: "public-domain (Project Gutenberg)",
    };
  }

  // 2) Extra safety: any explicit public-domain hint -> full allowed.
  if (PUBLIC_DOMAIN_HINTS.some((hint) => haystack.includes(hint)) && source.id !== "openlibrary") {
    return {
      decision: "full",
      reason: "Public-domain classical work identified by title/author.",
      license: "public-domain (classical)",
    };
  }

  // 3) Academic tier: abstracts only, never full papers.
  if (source.category === "academic") {
    return {
      decision: "metadata-only",
      reason: "Academic tier: title/abstract/authors stored; full paper stays at the publisher.",
      license: null,
    };
  }

  // 4) Open Library / CORE: metadata only (lending rights / aggregation).
  if (source.id === "openlibrary" || source.id === "core") {
    return {
      decision: "metadata-only",
      reason: "Aggregator tier: metadata only; full text governed by lending/API rights.",
      license: "metadata-only",
    };
  }

  // 5) Mental-model pages + Wikibooks (open licenses): full with attribution.
  return {
    decision: "full",
    reason: "Free web article/open-license content; source URL and attribution preserved.",
    license: source.id === "wikibooks" ? "open license (CC BY-SA family)" : `free web (${source.name})`,
  };
}
