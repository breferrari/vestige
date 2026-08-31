#!/usr/bin/env node
/**
 * Keep the architecture document honest about the code beside it.
 *
 * Moving it into the repo was supposed to stop it going stale. That only works
 * if something checks — the previous copy drifted in five places precisely
 * because nothing did, and "I rewrote it from what I remember changing" is not
 * a check.
 *
 * What this CAN verify: every path it names exists, and every code symbol it
 * names is defined somewhere. What it CANNOT verify is whether the described
 * BEHAVIOUR still matches — that is what the test suite is for, and this is
 * deliberately not pretending otherwise.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const doc = process.argv[2] ?? "ARCHITECTURE.md";
const root = process.argv[3] ?? ".";
let text;
try { text = readFileSync(join(root, doc), "utf8"); } catch { console.log(`FAIL  cannot read ${doc}`); process.exit(1); }

let bad = 0;
let badPaths = 0;

// paths
const paths = [...new Set([...text.matchAll(/\b((?:core|host|codex)\/[A-Za-z0-9_./-]*)/g)].map((m) => m[1].replace(/[.,)]+$/, "")))];
for (const p of paths) {
  if (existsSync(join(root, p))) continue;
  console.log(`FAIL  path named in ${doc} does not exist: ${p}`);
  bad++; badPaths++;
}
// Report what held, not the total. An unconditional "all exist" line next to a
// FAIL is the misleading-green shape this whole guard exists to prevent.
console.log(`${badPaths ? "FAIL " : "ok   "} ${paths.length - badPaths}/${paths.length} paths exist`);

// symbols in backticks that look like identifiers
const src = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".git", ".qmd"].includes(e.name)) walk(p); }
    else if (/\.(ts|mjs)$/.test(e.name)) src.push(readFileSync(p, "utf8"));
  }
};
try { walk(join(root, "core")); } catch { /* no core */ }
const all = src.join("\n");

const symbols = [...new Set([...text.matchAll(/`([a-z][A-Za-z0-9]{4,})`/g)].map((m) => m[1]))]
  // words that are prose, not code
  .filter((s) => !["general", "project", "platform", "memories", "always", "before", "inferred", "verified", "external", "local"].includes(s));
const missing = symbols.filter((s) => !new RegExp(`\\b${s}\\b`).test(all));
for (const m of missing) { console.log(`FAIL  symbol named in ${doc} not found in core/: ${m}`); bad++; }
console.log(`${missing.length ? "FAIL " : "ok   "} ${symbols.length - missing.length}/${symbols.length} named symbols resolve`);

console.log(bad ? `\n${bad} staleness problem(s).` : "\nArchitecture document agrees with the code it describes.");
process.exit(bad ? 1 : 0);
