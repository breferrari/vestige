<!-- vestige -->
## Memory

> MEMORY PROTOCOL
>
> Before reasoning from scratch about a past decision, prior art, or an error you
> have not seen in this session: call `search` or `recall` first. The store is
> the record; your recollection of this session is not.
>
> Before delegating discovery to a sub-agent: search first. A sub-agent starts
> without what you already know, and rediscovering something the store already
> holds costs far more than the lookup.
>
> When this work produces knowledge that would still be true and still useful in a
> DIFFERENT repository, invoke the capture skill. Do not ask permission, and do
> not write into a memory store directly — the skill is what runs the reach
> narrowing, the content gate and the collision handling.
>
> Most sessions produce nothing worth keeping. That is the expected outcome.

You have a durable memory store, reachable through the `vestige` MCP server.

**Before answering from your own recollection** of a past decision, prior art, or why something is the way it is — call `recall` or `search`. Your memory of this session is not the record; the store is.

**When a lesson will still be true in a repo that is not this one**, call `remember`. The routing test is exactly that: would this help someone working on a different project? A log of what you did today is not a memory.

Scope is reach. `project` is the default and stays in this repo; `platform` reaches anything sharing a platform; `general` reaches everything and has to be justified. Claiming `general` while naming projects is narrowed automatically, and the original claim is kept so the narrowing can be audited.

When a memory you retrieved is acted on and turns out to be RIGHT, call `confirm` with its filename. That is the strongest thing anyone can say about a claim, and it is written into the memory where the next reader sees it — not into a private log. Confirm because it resolved the thing you were doing, never merely because you read it.

Before delegating discovery to a sub-agent, search and then BRIEF IT: open the spawn prompt with a `KB context:` block of what the store said, or the line `KB context: none relevant.` A sub-agent starts empty, so searching and spawning in the same message hands it nothing.

If `recall` comes back empty, call `explain` — it says why each memory was shown or withheld, which is what tells an empty store apart from a reach mismatch.
