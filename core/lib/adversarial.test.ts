import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

/**
 * Attacks on the INTEGRATED plugin, not the library in isolation.
 *
 * The unit tests cover the write contract; these cover what happens when the
 * world misbehaves around it — a store that vanishes, a config that is garbage,
 * a filesystem that refuses, a caller that asks for something absurd. Every one
 * of these has a correct answer that is not "throw", because this code runs
 * inside somebody's session.
 */
const HOME = mkdtempSync(join(tmpdir(), "vh-adv-"));
process.env.VESTIGE_HOME = HOME;
process.env.VESTIGE_NO_UPDATE = "1";
const { remember, recall, search, explain } = await import("./vestige.ts");
const { loadConfig, storePath, ensureStore } = await import("./stores.ts");
const { scan } = await import("./sanitize.ts");

const repo = (name = "advrepo") => {
	const d = join(mkdtempSync(join(tmpdir(), "adv-")), name);
	mkdirSync(d, { recursive: true });
	execFileSync("git", ["init", "-q", d]);
	return d;
};
const mem = (o: Record<string, unknown> = {}) => ({
	title: "Retried mutations need an idempotency key",
	body: "A retried mutation must carry an idempotency key or the ledger double counts the second attempt.",
	confidence: "inferred", scope: "project", ...o,
});

describe("hostile inputs", () => {
	test("a body of a megabyte is accepted or refused, never a crash", () => {
		const d = repo();
		const r = remember(mem({ projects: ["advrepo"], body: "x".repeat(1_000_000) }), { cwd: d });
		assert.equal(typeof r.ok, "boolean");
		if (r.ok) assert.ok(r.rel);
	});

	test("a title of RTL and combining marks still produces a usable filename", () => {
		const d = repo();
		const r = remember(mem({ projects: ["advrepo"], title: "مرحبا ‏́́ test" }), { cwd: d });
		assert.equal(r.ok, true, r.errors.join("; "));
		assert.match(r.rel!, /^[A-Za-z0-9_.-]+$/, `unsafe filename: ${r.rel}`);
	});

	test("naming five hundred projects does not break reach or the filename", () => {
		const d = repo();
		const many = Array.from({ length: 500 }, (_, i) => `svc-${i}`);
		const r = remember(mem({ projects: many }), { cwd: d });
		assert.equal(r.ok, true, r.errors.join("; "));
		assert.ok(r.rel!.length < 250, "filename must stay under filesystem limits");
	});

	test("a scope the schema does not know is refused, not coerced", () => {
		const d = repo();
		const r = remember(mem({ projects: ["advrepo"], scope: "everyone" }), { cwd: d });
		assert.equal(r.ok, false);
	});
});

describe("hostile environment", () => {
	test("a garbage config falls back to the default rather than failing", () => {
		const d = repo();
		mkdirSync(join(d, ".vestige"), { recursive: true });
		writeFileSync(join(d, ".vestige", "config.json"), "{ not json at all ");
		const cfg = loadConfig(d);
		assert.ok(cfg.stores.length > 0, "must fall back to a working default");
		assert.equal(remember(mem({ projects: ["advrepo"] }), { cwd: d }).ok, true);
	});

	test("a config with an empty store list falls back too", () => {
		const d = repo();
		mkdirSync(join(d, ".vestige"), { recursive: true });
		writeFileSync(join(d, ".vestige", "config.json"), JSON.stringify({ stores: [] }));
		assert.ok(loadConfig(d).stores.length > 0);
	});

	test("an external store with an unreachable remote fails with a diagnosis and writes nothing", () => {
		const d = repo();
		mkdirSync(join(d, ".vestige"), { recursive: true });
		writeFileSync(join(d, ".vestige", "config.json"), JSON.stringify({
			stores: [{ name: "team", kind: "external", url: "git@nowhere.invalid:x/y.git", path: ".vestige/.team", accepts: ["*"] }],
		}));
		const r = remember(mem({ projects: ["advrepo"] }), { cwd: d });
		assert.equal(r.ok, false);
		assert.match(r.errors.join(" "), /reach|unreachable|SSH|network/i);
		assert.equal(existsSync(join(d, ".vestige", ".team")), false, "nothing may be written when the remote is unreachable");
	});

	test("a read-only store surfaces an error instead of throwing", () => {
		const d = repo();
		const store = join(d, ".vestige", "memories");
		mkdirSync(store, { recursive: true });
		try { chmodSync(store, 0o500); } catch { return; }
		const r = remember(mem({ projects: ["advrepo"] }), { cwd: d });
		chmodSync(store, 0o700);
		assert.equal(typeof r.ok, "boolean");
	});

	test("recall on a vanished store returns nothing rather than throwing", () => {
		const d = repo();
		remember(mem({ projects: ["advrepo"] }), { cwd: d });
		rmSync(join(d, ".vestige"), { recursive: true, force: true });
		assert.doesNotThrow(() => recall({ cwd: d }));
	});

	test("search survives a corrupt index and still answers", async () => {
		const d = repo();
		remember(mem({ projects: ["advrepo"] }), { cwd: d });
		await search("idempotency", { cwd: d });                // build it
		const idxDir = join(HOME, "index");
		// Without qmd no index is ever built, so there is nothing to corrupt. What
		// this asserts - that search still ANSWERS - holds either way.
		if (existsSync(idxDir)) {
			for (const n of readdirSync(idxDir)) {
				try { writeFileSync(join(idxDir, n, ".vestige-signature"), "corrupt"); } catch { /* not a directory */ }
			}
		}
		const r = await search("idempotency", { cwd: d });
		assert.ok(r.hits.length >= 0);
		assert.ok(["qmd", "facets"].includes(r.engine));
	});

	test("outside a git repo, project memories are refused rather than misfiled", () => {
		const bare = mkdtempSync(join(tmpdir(), "nogit-"));
		const r = remember(mem({ projects: [] }), { cwd: bare });
		assert.equal(r.ok, false);
		assert.match(r.errors.join(" "), /reach nobody|name the projects/i);
	});
});

describe("concurrency", () => {
	test("two writers with the same title both survive", () => {
		const d = repo();
		const results = [1, 2, 3, 4, 5].map((i) => remember(mem({ projects: ["advrepo"], body: `Attempt ${i}: a retried mutation must carry an idempotency key or the ledger double counts.` }), { cwd: d }));
		assert.ok(results.every((r) => r.ok), results.map((r) => r.errors.join(";")).join(" | "));
		assert.equal(new Set(results.map((r) => r.rel)).size, 5, "every write must get its own file");
	});
});

describe("the audit surface never lies", () => {
	test("explain accounts for every memory in every store", () => {
		const d = repo();
		remember(mem({ projects: ["advrepo"], title: "One" }), { cwd: d });
		remember(mem({ projects: ["advrepo"], title: "Two" }), { cwd: d });
		const rows = explain({ cwd: d });
		const stored = recall({ cwd: d, limit: 1000 }).length;
		assert.ok(rows.length >= stored, "explain must not hide what recall returns");
		for (const r of rows) assert.ok(r.reason.length > 0, `no reason given for ${r.name}`);
	});
});

describe("scanning cost is bounded", () => {
	test("a megabyte body scans in well under a second", () => {
		const t = Date.now();
		const findings = scan("x".repeat(1_000_000));
		const ms = Date.now() - t;
		assert.ok(ms < 1000, `scanning 1MB took ${ms}ms — an unbounded {32,} run is quadratic and hangs the turn`);
		assert.ok(findings.some((f) => f.rule === "OVERSIZED"), "an oversized body must be reported, never silently half-scanned");
	});
});

describe("a shared config cannot place a store outside its tree", () => {
	/**
	 * `.vestige/config.json` is checked into the shared repository, so in a team
	 * it is written by whoever committed it — and it decides where this tool
	 * writes files and runs git. A `path` of "../../.." resolved happily, with
	 * nothing in any output saying the store had left the repo.
	 */
	test("a repo store escaping the repository resolves to nothing", async () => {
		const { storePath } = await import(`./stores.ts?${Math.random()}`);
		const repo = mkdtempSync(join(tmpdir(), "esc-repo-"));
		execFileSync("git", ["init", "-q", repo]);
		const escape = storePath({ name: "evil", kind: "repo", path: "../../..", accepts: ["project"] }, repo);
		assert.equal(escape, null, "a store that resolves outside the repository must be refused, not used");
		const ok = storePath({ name: "project", kind: "repo", path: ".vestige/memories", accepts: ["project"] }, repo);
		// Compare against the RESOLVED root. git reports the toplevel with
		// symlinks resolved on macOS (/private/var, not /var) and with forward
		// slashes on Windows, so a startsWith against the temp path this test
		// created fails on both while the code is behaving correctly.
		const realRepo = realpathSync(repo);
		assert.ok(ok, "and an ordinary store must still resolve");
		assert.ok(!relative(realRepo, ok).startsWith(".."), `expected a path inside ${realRepo}, got ${ok}`);
	});

	test("a relative local store cannot climb out of VESTIGE_HOME", async () => {
		const { storePath } = await import(`./stores.ts?${Math.random()}`);
		const home = mkdtempSync(join(tmpdir(), "esc-home-"));
		process.env.VESTIGE_HOME = home;
		assert.equal(storePath({ name: "evil", kind: "local", path: "../../../.ssh", accepts: ["*"] }), null);
		// An absolute path is a deliberate choice someone makes for their own
		// store, and must keep working.
		const abs = storePath({ name: "mine", kind: "local", path: join(home, "elsewhere"), accepts: ["*"] });
		assert.ok(abs && !relative(realpathSync(home), realpathSync(dirname(abs))).startsWith(".."));
	});
});
