/**
 * Importing an existing pile.
 *
 * The failure this exists to prevent is silent and team-wide: a memory the team
 * deleted on purpose is still sitting in this checkout, and a blind copy-in
 * republishes it for everybody with no sign that anything happened.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = join(import.meta.dirname, "import.mjs");
let home, src, store;

const run = (...args) => execFileSync(process.execPath, [TOOL, src, ...args], {
	cwd: store, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
	env: { ...process.env, VESTIGE_HOME: home },
});
const memory = (dir, name, body = "A lesson stated as a claim, with enough context for a reader who was not there.") =>
	writeFileSync(join(dir, `${name}.md`), `---\nscope: project\nprojects: ["r"]\nconfidence: inferred\n---\n\n# ${name}\n\n**Applies to:** r\n\n${body}\n`);

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "imp-home-"));
	src = mkdtempSync(join(tmpdir(), "imp-src-"));
	// The default `personal` store resolves against VESTIGE_HOME.
	store = join(home, "memories");
	mkdirSync(store, { recursive: true });
	execFileSync("git", ["init", "-q", "-b", "main", store]);
	execFileSync("git", ["config", "user.email", "t@t"], { cwd: store });
	execFileSync("git", ["config", "user.name", "t"], { cwd: store });
});
const inStore = () => readdirSync(store).filter((f) => f.endsWith(".md"));

describe("dry run", () => {
	test("writes nothing by default", () => {
		memory(src, "a-lesson");
		const out = run();
		assert.match(out, /dry run/i);
		assert.equal(inStore().length, 0, "a default that writes is a default that surprises");
	});
	test("--apply copies it in, and leaves the source alone", () => {
		memory(src, "a-lesson");
		run("--apply");
		assert.deepEqual(inStore(), ["a-lesson.md"]);
		assert.ok(existsSync(join(src, "a-lesson.md")), "copy, never move: a bad import must be undone by deleting the destination");
	});
});

describe("the deleted stay deleted", () => {
	test("a file the store's history deleted is HELD BACK, not imported", () => {
		// The memory existed in the store, and was deliberately removed.
		memory(store, "retired-lesson");
		execFileSync("git", ["add", "-A"], { cwd: store });
		execFileSync("git", ["commit", "-qm", "add"], { cwd: store });
		execFileSync("git", ["rm", "-q", "retired-lesson.md"], { cwd: store });
		execFileSync("git", ["commit", "-qm", "remove: superseded"], { cwd: store });

		// The same file is still sitting in the old pile.
		memory(src, "retired-lesson");
		memory(src, "a-live-lesson");
		const out = run("--apply");

		assert.ok(!inStore().includes("retired-lesson.md"), "importing it would republish a deliberate deletion for everyone");
		assert.match(out, /HELD BACK/);
		assert.match(out, /remove: superseded/, "the holdback must name the commit that removed it, or it cannot be judged");
		assert.ok(inStore().includes("a-live-lesson.md"), "one held-back file must not stop the clean ones");
	});
});

describe("collisions and contamination", () => {
	test("an existing name is suffixed, never overwritten", () => {
		memory(store, "same-name", "The version already in the store.");
		memory(src, "same-name", "A different lesson that happens to share a title.");
		run("--apply");
		assert.deepEqual(inStore().sort(), ["same-name (2).md", "same-name.md"]);
	});
	test("a secret in the old pile is held back, not imported", () => {
		writeFileSync(join(src, "leaky.md"), `---\nscope: project\n---\n\n# leaky\n\nUse token ghp_ZmFrZXRva2VuZm9ydGVzdGluZzEyMzQ1Njc4 to reach it.\n`);
		const out = run("--apply");
		assert.equal(inStore().length, 0);
		assert.match(out, /content gate/i, "a pile assembled before anyone was scanning is the likeliest place for a credential");
	});
});
