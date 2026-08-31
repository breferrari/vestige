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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vestigeHome } from "../../core/lib/stores.ts";

const MAX_PER_TURN = 3;
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

	let st: { turn: number; searched: boolean; nudges: number } = { turn: 0, searched: false, nudges: 0 };
	try { st = { ...st, ...JSON.parse(readFileSync(f, "utf8")) }; } catch { /* fresh */ }
	const save = () => { try { mkdirSync(dir, { recursive: true }); writeFileSync(f, JSON.stringify(st)); } catch { /* best effort */ } };

	// A new turn resets the barrier: a search from three turns ago is not
	// evidence that THIS delegation is informed.
	if (event === "UserPromptSubmit") { st.turn++; st.searched = false; st.nudges = 0; save(); process.exit(0); }

	// Record that the session actually consulted the store.
	if (event === "PostToolUse") {
		const tool = String(payload.tool_name ?? "");
		if (/vestige.*(search|recall)|(search|recall).*vestige/i.test(tool)) { st.searched = true; save(); }
		process.exit(0);
	}

	if (event !== "PreToolUse") process.exit(0);
	const tool = String(payload.tool_name ?? "");
	if (!/^(Task|Agent)$/i.test(tool)) process.exit(0);
	if (st.searched) process.exit(0);
	if (st.nudges >= MAX_PER_TURN) process.exit(0);

	const desc = `${payload.tool_input?.description ?? ""} ${payload.tool_input?.prompt ?? ""}`;
	if (!DISCOVERY.test(desc)) process.exit(0);

	st.nudges++; save();
	const reason = "About to delegate discovery without consulting the memory store. Call `search` or `recall` first — the sub-agent starts without what the store already holds.";

	if (mode === "enforce") {
		process.stdout.write(JSON.stringify({
			hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason },
		}));
	} else {
		process.stdout.write(`${reason}\n`);
	}
} catch { /* fail open */ }
