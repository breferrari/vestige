# The Record

This is how Vestige was built, what was measured, and why it has the shape it has. It exists so the reasoning can be checked by someone who was not here — every number below is reproducible from a committed script, and every design choice is traceable to a measurement that preceded it.

Three companion documents, kept separate on purpose: [ARCHITECTURE.md](./ARCHITECTURE.md) is how it works, [PROVENANCE.md](./PROVENANCE.md) is which parts came from where, and [README.md](./README.md) is how to install it. This document is the argument.

---

## The method

**A pre-registered ablation ladder.** Before anything was measured, each rung was written down with a graded prediction of what it would show. A rung changes exactly one variable from the rung below it. The point of pre-registration is that a prediction recorded before the run cannot be quietly adjusted after it — and two of these predictions were wrong in ways that changed the design.

The fixture is the same throughout: **183 memories across 16 projects, seeded and deterministic**, and **64 queries** with exactly one correct document each. Because there is one right answer per query, `found@5` is recall of the target and `rank-1` is how often the right memory is the first thing the agent sees. `prec@5` is capped at 0.200 by construction and reaches 1.0 trivially under any per-caller view, so it is reported and not read.

**Every figure below is a mean over three runs, with the standard deviation where it matters.** One run is an anecdote: this fixture varied by a whole query between consecutive runs until the cause was found and removed. A min–max range is no better — it headlines whichever run was worst — so the numbers are averages, computed by a committed script rather than by hand, from artifacts committed beside it.

Every number here comes from `./reproduce.sh` in the [memory-stack-lab](https://github.com/breferrari/memory-stack-lab) repository, which regenerates the corpus from seed, writes it through this plugin's real write path, queries through this plugin's real public API, and scores the output. The raw run artifacts are committed under `runs/<date>/`.

---

## What the ladder showed

Each rung adds one thing to the rung above it.

| Rung | found@5 | rank-1 | MRR | foreign in top-5 |
|---|---|---|---|---|
| V0 · a flat shared pool, as shipped | 0.297 | 0.078 | 0.157 | 4.63 |
| V1 · a better retrieval engine over the same flat pool | 0.344 | 0.109 | 0.183 | 4.64 |
| V2 · project-namespaced filenames | 0.344 | 0.109 | 0.188 | 4.64 |
| V3 · scope metadata written into the document | 0.406 | 0.109 | 0.190 | 4.59 |
| V4a · one index per project | 1.000 | 0.969 | 0.984 | 0.00 |
| V4b · rank globally, filter afterwards (depth 5) | 0.375 | 0.375 | 0.375 | 0.00 |
| V4b · the same, at the engine's maximum depth of 20 | 0.953 | 0.938 | 0.945 | 0.00 |
| **Vestige** | **1.000** | **1.000** | **1.000** | **0.00** |

Four conclusions, and the last two are the architecture.

**A better engine over a shared pool buys almost nothing.** V0 → V1 moves found@5 by 0.047. The retrieval problem is not that the engine ranks badly; it is that it is ranking over 183 documents of which 172 could not possibly be relevant to the caller.

**Telling the document who it is for does not help either.** V2 and V3 write ownership into the filename and then into the frontmatter, and rank-1 stays at 0.109. Metadata that nothing filters on is decoration.

**Isolation is what moves the numbers** — 0.109 to 0.969 in one step. Everything before it is a rounding error by comparison.

**The order of filtering and ranking is not an implementation detail.** V4b ranks globally and filters afterwards, which is the obvious way to build it. It is bounded by the engine's result depth: 0.375 at depth 5, and it only reaches 0.938 by asking for the engine's maximum of 20 results per query and throwing most of them away. That ceiling does not move as projects multiply — with forty projects it would degrade further, while filtering first does not. Vestige filters first and ranks inside the result.

---

## Against MCS, before and after qmd

The prior art is [`mcs-cli/memory`](https://github.com/mcs-cli/memory), and it recently gained a qmd retrieval backend on the `bruno/qmd-retrieval-backend` branch. Both were measured on the same corpus and the same queries. The branch was replicated from its own `sync-memories.sh` rather than approximated — a named index under the project via `QMD_CONFIG_DIR`/`INDEX_PATH`, one embedding model in all three of qmd's model slots, and the structured lex/vec query shape with reranking off that its own instructions tell the agent to use.

| | found@5 | rank-1 | sd | MRR | foreign | per query |
|---|---|---|---|---|---|---|
| MCS before qmd, shared pool | 0.297 | 0.078 | — | 0.157 | 4.63 | — |
| MCS with qmd, **one index per project** | 1.000 | **0.984** | 0.000 | 0.992 | 0.00 | 1,529 ms |
| MCS with qmd, **one shared pool** | 0.375 | **0.078** | 0.000 | 0.168 | 4.61 | 1,528 ms |
| **Vestige** | 1.000 | **1.000** | **0.000** | 1.000 | 0.00 | **14 ms** |

**The honest reading, in the order the evidence arrived.**

**Configured one index per project, that design equalled this one for most of this project's life** — 0.984 against 0.979, inside the noise, with theirs the more repeatable of the two. When memories live in a directory per project, isolation is a property of the layout and a reach model buys nothing on top of it. That was the fair statement, and it was published here for as long as it was true.

**It changed for a reason worth stating plainly, because it was our defect and not their weakness.** Vestige was sending qmd a plain-text query, which the SDK auto-expands into lex/vec/**hyde** variants — and HyDE writes a hypothetical answer *with a model*. An LLM was running on every search: it cost about 500 ms, and its output feeding the ranking was the entire reason our results were not repeatable. Passing typed sub-queries states the retrieval strategy outright and skips expansion. The prior art was already doing this; reading it is how the problem was found.

**The reach model earns its place only when memories are shared.** That is not a hypothetical case; it is what a shared team pool produces, and it is the configuration this whole class of tool exists for. There, rank-1 falls from 0.984 to **0.078**, with 4.6 documents from other people's projects in every five results. Adding qmd does not fix it, because retrieval quality was never the failure — the pool contains the wrong documents and ranks them correctly.

So the claim this project makes is narrow and worth stating precisely: **the reach model buys nothing over per-project directories, and everything over a shared pool.** A system that supports both needs it.

---

## Both layers are load-bearing

A reach filter without semantic ranking, on the same views:

| ranking | found@5 | rank-1 | MRR |
|---|---|---|---|
| facets only — specificity and recency, no query relevance | 0.438 | **0.094** | 0.202 |
| with semantic ranking | 1.000 | **0.984** | 0.992 |

**10.5× on rank-1.** The filter decides what may be seen; the ranker decides which of it answers the question, and neither substitutes for the other. This was measured late, because an early measurement on eleven-document views could not show it — a top-5 drawn from eleven documents is nearly free. The search engine is therefore a hard dependency and is provisioned, updated and repaired by the plugin rather than assumed.

---

## Robustness to a writer who over-claims

A reach model is only as good as the reach people declare, and people declare too widely. At a 24% over-claim rate — roughly one memory in four claiming to be relevant everywhere:

| | rank-1 | MRR | foreign in top-5 | documents per view |
|---|---|---|---|---|
| a bare reach filter | 0.391 | 0.628 | 3.53 | 52.7 |
| with reach narrowed at write time | **0.984** | 0.992 | **0.00** | 11.4 |

Over three runs of each arm, the end-to-end run at 24% over-claim scores **exactly the same as the correctly-scoped one** — found@5 1.000, rank-1 1.000, MRR 1.000, zero foreign documents, sd 0.000 on both. One memory in four claiming to be relevant everywhere costs nothing at all.

Every over-claim is narrowed at the point of writing, because a memory that claims `general` while naming specific projects has told you its real reach in the same breath. The pool ends up holding zero falsely-general memories, so there is nothing for the filter to be defeated by.

This is the single most important robustness property in the system: **the filter is not asked to survive bad declarations, because bad declarations do not get written.**

> This claim has been wrong in both directions here. A single run once scored the arms identically and was published before it was repeated; three runs then showed a real gap of about a twentieth of a rank, and that was published too. The gap turned out to be measurement noise from the query shape, not the over-claim — with that removed, the arms are identical and both are exact. Every figure in this document is now a mean over three runs with its standard deviation, which is what makes a claim like this checkable rather than assertable.

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

## Latency, which nobody measured for a week

Retrieval quality was benchmarked for a week before anyone timed a query. The first measurement was **2,748ms per search**, essentially all of it model loading, repeated on every call.

That is not a polish issue. For a system whose entire protocol is *consult the store before answering*, a slow search is a search the agent learns to avoid, which silently undoes the behavioural layer that makes any of the rest happen. The fix was to stop paying the startup cost per query: the search engine speaks MCP over stdio, so it is spawned once and kept resident for the session.

Latency is reported split, because one mean over both describes neither. Three runs, idle machine, ambient load stamped into every result file:

| | |
|---|---|
| first query for a project — builds that caller's view index | **3.6 s** |
| every subsequent query in the session | **14 ms** |

The first number is an index build and happens once per caller. The second is what a session actually experiences, and it is the number that decides whether an agent keeps calling the store or quietly stops.

It was **2,748 ms** when first measured, and **543 ms** after the search engine was made resident. The last factor of thirty-eight came from removing the LLM expansion described above — most of what remained was never search at all.

## What the headline number does not say

Every retrieval figure above comes from a fixture whose queries were derived from its own documents. That is a fair test of isolation and a flattering one for retrieval: the words in the query are largely the words in the answer. A second fixture asks the same corpus the way a person arrives — the symptom, not the lesson's vocabulary.

| query shape | example | rank-1 | found@5 |
|---|---|---|---|
| identifier | `ERR_DUPLICATE_CHARGE idempotency_key` | 0.962 | 1.000 |
| short, ambiguous | *"duplicate writes"* | 0.836 | 0.918 |
| symptom | *"two charges appeared for one checkout when the network blipped"* | 0.541 | **0.891** |
| *the original fixture* | *the document's own vocabulary* | *1.000* | *1.000* |

**The 0.541 is not a ceiling, and publishing it as one would repeat the 1.000 mistake with the sign flipped.** The first number was fixture-easy because the queries were born from the documents; the second is fixture-hard because they were born from the documents and then stripped of every shared word. Same methodology, inverted bias. Three rows decide which sentence is true, and they were not in the first write-up:

**The right memory is retrieved 89% of the time**, and when it is retrieved its median rank is 1. This is a first-slot question, not a retrieval failure.

**Every miss is a sibling.** Of 84 cases where the gold was not first: 84 were another lesson *from the same project*, 0 from another project, 0 junk. Reach isolation is perfect even here — the top slot is being taken by a memory about the same topic in the same repo, which a reader would plausibly also accept. Scoring one correct file punishes that, so part of the gap is the label rule rather than the engine.

**It is a curve, not a point.** Rank-1 by how much vocabulary the query happens to share with its answer:

| overlap | queries | rank-1 |
|---|---|---|
| 0–0.005 | 140 | 0.457 |
| 0.005–0.02 | 40 | **0.800** |
| 0.02–0.06 | 3 | 1.000 |

Three quarters of this fixture sits in the most extreme bin — almost no shared content word — which is harder than production, where people still say *timeout*, *429*, *batch*. Production sits on the curve, not at its worst point.

So the defensible claims are: **the right memory reaches the top five 89% of the time on symptom-worded queries; reach isolation holds perfectly even there; and top-slot accuracy runs 0.46 to 0.80 with how much vocabulary the user happens to share.** Not one number.

## Neither ranker closes the first-slot gap

Both interventions were then measured on that stratum — the case each is supposed to be for.

| | rank-1 | found@5 | warm query |
|---|---|---|---|
| typed sub-queries | 0.541 | 0.891 | 20 ms |
| + query expansion | 0.546 | 0.891 | 799 ms |
| + cross-encoder rerank | 0.546 | 0.891 | 199 ms |

**+0.005 each, at ten to forty times the cost.** The diagnostic above says why: what takes the top slot is a sibling lesson about the same topic in the same project. A reranker separates a right answer from wrong ones; it cannot separate a right answer from another right answer. Expansion invents a hypothetical document, which lands among the same siblings.

The intervention this points at is not a better ranker. It is either fewer near-duplicates in the store — which is what consolidation is for — or a scoring rule that stops calling a sibling a miss.

## Query expansion, tested where it should have won

qmd can expand a plain query into lex/vec/**hyde** variants with a 1.7B model. HyDE exists to close exactly the register gap above — the query is a question, the corpus is prose — so the paraphrase stratum is the case it is for. Measured on all three shapes:

| query shape | typed sub-queries | with expansion | delta |
|---|---|---|---|
| paraphrase | 0.541 @ 20 ms | 0.546 @ 799 ms | **+0.005** |
| identifier | 0.962 @ 20 ms | 0.923 @ 640 ms | **−0.039** |
| short, ambiguous | 0.836 @ 19 ms | 0.787 @ 478 ms | **−0.049** |

**It gains nothing where it was supposed to help and costs accuracy where the query already carries strong lexical signal**, at twenty-five to forty times the latency. The mechanism is not mysterious: a hypothetical document invents plausible neighbours, and when the query contains the exact token the answer contains, inventing neighbours can only move away from it.

This also settles a design question before it was built. A router — expand on low-overlap queries, typed on identifiers — is the obvious response to "helps sometimes, hurts others". There is no stratum here where it helps enough to route to. `VESTIGE_QUERY_SHAPE=expand` remains for a corpus unlike this one.

> **Scope of the reranking result.** The byte-identical lists were measured on the easy fixture, where a cross-encoder has nothing to separate because the first stage is already right. That result alone proved little. It was then run on the symptom stratum, where the gold is in the shortlist but not first — the case a cross-encoder exists for — and gained **+0.005**. Both results are on a filtered view of about eleven documents; neither licenses dropping reranking on a large unfiltered pool. This design does not have one, which is the point, but the claim should not travel outside the configuration it was measured in.

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
| Isolation moves rank-1 from 0.109 to 0.969; the engine alone moves it 0.031 | Reach is the primary structure; retrieval is applied inside it |
| Filter-after-rank is bounded by the engine's result depth | Filter first, rank second, over a materialised per-caller view |
| A bare filter collapses to 0.391 under 24% over-claim | Narrow reach at write time; never widen it |
| A memory's reach and its location can disagree | Reach *computes* storage — the same declaration decides both |
| Facet-only ranking scores 0.094 | The search engine is a hard dependency, provisioned and healed by the plugin |
| A gate after staging leaves a dirty history | The content gate runs before the sync path touches the tree |
| 2,748 ms per search, then 543 ms | The engine is kept resident, and the query is stated as typed sub-queries rather than auto-expanded — the expansion was an LLM call per search |
| Every silent failure in this layer presents as "no results" | `explain`, and an audit log for the gate |

---

## Does the protocol change anything?

The behavioural layer is the part that makes any of the rest happen, and it had never been measured — only verified present. Those are different claims: text can sit in context and be ignored. The maintainer of the prior-art pack said as much about this project's protocol, that it is too long and gets filtered.

A 2×2 tests it: the protocol injected or suppressed, on prompts that should trigger a lookup and prompts that should not. Tools, hooks and server are identical in both cells — only the text differs — because comparing "installed" against "not installed" would confound the instruction with the availability of what it names. The gate is off throughout, since it is a separate and probably stronger treatment. Six prompts per cell, one sample, four models.

| model | consults the store, protocol on / off | searches before acting, on / off |
|---|---|---|
| Haiku | 4/6 · 5/6 | 4/6 · 5/6 |
| Sonnet | **5/6 · 3/6** | **4/6 · 2/6** |
| Opus | **5/6 · 3/6** | **5/6 · 3/6** |
| Fable | 3/6 · 3/6 | 3/6 · 3/6 |

**It helps on two models, does nothing on one, and is marginally negative on the fourth.** Across 48 control episodes there was not a single search on an editing prompt, so nothing is over-triggering — the specificity the design wanted is real.

The claim this supports is narrow: *the protocol raises store consultation on the mid and large models, by about two episodes in six, at n=6 per cell.* It does not support "the protocol works" as a general statement, and the disagreement with the prior-art maintainer is probably a disagreement about which model is running rather than about the text.

> The experiment produced four instrument faults before it produced a result, and each one returned a clean number rather than an error: a second memory server the endpoint did not count (every cell zero); the host's own schema-loading call scored as a discovery action (0/24, unreachable by construction); the cheapest model standing in for the population, which flipped the sign; and a fix for the second fault that never landed, so every arm ran on the broken endpoint anyway. Three of those were believed and reported before being caught. **A broken instrument does not fail — it agrees with you.**

## What is deliberately absent

Stated so nobody assumes otherwise: there is no episodic tier (tested, did not reproduce), no consolidation of repeated observations into rules, and no decay or confirmation signal — nothing tracks whether a memory was ever retrieved or ever useful, so nothing can sink on evidence. The content gate is a deny-list with measured limits. These are open, not hidden.

---

## Reproducing all of it

```bash
git clone https://github.com/breferrari/memory-stack-lab
git clone https://github.com/breferrari/vestige      # sibling directory
cd memory-stack-lab && ./reproduce.sh
```

It regenerates the seeded corpus, writes it through this plugin's real write path at both over-claim rates, queries through the plugin's public API, scores against the known-correct answers, and writes everything to `runs/<date>/`. It refuses to produce timings on a loaded machine.

The benchmarks import the plugin directly. They used to import a copy of its write path, which broke when the plugin renamed a module — the break was the good outcome, since for as long as both existed the benchmark measured code that had quietly stopped matching the thing it claimed to measure.

---

## Authorship and audit trail

Vestige was designed and built by **Brenno Ferrari**, in the open, with the full history in this repository and the measurements in [memory-stack-lab](https://github.com/breferrari/memory-stack-lab). Every claim in this document is either reproducible from `reproduce.sh` or traceable to a commit that states what was measured and what it changed.

It is explicitly not a from-scratch design, and [PROVENANCE.md](./PROVENANCE.md) says which component came from where, naming both parents: the distribution model and most of the behavioural layer from [`mcs-cli/memory`](https://github.com/mcs-cli/memory) by Bruno Guidolim, and the reach model and write contract from [obsidian-mind](https://github.com/breferrari/obsidian-mind). What is new here is listed separately, and most of it is new only because combining the two exposed a gap that neither had on its own.

Where a claim was made and then measured to be wrong, it was retracted in the commit history rather than quietly edited — including one benchmark whose numbers turned out to be measuring the machine's load rather than the software.
