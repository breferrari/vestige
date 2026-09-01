import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The gate had no tests. MCS ships thirty for its equivalent, and the reason is
 * visible in the design rules: this thing runs before every sub-agent spawn, it
 * must fail open, and it must never become a hard block. Every one of those
 * properties fails SILENTLY when it breaks — a gate that never fires and a gate
 * that has no work to do look identical.
 */
const HOOK = join(import.meta.dirname, "gate.ts");
let home: string;

const run = (payload: Record<string, unknown>, env: Record<string, string> = {}): string => {
	try {
		return execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", HOOK], {
			input: JSON.stringify(payload), encoding: "utf8",
			env: { ...process.env, VESTIGE_HOME: home, ...env },
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (e: any) {
		// a non-zero exit is itself a failure of the fail-open rule
		throw new Error(`hook exited non-zero: ${e?.status} ${e?.stderr}`);
	}
};
const turn = (s = "t") => run({ hook_event_name: "UserPromptSubmit", session_id: s });
const spawn = (desc: string, s = "t", env = {}) => run({ hook_event_name: "PreToolUse", session_id: s, tool_name: "Task", tool_input: { description: desc } }, env);
const BRIEF = "KB context:\n- retries use full jitter, see the sync note\n";
const briefedSpawn = (desc: string, s = "t", env = {}) => run({ hook_event_name: "PreToolUse", session_id: s, tool_name: "Task", tool_input: { description: desc, prompt: BRIEF } }, env);
const returned = (s = "t") => run({ hook_event_name: "PostToolUse", session_id: s, tool_name: "Task" });
const searched = (s = "t") => run({ hook_event_name: "PostToolUse", session_id: s, tool_name: "mcp__vestige__search" });

beforeEach(() => { home = mkdtempSync(join(tmpdir(), "gate-")); });

describe("the barrier", () => {
	test("discovery delegation without a search is advised against", () => {
		turn();
		assert.match(spawn("find out how auth works"), /search|recall/i);
	});

	/**
	 * The contract this hook enforces changed once it was watched in a live
	 * session: SEARCHING IS NOT SUFFICIENT. A parent that searched and then
	 * spawned in the same message has handed the child nothing — the child
	 * starts empty and rediscovers what the parent just read, which is the whole
	 * cost the store exists to avoid. What releases the barrier is evidence in
	 * the spawn prompt that the child was briefed.
	 */
	test("a search alone does not release it — the child still gets nothing", () => {
		turn(); searched();
		assert.match(spawn("find out how auth works"), /KB context/i, "a searched-but-unbriefed spawn must still be advised against");
	});
	test("the advice names the missing half: brief, not search", () => {
		turn(); searched();
		const out = spawn("find out how auth works");
		assert.match(out, /You searched/i, "telling someone who just searched to search again is how advice gets ignored");
	});
	test("a KB context block releases it", () => {
		turn();
		assert.equal(briefedSpawn("find out how auth works").trim(), "", "a briefed spawn is the outcome this hook wants; it must be silent");
	});
	test("a brief releases it even without a search — the child has what it needs either way", () => {
		turn();
		assert.equal(briefedSpawn("find out how auth works").trim(), "");
	});
	test("the block is checked for SHAPE, never for quality", () => {
		turn();
		// `KB context: none relevant.` is a legitimate brief: the parent searched
		// and found nothing, and the child must not repeat that search. A gate
		// that judged the bullets would reject this correct case.
		const out = run({ hook_event_name: "PreToolUse", session_id: "t", tool_name: "Task", tool_input: { description: "find out how auth works", prompt: "KB context: none relevant." } });
		assert.equal(out.trim(), "");
	});
});

describe("what it does not touch", () => {
	test("non-discovery delegation passes", () => {
		turn();
		assert.equal(spawn("rename the variable across three files").trim(), "");
	});
	test("a non-Task tool passes", () => {
		turn();
		assert.equal(run({ hook_event_name: "PreToolUse", session_id: "t", tool_name: "Bash", tool_input: { command: "ls" } }).trim(), "");
	});
	test("an unrelated event passes", () => {
		assert.equal(run({ hook_event_name: "SessionStart", session_id: "t" }).trim(), "");
	});
});

describe("fail open, always", () => {
	test("empty payload does not throw or block", () => {
		assert.equal(run({}).trim(), "");
	});
	test("garbage stdin does not throw or block", () => {
		const out = execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", HOOK], {
			input: "not json at all", encoding: "utf8", env: { ...process.env, VESTIGE_HOME: home },
		});
		assert.equal(out.trim(), "");
	});
	test("mode off emits nothing even when it would otherwise fire", () => {
		turn();
		assert.equal(spawn("find out how auth works", "t", { VESTIGE_GATE: "off" }).trim(), "");
	});
	test("enforce mode asks, and still never hard-blocks", () => {
		turn();
		const out = spawn("find out how auth works", "t", { VESTIGE_GATE: "enforce" });
		const parsed = JSON.parse(out);
		assert.equal(parsed.hookSpecificOutput.permissionDecision, "ask");
		assert.notEqual(parsed.hookSpecificOutput.permissionDecision, "deny");
	});
});

describe("budget", () => {
	test("nudges stop after the per-turn cap, so it cannot drive a loop", () => {
		turn();
		const fired = [1, 2, 3, 4, 5, 6].map(() => spawn("find out how auth works").trim() !== "").filter(Boolean).length;
		assert.equal(fired, 3, `expected exactly 3 nudges before the budget stops it, got ${fired}`);
	});
	test("the budget resets on a new turn", () => {
		turn();
		for (const _ of [1, 2, 3, 4]) spawn("find out how auth works");
		assert.equal(spawn("find out how auth works").trim(), "");
		for (const _ of [1, 2, 3, 4, 5]) returned();
		turn();
		assert.match(spawn("find out how auth works"), /search|recall/i);
	});
});

describe("session isolation", () => {
	test("one session's search does not leak into another's advice", () => {
		turn("a"); turn("b"); searched("a");
		assert.match(spawn("find out how auth works", "a"), /You searched/i, "session a searched: it needs the brief advice");
		assert.match(spawn("find out how auth works", "b"), /without consulting/i, "session b never searched: it needs the search advice");
	});
});

describe("sub-agent prompts", () => {
	/**
	 * Found live, not in a unit test: a sub-agent's prompt arrives on this same
	 * UserPromptSubmit hook carrying the parent's session id AND the parent's
	 * transcript path, so nothing in the payload distinguishes it. Treated as a
	 * new turn it silently voids both guarantees this hook exists to provide —
	 * the parent's search is forgotten and the per-turn nudge budget resets, so
	 * a delegating session can be nudged without limit.
	 */
	test("a prompt during an in-flight delegation does not forget the parent's search", () => {
		turn(); searched();
		assert.match(spawn("find out how auth works"), /You searched/i);
		turn(); // the sub-agent's prompt, indistinguishable from the user's
		assert.match(spawn("find out how auth works"), /You searched/i, "the parent's search must survive the child's prompt");
	});

	test("a prompt during an in-flight delegation does not refill the nudge budget", () => {
		turn();
		const before = [1, 2, 3, 4].map(() => spawn("find out how auth works").trim() !== "").filter(Boolean).length;
		assert.equal(before, 3);
		turn(); // sub-agent prompt
		assert.equal(spawn("find out how auth works").trim(), "", "budget must not refill mid-delegation");
	});

	/**
	 * The accepted cost of the fix above: a prompt sent while a delegation is
	 * genuinely still in flight is indistinguishable from the sub-agent's, so the
	 * barrier does not re-arm and the previous turn's search still counts.
	 * Bounded by DELEGATION_TTL_MS. Written down as a test because a trade-off
	 * nobody encoded is a bug the next session will "fix" back.
	 */
	test("a user prompt during a live delegation carries the previous turn's search", () => {
		turn(); searched();
		spawn("find out how auth works");
		turn();
		assert.match(spawn("find out how auth works"), /You searched/i);
	});

	test("once the delegation returns, the next prompt does start a new turn", () => {
		turn();
		for (const _ of [1, 2, 3, 4]) spawn("find out how auth works");
		for (const _ of [1, 2, 3, 4]) returned();
		turn();
		assert.match(spawn("find out how auth works"), /search|recall/i, "a genuinely new turn must nudge again");
	});
});
