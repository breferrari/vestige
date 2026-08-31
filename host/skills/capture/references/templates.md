# Memory templates

Shapes that make a memory readable by someone with none of your context. Not forms to fill — if a section has nothing true to say, cut it.

## A learning — something discovered that was not obvious

```
title: <the finding, stated as a claim>

<What is true, in one or two sentences. Lead with the conclusion.>

<How it shows up: the symptom someone would actually hit, including the
misleading part — the error that pointed at the wrong place, the metric that
looked healthy. This is what makes the memory findable by someone in the middle
of the problem, because the symptom is what they will search for.>

<Why it happens, if known. "Why" is what lets a reader generalise; without it
they can only pattern-match on the exact case.>

<What to do instead.>

confidence: verified | inferred | unverified
verification: <how you know — the run, the file, the doc. Required for verified.>
```

## A decision — a deliberate choice about how something should work

```
title: <the choice, stated as a rule>

<The rule, plainly.>

<What it is instead of. A decision without its alternatives is an assertion:
the reader cannot tell whether the obvious thing was considered and rejected,
or never thought of.>

<What was given up. Every real decision costs something, and the cost is what a
later reader needs when the trade-off shifts.>

<What would change it. This is what stops a decision outliving its reasons.>

confidence: usually inferred unless the rule is enforced somewhere checkable
```

## Choosing reach

```
scope: project     projects: [repo, ...]      true of these repositories
scope: platform    platforms: [ios, ...]      true of a language, framework or toolchain
scope: general     generality: <why>          true regardless of stack
```

Prefer `platform` over `general`. If you cannot write the `generality` sentence, it is not general.

## What a bad memory looks like

- **A diary.** *"Fixed the checkout bug, rebased, updated the changelog."* No claim, nothing transfers.
- **A lookup.** *"React's useEffect runs after render."* Public documentation.
- **A preference.** *"We should use tabs."* Not a decision unless something backs it.
- **A conclusion with no evidence.** *"The cache layer is unreliable."* Unfalsifiable and unusable.
- **A name.** Any person, handle or email. Describe the artifact, not who touched it.
