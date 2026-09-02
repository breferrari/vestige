import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Cross-project isolation of the search index.
 *
 * This is the guard for the worst bug found in this build. `qmd init` in a
 * per-caller directory prints "ready to go with new local index" and creates
 * nothing, so every caller's collection landed in qmd's shared default index —
 * one index holding every project's memories, underneath a reach filter whose
 * entire job is to keep them apart. A query from one project could return
 * another's, and nothing in the facet layer could have caught it, because the
 * facet layer was never the thing that failed.
 *
 * Isolation now comes from a per-caller NAMED index. This test is the reason it
 * cannot silently regress.
 */
const HOME = mkdtempSync(join(tmpdir(), "vh-idx-"));
process.env.VESTIGE_HOME = HOME;
process.env.VESTIGE_NO_UPDATE = "1";
const { remember, search, hasQmd } = await import("./vestige.ts");
const { indexName } = await import("./index-view.ts");
const { qmdConfigPath, PREFERRED_EMBED_MODEL } = await import("./qmd-embed-model.ts");

// qmd is a ~250MB install with model downloads, so CI does not have it. Without
// it `search` falls back to facet order, and this test's non-vacuity guard
// correctly refuses to claim isolation from a fallback. SKIPPING is the honest
// outcome — the property is untested here, not broken. Failing would train
// everyone to ignore a red build.
const ENGINE = hasQmd();

function repo(name: string): string {
	const d = join(mkdtempSync(join(tmpdir(), "iso-")), name);
	mkdirSync(d, { recursive: true });
	execFileSync("git", ["init", "-q", d]);
	return d;
}
const BODY = (who: string) => `In ${who} a retried mutation must carry an idempotency key or the ledger double counts the second attempt.`;

describe("index isolation", () => {
	test("a project's search never returns another project's memory", { skip: ENGINE ? false : "qmd is not installed; isolation cannot be tested without semantic ranking" }, async () => {
		const A = repo("alpha-svc"), B = repo("beta-svc");
		remember({ title: "Alpha retried mutations need an idempotency key", body: BODY("alpha-svc"), confidence: "inferred", scope: "project", projects: ["alpha-svc"] }, { cwd: A });
		remember({ title: "Beta retried mutations need an idempotency key", body: BODY("beta-svc"), confidence: "inferred", scope: "project", projects: ["beta-svc"] }, { cwd: B });

		const a = await search("idempotency key for a retried mutation", { cwd: A });
		const b = await search("idempotency key for a retried mutation", { cwd: B });

		// non-vacuity: if the engine fell back, this test proves nothing
		assert.equal(a.engine, "qmd", `A fell back to ${a.engine}; isolation untested`);
		assert.equal(b.engine, "qmd", `B fell back to ${b.engine}; isolation untested`);
		assert.ok(a.hits.length > 0 && b.hits.length > 0, "both projects must find their own memory");

		assert.equal(a.hits.some((h) => h.name.startsWith("beta-svc")), false, "alpha saw beta's memory");
		assert.equal(b.hits.some((h) => h.name.startsWith("alpha-svc")), false, "beta saw alpha's memory");
	});

	test("the index is built on the chosen embedder, not qmd's default", { skip: ENGINE ? false : "qmd is not installed; there is no config to inspect" }, async () => {
		// qmd writes ITS default into the config the first time it touches an
		// index, and config beats the environment variable from then on. So this
		// only holds if the model is set after the collection exists and before
		// anything is embedded — a wiring order no unit test on the helper alone
		// would catch. It is worth 36 recall queries against 5, p < 0.001.
		const C = repo("embedder-svc");
		remember({ title: "Embedder check", body: BODY("embedder-svc"), confidence: "inferred", scope: "project", projects: ["embedder-svc"] }, { cwd: C });
		const r = await search("idempotency key for a retried mutation", { cwd: C });
		assert.equal(r.engine, "qmd", `fell back to ${r.engine}; no index was built, so this proves nothing`);

		const cfg = readFileSync(qmdConfigPath(indexName({ project: "embedder-svc", platforms: [] })), "utf-8");
		assert.match(cfg, new RegExp(`embed:\\s*${PREFERRED_EMBED_MODEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "the index is still on qmd's default embedder");
	});

	test("callers get distinct index names, and an anonymous caller its own", () => {
		assert.notEqual(indexName({ project: "a", platforms: [] }), indexName({ project: "b", platforms: [] }));
		assert.match(indexName({ project: null, platforms: [] }), /_anon/);
	});
});
