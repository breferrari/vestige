#!/usr/bin/env node
/**
 * Import an existing pile of memories into a configured store.
 *
 *   node core/setup/import.mjs <source-dir> [--store <name>] [--apply]
 *
 * The first time a repo grows a shared store, markdown already exists — in an
 * old flat folder, or under a previous tool's directory. Copying it in blind
 * RESURRECTS THE DEAD: a memory the team deleted on purpose is still present in
 * this checkout, and a naive import pushes it back for everyone.
 *
 * So this consults the target's deletion history and refuses those paths,
 * listing each with the commit that removed it. Everything else is copied,
 * never moved: the source is left exactly as it was, so a bad import is undone
 * by deleting the destination rather than by trying to reconstruct the source.
 *
 * Dry run by default, like migrate.mjs. This is the "there is already a pile"
 * tool; migrate.mjs is the "the configuration changed" tool, and merging them
 * would give one command two failure modes with one set of flags.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HERE = new URL(".", import.meta.url).pathname;
const { activeStores } = await import(pathToFileURL(join(HERE, "..", "lib", "stores.ts")).href);
const { scan } = await import(pathToFileURL(join(HERE, "..", "lib", "sanitize.ts")).href);

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const storeName = (() => { const i = args.indexOf("--store"); return i >= 0 ? args[i + 1] : null; })();
const SRC = args.find((a) => !a.startsWith("--") && a !== storeName);

const say = (s) => process.stdout.write(`${s}\n`);
const die = (s) => { process.stderr.write(`${s}\n`); process.exit(1); };

if (!SRC) die("usage: import.mjs <source-dir> [--store <name>] [--apply]");
if (!existsSync(SRC) || !statSync(SRC).isDirectory()) die(`not a directory: ${SRC}`);

const stores = activeStores(process.cwd());
if (!stores.length) die("no configured stores");
const target = storeName ? stores.find((s) => s.config.name === storeName) : stores[stores.length - 1];
if (!target) die(`no store named ${JSON.stringify(storeName)} — have: ${stores.map((s) => s.config.name).join(", ")}`);

say(`import  ${resolve(SRC)}`);
say(`    ->  store ${target.config.name} at ${target.path}`);
say(APPLY ? "    mode: APPLY\n" : "    mode: dry run — nothing is written; pass --apply\n");

/**
 * Paths the target's history shows as deliberately deleted.
 *
 * Without this the import silently undoes every removal the team ever agreed
 * to, and it does it invisibly: the files simply reappear.
 */
const deletedInHistory = (() => {
	const out = new Map();
	try {
		const log = execFileSync("git", ["log", "--diff-filter=D", "--name-only", "--pretty=format:%h %s"], { cwd: target.path, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		let commit = "";
		for (const line of log.split("\n")) {
			if (!line.trim()) continue;
			if (/^[0-9a-f]{7,} /.test(line)) { commit = line.trim(); continue; }
			out.set(basename(line.trim()), commit);
		}
	} catch { /* not a git store, or no history: nothing to protect */ }
	return out;
})();

const files = readdirSync(SRC).filter((f) => f.endsWith(".md"));
if (!files.length) die(`no .md files in ${SRC}`);

const imported = [];
const heldBack = [];
const skipped = [];

for (const f of files) {
	const from = join(SRC, f);
	let text;
	try { text = readFileSync(from, "utf8"); } catch { skipped.push([f, "unreadable"]); continue; }

	const wasDeleted = deletedInHistory.get(f);
	if (wasDeleted) { heldBack.push([f, wasDeleted]); continue; }

	// The gate applies to an import exactly as it applies to a write. A pile
	// assembled before anyone was scanning is the likeliest place for a
	// credential to be sitting.
	let findings;
	try { findings = scan(text); } catch { findings = [{ rule: "SCANNER:FAILED", match: "" }]; }
	if (findings.length) { heldBack.push([f, `content gate: ${findings.map((x) => x.rule).join(", ")}`]); continue; }

	// Never overwrite. A name collision between two piles is two different
	// memories, not one memory twice.
	let name = f;
	for (let n = 2; existsSync(join(target.path, name)); n++) {
		if (n > 50) { skipped.push([f, "too many name collisions"]); name = ""; break; }
		name = f.replace(/\.md$/, ` (${n}).md`);
	}
	if (!name) continue;

	if (APPLY) {
		mkdirSync(target.path, { recursive: true });
		copyFileSync(from, join(target.path, name));
	}
	imported.push([f, name]);
}

for (const [f, as] of imported) say(`  import   ${f}${as === f ? "" : `  ->  ${as}`}`);
if (heldBack.length) {
	say(`\n  HELD BACK (${heldBack.length}) — not imported:`);
	for (const [f, why] of heldBack) say(`    ${f}\n      ${why}`);
	say("\n  A file deleted in the store's history was removed on purpose. Importing it");
	say("  republishes it for everyone. If you want it back, add it deliberately.");
}
for (const [f, why] of skipped) say(`  skip     ${f} — ${why}`);

say(`\n${imported.length} importable, ${heldBack.length} held back, ${skipped.length} skipped.`);
if (!APPLY && imported.length) say("Nothing was written. Re-run with --apply.");
say("The source directory is untouched either way.");
