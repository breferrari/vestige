---
name: audit
description: Review the memory stores and keep them lean — walk each memory and recommend KEEP, DROP or UPDATE with reasons, acting only on what the user approves. Use when the user says "audit memories", "review memories", "clean up memories", or asks whether the store is still any good. User-initiated only; never run automatically.
---

# Audit

Walk the memory stores and keep them worth reading. **DROP is the audit working**, not the audit failing — a store that only ever grows is a store nobody trusts, because the reader cannot tell the load-bearing memories from the near-misses.

> **User-initiated only.** Never run this as part of another workflow, and never delete anything the user has not approved.

## Before starting

Call `memory_status` and `explain`. `explain` matters more than it looks: it shows what each memory *claimed* beside what was *recorded* — a narrowed scope, a capped confidence, a foreign origin. A memory whose reach was narrowed at write time is worth a second look, because its author believed it was broader than it is.

## The rules, applied at audit time

<!-- SYNC:qualifies -->
A memory must clear all three to be worth keeping.

- **It transfers.** It would still be true, and still useful, to someone working in a different repository. A lesson that is only true of one file on one branch is a code comment. Test: *"name the project or platform this applies to, and why."* If the answer is "any project, it's just how the tool works", it belongs in that tool's documentation, not here.
- **It is a conclusion, not a log.** What is true and what to do about it — never a narration of the session that produced it. "Fixed the checkout bug, rebased, updated the changelog" is a commit message.
- **It is about the work, not a person.** No names, handles or emails anywhere, and no "who did what". Describe the artifact — the bug, the pattern, the decision. Identifiers age badly and carry no signal even in a store of one.
<!-- /SYNC -->

A memory failing any of these is a candidate for UPDATE when a rewrite restores it, or DROP when nothing survives the rewrite.

## The three verdicts

**KEEP** — it still qualifies, it is still true, and its reach is right.

**UPDATE** — the knowledge is good and the artifact is not. Rewrite when:
- the reach is wrong: `general` that is really `platform`, or a project list missing a repo the lesson clearly covers
- a volatile figure has no date, or has one that is now old enough to mislead
- confidence outruns the evidence, or `verified` has no `verification`
- it states a conclusion without the evidence that would let a reader judge it
- it names a person

**DROP** — nothing of value survives a rewrite:
- public documentation that anyone could look up
- a session log rather than a conclusion
- a personal preference presented as a convention
- superseded by a better memory that already exists
- about a project that no longer exists, where the lesson does not transfer

## Checks worth running

- **Duplicates and near-twins.** Search the store for each memory's own claim. Two memories saying the same thing in different words are worse than either alone — the reader has to reconcile them.
- **Reach that never matched.** A memory nothing can see is a memory that does not exist. `explain` names these.
- **Contradictions.** Two memories that cannot both be true. This is the highest-value find in an audit and the hardest — resolve it by evidence and date, and supersede rather than deleting the history.
- **Stale volatility.** Versions, counts, benchmarks. Date them or drop them.

## How to run it

Work in batches the user can actually judge — ten at a time, not a hundred. For each: the claim, the verdict, and one line of reasoning. Ask before acting, and act only on what came back approved.

Report at the end: how many kept, updated, dropped, and what the store looks like now. If nothing needed changing, say that plainly — an audit that finds nothing is a good result and should not be dressed up as one that found something.
