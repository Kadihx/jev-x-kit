/**
 * Zero-dependency .env loader.
 *
 * Nothing in this codebase previously read `.env` at all — `loadConfig()`
 * only ever read `process.env` directly, so every documented `.env.example`
 * setting silently required a real shell export to take effect. Reads
 * KEY=VALUE lines from `.env` in the current working directory and injects
 * them into `process.env`, but only for keys not already set — real shell
 * exports and CI secrets always win over the file.
 */

import fs from "node:fs";
import path from "node:path";

let loaded = false;

export function loadDotEnv(file: string = path.join(process.cwd(), ".env")): void {
  if (loaded) return;
  loaded = true;

  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
