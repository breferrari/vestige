/**
 * The memory protocol — the text that makes an agent USE the store.
 *
 * Plumbing without a trigger is a store nobody writes to. `remember` and
 * `search` existed for a while with nothing that ever called them, which is the
 * failure mode this file exists to prevent.
 *
 * Kept here, in the core, rather than inside a host's hook: Claude Code can
 * inject it at a turn boundary and Codex cannot, so Codex carries the same text
 * in AGENTS.md. One source, two deliveries — if the two drift, one host quietly
 * gets a different contract.
 */

/** The standing contract. Injected once per session, not once per turn. */
export const PROTOCOL = `MEMORY PROTOCOL

Before reasoning from scratch about a past decision, prior art, or an error you
have not seen in this session: call \`search\` or \`recall\` first. The store is
the record; your recollection of this session is not.

Before delegating discovery to a sub-agent: search first. A sub-agent starts
without what you already know, and rediscovering something the store already
holds costs far more than the lookup.

When this work produces knowledge that would still be true and still useful in a
DIFFERENT repository, invoke the capture skill. Do not ask permission, and do
not write into a memory store directly — the skill is what runs the reach
narrowing, the content gate and the collision handling.

Most sessions produce nothing worth keeping. That is the expected outcome.`;

/** Fired when a prompt looks like the situation the protocol is about. */
export const SIGNALS: readonly { id: string; test: RegExp; advice: string }[] = [
	{
		id: "debug",
		test: /\b(error|exception|failing|failed|broken|crash|stack trace|regress\w*|flaky|hangs?|times? out|why (is|does|isn't|doesn't))\b/i,
		advice: "Debugging: search the memory store before reasoning from scratch — this class of failure may already be recorded.",
	},
	{
		id: "decision",
		test: /\b(should we|let's use|from now on|we (decided|agreed)|instead of|trade[- ]?off|which (approach|library|pattern))\b/i,
		advice: "A decision is being made: check whether one already exists on this, and capture the outcome if it is deliberate and has a reason.",
	},
	{
		id: "convention",
		test: /\b(convention|style|always|never|standard|pattern|the way we)\b/i,
		advice: "A convention may be forming: it qualifies as a memory only if something backs it — lint config, a doc, team agreement, or consistent existing use.",
	},
	{
		id: "retro",
		test: /\b(remember (this|that)|save (this|what)|retrospective|extract learnings|what did we learn|wrap ?up)\b/i,
		advice: "Explicit capture request: invoke the capture skill.",
	},
];

export function signalsFor(prompt: string): { id: string; advice: string }[] {
	const out: { id: string; advice: string }[] = [];
	for (const s of SIGNALS) {
		try { if (s.test.test(prompt)) out.push({ id: s.id, advice: s.advice }); } catch { /* a broken pattern must not break the turn */ }
	}
	return out;
}
