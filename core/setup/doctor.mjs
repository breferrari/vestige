#!/usr/bin/env node
/**
 * Diagnose a memory setup that is not working.
 *
 * Every failure in this layer presents identically — "search returns nothing" —
 * and the causes are wildly different: no store configured, a store configured
 * but unreachable, qmd missing, qmd present but broken by a Node upgrade, an
 * index that was never built, or a reach rule that legitimately hides
 * everything. MCS ships two doctor scripts for exactly this reason.
 *
 * Reports, never repairs. A doctor that silently fixes things teaches nobody
 * what was wrong, and the same setup breaks again next week.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = (f) => pathToFileURL(join(HERE, "..", "lib", f)).href;
const { loadConfig, activeStores, storePath, currentProject, vestigeHome } = await import(lib("stores.ts"));
const { ensureQmd, installedVersion, resolveQmdEntry } = await import(pathToFileURL(join(HERE, "qmd.ts")).href);
const { recall, explain } = await import(lib("vestige.ts"));

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const ok = (s) => `  ok    ${s}`;
const bad = (s) => `  FAIL  ${s}`;
const warn = (s) => `  warn  ${s}`;
const out = [];
let problems = 0;
const fail = (s) => { problems++; out.push(bad(s)); };

out.push(`Vestige doctor — ${new Date().toISOString()}`, "");
out.push(`project: ${currentProject(cwd) ?? "(not a git repo — project-scoped memories cannot resolve)"}`);
out.push(`home:    ${vestigeHome()}`, "");

// ── runtime ───────────────────────────────────────────────────────────────
out.push("runtime");
const major = Number(process.versions.node.split(".")[0]);
major >= 22 ? out.push(ok(`node ${process.versions.node}`)) : fail(`node ${process.versions.node} — 22+ required for type stripping`);
try { execFileSync("git", ["--version"], { stdio: "ignore" }); out.push(ok("git present")); } catch { fail("git not found on PATH"); }

// ── qmd, the hard dependency ──────────────────────────────────────────────
out.push("", "retrieval engine");
const entry = resolveQmdEntry();
const ver = installedVersion();
if (!entry) fail("qmd is not installed — run the installer. Without it, rank-1 accuracy is 0.09 instead of 0.98");
else if (!ver) fail(`qmd resolves at ${entry} but will not run — usually a native binding built against an older Node ABI. The installer rebuilds it`);
else out.push(ok(`qmd ${ver}`));

// ── stores ────────────────────────────────────────────────────────────────
out.push("", "stores");
const cfg = loadConfig(cwd);
if (!cfg.stores.length) fail("no stores configured");
for (const s of cfg.stores) {
  const p = storePath(s, cwd);
  if (!p) { out.push(warn(`${s.name} (${s.kind}) — does not resolve here (no repo root)`)); continue; }
  const exists = existsSync(p);
  const count = exists ? readdirSync(p).filter((f) => f.endsWith(".md")).length : 0;
  out.push(`  ${exists ? "ok   " : "warn "} ${s.name} (${s.kind}) accepts ${JSON.stringify(s.accepts)} — ${exists ? `${count} memories` : "not created yet"}`);
  out.push(`         ${p}`);
  if (s.kind === "external") {
    if (!s.url) { fail(`${s.name}: external store has no url`); continue; }
    try {
      execFileSync("git", ["ls-remote", "--exit-code", "--heads", s.url, s.branch ?? "main"], { stdio: "ignore" });
      out.push(ok(`${s.name}: remote reachable (${s.url})`));
    } catch {
      fail(`${s.name}: remote unreachable — ${s.url} (${s.branch ?? "main"}). Check SSH keys, network/VPN, access, and that the branch exists`);
    }
    const checkout = dirname(p);
    if (existsSync(join(checkout, ".git"))) {
      const unpushed = (() => { try { return execFileSync("git", ["-C", checkout, "rev-list", "@{u}..HEAD", "--count"], { encoding: "utf8" }).trim(); } catch { return null; } })();
      if (unpushed === null) out.push(warn(`${s.name}: no upstream configured — pushes will fail silently`));
      else if (Number(unpushed) > 0) out.push(warn(`${s.name}: ${unpushed} commit(s) not pushed`));
      else out.push(ok(`${s.name}: in sync with the remote`));
    }
  }
}

// ── visibility ────────────────────────────────────────────────────────────
out.push("", "visibility");
try {
  const rows = explain({ cwd });
  const shown = rows.filter((r) => r.visible).length;
  out.push(`  ${rows.length} memories across all stores; ${shown} visible to this project`);
  if (rows.length && shown === 0) {
    out.push(warn("nothing is visible here. This is a REACH mismatch, not an empty store — run explain to see why each is withheld"));
  }
  const narrowed = rows.filter((r) => r.claimedScope).length;
  if (narrowed) out.push(`  ${narrowed} had their reach narrowed at write time (claimed wider than they named)`);
} catch (e) { fail(`could not read stores: ${e?.message}`); }

out.push("", problems === 0 ? "No problems found." : `${problems} problem(s) found.`);
process.stdout.write(out.join("\n") + "\n");
process.exit(problems ? 1 : 0);
