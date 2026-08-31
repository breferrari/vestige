/**
 * Inject the memory protocol, and nudge on signals.
 *
 * Once per session for the standing contract, then at most once per signal
 * class. Injecting on EVERY prompt is the reliable
 * choice and costs a paragraph of context per turn forever; a session that has
 * already been told does not need telling again, and text that appears every
 * turn is text that stops being read.
 *
 * Fails open and silent: any error prints nothing and exits 0. A hook that
 * breaks a turn is worse than a hook that misses one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL, signalsFor } from "../../core/lib/protocol.ts";
import { vestigeHome } from "../../core/lib/stores.ts";

try {
	let raw = "";
	try { raw = readFileSync(0, "utf8"); } catch { /* no stdin */ }
	let payload: Record<string, unknown> = {};
	try { payload = JSON.parse(raw || "{}"); } catch { /* not JSON */ }

	const session = String(payload.session_id ?? "nosession");
	const prompt = String(payload.prompt ?? "");
	const stateFile = join(vestigeHome(), "state", `${session.replace(/[^\w.-]/g, "_")}.json`);

	let seen: Record<string, boolean> = {};
	try { seen = JSON.parse(readFileSync(stateFile, "utf8")); } catch { /* first prompt of the session */ }

	const parts: string[] = [];
	if (!seen.protocol) { parts.push(PROTOCOL); seen.protocol = true; }
	for (const s of signalsFor(prompt)) {
		if (seen[s.id]) continue;
		seen[s.id] = true;
		parts.push(s.advice);
	}

	if (parts.length) {
		mkdirSync(join(vestigeHome(), "state"), { recursive: true });
		writeFileSync(stateFile, JSON.stringify(seen));
		process.stdout.write(`${parts.join("\n\n")}\n`);
	}
} catch { /* fail open, silently */ }
