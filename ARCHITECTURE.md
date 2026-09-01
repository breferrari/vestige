# Architecture

How a memory gets in, where it goes, and who can see it. Every box below is code that exists.

Where each piece came from — MCS, obsidian-mind, or new here — is in [PROVENANCE.md](./PROVENANCE.md). Why it is shaped this way, with the measurements that forced each choice, is in [RECORD.md](./RECORD.md).

The whole design rests on one property: **reach is declared once, and everything else is derived from it.** Storage location, visibility and ranking are all computed from the same declaration, so they cannot drift apart.

---

## The pieces

```
core/lib/memory.ts       the write contract, reach filter and pool naming
core/lib/stores.ts       store kinds, routing, and materialising an external store
core/lib/index-view.ts   per-caller search index over exactly what a caller may see
core/lib/qmd-session.ts  the search engine, kept resident for the session
core/lib/usage.ts        retrieval kept local, confirmation kept in the memory
core/lib/consolidate.ts  finds memories stating one claim; proposes, never writes
core/lib/vestige.ts      the public API: remember, recall, search, explain
core/lib/sanitize.ts     the content gate
core/lib/sync.ts         git pull/push, deletion review, bounded retry
core/lib/protocol.ts     the text that makes an agent use the store
core/setup/qmd.ts        provisioning: install, update, heal
core/setup/doctor.mjs    diagnosis
core/setup/migrate.mjs   re-route memories when the configuration changes
core/setup/import.mjs    take in an existing pile without resurrecting deletions
core/setup/consolidate.mjs  print consolidation candidates
host/                    the Claude Code surface: hooks, skills, commands, MCP
codex/                   the Codex surface: AGENTS.md and registration
```

`core/` is host-agnostic. Everything host-specific is a thin adapter, which is why the same server serves Claude Code and Codex, and why sync does not live in a hook — Codex has none.

---

## What makes any of it happen

Plumbing without a trigger is a store nobody writes to. `remember` and `search` existed for a while with nothing that ever called them, which is what this layer prevents.

```mermaid
flowchart TD
    A["turn begins"] --> B{"first turn of the session?"}
    B -->|yes| C["inject the memory protocol once"]
    B -->|no| D{"does the prompt carry a signal?"}
    C --> D
    D -->|"debugging, a decision, a convention, an explicit ask"| E["inject that nudge, once per class per session"]
    D -->|no| F["say nothing"]

    G["about to delegate discovery"] --> H{"has this turn consulted the store?"}
    H -->|yes| I["allow"]
    H -->|no| J{"nudge budget left this turn?"}
    J -->|no| I
    J -->|yes| K["advise: search first"]

    L["work produced a conclusion"] --> M["capture skill evaluates and routes"]
    M -->|"a durable lesson"| N["remember, with reach chosen"]
    M -->|"machine-local config"| O["suggest a local note instead"]
    M -->|"public docs, or a session log"| P["capture nothing"]

    style C fill:#e7f5ff,stroke:#1971c2,color:#16181d
    style K fill:#fff4e6,stroke:#e67700,color:#16181d
    style N fill:#d3f9d8,stroke:#2f9e44,color:#16181d
    style P fill:#f8f9fa,stroke:#868e96,color:#16181d
```

Three deliberate choices:

- **The protocol goes in once per session, not once per turn.** Injecting every turn is the reliable choice and costs a paragraph of context forever; text that appears every turn also stops being read.
- **The gate advises and never hard-blocks.** A script bug must not become a gate with no escape. Nudges are budgeted per turn so the hook cannot drive a search-then-spawn loop.
- **Capturing nothing is the expected outcome.** Most sessions produce no durable memory, and a store full of near-misses is worse than a small one.

Two properties of the gate exist because this layer fails silently by construction, and both were found by running it in a live session rather than a test:

**Every decision the gate makes is appended to a bounded `gate-log.jsonl`.** From the session state alone, a nudge that fired and a nudge that was never reached are indistinguishable — and so are a hook matcher that never matched and a tool that was never called. Without the log there is no way to tell a working gate from an absent one.

**Delegations are counted while in flight.** A sub-agent's prompt arrives on the same `UserPromptSubmit` hook carrying the parent's session id *and* the parent's transcript path; nothing in the payload distinguishes it. Treated as a new turn it resets the barrier the delegation just tripped, which voids both the record that the parent searched and the per-turn nudge budget that stops the gate driving a loop. A prompt arriving during an in-flight delegation therefore does not start a new turn, with a time-to-live so an aborted delegation cannot pin the barrier open. The accepted cost — a prompt genuinely sent mid-delegation carries the previous turn's search — is written down as a test, because a trade-off nobody encoded is a bug the next session will "fix" back.

---

## The capture path

Five places can refuse or alter a write, and each records what it did.

```mermaid
flowchart TD
    A["remember call"] --> B{"Is the origin known?"}
    B -->|"no, and scope is general"| R1["REFUSED<br/>an anonymous writer cannot claim org-wide reach"]
    B -->|otherwise| C["validateMemory"]

    C --> D{"Structural checks"}
    D -->|"no title, body under the floor, or a transcript"| R2["REFUSED<br/>a memory is a conclusion, not a log"]
    D -->|pass| E{"Epistemic contract"}

    E -->|"generalises over occurrences, or an undated figure"| F["FLAGGED<br/>confidence capped to inferred<br/>claimed_confidence preserved"]
    E -->|clean| G["narrowScope"]
    F --> G

    G -->|"claims general while naming projects"| H["DOWNGRADED to project<br/>claimed_scope preserved"]
    G -->|"reach is honest"| I["declared scope stands"]

    H --> J{"Would it reach anybody?"}
    I --> J
    J -->|"project-scoped but names no project"| R3["REFUSED<br/>never widened to general"]
    J -->|yes| K["render frontmatter, body, Applies-to line"]

    K --> L{"Content gate<br/>fails closed"}
    L -->|"carries a credential, path, host or key"| Q["QUARANTINED<br/>held outside the store, never staged"]
    L -->|clean| M["route to a store by the narrowed scope"]

    M --> N["claimFile<br/>atomic, suffixes rather than clobbering"]
    N --> O["memory on disk"]

    style R1 fill:#ffe3e3,stroke:#c92a2a,color:#16181d
    style R2 fill:#ffe3e3,stroke:#c92a2a,color:#16181d
    style R3 fill:#ffe3e3,stroke:#c92a2a,color:#16181d
    style Q fill:#ffe8cc,stroke:#d9480f,color:#16181d
    style F fill:#fff4e6,stroke:#e67700,color:#16181d
    style H fill:#fff4e6,stroke:#e67700,color:#16181d
    style O fill:#d3f9d8,stroke:#2f9e44,color:#16181d
```

**Reach is narrowed, never widened.** A memory claiming `general` while naming specific projects is scoped to them by its own admission. A memory that would reach *nobody* is **refused rather than widened**, because granting the widest possible reach when the narrowest could not be determined is the opposite of what narrowing is for.

**The gate fails closed and quarantines per file.** An unreadable file, an unevaluable rule or a scanner error all count as contaminated. The offending memory is held where its author can still see it, and the clean memories beside it still land — a gate that loses clean work is a gate people switch off.

---

## Where a memory goes

Storage is **configuration, not policy**. A store declares its kind and which scopes it accepts; a memory goes to the first store that accepts its narrowed scope.

| kind | where | for |
|---|---|---|
| `repo` | a directory inside the project repo | memories that travel with the code and are reviewed in its pull requests |
| `external` | a separate git repository, sparse-cloned into the workspace and locally excluded | team memory decoupled from any product repo |
| `local` | a plain directory | the personal default |

```mermaid
flowchart LR
    A["narrowed scope"] --> B{"is it project scope?"}
    B -->|no| G["first store accepting it"]
    B -->|yes| C{"names exactly this repo?"}
    C -->|yes| P["repo store<br/>committed with the project"]
    C -->|"names others, or several"| G
    G --> G2["external or local store<br/>reachable from every project"]

    style P fill:#d3f9d8,stroke:#2f9e44,color:#16181d
    style G2 fill:#e7f5ff,stroke:#1971c2,color:#16181d
```

An `external` store is cloned single-branch, blobless and sparse, so only the memory markdown materialises. The remote is probed **before** anything is written — a missing SSH key, a dropped VPN, revoked access and a wrong branch otherwise all present as one empty directory. The checkout is excluded through `.git/info/exclude` rather than the project's `.gitignore`, because where an engineer keeps their memories is their choice and does not belong in shared source.

When the configuration changes, `core/setup/migrate.mjs` re-routes existing memories to the stores their reach now implies. It is a dry run by default, never overwrites a name already taken, and verifies each copy before removing the original.

---

## The recall path

**Filter first, rank second.** That order is the architecture. Reversing it — rank globally, then filter — is bounded by the retrieval engine's result ceiling, which does not move as the number of projects grows.

```mermaid
flowchart TD
    A["recall or search"] --> B["caller identity<br/>project plus platforms"]
    B --> C["read every configured store"]
    C --> E["union"]

    E --> F{"isVisibleTo<br/>default deny"}
    F -->|"scope is general"| V["visible"]
    F -->|"projects names this caller"| V
    F -->|"platform scope overlaps"| V
    F -->|"no facet matches"| W["withheld"]
    F -->|"frontmatter will not parse"| W

    V --> X["materialise a per-caller view<br/>hardlinks, rebuilt when the set changes"]
    X --> Y["a NAMED qmd index over that view"]
    Y --> Z["semantic rank INSIDE the visible set"]
    Z --> R["ranked: native before foreign, then specificity, then recency"]

    style W fill:#ffe3e3,stroke:#c92a2a,color:#16181d
    style V fill:#d3f9d8,stroke:#2f9e44,color:#16181d
    style Y fill:#c5f6fa,stroke:#0c8599,color:#16181d
```

**Default deny is load-bearing.** A caller with no identity sees only `general` — the safest reading of "I do not know who you are". A memory whose frontmatter will not parse is visible to nobody: a memory whose reach cannot be read has not declared a reach.

**The index is per caller and named.** Isolation is a property of the index *name*, not of a directory — running `qmd init` in a per-caller directory silently creates nothing and every collection lands in the shared default index, which would put every project's memories in one place underneath a filter whose entire job is to keep them apart. Index builds are serialised with a cross-process lock, because two sessions building at once contend on one shared cache and the loser would otherwise degrade to unranked results without saying so.

**Both layers matter.** The filter decides what may be seen; the ranker decides which of it answers the question. With the filter and no semantic ranking, rank-1 accuracy is 0.09 against 0.98. Neither substitutes for the other.

**The query is stated, not expanded.** qmd's plain-text `query` is auto-expanded by the SDK into lex/vec/**hyde** variants, and HyDE writes a hypothetical answer with a model — an LLM call on every search, whose output then feeds the ranking. Vestige passes typed sub-queries instead: lexical first (it carries 2× weight, and a memory is found by the words of the problem more often than by a paraphrase), then vector. Measured over three runs each: rank-1 1.000 with zero variance at 14 ms a query, against 0.979 with sd 0.018 at 543 ms. `VESTIGE_QUERY_SHAPE=expand` restores expansion for a workload whose queries are worded unlike its documents — the case HyDE exists for, and the one this fixture does not stress.

**The engine is resident, not re-launched per query.** Invoking the search CLI per call paid its model-loading cost every time — 2,748ms per search, almost none of it search. qmd speaks MCP over stdio, so one child is started per session and reused, keyed on the view's signature so a changed visible set re-resolves rather than answering from a stale collection. The child is unreferenced from the event loop and torn down on exit, because a resident child otherwise keeps a CLI or a test runner from ever exiting.

**Reranking is off, and that is a measurement rather than a default.** On this corpus it returns **byte-identical hit lists on all 64 queries** — the same documents in the same order — for **2.7× the latency** (≈4,165 ms per query against ≈1,574 ms). Scores follow from that: found@5 1.000, rank-1 0.969, MRR 0.984 on both arms over three runs. Nothing to gain, most of the query budget to lose.

> An earlier version of this paragraph claimed the reranker actively *hurt* accuracy: 0.906 against 1.000, with four of sixty-four queries falling back to unranked results. **That does not reproduce.** It came from a harness that timed the two arms without scoring them, where those four fallbacks were a defect in the run rather than an effect of reranking. The narrower claim is the one the evidence supports, and it is still enough to justify the default — a stage that cannot change the answer has no accuracy case to make.

**The first query for a caller builds that caller's view index**, which costs seconds; every subsequent query in the session does not. Both are reported separately in the benchmarks, since one mean over the two describes neither.

---

## Which models run, and which ones do not

Retrieval is not one model. qmd holds three model slots — embed, generate and rerank — and **Vestige uses only the first**. Which ones run explains every latency number above, so the choice is recorded here; the models themselves, their sizes and how to change them are [qmd's](https://github.com/tobi/qmd) to document, and restating them here would only go stale the next time it picks a different one.

| slot | used | why |
|---|---|---|
| embed | **yes** | one vector per query, one per chunk at index time. The lexical half of the query costs no model at all — BM25 over an index — so a warm query is 14 ms |
| generate | no | the auto-expansion, HyDE included. ~500 ms per query, and a *hypothetical document* is generated text, so it lands in the ranking and moves between runs |
| rerank | no | byte-identical hit lists on all 64 queries, for 2.7× the latency |

Both refusals are measurements rather than preferences. Skipping expansion took rank-1 from 0.979 (sd 0.018) to 1.000 (sd 0.000) and a warm query from 543 ms to 14 ms — roughly 97% of what used to be called "search latency" was a model writing a paragraph nobody read.

Everything runs locally through qmd: **nothing leaves the machine at query time and there is no API key anywhere in this system.** That matters more for a memory store than it would elsewhere — the corpus is the most sensitive thing a team owns, and a hosted embedder on every search would undo the content gate.

> The trade this accepts: expansion exists for a query worded unlike the documents it should find, and this corpus does not stress that case. `VESTIGE_QUERY_SHAPE=expand` puts it back, at the cost now documented.

## The sync path, and why the order matters

```mermaid
sequenceDiagram
    participant T as Turn boundary
    participant G as Content gate
    participant S as Store
    participant R as Remote

    T->>G: scan every pending memory in ONE pass
    G->>S: move contaminated files to quarantine
    Note over G,S: BEFORE staging. A gate placed after<br/>staging leaves a clean HEAD over a<br/>dirty history, because rm --cached<br/>plus amend rewrites only the tip.
    T->>S: git add --ignore-removal
    T->>S: git commit
    loop bounded retry, full jitter
        T->>R: pull --rebase --autostash
        T->>R: push -u origin HEAD
    end
    Note over T,S: Deletions are NOT staged. Removing a<br/>memory removes it for everyone, so it<br/>needs a decision, not a side effect.
```

Both notes are properties the code enforces rather than intentions. Placing the gate after staging produced a clean `HEAD` over a dirty history — every contaminated memory still reachable in the remote — because retraction is not containment for anything append-only.

The single pass matters too: one process per file cost 5.67s on a 200-memory store; batched it is 29ms.

Sync runs from the server on a debounce, and the Claude hooks are an optimisation that syncs at a natural boundary. Correctness does not depend on any host feature.

---

## What the audit trail records

Nothing is silently rewritten. Every intervention keeps the original assertion beside the outcome, which is what makes a narrowing auditable rather than merely correct.

| Field | Written when | Answers |
|---|---|---|
| `origin` | always, from the caller's MCP roots — not from the payload | who wrote this, and may they claim what they claimed |
| `scope` / `projects` / `platforms` | always | who can see it |
| `claimed_scope` | reach was narrowed at write time | what the writer asked for, and what they got |
| `confidence` | always | how strongly it is asserted |
| `claimed_confidence` | a flagged claim was capped | that the contract intervened, and on what |
| `flags` | the contract fired | which rule, so a review can list every weak claim without re-reading a body |
| *derived* foreignness | computed at read time from `origin` vs `projects` | whether it was written from outside every project it claims |

Foreignness is **derived, not stamped**. A stamped marker was tried first and shipped inert, because the facet normaliser keeps only the fields the visibility rule needs. Deriving it also closes the evasion: a writer cannot suppress a property the reader computes for itself.

The `explain` tool renders this per memory with the reason each was shown or withheld — every failure in this layer otherwise presents identically as *no results*.

---

## What usefulness is allowed to change

Two signals, kept in different places on purpose.

**Retrieval is per-reader and frequent**, so it lives in a local log that is never synced and never committed. Writing it into the memory would rewrite shared files on every search — turning a store people review in pull requests into a stream of telemetry commits — and would publish who reads what.

**Confirmation is evidence about the claim**, so it is written into the memory itself, where the next reader sees it. It is idempotent per day per project: a number that inflates on repetition stops meaning anything.

Neither hides a memory. Never-retrieved is not useless — a memory nobody has needed yet is exactly what a store is for — so both only break ties that specificity and recency already left level, and the bonus is capped so popularity cannot displace relevance.

## What is deliberately absent

Stated so nobody assumes otherwise:

- **No episodic tier.** Only durable lessons. Session logs are a different artifact with different ranking needs, and the claim that mixing them degrades both was tested here up to 5.6 logs per lesson and **did not reproduce** — so the tier is not built on a borrowed argument.
- **No consolidation.** Repeated observations do not promote into a rule.
- **No decay or confirmation.** Nothing tracks whether a memory was ever retrieved or ever useful, so nothing can sink on evidence.
- **The content gate is a deny-list.** It catches credentials, keys, UUIDs, home paths, emails, internal hostnames and private IPs, including base64-wrapped ones. It cannot see a secret spaced out character by character or described in prose. Measured, not assumed.
