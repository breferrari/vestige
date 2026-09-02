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

Vestige is not a from-scratch design and does not pretend to be. It takes a **distribution model** from one system and a **reach model** from another, and most of what is new exists because combining them exposed a gap that only appears when both are present.

- The shared-pool distribution model, the discovery gate, the capture and audit skills, and the deletion-review default come from [`mcs-cli/memory`](https://github.com/mcs-cli/memory) and [`mcs-cli/shared-memories`](https://github.com/mcs-cli/shared-memories) by Bruno Guidolim.
- The facet model, the write contract and the scope narrowing come from [obsidian-mind](https://github.com/breferrari/obsidian-mind) — `core/lib/om/` is its code, vendored rather than reimplemented.
- What is new here is chiefly that **reach computes storage**, the filter-before-rank retrieval over a per-caller view, the write-time content gate, and a host-agnostic core that also runs on Codex.

**[PROVENANCE.md](./PROVENANCE.md) says which is which, component by component**, so nobody has to guess — including the people whose work it builds on.

## Maturity

Honest about what is and is not established:

- **Measured** on a corpus built to match a real store — 183 memories, median 502 words, gated against a working vault's own profile before any score is taken:
  - **What reach buys.** 57 queries asked by a service that did *not* write the memory it needs, about a fault in a shared library: declared reach retrieves it into the top five **77%** of the time; one shared pool **60%**; one index per project **0%**, because the document is not in that index at any *k*.
  - **Within a project**, the right memory reaches the top five 84–93% of the time and is first 33–53%, depending entirely on how the question is phrased. The three query registers are reported separately because averaging them describes none of them.
  - **Zero** hits from another project and zero junk, in every register and arm — which follows from the filter running before the engine.
  - 80 of 80 planted secrets quarantined, zero contaminated blobs reaching git history, zero clean memories held back.
  - The behavioural layer verified inside live sessions rather than only in tests.

  Full method, every number, and what the measurements do **not** establish: **[RECORD.md](./RECORD.md)**. The harness is public at [memory-stack-lab](https://github.com/breferrari/memory-stack-lab).
- **Established, and bad**: it cannot decline. Asked something the store has no memory of, it returns five confident memories that are indistinguishable — on every axis a caller can observe — from a real answer. Structural, measured, unfixed. Every ranking figure above is therefore conditional on the question having an answer.
- **Not established**: it has not been used in anger on real work over time. There is no episodic tier — tested, and deliberately not built. Consolidation proposes but never writes, by design. Defects in this codebase have been found by benchmarking and by cross-platform CI rather than by anything failing in use; assume there are more.
- **Measured at scale**: 180 projects and 3,600 memories, with **20 visible to one caller** — unchanged from 40 projects — and write cost flat at 3.9 ms per memory.

## Documentation

| | |
|---|---|
| [RECORD.md](./RECORD.md) | how it was built, what was measured, why this shape. Start here to evaluate it |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | how it works — the write path, the recall path, the sync path |
| [PROVENANCE.md](./PROVENANCE.md) | which component came from which prior system, and what is new |

MIT.
