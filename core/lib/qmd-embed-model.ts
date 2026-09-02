/**
 * Which embedding model a caller's index uses.
 *
 * qmd resolves its embedder as `config.embed || QMD_EMBED_MODEL || <its own
 * default>`, and MATERIALISES that default into the config file the first time
 * it touches an index. The environment variable is therefore only read before
 * that first write, which for an index this plugin creates on demand means
 * never reliably. The config file is the only durable surface.
 *
 * qmd owns that file and rewrites it as collections change, so editing it is
 * expected rather than intrusive. The edit is still surgical: one key, with
 * collections, patterns and everything else left as they were.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** qmd's own default embedder — verified identical in 2.1.0, 2.5.3 and 2.8.3. */
export const QMD_DEFAULT_EMBED_MODEL =
	"hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";

/**
 * What this plugin uses instead.
 *
 * Measured over all 549 benchmark queries, bootstrap intervals resampling
 * queries and McNemar's exact test on paired outcomes: found@5 0.882 → 0.938,
 * 36 queries recovered against 5 lost, p < 0.001. rank-1 moves from 0.437 to
 * 0.466 and that difference rests on about five queries, so it is not claimed.
 * Confirmed on two real vaults outside the benchmark corpus.
 */
export const PREFERRED_EMBED_MODEL =
	"hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf";

/**
 * Every embedder qmd has shipped as its default, so a future version changing
 * it is still recognised as "nobody chose this" rather than read as somebody's
 * deliberate choice — which would silently stop applying this one, with no
 * error and nothing failing. Add to this set rather than replacing.
 */
const QMD_SHIPPED_DEFAULTS: ReadonlySet<string> = new Set([QMD_DEFAULT_EMBED_MODEL]);

/** Where qmd keeps a named index's config. */
export function qmdConfigPath(index: string): string {
	const dir = process.env.QMD_CONFIG_DIR
		?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "qmd");
	return join(dir, `${index}.yml`);
}

const MODELS_KEY_RE = /^models:/m;
const MODELS_BLOCK_RE = /^models:[ \t]*(?:#[^\n]*)?\n(?:(?![^\s]).*\n?)*/m;
const EMBED_LINE_RE = /^([ \t]+)embed:[ \t]*(.*?)[ \t]*$/m;

/** Reduce a captured YAML scalar to the string it denotes: drop an inline comment, then one layer of quotes. */
function yamlScalar(raw: string): string {
	let v = raw.trim();
	const comment = v.search(/\s#/);
	if (comment !== -1) v = v.slice(0, comment).trim();
	const quoted = (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
	return quoted && v.length >= 2 ? v.slice(1, -1) : v;
}

export type EmbedModelPatch =
	| { readonly kind: "updated"; readonly content: string }
	| { readonly kind: "already-set" }
	| { readonly kind: "user-chosen"; readonly current: string }
	| { readonly kind: "unsupported"; readonly reason: string };

/** Exactly one top-level `models:` and at most one `embed:` inside it. */
function isWellFormed(content: string): boolean {
	if ((content.match(/^models:/gm) ?? []).length !== 1) return false;
	const block = MODELS_BLOCK_RE.exec(content);
	return (block?.[0].match(/^[ \t]+embed:/gm) ?? []).length <= 1;
}

/**
 * Set `models.embed` to `desired`, preserving everything else.
 *
 * Refuses anything it cannot edit safely rather than appending: a second
 * top-level `models:` key makes the file unparseable, and qmd rethrows that as
 * a config error that takes the collection and all search with it. Every result
 * is checked for well-formedness before it is returned, so the corruption class
 * cannot recur through a spelling nobody anticipated. CRLF is normalised for
 * matching and restored on the way out.
 */
export function upsertEmbedModelInYaml(content: string, desired: string): EmbedModelPatch {
	const crlf = content.includes("\r\n");
	const text = crlf ? content.replace(/\r\n/g, "\n") : content;
	const restore = (out: string): string => (crlf ? out.replace(/\n/g, "\r\n") : out);
	const block = MODELS_BLOCK_RE.exec(text);

	if (!block) {
		if (MODELS_KEY_RE.test(text)) {
			return { kind: "unsupported", reason: "a `models:` key that is not a block mapping this can edit" };
		}
		const separator = text.endsWith("\n") || text.length === 0 ? "" : "\n";
		const out = `${text}${separator}models:\n  embed: ${desired}\n`;
		return isWellFormed(out)
			? { kind: "updated", content: restore(out) }
			: { kind: "unsupported", reason: "appending a models block would not be well-formed" };
	}

	const splice = (patched: string): EmbedModelPatch => {
		const out = text.slice(0, block.index) + patched + text.slice(block.index + block[0].length);
		return isWellFormed(out)
			? { kind: "updated", content: restore(out) }
			: { kind: "unsupported", reason: "the edit would have produced a duplicate key" };
	};

	const embed = EMBED_LINE_RE.exec(block[0]);
	if (!embed) return splice(block[0].replace(/^models:/, `models:\n  embed: ${desired}`));

	// An `embed:` key with no value is unset, not chosen.
	const current = yamlScalar(embed[2] ?? "");
	if (current === desired) return { kind: "already-set" };
	if (current !== "" && !QMD_SHIPPED_DEFAULTS.has(current)) return { kind: "user-chosen", current };
	return splice(block[0].replace(EMBED_LINE_RE, `$1embed: ${desired}`));
}

/**
 * Apply the model choice to a named index's config on disk.
 *
 * Returns true when the file changed, which is exactly when the caller must
 * force a re-embed: the two models produce different dimensions, qmd refuses to
 * mix them, and a query against a mixed index throws rather than degrading.
 */
export function setEmbedModel(index: string, desired: string = PREFERRED_EMBED_MODEL): boolean {
	const path = qmdConfigPath(index);
	let before: string;
	try {
		before = readFileSync(path, "utf-8");
	} catch {
		return false; // qmd has not created it yet; the next build will.
	}
	const result = upsertEmbedModelInYaml(before, desired);
	if (result.kind !== "updated") return false;
	try {
		writeFileSync(path, result.content, "utf-8");
		return true;
	} catch {
		return false; // a config we cannot write is not a reason to fail the build
	}
}
