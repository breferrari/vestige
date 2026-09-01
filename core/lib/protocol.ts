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

Before reasoning from scratch about a past decision, prior art, or an error new
to this session: call \`search\` or \`recall\`. The store is the record;
your recollection of this session is not.

Before delegating discovery: search, then BRIEF THE CHILD. A sub-agent starts
empty, so searching and spawning in the same message hands it nothing and it
rediscovers what you just read. Open every such spawn with a \`KB context:\` block
of what the store said, or the line \`KB context: none relevant.\` If what you
found names the files, read them yourself instead of spawning.

When this work produces knowledge still true in a DIFFERENT repository, invoke
the capture skill. Do not ask permission, and do not write to a store directly —
the skill runs reach narrowing, the content gate and collision handling.
If it restates something already stored, supersede it rather than adding a twin.

A shared store is NOT this repo: it is a separate checkout inside the tree.
\`git add\` here stages nothing; address it with \`git -C <store>\`. Deleting from it
deletes for everyone, so deletions are held for review.

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
		id: "test",
		test: /\b(write|add|update) (the )?(unit |integration |e2e )?tests?\b|\btest coverage\b|\bwrite a test\b/i,
		advice: "Before writing tests: search the store by DOMAIN rather than by the error string — what is worth asserting here is exactly the kind of thing a previous session recorded.",
	},
	{
		id: "refactor",
		test: /\b(refactor|restructure|redesign|rewrite (this|the)|extract (a|the) (module|package|service|component|interface)|split (this|the) (module|package|file|service))\b/i,
		advice: "Refactoring: search first. A previous attempt, and the reason it was shaped this way, is the class of thing the store holds.",
	},
	{
		id: "ci",
		test: /\b(ci|pipeline|workflow|github actions|build (fails|failing|matrix)|release process|deploy(ment)?)\b/i,
		advice: "CI and release work: search the store — platform-specific traps and matrix quirks are the most expensive thing to rediscover.",
	},
	{
		id: "integrate",
		test: /\b(integrat\w+|new (dependency|library|service|provider)|wire up|hook (it )?up|add support for)\b/i,
		advice: "Adding an integration: search by the domain, not the library name — what bit last time may be recorded under the problem rather than the tool.",
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
