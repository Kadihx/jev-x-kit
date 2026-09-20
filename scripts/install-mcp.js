#!/usr/bin/env node
/**
 * One-click MCP registration for Claude Desktop, Cursor and Continue.dev.
 *
 * Detects each app's config file, merges (never overwrites unrelated
 * entries) a `jev-super-agent` MCP server pointing at this repo's
 * `dist/index.js`, and backs up the original file to `<file>.bak` before
 * writing. Safe to re-run.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const entryPoint = join(repoRoot, "dist", "index.js");

const SERVER_ENTRY = {
  command: "node",
  args: [entryPoint],
  env: { JEV_BACKEND_PROVIDER: "auto" },
};

function claudeDesktopConfigPath() {
  const os = platform();
  if (os === "darwin") return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (os === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

const targets = [
  { name: "Claude Desktop", file: claudeDesktopConfigPath(), key: "mcpServers" },
  { name: "Cursor", file: join(homedir(), ".cursor", "mcp.json"), key: "mcpServers" },
  { name: "Continue.dev", file: join(homedir(), ".continue", "config.json"), key: "mcpServers" },
];

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

let changed = 0;
for (const target of targets) {
  const dir = dirname(target.file);
  const appLikelyInstalled = existsSync(dir);
  const existing = readJson(target.file);

  if (!appLikelyInstalled && existing === null) {
    console.log(`skip  ${target.name}: not found (${target.file})`);
    continue;
  }

  const config = existing ?? {};
  config[target.key] = config[target.key] ?? {};

  const already = JSON.stringify(config[target.key]["jev-super-agent"]) === JSON.stringify(SERVER_ENTRY);
  if (already) {
    console.log(`ok    ${target.name}: already registered`);
    continue;
  }

  if (existing) {
    copyFileSync(target.file, `${target.file}.bak`);
  } else {
    mkdirSync(dir, { recursive: true });
  }

  config[target.key]["jev-super-agent"] = SERVER_ENTRY;
  writeFileSync(target.file, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log(`added ${target.name}: ${target.file}${existing ? " (backup: " + target.file + ".bak)" : " (created)"}`);
  changed++;
}

if (!existsSync(entryPoint)) {
  console.log(`\nwarning: ${entryPoint} does not exist yet — run "npm run build" first.`);
}

console.log(`\n${changed} config file(s) updated. Restart the app(s) for the MCP server to load.`);
