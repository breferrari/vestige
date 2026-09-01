/**
 * Usefulness, and where each signal is allowed to live.
 *
 * Retrieval is per-reader and frequent; confirmation is evidence about the
 * claim. Putting the first in the memory would turn a store people review in
 * pull requests into a telemetry stream and leak who reads what; keeping the
 * second out of it would waste the strongest thing anyone can say.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

let home: string, repo: string;
const api = async () => await import(`./vestige.ts?${Math.random()}`);
const body = "Retries without jitter synchronise and defeat the backoff, because every writer wakes on the same schedule.";

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "use-home-"));
	repo = mkdtempSync(join(tmpdir(), "use-repo-"));
	process.env.VESTIGE_HOME = home;
	execFileSync("git", ["init", "-q", repo]);
});

// Scope to the repository the caller actually is. A memory named for some
// other project is correctly invisible here, and recall then has nothing to
// log — which looks exactly like logging being broken.
const write = async (title: string) => {
	const { remember } = await api();
	return remember({ title, body, scope: "project", projects: [basename(repo)], confidence: "inferred" }, { cwd: repo });
};

describe("retrieval is local and never touches the store", () => {
	test("recall logs what it showed, and changes no memory file", async () => {
		const { recall } = await api();
		const r = await write("Use full jitter on retry");
		const before = readFileSync(join(r.store, r.rel), "utf8");
		recall({ cwd: repo });
		assert.equal(readFileSync(join(r.store, r.rel), "utf8"), before, "a search must not rewrite the file it found");
		const log = JSON.parse(readFileSync(join(home, "usage.json"), "utf8"));
		assert.ok(Object.keys(log).length > 0, "and it must still be recorded somewhere");
	});
	test("the log lives outside every store, so it is never synced", async () => {
		const { recall } = await api();
		const r = await write("Bound the retry attempts");
		recall({ cwd: repo });
		assert.ok(!readdirSync(r.store).includes("usage.json"), "per-reader telemetry in a shared store leaks who reads what");
	});
});

describe("confirmation is evidence and goes in the memory", () => {
	test("confirming records a count the next reader can see", async () => {
		const { confirm } = await api();
		const r = await write("Checkpoint between partitions");
		const c = confirm(r.rel, { cwd: repo });
		assert.equal(c.ok, true, c.detail);
		assert.match(readFileSync(join(r.store, r.rel), "utf8"), /^confirmed_count: 1$/m);
	});
	test("confirming twice in a day from one project counts once", async () => {
		const { confirm } = await api();
		const r = await write("Key caches on content");
		confirm(r.rel, { cwd: repo });
		const second = confirm(r.rel, { cwd: repo });
		assert.equal(second.count, 1, "a number that inflates on repetition stops meaning anything");
		const text = readFileSync(join(r.store, r.rel), "utf8");
		assert.equal((text.match(/confirmed_count:/g) ?? []).length, 1);
	});
	test("confirming something that does not exist fails loudly", async () => {
		const { confirm } = await api();
		await write("Something else entirely");
		const c = confirm("no-such-memory.md", { cwd: repo });
		assert.equal(c.ok, false);
		assert.match(c.detail, /no visible memory/i);
	});
});

describe("usefulness only breaks ties", () => {
	test("an unconfirmed, never-retrieved memory is not penalised into nothing", async () => {
		const { usefulnessBonus } = await import(`./usage.ts?${Math.random()}`);
		assert.equal(usefulnessBonus("x", 0, {}), 0, "never-retrieved is not useless — a memory nobody has needed yet is what a store is for");
	});
	test("the bonus is capped, so popularity cannot outrank relevance", async () => {
		const { usefulnessBonus } = await import(`./usage.ts?${Math.random()}`);
		const many = usefulnessBonus("x", 99, { x: { retrieved: 500, last: "2026-09-01" } });
		assert.ok(many <= 8, `expected a bounded nudge, got ${many}`);
	});
});

describe("the usefulness signal has to discriminate", () => {
	/**
	 * `search` uses `recall` as its candidate pool at limit 500. Logging inside
	 * recall marked EVERY visible memory as retrieved on every query, and
	 * usefulness then rated the whole store useful. A signal that fires for all
	 * rows is not a signal.
	 *
	 * The test calls NOTHING but search. An earlier version established its
	 * baseline with `recall({ noteUse: false })` — the same flag under test — so
	 * with the bug restored the baseline was inflated too and the delta was
	 * always zero. A probe that shares a switch with its subject measures the
	 * switch, not the subject.
	 */
	test("one search marks only what it returned, not the whole visible set", async () => {
		const { search } = await api();
		for (const t of ["Retry with full jitter", "Bound the retry attempts", "Key caches on content", "Batch by partition", "Checkpoint between batches"]) await write(t);

		const { readFileSync, existsSync } = await import("node:fs");
		const logFile = join(home, "usage.json");
		assert.equal(existsSync(logFile), false, "writing must not log a retrieval; the baseline depends on it");

		const r = await search("retry jitter", { cwd: repo, limit: 2 });
		const logged = Object.keys(JSON.parse(readFileSync(logFile, "utf8")));

		assert.ok(r.hits.length <= 2, `limit should cap the hits, got ${r.hits.length}`);
		assert.equal(logged.length, r.hits.length, `search returned ${r.hits.length} memories but logged ${logged.length} — the candidate pool is leaking into the signal`);
	});
});
