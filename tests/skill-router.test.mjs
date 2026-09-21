import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { discoverInstalledSkills, discoverCatalogSkills, SkillRouter } = await import(
  "../dist/modules/jev-skill-router.js"
);

function mkSkill(dir, name, description) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf8",
  );
}

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jev-skill-router-home-"));
}

test("discoverInstalledSkills finds project + user + plugin skills and dedups by name", () => {
  const home = tmpHome();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "jev-skill-router-project-"));
  mkSkill(path.join(cwd, ".claude", "skills", "proj-skill"), "proj-skill", "Handles project-local things");
  mkSkill(path.join(home, ".claude", "skills", "user-skill"), "user-skill", "Handles user-level things");
  mkSkill(
    path.join(home, ".claude", "plugins", "cache", "mp", "plugin-a", "1.0.0", "skills", "cached-skill"),
    "cached-skill",
    "Lives under the plugin cache tree",
  );
  // Malformed SKILL.md (no frontmatter) must be skipped, not crash the scan.
  fs.mkdirSync(path.join(home, ".claude", "skills", "broken"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "skills", "broken", "SKILL.md"), "no frontmatter here", "utf8");

  const { entries, scannedDirs } = discoverInstalledSkills({ cwd, home });

  assert.ok(entries.some((e) => e.name === "proj-skill" && e.source === "project"));
  assert.ok(entries.some((e) => e.name === "user-skill" && e.source === "user"));
  assert.ok(entries.some((e) => e.name === "cached-skill" && e.source === "plugin-cache"));
  assert.ok(!entries.some((e) => e.name === "broken"));
  assert.ok(scannedDirs.length >= 3);
});

test("discoverCatalogSkills reads a local marketplace.json, excludes installed names, stays offline without `online`", async () => {
  const home = tmpHome();
  const mpDir = path.join(home, ".claude", "plugins", "marketplaces", "testmp", ".claude-plugin");
  fs.mkdirSync(mpDir, { recursive: true });
  fs.writeFileSync(
    path.join(mpDir, "marketplace.json"),
    JSON.stringify({
      name: "testmp",
      plugins: [
        { name: "already-installed", description: "should be excluded" },
        { name: "new-plugin", description: "a plugin nobody has installed yet", homepage: "https://example.com" },
      ],
    }),
    "utf8",
  );

  const { entries, usedRemoteCatalog } = await discoverCatalogSkills(new Set(["already-installed"]), { home });

  assert.equal(usedRemoteCatalog, false);
  assert.ok(!entries.some((e) => e.name === "already-installed"));
  const found = entries.find((e) => e.name === "new-plugin");
  assert.ok(found);
  assert.equal(found.marketplace, "testmp");
  assert.equal(found.viaRemoteFallback, false);
});

test("discoverCatalogSkills returns empty + no network attempt when nothing local and online is not set", async () => {
  const home = tmpHome(); // no .claude/plugins/marketplaces at all
  const { entries, usedRemoteCatalog } = await discoverCatalogSkills(new Set(), { home });
  assert.deepEqual(entries, []);
  assert.equal(usedRemoteCatalog, false);
});

function fakeBackend(scoreFor) {
  return {
    meta: { id: "fake", label: "fake", pricePerMillionUsd: 0, outputTokenCostUsd: 0, local: true, synthetic: true },
    health: async () => true,
    choice: async () => {
      throw new Error("not used");
    },
    score: async () => {
      throw new Error("not used");
    },
    noul: async () => {
      throw new Error("not used");
    },
    batch: async (requests) =>
      requests.map((r, i) => ({
        id: String(i),
        kind: "score",
        question: r.question,
        backend: "fake",
        latencyMs: 0,
        usage: { inputTokens: 0, costUsd: 0, pricePerMillionUsd: 0 },
        schemaValid: true,
        synthetic: true,
        min: 1,
        max: 10,
        score: scoreFor(r.state ?? ""),
        confidence: 1,
        signals: [],
      })),
  };
}

test("SkillRouter.route ranks a clearly-best skill into the execute zone", async () => {
  const home = tmpHome();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "jev-skill-router-project2-"));
  mkSkill(
    path.join(cwd, ".claude", "skills", "redteam-helper"),
    "redteam-helper",
    "sanity-check and stress-test a plan before executing it",
  );
  mkSkill(path.join(cwd, ".claude", "skills", "unrelated"), "unrelated", "generate marketing emojis for social posts");

  const backend = fakeBackend((state) => (state.includes("redteam-helper") ? 9.5 : 2));
  const router = new SkillRouter({ backend });
  const report = await router.route("sanity-check my plan before I run it", { cwd, home, limit: 2 });

  assert.equal(report.zone, "execute");
  assert.equal(report.matches[0].entry.name, "redteam-helper");
  assert.equal(report.usedRemoteCatalog, false);
  assert.ok(report.latencyMs >= 0);
});
