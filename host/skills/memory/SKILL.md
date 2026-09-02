---
name: memory
description: REQUIRED before answering from your own recollection of a past decision, prior art, or why something is the way it is — call recall/search first. Also use when a lesson is worth keeping past this session. Triggers: "why did we", "what did we decide", "remember this", "have we hit this before", "prior art", durable lesson, gotcha worth keeping.
---

# Memory

Two stores, one reach rule.

## Read before you answer

Call `recall` (everything this project may see) or `search` (semantic, inside what it may see) **before** answering from your own memory of a past decision. Your recollection of this conversation is not the record; the store is.

Nothing outside the caller's reach can appear in either result, regardless of how well it matches — the reach filter runs first and ranking runs second. Both matter: the filter alone, without semantic ranking, finds the right memory first only 4% of the time, and puts it in the top five 22%.

## Write when it transfers

Call `remember` when a lesson will still be true, and still useful, in a repo that is not this one.

**The routing test: would this help someone working on a different project?** If yes, it is a memory. If it is a log of what you did here today, it is not — that belongs in a commit message.

## Scope is reach, and reach decides storage

| scope | who sees it | where it is stored |
|---|---|---|
| `project` (default) | only the repos named in `projects` | this repo, if it names only this repo |
| `platform` | any caller sharing a platform | global store |
| `general` | every project | global store |

Prefer `platform` over `general`. A dependency's quirk, a language rule or a toolchain behaviour is `platform`, however hard-won. `general` means it would help someone whose stack shares nothing with yours, and it must be justified with `generality`.

Two things are enforced rather than trusted:

- Claiming `general` while naming projects is **downgraded** to `project` — by your own admission it is scoped to them. The original claim is kept as `claimed_scope` so the downgrade can be audited.
- A memory that would reach nobody is **refused**, not widened. Project-scoped naming no projects is invisible to everyone; the fix is to name them, not to grant the widest possible reach because the narrowest could not be determined.

## What the content gate will refuse

Memories in a shared store are scanned before they are staged, and a memory carrying credentials, private keys, UUIDs, absolute home paths, email addresses, internal hostnames or private IPs is **quarantined**, not published. Clean memories beside it still land.

The gate is a deny-list over shapes. It cannot see a secret described in prose or spaced out character by character — write the lesson, not the evidence.

## When recall comes back empty

Call `explain`. Every failure in this layer looks identical from outside — "no results" — and `explain` is what tells an empty store apart from a reach mismatch apart from a renamed project. It lists every memory in both stores with the exact reason it was shown or withheld.

It is also the audit view. Each memory carries what was **claimed** beside what was **recorded**: `claimed_scope` when reach was narrowed at write time, `claimed_confidence` when a flagged claim was capped, and the origin repo when a memory reaches a project it was not written in. Nothing is silently rewritten — the original assertion survives next to the outcome.
