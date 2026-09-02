# The Record

This is how Vestige was built, what was measured, and why it has the shape it has. It exists so the reasoning can be checked by someone who was not here — every number below is reproducible from a committed script, and every design choice is traceable to a measurement that preceded it.

Three companion documents, kept separate on purpose: [ARCHITECTURE.md](./ARCHITECTURE.md) is how it works, [PROVENANCE.md](./PROVENANCE.md) is which parts came from where, and [README.md](./README.md) is how to install it. This document is the argument.

---

## Everything below was re-measured, and the earlier numbers are withdrawn

An earlier version of this document reported retrieval at **rank-1 1.000** and later **0.541**, on a corpus of templated memories averaging 75 words with **0.2 concrete specifics each**. A working store's memories run to a median of **484 words and 14 specifics**. A corpus that thin cannot distinguish its own documents, so a ranker cannot either, and every retrieval score taken on it described the fixture rather than the system.

The fixture was rebuilt, the numbers moved, and most of them moved **down**. They are reported here as measured.

Two things follow that matter more than the scores:

- **The old and new figures are not comparable, and neither are anyone else's.** The corpus changed *and* the query source changed, so the difference between the two runs cannot be attributed to either. Every competing configuration in this document was therefore re-run on the new corpus with the same scorer. Publishing a harder number for this system beside an easier one for another would be a comparison in which only one side changed.
- **A gate now stands between the corpus and any score.** `harness/verify-corpus.mjs` profiles the fixture against a real store — length distribution, distinct vocabulary, density of concrete specifics counted as *types* and not occurrences — and the pipeline refuses to benchmark when it fails. It is two-sided: a fixture richer than production flatters the result exactly as a thinner one buries it.

---

## The method

**A pre-registered ablation ladder**, each rung changing one variable from the rung below, with a graded prediction recorded before the run. Two of those predictions were wrong in ways that changed the design.

**The fixture is a simulated engineering organisation**, not a bag of documents: 8 services with dependency edges, **143 incidents**, and **183 memories** written from them. 40 incidents span two services and are written up from both sides. 27 memories **correct an earlier memory about the same incident** — verified to read as retractions, not merely to carry the edge. Memories were generated with their length sampled from the real store's decile table and then **counted in code**, topped up until they landed; a model asked for 500 words returns 180 and reports success.

**Queries come from the incident record and never from the memory text**, in three registers that are reported separately and never averaged:

| register | what it is |
|---|---|
| `symptom` | what someone types when they know what they are seeing — forbidden from using the artefact or metric name |
| `identifier` | what they paste from a terminal |
| `short` | three to five words, typed in a hurry |

183 queries per register, one correct memory each. `found@5` is recall of that memory; `rank-1` is how often it is the first thing the agent sees.

**Every arm was scored by the same code**, including the competing systems. The query-to-answer mapping is written down beside the artifacts rather than recovered from filenames.

---
## Retrieval, by how the question was asked

Three registers, three retrieval arms, 183 queries each, one correct memory per query.

| register | arm | rank-1 | found@5 | MRR |
|---|---|---|---|---|
| symptom | typed sub-queries | **0.454** | 0.929 | 0.650 |
| symptom | + query expansion | 0.393 | 0.885 | 0.593 |
| symptom | + cross-encoder rerank | 0.454 | **0.956** | 0.667 |
| identifier | typed sub-queries | **0.530** | 0.880 | 0.672 |
| identifier | + query expansion | 0.497 | 0.880 | 0.643 |
| identifier | + cross-encoder rerank | 0.530 | **0.918** | 0.689 |
| short | typed sub-queries | 0.328 | 0.836 | 0.521 |
| short | + query expansion | **0.355** | 0.858 | 0.543 |
| short | + cross-encoder rerank | 0.328 | **0.902** | 0.556 |

**The spread across registers is the result.** rank-1 runs from 0.328 to 0.530 depending only on how the question is phrased. An average over the three would be 0.44 — a number describing none of them, and the reason they are never averaged here.

**Reranking never changes the answer, and reliably improves the shortlist.** rank-1 is identical to the digit in all three registers, and the entire miss breakdown is unchanged, while found@5 rises in all three. Compared list-by-list it changes the top-5 *set* for roughly half the queries and the first slot for almost none — 183 of 183 identical at rank 1 on one register, 180 of 183 on another. So the honest statement is conditional on what the caller reads: **a consumer of the top hit pays 28–34× the latency for an answer that does not change; one that reads five gains 2.7 to 6.6 points of recall.** It stays off by default.

**Query expansion costs accuracy and repeatability both.** Over three runs on `symptom`:

| | mean rank-1 | sd | runs |
|---|---|---|---|
| typed sub-queries | **0.454** | **0.000** | 0.454, 0.454, 0.454 |
| + query expansion | 0.384 | 0.030 | 0.393, 0.344, 0.415 |

The typed arm returns the identical result three times; expansion swings **seven points between runs**, because a hypothetical document is generated text and it lands in the ranking. The gap between the arms is 0.070, comfortably outside that spread, so the accuracy conclusion holds — but it has to be quoted as a mean over runs, not the single figure a one-shot benchmark would have produced.

That spread also retires a claim this document nearly made. On `short`, a single run put expansion **0.027 ahead** — the register of three-to-five-word queries, which is precisely the case a hypothetical-document expansion exists for, and a tempting result. It is under one standard deviation of the expansion arm's own run-to-run noise. **On this evidence expansion is not better on short queries; it is indistinguishable there and worse elsewhere.**

The mechanism behind the loss is visible in the misses: on `symptom` expansion takes same-project siblings from 83 to 96, because a hypothetical document resembles the *topic* rather than the incident.

---

## What took the top slot when the right memory did not

Four causes, because they have four different fixes.

| register | rank-1 | same incident, other version | sibling | other project | junk | returned nothing |
|---|---|---|---|---|---|---|
| symptom | 0.454 | 17 | 83 | **0** | **0** | **0** |
| identifier | 0.530 | 15 | 71 | **0** | **0** | **0** |
| short | 0.328 | 18 | 105 | **0** | **0** | **0** |

**Zero cross-project hits and zero junk, in every register and every arm.** Every failure is ranking *within* the project that asked. The reach filter is not partially effective here; it does not leak at all.

**"Same incident, other version" is not topical confusion.** It is the predecessor, its correction, or the other service's account of the same event — a question about which *version* to serve, and it disappears the moment it is counted as a sibling.

---

## The correction slice, which single-gold scoring gets backwards

27 of the 183 memories correct an earlier memory about the same incident. Those 27 queries name a gold the corpus itself marks as **out of date**.

| register | strict rank-1 | rank-1 accepting the correction | stale ranked above its correction | current memory on top |
|---|---|---|---|---|
| symptom | 0.407 | **0.741** | 14 | 9 |
| identifier | 0.370 | **0.630** | 17 | 7 |
| short | 0.148 | **0.593** | 7 | 12 |

**On short, vague queries the two differ by four times.** The vaguer the question, the more often the system returns the *current* memory instead of the specific superseded one it was asked for — which is what a memory system should do, and what strict known-item scoring calls a failure.

Reported as three numbers rather than one because they answer different questions. The third column is the outcome that actually harms an agent: a stale write-up ranked above the correction that exists in the same store. It is not rare, and it is not fixed.

---
## Against MCS, three configurations, one corpus

The prior art is [`mcs-cli/memory`](https://github.com/mcs-cli/memory), which recently gained a qmd retrieval backend on the `bruno/qmd-retrieval-backend` branch. All three of its configurations were re-run on **this corpus, these queries, and this scorer** — the earlier comparison in this document was taken on the retired fixture and is withdrawn.

Each configuration is replicated from its own `sync-memories.sh` rather than approximated: a named index under the project via `QMD_CONFIG_DIR`/`INDEX_PATH`, one embedding model in all three of qmd's slots, and the structured `intent`/`lex`/`vec` query shape with reranking off that its own instructions tell the agent to use. The shipped arm is docs-mcp-server over a flat pool, embedding through Ollama — rebuilt from nothing, since that environment no longer existed, and therefore running today's versions rather than the ones the original figure used.

**found@5, the measure of whether the answer reached the agent at all:**

| | symptom | identifier | short |
|---|---|---|---|
| **Vestige** | **0.929** | **0.880** | **0.836** |
| MCS + qmd, one index per project | 0.459 | 0.432 | 0.399 |
| MCS + qmd, one shared pool | 0.219 | 0.235 | 0.142 |
| MCS as shipped, flat pool | 0.393 | 0.311 | 0.350 |

**Where the misses go is the more useful table.** Documents retrieved from a project that did not ask:

| | symptom | identifier | short |
|---|---|---|---|
| **Vestige** | **0** | **0** | **0** |
| MCS + qmd, per project | 0 | 0 | 0 |
| MCS + qmd, shared pool | 138 | 130 | 147 |
| MCS as shipped | 121 | 134 | 138 |

Both shared-pool configurations spend most of their top slots on another project's memories. That is not a tuning gap; it is what a pool with no notion of who is asking does once there is more than one project in it, and it is the failure the reach model exists to remove. **It is also the one result that got larger on a realistic corpus.**

---

## The gap against their per-project arm is the query path, not the architecture

The per-project configuration leaks nothing — zero cross-project hits, identical to this system. **So on that arm there is no scoping difference to credit, and the tempting reading is unavailable.** What differs is how the query reaches the engine, and both shapes already exist in this codebase: typed sub-queries through a resident server is the default here, and a single structured document through a fresh CLI process is this plugin's own fallback.

One index, one corpus, one embedding model, reranking off in both, and the only variable is delivery:

| | rank-1 | found@5 |
|---|---|---|
| typed sub-queries, resident session | **0.454** | **0.929** |
| one structured document, CLI per query | 0.399 | 0.454 |

That second row reproduces the other stack's per-project result to three decimals — they measured 0.399 and 0.459. Replicated on the `identifier` register: 0.328 / **0.432** against their measured 0.339 / **0.432**, an exact match on found@5.

**So their number is explained by the query shape their own instructions specify, on their own index, and by nothing architectural.** Stating it the other way round would have been the most flattering explanation available and also the first one a reader would check.

Put usefully rather than competitively: **passing explicit lex and vec sub-queries instead of one auto-expanded document roughly doubles found@5 on their index, with no other change.**

---

## Latency is two numbers, and the mean is neither

The search session holds **one index**, and the index is per caller, so a query for a different project shuts it down and starts it again — paying a model load. A fixture that interleaves projects pays that on nearly every query; an agent working in one repository almost never does.

| arm | same project | after a project switch |
|---|---|---|
| typed sub-queries | **22–26 ms** | 1,559–1,635 ms |
| + query expansion | 300–330 ms | 2,733–2,786 ms |
| + cross-encoder rerank | 729–756 ms | 3,165–3,252 ms |

Reported split because a single mean over this workload was 1,421 ms — a figure nobody experiences. The earlier published figure of 14 ms was the same measurement taken on documents a fifth the length; it is withdrawn along with the rest.

---

## What it cannot do: decline

Every query in every experiment above has a correct answer in the store, so no arm can be punished for answering when it should not. Measured separately, with 64 questions no engineering store could answer — cooking, music, eighteenth-century European history, a gibberish token — issued **with** a project identity, which is the harder case:

| | returned something | mean hits | carried any caveat |
|---|---|---|---|
| off-topic — the store has nothing | 1.000 | 5.0 | 0.000 |
| on-topic — the store holds the answer | 1.000 | 5.0 | 0.000 |

**Identical on every axis the caller can observe.** An agent receiving these results cannot tell a question the store answers from one it has never heard of.

The cause is structural rather than a tuning choice: qmd is invoked in a mode that returns filenames and discards scores, the hit type carries no score field, and the no-match branch returns whatever is visible in ranked order. There is nothing for a threshold to read.

And the engine is not the limitation. The competing arms **do** return nothing for one to seven queries per register on the same engine and corpus. Under this query shape and per-caller view it never did — across 549 real queries and 64 deliberately off-topic ones — so the "nothing matched" fallback is dead code in practice. This is open, unfixed, and the most useful thing in this document for anyone deciding whether to depend on it.

---
## Why the numbers fell: a corpus-quality ablation

The retired fixture and this one differ in *two* ways — the corpus and where the queries came from — so the difference between the two runs cannot be attributed to either. This arm removes that ambiguity: **same world, same 143 incidents, same queries, same scorer, and the only variable is how much was written per memory.**

| | median words | specifics | distinct specifics |
|---|---|---|---|
| thin arm | 97 | 7.3 | 5.3 |
| rich arm | **502** | **15.6** | **9.4** |

| register | rank-1 thin → rich | found@5 thin → rich | same-project siblings in misses |
|---|---|---|---|
| symptom | 0.541 → **0.454** | 0.934 → 0.929 | 69 → **83** |
| identifier | 0.508 → 0.530 | 0.852 → 0.880 | 65 → 71 |
| short | 0.399 → **0.328** | 0.847 → 0.836 | 88 → **105** |

**A five-fold richer corpus lowers rank-1 and leaves found@5 alone.** Recall does not move: the right memory reaches the shortlist just as often. What changes is the first slot, and the mechanism is in the miss column — **richer memories make same-project siblings harder to tell apart**, because two 500-word write-ups about neighbouring incidents in one service share far more surface than two 97-word ones.

So the drop from the earlier published figures is not the system getting worse. It is the task getting harder in the specific way real stores are harder, and the earlier fixture was easy in a way that flattered the first-slot number while saying nothing about recall.

The exception is the `identifier` register, where richer memories help slightly: a pasted metric name has more text to appear in.

**Two bounds, stated because they limit the claim.** The thin arm lands at a median of 97 words against a sampled target of 75 — the generating model floors around 50–60 words for this prompt and the length loop only ever adds — so the contrast is 5.2× rather than the ~7× separating this corpus from the retired one, and the effect measured here is a **lower bound** on what that fixture's thinness was worth. And the thin arm's symptom rank-1 of 0.541 is numerically identical to the figure this document used to publish; that is a coincidence of two different query sets on two different thin corpora, and it is not offered as a reproduction.

---
## What the fixture could still be doing for the system

A synthetic corpus can flatter a retriever in ways no score reveals, so the ways this one might were measured rather than argued away.

**Queries are written from the incident record and never from the memory text.** That removes the obvious leak — a query paraphrased from its own answer shares an author and a vocabulary with it — but both artefacts are still rendered from the same structured record, so the question is what carries the match. Overlap between a query and its correct memory, against a same-project sibling and against another project's memory:

| register | query↔gold | ↔sibling | ↔other project | ratio | what carries it |
|---|---|---|---|---|---|
| symptom | 0.0161 | 0.0067 | 0.0070 | 2.4× | *users, memory, daily, messages, upstream, database* |
| identifier | 0.0066 | 0.0015 | 0.0015 | 4.3× | `dlq_depth`, `capture_lag_seconds`, `pool_wait_ms`, `cache_hit_ratio` |
| short | 0.0092 | 0.0034 | 0.0038 | 2.7× | *memory, field, duplicate, upstream, charge, stale* |

**The `identifier` row is the control that makes the other two believable.** It is the register that pastes the metric name by design, and the diagnostic detects exactly that — schema identifiers carrying the match, at nearly double the ratio. A leakage test that found nothing everywhere would be indistinguishable from a broken one. On the two registers where leakage would be a problem, ordinary English carries the match.

**A leak that stripping the heading did not remove.** Titles derive from the incident symptom and the opening line of the body restates it, so a symptom query matches the first sentence at 0.052 against 0.015 for the rest of the document — **3.3–3.4× concentration, consistent across all three registers**. A real incident note does open by stating the symptom, so this is not simply wrong; it does make the fixture easier than one where the symptom must be inferred from the mechanism.

**Where the corpus does not match the store it models.** It carries 15.6 concrete specifics per memory against a real 14.0, but only **9.4 distinct** ones against 11.2 — it repeats identifiers slightly more than real memories do. Both are inside the gate's band and the direction is stated rather than smoothed over.

**And a claim that had to be corrected downward.** The world offers 175 memories an earlier note to reference; **77 actually do**. The generator's instruction is not a property of its output, and the realised rate is what the corpus has.

---
## Containment

A pool that leaves the machine needs to be inspected, and neither parent system inspects content. Against a corpus with 80 planted secrets — credentials, tokens, keys, private hosts, home paths, and base64-wrapped variants:

| | result |
|---|---|
| planted secrets quarantined | **80 of 80** |
| clean memories wrongly held | **0** |
| contaminated blobs reachable in remote history | **0** |

The zero in the last row is the one that matters, and it is a property of *where* the gate runs, not how good it is. Running the same gate after staging produced a clean `HEAD` over a dirty history — every planted secret still reachable in the remote by SHA. For anything append-only, retraction is not containment. The gate now runs before the sync path takes its first look at the working tree.

Two properties were learned rather than designed: it **fails closed**, counting an unreadable file or an unevaluable rule as contaminated; and it **quarantines per file**, so one bad memory does not hold up the clean ones — a gate that loses clean work is a gate people switch off.

Its limits are stated rather than implied: it is a deny-list, it cannot see a secret spaced out character by character or described in prose, and that was measured rather than assumed.

---

## A negative result, kept

An early design intended to separate episodic session logs from durable lessons, on the widely-repeated argument that mixing them degrades retrieval of both. Tested directly, at ratios up to 5.6 logs per lesson, **it did not reproduce** — found@5 and rank-1 were unchanged.

The tier was therefore not built. It is recorded here because a borrowed argument that survives testing and one that was never tested look identical in a design document, and because the reason a feature is *absent* is worth as much as the reason one is present.

---

## The layer that makes any of it happen

Plumbing without a trigger is a store nobody writes to. `remember` and `search` existed for some time with nothing that ever called them.

Three mechanisms fix that, and all three were verified inside a live session rather than a unit test, because installing a plugin proves its hooks are registered and nothing more:

- **The protocol is injected once per session.** Verified by a live session completing a sentence that appears in no other file on the machine.
- **Delegating discovery is gated.** A sub-agent spawned to "go find out" begins without what the store already holds, and rediscovers it at the cost of the whole sub-agent. The gate advises and never hard-blocks — a script bug must not become a barrier with no escape — and its advice is budgeted per turn so it cannot drive a loop.
- **Capture is a judgement, not a recording.** Most sessions produce nothing worth keeping, and that is the expected outcome; a store full of near-misses is worse than a small one.

Every decision the gate makes is appended to a bounded audit log, because the failure modes here are silent by construction: a nudge that fired and a nudge that was never reached are indistinguishable from the state alone, and so are a matcher that never matched and a tool that was never called. Live verification found real defects in this layer that no unit test could have — all of them in the wiring rather than the logic — which is the argument for the log rather than an argument against the design.

---

## How the pieces follow from the evidence

| The measurement | What it forced |
|---|---|
| Both shared-pool configurations spend 130–147 of 183 top slots on another project's memories; this system spends **zero** | Reach is the primary structure, and filtering happens before ranking rather than after |
| A memory's reach and its location can disagree | Reach *computes* storage — the same declaration decides both |
| Typed sub-queries return an identical result three times; expansion swings seven points | The query is stated, not expanded, and the engine is kept resident |
| Reranking changes the top-5 set for half the queries and the first slot for almost none | Reranking is off by default, and the reason is written down rather than assumed |
| A gate after staging leaves a dirty history | The content gate runs before the sync path touches the tree |
| Every silent failure in this layer presents as "no results" | `explain`, and an audit log for the gate |
| The system cannot tell an unanswerable question from an answerable one | **Unresolved.** Stated as a limitation rather than designed around |

---
## What is deliberately absent

Stated so nobody assumes otherwise: there is no episodic tier (tested, did not reproduce), no consolidation of repeated observations into rules, and no decay or confirmation signal — nothing tracks whether a memory was ever retrieved or ever useful, so nothing can sink on evidence. The content gate is a deny-list with measured limits. These are open, not hidden.

---

## Reproducing all of it

```bash
git clone https://github.com/breferrari/memory-stack-lab
git clone https://github.com/breferrari/vestige      # sibling directory
cd memory-stack-lab && ./reproduce.sh
```

It regenerates the world from seed, writes the corpus through this plugin's real write path, gates it against a real store's profile, generates the queries from the incidents, and scores every arm — including the competing configurations — with the same code. Each stage waits for the machine to be idle and stamps the load average into its own results, because timings taken on a busy box have been wrong here twice.

Run artifacts land under `runs/` and are **not committed** — the repository ships the generator and the scorer rather than their output, so a number in this document is only as good as a reader's ability to reproduce it. An earlier version of this paragraph claimed the artifacts were committed; they never were.

`./run-everything.sh` runs the full matrix used for this document: three query registers, three retrieval arms, three competing configurations, the corpus-quality ablation, repeat runs for the stochastic arm, and the leakage and abstention diagnostics.

The benchmarks import the plugin directly. They used to import a copy of its write path, which broke when the plugin renamed a module — the break was the good outcome, since for as long as both existed the benchmark measured code that had quietly stopped matching the thing it claimed to measure.

---

## Authorship and audit trail

Vestige was designed and built by **Brenno Ferrari**, in the open, with the full history in this repository and the measurements in [memory-stack-lab](https://github.com/breferrari/memory-stack-lab). Every claim in this document is either reproducible from `reproduce.sh` or traceable to a commit that states what was measured and what it changed.

It is explicitly not a from-scratch design, and [PROVENANCE.md](./PROVENANCE.md) says which component came from where, naming both parents: the distribution model and most of the behavioural layer from [`mcs-cli/memory`](https://github.com/mcs-cli/memory) by Bruno Guidolim, and the reach model and write contract from [obsidian-mind](https://github.com/breferrari/obsidian-mind). What is new here is listed separately, and most of it is new only because combining the two exposed a gap that neither had on its own.

Where a claim was made and then measured to be wrong, it was retracted in the commit history rather than quietly edited — including one benchmark whose numbers turned out to be measuring the machine's load rather than the software.
