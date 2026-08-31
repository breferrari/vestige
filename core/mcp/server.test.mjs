import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every advertised tool must actually run.
 *
 * `explain` was deleted from the library by an edit that replaced a trailing
 * region of the file, while the server went on advertising and calling it. The
 * unit tests passed — they test the library, and the deleted function simply
 * stopped being covered — and nothing failed until a diagnostic happened to
 * call it. A tool list is a promise; this is the test that the promise is kept.
 */
const SERVER = join(dirname(fileURLToPath(import.meta.url)), "server.mjs");

function rpc(lines, env = {}) {
	const out = execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", SERVER], {
		input: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
		encoding: "utf8",
		env: { ...process.env, VESTIGE_HOME: mkdtempSync(join(tmpdir(), "vh-")), ...env },
	});
	return out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("mcp server", () => {
	test("initialize and advertise tools", () => {
		const [init, list] = rpc([
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
		]);
		assert.equal(init.result.serverInfo.name, "vestige");
		assert.ok(list.result.tools.length >= 5);
	});

	test("EVERY advertised tool actually executes", () => {
		const [, list] = rpc([
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
		]);
		const names = list.result.tools.map((t) => t.name);
		const args = { remember: { title: "T", body: "A body long enough to clear the minimum length that the write contract enforces.", confidence: "inferred", scope: "general", projects: [], generality: "test" }, search: { query: "anything" } };
		const calls = names.map((n, i) => ({ jsonrpc: "2.0", id: 10 + i, method: "tools/call", params: { name: n, arguments: args[n] ?? {} } }));
		const res = rpc([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, ...calls]);
		const failures = [];
		for (const r of res) {
			if (r.id < 10) continue;
			const name = names[r.id - 10];
			if (r.error) failures.push(`${name}: ${r.error.message}`);
			else if (!r.result?.content?.[0]?.text) failures.push(`${name}: returned no content`);
			else if (/is not a function|undefined is not|TypeError/.test(r.result.content[0].text)) failures.push(`${name}: ${r.result.content[0].text.slice(0, 80)}`);
		}
		assert.deepEqual(failures, [], `advertised tools that do not work:\n  ${failures.join("\n  ")}`);
	});
});
