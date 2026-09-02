# The Record

This is what Vestige is, what was measured, and what the measurements support. It exists so the reasoning can be checked by someone who was not here.

Three companion documents: [ARCHITECTURE.md](./ARCHITECTURE.md) is how it works, [PROVENANCE.md](./PROVENANCE.md) is which parts came from where, [README.md](./README.md) is how to install it. This one is the argument.

---

## What this establishes

**A memory store for one project is a solved problem, and it is not the problem.** The moment a second repository exists, a lesson written in one place has to reach another, and the two obvious answers each fail differently. One index per project cannot reach it at all — the document is not in the index, at any *k*, under any ranker. One shared pool can reach it, and shows the caller other projects' memories in **130–147 of 183 queries per register** on the way.

**Vestige is the only one of the three that does both**: it retrieves a lesson another repository wrote and declared applicable (found@5 **0.772**, the best of the three) while spending **zero** top slots on memories that do not apply to the caller. That is the claim, and the rest of this document is what it costs and where it fails.

**It costs in-project recall, and the bill is stated everywhere it applies.** Carrying other projects' lessons is the same act as enlarging the caller's field, so a project's own memories are retrieved at 0.710 where a per-project index gets 0.984. That is a real trade and it is not hidden.

**Retrieval quality is not what separates these systems — the shape of the field is.** Configured identically over the same 23 documents, per-project indexing and declared reach are the same to three decimal places. What differs is *which documents are in front of the ranker at all*, and that is a correctness property rather than a ranking one.

**The scoping penalty starts at the second project.** One other project's memories in the index costs 7.6 points of recall; seven cost half of it. This is not an at-scale concern that arrives later.

**Four things it does not do**, each measured rather than conceded in the abstract: it cannot decline an off-topic question, a stale memory still outranks its own correction in 7–17 of 27 cases, it is the slowest of the three arms within a project, and at 64 projects declared reach is a field three times smaller than a shared pool rather than a constant one.

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

## The four configurations, so every number can be placed

Numbers below are measured under one of four setups. They are not interchangeable, and an earlier draft of this document put two of them in one sentence.

| | embedder | what the caller's view contains | documents searched |
|---|---|---|---|
| **A — shipped default** | embeddinggemma-300M | its own project's memories | 23 |
| **B — better embedder** | Qwen3-Embedding-0.6B | its own project's memories | 23 |
| **C — declared reach on** | Qwen3-Embedding-0.6B | its own, plus every memory declaring it reaches this project | 73 |
| **D — one shared pool** | Qwen3-Embedding-0.6B | everything, from every project | 183 |

**C is what Vestige does when reach is used**, and it is the configuration the transfer and trade-off tables report. **A is what ships today.** B exists because MCS uses that embedder and a comparison must not hold one side to a worse configuration. D is the competing shared-pool arm.

Each table below names its configuration.

---

## What each design can and cannot do

Replicated from MCS at `bruno/qmd-retrieval-backend` **3a75dd9** — its models, its `global_context`, its call shape, its limit — on the same corpus, queries, scorer and pinned qmd.

Three questions matter. **Can a project find a memory it wrote itself?** **Can it find one another repository wrote that declares it applies here?** And **when it searches, is it shown memories that do not apply to it?**

*Rows are configurations B, D and C respectively.*

| | field | its own memory (found@5) | another project's, declared to reach it | top slots spent on another project's memory |
|---|---|---|---|---|
| MCS, one index per project | 23 | **0.984** | — *not in the index, at any k* | n/a |
| MCS, one shared pool | 183 | 0.475 | 0.597 | **130–147 of 183** |
| **Vestige, declared reach** | 73 | 0.710 | **0.772** | **0** |

**Vestige is the only one of the three that answers both questions.** A per-project index answers the first best of anything measured here and cannot answer the second — the dash is not a low score, it is an absent capability, and no ranker or larger *k* changes it. A shared pool answers the second, worse, and answers it by putting every other project's memories in front of the caller.

**The third column is the one that has no competitor.** In each register, the memory shown first belongs to another project in 130 to 147 of the 183 queries. Vestige spends none. This follows by construction — the reach filter runs before the engine, so an inapplicable memory is never a candidate — and construction is the point: it is a guarantee rather than a ranking that usually behaves. The measurement confirms the code does what it claims; the competing column is what not having the guarantee costs.

**Against a shared pool, declared reach is better at both retrieval questions** — 0.710 against 0.475 on a project's own memories, 0.772 against 0.597 on transfer — because the caller searches 73 documents instead of 183.

**Against one index per project, transfer is bought and paid for.** Declared reach takes in-project found@5 from 0.984 to 0.710, because carrying other projects' lessons *is* enlarging the caller's view. That is the trade, it is real, and the next two sections price it.

**The size of that bill is a property of the store, not of the design.** 57 of these 183 memories declare they reach every service — 31%, because a third of the incidents are faults in a shared library. A store where less is genuinely shared pays less; one where more is shared pays more.

**And the honest reading of 0.772**: it is the best transfer number of the three and it is not high. Nearly a quarter of cross-project lessons still miss the top five when they are visible and declared.

**An earlier version of this section claimed Vestige made no trade.** That compared its in-project score measured *without* cross-project memories in the view against its transfer score measured *with* them. Both numbers were real and they were not the same configuration.

---

## What is not the difference, and two things owed to MCS

**Retrieval quality is not the differentiator.** With the same engine, embedder and query shape over the same 23 documents, per-project indexing and declared reach are identical to three decimals on all three registers — 0.508/0.984, 0.525/0.907, 0.366/0.923. Whatever separates these systems, it is not the ranking. What separates them is which documents reach the ranker, which is the previous section and is a question about correctness rather than quality.

**Two things stated so they are not mistaken for credit.** The typed `lex`+`vec` call shape both systems use **came from this project** — its author was pointed at this approach and adopted it, so the agreement is adoption and carries no weight either way. And on the embedder MCS was right where Vestige was not: its hook uses `Qwen3-Embedding-0.6B` while Vestige took qmd's default, which cost real recall until it was measured.

---

## The cost of sharing an index, as a curve

The claim contains the words "once you have more than one project", and until now it had been demonstrated at exactly one point — eight services, 183 documents. That shows an effect exists and says nothing about whether it begins at two projects or eighty.

Hold the caller, the queries, the engine, the embedder and the documents fixed. Vary only how many **other** projects' memories share the index:

*Configuration B, with the index progressively widened. The embedder and query shape are held fixed; only the number of other projects' memories in the index changes.*

| other projects in the index | documents searched | rank-1 | found@5 |
|---|---|---|---|
| **0** — a project's own memories only | 23 | **0.514** | **0.994** |
| 1 | 46 | 0.350 | 0.918 |
| 2 | 69 | 0.284 | 0.836 |
| 4 | 114 | 0.213 | 0.645 |
| 7 | 183 | 0.164 | 0.497 |

**The penalty starts at the second project and compounds.** One other project costs 7.6 points of recall; seven cost half of it. rank-1 falls from 0.514 to 0.164 over the same range — the answer is still in the store, and it stops being the thing the agent sees.

This is the mechanism behind every other number in this document. **A shared pool does not degrade because its retrieval is worse; it degrades because the right answer acquires company.** Filtering to declared reach first is what keeps Vestige's field at 73 documents instead of 183, and the curve says how much that is worth at each size.

**The top row is not Vestige's configuration.** It is what a caller searches when it sees only what its own project wrote — the per-project index. With declared reach on, a caller here searches **73** documents, which places Vestige between the k=2 and k=4 rows. That is the exchange rate: transfer is bought by enlarging the view, and this table prices it.

**And it is a direction, not a magnitude.** Eight services is where this fixture stops; the curve says the penalty begins at the second project and compounds, not what it is at eighty.

---

## A writer who claims too much

Reach is only worth something if the declarations are honest, and they will not be: the easiest thing for a writer to say is that a lesson applies everywhere. Vestige's write path narrows rather than trusting — a memory claiming `general` while naming specific projects is stored as `project` scoped to those, with `claimed_scope: general` kept so the claim is auditable rather than erased.

Measured by making a quarter of the writers over-claim:

*Configuration C — declared reach on — with a share of the writers over-claiming.*

| | documents in the caller's view | its own memory (found@5) | another project's |
|---|---|---|---|
| every declaration honest | 73 | 0.705 | 0.772 |
| **24% over-claim, narrowed at write time** | **73** | **0.710** | **0.790** |
| 24% over-claim that cannot be narrowed | 100 | 0.579 | 0.614 |

**A quarter of the store over-claiming costs nothing when the narrowing catches it.** The view does not move, and neither do the scores — an over-claimed memory that names its projects is simply filed as reaching those projects, which is what it always meant.

**The third row is what it prevents.** When the claim cannot be narrowed — `general` with no projects named, so there is nothing to narrow *to* — every such memory becomes visible to every caller. The view grows from 73 to 100 documents and takes **13 points of in-project recall and 18 of transfer** with it.

That is the same mechanism as the curve above, arriving from a different direction: reach is only a filter while the declarations mean something, and the write path is what keeps them meaning something. A memory that would reach nobody is refused outright for the same reason — granting the widest reach because the narrowest could not be determined is backwards.

---

## What a caller searches as the organisation grows

The curve above prices retrieval against view size. This is the other half: how the view size itself grows as projects are added, under each design. Counted rather than scored — view size is a property of the visibility rule, not of the ranker — with 20 memories per project and 31% of them declaring org-wide reach, the rate this corpus actually carries.

*Configuration-independent: view size follows from the visibility rule, so it is counted rather than retrieved.*

| projects | memories in the store | MCS, one index per project | **Vestige, declared reach** | MCS, one shared pool |
|---|---|---|---|---|
| 2 | 40 | 20 | 25 | 40 |
| 4 | 80 | 20 | 36 | 80 |
| 8 | 160 | 20 | 68 | 160 |
| 16 | 320 | 20 | 119 | 320 |
| 32 | 640 | 20 | 222 | 640 |
| 64 | 1,280 | 20 | **411** | 1,280 |

**Reach does not bound the view. It scales it by how much is shared.** A shared pool's view is the whole store — slope 1. A per-project index is flat at 20 and cannot see anything another project wrote. Declared reach is linear too, with a slope set by the sharing rate rather than by the project count: at 64 projects a caller searches 411 of 1,280 documents, **32% of the store**.

**So the honest claim at scale is "three times smaller field", not "constant field".** Composed with the measured retrieval curve — where 183 documents gave found@5 0.497 and 23 gave 0.994 — a reach view of 411 at 64 projects is well into the degraded region. Declared reach delays that degradation by roughly a factor of three; it does not prevent it, and a store where more is genuinely shared gets less benefit.

**That composition is a projection, not a measurement.** The view-size table is measured and the retrieval curve is measured; putting them together to say what retrieval looks like at 64 projects is arithmetic over two fixtures, and this document does not have a 64-project corpus to check it against.

---

## Retrieval, by how the question was asked

Three registers, 183 queries each, one correct memory per query. **Configuration A** — Vestige on the shipped default embedder, over a store where every memory is scoped to its own project.

These are the highest in-project figures in this document, and that is a property of the configuration rather than a best case to quote: a 23-document view is the smallest field any arm here searches. Turning declared reach on (configuration C) puts 73 documents in front of the ranker and takes symptom found@5 from 0.929 to 0.710, which is the trade priced above.

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

**Every failure is ranking within the project that asked.** Not one miss in 549 queries is another project's memory, against the shared pool's 130–147 per register — the same guarantee as the comparison table, seen from the failure side. When Vestige is wrong it is wrong about *which* of your memories to show you, never about whose memories to show you.

"Same incident, other version" is the predecessor, its correction, or another service's account of the same event: a question about which *version* to serve, invisible the moment it is counted as topical confusion.

---

## Corrections, where a single right answer gets it backwards

27 memories correct an earlier memory about the same incident. Those queries name a gold the corpus itself marks as out of date.

*Configuration A.*

| register | strict rank-1 | accepting the correction | stale ranked above its correction |
|---|---|---|---|
| symptom | 0.407 | **0.741** | 14 |
| identifier | 0.370 | **0.630** | 17 |
| short | 0.148 | **0.593** | 7 |

On short, vague queries the two differ **fourfold**: the vaguer the question, the more often the system returns the *current* memory instead of the superseded one it was asked for — which is what a memory system should do, and what known-item scoring calls failure.

**The third column is the outcome that actually harms an agent**: a stale write-up ranked above the correction sitting in the same store. It is not rare and it is not fixed. Supersession is recorded at write time and is not yet used in ranking.

---

## The embedder, and the one change worth making

qmd exposes three model slots. Expansion loses and is stochastic. The cross-encoder changes half the shortlists and the first slot in almost none. The third runs on every query, is always on, and had never been varied.

Measured across **all 549 queries**, bootstrap intervals resampling **queries**, McNemar's exact test on paired outcomes:

*Configuration A against configuration B — the embedder is the only difference.*

| | rank-1 | found@5 |
|---|---|---|
| embeddinggemma-300M (default) | 0.437 `[0.393, 0.481]` | 0.882 `[0.856, 0.900]` |
| **Qwen3-Embedding-0.6B** | 0.466 `[0.426, 0.501]` | **0.938** `[0.922, 0.955]` |
| paired | 38 vs 54 queries, p = 0.117 | 5 vs **36**, **p < 0.001** |

**Recall improves; the first slot does not.** The rank-1 difference rests on about five queries and is not claimed.

A 144-arm sweep across embedder, context, sub-query shape, intent and reranking found **only two variables move anything**. Context and intent are exactly zero. Its leading arm — dropping the lexical sub-query — collapsed on a register it was not selected on (0.284 against 0.525, where queries paste exact identifiers) and loses 36 recall queries against 5 over the full set. **No arm ranking is claimed from it**; selecting the best of 144 on one slice is multiple testing, and the arm that survived held-out registers was third-placed.

---

## Latency, including where Vestige is slower

Every arm measured the same way, on the same machine, split by whether the query stayed in one project — because a per-caller index is restarted when the caller changes, and that restart loads a model.

*Vestige in configuration A; the MCS arms in their own configurations. Same machine, same corpus.*

| | same project | after a project switch |
|---|---|---|
| **Vestige** | 26 ms | 1,559 ms |
| MCS, one index per project | **12 ms** | 1,368 ms |
| MCS, one shared pool | **12 ms** | **11 ms** |

**Vestige is the slowest of the three, and the shape of the cost follows from its design.** A per-caller view means one index per caller, so moving between projects restarts the search session and pays a model load. A single shared pool never switches, which is why its right-hand column is flat — the configuration that loses half its recall and spends 130–147 top slots on other projects' memories pays no latency for scoping, because it does not scope.

Within one project — an agent working in one repository, which is the common case — the difference is 26 ms against 12 ms. Both are far below the point where a search is a search the agent learns to skip, which was the original reason to measure this at all.

**An earlier version of this document reported 14 ms here against 1,529 ms for MCS.** That comparison spawned their CLI once per query while running Vestige's resident session, so it measured process startup rather than either design. It is withdrawn; the table above replaces it, and it does not favour Vestige.

The other arms, for completeness: query expansion 300–330 ms in-project, cross-encoder reranking 729–756 ms. A single mean over an interleaved workload was 1,421 ms — a figure nobody experiences, which is why every row here is split.

---

## Containment

A pool that leaves the machine needs to be inspected, and neither parent system inspects content. Against a corpus with 80 planted secrets — credentials, tokens, keys, private hosts, home paths, and base64-wrapped variants:

*A separate fixture of 80 planted secrets, independent of the retrieval corpus.*

| | result |
|---|---|
| planted secrets quarantined | **80 of 80** |
| clean memories wrongly held | **0** |
| contaminated blobs reachable in remote history | **0** |

**The zero in the last row is the one that matters, and it is a property of *where* the gate runs rather than how good it is.** Running the same gate after staging produced a clean `HEAD` over a dirty history — every planted secret still reachable in the remote by SHA. For anything append-only, retraction is not containment. The gate now runs before the sync path takes its first look at the working tree.

Two properties were learned rather than designed: it **fails closed**, counting an unreadable file or an unevaluable rule as contaminated; and it **quarantines per file**, so one bad memory does not hold up the clean ones — a gate that loses clean work is a gate people switch off.

Its limits are stated rather than implied: it is a deny-list, it cannot see a secret spaced out character by character or described in prose, and that was measured rather than assumed.

---

## What it cannot do

**It cannot decline.** 64 questions no engineering store could answer — cooking, music, eighteenth-century history, a gibberish token — issued *with* a project identity, which is the harder case.

*Configuration A.*

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

**MCS's arms run through this project's query function** in the identical-retrieval table. That is a fair test of its *configuration* and not of its *product*; the transfer table's folder arms use a neutral client.

**found@5 over a median of 23 candidates** is a fifth of the drawer. Systems will not separate on it, and it should not be read as a recall story.

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
| A shared pool spends 130–147 of 183 top slots on another project's memories | Filter to the caller's view *before* the engine, so inapplicable memories are never candidates |
| Declared reach retrieves a shared lesson into the top five 77% of the time against a shared pool's 60% | Rank inside the filtered view rather than over the store |
| Carrying other projects' lessons takes in-project recall from 0.98 to 0.71 | The trade is stated rather than hidden; a store that shares less pays less |
| One other project in the index already costs 7.6 points of recall, seven cost half | The penalty starts at the second project, so scoping is not an at-scale concern |
| Over-claims that cannot be narrowed cost 13 points of recall and 18 of transfer | Reach is narrowed at write time, and a memory reaching nobody is refused |
| Services sharing one stack are lexically inseparable (1.07×) | Scoping cannot be left to the ranker |
| The default embedder loses 36 recall queries against 5, p < 0.001 | The engine's default is not automatically the right one |
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
