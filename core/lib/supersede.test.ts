/**
 * Superseding, cross-linking, and genre.
 *
 * The failure these close is a store that fills with twins: when the only way
 * to record a better version of a lesson is to write it again, the pool grows
 * two documents that disagree and retrieval has to pick one.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string, repo: string;
const remember = async (input: Record<string, unknown>) => {
	const { remember: r } = await import(`./vestige.ts?${Math.random()}`);
	return r(input, { cwd: repo });
};

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "sup-home-"));
	repo = mkdtempSync(join(tmpdir(), "sup-repo-"));
	process.env.VESTIGE_HOME = home;
	execFileSync("git", ["init", "-q", repo]);
});

const body = "Retries without jitter synchronise and defeat the backoff, because every writer wakes on the same schedule and collides again.";
// Read the store the WRITE reports, not a guessed path: routing decides where a
// memory lands, and asserting against the wrong directory reports "deleted" for
// a memory that was written correctly somewhere else.
let store = "";
const poolFiles = () => { try { return readdirSync(store).filter((f) => f.endsWith(".md")); } catch { return []; } };
const readPoolFile = (f: string) => readFileSync(join(store, f), "utf8");
const write = async (input: Record<string, unknown>) => { const r = await remember(input); if (r.store) store = r.store; return r; };

describe("genre", () => {
	test("kind is recorded, and defaults rather than refusing", async () => {
		const a = await write({ title: "Use full jitter on retry", body, scope: "project", projects: ["r"], confidence: "inferred", kind: "decision" });
		const b = await write({ title: "Bound the retry attempts", body, scope: "project", projects: ["r"], confidence: "inferred" });
		assert.equal(a.ok, true, a.errors?.join("; "));
		assert.match(readPoolFile(a.rel), /^kind: decision$/m);
		assert.match(readPoolFile(b.rel), /^kind: learning$/m, "an omitted genre must default, never refuse");
	});
	test("an unknown genre falls back instead of losing the memory", async () => {
		const r = await write({ title: "Cache by content hash", body, scope: "project", projects: ["r"], confidence: "inferred", kind: "nonsense" });
		assert.equal(r.ok, true, "a write must not fail over a label — the label is the least valuable thing in it");
		assert.match(readPoolFile(r.rel), /^kind: learning$/m);
	});
});

describe("supersede", () => {
	test("the old memory is marked and KEPT, not deleted", async () => {
		const old = await write({ title: "Retry immediately on conflict", body, scope: "project", projects: ["r"], confidence: "inferred" });
		const before = poolFiles().length;
		const next = await write({ title: "Retry with full jitter on conflict", body, scope: "project", projects: ["r"], confidence: "inferred", supersedes: [old.rel] });
		assert.deepEqual(next.superseded, [old.rel], "the reference must resolve");
		assert.equal(poolFiles().length, before + 1, "superseding must not delete: what was believed then is evidence that it changed");
		assert.match(readPoolFile(old.rel), /superseded_by/i);
	});
	test("a reference that resolves to nothing does not fail the write", async () => {
		const r = await write({ title: "Checkpoint between partitions", body, scope: "project", projects: ["r"], confidence: "inferred", supersedes: ["a memory that was never written"] });
		assert.equal(r.ok, true, "losing a memory to protect a link is the wrong trade");
		assert.deepEqual(r.superseded, []);
	});
});

describe("related", () => {
	test("the link is written on BOTH files", async () => {
		const first = await write({ title: "Batch by partition", body, scope: "project", projects: ["r"], confidence: "inferred" });
		const second = await write({ title: "Checkpoint after each batch", body, scope: "project", projects: ["r"], confidence: "inferred", related: [first.rel] });
		assert.deepEqual(second.linked, [first.rel]);
		assert.match(readPoolFile(second.rel), /^related: \[/m, "the new memory names the old one");
		assert.match(readPoolFile(first.rel), /Checkpoint after each batch/, "a one-way link is invisible from the side that needs it");
	});
});

describe("ambiguous references", () => {
	/**
	 * The loose match used to take whichever file sorted first, on a write that
	 * reported success. Marking the WRONG memory superseded is worse than marking
	 * none: the stale one stays live, a good one sinks, and the output says
	 * neither. Refusing is the only safe answer when the reference fits two.
	 */
	test("a reference matching two memories marks NEITHER, and says so", async () => {
		await write({ title: "Retry with jitter on write conflicts", body, scope: "project", projects: ["r"], confidence: "inferred" });
		await write({ title: "Retry with a bounded attempt count", body, scope: "project", projects: ["r"], confidence: "inferred" });
		const before = poolFiles().map((f) => readPoolFile(f));
		const r = await write({ title: "Retry policy, consolidated", body, scope: "project", projects: ["r"], confidence: "inferred", supersedes: ["retry"] });

		assert.equal(r.ok, true, "an ambiguous cross-reference must not fail the write");
		assert.deepEqual(r.superseded, [], "guessing between two candidates is how the wrong memory gets sunk");
		assert.ok(r.warnings.some((w: string) => /ambiguous/i.test(w)), "silently doing nothing is as bad as silently guessing");
		assert.equal(before.filter((t) => /superseded_by/i.test(t)).length, 0);
		assert.equal(poolFiles().filter((f) => /superseded_by/i.test(readPoolFile(f))).length, 0, "no memory may be marked when the reference was ambiguous");
	});

	test("an exact filename still resolves even when a substring would be ambiguous", async () => {
		const a = await write({ title: "Retry with jitter on write conflicts", body, scope: "project", projects: ["r"], confidence: "inferred" });
		await write({ title: "Retry with a bounded attempt count", body, scope: "project", projects: ["r"], confidence: "inferred" });
		const r = await write({ title: "Retry policy, consolidated", body, scope: "project", projects: ["r"], confidence: "inferred", supersedes: [a.rel] });
		assert.deepEqual(r.superseded, [a.rel], "precision must still work where a guess would not");
	});
});
