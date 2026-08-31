#!/usr/bin/env node
/**
 * Keep deliberately duplicated prose identical.
 *
 * Some text has to appear in more than one place: a skill is loaded on its own,
 * so the rules it enforces cannot live behind a link to another skill. That
 * duplication is a decision, not an accident — but duplicated text drifts, and
 * this project has already paid for that once, when two implementations of one
 * content rule diverged and the stricter blocked work the other allowed.
 *
 * Blocks are marked `<!-- SYNC:name -->` ... `<!-- /SYNC -->`. Every block with
 * the same name must be byte-identical. Borrowed from MCS, which gates the same
 * way in CI.
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const files = globSync("**/*.md", { cwd: process.argv[2] ?? ".", exclude: (p) => p.includes("node_modules") || p.includes(".git/") });
const root = process.argv[2] ?? ".";
const blocks = new Map();

for (const rel of files) {
	let text;
	try { text = readFileSync(`${root}/${rel}`, "utf8"); } catch { continue; }
	for (const m of text.matchAll(/<!--\s*SYNC:([\w-]+)\s*-->\n([\s\S]*?)<!--\s*\/SYNC\s*-->/g)) {
		const [, name, body] = m;
		if (!blocks.has(name)) blocks.set(name, []);
		blocks.get(name).push({ file: rel, body });
	}
}

let bad = 0;
for (const [name, instances] of blocks) {
	if (instances.length === 1) {
		console.log(`warn  SYNC:${name} appears once (${instances[0].file}) — a sync block with no twin is just a comment`);
		continue;
	}
	const first = instances[0].body;
	const drifted = instances.filter((i) => i.body !== first);
	if (drifted.length) {
		bad++;
		console.log(`FAIL  SYNC:${name} has drifted across ${instances.length} files:`);
		for (const i of instances) console.log(`        ${i.file}  (${i.body.length} chars)`);
	} else {
		console.log(`ok    SYNC:${name} identical across ${instances.length} files`);
	}
}
if (blocks.size === 0) console.log("no sync blocks found");
console.log(bad ? `\n${bad} block(s) drifted.` : "\nAll sync blocks agree.");
process.exit(bad ? 1 : 0);
