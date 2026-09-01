---
description: Find memories that state one lesson several times, and propose a single rule that keeps the evidence.
---

A store accumulates near-duplicates honestly: three sessions hit the same wall in three repos, and each records what it learned. Every one is correct on its own; together they are one rule stated three times, and retrieval has to choose between them.

Do this:

1. **Get the candidates.** Call `memory_status` for the store paths, then run the cluster finder:
   ```
   node <plugin>/core/setup/consolidate.mjs
   ```
   It proposes and never writes. Each proposal shows the members, the vocabulary they were grouped on, and a similarity score.

2. **Judge each cluster before believing it.** The grouping is lexical, and lexical similarity is wrong in both directions: two memories can share vocabulary and mean opposite things ("retry immediately" and "never retry immediately"), or share almost none and be the same lesson in two dialects. Read the members. Reject freely — a rejected proposal costs seconds; a bad consolidation costs a correct memory.

3. **Write the rule with its anchors.** If the members genuinely state one claim:
   ```
   remember({
     title: "<the claim, stated once, properly>",
     body:  "<what is true, why, and what it means for the reader>",
     kind:  "learning",
     supersedes: ["<member>", "<member>"],   // marked and KEPT, never deleted
     ...reach that covers every project the members named
   })
   ```
   **`supersedes` is not optional here.** A consolidated rule that replaces its sources without naming them loses the evidence it was built from, and the next reader cannot tell a rule observed three times from an assertion someone made once.

4. **Widen reach only as far as the evidence.** Three project-scoped memories about three repos consolidate to a memory naming those three repos — not to `general`. Observing something three times is not observing it everywhere, and the write path will narrow an over-claim anyway.

5. **Say what you did**, one line per cluster: what was consolidated, what it now says, and which memories were marked.

If nothing clusters, say so. A store with no duplicates is the normal state, not a failed run.
