# Provenance

Vestige is not a from-scratch design. It takes a distribution model from one system and a reach model from another, and the parts that are genuinely new are new because putting those two together forced them.

This document says which is which, component by component, so nobody has to guess — including the people whose work it builds on.

- **MCS** — [`mcs-cli/memory`](https://github.com/mcs-cli/memory) and [`mcs-cli/shared-memories`](https://github.com/mcs-cli/shared-memories), by Bruno Guidolim.
- **OM** — [obsidian-mind](https://github.com/breferrari/obsidian-mind)'s memory layer.

---

## From MCS

The **distribution model**, and most of what makes memory actually happen rather than sit unused.

| | What it is |
|---|---|
| Git-shared pool | Memories as markdown in a git repository, synced rather than served. The whole shape of the thing. |
| Separate memories repo | The store is its own repository, sparse-cloned into the checkout and kept out of the project's history — team memory decoupled from any product repo. |
| Single-branch, blobless, sparse clone | So only the memory markdown materialises and pack plumbing never hits the working tree. |
| Pre-flight remote probe | Check the remote is reachable **before** touching the filesystem. Without it, a missing SSH key and a wrong branch both present as one empty directory. |
| Pull at session start, push at the turn boundary | The sync rhythm. |
| Deletions held back by default | A write adds; a deletion removes for everyone. MCS defaults to parking deletions for review, and was right to. Vestige shipped the wrong behaviour first and was corrected by reading the hook. |
| Filename guardrail | A regex the sync path refuses to push outside of. |
| `**Applies to:**` | The human-readable ownership line, kept for legibility and for existing tooling. |
| Gating delegated discovery | Stop an agent spawning a sub-agent to "go find out" before it has searched. One of the best ideas in the packs, and not one that would have occurred to us. |
| A skill that decides what qualifies | Capture as a judgement — learning vs decision vs *nothing* — rather than recording everything. |
| An audit where DROP is success | User-initiated, walks each memory, acts only on approval. |
| Protocol injection at the prompt | Telling the session the store exists and when to use it. |
| Sync-checked duplicated prose | Marked blocks that must stay byte-identical across files. Vestige needed this for the same reason within a week. |
| Doctor scripts | Separate local and remote diagnosis, because "memory isn't working" has several very different causes. |
| Arrival announcements | A shared store otherwise pulls in silence. |

---

## From obsidian-mind

The **reach model** and the **write contract**. Several of these are used unmodified — `core/lib/om/` is OM's code, vendored rather than reimplemented.

| | What it is |
|---|---|
| The facet model | `scope` (general / platform / project) plus `projects[]` and `platforms[]` as the declaration of who a memory is for. |
| `isVisibleTo` | The visibility rule, evaluated in a deliberate order, **default deny**. A caller with no identity sees only `general`. |
| `narrowScope` | Reach is narrowed, never widened. Claiming `general` while naming projects is downgraded, and `claimed_scope` preserves what was asked for. |
| The epistemic contract | Reject a transcript; flag a claim that generalises past one observation and cap its confidence, keeping `claimed_confidence`. |
| Refusing a memory that reaches nobody | Rather than widening it — granting the widest reach because the narrowest could not be determined is backwards. |
| Specificity ranking | A memory naming your project beats one sharing a platform, which beats a general one. |
| Atomic `claimFile` | Same-day, same-title collisions suffix rather than clobber. |
| Hardened slug | Path traversal, Windows reserved names, and the characters that terminate a wikilink. |
| `origin` from the caller's identity | Stamped by the server, not supplied in the payload — the one field a caller cannot simply assert. |
| Cross-platform qmd invocation | Resolve the package's real JS entry and run it with the current Node binary, instead of a shell shim that breaks on Windows. |
| Native-binding self-heal | A Node upgrade leaves the search engine resolvable, version-reporting, and dead. The fix is a rebuild, not a reinstall. |

---

## New here

Some of these are small. They are listed because they are the parts neither parent had, and most exist because combining the two exposed a gap that only shows up when both are present.

### Reach computes storage

**The load-bearing one.** A memory's narrowed scope decides which store it goes to, so its reach and its location cannot disagree.

In MCS the two are independent, which is how a team-wide lesson ends up in one engineer's repo and a repo-specific one ends up in the company pool. OM has a single store, so the question never arises. Only a system with both a reach model *and* multiple stores has to answer it — and deriving one from the other is what removes the class of mistake rather than documenting it.

### Storage as declared configuration

Store *kinds* — `repo`, `external`, `local` — each declaring which scopes it `accepts`. Routing is data, not code, so a team that keeps memory out of product repos and a solo user with one directory are the same system with different configuration.

### Filter before rank, over a per-caller view

The reach filter runs first and semantic ranking second, inside a materialised view of exactly what the caller may see, indexed under a **per-caller name**.

The alternative — rank globally, filter after — is bounded by the retrieval engine's result ceiling and degrades as projects multiply. Measured: 0.09 rank-1 with the filter and no ranking, 0.98 with both. Neither layer substitutes for the other.

### A write-time content gate

Neither parent inspects what a memory *contains*. MCS guards the filename; OM has no shared store to leak into. A pool that leaves the machine needs a scan, and it needs three properties that were each learned the hard way: it **fails closed**, it **quarantines per file** so one bad memory does not hold up the clean ones, and it runs **before staging** — a gate after staging leaves a clean `HEAD` over a dirty history, which is not containment.

### Bounded retry with jitter on push

MCS pushes once and says "will retry on next Stop" — but the next Stop lands in the next simultaneous burst. Measured with a barrier-synchronised race, three runs at each width: a single attempt lands **exactly one writer regardless of N** — 1 of 5, 1 of 10, 1 of 20, with zero variance — while bounded retry lands **all of them**, also with zero variance.

### Foreignness derived at read time

A memory naming your project but written from elsewhere still reaches you — that is how a cross-cutting lesson travels — but it is identified and ranked below native ones. Derived from `origin` versus `projects` when read, not stamped when written, so a writer cannot suppress it by omitting a field.

### `explain`

Retrieval that reports why each memory was shown or withheld, with what was **claimed** beside what was **recorded**. Every failure in this layer otherwise presents identically as *no results*, and a narrowing that cannot be inspected is correct but not auditable.

### A host-agnostic core

Sync runs from the MCP server rather than a hook, so correctness never depends on a host feature — which is what lets Codex work at all, having no hooks. The Claude hooks became an optimisation instead of the mechanism.

### Usefulness split by who it belongs to

Retrieval is per-reader and stays in a local log that is never synced; confirmation is evidence about the claim and goes in the memory. Neither parent separates these, and MCS has no usefulness signal at all. The split is the point: put retrieval in the memory and a shared store becomes a telemetry stream that also publishes who reads what.

### Consolidation that proposes and never writes

Clusters of memories stating one claim are found lexically and handed to a reader. The threshold is set from measurement rather than taste. Neither parent has this; the reason it stops short of writing is that lexical similarity is wrong in both directions — two memories can share vocabulary and mean opposite things.

### Smaller ones

- **An anonymous writer cannot claim org-wide reach.** The read side already treated "I don't know who you are" as a reason to show almost nothing; the write side treated it as a reason to allow the widest possible claim.
- **The search engine is provisioned, updated and healed** by the plugin, rather than assumed present. It is a hard dependency, so leaving it to the user is friction on the one thing that makes retrieval work.
- **Index builds take a cross-process lock.** Two sessions building at once contend on one shared cache, and the loser silently degrades to unranked results.
- **Store-to-store migration** driven by scope, so changing the configuration re-routes what already exists.

---

## And the measurements

The harness is its own contribution and lives at [memory-stack-lab](https://github.com/breferrari/memory-stack-lab): a ladder that changes one variable at a time, a ceiling calculator that separates "could not find it" from "it was not there", and a barrier-synchronised push race that measures contention without measuring the machine.

That last one exists because the obvious design — spawn N writers and count — reports load average rather than behaviour, and swung 14× on one machine in one afternoon.
