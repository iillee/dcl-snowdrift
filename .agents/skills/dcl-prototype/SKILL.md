---
name: dcl-prototype
argument-hint: "[optional — a hypothesis ID (\"H1-02\"), a claim to test (\"the drop cycle feels good at 45s\"), or \"resume\"]"
description: Run one Decentraland experiment end to end — pick the riskiest hypothesis with the cheapest killing test out of the Hypothesis Log (`design/hypothesis-log.md`, next to the GDD), write a brief with a pre-registered criterion and an owner-testable kill-check, build the greybox scene in SDK7, get it smoke-checked and tested (owner self-test is the v0 default), then write the verdict back into the log and the section that made the claim. One experiment per invocation; it can start from nothing — one build, one question, no document required. Not a "build me a prototype" assistant: the deliverable is allowed to come back negative. Use when someone wants to find out whether a mechanic is actually fun, settle or kill a parked hypothesis, greybox a core loop in SDK7, plan or run a playtest, decide whether a claim settles by arithmetic, a desktop Explorer build or a mobile check, or record a playtest verdict. Pairs with `dcl-gdd`, which parks the hypotheses this skill kills.
---

# Game Prototype Assist: The Prototype Axis

The prototype axis answers **"is it actually fun?"**. The document axis (`dcl-gdd`) answers
**"what do we promise, and why should it work?"**. They interleave through two files in the scene
repo: `design/gdd.md` — the document — and `design/hypothesis-log.md` — the generated Hypothesis Log
index, the interface between the two skills. The log is agent infrastructure; the owner is never
required to fill it or read it.

The job is **not** to build a prototype. It is to run **one experiment** that could come back
negative, and to write down what it settled. A build with nothing to measure is a toy — the most
common and most expensive failure on this axis, because it costs a full week and answers nothing.

You address **the design owner** in one voice, the same as `dcl-gdd` — studio or Creator
Success team member, no modes.

The file conventions, statuses, ownership split and verdict format are fixed by the interface
contract: [../dcl-gdd/references/hypothesis-log.md](../dcl-gdd/references/hypothesis-log.md).
Read it in phase 0. Never keep a second copy of it, and never diverge from it on your own.

## Hard rules

1. **One experiment per invocation.** If two hypotheses look equally urgent, name both, run one, and
   say which one you left.
2. **The verdict criterion is pre-registered.** It is written in the Brief *before* the build starts,
   and judged unchanged at the end. Moving a threshold after seeing the sessions turns an experiment
   into a story. If a mid-experiment change genuinely invalidates the criterion, that is a return to
   the Brief with a new pre-registration recorded in `## Sessions` — never a silent edit.
3. **Build the least that could kill it.** Greybox, primitives, no art, no menus, no persistence. The
   verb under test is real; everything around it is faked.
4. **Cheapest rung that can answer the question.** Arithmetic settles in the doc, not in a build;
   builds run on **desktop Explorer via Creator Hub** (launch ≈ a minute, hot-reload, a greybox is
   15–30 minutes — do not inflate estimates) → mobile last. A hypothesis testable by arithmetic must
   never reach a build untested.
5. **Do not narrate the expected feel before a pass.** Say what to do, never what it should feel
   like — a narrated feeling gets found. The full no-hinting session discipline belongs to external
   testers and lives in the program's `Games/prod-staging/` folder (v1+ material).
6. **Write to the experiment file at two moments: when the Brief resolves, and when the experiment
   closes** (sessions + verdict in one write) — plus, always, **before any pause or stop**, so the
   owner can still walk out at any point and lose nothing. Do not churn the file between those
   moments: mid-build amendments and per-session observations accumulate as notes in the
   conversation and fold into the closing write. The index follows the same rhythm — regenerate at
   open (`_parked` → `_active`) and at close (the verdict rename), never for the running
   experiment's own row mid-flight. Parking a **new** hypothesis is a resting-state event, not
   mid-experiment churn: its file must appear in the index immediately (the contract's honesty
   rule wins). One
   exception is cheap and welcome: an idea surfacing mid-run (a mechanic, a style, anything) drops
   into `design/ideas.md` as one dated, attributed, unjudged line the moment it appears (format in
   the contract) — it is not part of the
   experiment file, and losing it costs more than writing it. Same for a decision the owner makes on
   the spot ("keep the translucent look"): one line in `design/decisions.md` (`date · decision ·
   why`). Unsure which it is? `ideas.md` — `dcl-gdd` re-sorts on its next pass.
7. **A failure is a result.** Never rescue a hypothesis by widening its criterion, adding testers
   until it passes, or explaining away a session. `failed` stays in the log and is worth as much as
   `validated`.
8. **You own `## Brief`, `## Sessions`, `## Verdict`** — plus `Tested on`, the file rename, the
   source-section rewrite and the index regeneration after a verdict. You do not touch the rest of
   the header block; if the IF/THEN is not falsifiable, raise it with the owner instead of rewriting
   it.

## Phases

### 0 — Orient and pick

Agree the `design/` path with the owner — it lives in the game scene's repo, never hardcoded, never
invented. Glob `design/*/H*_*.md` and read the header blocks.

**Resume before you pick.** An `_active` file means an experiment is in flight, and its contents name
the phase — this is why a session can be cut anywhere:

| The file has | Resume at |
|---|---|
| `## Brief` empty | 1 — Brief |
| Brief written, `## Sessions` empty | 2 — Build (skip to 3 if the scene already runs) |
| Sessions started, no `## Verdict` | 3 — Playtest |
| Sessions closed, no verdict line | 4 — Verdict |

Otherwise **pick one**: among the hypotheses whose killing test is cheapest, take the one that kills
the most design if it turns out false. Cheapest first is the ordering key; risk is the tie-breaker
inside a band — not the other way round. See [references/the-ladder.md](references/the-ladder.md).

If nothing is parked, you may create **one** experiment file per invocation under the contract's four
requirements, and you must say aloud that you did. With no `design/gdd.md` yet, `Source section` reads
`— (backfill via dcl-gdd)`.

Close the phase by naming the pick, its rung and its cost in one sentence, and getting a yes. If the
owner picks something a cheaper test could kill first, say so once — then do what they chose.

### 1 — Brief

Rename `_parked` → `_active`, then write `## Brief`:
[references/experiment-brief.md](references/experiment-brief.md). It carries the pre-registered
pair — `Criterion (external):` (one metric, one threshold, the sentence describing failure) and
`Kill-check (owner-testable):` (the claim the owner can kill by feel) — plus who tests and who
launches, the rung and why that rung, what gets faked, what gets instrumented, and what is
deliberately **not** built.

The brief is finished when a different person could run it and reach the same verdict.

### 2 — Build

Greybox on the rung the brief chose: [references/greybox-build.md](references/greybox-build.md).
SDK7 API comes from the `sdk-skills` set and mechanics from the `sdk7-test-scenes` catalog — never
from memory.

**Instrument the metric first.** If the number in the criterion cannot be observed, the build is not
finished, whatever else works. Before a human touches it, dry-run the criterion yourself and confirm
you could reach both verdicts with what exists.

If the build starts outgrowing the brief, stop and cut scope — never widen the experiment.

### 3 — Playtest

**The phase does not open until a smoke line exists in `## Sessions`.** Three sources count: an
agent MCP run, an agent manual dry-run (any transport), or an owner dry-run explicitly recorded as
smoke. This gate binds your initiative, never the owner's request — "give it to me now" is honoured
immediately: hand the build over and write `smoke: skipped at owner request`. Without a smoke line,
later debug passes read as playtest sessions.

At v0 the tester is **the owner, self-testing** — the only source of a feel verdict, and the
program's bar for this stage. Fix the instrument between owner passes and log what changed between
which passes, or the passes stop being comparable. The criterion does not move with them (hard
rule 2). Stop early when the answer is already unambiguous: a clean kill after two passes is a
result, not a half-experiment. External testers (3–5, moderated) are v1+ material — the protocol is
staged in the program's `Games/prod-staging/` folder.

### 4 — Verdict

Judge against the brief, unchanged. Three outcomes, of different sizes:

- **`validated`** — the pre-registered criterion was measured and held: arithmetic or
  agent-instrumented mechanical evidence. Never awarded on an owner-feel self-test.
- **`survived`** — the kill-check held under an owner self-test; the criterion was not measured.
  Terminal for v0, and the expected v0 outcome for a feel claim.
- **`failed`** — the criterion or the kill-check did not hold. A failure is a result.

Then write back, in this order:

1. `## Verdict` — first line machine-readable, exactly as the contract specifies. A `survived`
   verdict names *which claim* survived: `**Verdict:** survived — kill-check held: <what> (owner
   self-test) · criterion not measured · <date> · tested on: <rung>`.
2. `Tested on` — the rung that was actually used.
3. Rename the file `_validated` / `_survived` / `_failed` — the suffix goes terminal at the verdict.
   A **mobile-sensitive** hypothesis closed on desktop keeps its terminal suffix; the index renders
   *… — mobile pending* from `Mobile-sensitive: yes` + `Tested on: desktop` while that is true.
4. Rewrite the **source section** in `design/gdd.md` to state what is now known, and report what you
   changed and where. For `survived` the rewrite is scoped exactly to the kill-check — indicative
   mood for what held; the unmeasured criterion stays in the section as `[HYPOTHESIS]` with its
   H-link. If the rewrite would *contradict* the design rather than refine it, raise the conflict
   instead.
5. Regenerate the Hypothesis Log index (`design/hypothesis-log.md`). The `design/gdd.html` render is a gate
   artifact and not yours.

### 5 — Hand off

Never end with "keep building". End with the next cheapest experiment against the riskiest open
hypothesis, named by its ID — or with `dcl-gdd` when the verdict moves the document: a closed
stage, a section that needs re-interviewing, or a bare-idea experiment waiting to be backfilled.

When you offer the jump to `dcl-gdd`, ask **one more question — which vehicle**: (1) a
**separate session** the owner opens themselves (*recommended for a full document pass*; emit a
three-line bootstrap prompt — short because all state lives on disk: working folder + hypothesis
IDs + doc path/stage + carry-over constraints); (2) **this session** (fine for a single section
rewrite or while context is light); (3) a **sub-agent** (*not recommended*: the interview is
interactive — the owner cannot answer questions through a sub-agent; acceptable only for mechanical
passes such as a harvest with no holes to interview).

## Escape hatches

The owner can say **"just build it"** (build — but the criterion still gets one line in the Brief
first; hard rule 2 does not bend), **"skip the playtest"** (say what the verdict is then worth, and
either mark the hypothesis `_deferred` or record the owner self-test as a verdict — `survived` if
the kill-check held, `failed` if it did not, never `validated` from a self-test — with `tested on`
set honestly),
**"we already know this"** (mark `_deferred` with the reason — skipped experiments never vanish), or
**"stop"** (write the current phase to the file, leave it `_active`, and say in one line where to
resume). Honour all four immediately without arguing.

## Files

The interface contract lives in the other skill and is linked, never copied:
[../dcl-gdd/references/hypothesis-log.md](../dcl-gdd/references/hypothesis-log.md). The
knowledge references are loaded per phase: [experiment-brief](references/experiment-brief.md) ·
[the-ladder](references/the-ladder.md) · [greybox-build](references/greybox-build.md). The
external-tester playtest protocol (RITE) is v1+ material and lives in the program's
`Games/prod-staging/` folder, not in this skill.
