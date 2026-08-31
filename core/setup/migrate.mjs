#!/usr/bin/env node
/**
 * Re-route memories to the stores the current configuration implies.
 *
 * The case this exists for: someone has been using Vestige with a personal
 * store, then adds a team store. Every `general` and `platform` memory they
 * already wrote should now live in the team store — and without this they stay
 * stranded where they were, invisible to the team, while new ones route
 * correctly. The store the memory is in and the reach it declares quietly stop
 * agreeing, which is exactly the property the routing exists to guarantee.
 *
 * SAFETY, in order of importance:
 *
 *   1. Nothing is deleted before its copy is verified byte-for-byte at the
 *      destination. A move that fails halfway must lose nothing.
 *   2. A name already taken at the destination is never overwritten — the
 *      incoming memory is suffixed, the way the write path does it.
 *   3. Dry run is the default. Migration is the one operation here that touches
 *      files a person wrote, so it says what it would do and stops.
 *
 * Re-runnable: a memory already in the right store is skipped, so running it
 * twice is a no-op and running it after a partial failure resumes.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = (f) => pathToFileURL(join(HERE, "..", "lib", f)).href;
const { activeStores, loadConfig, routeFor, ensureStore, storePath, currentProject } = await import(lib("stores.ts"));
const { readPool } = await import(lib("memory.ts"));

const APPLY = process.argv.includes("--apply");
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const cfg = loadConfig(cwd);
const project = currentProject(cwd);

const plan = [];
for (const { config, path } of activeStores(cwd)) {
	if (!existsSync(path)) continue;
	for (const e of readPool(path)) {
		const scope = String(e.facets.scope ?? "project");
		const named = (e.facets.projects ?? []).map((p) => p.toLowerCase());
		const aboutThisRepo = Boolean(project) && named.length === 1 && named[0] === project.toLowerCase();
		const target = routeFor(cfg, scope, { projectOnlySelf: aboutThisRepo });
		if (!target || target.name === config.name) continue;
		plan.push({ name: e.name, from: config.name, fromPath: e.full, to: target.name, target, scope });
	}
}

if (plan.length === 0) {
	console.log("Every memory is already in the store its reach implies. Nothing to do.");
	process.exit(0);
}

console.log(`${plan.length} memor${plan.length === 1 ? "y is" : "ies are"} in a store that does not match ${plan.length === 1 ? "its" : "their"} reach:\n`);
const byMove = {};
for (const p of plan) (byMove[`${p.from} -> ${p.to}`] ??= []).push(p);
for (const [move, items] of Object.entries(byMove)) {
	console.log(`  ${move}  (${items.length})`);
	for (const i of items.slice(0, 5)) console.log(`    ${i.name}   [${i.scope}]`);
	if (items.length > 5) console.log(`    ...and ${items.length - 5} more`);
}

if (!APPLY) {
	console.log("\nDry run. Nothing was moved. Re-run with --apply to perform the migration.");
	process.exit(0);
}

/** A destination name that is free, suffixing rather than overwriting. */
function freeName(dir, name) {
	if (!existsSync(join(dir, name))) return name;
	const stem = name.replace(/\.md$/, "");
	for (let n = 2; n < 500; n++) {
		const candidate = `${stem} (${n}).md`;
		if (!existsSync(join(dir, candidate))) return candidate;
	}
	throw new Error(`no free name for ${name}`);
}

let moved = 0, failed = 0;
for (const p of plan) {
	const ready = ensureStore(p.target, cwd);
	if (!ready.ok || !ready.path) { console.log(`  SKIP ${p.name}: ${ready.detail}`); failed++; continue; }
	try {
		const destName = freeName(ready.path, p.name);
		const dest = join(ready.path, destName);
		copyFileSync(p.fromPath, dest);
		// Verify before removing the original. A move that loses a memory is
		// worse than a migration that does not finish.
		const a = readFileSync(p.fromPath), b = readFileSync(dest);
		if (!a.equals(b)) { rmSync(dest, { force: true }); throw new Error("copy did not verify"); }
		rmSync(p.fromPath, { force: true });
		moved++;
		if (destName !== p.name) console.log(`  moved ${p.name} -> ${p.to} as ${destName} (name was taken)`);
	} catch (e) {
		console.log(`  FAILED ${p.name}: ${String(e?.message ?? e)} — original left in place`);
		failed++;
	}
}
console.log(`\n${moved} moved, ${failed} left in place.`);
if (failed) console.log("Re-run to retry the ones left behind; anything already moved is skipped.");
process.exit(failed ? 1 : 0);
