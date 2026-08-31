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
const searched = (s = "t") => run({ hook_event_name: "PostToolUse", session_id: s, tool_name: "mcp__vestige__search" });

beforeEach(() => { home = mkdtempSync(join(tmpdir(), "gate-")); });

describe("the barrier", () => {
	test("discovery delegation without a search is advised against", () => {
		turn();
		assert.match(spawn("find out how auth works"), /search|recall/i);
	});
	test("a search in the same turn releases it", () => {
		turn(); searched();
		assert.equal(spawn("find out how auth works").trim(), "");
	});
	test("a new turn re-arms it — a stale search is not evidence", () => {
		turn(); searched();
		assert.equal(spawn("find out how auth works").trim(), "");
		turn();
		assert.match(spawn("find out how auth works"), /search|recall/i);
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
		turn();
		assert.match(spawn("find out how auth works"), /search|recall/i);
	});
});

describe("session isolation", () => {
	test("one session's search does not release another's barrier", () => {
		turn("a"); turn("b"); searched("a");
		assert.equal(spawn("find out how auth works", "a").trim(), "");
		assert.match(spawn("find out how auth works", "b"), /search|recall/i);
	});
});
