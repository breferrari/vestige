#!/usr/bin/env node
/**
 * Vestige installer. Host-agnostic on purpose.
 *
 *   node core/setup/install.mjs [--codex] [--claude] [--team] [--no-update]
 *                                [--keep-auto-memory] [--team-url=] [--team-branch=] [--team-mode=]
 *
 * Does three things and prints what it did:
 *   1. provisions qmd (a hard dependency — see core/setup/qmd.ts)
 *   2. creates the global store
 *   3. registers the MCP server with whichever hosts were asked for
 *
 * The Claude Code plugin does NOT need step 3 — installing the plugin registers
 * the server. It is here for Codex, and for using Vestige without the plugin.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SERVER = join(ROOT, "core", "mcp", "server.mjs");
const rawArgs = process.argv.slice(2);
const argv = new Set(rawArgs.filter((a) => !a.includes("=")));
const flag = (name) => { const hit = rawArgs.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : null; };
const say = (s) => process.stdout.write(`${s}\n`);

const { ensureQmd, vestigeHome } = await import(pathToFileURL(join(ROOT, "core", "setup", "qmd.ts")).href);

say("Vestige install\n");

// 1 — qmd
const q = ensureQmd({ update: !argv.has("--no-update") });
say(q.ok ? `  qmd            ${q.detail}` : `  qmd            FAILED — ${q.detail}`);
if (!q.ok) {
	say("\n  Retrieval will be badly degraded without qmd: the reach filter still");
	say("  protects what you can see, but the right memory is first 4% of the time instead of 45%.");
}

// 2 — the global store
const store = process.env.VESTIGE_GLOBAL ?? join(vestigeHome(), "memories");
mkdirSync(store, { recursive: true });
say(`  global store   ${store}`);

// 3 — host registration
const launch = { command: process.execPath, args: ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", SERVER] };

if (argv.has("--codex")) {
	// Codex reads [mcp_servers.<name>] from config.toml at startup.
	const cfg = join(homedir(), ".codex", "config.toml");
	mkdirSync(dirname(cfg), { recursive: true });
	const existing = existsSync(cfg) ? readFileSync(cfg, "utf8") : "";
	if (existing.includes("[mcp_servers.vestige]")) {
		say("  codex          already registered in ~/.codex/config.toml");
	} else {
		const block = `\n[mcp_servers.vestige]\ncommand = ${JSON.stringify(launch.command)}\nargs = [${launch.args.map((a) => JSON.stringify(a)).join(", ")}]\n`;
		writeFileSync(cfg, existing + block);
		say("  codex          registered in ~/.codex/config.toml (restart Codex — config is read at startup)");
	}
	const agents = join(homedir(), ".codex", "AGENTS.md");
	const guidance = readFileSync(join(ROOT, "codex", "AGENTS.md"), "utf8");
	const prev = existsSync(agents) ? readFileSync(agents, "utf8") : "";
	if (!prev.includes("<!-- vestige -->")) {
		writeFileSync(agents, `${prev}\n${guidance}`);
		say("  codex          memory guidance appended to ~/.codex/AGENTS.md");
	}
}

if (argv.has("--claude")) {
	// Only needed WITHOUT the plugin; installing the plugin registers the server.
	try {
		execFileSync("claude", ["mcp", "add", "vestige", "--", launch.command, ...launch.args], { stdio: "ignore" });
		say("  claude code    registered via `claude mcp add`");
	} catch {
		say("  claude code    could not run `claude mcp add` — install the plugin instead, which registers it for you");
	}
}

// 4 — Claude Code's own auto memory
//
// Two memory stores in one session is worse than either alone: the model writes
// to whichever is closer and ends up trusting neither. This is a change to the
// user's settings, so it is stated plainly rather than done quietly, and it is
// one flag to decline and one edit to undo.
if (argv.has("--claude") && !argv.has("--keep-auto-memory")) {
	const settingsFile = join(homedir(), ".claude", "settings.json");
	try {
		let settings = {};
		if (existsSync(settingsFile)) settings = JSON.parse(readFileSync(settingsFile, "utf8"));
		if (settings.autoMemoryEnabled === false) {
			say("  claude memory  built-in auto memory already off");
		} else {
			settings.autoMemoryEnabled = false;
			mkdirSync(dirname(settingsFile), { recursive: true });
			writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
			say("  claude memory  TURNED OFF Claude Code's built-in auto memory");
			say("                 `autoMemoryEnabled: false` written to ~/.claude/settings.json.");
			say("                 Two stores in one session means the model writes to whichever is");
			say("                 nearer and trusts neither. Re-run with --keep-auto-memory to skip");
			say("                 this, or set the key back to true whenever you like.");
		}
	} catch (e) {
		say(`  claude memory  could not update ~/.claude/settings.json — ${e.message}`);
		say("                 Set `autoMemoryEnabled: false` by hand, or Claude Code keeps its own store too.");
	}
}

// 5 — the team store
//
// `.vestige/config.json` is the right shape and stays unused if nobody writes
// it. This asks the three questions that produce one, and probes the remote
// before writing: a store pointing at an unreachable repository presents later
// as an empty directory, which is indistinguishable from an empty store.
if (argv.has("--team")) {
	const ask = async (q, dflt) => {
		const pre = flag(q.key);
		if (pre !== null) return pre;
		if (!process.stdin.isTTY) return dflt;
		const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
		const a = (await rl.question(`  ${q.text}${dflt ? ` [${dflt}]` : ""}: `)).trim();
		rl.close();
		return a || dflt;
	};
	const url = await ask({ key: "team-url", text: "memories repository URL" }, "");
	if (!url) {
		say("  team store     skipped — no repository URL given");
	} else {
		const branch = await ask({ key: "team-branch", text: "branch" }, "main");
		const mode = await ask({ key: "team-mode", text: "sync mode (auto | full | review)" }, "auto");
		let reachable = false;
		try { execFileSync("git", ["ls-remote", "--exit-code", url, branch], { stdio: "ignore", timeout: 20000 }); reachable = true; } catch { /* reported below */ }
		if (!reachable) {
			say(`  team store     NOT written — cannot reach ${url} on branch ${branch}`);
			say("                 A missing SSH key, a revoked grant and a wrong branch all look");
			say("                 the same later: one empty directory. Fix the access first.");
		} else {
			const root = (() => { try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } })();
			const target = root ? join(root, ".vestige", "config.json") : join(vestigeHome(), "config.json");
			let cfg = { stores: [] };
			if (existsSync(target)) { try { cfg = JSON.parse(readFileSync(target, "utf8")); } catch { /* replaced below */ } }
			if (!Array.isArray(cfg.stores)) cfg.stores = [];
			cfg.stores = cfg.stores.filter((s) => s.name !== "team");
			// Ordered before the catch-all: the first store accepting a scope wins,
			// so a team store appended after `personal` would never receive anything.
			cfg.stores = [
				{ name: "project", kind: "repo", path: ".vestige/memories", accepts: ["project"] },
				{ name: "team", kind: "external", path: ".vestige/team", url, branch, accepts: ["platform", "general"] },
				{ name: "personal", kind: "local", path: "memories", accepts: ["*"] },
			];
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, `${JSON.stringify(cfg, null, 2)}\n`);
			say(`  team store     ${target}`);
			say(`                 ${url} (${branch}), sync mode ${mode}`);
			if (mode !== "auto") say(`                 set VESTIGE_SYNC=${mode} in your environment for that mode`);
		}
	}
}

if (!argv.has("--codex") && !argv.has("--claude")) {
	say("\n  No host selected. Pass --claude and/or --codex, or install the Claude Code");
	say("  plugin (which registers the server itself).");
}
say("\nDone.");
