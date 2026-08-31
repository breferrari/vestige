/**
 * Where memories live — configuration, not policy.
 *
 * The first version hardcoded two locations: a directory committed inside the
 * project repo, and one under the user's home. That is one opinion about
 * storage presented as architecture, and it rules out the arrangement teams actually want: memories in a SEPARATE repository,
 * cloned into the checkout, gitignored from the project, shared across everyone
 * who has access to it. A team that keeps memories out of product repos on
 * purpose — because the review rules differ, or because the memories outlive
 * the repo — could not use Vestige at all.
 *
 * So a store is declared, not assumed. Three kinds:
 *
 *   repo      a directory inside the project repo, committed with it. Memories
 *             travel with the code and are reviewed in its pull requests.
 *   external  a separate git repository, sparse-cloned into the workspace and
 *             gitignored from the project. This is the MCS `shared-memories`
 *             model: team-wide memory decoupled from any product repo's history.
 *   local     a plain directory, no remote. The personal default.
 *
 * Each store declares which scopes it ACCEPTS, so routing is configuration too.
 * A memory goes to the first store that accepts its narrowed scope.
 *
 * The built-in default reproduces the previous behaviour exactly, so an install
 * with no config file behaves as before.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

export type StoreKind = "repo" | "external" | "local";
export type ScopeName = "project" | "platform" | "general";

export interface StoreConfig {
	readonly name: string;
	readonly kind: StoreKind;
	/** Path. Relative paths resolve against the repo root for `repo`/`external`, and against home for `local`. */
	readonly path: string;
	/** Scopes this store accepts. `"*"` accepts anything not claimed earlier. */
	readonly accepts: readonly (ScopeName | "*")[];
	/** `external` only — the memories repository. */
	readonly url?: string;
	readonly branch?: string;
	/** `external` only — sparse-checkout prefixes. Defaults to the memories dir. */
	readonly sparse?: readonly string[];
	/** Subdirectory within the store that actually holds the markdown. */
	readonly subdir?: string;
}

export interface VestigeConfig {
	readonly stores: readonly StoreConfig[];
}

/**
 * The default. A project tier committed with the repo, and a personal global
 * tier. No external store, because one cannot be invented — it needs a URL.
 */
export const DEFAULT_CONFIG: VestigeConfig = {
	stores: [
		{ name: "project", kind: "repo", path: ".vestige/memories", accepts: ["project"] },
		{ name: "personal", kind: "local", path: "memories", accepts: ["*"] },
	],
};

export function repoRoot(cwd: string = process.cwd()): string | null {
	try {
		const out = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		return out || null;
	} catch { return null; }
}

export function vestigeHome(): string {
	return process.env.VESTIGE_HOME ?? join(homedir(), ".vestige");
}

/**
 * Config resolution, nearest-wins: the repo's own config beats the user's.
 *
 * A repo can therefore mandate where ITS memories go — which is the case that
 * matters for a team standard — while a user's config governs everything else.
 */
export function loadConfig(cwd: string = process.cwd()): VestigeConfig {
	const candidates = [
		repoRoot(cwd) ? join(repoRoot(cwd)!, ".vestige", "config.json") : null,
		join(vestigeHome(), "config.json"),
	].filter(Boolean) as string[];
	for (const f of candidates) {
		try {
			const parsed = JSON.parse(readFileSync(f, "utf8"));
			if (Array.isArray(parsed?.stores) && parsed.stores.length) return { stores: parsed.stores };
		} catch { /* unreadable or malformed config falls through to the next */ }
	}
	return DEFAULT_CONFIG;
}

/** Absolute directory holding the markdown for a store, or null if unresolvable here. */
export function storePath(s: StoreConfig, cwd: string = process.cwd()): string | null {
	const sub = s.subdir ?? (s.kind === "external" ? "memories" : "");
	if (s.kind === "local") {
		// Relative paths resolve against VESTIGE_HOME, not the home directory.
		// They used to resolve against homedir() while every other path used
		// vestigeHome(), so setting VESTIGE_HOME moved the runtime, the views and
		// the state but silently left the personal STORE where it was — which
		// also meant no test could isolate itself from the developer's real
		// memories, and one leaked into a benchmark.
		const base = isAbsolute(s.path) ? s.path : join(vestigeHome(), s.path);
		return join(base, sub);
	}
	const root = repoRoot(cwd);
	if (!root) return null;
	const base = isAbsolute(s.path) ? s.path : join(root, s.path);
	return join(base, sub);
}

/** Which store takes a memory of this scope. First match wins. */
export function routeFor(cfg: VestigeConfig, scope: ScopeName, opts: { projectOnlySelf?: boolean } = {}): StoreConfig | null {
	for (const s of cfg.stores) {
		if (s.accepts.includes(scope)) {
			// A `repo` store only makes sense for a memory about THIS repo.
			if (s.kind === "repo" && scope === "project" && opts.projectOnlySelf === false) continue;
			return s;
		}
	}
	return cfg.stores.find((s) => s.accepts.includes("*")) ?? null;
}

export interface EnsureStoreResult {
	readonly ok: boolean;
	readonly path: string | null;
	readonly action: "present" | "created" | "cloned" | "skipped" | "failed";
	readonly detail: string;
}

/**
 * Materialise a store on disk.
 *
 * For `external`, the remote is probed BEFORE anything is written. A missing SSH
 * key, a dropped VPN, revoked access and a wrong branch are all the same
 * symptom otherwise — an empty memories directory — and the difference matters
 * to whoever has to fix it. Borrowed from MCS's `configure-memories.sh`, which
 * learned it the same way.
 *
 * The clone is sparse, single-branch and blobless: only the memory markdown
 * materialises, while the rest of the repository's history stays in git and
 * never touches the working tree.
 */
export function ensureStore(s: StoreConfig, cwd: string = process.cwd()): EnsureStoreResult {
	const path = storePath(s, cwd);
	if (!path) return { ok: false, path: null, action: "skipped", detail: `${s.name}: no repo root here` };

	if (s.kind !== "external") {
		try { mkdirSync(path, { recursive: true }); } catch { return { ok: false, path, action: "failed", detail: `${s.name}: cannot create ${path}` }; }
		// Creatable is not the same as writable — a read-only directory passes
		// mkdir (it already exists) and then fails on the first write, inside the
		// capture path where the error surfaces as a thrown exception rather than
		// a refusal the caller can report.
		try {
			const probe = join(path, `.vestige-write-probe-${process.pid}`);
			writeFileSync(probe, "");
			rmSync(probe, { force: true });
		} catch {
			return { ok: false, path, action: "failed", detail: `${s.name}: ${path} is not writable` };
		}
		return { ok: true, path, action: existsSync(path) ? "present" : "created", detail: `${s.name}: ${path}` };
	}

	if (!s.url) return { ok: false, path, action: "failed", detail: `${s.name}: external store needs a url` };
	const checkout = resolve(path, "..");
	const branch = s.branch ?? "main";

	if (existsSync(join(checkout, ".git"))) {
		mkdirSync(path, { recursive: true });
		excludeFromHostRepo(checkout, cwd);
		return { ok: true, path, action: "present", detail: `${s.name}: ${s.url} at ${checkout}` };
	}
	if (existsSync(checkout)) {
		return { ok: false, path, action: "failed", detail: `${s.name}: ${checkout} exists but is not a git checkout — remove it and retry` };
	}

	// preflight: fail with a diagnosis, before touching the filesystem
	try {
		execFileSync("git", ["ls-remote", "--exit-code", "--heads", s.url, branch], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
	} catch (e) {
		return {
			ok: false, path, action: "failed",
			detail: `${s.name}: cannot reach ${s.url} (branch ${branch}). Check SSH keys, network/VPN, access, and that the branch exists. Nothing was written.`,
		};
	}

	try {
		execFileSync("git", ["clone", "--sparse", "--filter=blob:none", "--branch", branch, "--single-branch", s.url, checkout], { stdio: ["ignore", "ignore", "pipe"] });
		execFileSync("git", ["-C", checkout, "sparse-checkout", "set", ...(s.sparse ?? [s.subdir ?? "memories"])], { stdio: ["ignore", "ignore", "pipe"] });
		// A brand-new memories repo has no memories/ tree yet; sparse-checkout
		// exits 0 and materialises nothing, so create it rather than dangle.
		mkdirSync(path, { recursive: true });
		excludeFromHostRepo(checkout, cwd);
		return { ok: true, path, action: "cloned", detail: `${s.name}: cloned ${s.url} (${branch}, sparse) into ${checkout}` };
	} catch {
		return { ok: false, path, action: "failed", detail: `${s.name}: clone failed` };
	}
}

/**
 * Keep a nested memories checkout out of the host repo's status.
 *
 * Written to `.git/info/exclude`, NOT the repo's `.gitignore`. An external store
 * is one engineer's local arrangement — someone else on the same project may
 * keep memories somewhere entirely different, or not use Vestige at all — so
 * committing an ignore rule for it would push a personal choice into shared
 * source. `info/exclude` is local, uncommitted, and does the same job.
 */
function excludeFromHostRepo(checkout: string, cwd: string): void {
	const root = repoRoot(cwd);
	if (!root || !checkout.startsWith(root)) return;
	const rel = checkout.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
	if (!rel) return;
	const f = join(root, ".git", "info", "exclude");
	try {
		const prev = existsSync(f) ? readFileSync(f, "utf8") : "";
		if (prev.split("\n").some((l) => l.trim() === rel)) return;
		mkdirSync(join(root, ".git", "info"), { recursive: true });
		writeFileSync(f, `${prev}${prev.endsWith("\n") || prev === "" ? "" : "\n"}${rel}\n`);
	} catch { /* an un-ignored checkout is untidy, never broken */ }
}

/** Every store that resolves here, in declaration order. */
export function activeStores(cwd: string = process.cwd()): { config: StoreConfig; path: string }[] {
	const out: { config: StoreConfig; path: string }[] = [];
	for (const s of loadConfig(cwd).stores) {
		const p = storePath(s, cwd);
		if (p) out.push({ config: s, path: p });
	}
	return out;
}

export function currentProject(cwd: string = process.cwd()): string | null {
	const r = repoRoot(cwd);
	return r ? basename(r) : null;
}
