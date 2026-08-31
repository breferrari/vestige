/**
 * The indexing layer — the piece that was missing entirely.
 *
 * `search` took an `indexDir` and nothing ever supplied one, so every real call
 * fell through to facet ordering while the benchmarks, which built indexes in
 * the harness, reported qmd's numbers. Shipped like that, retrieval would have
 * been rank-1 0.094 in the field against 0.984 on the bench — the gap between
 * measuring a component and measuring the product.
 *
 * WHY A MATERIALISED VIEW rather than one index over everything.
 *
 * The alternative is to index all stores together and filter the results
 * afterwards. The lab measured that ceiling: qmd returns at most 20 results in
 * every mode, so a post-filter needs the caller's memory to beat every other
 * project into a global top-20 — marginal at sixteen projects and hopeless as
 * the store grows. A per-caller view has no such bound. It is also exactly the
 * architecture measured at 0.984 rank-1.
 *
 * Views are HARDLINKED, not copied: the same bytes, one inode, so a view costs
 * a directory entry per memory rather than a duplicate of the store. Copying is
 * the fallback for filesystems that refuse the link.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readPool, visibleTo, type PoolEntry } from "./memory.ts";
import { activeStores, currentProject, vestigeHome } from "./stores.ts";
import { ensureQmd, runQmd } from "../setup/qmd.ts";
import type { Caller } from "./om/memory-recall.ts";

const viewsRoot = () => join(vestigeHome(), "views");
const indexRoot = () => join(vestigeHome(), "index");
const keyFor = (caller: Caller) => (caller.project ?? "_anon").replace(/[^\w.-]/g, "_");

/**
 * Each caller gets its own NAMED qmd index.
 *
 * The first version ran `qmd init` in a per-caller directory and assumed that
 * produced a project-local index. It does not: `init` prints "ready to go with
 * new local index", creates nothing, and every subsequent call lands in qmd's
 * shared default index. Every project's memories therefore went into ONE index,
 * and a query from one project could return another's — the exact cross-project
 * leak the reach filter exists to prevent, underneath the reach filter.
 *
 * A named index gets its own store under qmd's cache, so isolation is a
 * property of the name rather than of a directory that was never created.
 */
const indexNameFor = (caller: Caller) => `vestige-${keyFor(caller)}`;

/** A cheap signature of what the caller can currently see. */
function signature(entries: readonly PoolEntry[]): string {
	const parts = entries.map((e) => {
		let mtime = 0;
		try { mtime = Math.floor(statSync(e.full).mtimeMs); } catch { /* vanished between listing and stat */ }
		return `${e.name}:${mtime}`;
	}).sort();
	return `${parts.length}\n${parts.join("\n")}`;
}

/**
 * Serialise index builds across PROCESSES.
 *
 * qmd keeps every named index in one shared cache directory, so two Vestige
 * processes building at once contend on it — two sessions on a machine, or two
 * projects in one session. Optimistic retry was tried first and still lost
 * races; contention on a shared store wants exclusion, not hope.
 *
 * `mkdir` is the lock because it is atomic on every filesystem that matters.
 * A lock older than the timeout is treated as abandoned — a crashed process must
 * not wedge every future build — and failing to take the lock proceeds anyway
 * rather than refusing to index, since a contended build is worse than a
 * serialised one but far better than none.
 */
function withIndexLock<T>(fn: () => T): T {
	const lock = join(indexRoot(), ".build-lock");
	const STALE_MS = 120_000;
	const DEADLINE = Date.now() + 60_000;
	let held = false;
	mkdirSync(indexRoot(), { recursive: true });
	while (Date.now() < DEADLINE) {
		try { mkdirSync(lock); held = true; break; } catch { /* someone else holds it */ }
		try {
			if (Date.now() - statSync(lock).mtimeMs > STALE_MS) { rmSync(lock, { recursive: true, force: true }); continue; }
		} catch { continue; }
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 + Math.random() * 150);
	}
	try {
		return fn();
	} finally {
		if (held) { try { rmSync(lock, { recursive: true, force: true }); } catch { /* best effort */ } }
	}
}

export interface IndexResult {
	readonly ok: boolean;
	readonly dir: string | null;
	/** The named qmd index to query. Isolation lives in this name. */
	readonly index?: string;
	readonly docs: number;
	readonly rebuilt: boolean;
	readonly detail: string;
}

/**
 * Make sure this caller has a current qmd index over exactly what it may see.
 *
 * Incremental by signature: if no visible memory has been added, removed or
 * touched since the last build, nothing runs. Embedding is the expensive step
 * and it is on the read path, so this check is what keeps `search` fast.
 */
export function ensureIndex(opts: { cwd?: string; caller?: Caller } = {}): IndexResult {
	const cwd = opts.cwd ?? process.cwd();
	const caller: Caller = opts.caller ?? { project: currentProject(cwd), platforms: [] };

	const all: PoolEntry[] = [];
	for (const { path } of activeStores(cwd)) {
		if (existsSync(path)) all.push(...readPool(path));
	}
	const visible = visibleTo(all, caller);
	if (!visible.length) return { ok: false, dir: null, docs: 0, rebuilt: false, detail: "nothing visible to index" };

	const key = keyFor(caller);
	const view = join(viewsRoot(), key);
	const idx = join(indexRoot(), key);
	const stampFile = join(idx, ".vestige-signature");
	const sig = signature(visible);

	try {
		if (existsSync(stampFile) && readFileSync(stampFile, "utf8") === sig) {
			return { ok: true, dir: idx, index: indexNameFor(caller), docs: visible.length, rebuilt: false, detail: "index current" };
		}
	} catch { /* rebuild */ }

	const q = ensureQmd({ update: false });
	if (!q.ok) return { ok: false, dir: null, docs: visible.length, rebuilt: false, detail: `qmd unavailable: ${q.detail}` };

	return withIndexLock(() => {
	try {
		// Re-check under the lock: a process that was waiting may find the index
		// already rebuilt by whoever held it, which is the common case when two
		// sessions start together.
		try {
			if (existsSync(stampFile) && readFileSync(stampFile, "utf8") === sig) {
				return { ok: true, dir: idx, index: indexNameFor(caller), docs: visible.length, rebuilt: false, detail: "index current" };
			}
		} catch { /* rebuild */ }

		rmSync(view, { recursive: true, force: true });
		mkdirSync(view, { recursive: true });
		for (const e of visible) {
			const dest = join(view, e.name);
			try { linkSync(e.full, dest); } catch { try { copyFileSync(e.full, dest); } catch { /* skip an unreadable memory */ } }
		}

		mkdirSync(idx, { recursive: true });
		const name = indexNameFor(caller);
		// Index builds CONTEND. qmd keeps its stores in one shared cache directory,
		// so two Vestige processes building at the same time — two sessions, or two
		// projects in one session — can collide on it. The loser used to fall back
		// to facet ordering silently, which is rank-1 0.094 dressed as a working
		// search. Bounded retry with jitter, the same shape the push path uses for
		// the same reason.
		// Rebuilt from scratch each time the signature moves: the view is a fresh
		// set of hardlinks, so a stale collection would keep pointing at documents
		// that are no longer visible to this caller.
		let lastErr = "";
		let built = false;
		for (let attempt = 1; attempt <= 4 && !built; attempt++) {
			runQmd(["--index", name, "collection", "remove", "memories"], { cwd: idx });
			const add = runQmd(["--index", name, "collection", "add", view, "--name", "memories"], { cwd: idx });
			if (!add.ok) { lastErr = `collection add: ${add.stderr.slice(0, 160)}`; }
			else {
				const emb = runQmd(["--index", name, "embed"], { cwd: idx });
				// EXIT 0 IS NOT SUCCESS. qmd's embed lock reports contention as
				// success: it prints "Another embed process is already running.
				// Skipping." and exits 0. Trusting that stamps the signature having
				// embedded nothing, and the staleness check then skips the pending
				// work indefinitely — a stale index that reports itself current,
				// forever, with no error.
				//
				// Verified empirically, after the failure mode was described in
				// mcs-cli/memory's qmd branch. Our own cross-process lock does not
				// cover it: the lock has a deadline after which it proceeds, and
				// any other qmd user on the machine holds the same global lock.
				const skipped = /another embed process is already running|skipping/i.test(`${emb.stdout} ${emb.stderr}`);
				if (emb.ok && !skipped) { built = true; break; }
				lastErr = skipped ? "embed skipped: another embed holds qmd's global lock" : `embed: ${emb.stderr.slice(0, 160)}`;
			}
			// full jitter, capped — a contended store clears in milliseconds
			const cap = Math.min(1500, 60 * 2 ** attempt);
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.random() * cap);
		}
		if (!built) return { ok: false, dir: null, docs: visible.length, rebuilt: true, detail: `index build failed after retries — ${lastErr}` };

		writeFileSync(stampFile, sig);
		return { ok: true, dir: idx, index: name, docs: visible.length, rebuilt: true, detail: `indexed ${visible.length} memories into ${name}` };
	} catch (e) {
		return { ok: false, dir: null, docs: visible.length, rebuilt: false, detail: `index build failed: ${String((e as Error)?.message ?? e)}` };
	}
	});
}

/** Drop a caller's index and view — used when a store is reconfigured. */
export function dropIndex(caller: Caller): void {
	const key = keyFor(caller);
	for (const d of [join(viewsRoot(), key), join(indexRoot(), key)]) {
		try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

/** The named index for a caller — exposed so tests can assert isolation. */
export function indexName(caller: Caller): string {
	return indexNameFor(caller);
}
