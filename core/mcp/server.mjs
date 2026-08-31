#!/usr/bin/env node
/**
 * Vestige MCP server — stdio JSON-RPC.
 *
 * Deliberately dependency-free: a memory plugin that needs an npm install before
 * it can answer is a plugin people bounce off. Node 22+ is the only requirement,
 * and qmd is optional (see lib/vestige.ts for why the filter, not the engine, is
 * what carries retrieval quality).
 */
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = (f) => pathToFileURL(join(HERE, "..", "lib", f)).href;

const { remember, recall, search, explain, hasQmd } = await import(lib("vestige.ts"));
const { activeStores, loadConfig } = await import(lib("stores.ts"));
const { ensureQmd } = await import(pathToFileURL(join(HERE, "..", "setup", "qmd.ts")).href);

// Provision on startup rather than assuming. qmd is a hard dependency, and the
// three ways it can be unusable — missing, outdated, or broken by a Node
// upgrade — all present identically as "search returns nothing".
let qmdState = { ok: false, detail: "not checked" };
try { qmdState = ensureQmd(); } catch (e) { qmdState = { ok: false, detail: String(e?.message ?? e) }; }

// Sync lives HERE, not in a host hook, because Codex has no hook equivalent.
// The Claude Stop hook is an optimisation that syncs at a natural boundary;
// correctness does not depend on it. Debounced so a burst of writes is one push.
let syncTimer = null;
function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    try {
      spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(HERE, "..", "lib", "sync.ts"), "push"],
        { detached: true, stdio: "ignore" }).unref();
    } catch { /* a memory that is written but not yet pushed is not lost */ }
  }, 5000);
  syncTimer.unref?.();
}

const TOOLS = [
  {
    name: "remember",
    description:
      "Record a durable lesson — something still true, and still useful, in a repo that is not this one. The routing test: would this help someone working on a different project? Scope decides where it is stored and who can see it: `project` (this repo only) is the default, `platform` reaches anything sharing a platform, `general` reaches every project and must be justified. A lesson about what you did today is not a memory; it is a log entry.",
    inputSchema: {
      type: "object",
      required: ["title", "body", "confidence"],
      properties: {
        title: { type: "string", description: "The lesson stated as a claim, not a topic label." },
        body: { type: "string", description: "The lesson in full, for a reader with none of your context: what is true, why, and what it means for what they are about to do." },
        confidence: { type: "string", enum: ["verified", "inferred", "unverified"], description: "'verified' = you checked it against code, a doc or a run." },
        verification: { type: "string", description: "How you know. Expected whenever confidence is 'verified'." },
        scope: { type: "string", enum: ["general", "platform", "project"], description: "Reach. Prefer 'platform' over 'general' for a toolchain or language lesson." },
        generality: { type: "string", description: "Why this reaches everywhere. Expected whenever scope is 'general'." },
        projects: { type: "array", items: { type: "string" }, description: "Every project this applies to — a list, so a lesson spanning two repos reaches both." },
        platforms: { type: "array", items: { type: "string" }, description: "Platforms this applies to, e.g. ['ios']." },
      },
    },
  },
  {
    name: "recall",
    description: "Everything this project may see, from both the project store and the global store, ranked by specificity then recency. Call before answering from your own memory of a past decision.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "Max results (default 20)." } } },
  },
  {
    name: "search",
    description: "Semantic search inside what this project may see. Filters by reach FIRST, then ranks — nothing outside the caller's reach can appear regardless of how well it matches.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "number" } } },
  },
  {
    name: "explain",
    description: "Why every memory was or was not shown to this project. Shows reach, origin, what the writer CLAIMED versus what was recorded (a narrowed scope, a capped confidence), and the exact reason each memory is visible or withheld. Use when recall returns nothing and you need to tell an empty store apart from a reach mismatch.",
    inputSchema: { type: "object", properties: { visible_only: { type: "boolean", description: "Show only what this project can see (default false — the withheld ones are usually the question)." } } },
  },
  {
    name: "memory_status",
    description: "Where the two stores are, how many memories each holds, and whether semantic ranking is available.",
    inputSchema: { type: "object", properties: {} },
  },
];

const text = (s) => ({ content: [{ type: "text", text: s }] });

function callTool(name, args) {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (name === "remember") {
    const r = remember(args ?? {}, { cwd });
    if (!r.ok) {
      const why = r.quarantined
        ? `QUARANTINED — not written to the shared store.\n${r.errors.join("\n")}\nFindings: ${r.findings.map((f) => f.rule).join(", ")}`
        : `Not recorded:\n- ${r.errors.join("\n- ")}`;
      return text(why);
    }
    scheduleSync();
    const warn = r.warnings.length ? `\n\nWarnings:\n- ${r.warnings.join("\n- ")}` : "";
    return text(`Recorded to the ${r.tier} store as ${r.rel}\nscope: ${r.value.scope}  projects: [${r.value.projects.join(", ")}]${r.value.downgraded_from ? `  (downgraded from ${r.value.downgraded_from})` : ""}${warn}`);
  }
  if (name === "recall") {
    const hits = recall({ cwd, limit: args?.limit ?? 20 });
    if (!hits.length) return text("No memories are visible to this project yet.");
    return text(hits.map((h) => `- [${h.tier}/${h.scope}${h.foreign ? "/foreign" : ""}] ${h.name}`).join("\n"));
  }
  if (name === "search") {
    const { hits, engine } = search(args?.query ?? "", { cwd, limit: args?.limit ?? 10 });
    if (!hits.length) return text("No visible memory matched.");
    return text(`engine: ${engine}\n` + hits.map((h) => `- [${h.tier}/${h.scope}] ${h.name}`).join("\n"));
  }
  if (name === "explain") {
    let rows = explain({ cwd });
    if (args?.visible_only) rows = rows.filter((r) => r.visible);
    if (!rows.length) return text("Both stores are empty — nothing to explain.");
    const line = (r) => {
      const claimed = [
        r.claimedScope ? `claimed scope: ${r.claimedScope} -> ${r.scope}` : null,
        r.claimedConfidence ? `claimed confidence: ${r.claimedConfidence} -> ${r.confidence}` : null,
        r.flags.length ? `flags: ${r.flags.join(",")}` : null,
        r.foreign ? `foreign origin: ${r.origin}` : null,
      ].filter(Boolean).join("  ·  ");
      return `${r.visible ? "SHOWN   " : "WITHHELD"} [${r.tier}] ${r.name}\n    ${r.reason}${claimed ? `\n    ${claimed}` : ""}`;
    };
    const shown = rows.filter((r) => r.visible).length;
    return text(`${shown} shown, ${rows.length - shown} withheld\n\n` + rows.map(line).join("\n"));
  }
  if (name === "memory_status") {
    const stores = activeStores(cwd);
    const cfg = loadConfig(cwd);
    const n = () => { try { return recall({ cwd, limit: 100000 }).length; } catch { return 0; } };
    const lines = stores.map((s) => {
      const c = cfg.stores.find((x) => x.name === s.config.name);
      return `  ${s.config.name.padEnd(10)} ${String(c?.kind).padEnd(9)} accepts ${JSON.stringify(c?.accepts)}\n             ${s.path}`;
    }).join("\n");
    return text(`stores:\n${lines}\nvisible here:  ${n()}\nsemantic ranking: ${hasQmd() ? `qmd ready (${qmdState.detail})` : `UNAVAILABLE — ${qmdState.detail}. Retrieval is badly degraded: rank-1 drops from 0.98 to 0.09.`}`);
  }
  return text(`unknown tool: ${name}`);
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  try {
    if (method === "initialize") {
      return send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "vestige", version: "0.1.0" } } });
    }
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (method === "tools/call") return send({ jsonrpc: "2.0", id, result: callTool(params?.name, params?.arguments) });
    if (method && method.startsWith("notifications/")) return;
    if (id !== undefined) send({ jsonrpc: "2.0", id, result: {} });
  } catch (err) {
    if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(err?.message ?? err) } });
  }
});
