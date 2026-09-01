/**
 * Vestige sync — pull at session start, gate-and-push at the turn boundary.
 *
 * TypeScript rather than shell, deliberately. The system this replaces ships its
 * hooks as bash, and every portability failure measured against it was a
 * shell-level one: `hostname -s` does not exist on Windows and the hook's own
 * ERR trap swallowed the failure and exited 0, so nothing ever pushed and the
 * only signal was one line on stderr; `jq` and `python` write CRLF on Windows,
 * which makes every derived path silently invalid; `file://C:/...` is not a
 * valid git URL. None of those exist here.
 *
 * Never fails the session. Every failure path exits 0 — a memory hook that
 * breaks a turn is worse than one that skips a sync.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { scan, configure } from "./sanitize.ts";
import { activeStores } from "./stores.ts";

const MODE = process.argv[2] === "pull" ? "pull" : "push";
const ATTEMPTS = Number(process.env.VESTIGE_PUSH_ATTEMPTS ?? 5);

if (process.env.VESTIGE_TICKET_KEYS) {
	configure({ ticketKeys: process.env.VESTIGE_TICKET_KEYS.split(",").map((s) => s.trim()).filter(Boolean) });
}

const git = (cwd: string, args: string[]): string | null => {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch {
		return null;
	}
};

const sleep = (ms: number) => {
	// Synchronous by design: the hook must finish before the turn proceeds.
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * The stores to sync, from the CONFIGURATION — not from a path guess.
 *
 * This function used to hardcode `~/.claude/vestige/memories` and
 * `<repo>/.claude/memories`. Both moved when the store became data belonging to
 * the repo rather than config belonging to one agent, and this was never
 * updated: sync walked two directories nothing had written to since, found
 * nothing, and exited 0. A sync that syncs an empty directory reports success
 * and is indistinguishable from a session that produced no memories.
 *
 * Worse, a path guess cannot see an `external` store at all — which is the one
 * that actually reaches a team, so the entire sharing feature was dead.
 */
function stores(): string[] {
	const out: string[] = [];
	try {
		for (const { config, path } of activeStores(process.cwd())) {
			// NEVER a `repo` store. Its memories live inside the product
			// repository, so committing them means committing to the user's own
			// repo — and pushing them means pushing the user's branch. Verified
			// the hard way: with `repo` included, a Stop hook moved HEAD on a
			// product checkout and pushed it to origin, unasked.
			//
			// That is also the design: `repo` memories travel with the code and
			// are reviewed in its pull requests, which means a PERSON commits
			// them alongside the change they belong to. A hook that commits into
			// someone's working repository is not a sync, it is a surprise.
			if (config.kind === "repo") continue;
			out.push(path);
		}
	} catch { /* fall back below rather than sync nothing */ }
	// VESTIGE_GLOBAL remains an explicit override for a caller that knows better.
	if (process.env.VESTIGE_GLOBAL) out.push(process.env.VESTIGE_GLOBAL);
	return [...new Set(out)].filter((d) => existsSync(d));
}

/**
 * The gate. Runs BEFORE anything is staged.
 *
 * Placing it after staging produced a clean HEAD over a dirty history — every
 * contaminated memory still reachable in the remote, because `rm --cached` plus
 * `--amend` rewrites only the tip. Retraction is not containment.
 *
 * One pass over the whole store, not one process per file: the per-file shape
 * cost 5.67s on 200 memories and took the machine down under concurrency.
 */
function gate(store: string): number {
	let blocked = 0;
	let names: string[];
	try {
		names = readdirSync(store).filter((n) => n.endsWith(".md"));
	} catch {
		return 0;
	}
	for (const n of names) {
		const full = join(store, n);
		let rules: string[];
		try {
			const found = scan(readFileSync(full, "utf8"));
			if (found.length === 0) continue;
			rules = [...new Set(found.map((f) => f.rule))];
		} catch {
			rules = ["SCANNER:FAILED"]; // fail closed
		}
		const q = join(dirname(store), "vestige-quarantine");
		try {
			mkdirSync(q, { recursive: true });
			git(store, ["rm", "--cached", "-q", n]);
			renameSync(full, join(q, n));
			blocked++;
			console.log(`vestige: quarantined ${basename(n)} [${rules.join(",")}] — held in vestige-quarantine/, not published`);
		} catch { /* leave it in place rather than lose it */ }
	}
	return blocked;
}

for (const store of stores()) {
	if (!git(store, ["rev-parse", "--git-dir"])) continue;
	if (!git(store, ["remote", "get-url", "origin"])) continue;

	if (MODE === "pull") {
		git(store, ["pull", "--rebase", "--autostash", "-q"]);
		continue;
	}

	gate(store);

	// WRITES AND DELETIONS ARE NOT SYMMETRIC.
	//
	// A write adds a memory: recoverable, and its blast radius is one more thing
	// to read. A deletion removes it for EVERYONE sharing the store, including
	// whoever wrote it and is not in this session to object. So `git add -A` —
	// which stages deletions alongside additions — quietly makes every local
	// tidy-up a team-wide destruction.
	//
	// Default `auto`: additions and modifications are pushed, deletions are
	// PARKED — left unstaged, reported, and restored by the next pull unless
	// someone deliberately approves them. `VESTIGE_SYNC=full` pushes deletions
	// too, for the person actually running an audit. Taken from MCS, which
	// defaults the same way for the same reason.
	const requested = String(process.env.VESTIGE_SYNC ?? "");
	const syncMode = requested === "full" || requested === "review" ? requested : "auto";

	// `review`: nothing is staged and nothing is pushed, including ADDITIONS.
	// Parking deletions is a safety default; review mode is a team workflow — a
	// lead sees incoming lessons before they become everybody else's context.
	// The proposals stay in the working tree, which is where /approve-memories
	// picks them up.
	if (syncMode === "review") {
		const pending = (git(store, ["status", "--porcelain", "--", "."]) ?? "")
			.split("\n").map((l) => l.trim()).filter(Boolean);
		if (pending.length) {
			console.log(`vestige: ${pending.length} memory change(s) awaiting review in ${store} — nothing was pushed.`);
			for (const p of pending.slice(0, 10)) console.log(`  ${p}`);
			if (pending.length > 10) console.log(`  ...and ${pending.length - 10} more`);
			console.log("  Run /approve-memories to stage, commit and publish them.");
		}
		continue;
	}

	if (syncMode === "full") {
		git(store, ["add", "-A", "--", "."]);
	} else {
		// `--ignore-removal` is exactly this semantic in one command: stage new and
		// modified files, never removals. The first version parsed `git status
		// --porcelain` and added paths one by one, which was quietly broken —
		// porcelain prints paths relative to the REPO ROOT while these commands run
		// in the memories subdirectory, so every add silently resolved to nothing
		// and writes stopped landing. The parking test still passed, because a test
		// that only deletes never notices that adding is broken.
		git(store, ["add", "--ignore-removal", "--", "."]);

		const deleted = (git(store, ["status", "--porcelain", "--", "."]) ?? "")
			.split("\n").map((l) => l.trim()).filter((l) => /^D|^ D/.test(l))
			.map((l) => l.replace(/^\S+\s+/, ""));
		if (deleted.length) {
			console.log(`vestige: ${deleted.length} deleted memor${deleted.length === 1 ? "y" : "ies"} held back from the shared store, pending review:`);
			for (const d of deleted.slice(0, 10)) console.log(`  ${d}`);
			if (deleted.length > 10) console.log(`  ...and ${deleted.length - 10} more`);
			console.log("  Deleting for yourself is not deleting for the team. Run the audit skill, or set VESTIGE_SYNC=full to publish these removals.")
			console.log("  For a team where additions are reviewed too, set VESTIGE_SYNC=review.");
		}
	}
	const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: store, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	if (!staged) continue;
	git(store, ["commit", "-qm", `vestige: capture ${new Date().toISOString()}`]);

	// Bounded retry with full jitter. A single attempt loses almost every race
	// under simultaneous writers, and the loss is not probabilistic: in a
	// barrier-synchronised race exactly ONE writer lands regardless of how many
	// are pushing — 1 of 5, 1 of 10, 1 of 20, with zero variance over three runs
	// each. Bounded retry lands all of them.
	//
	// An earlier version of this comment cited 21 of 845 and 98 of 100 stalled.
	// Those numbers were withdrawn: they came from spawning writers and counting
	// survivors on a loaded machine, which measures the scheduler rather than the
	// software, and reproduced across a 14x range on one afternoon.
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		const pulled = git(store, ["pull", "--rebase", "--autostash", "-q"]);
		if (pulled !== null) {
			// Push with an explicit refspec and set upstream. A bare `git push`
			// requires a configured upstream and FAILS without one — and because
			// every git call here is deliberately quiet, that failure was
			// invisible: memories committed locally and never left the machine,
			// forever, with no error anywhere. A store that reaches this state
			// looks exactly like a store nobody is writing to.
			if (git(store, ["push", "-q", "-u", "origin", "HEAD"]) !== null) break;
		} else {
			const status = git(store, ["status", "--porcelain"]);
			if (status === null || existsSync(join(store, ".git", "rebase-merge")) || existsSync(join(store, ".git", "rebase-apply"))) {
				git(store, ["rebase", "--abort"]);
				console.log(`vestige: sync paused — rebase conflict in ${store}. Resolve manually.`);
				break;
			}
		}
		sleep(Math.random() * Math.min(2000, 50 * 2 ** attempt));
	}
}
