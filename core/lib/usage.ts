/**
 * Whether a memory has ever been useful, and to whom.
 *
 * Two signals, and they belong in different places — which is the whole design
 * decision here.
 *
 * RETRIEVAL is per-person and high-frequency. Recording it in the memory would
 * rewrite shared files on every search, turning a store people review in pull
 * requests into a stream of telemetry commits, and would leak who reads what.
 * So it lives in a local log that is never synced and never committed.
 *
 * CONFIRMATION is evidence and belongs to everyone. When a memory is acted on
 * and turns out to be right, that is the strongest thing anyone can say about
 * it, and the next reader deserves to see it. So it goes in the memory itself.
 *
 * Neither decays a memory automatically. Nothing here deletes or hides
 * anything: never-retrieved is not the same as useless — a memory nobody has
 * needed yet is exactly what a store is for — so this only ever breaks ties
 * that specificity and recency already left level.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vestigeHome } from "./stores.ts";

export interface UsageRecord {
	readonly retrieved: number;
	readonly last: string;
}

const logPath = () => join(vestigeHome(), "usage.json");

export function readUsage(): Record<string, UsageRecord> {
	try { return JSON.parse(readFileSync(logPath(), "utf8")); } catch { return {}; }
}

/**
 * Note that these memories were shown to someone. Best effort and never
 * throwing: a retrieval that fails to be logged must still be a retrieval.
 */
export function noteRetrieved(names: readonly string[], now: Date = new Date()): void {
	if (!names.length) return;
	try {
		const log = readUsage();
		const stamp = now.toISOString().slice(0, 10);
		for (const n of names) {
			const prev = log[n];
			(log as Record<string, UsageRecord>)[n] = { retrieved: (prev?.retrieved ?? 0) + 1, last: stamp };
		}
		mkdirSync(vestigeHome(), { recursive: true });
		writeFileSync(logPath(), JSON.stringify(log));
	} catch { /* telemetry must never cost a lookup */ }
}

/**
 * Record that a memory was acted on and proved correct.
 *
 * Written into the memory because it is evidence about the claim, not about the
 * reader. Idempotent per day per caller: confirming the same memory twice in a
 * session must not inflate the count, or the number stops meaning anything.
 */
export function confirmMemory(storePath: string, rel: string, by: string | null, now: Date = new Date()): { ok: boolean; count: number; detail: string } {
	const full = join(storePath, rel);
	if (!existsSync(full)) return { ok: false, count: 0, detail: `no such memory: ${rel}` };
	let text: string;
	try { text = readFileSync(full, "utf8"); } catch (e) { return { ok: false, count: 0, detail: String((e as Error).message) }; }

	const stamp = `${now.toISOString().slice(0, 10)}${by ? ` by ${by}` : ""}`;
	if (new RegExp(`^confirmations:.*${stamp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(text)) {
		const n = Number((text.match(/^confirmed_count:\s*(\d+)/m) ?? [])[1] ?? 1);
		return { ok: true, count: n, detail: "already confirmed today by this caller" };
	}

	const count = Number((text.match(/^confirmed_count:\s*(\d+)/m) ?? [])[1] ?? 0) + 1;

	/**
	 * Write into the frontmatter BLOCK, not next to a line that may not exist.
	 *
	 * The first version anchored on `^(scope: .+)$`. Files this system wrote
	 * always have that line, so it worked on the happy path and silently did
	 * nothing on anything else — an imported MCS memory has no frontmatter at
	 * all, and `scope:platform` or `Scope: project` miss the pattern too. It
	 * then wrote the file back unchanged and returned ok, so a confirmation
	 * could be reported, recorded nowhere, and never noticed. `import.mjs`
	 * exists specifically to ingest those files.
	 */
	const fm = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/);
	let out: string;
	if (fm) {
		let block = fm[2]!;
		block = /^confirmed_count:/m.test(block)
			? block.replace(/^confirmed_count:.*$/m, `confirmed_count: ${count}`)
			: `${block}\nconfirmed_count: ${count}`;
		block = /^confirmations:/m.test(block)
			? block.replace(/^confirmations:(.*)$/m, (_m, rest: string) => `confirmations:${rest.replace(/\]\s*$/, "")}, ${JSON.stringify(stamp)}]`)
			: `${block}\nconfirmations: [${JSON.stringify(stamp)}]`;
		out = `${fm[1]}${block}${fm[3]}${text.slice(fm[0].length)}`;
	} else {
		// No frontmatter — an imported file. Give it one rather than dropping the
		// confirmation on the floor.
		out = `---\nconfirmed_count: ${count}\nconfirmations: [${JSON.stringify(stamp)}]\n---\n\n${text.replace(/^\uFEFF/, "")}`;
	}

	if (out === text) return { ok: false, count: 0, detail: "nothing was written — the file did not accept a confirmation marker" };
	try { writeFileSync(full, out); } catch (e) { return { ok: false, count: 0, detail: String((e as Error).message) }; }

	// Read back. A confirmation that reports success and left no trace is the
	// bug this function already had once.
	try {
		if (!new RegExp(`^confirmed_count:\\s*${count}$`, "m").test(readFileSync(full, "utf8"))) {
			return { ok: false, count: 0, detail: "confirmation did not persist" };
		}
	} catch { /* the write succeeded; a failed verification read is not a failure to record */ }

	return { ok: true, count, detail: `confirmed ${count}x` };
}

/**
 * A small, bounded nudge for ranking — never a reordering of its own.
 *
 * A confirmed memory outranks an unconfirmed one only when everything the
 * filter and the ranker care about is already equal. The cap matters: without
 * it, one heavily-confirmed memory would outrank a more specific, more recent
 * one, and popularity would quietly replace relevance.
 */
export function usefulnessBonus(name: string, confirmedCount: number, log: Record<string, UsageRecord> = readUsage()): number {
	const retrieved = log[name]?.retrieved ?? 0;
	return Math.min(3, confirmedCount) * 2 + Math.min(2, retrieved > 0 ? 1 : 0);
}
