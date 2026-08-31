#!/usr/bin/env node
/**
 * Vestige installer. Host-agnostic on purpose.
 *
 *   node core/setup/install.mjs [--codex] [--claude] [--no-update]
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
const argv = new Set(process.argv.slice(2));
const say = (s) => process.stdout.write(`${s}\n`);

const { ensureQmd, vestigeHome } = await import(pathToFileURL(join(ROOT, "core", "setup", "qmd.ts")).href);

say("Vestige install\n");

// 1 — qmd
const q = ensureQmd({ update: !argv.has("--no-update") });
say(q.ok ? `  qmd            ${q.detail}` : `  qmd            FAILED — ${q.detail}`);
if (!q.ok) {
	say("\n  Retrieval will be badly degraded without qmd: the reach filter still");
	say("  protects what you can see, but rank-1 accuracy drops from 0.98 to 0.09.");
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
	const guidance = readFileSync(join(ROOT, "hosts", "codex", "AGENTS.md"), "utf8");
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

if (!argv.has("--codex") && !argv.has("--claude")) {
	say("\n  No host selected. Pass --claude and/or --codex, or install the Claude Code");
	say("  plugin (which registers the server itself).");
}
say("\nDone.");
