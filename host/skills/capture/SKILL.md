---
name: capture
description: Evaluate what this session learned and route it — a durable memory, a local config note, or nothing. Use when a session produced reusable knowledge, and when the user says "remember this", "save what we learned", "run a retrospective", or "extract learnings". Invoked automatically at the end of substantive work; do not ask permission.
---

# Capture

Decide whether this session produced something worth keeping, and route it. **This skill is the only path to a memory store — never write into one directly**, or the reach narrowing, the content gate and the collision handling are all skipped.

Routing to "nothing" is a **successful outcome**, not a failure. Most sessions produce no durable memory, and a store full of near-misses is worse than a small one.

## What qualifies

<!-- SYNC:qualifies -->
A memory must clear all three to be worth keeping.

- **It transfers.** It would still be true, and still useful, to someone working in a different repository. A lesson that is only true of one file on one branch is a code comment. Test: *"name the project or platform this applies to, and why."* If the answer is "any project, it's just how the tool works", it belongs in that tool's documentation, not here.
- **It is a conclusion, not a log.** What is true and what to do about it — never a narration of the session that produced it. "Fixed the checkout bug, rebased, updated the changelog" is a commit message.
- **It is about the work, not a person.** No names, handles or emails anywhere, and no "who did what". Describe the artifact — the bug, the pattern, the decision. Identifiers age badly and carry no signal even in a store of one.
<!-- /SYNC -->

### A learning — something discovered that was not obvious

- the investigation was real, not a documentation lookup
- the error message was misleading and the root cause was not where it pointed
- a workaround for a genuine tool or framework limitation
- a workflow or performance property found by experiment

### A decision — a deliberate choice about how something should work

- an architectural choice, with the alternatives it beat
- a convention established and backed by something: lint config, a written doc, team agreement, or consistent existing usage
- a trade-off resolved between competing concerns

> A personal preference is not a decision. *"I prefer"*, *"I like"*, *"my style"* — those do not qualify. Consistent use in the codebase is the strongest evidence a convention is real.

## What does not

- **Public documentation.** Anything a reader could look up in a language reference, a framework README, or public API docs. Test: *"is this true of the tool everywhere, for everyone?"* If yes, it belongs in that tool's docs, not here.
- **A log of what happened.** "Fixed the checkout bug, rebased, updated the changelog" is a commit message. A memory is a conclusion, not a diary.
- **Machine-local configuration.** A path on this machine, a personal shell alias, an environment quirk of one laptop. Suggest a note in the project's own local config file instead — that suggestion is a successful outcome.
- **Anything that names a person.** No names, handles or emails, anywhere. Describe the artifact — the bug, the pattern, the decision — not who touched it. Identifiers age badly and carry no signal.

## How to write it

**The title is the claim, not the topic.** `Retries need an idempotency key` — not `Notes on retries`. A future session reads titles before it reads bodies.

**The body is for a reader with none of your context**: what is true, why, and what it means for what they are about to do. Include the evidence that convinced you. If you are stating a figure that rots — a version, a count, a benchmark — date it.

**Set confidence honestly.** `verified` means you checked it against code, a doc, or a run, and it requires saying how in `verification`. If you are reasoning from one observation, it is `inferred`.

## Choosing reach — the decision that matters most

Reach is the field that determines who ever sees this. Getting it wrong in the wide direction pollutes every project; getting it wrong in the narrow direction hides the lesson from the repo that needed it.

| scope | use when | example |
|---|---|---|
| `project` | it is true of these repositories and not in general | this service's retry budget, this app's build quirk |
| `platform` | it is true of a language, framework, dependency or toolchain | a Swift concurrency trap, an npm resolution behaviour |
| `general` | it would help someone whose stack shares nothing with yours | a measurement discipline, a reasoning failure mode |

**Prefer `platform` over `general`.** A hard-won dependency lesson feels universal and almost never is. `general` requires a `generality` explaining why it reaches everywhere; if you cannot write that sentence, it is not general.

Name every project the lesson applies to in `projects` — the field is a list precisely so a lesson spanning two repositories reaches both without either knowing about the other.

## Steps

Do these in order. Step 1 is the one that gets skipped, which is why step 5 exists.

1. **Search first.** Call `search` or `recall` for what you are about to write.
2. **Take the branch the result dictates**, and there are only four:
   - **Already captured, nothing to add** — stop. This is a success, not a failure.
   - **Extends an existing memory** — write the better version with `supersedes: [<the old one>]`. The old memory is marked and kept, never deleted: what was believed at the time is evidence that it changed.
   - **Related but distinct** — write it with `related: [<the sibling>]`. The link is written on both files.
   - **Genuinely new** — write it.
3. **Judge it** against the sections above. Most sessions stop here, and that is correct.
4. **Write it** with `remember`, choosing reach deliberately and setting `kind` to `learning` or `decision`.
5. **Print the receipt, in one line, before you stop:**

   ```
   KB search: "<query>" -> <n> hits, <what they covered> -> <branch taken>
   ```

   This is not ceremony. Step 1 is invisible when it is skipped — a session that never searched and a session that searched and found nothing produce identical output, and the store fills with near-twins either way. The receipt makes the branch visible, which is the only thing that makes skipping it noticeable.

6. **Read what came back.** The tool reports what it changed: a narrowed scope, a capped confidence, a quarantined file, and which memories it superseded or linked. Those are not noise — a narrowed scope means your reach claim was wider than your own `projects` list, and a quarantine means the memory carried something that must not leave this machine.
