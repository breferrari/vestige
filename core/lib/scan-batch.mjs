#!/usr/bin/env node
/**
 * Scan every pending memory in ONE process.
 *
 * The first version shelled out to node once per file. Each spawn paid
 * interpreter start plus type-stripping, which is invisible on a three-file
 * fixture and took the machine down on a real store — load average 140 with 100
 * engineers, killed mid-run. Anything that runs on every turn boundary has to be
 * one process over N files, never N processes.
 *
 * Prints one line per CONTAMINATED file: `<path>\t<rule>,<rule>`. Silent for a
 * clean store. Exit 0 always — the caller decides what to do with the list; a
 * gate that fails the session is worse than the leak it was guarding against.
 *
 * FAILS CLOSED per file: a file that cannot be read or scanned is reported as
 * contaminated rather than skipped.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { scan, configure } = await import(pathToFileURL(join(HERE, "..", "lib", "sanitize.ts")).href);

if (process.env.VESTIGE_TICKET_KEYS) {
	configure({ ticketKeys: process.env.VESTIGE_TICKET_KEYS.split(",").map((s) => s.trim()).filter(Boolean) });
}

const targets = process.argv.slice(2);
const files = [];
for (const t of targets) {
	try {
		if (statSync(t).isDirectory()) {
			for (const n of readdirSync(t)) if (n.endsWith(".md")) files.push(join(t, n));
		} else if (t.endsWith(".md")) files.push(t);
	} catch { /* a target that vanished between listing and scanning is not a leak */ }
}

for (const f of files) {
	let rules;
	try {
		const findings = scan(readFileSync(f, "utf8"));
		if (findings.length === 0) continue;
		rules = [...new Set(findings.map((x) => x.rule))];
	} catch {
		rules = ["SCANNER:FAILED"];
	}
	process.stdout.write(`${f}\t${rules.join(",")}\n`);
}
