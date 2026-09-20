/**
 * Multi-domain preset library loader (blueprint §4).
 * Presets are plain JSON data kits: rules, red flags, checklists and scoring
 * rubrics injected verbatim into Jev `state` and System-2 prompts.
 */

import fs from "node:fs";
import path from "node:path";
import { presetsDir, readJsonFile } from "./paths.js";
import { log } from "./log.js";

export interface Preset {
  id: string;
  title: string;
  domain: string;
  version: number;
  rules: string[];
  redFlags: string[];
  checklist: string[];
  scoringRubric: Record<string, string>;
}

export interface PresetDescriptor {
  id: string;
  file: string;
  title: string;
  domain: string;
}

export const PRESET_FILES: PresetDescriptor[] = [
  {
    id: "software-architecture",
    file: "preset-software-architecture.json",
    title: "Software Architecture & Engineering",
    domain: "software",
  },
  {
    id: "marketing-growth",
    file: "preset-marketing-growth.json",
    title: "Marketing, Launch & Growth",
    domain: "marketing",
  },
  {
    id: "product-ux",
    file: "preset-product-ux.json",
    title: "Product, UX & Generative UI",
    domain: "product",
  },
  {
    id: "cost-model-router",
    file: "preset-cost-model-router.json",
    title: "Cost Model & Router Matrix",
    domain: "finance-ops",
  },
  {
    id: "cybersecurity",
    file: "preset-cybersecurity.json",
    title: "Cybersecurity & Pen-Test Matrix",
    domain: "security",
  },
  {
    id: "legal-compliance",
    file: "preset-legal-compliance.json",
    title: "Legal, License & Compliance (KVKK/GDPR)",
    domain: "legal",
  },
  {
    id: "finance-valuation",
    file: "preset-finance-valuation.json",
    title: "Finance, Unit Economics & Valuation",
    domain: "finance",
  },
];

export function listPresets(): Array<PresetDescriptor & { available: boolean }> {
  return PRESET_FILES.map((descriptor) => ({
    ...descriptor,
    available: fs.existsSync(path.join(presetsDir(), descriptor.file)),
  }));
}

export function loadPreset(id: string): Preset | null {
  const descriptor = PRESET_FILES.find((p) => p.id === id || p.file.includes(id));
  if (!descriptor) {
    log.warn(`unknown preset: ${id}`);
    return null;
  }
  return readJsonFile<Preset>(path.join(presetsDir(), descriptor.file));
}

/** Flatten preset knowledge into ordered `state` lines for Jev evaluation. */
export function presetStateLines(id: string, max = 12): string[] {
  const preset = loadPreset(id);
  if (!preset) return [];
  const lines = [
    `preset: ${preset.title} (${preset.domain})`,
    ...preset.rules.slice(0, Math.max(1, Math.floor(max / 2))).map((r) => `rule: ${r}`),
    ...preset.redFlags.slice(0, Math.max(1, Math.floor(max / 3))).map((r) => `red-flag: ${r}`),
    ...preset.checklist.slice(0, Math.max(0, max - Math.floor(max / 2) - Math.floor(max / 3))).map((c) => `check: ${c}`),
  ];
  return lines.slice(0, max);
}
