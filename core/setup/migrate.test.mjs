import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATE = join(dirname(fileURLToPath(import.meta.url)), "migrate.mjs");
const run = (cwd, env, apply) => execFileSync(process.execPath,
  ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", MIGRATE, ...(apply ? ["--apply"] : [])],
  // CLAUDE_PROJECT_DIR is set inside a Claude Code session and the script
  // prefers it over cwd — so without clearing it, every one of these tests
  // silently ran against the developer's real vault instead of the fixture.
  { cwd, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env }, stdio: ["ignore", "pipe", "pipe"] });

function setup() {
  const home = mkdtempSync(join(tmpdir(), "mig-home-"));
  const repo = join(mkdtempSync(join(tmpdir(), "mig-")), "migrepo");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  return { home, repo, env: { VESTIGE_HOME: home, VESTIGE_NO_UPDATE: "1" } };
}
const write = (dir, name, scope, body = "A retried mutation must carry an idempotency key or the ledger double counts the second attempt.") => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `---\nscope: ${scope}\nprojects: []\nsource: mcp-capture\n---\n\n# ${name.replace(/\.md$/, "")}\n\n**Applies to:** all\n\n${body}\n`);
};

describe("migration", () => {
  test("dry run is the default and moves nothing", () => {
    const { home, repo, env } = setup();
    const personal = join(home, "memories");
    write(personal, "_general__Wide.md", "general");
    mkdirSync(join(repo, ".vestige"), { recursive: true });
    writeFileSync(join(repo, ".vestige", "config.json"), JSON.stringify({ stores: [
      { name: "team", kind: "local", path: join(home, "team"), accepts: ["general", "platform"] },
      { name: "personal", kind: "local", path: "memories", accepts: ["*"] },
    ] }));
    const out = run(repo, env, false);
    assert.match(out, /personal -> team/);
    assert.match(out, /Dry run/);
    assert.ok(existsSync(join(personal, "_general__Wide.md")), "dry run must not move anything");
  });

  test("--apply moves it, and the original is gone only after the copy verifies", () => {
    const { home, repo, env } = setup();
    const personal = join(home, "memories");
    write(personal, "_general__Wide.md", "general");
    mkdirSync(join(repo, ".vestige"), { recursive: true });
    writeFileSync(join(repo, ".vestige", "config.json"), JSON.stringify({ stores: [
      { name: "team", kind: "local", path: join(home, "team"), accepts: ["general", "platform"] },
      { name: "personal", kind: "local", path: "memories", accepts: ["*"] },
    ] }));
    run(repo, env, true);
    assert.equal(existsSync(join(personal, "_general__Wide.md")), false, "original should be gone");
    assert.equal(existsSync(join(home, "team", "_general__Wide.md")), true, "should be in the team store");
  });

  test("a name already taken at the destination is suffixed, never overwritten", () => {
    const { home, repo, env } = setup();
    write(join(home, "memories"), "_general__Wide.md", "general", "INCOMING body long enough to satisfy any length floor here.");
    write(join(home, "team"), "_general__Wide.md", "general", "EXISTING body long enough to satisfy any length floor here.");
    mkdirSync(join(repo, ".vestige"), { recursive: true });
    writeFileSync(join(repo, ".vestige", "config.json"), JSON.stringify({ stores: [
      { name: "team", kind: "local", path: join(home, "team"), accepts: ["general", "platform"] },
      { name: "personal", kind: "local", path: "memories", accepts: ["*"] },
    ] }));
    run(repo, env, true);
    const files = readdirSync(join(home, "team")).sort();
    assert.equal(files.length, 2, `both must survive, got ${files}`);
    const bodies = files.map((f) => readFileSync(join(home, "team", f), "utf8"));
    assert.ok(bodies.some((b) => b.includes("EXISTING")), "the existing memory must not be overwritten");
    assert.ok(bodies.some((b) => b.includes("INCOMING")), "the incoming memory must land");
  });

  test("running it twice is a no-op", () => {
    const { home, repo, env } = setup();
    write(join(home, "memories"), "_general__Wide.md", "general");
    mkdirSync(join(repo, ".vestige"), { recursive: true });
    writeFileSync(join(repo, ".vestige", "config.json"), JSON.stringify({ stores: [
      { name: "team", kind: "local", path: join(home, "team"), accepts: ["general", "platform"] },
      { name: "personal", kind: "local", path: "memories", accepts: ["*"] },
    ] }));
    run(repo, env, true);
    const second = run(repo, env, true);
    assert.match(second, /already in the store its reach implies/);
    assert.equal(readdirSync(join(home, "team")).length, 1, "a second run must not duplicate");
  });
});
