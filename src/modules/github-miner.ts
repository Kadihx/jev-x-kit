/**
 * MODULE 6 — GitHub Mining & Clean-Room Inspiration Engine.
 *
 * License audit first: MIT/Apache/BSD may be reused with attribution; GPL/AGPL/
 * unknown triggers the clean-room path where only *metadata* (description,
 * topics, directory names, README) is inspected and an original-code spec is
 * produced. A 5-gram Jaccard guard proves the produced spec shares no
 * meaningful text with the upstream sample.
 */

import fs from "node:fs";
import path from "node:path";
import { System2Client } from "../core/llm.js";
import { log } from "../core/log.js";
import { ngramJaccard, round } from "../core/text.js";
import type { JevBackend } from "../core/types.js";
import type { LicenseClass, LicenseVerdict, MiningReport } from "../core/module-types.js";

export interface MinerDeps {
  backend: JevBackend;
  llm: System2Client;
  githubToken?: string;
}

const PERMISSIVE = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unlicense", "0BSD", "CC0-1.0",
]);
const COPYLEFT = new Set([
  "GPL-2.0", "GPL-3.0", "GPL-2.0-only", "GPL-3.0-only", "GPL-3.0-or-later",
  "AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later", "LGPL-2.1", "LGPL-3.0",
  "SSPL-1.0", "EUPL-1.2", "CPAL-1.0",
]);

export function classifyLicense(spdx: string | null | undefined): LicenseVerdict {
  const id = (spdx ?? "").trim();
  if (!id) {
    return {
      spdx: "UNKNOWN",
      klass: "unknown",
      copyAllowed: false,
      reason: "No SPDX identifier found; treat as all-rights-reserved and use the clean-room path.",
    };
  }
  if (PERMISSIVE.has(id)) {
    return {
      spdx: id,
      klass: "permissive",
      copyAllowed: true,
      reason: `${id} is permissive: direct reuse allowed while preserving attribution and license text.`,
    };
  }
  if (COPYLEFT.has(id) || id.startsWith("GPL") || id.startsWith("AGPL") || id.startsWith("LGPL")) {
    return {
      spdx: id,
      klass: "copyleft",
      copyAllowed: false,
      reason: `${id} is copyleft: copying source into this project would contaminate it; clean-room extraction only.`,
    };
  }
  return {
    spdx: id,
    klass: "proprietary",
    copyAllowed: false,
    reason: `${id} is not on the permissive allow-list; treat as proprietary and use the clean-room path.`,
  };
}

interface RepoMeta {
  fullName: string;
  description: string | null;
  topics: string[];
  language: string | null;
  stars: number;
  spdx: string | null;
  hasLicenseFile: boolean;
}

async function fetchJson<T>(url: string, token?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "jev-super-agent-mcp",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchReadme(owner: string, name: string, token?: string): Promise<string | null> {
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/HEAD/README.md`, {
      headers: { "user-agent": "jev-super-agent-mcp", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!response.ok) return null;
    return (await response.text()).slice(0, 20_000);
  } catch {
    return null;
  }
}

export class GithubMiner {
  constructor(private readonly deps: MinerDeps) {}

  async mine(
    repo: string,
    opts: { similarityThreshold?: number } = {},
  ): Promise<MiningReport> {
    const started = Date.now();
    const threshold = opts.similarityThreshold ?? 0.15;

    // Local path mode: audit our own project's license without any network.
    if (fs.existsSync(repo)) {
      const pkgPath = path.join(repo, "package.json");
      let spdx: string | null = null;
      if (fs.existsSync(pkgPath)) {
        try {
          spdx = (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { license?: string }).license ?? null;
        } catch {
          spdx = null;
        }
      }
      const verdict = classifyLicense(spdx);
      return {
        repo,
        license: verdict,
        architectureNotes: ["local project audit: license inferred from package.json"],
        cleanRoomSpec: { required: false, spec: [], originalCodePrompt: "" },
        similarity: { jaccard: 0, threshold, pass: true, sampledFiles: 0 },
        latencyMs: round(Date.now() - started, 3),
      };
    }

    const match = repo.match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (!match) throw new Error(`cannot parse repo reference: ${repo}`);
    const [, owner, name] = match;

    let meta: RepoMeta | null = null;
    try {
      const raw = await fetchJson<{
        full_name: string;
        description: string | null;
        topics?: string[];
        language: string | null;
        stargazers_count: number;
        license: { spdx_id?: string } | null;
      }>(`https://api.github.com/repos/${owner}/${name}`, this.deps.githubToken);
      meta = {
        fullName: raw.full_name,
        description: raw.description,
        topics: raw.topics ?? [],
        language: raw.language,
        stars: raw.stargazers_count,
        spdx: raw.license?.spdx_id ?? null,
        hasLicenseFile: Boolean(raw.license),
      };
    } catch (error) {
      log.warn(`github metadata fetch failed for ${owner}/${name}: ${String(error)}`);
    }

    const verdict = classifyLicense(meta?.spdx ?? null);
    const readme = verdict.copyAllowed ? null : await fetchReadme(owner, name, this.deps.githubToken);

    // Clean-room abstraction: metadata only, never source text.
    const abstraction = await this.deps.llm.chatJson<{ notes: string[]; spec: string[] }>(
      [
        {
          role: "system",
          content:
            "You are a clean-room architect. You must NEVER reproduce code. You only abstract design patterns " +
            "from metadata. Reply with one JSON object.",
        },
        {
          role: "user",
          content:
            `Repository: ${owner}/${name}\nDescription: ${meta?.description ?? "(unavailable)"}\n` +
            `Topics: ${(meta?.topics ?? []).join(", ") || "(none)"}\nLanguage: ${meta?.language ?? "(unknown)"}\n` +
            `License: ${verdict.spdx}\nREADME excerpt (for intent only, do not copy wording):\n` +
            `${(readme ?? "(unavailable)").slice(0, 3000)}\n` +
            `Reply as {"notes": string[], "spec": string[]}: 3-6 abstract design-pattern notes and 4-8 requirements ` +
            `for an ORIGINAL implementation that satisfies the same user need with different structure and naming.`,
        },
      ],
      () => ({
        notes: [
          "Metadata-only abstraction: infer module boundaries from the public description.",
          "Re-express every capability with original naming, structure and tests.",
          "Do not open, copy or paraphrase source files from the upstream repository.",
        ],
        spec: [
          `Deliver the same user-facing capability as ${owner}/${name} with original architecture and naming.`,
          "Define your own schemas; no identifiers copied from upstream.",
          "Write tests that pin your behavior, not upstream behavior.",
          "Document the API from scratch based on the requirement list, not on upstream docs.",
        ],
      }),
    );

    const specText = abstraction.value.spec.join("\n");
    const jaccard = readme ? ngramJaccard(specText, readme) : 0;

    return {
      repo: meta?.fullName ?? `${owner}/${name}`,
      license: verdict,
      architectureNotes: abstraction.value.notes.slice(0, 8),
      cleanRoomSpec: {
        required: !verdict.copyAllowed,
        spec: abstraction.value.spec.slice(0, 10),
        originalCodePrompt:
          `Write a NEW, original implementation that satisfies these requirements:\n` +
          `${abstraction.value.spec.map((s) => `- ${s}`).join("\n")}\n` +
          `Constraints: no code, identifiers, comments or doc text from any GPL/AGPL/proprietary source may appear. ` +
          `Language conventions and the license of this repository apply.`,
      },
      similarity: {
        jaccard: round(jaccard, 4),
        threshold,
        pass: jaccard < threshold,
        sampledFiles: readme ? 1 : 0,
      },
      latencyMs: round(Date.now() - started, 3),
    };
  }
}

