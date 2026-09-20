/** Filesystem helpers: repo root discovery + artifact directories. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedRoot: string | null = null;

/** Walk up from this file until a package.json is found. */
export function findRepoRoot(startDir?: string): string {
  if (cachedRoot) return cachedRoot;
  let dir = startDir ?? path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedRoot = startDir ?? process.cwd();
  return cachedRoot;
}

export function presetsDir(): string {
  return path.join(findRepoRoot(), "presets");
}

/** Scratch space for datasets, reports and training artifacts. */
export function artifactsDir(sub?: string): string {
  const dir = path.join(findRepoRoot(), "artifacts", ...(sub ? [sub] : []));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Atomic JSON write (tmp file + rename) so concurrent agents never corrupt state. */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function writeLinesAtomic(file: string, lines: string[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, lines.join("\n") + "\n", "utf8");
  fs.renameSync(tmp, file);
}
