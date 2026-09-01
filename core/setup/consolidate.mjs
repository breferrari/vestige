#!/usr/bin/env node
/** Print consolidation candidates. Proposes only; never writes. */
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { findClusters } = await import(pathToFileURL(join(HERE, "..", "lib", "consolidate.ts")).href);

const threshold = Number(process.argv.find((a) => a.startsWith("--threshold="))?.split("=")[1] ?? NaN);
const clusters = findClusters({ cwd: process.cwd(), ...(Number.isFinite(threshold) ? { threshold } : {}) });

if (!clusters.length) {
  console.log("No clusters. A store with no duplicates is the normal state, not a failed run.");
  process.exit(0);
}
for (const [i, c] of clusters.entries()) {
  console.log(`\ncluster ${i + 1}  (similarity ${c.score})`);
  console.log(`  grouped on: ${c.shared.join(", ")}`);
  for (const m of c.members) console.log(`  - ${m.name}${m.projects.length ? `  [${m.projects.join(", ")}]` : ""}`);
}
console.log(`\n${clusters.length} proposal(s). Nothing was written — read the members before consolidating, and keep the anchors.`);
