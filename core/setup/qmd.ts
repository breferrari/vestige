/**
 * qmd provisioning — install it, keep it current, and heal it when a Node
 * upgrade breaks it.
 *
 * qmd is a HARD dependency, not an optional accelerator: with the same reach
 * filter and the same views, facet-only ranking scores rank-1 0.044 against
 * qmd's 0.454, and found@5 0.219 against 0.929. So it cannot be assumed present, and "install it yourself" is
 * install friction on the one thing that makes retrieval work.
 *
 * NOT installed into the host's own directory. It lives under VESTIGE_HOME so
 * the same runtime serves Claude Code, Codex, or anything else speaking MCP —
 * nothing about qmd is host-specific, and putting it inside one host's plugin
 * directory would make the other hosts second-class.
 *
 * Cross-platform without conditionals: npm installs qmd as a .cmd/.ps1 shim on
 * Windows that Node's spawn cannot resolve without a shell, and the shim itself
 * depends on /bin/sh. So rather than scattering `shell: win32` flags, this
 * resolves the package's real JS entry and runs it with the CURRENT Node
 * binary. One code path on every platform. (Approach taken from obsidian-mind,
 * where it is already load-bearing in production.)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PKG = "@tobilu/qmd";

export function vestigeHome(): string {
	return process.env.VESTIGE_HOME ?? join(homedir(), ".vestige");
}
/**
 * Where qmd itself is installed.
 *
 * NOT under VESTIGE_HOME. The runtime is a ~250 MB CACHE, not user data, and
 * tying it to the home meant every isolated home reinstalled it — a test suite
 * that redirects VESTIGE_HOME per run produced 854 MB per run and filled the
 * disk. VESTIGE_HOME isolates stores, state and indexes, which is what isolation
 * is actually for; the engine is shared like any other tool on the machine.
 */
function runtimeDir(): string {
	return process.env.VESTIGE_RUNTIME ?? join(homedir(), ".vestige", "runtime");
}

/**
 * Locate qmd's real JS entry.
 *
 * NOT via `require.resolve("<pkg>/package.json")` — that is the obvious way and
 * it fails on this package: qmd declares an `exports` map with only a "."
 * subpath, and modern Node honours `exports` by BLOCKING every unlisted
 * subpath, package.json included. The failure looks exactly like "not
 * installed", which is the worst possible disguise for "installed and fine".
 *
 * So: resolve the "." export to get a file inside the package, walk up to the
 * directory that owns it, and read package.json off DISK. Disk reads are not
 * subject to the exports map.
 */
export function resolveQmdEntry(): string | null {
	const candidates = [join(runtimeDir(), "node_modules", ...PKG.split("/"))];
	for (const base of [join(runtimeDir(), "package.json"), import.meta.url]) {
		try {
			const inner = createRequire(base).resolve(PKG);
			let dir = dirname(inner);
			for (let i = 0; i < 6; i++) {
				if (existsSync(join(dir, "package.json"))) { candidates.push(dir); break; }
				dir = dirname(dir);
			}
		} catch { /* not resolvable from this base */ }
	}
	for (const dir of candidates) {
		try {
			const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			if (meta.name !== PKG) continue;
			const rel = typeof meta.bin === "string" ? meta.bin : (meta.bin?.qmd ?? meta.bin?.[PKG]);
			if (!rel) continue;
			const entry = join(dir, rel);
			if (existsSync(entry)) return entry;
		} catch { /* try the next candidate */ }
	}
	return null;
}

/** Argv for running qmd with the current Node binary. No shell, no shim. */
export function qmdCommand(args: readonly string[]): { cmd: string; argv: string[] } | null {
	const entry = resolveQmdEntry();
	if (!entry) return null;
	return { cmd: process.execPath, argv: [entry, ...args] };
}

export function runQmd(args: readonly string[], opts: { cwd?: string } = {}): { ok: boolean; stdout: string; stderr: string } {
	const c = qmdCommand(args);
	if (!c) return { ok: false, stdout: "", stderr: "qmd is not installed" };
	const r = spawnSync(c.cmd, c.argv, { cwd: opts.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function npm(args: readonly string[]): boolean {
	const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
		cwd: runtimeDir(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
	});
	return r.status === 0;
}

function ensureRuntimeDir(): void {
	mkdirSync(runtimeDir(), { recursive: true });
	const pkg = join(runtimeDir(), "package.json");
	if (!existsSync(pkg)) {
		writeFileSync(pkg, JSON.stringify({ name: "vestige-runtime", private: true, description: "Vestige's own qmd install. Safe to delete; it will be reinstalled." }, null, 2));
	}
}

export function installedVersion(): string | null {
	const r = runQmd(["--version"]);
	if (!r.ok) return null;
	return (r.stdout.match(/\b(\d+\.\d+\.\d+)\b/) ?? [])[1] ?? null;
}

function latestVersion(): string | null {
	const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["view", PKG, "version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	return r.status === 0 ? r.stdout.trim() || null : null;
}

const cmp = (a: string, b: string): number => {
	const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
	return 0;
};

export interface EnsureResult {
	readonly ok: boolean;
	readonly version: string | null;
	readonly action: "present" | "installed" | "updated" | "healed" | "failed";
	readonly detail: string;
}

/**
 * Make qmd usable. Idempotent, and safe to call on every session start.
 *
 * Three states are distinguished because they look identical from outside —
 * every one of them presents as "search returns nothing":
 *
 *   missing  -> install
 *   broken   -> a Node upgrade leaves the native better-sqlite3 binding built
 *               against the old ABI. qmd resolves and reports a version, so a
 *               presence check passes, and every query dies with
 *               ERR_DLOPEN_FAILED. The fix is a rebuild, not a reinstall.
 *   outdated -> update, at most once a day
 */
export function ensureQmd(opts: { update?: boolean } = {}): EnsureResult {
	ensureRuntimeDir();

	let version = installedVersion();
	if (version === null) {
		if (!resolveQmdEntry()) {
			if (!npm(["install", "--no-audit", "--no-fund", "--loglevel=error", PKG])) {
				return { ok: false, version: null, action: "failed", detail: `could not install ${PKG}` };
			}
			version = installedVersion();
			return version
				? { ok: true, version, action: "installed", detail: `installed ${PKG}@${version}` }
				: { ok: false, version: null, action: "failed", detail: "installed but still not runnable" };
		}
		// resolvable but not runnable => broken native binding, not a missing package
		npm(["rebuild", "better-sqlite3"]);
		version = installedVersion();
		return version
			? { ok: true, version, action: "healed", detail: `rebuilt the native binding; qmd ${version} works again` }
			: { ok: false, version: null, action: "failed", detail: "qmd resolves but will not run, and a rebuild did not fix it" };
	}

	if (opts.update !== false && shouldCheckUpdate()) {
		const latest = latestVersion();
		markUpdateChecked();
		if (latest && cmp(latest, version) > 0) {
			if (npm(["install", "--no-audit", "--no-fund", "--loglevel=error", `${PKG}@${latest}`])) {
				const now = installedVersion() ?? latest;
				return { ok: true, version: now, action: "updated", detail: `updated qmd ${version} -> ${now}` };
			}
		}
	}
	return { ok: true, version, action: "present", detail: `qmd ${version}` };
}

/** Update checks hit the network, so at most once a day — never on the hot path twice. */
function stampPath(): string { return join(vestigeHome(), ".qmd-update-check"); }
function shouldCheckUpdate(): boolean {
	if (process.env.VESTIGE_NO_UPDATE) return false;
	try {
		const t = Number(readFileSync(stampPath(), "utf8").trim());
		return !Number.isFinite(t) || Date.now() - t > 24 * 60 * 60 * 1000;
	} catch { return true; }
}
function markUpdateChecked(): void {
	try { mkdirSync(vestigeHome(), { recursive: true }); writeFileSync(stampPath(), String(Date.now())); } catch { /* best effort */ }
}
