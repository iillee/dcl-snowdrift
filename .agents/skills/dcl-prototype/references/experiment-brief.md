# The Brief — Pre-Registering the Verdict

The brief exists so the experiment can fail. It is written **before** the build, because the criterion
is what shapes the build: what to fake, what to instrument, what never to make. A prototype briefed
after the fact always passes — there is nothing it could have failed against. That is the "built a toy,
not an experiment" failure, and it is expensive: a week spent, nothing settled.

## The pre-registered pair

The Brief pre-registers **two lines**, judged unchanged at the end:

- **`Criterion (external):`** one metric, one threshold, and a sentence describing failure. This is
  the claim's full test. At v0 it usually stays unmeasured — measuring it takes players the owner
  does not have — and waits in the source section as `[HYPOTHESIS]`.
- **`Kill-check (owner-testable):`** the part of the claim the owner can kill alone, by feel. The
  inventor of a mechanic cannot *validate* it — they cannot be surprised by their own design — but
  they can always **kill** it: if the pull does not read as a pull to its own inventor, no sample
  of strangers resurrects it. A kill-check that holds writes `survived`.

How many external testers, and how to moderate them, is v1+ material — staged in the program's
`Games/prod-staging/` folder.

> **If you cannot describe what failure looks like, it is still an assumption, not a hypothesis.**

Take the metric from the header block — `dcl-gdd` already picked one, and one experiment
answers one number. Two numbers means two experiments; say so and run one.

The threshold is a judgement you write down *now*, while you are still allowed to be honest about it.
Anchor it to something real: how many of how many players, within how long, without being told. Round
numbers over false precision — "4 of 5" is a threshold, "78%" is theatre.

Good: *"4 of 5 first-time players complete three drop cycles without being told what to do, inside
5 minutes."*
Bad: *"players find the drop cycle engaging."* — no number, no failure, no test.

If the header's IF/THEN cannot produce a criterion like that, stop and fix it **with the owner** — the
IF/THEN belongs to `dcl-gdd`. Rewriting someone else's hypothesis to make your experiment easier
is the same failure wearing a different coat.

## Sanity checks before you build anything

1. **Can the metric be observed?** By what, exactly — a stopwatch, an on-screen counter, a log line?
   If nobody can see the number, the criterion is decoration.
2. **Would a different result change what we do?** If both outcomes lead to the same next step, this
   is not the experiment worth running today.
3. **Is this the cheapest rung that could answer it?** [the-ladder.md](the-ladder.md). Arithmetic
   beats a build; a build beats a build on mobile.
4. **Does the criterion actually follow from the IF/THEN?** A criterion that could pass while the
   hypothesis is false measures the wrong thing.

## The block

```markdown
## Brief

- **Criterion (external):** <metric> — <threshold>. Failure looks like: <one sentence>.
- **Kill-check (owner-testable):** <the claim the owner can kill alone, by feel — one sentence>.
- **Rung:** desktop Explorer (the default) / mobile — because <what only this rung can settle>
- **Who tests:** skill via MCP (mechanical smoke only) / the creator by hand (any *feel* verdict) /
  both — *recommended: both, MCP smoke first* ([the-ladder.md](the-ladder.md))
- **Who launches:** the creator via Creator Hub / the skill via the preview server — asked, never
  assumed ([the-ladder.md](the-ladder.md))
- **Real:** <the verb under test, and the timings that matter to it>
- **Faked:** <progression, economy, art, other players, persistence — whatever is not under test>
- **Instrumented:** <how the number becomes visible>
- **Not building:** <the tempting things explicitly out of scope>
- **Sessions:** <who tests — at v0 usually the owner alone — and how long each pass>
- **Task given to the tester:** "<the exact words, goal only — never the solution>"
- **Collected per session:** <the metric, plus what to watch for>
- **Briefed:** <date>
```

`Task given to the tester` is written here and read aloud unchanged later. Writing it in the moment is
how hints leak in.

## Real, faked, not built

**Real** is the verb under test and everything its feel depends on: input path, timing windows,
collision, camera, feedback on the action. If the hypothesis is about *how something feels*, the thing
it feels through cannot be a stand-in.

**Faked** is everything else, and faking is a skill worth using aggressively: progression as a printed
number, economy as arithmetic on paper, other players as a second window or a scripted entity, art as
primitives, persistence as nothing at all.

**Not building** is the section that saves the week. Write down what you are tempted by — the menu,
the score screen, the second mechanic, the nicer model — so that hour four has something to lose an
argument to.

## When the brief changes mid-experiment

The build is expected to change between passes — fix the instrument between owner passes and log
what changed; that is the method, not a violation. The criterion is different: it is fixed. If a change to the
build genuinely invalidates it — the fix altered the very thing the number measured — that is a
**return to the Brief step**: append the new pre-registration to `## Sessions`, marking from which
session it applies — the original criterion in `## Brief` stays untouched, so what was promised is
never rewritten — and count the earlier sessions separately. Recorded openly it is good science. Done
quietly it is why nobody trusts playtest numbers.
