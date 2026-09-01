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
	const already = new RegExp(`^confirmations:.*${stamp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(text);
	if (already) {
		const n = Number((text.match(/^confirmed_count:\s*(\d+)/m) ?? [])[1] ?? 1);
		return { ok: true, count: n, detail: "already confirmed today by this caller" };
	}

	const count = Number((text.match(/^confirmed_count:\s*(\d+)/m) ?? [])[1] ?? 0) + 1;
	let out = text;
	out = /^confirmed_count:/m.test(out)
		? out.replace(/^confirmed_count:.*$/m, `confirmed_count: ${count}`)
		: out.replace(/^(scope: .+)$/m, `$1\nconfirmed_count: ${count}`);
	out = /^confirmations:/m.test(out)
		? out.replace(/^confirmations:(.*)$/m, (_m, rest) => `confirmations:${rest.replace(/\]\s*$/, "")}, ${JSON.stringify(stamp)}]`)
		: out.replace(/^(confirmed_count: .+)$/m, `$1\nconfirmations: [${JSON.stringify(stamp)}]`);
	try { writeFileSync(full, out); } catch (e) { return { ok: false, count: 0, detail: String((e as Error).message) }; }
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
