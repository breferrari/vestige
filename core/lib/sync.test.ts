/**
 * The sync path had no tests, which is how it came to walk two directories that
 * had not existed since the store moved: it found nothing, pushed nothing, and
 * exited 0. A sync over an empty directory reports exactly what a session with
 * no memories reports.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SYNC = join(import.meta.dirname, "sync.ts");
let home: string, store: string, remote: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const runSync = (env: Record<string, string> = {}) =>
	execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", SYNC, "push"], {
		cwd: store, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, VESTIGE_HOME: home, ...env },
	});

const memory = (name: string, body = "A lesson worth keeping, stated as a claim with enough context to act on.") =>
	writeFileSync(join(store, `${name}.md`), `---\nscope: project\nprojects: ["r"]\nconfidence: inferred\n---\n\n# ${name}\n\n**Applies to:** r\n\n${body}\n`);

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "sync-home-"));
	remote = mkdtempSync(join(tmpdir(), "sync-remote-"));
	execFileSync("git", ["init", "-q", "--bare", remote]);
	// The default config's `personal` store resolves against VESTIGE_HOME, so
	// this is the path the CONFIGURATION points at — not a path this test picked.
	store = join(home, "memories");
	mkdirSync(store, { recursive: true });
	git(store, "init", "-q", "-b", "main");
	git(store, "config", "user.email", "t@t");
	git(store, "config", "user.name", "t");
	git(store, "remote", "add", "origin", remote);
	memory("seed");
	git(store, "add", "-A");
	git(store, "commit", "-qm", "seed");
	git(store, "push", "-q", "-u", "origin", "main");
});

const remoteFiles = () => git(remote, "ls-tree", "--name-only", "main").split("\n").filter(Boolean);

describe("the store it syncs", () => {
	test("is the one the configuration points at", () => {
		memory("a-new-lesson");
		runSync();
		assert.ok(remoteFiles().includes("a-new-lesson.md"), "sync must operate on the configured store, not a hardcoded path");
	});
});

describe("modes", () => {
	test("auto pushes additions", () => {
		memory("added-in-auto");
		runSync();
		assert.ok(remoteFiles().includes("added-in-auto.md"));
	});

	test("auto parks deletions — removing for yourself is not removing for the team", () => {
		rmSync(join(store, "seed.md"));
		runSync();
		assert.ok(remoteFiles().includes("seed.md"), "a local delete must not reach the shared store by default");
	});

	test("review pushes NOTHING, including additions", () => {
		memory("proposed-under-review");
		const out = runSync({ VESTIGE_SYNC: "review" });
		assert.ok(!remoteFiles().includes("proposed-under-review.md"), "review mode must not publish an addition");
		assert.match(out, /awaiting review/i, "the proposals are invisible unless it says so");
	});

	test("review leaves the proposal in the working tree for approval", () => {
		memory("proposed-under-review");
		runSync({ VESTIGE_SYNC: "review" });
		assert.ok(existsSync(join(store, "proposed-under-review.md")), "review holds the write back; it must never discard it");
	});

	test("full publishes deletions, for the person actually running an audit", () => {
		rmSync(join(store, "seed.md"));
		runSync({ VESTIGE_SYNC: "full" });
		assert.ok(!remoteFiles().includes("seed.md"));
	});
});
