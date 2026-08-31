# Vestige

Durable, scoped memory for coding agents. Memories are markdown, and **reach is declared per memory** — so a lesson learned in one repository reaches the repositories it applies to, and no others.

Works in Claude Code as a plugin, and in Codex CLI over the same MCP server.

> **Status: early.** Benchmarked thoroughly, run in anger not at all. See [Maturity](#maturity).

## Why reach is the whole design

A shared memory pool with no notion of scope has one failure mode, and it gets worse as it grows: everything is visible to everything. Ask about retries in the payments service and you get retry lessons from five other codebases, ranked above your own.

Vestige makes reach a property of the memory:

| scope | who sees it | where it is stored |
|---|---|---|
| `project` | only the repositories it names | in the repo, if it names only that repo |
| `platform` | any caller sharing a platform | the global store |
| `general` | everything | the global store |

Two rules are enforced rather than trusted, and they matter more than they look:

- **Reach is narrowed, never widened.** Claiming `general` while naming specific projects is downgraded to those projects — by the memory's own admission — and the original claim is kept as `claimed_scope` so the downgrade can be audited. Without this, a filter is defeated by anything that over-claims: measured at a 24% over-claim rate, an unprotected filter drops from 0.98 to 0.39 rank-1 accuracy.
- **A memory that would reach nobody is refused**, not widened. Granting the widest reach because the narrowest could not be determined is the opposite of what narrowing is for.

## What it does

- **`remember`** — record a lesson that transfers. The routing test is exactly that: *would this help someone working in a different repository?*
- **`recall`** — everything this project may see, ranked by specificity then recency.
- **`search`** — semantic search **inside** what it may see. The reach filter runs first and ranking second, so nothing outside your reach can appear however well it matches.
- **`explain`** — why each memory was shown or withheld, with what was *claimed* beside what was *recorded*. Every failure in this layer otherwise presents identically as "no results", and this is what tells an empty store apart from a reach mismatch.
- **`memory_status`** — where the stores are and what is visible.

Plus the parts that make memory actually happen rather than sit unused: a protocol injected once per session, a gate that asks you to search before delegating discovery, a capture skill that decides what qualifies, and an audit skill that keeps the store lean.

## Install

```
/plugin marketplace add breferrari/vestige
/plugin install vestige
```

Node 22+. [qmd](https://github.com/tobi/qmd) is required and is installed and kept current for you — it is not an optional accelerator: without semantic ranking inside the filtered view, rank-1 accuracy falls from 0.98 to 0.09.

For Codex, see [`codex/`](./codex).

## Storage is configuration, not policy

Declare stores in `.vestige/config.json` — in the repo, or in `~/.vestige/`:

```json
{
  "stores": [
    { "name": "project",  "kind": "repo",     "path": ".vestige/memories", "accepts": ["project"] },
    { "name": "team",     "kind": "external", "url": "git@example.com:acme/memories.git",
      "path": ".vestige/.team", "accepts": ["platform", "general"] },
    { "name": "personal", "kind": "local",    "path": "memories", "accepts": ["*"] }
  ]
}
```

An `external` store is a **separate git repository**, sparse-cloned into the workspace and kept out of your project's history — for teams who keep memory out of product repos on purpose. Add [vestige-shared](https://github.com/breferrari/vestige-shared) to sync it.

You never choose a location by hand: the narrowed scope picks the store, so a memory's reach and its location cannot disagree.

## What it will refuse to publish

Memories bound for a shared store are scanned before anything is staged. Credentials, private keys, UUIDs, absolute home paths, email addresses, internal hostnames and private IPs are **quarantined**, not published — per file, so one bad memory never holds up the clean ones beside it.

Stated plainly, because a security claim without its limits is worse than none: this is a deny-list over shapes. It does not catch a secret spaced out character by character, or one described in prose. Write the lesson, not the evidence.

## Prior art

Vestige is not a from-scratch design and does not pretend to be.

The **shared-pool distribution model** — memories in their own git repository, sparse-cloned per checkout, synced at session boundaries, with deletions held back for review — comes from [`mcs-cli/memory`](https://github.com/mcs-cli/memory) and [`mcs-cli/shared-memories`](https://github.com/mcs-cli/shared-memories) by Bruno Guidolim. So do several ideas worth stating individually: gating discovery behind a lookup, a skill that decides what qualifies rather than capturing everything, an audit that treats DROP as success, probing a remote before touching the filesystem, and keeping duplicated prose honest with sync-checked blocks.

The **facet-based reach model and the write contract** — scope narrowing with an audit trail, the epistemic contract that caps confidence on a claim that outruns one session, atomic non-clobbering writes — come from [obsidian-mind](https://github.com/breferrari/obsidian-mind).

What Vestige contributes is the combination, plus reach as the thing that computes storage.

## Maturity

Honest about what is and is not established:

- **Measured**: rank-1 0.98–1.00 end to end on a 183-memory, 16-project corpus; unchanged under a 24% scope over-claim; zero contaminated blobs reaching git history from 80 planted leaks at 100-engineer scale. The harness is public: [memory-stack-lab](https://github.com/breferrari/memory-stack-lab).
- **Not established**: it has never run as an installed plugin in a real session. There is no store-to-store migration. Scale is untested past 16 projects. Eight defects were found in this codebase by benchmarking rather than by anything failing — assume there are more.

MIT.
