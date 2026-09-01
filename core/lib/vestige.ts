/**
 * The plugin's public API: one capture path, one recall path, two stores.
 *
 * qmd is REQUIRED. This was measured, after being claimed otherwise.
 *
 * The earlier claim was that the reach filter carries retrieval quality and the
 * engine barely matters, generalised from an earlier comparison of two retrieval engines,
 * where swapping engines on a shared pool moved found@5 by 0.000. That step
 * compared two engines on an UNSCOPED pool where neither could work, and
 * concluded from a tie between two broken configurations that the component was
 * irrelevant. It is not.
 *
 * Measured on the same corpus, same queries, filtered views:
 *
 *              rank-1    found@5
 *   facets      0.094      0.438      specificity and recency, no query relevance
 *   qmd         0.984      1.000
 *
 * The filter decides WHAT may be seen; the ranker decides WHICH of it answers
 * the question. Both are load-bearing and neither substitutes for the other. A
 * view of eleven documents hides this — top-5 of eleven is nearly free — which
 * is exactly why the first measurement was taken on views too small to show it.
 *
 * Consequence for installation: qmd is a hard dependency, so it has to be
 * provisioned rather than assumed. See the handoff note.
 */
import { execFileSync } from "node:child_process";
import { runQmd, resolveQmdEntry } from "../setup/qmd.ts";
import { ensureIndex } from "./index-view.ts";
import { markSuperseded, addToFrontmatterList } from "./om/memory-supersede.ts";
import { sessionQuery } from "./qmd-session.ts";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capture as rawCapture, readPool, visibleTo, rankBySpecificity, isForeign, type PoolEntry, type CaptureResult } from "./memory.ts";
import { visibilityReason, isVisibleTo } from "./om/memory-recall.ts";
import { activeStores, currentProject, ensureStore, loadConfig, routeFor, storePath, type ScopeName, type StoreConfig } from "./stores.ts";
import { validateMemory, type MemoryInput } from "./om/memory-write.ts";
import type { Caller } from "./om/memory-recall.ts";

export interface RememberResult extends CaptureResult {
	/** Which configured store took it, by name. */
	readonly tier: string | null;
	readonly store: string | null;
	/** Memories this write marked as superseded, by filename. */
	readonly superseded?: readonly string[];
	/** Memories this write cross-linked, by filename. */
	readonly linked?: readonly string[];
}

/**
 * Capture a memory, routed to the tier its narrowed scope implies.
 *
 * Scope is narrowed twice-over by necessity: once here to decide the tier, and
 * again inside `capture` which is the authority. They agree because both call
 * `validateMemory`; the dry run here only reads the result.
 */
/**
 * Resolve loose references — a title, a filename, a relative path — to files in
 * this store, and apply an edit to each.
 *
 * Callers name a memory the way a person would, and a reference that matches
 * nothing is reported rather than thrown: failing a good write because one
 * cross-reference did not resolve loses the memory to protect a link.
 */
function markAll(storePath: string, refs: unknown, apply: (rel: string) => { ok: boolean }, warnings: string[] = []): string[] {
	if (!Array.isArray(refs) || !refs.length) return [];
	const names = readdirSync(storePath).filter((f) => f.endsWith(".md"));
	const done: string[] = [];
	const ambiguous: string[] = [];
	for (const raw of refs) {
		if (typeof raw !== "string" || !raw.trim()) continue;
		const want = raw.trim().toLowerCase().replace(/\.md$/, "");
		// Resolve in tiers, and REFUSE AN AMBIGUOUS ONE. The loose tiers used to
		// take the first match, so `supersedes: ["retry"]` would mark whichever
		// memory happened to sort first — silently, and on a write that reports
		// success. Marking the wrong memory as superseded is worse than not
		// marking one: the correct memory stays live and a good one sinks, and
		// nothing in the output says which happened.
		const exact = names.filter((n) => n.toLowerCase().replace(/\.md$/, "") === want);
		const substr = exact.length ? [] : names.filter((n) => n.toLowerCase().includes(want));
		const byTitle = exact.length || substr.length ? [] : names.filter((n) => {
			try { return new RegExp(`^#\\s*${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").test(readFileSync(join(storePath, n), "utf8")); } catch { return false; }
		});
		const candidates = exact.length ? exact : substr.length ? substr : byTitle;
		if (candidates.length !== 1) {
			if (candidates.length > 1) ambiguous.push(raw.trim());
			continue;
		}
		const hit = candidates[0]!;
		try { if (apply(hit).ok) done.push(hit); } catch { /* one bad reference must not fail the write */ }
	}
	if (ambiguous.length) warnings.push(`ambiguous reference(s), nothing was marked: ${ambiguous.join(", ")} — name the file, or use the full title`);
	return done;
}

export function remember(input: MemoryInput, opts: { cwd?: string; now?: Date } = {}): RememberResult {
	const cwd = opts.cwd ?? process.cwd();
	const origin = currentProject(cwd);

	const probe = validateMemory(input, { now: opts.now, origin });
	if (!probe.ok || !probe.value) {
		return { ok: false, rel: null, errors: probe.errors, warnings: probe.warnings, findings: [], quarantined: false, value: null, tier: null, store: null };
	}

	// Routing is configuration. The narrowed scope picks a store; the store
	// decides whether that means this repo, a shared memories repository, or a
	// personal directory. See stores.ts for why this is not hardcoded.
	const cfg = loadConfig(cwd);
	const scope = probe.value.scope as ScopeName;
	const named = probe.value.projects.map((p) => p.toLowerCase());
	const aboutThisRepo = Boolean(origin) && named.length === 1 && named[0] === origin!.toLowerCase();
	const target: StoreConfig | null = routeFor(cfg, scope, { projectOnlySelf: aboutThisRepo });
	if (!target) {
		return { ok: false, rel: null, errors: ["no configured store accepts this memory's scope"], warnings: probe.warnings, findings: [], quarantined: false, value: null, tier: null, store: null };
	}

	const ready = ensureStore(target, cwd);
	if (!ready.ok || !ready.path) {
		return { ok: false, rel: null, errors: [ready.detail], warnings: probe.warnings, findings: [], quarantined: false, value: null, tier: target.name, store: null };
	}

	const r = rawCapture(ready.path, input, { now: opts.now, origin });
	if (!r.ok || !r.rel) return { ...r, tier: null, store: null, superseded: [], linked: [] };

	// A store fills with twins when the only way to record a better version of a
	// lesson is to write it again. Superseding marks the old one and keeps it —
	// what was believed at the time is evidence, and deleting it loses the fact
	// that it changed. `related` is the weaker link, for a memory that sits
	// beside another without replacing it, and it is written on BOTH files
	// because a one-way link is invisible from the side that needs it.
	const title = String(r.value?.title ?? "");
	const refWarnings: string[] = [];
	const superseded = markAll(ready.path, input?.supersedes, (rel) => markSuperseded(ready.path, rel, title), refWarnings);
	const linked = markAll(ready.path, input?.related, (rel) => {
		const full = join(ready.path, rel);
		const edit = addToFrontmatterList(readFileSync(full, "utf8"), "related", title);
		if (edit.changed) writeFileSync(full, edit.text);
		return { ok: edit.changed };
	}, refWarnings);

	return { ...r, warnings: [...(r.warnings ?? []), ...refWarnings], tier: target.name, store: ready.path, superseded, linked };
}

export interface RecallHit {
	readonly name: string;
	readonly full: string;
	readonly tier: string;
	readonly foreign: boolean;
	readonly scope: string;
	readonly projects: string[];
}

/** Everything this caller may see, from BOTH stores, ranked. */
export function recall(opts: { cwd?: string; limit?: number; caller?: Caller } = {}): RecallHit[] {
	const cwd = opts.cwd ?? process.cwd();
	const caller: Caller = opts.caller ?? { project: currentProject(cwd), platforms: [] };

	const all: { e: PoolEntry; tier: string }[] = [];
	for (const { config, path } of activeStores(cwd)) {
		if (!existsSync(path)) continue;
		for (const e of readPool(path)) all.push({ e, tier: config.name });
	}

	const visibleEntries = visibleTo(all.map((x) => x.e), caller);
	const tierOf = new Map(all.map((x) => [x.e.full, x.tier]));
	const ranked = rankBySpecificity(visibleEntries, caller);
	return ranked.slice(0, opts.limit ?? 20).map((e) => ({
		name: e.name,
		full: e.full,
		tier: tierOf.get(e.full) ?? "unknown",
		foreign: isForeign(e),
		scope: String(e.facets.scope ?? "project"),
		projects: e.facets.projects ?? [],
	}));
}

/**
 * Is qmd usable?
 *
 * Asks the PROVISIONED install, not a bare `qmd` on PATH. Vestige installs its
 * own under VESTIGE_HOME so the same runtime serves every host, and on Windows a
 * PATH lookup finds a .cmd shim that Node cannot spawn without a shell anyway.
 */
export function hasQmd(): boolean {
	return resolveQmdEntry() !== null && runQmd(["--version"]).ok;
}

/**
 * Semantic search INSIDE the visible set.
 *
 * Falls back to facet order when qmd is absent, so a broken install still
 * answers rather than erroring — but this is DEGRADED, not equivalent. It costs
 * rank-1 accuracy 0.984 -> 0.094. Nothing outside the caller's reach can appear
 * either way, so the fallback is safe; it is simply much worse at answering.
 * Callers are told which engine ran precisely so this is never invisible.
 */
/**
 * Async because the fast path is a persistent qmd process rather than a CLI
 * spawn: 18ms warm against 2748ms per invocation, which is the difference
 * between a search an agent calls freely and one it learns to avoid.
 */
export async function search(query: string, opts: { cwd?: string; limit?: number } = {}): Promise<{ hits: RecallHit[]; engine: "qmd" | "facets"; note?: string }> {
	const cwd = opts.cwd ?? process.cwd();
	const limit = opts.limit ?? 10;
	const base = recall({ cwd, limit: 500 });
	if (!query) return { hits: base.slice(0, limit), engine: "facets" };

	// Build or refresh the caller's index. `search` once took an `indexDir` that
	// nothing supplied, so it ALWAYS fell back to facet order — rank-1 0.094
	// against 0.984 — while the benchmarks built indexes in the harness and
	// reported the good number.
	const idx = ensureIndex({ cwd });
	if (!idx.ok || !idx.dir || !idx.index) {
		return { hits: base.slice(0, limit), engine: "facets", note: `semantic ranking unavailable (${idx.detail}); results are ordered by specificity and recency, which is much weaker` };
	}

	const byName = new Map(base.map((h) => [h.name, h]));
	const resolve = (id: string) => byName.get(id) ?? byName.get(`${id}.md`);

	// RERANKING IS OFF BY DEFAULT — measurably worse on both axes. It earns its
	// place on a large undifferentiated corpus by re-sorting a noisy candidate
	// list; after a reach filter has reduced the field to what one caller can
	// see, it re-sorts an already-correct list and sometimes demotes the right
	// answer. Same 64 queries: found@5 0.953 -> 1.000, rank-1 0.906 -> 1.000,
	// latency 2346ms -> 1576ms, and four queries stopped failing outright.
	const rerank = process.env.VESTIGE_RERANK === "1";

	// FAST PATH: a resident qmd process. Spawning the CLI costs ~2.7s per query,
	// nearly all of it loading a model into a process that then exits — the
	// difference between a search an agent calls freely and one it avoids, which
	// matters because the protocol asks it to search before answering. Warm: 18ms.
	//
	// Keyed on the view signature: the server reads its collection list once at
	// startup, so a rebuilt view has to respawn it.
	try {
		const ids = await sessionQuery({ index: idx.index, signature: idx.signature ?? "", cwd: idx.dir, query, limit, rerank });
		if (ids?.length) {
			const hits = ids.map(resolve).filter(Boolean) as RecallHit[];
			if (hits.length) return { hits, engine: "qmd" };
		}
	} catch { /* fall through to the CLI rather than failing the search */ }

	try {
		const r = runQmd(["--index", idx.index, "query", query, "-n", String(limit), ...(rerank ? [] : ["--no-rerank"]), "--format", "files"], { cwd: idx.dir });
		if (!r.ok) return { hits: base.slice(0, limit), engine: "facets", note: "qmd query failed; fell back to facet order" };
		const order = [...r.stdout.matchAll(/qmd:\/\/[^/]+\/([^\s:,?]+\.md)/g)].map((m) => m[1]!);
		const hits = order.map(resolve).filter(Boolean) as RecallHit[];
		return hits.length ? { hits, engine: "qmd" } : { hits: base.slice(0, limit), engine: "facets", note: "nothing matched; showing what is visible" };
	} catch {
		return { hits: base.slice(0, limit), engine: "facets", note: "qmd query threw; fell back to facet order" };
	}
}


export interface Explanation {
	readonly name: string;
	readonly tier: string;
	readonly visible: boolean;
	readonly reason: string;
	readonly scope: string;
	readonly projects: string[];
	readonly origin: string | null;
	readonly foreign: boolean;
	readonly claimedScope: string | null;
	readonly confidence: string | null;
	readonly claimedConfidence: string | null;
	readonly flags: string[];
}

/**
 * Why every memory was or was not shown to this caller.
 *
 * Retrieval that cannot explain itself is impossible to debug and impossible to
 * trust, and every failure in this layer looks identical from outside: "no
 * results". This is what tells an empty store apart from a reach mismatch apart
 * from a renamed project.
 *
 * It is also the audit surface. A memory carries what was CLAIMED alongside what
 * was RECORDED — `claimed_scope` when reach was narrowed, `claimed_confidence`
 * when a flagged claim was capped — so a reader can see what the writer asserted
 * and what the system did about it, rather than only the outcome.
 */
export function explain(opts: { cwd?: string; caller?: Caller } = {}): Explanation[] {
	const cwd = opts.cwd ?? process.cwd();
	const caller: Caller = opts.caller ?? { project: currentProject(cwd), platforms: [] };
	const rows: Explanation[] = [];
	for (const { config, path } of activeStores(cwd)) {
		if (!existsSync(path)) continue;
		for (const e of readPool(path)) {
			const fm = e.fm as Record<string, string | string[]>;
			const str = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : null);
			rows.push({
				name: e.name,
				tier: config.name,
				visible: isVisibleTo(e.facets, caller),
				reason: visibilityReason(e.facets, caller),
				scope: String(e.facets.scope ?? "project"),
				projects: e.facets.projects ?? [],
				origin: e.origin,
				foreign: isForeign(e),
				claimedScope: str("claimed_scope"),
				confidence: str("confidence"),
				claimedConfidence: str("claimed_confidence"),
				flags: Array.isArray(fm.flags) ? (fm.flags as string[]) : [],
			});
		}
	}
	return rows.sort((a, b) => Number(b.visible) - Number(a.visible) || a.name.localeCompare(b.name));
}
