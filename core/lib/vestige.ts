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
import { existsSync } from "node:fs";
import { capture as rawCapture, readPool, visibleTo, rankBySpecificity, isForeign, type PoolEntry, type CaptureResult } from "./memory.ts";
import { visibilityReason, isVisibleTo } from "./om/memory-recall.ts";
import { activeStores, currentProject, ensureStore, loadConfig, routeFor, storePath, type ScopeName, type StoreConfig } from "./stores.ts";
import { validateMemory, type MemoryInput } from "./om/memory-write.ts";
import type { Caller } from "./om/memory-recall.ts";

export interface RememberResult extends CaptureResult {
	/** Which configured store took it, by name. */
	readonly tier: string | null;
	readonly store: string | null;
}

/**
 * Capture a memory, routed to the tier its narrowed scope implies.
 *
 * Scope is narrowed twice-over by necessity: once here to decide the tier, and
 * again inside `capture` which is the authority. They agree because both call
 * `validateMemory`; the dry run here only reads the result.
 */
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
	return { ...r, tier: r.ok ? target.name : null, store: r.ok ? ready.path : null };
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
export function search(query: string, opts: { cwd?: string; limit?: number } = {}): { hits: RecallHit[]; engine: "qmd" | "facets"; note?: string } {
	const cwd = opts.cwd ?? process.cwd();
	const limit = opts.limit ?? 10;
	const base = recall({ cwd, limit: 500 });
	if (!query) return { hits: base.slice(0, limit), engine: "facets" };

	// Build or refresh the caller's index. This is what search was missing: it
	// used to take an indexDir nobody supplied, so it ALWAYS fell back to facet
	// order — rank-1 0.094 against qmd's 0.984 — while the benchmarks built
	// indexes in the harness and reported the good number.
	const idx = ensureIndex({ cwd });
	if (!idx.ok || !idx.dir) {
		return { hits: base.slice(0, limit), engine: "facets", note: `semantic ranking unavailable (${idx.detail}); results are ordered by specificity and recency, which is much weaker` };
	}
	try {
		const r = runQmd(["--index", idx.index!, "query", query, "-n", String(limit), "--format", "files"], { cwd: idx.dir });
		if (!r.ok) return { hits: base.slice(0, limit), engine: "facets", note: "qmd query failed; fell back to facet order" };
		const order = [...r.stdout.matchAll(/qmd:\/\/[^/]+\/([^\s:,]+\.md)/g)].map((m) => m[1]!);
		const byName = new Map(base.map((h) => [h.name, h]));
		const hits = order.map((n) => byName.get(n)).filter(Boolean) as RecallHit[];
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
