import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { signalsFor, PROTOCOL } from "./protocol.ts";

/**
 * The classifiers are prose-shaped and therefore easy to assert into looking
 * good. Both directions are measured: a signal that fires on everything is as
 * useless as one that fires on nothing, and the second failure is the one that
 * hides — nobody notices advice that never appears.
 */
const SHOULD_FIRE: [string, string][] = [
	["debug", "the build is failing with a weird error about missing symbols"],
	["debug", "why does this test only fail on CI"],
	["debug", "the service hangs after about a minute under load"],
	["debug", "getting a stack trace from the auth middleware"],
	["debug", "this is flaky, it passes locally"],
	["decision", "should we use redis instead of memcached here"],
	["decision", "let's use the repository pattern from now on"],
	["decision", "which library should we pick for date handling"],
	["decision", "there's a trade-off between latency and consistency"],
	["convention", "what's the convention for naming these files"],
	["retro", "remember this for next time"],
	["retro", "extract learnings from what we just did"],
	["retro", "let's wrap up"],
];

const SHOULD_NOT_FIRE: string[] = [
	"rename this variable across the three files",
	"add a docstring to the parser",
	"bump the dependency to 4.2",
	"format this file",
	"write a unit test for the happy path",
	"what does this function return",
	"delete the unused import",
	"open the config file",
];

describe("signal classification", () => {
	test("every should-fire prompt fires its class", () => {
		const missed: string[] = [];
		for (const [cls, prompt] of SHOULD_FIRE) {
			if (!signalsFor(prompt).some((s) => s.id === cls)) missed.push(`${cls}: ${prompt}`);
		}
		assert.deepEqual(missed, [], `missed signals:\n  ${missed.join("\n  ")}`);
	});

	test("ordinary edit requests fire nothing", () => {
		const spurious = SHOULD_NOT_FIRE.filter((p) => signalsFor(p).length > 0)
			.map((p) => `${p} -> ${signalsFor(p).map((s) => s.id)}`);
		assert.deepEqual(spurious, [], `fired on routine work:\n  ${spurious.join("\n  ")}`);
	});

	test("the protocol says the three things it has to say", () => {
		assert.match(PROTOCOL, /search|recall/i);
		assert.match(PROTOCOL, /sub-agent/i);
		assert.match(PROTOCOL, /capture skill/i);
		// and sets the expectation that most sessions capture nothing
		assert.match(PROTOCOL, /nothing worth keeping/i);
	});

	test("it is short enough to be read every session", () => {
		assert.ok(PROTOCOL.length < 1200, `protocol is ${PROTOCOL.length} chars; it is injected per session and competes with the user's own context`);
	});
});
