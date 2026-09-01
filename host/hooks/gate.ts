/**
 * Keep memory lookups ahead of delegated discovery.
 *
 * A sub-agent spawned to "go find out how X works" starts with none of what the
 * session already knows, and none of what the store holds. The lookup costs one
 * round trip; the rediscovery costs the whole sub-agent. So: search first.
 *
 * DESIGN RULES, deliberate and load-bearing — taken from MCS's kb-gate, which
 * learned them the hard way:
 *
 *   FAIL OPEN. Any unexpected state exits 0 with no output.
 *   NEVER hard-block. The default mode ADVISES. A script bug must not become a
 *     gate with no escape, and the cost of a missed search is bounded while the
 *     cost of an unbreakable gate is a session that cannot proceed at all.
 *   NEVER call the search engine from here. This runs before every sub-agent
 *     spawn; it does file stats and nothing else.
 *   BUDGETS. Even advice stops after a few nudges in one turn, so a
 *     search-then-spawn loop cannot be driven by this hook.
 *
 * Modes via VESTIGE_GATE: advise (default) | enforce | off.
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { vestigeHome } from "../../core/lib/stores.ts";

const MAX_PER_TURN = 3;
// A delegation whose PostToolUse never arrives (aborted, crashed) must not pin
// the barrier open forever; past this the next prompt starts a fresh turn.
const DELEGATION_TTL_MS = 10 * 60 * 1000;
// The child brief. Deliberately a shape check and not a quality check: whether
// the bullets are GOOD is a judgement this hook has no way to make, and a gate
// that guesses at quality is a gate that argues with correct work.
// Matched anywhere, not anchored to a line start: the description and the
// prompt are concatenated with a space before this runs, so a line-anchored
// pattern would silently depend on WHICH field carried the block.
const BRIEFED = /\bKB context\s*:/i;
const DISCOVERY = /\b(find|search|investigate|explore|discover|look (in|into|at)|figure out|understand|research|locate|where is|how does)\b/i;

try {
	const mode = process.env.VESTIGE_GATE ?? "advise";
	if (mode === "off") process.exit(0);

	let payload: Record<string, any> = {};
	try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }

	const event = String(payload.hook_event_name ?? "");
	const session = String(payload.session_id ?? "nosession").replace(/[^\w.-]/g, "_");
	const dir = join(vestigeHome(), "state");
	const f = join(dir, `gate-${session}.json`);

	let st: { turn: number; searched: boolean; nudges: number; depth: number; depthTs: number } = { turn: 0, searched: false, nudges: 0, depth: 0, depthTs: 0 };
	try { st = { ...st, ...JSON.parse(readFileSync(f, "utf8")) }; } catch { /* fresh */ }
	const save = () => { try { mkdirSync(dir, { recursive: true }); writeFileSync(f, JSON.stringify(st)); } catch { /* best effort */ } };

	// Every decision this hook makes is invisible otherwise: a nudge that fired
	// and a nudge that was never reached look identical from the state file, and
	// so do a matcher that never matched and a tool that was never called.
	const audit = (decision: string, extra: Record<string, unknown> = {}) => {
		try {
			mkdirSync(dir, { recursive: true });
			const line = JSON.stringify({ ts: new Date().toISOString(), session, event, tool: payload.tool_name ?? null, decision, ...st, ...extra });
			const logf = join(dir, "gate-log.jsonl");
			// Bounded: a hook that grows a file forever is a hook that fills a disk.
			try { if (statSync(logf).size > 512_000) { const keep = readFileSync(logf, "utf8").split("\n").slice(-2000).join("\n"); writeFileSync(logf, keep); } } catch { /* first write */ }
			appendFileSync(logf, `${line}\n`);
		} catch { /* best effort */ }
	};

	// A new turn resets the barrier: a search from three turns ago is not
	// evidence that THIS delegation is informed.
	if (event === "UserPromptSubmit") {
		// A sub-agent's prompt arrives on this same hook, with the same session id
		// and the same transcript path — nothing in the payload distinguishes it.
		// Left alone it resets the barrier the parent's delegation just tripped,
		// which silently voids both the per-turn nudge budget and the record that
		// the parent already searched. So: a prompt during an in-flight delegation
		// is the sub-agent's, and does not start a new turn.
		const inFlight = st.depth > 0 && Date.now() - (st.depthTs || 0) < DELEGATION_TTL_MS;
		if (inFlight) { audit("subagent-prompt-ignored"); process.exit(0); }
		st.turn++; st.searched = false; st.nudges = 0; st.depth = 0; save();
		audit("turn-reset");
		process.exit(0);
	}

	// Record that the session actually consulted the store.
	if (event === "PostToolUse") {
		const tool = String(payload.tool_name ?? "");
		if (/^(Task|Agent)$/i.test(tool)) { st.depth = Math.max(0, st.depth - 1); save(); audit("delegation-returned"); process.exit(0); }
		if (/vestige.*(search|recall)|(search|recall).*vestige/i.test(tool)) { st.searched = true; save(); audit("store-consulted"); }
		else audit("post-ignored");
		process.exit(0);
	}

	if (event !== "PreToolUse") process.exit(0);
	const tool = String(payload.tool_name ?? "");
	if (!/^(Task|Agent)$/i.test(tool)) { audit("skip-not-delegation"); process.exit(0); }
	// Count the delegation before deciding, so every outcome marks it in flight.
	st.depth++; st.depthTs = Date.now(); save();

	if (st.nudges >= MAX_PER_TURN) { audit("allow-budget-spent"); process.exit(0); }

	const desc = `${payload.tool_input?.description ?? ""} ${payload.tool_input?.prompt ?? ""}`;
	if (!DISCOVERY.test(desc)) { audit("allow-not-discovery"); process.exit(0); }

	// Searching is necessary and not sufficient. A parent that searched and then
	// spawned in the same message has handed the child NOTHING — the child starts
	// empty and rediscovers what the parent just read. What releases the barrier
	// is evidence in the spawn prompt that the child was briefed.
	if (BRIEFED.test(desc)) { audit("allow-briefed"); process.exit(0); }

	st.nudges++; save(); audit(st.searched ? "NUDGE-unbriefed" : "NUDGE-unsearched");
	const reason = st.searched
		? "This spawn carries no `KB context:` block. You searched, but the sub-agent starts empty — pass what you found as `KB context:` bullets, or the line `KB context: none relevant.` if the store had nothing."
		: "About to delegate discovery without consulting the memory store. Call `search` or `recall` first, then open the spawn prompt with a `KB context:` block — the sub-agent starts without what the store already holds.";

	if (mode === "enforce") {
		process.stdout.write(JSON.stringify({
			hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason },
		}));
	} else {
		process.stdout.write(`${reason}\n`);
	}
} catch { /* fail open */ }
