/**
 * Find memories that are saying the same thing.
 *
 * A store accumulates near-duplicates honestly: three sessions hit the same
 * wall in three repos and each records what it learned. Individually every one
 * is correct; together they are one rule stated three times, and retrieval has
 * to pick between them.
 *
 * This finds the candidates. It deliberately does NOT write the consolidated
 * rule — that is a judgement about what the shared claim actually is, and the
 * cases where it is wrong are exactly the cases a similarity score cannot see:
 * two memories can be lexically close and mean opposite things, or distant and
 * be the same lesson in two vocabularies. So the code proposes and a reader
 * decides, which is the same division the capture skill uses.
 *
 * The anchors matter as much as the rule. A consolidated memory that replaces
 * its sources without naming them loses the evidence it was built from — and
 * the next reader cannot tell a rule observed three times from an assertion
 * someone made once.
 */
import { readPool, visibleTo, type PoolEntry } from "./memory.ts";
import { activeStores, callerPlatforms, currentProject } from "./stores.ts";
import { existsSync, readFileSync } from "node:fs";

export interface Cluster {
	readonly members: { name: string; title: string; projects: string[]; store: string }[];
	readonly shared: string[];
	readonly score: number;
}

/** Words too common in this corpus to be evidence that two memories agree. */
const STOP = new Set("the a an and or of to in on for with is are was were be it this that as by at from not no than then when if you your we our they their can could should would must may might do does did done have has had over under into out up down off about after before while each any all some more most other another such only same so no nor own too very just also its it's".split(/\s+/));

const tokens = (s: string): Set<string> =>
	new Set(String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));

const jaccard = (a: Set<string>, b: Set<string>): number => {
	if (!a.size || !b.size) return 0;
	let hit = 0;
	for (const t of a) if (b.has(t)) hit++;
	return hit / (a.size + b.size - hit);
};

/**
 * Clusters of memories visible to this caller that appear to state one claim.
 *
 * `threshold` comes from measurement, not taste: on this corpus two paraphrases
 * of one lesson score 0.286 by shared vocabulary while unrelated memories score
 * 0.000, so 0.22 sits inside that gap with room on both sides. It stays
 * deliberately conservative — a false cluster costs a reader the time to reject
 * it, and after three of those they stop reading the proposals; a missed one
 * costs nothing, because the store was already going to keep both.
 */
export function findClusters(opts: { cwd?: string; threshold?: number; minMembers?: number } = {}): Cluster[] {
	const cwd = opts.cwd ?? process.cwd();
	const threshold = opts.threshold ?? 0.22;
	const minMembers = opts.minMembers ?? 2;

	const all: { e: PoolEntry; store: string }[] = [];
	for (const { path } of activeStores(cwd)) {
		if (!existsSync(path)) continue;
		for (const e of readPool(path)) all.push({ e, store: path });
	}
	const caller = { project: currentProject(cwd), platforms: callerPlatforms(cwd) };
	const visible = new Set(visibleTo(all.map((x) => x.e), caller).map((e) => e.full));
	const pool = all.filter((x) => visible.has(x.e.full));

	// Read the BODY. A pool entry carries facets and a filename, and clustering
	// on filenames alone finds only memories that were titled alike — which is
	// the one case that needs no help. Bounded per file, and this runs on
	// demand rather than on any retrieval path.
	const textOf = (full: string): string => {
		try {
			const raw = readFileSync(full, "utf8").slice(0, 8000);
			// Strip the frontmatter and the ownership line before comparing.
			// Every memory in the store shares that vocabulary — scope, projects,
			// confidence, the date — so leaving it in makes any two memories look
			// a third alike and clusters things that share nothing but a schema.
			return raw
				.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
				.replace(/^\*\*Applies to:\*\*.*$/m, "")
				.slice(0, 6000);
		} catch { return ""; }
	};
	const toks = new Map(pool.map((x) => [x.e.full, tokens(`${x.e.name} ${textOf(x.e.full)}`)]));
	const seen = new Set<string>();
	const clusters: Cluster[] = [];

	for (const a of pool) {
		if (seen.has(a.e.full)) continue;
		const group = [a];
		for (const b of pool) {
			if (b.e.full === a.e.full || seen.has(b.e.full)) continue;
			if (jaccard(toks.get(a.e.full)!, toks.get(b.e.full)!) >= threshold) group.push(b);
		}
		if (group.length < minMembers) continue;
		for (const g of group) seen.add(g.e.full);

		// The shared vocabulary is what makes a proposal reviewable: it shows the
		// reader WHY these were grouped, so a bad grouping is rejected in seconds
		// rather than argued with.
		let shared: Set<string> | null = null;
		for (const g of group) {
			const t = toks.get(g.e.full)!;
			shared = shared === null ? new Set(t) : new Set([...shared].filter((x) => t.has(x)));
		}
		const scores: number[] = [];
		for (let i = 1; i < group.length; i++) scores.push(jaccard(toks.get(group[0]!.e.full)!, toks.get(group[i]!.e.full)!));
		clusters.push({
			members: group.map((g) => ({ name: g.e.name, title: String(g.e.facets?.title ?? g.e.name), projects: g.e.facets?.projects ?? [], store: g.store })),
			shared: [...(shared ?? [])].slice(0, 12),
			score: +(scores.reduce((x, y) => x + y, 0) / scores.length).toFixed(3),
		});
	}
	return clusters.sort((x, y) => y.score - x.score);
}
