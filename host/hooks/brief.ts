/**
 * What a sub-agent is told before it starts.
 *
 * A child begins with none of the parent's context, which is the whole reason
 * delegation loses memory: the parent reads the store, spawns, and the child
 * rediscovers the same thing from the tree at the cost of an entire agent.
 *
 * The parent's half of the contract is the `KB context:` block the gate asks
 * for. This is the child's half — and the two must not both search. If the
 * brief is present the child TRUSTS it and goes straight to the code; if it is
 * absent the child runs exactly ONE search and then stops looking.
 *
 * Fails open and silent, like every hook here: a broken hook must never be able
 * to stop a sub-agent from running.
 */
import { readFileSync } from "node:fs";

try {
	let raw = "";
	try { raw = readFileSync(0, "utf8"); } catch { /* no stdin */ }
	let payload: Record<string, any> = {};
	try { payload = JSON.parse(raw || "{}"); } catch { /* not JSON */ }

	// The field carrying the child's task has moved between releases, so read
	// every plausible one rather than depending on a single name.
	const task = [payload.prompt, payload.task, payload.description, payload.tool_input?.prompt, payload.tool_input?.description]
		.filter((x) => typeof x === "string")
		.join("\n");

	const briefed = /(^|\n)\s*KB context:/i.test(task);

	const lines = briefed
		? [
			"MEMORY: your prompt carries a `KB context:` block. Treat it as already-searched —",
			"do not call `search` or `recall` to re-derive it. Go to the code. Search only if you",
			"hit something the block does not cover.",
		]
		: [
			"MEMORY: your prompt carries no `KB context:` block, so nothing has been looked up",
			"for you. Call `search` ONCE with the domain of the task — not the literal error",
			"string — then go to the code. One lookup, not a habit: repeated searching from a",
			"sub-agent is the cost this store exists to avoid.",
		];

	process.stdout.write(`${lines.join("\n")}\n`);
} catch { /* fail open, silently */ }
