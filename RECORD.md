# The Record

This is what Vestige is, what was measured, and what the measurements support. It exists so the reasoning can be checked by someone who was not here.

Three companion documents: [ARCHITECTURE.md](./ARCHITECTURE.md) is how it works, [PROVENANCE.md](./PROVENANCE.md) is which parts came from where, [README.md](./README.md) is how to install it. This one is the argument.

> **Earlier retrieval figures in this repository are withdrawn.** They were measured on a fixture of templated memories averaging 75 words with 0.2 concrete specifics each, against a working store's median of 484 words and 14 specifics. A corpus that thin cannot distinguish its own documents, so a ranker cannot either. Everything below was re-measured on a rebuilt fixture, and where a competing system appears it was re-run on its own configuration at a pinned commit. Nothing from the old fixture survives into a table here.

---

## The fixture

A simulated engineering organisation, not a bag of documents.

**8 services** sharing one library, config-key and metric vocabulary — because one company has one stack, and because it makes the services **lexically inseparable** (same-project vocabulary overlap 1.07× against different-project). No ranker can scope by accident here; that is deliberate, and it is what makes a scoping claim testable rather than automatic.

**143 incidents, 183 memories.** 40 incidents written up from two sides. **27 memories correct an earlier memory about the same incident**, verified to read as retractions rather than merely carrying the edge. **57 memories declare reach beyond the repository that wrote them** — a fault in a shared library applies to every service importing it.

**Memory bodies** are generated, with length sampled from a real store's decile table and then counted in code and topped up until it lands: median 502 words against the reference's 484, 15.6 concrete specifics against 14.0. A gate profiles the corpus against that reference on four axes and the pipeline refuses to benchmark when it fails; it is two-sided, because a corpus richer than production flatters exactly as a thinner one buries.

**Queries come from the incident record, never from the memory text**, in three registers reported separately and never averaged:

| register | what it is | queries |
|---|---|---|
| `symptom` | what someone types knowing what they see — forbidden from using the artefact or metric name | 183 |
| `identifier` | what they paste from a terminal | 183 |
| `short` | three to five words | 183 |
| `transfer` | asked by a service that did **not** write the memory it needs | 57 |

One correct memory per query. `found@5` is recall of it; `rank-1` is how often it is first. Every arm, including competing systems, is scored by the same code.

**Where the content is checked rather than assumed:** all 183 memories name their own service; same-topic vocabulary overlap runs 1.30× against different-topic; and a nearest-neighbour classifier with no metadata recovers the true topic 79% of the time against 8% chance.

---
## The advantage, in one table

Same corpus, same embedder, same query shape, same scorer. Two axes: finding a memory your own project wrote, and finding one another project wrote that declares it applies to you.

| | in-project (found@5) | cross-project transfer (found@5) |
|---|---|---|
| MCS + qmd, one index per project | **0.984** | **0.000** |
| MCS + qmd, one shared pool | 0.475 | 0.597 |
| **Vestige** | **0.984** | **0.772** |

**The prior art's two configurations are opposite ends of a trade-off.** One index per project retrieves as well as anything measured here — identical to this system to three decimals — and cannot carry a lesson across a repository boundary at all, because the document is in its author's index and nowhere else. One shared pool makes transfer possible and costs half of in-project recall, because every other project's memories now compete for the same five slots.

**Declared reach does not make that trade**, and the reason is that one declaration does two jobs: it decides who may see a memory, and it decides where the memory is stored. A lesson reaching eight repositories cannot live inside one of them, so it is written to the shared store — and the caller reads a view containing exactly what reaches them, which is 23 documents rather than 183.

**What is not an advantage, stated plainly: retrieval quality.** With the same engine, embedder and query shape there is no difference, and an earlier version of this document claimed one.

---

## What reach buys, which is the claim

57 queries, each asked by a service that did not write the memory it needs, about a fault in a library every service imports. The memory declares it applies to them.

| | rank-1 | found@5 | the document is reachable at all |
|---|---|---|---|
| **declared reach** | **0.263** | **0.772** | 1.00 |
| one index per project | 0 | 0 | **0.00** |
| one shared pool | 0.158 | 0.597 | 1.00 |

**The zero in the middle row is not a ranking failure.** A per-project index holds what that project wrote; the caller's index has never heard of the document, at any *k*, under any ranker. The last column is reported so that absence is not read as a bad score.

Against a shared pool, which *can* see it, declared reach retrieves it into the top five **77% of the time against 60%** — the same documents, the same engine, the same query, differing only in whether 182 other projects' memories are competing.

Reach also decides storage. A memory reaching several projects cannot live inside one of them, and the write path routes it to the shared store without being asked. The write contract refused an earlier, malformed version of this declaration outright — `platform` names a runtime, not a set of repositories — which is the epistemic contract doing its job before any benchmark ran.

---

## Retrieval, by how the question was asked

Three registers, 183 queries each, one correct memory per query, on the shipped configuration.

| register | rank-1 | found@5 | MRR |
|---|---|---|---|
| identifier | **0.530** | 0.880 | 0.672 |
| symptom | 0.454 | **0.929** | 0.650 |
| short | 0.328 | 0.836 | 0.521 |

**The spread is the result.** rank-1 runs 0.328 to 0.530 on identical corpora, differing only in phrasing. An average would be 0.44 — a number describing none of them.

**Where the misses go**, and this is the more useful table:

| register | same incident, other version | sibling | other project | junk | returned nothing |
|---|---|---|---|---|---|
| symptom | 17 | 83 | **0** | **0** | **0** |
| identifier | 15 | 71 | **0** | **0** | **0** |
| short | 18 | 105 | **0** | **0** | **0** |

Every failure is ranking *within* the project that asked. Zero cross-project hits — though that follows from the filter running before the engine, so it states that the code does what it says rather than measuring retrieval quality.

"Same incident, other version" is the predecessor, its correction, or another service's account of the same event: a question about which *version* to serve, invisible the moment it is counted as topical confusion.

---

## Corrections, where a single right answer gets it backwards

27 memories correct an earlier memory about the same incident. Those queries name a gold the corpus itself marks as out of date.

| register | strict rank-1 | accepting the correction | stale ranked above its correction |
|---|---|---|---|
| symptom | 0.407 | **0.741** | 14 |
| identifier | 0.370 | **0.630** | 17 |
| short | 0.148 | **0.593** | 7 |

On short, vague queries the two differ **fourfold**: the vaguer the question, the more often the system returns the *current* memory instead of the superseded one it was asked for — which is what a memory system should do, and what known-item scoring calls failure.

The third column is the outcome that actually harms an agent: a stale write-up ranked above the correction sitting in the same store. It is not rare and it is not fixed.

---

## The embedder, and the one change worth making

qmd exposes three model slots. Expansion loses and is stochastic. The cross-encoder changes half the shortlists and the first slot in almost none. The third runs on every query, is always on, and had never been varied.

Measured across **all 549 queries**, bootstrap intervals resampling **queries**, McNemar's exact test on paired outcomes:

| | rank-1 | found@5 |
|---|---|---|
| embeddinggemma-300M (default) | 0.437 `[0.393, 0.481]` | 0.882 `[0.856, 0.900]` |
| **Qwen3-Embedding-0.6B** | 0.466 `[0.426, 0.501]` | **0.938** `[0.922, 0.955]` |
| paired | 38 vs 54 queries, p = 0.117 | 5 vs **36**, **p < 0.001** |

**Recall improves; the first slot does not.** The rank-1 difference rests on about five queries and is not claimed.

A 144-arm sweep across embedder, context, sub-query shape, intent and reranking found **only two variables move anything**. Context and intent are exactly zero. Its leading arm — dropping the lexical sub-query — collapsed on a register it was not selected on (0.284 against 0.525, where queries paste exact identifiers) and loses 36 recall queries against 5 over the full set. **No arm ranking is claimed from it**; selecting the best of 144 on one slice is multiple testing, and the arm that survived held-out registers was third-placed.

---

## Against MCS

Replicated from `bruno/qmd-retrieval-backend` at **3a75dd9** — its models, its `global_context`, its call shape, its limit — on the same corpus, queries, scorer and pinned qmd.

**Configured as it configures itself, retrieval is identical:**

| register | MCS + qmd, per project | Vestige, same embedder |
|---|---|---|
| symptom | 0.508 / 0.984 | 0.508 / 0.984 |
| identifier | 0.525 / 0.907 | 0.525 / 0.907 |
| short | 0.366 / 0.923 | 0.366 / 0.923 |

Identical to three decimals on every register and both metrics — same engine, same embedder, same query shape, isolation either way. **There is no retrieval-quality difference between these systems.**

Two things stated so they are not mistaken for credit. The typed `lex`+`vec` call shape both systems use **came from this project** — its author was pointed at this approach and adopted it, so the agreement is adoption and carries no independent weight. And on the embedder the prior art was simply right: its hook has used `Qwen3-Embedding-0.6B` while this project took qmd's default, which is the measured difference above.

The difference that remains is the transfer table at the top of this document, and the shared-pool row below it — not a ranking score.

| register | per-project index | one shared pool |
|---|---|---|
| symptom | 0.508 / 0.984 | 0.148 / 0.475 |
| identifier | 0.525 / 0.907 | 0.164 / 0.519 |
| short | 0.366 / 0.923 | 0.082 / 0.404 |

Read as **index cardinality under a shared vocabulary** — 23 candidate documents against 183, in a world whose services cannot be told apart lexically. It is the regime the reach model is built for; the reach claim itself is the transfer table.

---

## Latency

The search session holds one index, keyed per caller, so a query for a different project restarts it and pays a model load.

| arm | same project | after a project switch |
|---|---|---|
| typed sub-queries | **22–26 ms** | 1,559–1,635 ms |
| + query expansion | 300–330 ms | 2,733–2,786 ms |
| + cross-encoder rerank | 729–756 ms | 3,165–3,252 ms |

Reported split because a single mean over an interleaved workload was 1,421 ms — a figure nobody experiences.

---

## What it cannot do

**It cannot decline.** 64 questions no engineering store could answer — cooking, music, eighteenth-century history, a gibberish token — issued *with* a project identity, which is the harder case:

| | returned something | mean hits | any caveat |
|---|---|---|---|
| off-topic | 1.000 | 5.0 | 0.000 |
| on-topic | 1.000 | 5.0 | 0.000 |

Identical on every axis a caller can observe. The cause is structural: qmd is invoked in a mode that discards scores, the hit type carries no score field, and the no-match branch returns whatever is visible. The engine is not the limitation — competing arms *do* return nothing on the same corpus — but under this query shape and view it never did, across 549 real queries and 64 off-topic ones.

**Every rank-1 figure in this document is therefore conditional ranking under forced retrieval.**

---

## What this does not establish

**The fixture is written by one model from one world.** Deleting each memory's opening sentence does not significantly change the score (26 lost, 23 gained, p = 0.78), which refutes the specific charge that the symptom register matches a shared first line — the signal is spread through the document. It does not address the broader entanglement, and no overlap statistic can. Escaping it needs a second model writing the queries, or memories from real teams.

**Overlap concentrates 3.3–3.4× in each memory's first sentence**, across every register. A real incident note does open by stating its symptom, so this is not simply wrong; it does make the fixture easier than one where the symptom must be inferred.

**The corpus target distribution was matched to one working store.** Sound as an internal fixture, untested as transfer to anyone else's.

**The competing system's arms run through this project's query function** in the identical-retrieval table. That is a fair test of its *configuration* and not of its *product*; the transfer table's folder arms use a neutral client.

**found@5 over a median of 23 candidates** is a fifth of the drawer. Systems will not separate on it, and it should not be read as a recall story.

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
| A per-project index cannot reach a memory another repo wrote, at any *k* | Reach is declared per memory, and reach decides storage |
| Declared reach retrieves a shared lesson into the top five 77% of the time against a shared pool's 60% | Filter to the caller's view first, rank inside it |
| Services sharing one stack are lexically inseparable (1.07×) | Scoping cannot be left to the ranker |
| A stale memory outranks its own correction in 7–17 of 27 cases | Supersession is recorded, and remains unsolved in ranking |
| Off-topic and on-topic results are indistinguishable to the caller | Stated as a limit; unresolved |
| A gate after staging leaves a dirty history | The content gate runs before the sync path touches the tree |
| Every silent failure in this layer presents as "no results" | `explain`, and an audit log for the gate |

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
