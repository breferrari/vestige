/**
 * Finding memories that state one claim three times.
 *
 * The risk in this feature is not missing a cluster — the store was going to
 * keep both anyway. It is proposing a false one, because a reader who rejects
 * three bad proposals stops reading the fourth.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

let home: string, repo: string;
const api = async () => await import(`./vestige.ts?${Math.random()}`);
const clusters = async (opts = {}) => (await import(`./consolidate.ts?${Math.random()}`)).findClusters({ cwd: repo, ...opts });

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "cons-home-"));
	repo = mkdtempSync(join(tmpdir(), "cons-repo-"));
	process.env.VESTIGE_HOME = home;
	execFileSync("git", ["init", "-q", repo]);
});

const write = async (title: string, body: string) => {
	const { remember } = await api();
	const r = await (await api()).remember({ title, body, scope: "project", projects: [basename(repo)], confidence: "inferred" }, { cwd: repo });
	assert.equal(r.ok, true, r.errors?.join("; "));
	return r;
};

const RETRY_A = "Retrying a failed push immediately synchronises every writer, because they all wake on the same schedule and collide again. Full jitter spreads the wake-ups.";
const RETRY_B = "Writers that retry a push on a fixed schedule collide repeatedly, since every writer wakes at the same moment. Jitter on the retry delay spreads them apart.";
const CACHE   = "Cache invalidation keyed on a timestamp misses a rewrite inside the same second, so key the cache on the content hash instead of the modification time.";

describe("clustering", () => {
	test("two statements of one lesson are proposed together", async () => {
		await write("Retry with full jitter", RETRY_A);
		await write("Spread retries with jitter", RETRY_B);
		const c = await clusters();
		assert.equal(c.length, 1, "the same lesson twice is exactly what consolidation is for");
		assert.equal(c[0].members.length, 2);
	});

	test("unrelated memories are NOT clustered", async () => {
		await write("Retry with full jitter", RETRY_A);
		await write("Key caches on content", CACHE);
		const c = await clusters();
		assert.equal(c.length, 0, "a reader who rejects false proposals stops reading them");
	});

	test("a proposal shows the vocabulary it was grouped on", async () => {
		await write("Retry with full jitter", RETRY_A);
		await write("Spread retries with jitter", RETRY_B);
		const [first] = await clusters();
		assert.ok(first.shared.length > 0, "an unexplained grouping cannot be rejected quickly, only argued with");
		assert.ok(first.shared.some((w: string) => /retr|jitter|writer|collide|wake/.test(w)), `expected the shared words to be the reason: ${first.shared.join(", ")}`);
		assert.ok(first.score > 0 && first.score <= 1);
	});

	test("a lone memory is never a cluster", async () => {
		await write("Key caches on content", CACHE);
		assert.deepEqual(await clusters(), []);
	});

	test("it proposes and never writes — the store is unchanged", async () => {
		const a = await write("Retry with full jitter", RETRY_A);
		const b = await write("Spread retries with jitter", RETRY_B);
		const { readFileSync } = await import("node:fs");
		const before = [a, b].map((r) => readFileSync(join(r.store, r.rel), "utf8"));
		await clusters();
		const after = [a, b].map((r) => readFileSync(join(r.store, r.rel), "utf8"));
		assert.deepEqual(after, before, "what the shared claim IS is a judgement a similarity score cannot make");
	});
});
