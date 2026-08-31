# Architecture

How a memory gets in, where it goes, and who can see it. Every box below is code that exists.

The whole design rests on one property: **reach is declared once, and everything else is derived from it.** Storage location, visibility and ranking are all computed from the same declaration, so they cannot drift apart.

---

## The pieces

```
core/lib/memory.ts       the write contract, reach filter and pool naming
core/lib/stores.ts       store kinds, routing, and materialising an external store
core/lib/index-view.ts   per-caller search index over exactly what a caller may see
core/lib/vestige.ts      the public API: remember, recall, search, explain
core/lib/sanitize.ts     the content gate
core/lib/sync.ts         git pull/push, deletion review, bounded retry
core/lib/protocol.ts     the text that makes an agent use the store
core/setup/qmd.ts        provisioning: install, update, heal
core/setup/doctor.mjs    diagnosis
core/setup/migrate.mjs   re-route memories when the configuration changes
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

    style C fill:#e7f5ff,stroke:#1971c2
    style K fill:#fff4e6,stroke:#e67700
    style N fill:#d3f9d8,stroke:#2f9e44
    style P fill:#f8f9fa,stroke:#868e96
```

Three deliberate choices:

- **The protocol goes in once per session, not once per turn.** Injecting every turn is the reliable choice and costs a paragraph of context forever; text that appears every turn also stops being read.
- **The gate advises and never hard-blocks.** A script bug must not become a gate with no escape. Nudges are budgeted per turn so the hook cannot drive a search-then-spawn loop.
- **Capturing nothing is the expected outcome.** Most sessions produce no durable memory, and a store full of near-misses is worse than a small one.

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

    style R1 fill:#ffe3e3,stroke:#c92a2a
    style R2 fill:#ffe3e3,stroke:#c92a2a
    style R3 fill:#ffe3e3,stroke:#c92a2a
    style Q fill:#ffe8cc,stroke:#d9480f
    style F fill:#fff4e6,stroke:#e67700
    style H fill:#fff4e6,stroke:#e67700
    style O fill:#d3f9d8,stroke:#2f9e44
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

    style P fill:#d3f9d8,stroke:#2f9e44
    style G2 fill:#e7f5ff,stroke:#1971c2
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

    style W fill:#ffe3e3,stroke:#c92a2a
    style V fill:#d3f9d8,stroke:#2f9e44
    style Y fill:#c5f6fa,stroke:#0c8599
```

**Default deny is load-bearing.** A caller with no identity sees only `general` — the safest reading of "I do not know who you are". A memory whose frontmatter will not parse is visible to nobody: a memory whose reach cannot be read has not declared a reach.

**The index is per caller and named.** Isolation is a property of the index *name*, not of a directory — running `qmd init` in a per-caller directory silently creates nothing and every collection lands in the shared default index, which would put every project's memories in one place underneath a filter whose entire job is to keep them apart. Index builds are serialised with a cross-process lock, because two sessions building at once contend on one shared cache and the loser would otherwise degrade to unranked results without saying so.

**Both layers matter.** The filter decides what may be seen; the ranker decides which of it answers the question. With the filter and no semantic ranking, rank-1 accuracy is 0.09 against 0.98. Neither substitutes for the other.

---

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

## What is deliberately absent

Stated so nobody assumes otherwise:

- **No episodic tier.** Only durable lessons. Session logs are a different artifact with different ranking needs, and the claim that mixing them degrades both was tested here up to 5.6 logs per lesson and **did not reproduce** — so the tier is not built on a borrowed argument.
- **No consolidation.** Repeated observations do not promote into a rule.
- **No decay or confirmation.** Nothing tracks whether a memory was ever retrieved or ever useful, so nothing can sink on evidence.
- **The content gate is a deny-list.** It catches credentials, keys, UUIDs, home paths, emails, internal hostnames and private IPs, including base64-wrapped ones. It cannot see a secret spaced out character by character or described in prose. Measured, not assumed.
