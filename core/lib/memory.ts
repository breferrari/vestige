/**
 * Vestige: a facet-based reach model over a git-shared pool.
 *
 * WHAT EACH SIDE CONTRIBUTES, AND WHY
 *
 * A git-backed shared pool with hook-driven capture gives real multi-engineer
 * distribution, which a personal-vault design has no notion of. What such a pool
 * does not give, on its own, is a scope model, a content gate, collision handling
 * or contention handling — and each of those absences was measured.
 *
 * A facet-based personal vault ships the two things measurement showed are necessary and did not
 * know it already had:
 *
 *   - `isVisibleTo` is the query-time reach filter, generalized past a single
 *     project axis, so it also covers platform and general reach.
 *   - `narrowScope` is the write-time downgrade rule that filter's reach
 *     DEPENDS ON: a `scope: general` memory must reach every caller, so any
 *     filter is obliged to admit it, and at a 24% over-claim rate the filter
 *     collapsed from 0.984 to 0.391 rank-1 accuracy.
 *
 * So Vestige is not a mashup. It is OM's facet model run as the filter over
 * an MCS-shaped shared pool, with the write path gated and the push made survivable under concurrency.
 *
 * LAYOUT DECISION — flat and project-namespaced, not OM's date tree.
 *
 * A personal vault writes `memories/YYYY/MM/<date> <slug>.md`; a shared pool writes a flat
 * `memories/<kind>_<topic>_<specific>.md` that its sparse-checkout and filename
 * guardrail both operate on. Vestige keeps the flat shape with a project
 * prefix (`memories/<project>__<slug>.md`) for three reasons: it is what the
 * ladder measured (V2 — 183/183 memories survive against the flat pool's
 * 84/183), it keeps the guardrail a one-line regex change, and it leaves the
 * pool simple to reason about. Same-project
 * same-title collisions are still possible and are handled by OM's atomic
 * `claimFile`, which suffixes rather than clobbering — strictly better than
 * the silent overwrite it replaces.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import {
	validateMemory,
	renderMemory,
	slugify,
	type MemoryInput,
	type MemoryValue,
} from "./om/memory-write.ts";
import { claimFile } from "./om/atomic-write.ts";
import { facetsOf, isVisibleTo, parseFrontmatter, specificity, visibilityReason, type Caller, type Facets } from "./om/memory-recall.ts";
import { scan, type Finding } from "./sanitize.ts";

export const POOL = "memories";

/**
 * Reach a writer may claim, given who it is.
 *
 * Two defects found by adversarial probe, both about the WRITE side of reach:
 *
 *   1. SCOPE LAUNDERING. OM's read rule says an explicit project listing always
 *      wins, which is right for a personal vault where the only writer is the
 *      owner. In a team pool it means any session can reach any project by
 *      naming it, and `origin` was recorded but never consulted. A memory whose
 *      origin is not among the projects it claims is now marked `foreign_origin`
 *      and ranked below native ones. It is NOT blocked: a genuinely
 *      cross-project lesson ("this bit us in payments AND ledger") is exactly
 *      the multi-project case the facet model exists to serve, and blocking it
 *      would push people back to writing the same memory twice.
 *
 *   2. IDENTITY-LESS GENERAL WRITE. A caller with no identity could publish
 *      `general`, which reaches every project in the org. The read side already
 *      treats "I don't know who you are" as a reason to show almost nothing; the
 *      write side treated it as a reason to allow the widest possible claim.
 *      That asymmetry is the bug. An anonymous caller may write project-scoped
 *      memories about projects it names, and may not claim org-wide reach.
 */
export interface CaptureResult {
	readonly ok: boolean;
	readonly rel: string | null;
	readonly errors: string[];
	readonly warnings: string[];
	readonly findings: Finding[];
	readonly quarantined: boolean;
	readonly value: MemoryValue | null;
}

/**
 * The pool filename. Flat, project-namespaced.
 *
 * The prefix is the memory's PRIMARY project — first of `projects[]`. A
 * general-scoped memory has no project and is prefixed `_general`, which keeps
 * it inside the same guardrail regex instead of needing a second one, and makes
 * over-broad memories visible in a plain `ls`.
 */
export function poolName(value: MemoryValue): string {
	const owner = value.projects[0] ?? (value.scope === "platform" ? `_platform` : `_general`);
	return `${owner}__${poolSlug(value.title)}.md`;
}

/**
 * ASCII-safe stem for the shared pool. NEVER returns empty.
 *
 * OM's `slugify` is right for a personal vault: it keeps any character Obsidian
 * can name a file with, emoji included. A git-shared pool crossing macOS, Linux
 * and Windows is a harsher environment — non-ASCII stems collide with
 * `core.quotepath`, NFC/NFD normalisation differences between macOS and Linux,
 * and the guardrail regex a shared-pool hook applies.
 *
 * The first version simply refused those titles at the guardrail, which meant a
 * memory could be LOST because of how it was named. That is the wrong trade: the
 * lesson is the valuable part and the filename is an implementation detail. So
 * the stem is narrowed to ASCII, and when nothing survives — an emoji-only or
 * CJK-only title — it falls back to a short digest of the title, which is stable,
 * collision-resistant and still nameable. The full title always survives in the
 * H1 and in the `aliases:` frontmatter OM already emits, so nothing is lost.
 */
export function poolSlug(title: unknown): string {
	const base = slugify(title);
	const ascii = base
		.normalize("NFKD")
		.replace(/[^A-Za-z0-9 ._-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[. ]+$/, "");
	// Spaces become dashes. Not cosmetic: QMD slugifies spaces to dashes when it
	// reports a path, so a space-bearing filename is a path the search tool hands
	// back in a form that opens nothing — already recorded as a gotcha in this
	// vault. A git-shared pool also gets shell-quoting friction for free.
	if (ascii) return ascii.replace(/ /g, "-");
	const digest = createHash("sha256").update(String(title ?? "")).digest("hex").slice(0, 12);
	return `memory-${digest}`;
}

/** The pool filename guardrail, widened for the project prefix. */
export const ALLOWED_POOL_NAME = /^[A-Za-z0-9_-]+__[A-Za-z0-9._-]+\.md$/;

/**
 * Capture a memory into the shared pool.
 *
 * Order is the design: validate (which narrows scope) BEFORE sanitizing, because
 * the sanitizer scans the RENDERED artifact — frontmatter included — and the
 * frontmatter is not known until narrowing has run. Sanitizing the raw body
 * would miss anything the renderer adds, such as `origin`.
 */
export function capture(
	poolRoot: string,
	input: MemoryInput,
	ctx: { now?: Date; origin?: string | null; links?: readonly string[] } = {},
): CaptureResult {
	const origin = ctx.origin ?? null;

	// DEFECT 2 — an anonymous writer may not claim org-wide reach.
	if (!origin && String(input?.scope ?? "") === "general") {
		return {
			ok: false, rel: null, quarantined: false, findings: [], value: null, warnings: [],
			errors: ['scope "general" reaches every project in the pool and requires a known origin. This caller has no identity (no MCP roots). Name the projects this applies to instead.'],
		};
	}

	const v = validateMemory(input, { now: ctx.now, origin });
	if (!v.ok || !v.value) {
		return { ok: false, rel: null, errors: v.errors, warnings: v.warnings, findings: [], quarantined: false, value: null };
	}

	// DEFECT 1 — mark, do not block, a claim that reaches beyond its origin.
	const foreign = Boolean(origin) && v.value.projects.length > 0 && !v.value.projects.some((p) => p.toLowerCase() === origin!.toLowerCase());
	const rendered = withRelated(
		withKind(withForeignMarker(mcsCompat(renderMemory(v.value, ctx.links ?? []), v.value), foreign), input?.kind),
		Array.isArray(input?.related) ? (input.related as unknown[]).filter((x): x is string => typeof x === "string") : [],
	);

	// Fail closed. A contaminated memory is quarantined, never pushed, and
	// never silently dropped: the file is written where the author can still see
	// it, outside the git-tracked pool.
	let findings: Finding[];
	try {
		findings = scan(rendered);
	} catch {
		findings = [{ rule: "SCANNER:FAILED", match: "" }];
	}
	if (findings.length > 0) {
		const qdir = join(poolRoot, "..", "memories-quarantine");
		mkdirSync(qdir, { recursive: true });
		const claimed = claimFile(qdir, rendered, (n) => `${poolName(v.value!).replace(/\.md$/, "")}${n === 1 ? "" : ` (${n})`}.md`, {
			exhaustedMessage: "too many quarantined memories with this name",
		});
		return {
			ok: false,
			rel: null,
			errors: [`content carries ${findings.length} shape(s) that must not leave this machine; quarantined at ${basename(claimed.full)}`],
			warnings: v.warnings,
			findings,
			quarantined: true,
			value: v.value,
		};
	}

	const name = poolName(v.value);
	if (!ALLOWED_POOL_NAME.test(name)) {
		return { ok: false, rel: null, errors: [`generated filename ${JSON.stringify(name)} fails the pool guardrail`], warnings: v.warnings, findings: [], quarantined: false, value: v.value };
	}

	mkdirSync(poolRoot, { recursive: true });
	const claimed = claimFile(poolRoot, rendered, (n) => (n === 1 ? name : name.replace(/\.md$/, ` (${n}).md`)), {
		exhaustedMessage: "too many same-titled memories for this project",
	});
	return { ok: true, rel: claimed.name, errors: [], warnings: v.warnings, findings: [], quarantined: false, value: v.value };
}

/**
 * Re-emit the `**Applies to:** <repo>` line under the H1.
 *
 * The facets in frontmatter are what the filter reads; this line is what a
 * HUMAN, and what existing shared-pool tooling reads, and the pool is meant to be
 * adoptable by a team already running the shipped packs. Costs one line and
 * keeps the corpus legible to anything that predates the facet model.
 */
/**
 * Stamp the genre.
 *
 * A `learning` records what bit and how it was fixed; a `decision` records what
 * was chosen and what was given up. Agents write better when they know which
 * blank they are filling, and an audit can list one genre without reading
 * bodies. Retrieval does NOT use this — there is no second index and no second
 * store — which is why it is a field and not a filename convention: the prefix
 * scheme it replaces made the filename carry meaning the pool name already
 * needed for collision handling.
 *
 * Unknown values fall back rather than refusing. A write rejected over a label
 * loses the memory, and the label is the least valuable thing in it.
 */
export function withKind(rendered: string, kind: unknown): string {
	const k = String(kind ?? "learning").toLowerCase();
	const use = k === "decision" ? "decision" : "learning";
	return rendered.replace(/^(scope: .+)$/m, `$1\nkind: ${use}`);
}

/** Record sibling memories this one sits beside, without claiming to replace them. */
export function withRelated(rendered: string, related: readonly string[]): string {
	if (!related.length) return rendered;
	const list = related.map((r) => JSON.stringify(r)).join(", ");
	return rendered.replace(/^(scope: .+)$/m, `$1\nrelated: [${list}]`);
}

/** Stamp `foreign_origin: true` into frontmatter so the read side can rank on it. */
export function withForeignMarker(rendered: string, foreign: boolean): string {
	if (!foreign) return rendered;
	return rendered.replace(/^(scope: .+)$/m, "$1\nforeign_origin: true");
}

export function mcsCompat(rendered: string, value: MemoryValue): string {
	const owner = value.projects[0] ?? (value.scope === "general" ? "all projects" : value.platforms.join(", ") || "unknown");
	return rendered.replace(/^(# .+)$/m, `$1\n\n**Applies to:** ${owner}`);
}

// ---------------------------------------------------------------------------
// Read path — OM's facet visibility as the generalized query-time filter
// ---------------------------------------------------------------------------

export interface PoolEntry {
	readonly name: string;
	readonly full: string;
	readonly facets: Facets;
	/** Raw frontmatter — `facetsOf` normalises to the fields the READ rule needs and drops the rest. */
	readonly fm: Record<string, string | string[]>;
	/** Origin repo as stamped by the server from MCP roots, not by the caller. */
	readonly origin: string | null;
}

export function readPool(poolRoot: string): PoolEntry[] {
	let names: string[] = [];
	try {
		names = readdirSync(poolRoot).filter((n) => n.endsWith(".md"));
	} catch {
		return [];
	}
	const out: PoolEntry[] = [];
	for (const name of names) {
		const full = join(poolRoot, name);
		try {
			const fm = parseFrontmatter(readFileSync(full, "utf8"));
			const originRaw = fm.origin;
			out.push({
				name, full, facets: facetsOf(fm), fm,
				origin: typeof originRaw === "string" && originRaw && originRaw !== "unknown" ? originRaw : null,
			});
		} catch {
			// An unparseable memory is not visible to anyone. Default deny extends
			// to malformed frontmatter: a memory whose reach cannot be read has not
			// declared a reach.
		}
	}
	return out;
}

/**
 * The visible set for one caller — the reach filter, generalized.
 *
 * An earlier version filtered on one axis, the asking project. This filters on the whole
 * facet rule: explicit project listing, platform overlap, or general scope, with
 * default deny. A caller with no identity sees only `general`, which is the
 * safest reading of "I don't know who you are".
 */
export function visibleTo(entries: readonly PoolEntry[], caller: Caller): PoolEntry[] {
	return entries.filter((e) => isVisibleTo(e.facets, caller));
}

export function explainVisibility(entries: readonly PoolEntry[], caller: Caller): { name: string; visible: boolean; reason: string }[] {
	return entries.map((e) => ({ name: e.name, visible: isVisibleTo(e.facets, caller), reason: visibilityReason(e.facets, caller) }));
}

/**
 * Materialise one caller's visible view as a directory qmd can index.
 *
 * A view rather than a post-filter over the shared index, because the lab
 * measured the post-filter's ceiling: qmd returns at most 20 results in every
 * mode, so a post-filter must win a global top-20 against every other project.
 * That ceiling does not move as the org grows; a view has no such bound.
 */
export function materializeView(entries: readonly PoolEntry[], caller: Caller, outDir: string): number {
	mkdirSync(outDir, { recursive: true });
	const vis = visibleTo(entries, caller);
	for (const e of vis) writeFileSync(join(outDir, e.name), readFileSync(e.full, "utf8"));
	return vis.length;
}

/** Specificity ordering, for ranking qmd hits within a view. */
/**
 * Was this memory written from outside every project it claims?
 *
 * DERIVED at read time from `origin` versus `projects`, not read from the
 * stamped `foreign_origin` flag. The first version trusted the flag and was
 * inert: `facetsOf` normalises frontmatter to the fields the visibility rule
 * needs and drops everything else, so the marker never reached the read side and
 * the mitigation silently did nothing. Deriving it also removes the obvious
 * evasion — a writer cannot suppress a property that the reader computes.
 *
 * `origin` is stamped by the server from the caller's MCP roots, not supplied in
 * the payload, so it is the one field here a caller cannot simply assert.
 */
export function isForeign(e: PoolEntry): boolean {
	const claimed = e.facets.projects ?? [];
	if (!e.origin || claimed.length === 0) return false;
	return !claimed.some((p) => p.toLowerCase() === e.origin!.toLowerCase());
}

/**
 * Specificity, with foreign-origin memories sunk below native ones.
 *
 * A memory about your project written from somewhere else is still worth
 * reading — it is how a cross-cutting lesson travels — but it is weaker evidence
 * than one written by someone working in the repo, and it is the shape a
 * laundering attempt takes. Sink rather than hide.
 */
export function rankBySpecificity(entries: readonly PoolEntry[], caller: Caller): PoolEntry[] {
	return [...entries].sort((a, b) => {
		const f = Number(isForeign(a)) - Number(isForeign(b));
		if (f !== 0) return f;
		return specificity(b.facets, caller) - specificity(a.facets, caller);
	});
}
