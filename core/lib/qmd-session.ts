/**
 * A persistent qmd process, so a search does not pay model loading every time.
 *
 * Spawning the CLI per query costs ~1.6s, nearly all of it loading the embedding
 * model into a process that then exits. That is the difference between a search
 * an agent calls freely mid-reasoning and one it learns to avoid — and the
 * protocol explicitly asks it to search before answering, so a slow search
 * quietly undoes the behavioural layer.
 *
 * `qmd mcp` speaks MCP over stdio, so it can be spawned once and kept. Models
 * stay resident and subsequent queries are a round trip.
 *
 * TWO THINGS THIS HAS TO GET RIGHT, both learned rather than assumed:
 *
 *   - The server reads its COLLECTION LIST once at startup. A view rebuilt after
 *     the server booted is invisible to it, so the session is keyed on the view
 *     signature and respawned when that changes. (Noted in mcs-cli/memory's qmd
 *     branch, which hit the same thing from the config side.)
 *   - It must never become a way for search to hang. Every call is deadlined,
 *     and any failure tears the session down and falls back to the CLI rather
 *     than leaving a half-dead child in the path of the next query.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { qmdCommand } from "../setup/qmd.ts";

interface Session {
	readonly proc: ChildProcessWithoutNullStreams;
	readonly index: string;
	readonly signature: string;
	buffer: string;
	nextId: number;
	readonly pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
	ready: boolean;
}

let session: Session | null = null;
let hooked = false;

/** `memories/foo.md` -> `foo` — the id shape every other layer here uses. */
function basenameOf(p: string | undefined): string | null {
	if (!p) return null;
	const base = p.split(/[\\/]/).pop() ?? p;
	return base.replace(/\.md$/, "") || null;
}

export function shutdownQmdSession(): void {
	if (!session) return;
	for (const p of session.pending.values()) { clearTimeout(p.timer); p.reject(new Error("session closed")); }
	try { session.proc.kill(); } catch { /* already gone */ }
	session = null;
}

function send(s: Session, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const id = s.nextId++;
		const timer = setTimeout(() => { s.pending.delete(id); reject(new Error(`qmd ${method} timed out`)); }, timeoutMs);
		s.pending.set(id, { resolve, reject, timer });
		try { s.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); }
		catch (e) { clearTimeout(timer); s.pending.delete(id); reject(e as Error); }
	});
}

async function start(index: string, signature: string, cwd: string): Promise<Session | null> {
	const cmd = qmdCommand(["--index", index, "mcp"]);
	if (!cmd) return null;
	let proc: ChildProcessWithoutNullStreams;
	try { proc = spawn(cmd.cmd, cmd.argv, { cwd, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams; }
	catch { return null; }

	const s: Session = { proc, index, signature, buffer: "", nextId: 1, pending: new Map(), ready: false };
	proc.stdout.setEncoding("utf8");
	proc.stdout.on("data", (chunk: string) => {
		s.buffer += chunk;
		let nl: number;
		while ((nl = s.buffer.indexOf("\n")) >= 0) {
			const line = s.buffer.slice(0, nl).trim();
			s.buffer = s.buffer.slice(nl + 1);
			if (!line) continue;
			let msg: { id?: number; result?: unknown; error?: { message?: string } };
			try { msg = JSON.parse(line); } catch { continue; }
			if (typeof msg.id !== "number") continue;
			const waiter = s.pending.get(msg.id);
			if (!waiter) continue;
			s.pending.delete(msg.id);
			clearTimeout(waiter.timer);
			if (msg.error) waiter.reject(new Error(msg.error.message ?? "qmd error"));
			else waiter.resolve(msg.result);
		}
	});
	proc.on("exit", () => {
		if (session === s) session = null;
		// Fail the in-flight requests immediately. Without this they sit until
		// their own timeout, so a child that died instantly still costs every
		// caller the full wait — and the CLI fallback that would have answered
		// them does not start until they give up.
		for (const [, waiter] of s.pending) { clearTimeout(waiter.timer); waiter.reject(new Error("qmd session exited")); }
		s.pending.clear();
	});
	proc.stderr.resume();

	// A resident child holds the event loop open, so a CLI or a test runner that
	// finishes its work simply never exits. `unref` lets the parent leave; the
	// exit hooks make sure the child does not outlive it.
	proc.unref();
	proc.stdout.unref?.();
	proc.stderr.unref?.();
	proc.stdin.unref?.();
	if (!hooked) {
		hooked = true;
		for (const sig of ["exit", "SIGINT", "SIGTERM"] as const) {
			process.once(sig, () => { shutdownQmdSession(); });
		}
	}

	try {
		await send(s, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vestige", version: "0.1.0" } }, 20_000);
		s.ready = true;
		return s;
	} catch {
		try { proc.kill(); } catch { /* ignore */ }
		return null;
	}
}

/**
 * Query through the persistent session. Returns null when unavailable, so the
 * caller falls back to the CLI rather than failing — a slow search beats none.
 */
export async function sessionQuery(
	opts: { index: string; signature: string; cwd: string; query: string; limit: number; rerank: boolean },
): Promise<string[] | null> {
	if (session && (session.index !== opts.index || session.signature !== opts.signature)) shutdownQmdSession();
	if (!session) session = await start(opts.index, opts.signature, opts.cwd);
	if (!session?.ready) return null;

	try {
		const result = (await send(session, "tools/call", {
			name: "query",
			arguments: { query: opts.query, limit: opts.limit, rerank: opts.rerank },
		}, 30_000)) as {
			content?: { type?: string; text?: string }[];
			structuredContent?: { results?: { file?: string }[] };
		};

		// The MCP surface does NOT return the CLI's `qmd://collection/name.md`
		// form — it returns collection-relative paths in `structuredContent`, and
		// a prose summary in `content`. Matching the CLI's shape here silently
		// found nothing, which read as a very fast search returning no results.
		const structured = result?.structuredContent?.results ?? [];
		if (structured.length) {
			return structured.map((r) => basenameOf(r?.file)).filter((x): x is string => Boolean(x));
		}
		// Fallback: the text summary lists `<collection>/<file>.md` per line.
		const text = (result?.content ?? []).map((c) => c?.text ?? "").join("\n");
		return [...text.matchAll(/(?:^|\s)([^\s]+\.md)\b/g)].map((m) => basenameOf(m[1])).filter((x): x is string => Boolean(x));
	} catch {
		shutdownQmdSession();
		return null;
	}
}
