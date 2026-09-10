# Stages, Gates and the Spiral

## Two axes, one spiral

The document axis asks *"what do we promise and why should it work?"*. The prototype axis
(`dcl-prototype`) asks *"is it actually fun?"*. They are not sequential and they are not a loop —
they are a **spiral**. One turn: the document poses falsifiable IF/THEN hypotheses → the cheapest
experiment that could kill them runs → verdicts flow back into the log and rewrite the sections that
made the claims → the document leaps a gate and the prototype graduates a rung.

**Escalation discipline.** Each rung costs more than the last, so it must answer costlier questions.
Never spend a vertical slice answering a one-pager question. A hypothesis testable on paper must not
survive untested to the slice.

The **full GDD is permanently out of scope.** Modern practice keeps it as a living production
workspace, never a gate artifact. The short GDD sits in the "ten-pager" slot and stops there.

## The three document stages

One `design/gdd.md` grows through all three — you never start a second file. What changes is how much
of the template is real, and what the `.html` render at the gate looks like.

| Stage | Aligned prototype rung | Sections that must be real | The gate question |
|---|---|---|---|
| **1 · Concept one-pager** | find the fun | §1 promise · §3 with the verb and **every structural beat of the loop decided** (arrival and outcome included) — only the loop *measurements* wait for stage 2 · §2 first minutes (rough) · §7 world in 2 sentences + the visual signature · §8 comparables | Is there a game here at all — is the verb fun? |
| **2 · Pitch** | core loop playable | + §4 in full · §5 social · §8 audience rows · §9 as a skeleton · §0 TL;DR | Would this hold a player past Day 1? |
| **3 · Short GDD** | vertical slice* | everything, including §6 mobile · §9 in full with the live-ops block (the template's "What keeps the experience changing after launch") · the header table and §0 (IP self-check, deployment target, requested round) | Is this fundable, and can this team build it? |

\* **The vertical slice is optional** — a showcase for a candidate who wants to stand out, never a
requirement. The v0 bar closes without it; `03-vertical-slice/` stays a lazily-created folder.

Sections not yet in scope for the current stage are simply **absent from the grown document** —
never filled with guesses; the template stays the reference for what is missing (the
growing-document model is defined in the skill's SKILL.md). Say out loud which stage the document
is at when you announce the classification in phase 0.

**The stage bounds the agent, not the owner.** You do not drive past the stage's set — those steps
are announced as out of scope rather than asked. An owner who wants to go there anyway is honoured
immediately, with one line about what the section will rest on: the same rule that governs jumping
sections out of order. In a document-only session the mode choice itself is that standing request:
once the stage's set is written and the one sanctioned offer is declined, the interview continues
into the next stage's set (see the skill's SKILL.md, Document-only sessions). A stage is an expectation about what is worth asking yet, never a gate held
against the person writing. A **resumed** document may also have been grown at a different stage
than the one you would assign now — read the stage off what is actually written, and say so.

**At stage 1 the only retention theory required is fun itself.** The next-day (D1) sentence and return hooks
(§4) become real at stage 2, once the verb is proven — asking for a retention theory before the
mechanic is validated produces guesses, not design. The reviewer's weighting of return theory
applies to the *submitted* GDD, not to a stage-1 document in progress.

**Stage 1 cannot close on words.** Its gate question — *is the verb fun?* — is answered by a
playable, not by a paragraph. A claim of a past hand-test with no reachable artifact is not an
answer: if no playable core mechanic can be opened right now, the honest move is to pause the
interview and offer `dcl-prototype`. Fun first, build first.

**Solo suffices at v0; external testers are v1+.** At every pre-production stage the tester is the
owner themselves. A kill-check that holds under an owner self-test writes `survived` — and
`survived` is the stage's expected terminal state, a green flag, not an incomplete `validated`.
The program itself brings playtesting and QA support at v1.

## Gates are soft

- A stage closes when **nothing worth testing remains at that level** — a judgment call, not a
  counter. Say why you think so, and let the owner overrule.
- The owner may skip forward at any time. Skipped experiments become `deferred` in the log; they do
  not vanish.
- Never block on completeness. "Polished document, no playable evidence" is the exact red flag the
  reviewer checklist grades against — a thinner document with a validated core mechanic beats a full
  one with none.

**Interruptibility is a hard requirement, not a nicety.** Write the section to `design/gdd.md` the
moment it resolves, so the owner can walk out mid-interview to go build something and lose nothing.
Actively offer the jump when a claim becomes testable — unless the session is document-only, where
jump offers stay silent (the mode is defined in the skill's SKILL.md).

## What happens at a gate

Only at a gate — not per edit, or the token cost and drift risk return. The Hypothesis Log index is
the one exception: it is cheap and stays fresh continuously, so item 1 is a re-check here rather than
its only run.

1. Regenerate the Hypothesis Log index (`design/hypothesis-log.md`) by globbing
   ([hypothesis-log.md](hypothesis-log.md)).
2. Check that every `validated` / `survived` / `failed` verdict has already rewritten its source
   section.
3. Regenerate `design/gdd.html`.
4. State the gate passed, and what the next stage now demands — and offer the natural pause: a gate
   is the best stopping point in the whole interview, everything is saved, and resuming lands
   exactly here.
5. Report **harvest coverage** against the stage table above, in one line — *"concept stage closed —
   promise and core loop are real, return / social / audience still placeholders; about five minutes
   of pulling from your repo would fill some. Want it?"* — and offer it. Counting is mandatory for
   you; the owner may decline, and declining blocks nothing. Section names, not numbers, and no
   internal words like "harvest" (SKILL.md hard rule 7).
6. Closing the **core-loop stage** has one extra last check: offer the **mobile QR pass** (~5 min —
   Creator Hub → the dropdown next to Preview → Show QR Code for Mobile). Offer and record the
   answer, never force it.

### The `.html` render

`.md` is the source of truth. `.html` is a **disposable, free-form creative render** of it —
self-contained, inline CSS, no JS frameworks, no build step, no pipeline: you simply rewrite the
file. Its shape follows the stage: a single scrolling one-pager at stage 1, something deck-like at
stage 2, the full ten-pager at stage 3.

Stamp it: *"rendered from design/gdd.md · v<n> · <date>"*. Never hand-edit it as a source, and never
read a fact out of it — if the two disagree, the `.md` is what is true.

**And it is never the thing that gets submitted.** A render carries the status banner and the working
markers inside it and looks more finished than the document it came from, which is exactly why an
owner might send it. Say so the first time you produce one — *"this one is for looking at and
sharing; `design/gdd.md` is what goes in"* — and if a render is made after the submission clean-up,
regenerate it from the cleaned `.md` so the two cannot tell different stories.

## Where the program's rounds sit

Verified against the program doc; do not extend beyond it.

- **v0 — entry bar, unfunded.** Concept plus find-the-fun. Note the bar already expects the fun
  *found*: a playable World with a solid core loop at the door, or a pitch from an experienced studio
  that compresses find-the-fun into weeks 1–2. **This is where this skill does its heaviest lifting.**
- **v1 — round 1, 6 weeks.** Week 2: functional core-loop test version, basic single-player and
  multiplayer. Week 4: playable prototype, final design direction, mobile playtest — and **all
  development ends here**, which is why the template's §9 table has only weeks 1–4. Week 6: live in
  their own World, public repo delivered. Week 6 is the classic *publishable* first playable — and
  the program's concrete bar for "publishable" is 60 fps recommended / 30 fps minimum hardware, sound
  and a tooltip on every interaction, and 80% of ten-plus testers playing within 5 seconds. That last
  clause is the program's own wording for its *launch* bar — it is **not** the template's **5/10
  rule**, which adds the second half (the immediate goal stated within 10 seconds, no help) and names
  a mobile device rather than "minimum hardware". Quote whichever the context asks for; never merge
  them, and never drop the 10-second half when the template's bar is the one in question.
- **v2 — improved live version.** Both time-on-scene *and* D7 must rise versus v1.
- **v3 — mature.** 20%+ D7, expanded progression, first creator monetisation.

Three iteration rounds exist at most, and **progression is evidence-gated, never automatic** — support
may end after any round. Round budgets live in the program doc; do not quote figures from memory.
**Durations for the v2 and v3 rounds are not specified anywhere — never invent them.**

Ship quality belongs in pre-production, and that is not a contradiction: near-final quality is
precisely what separates a slice from a prototype, and the gate exists to retire quality and tech
risk *before* production scales content. What belongs to production is quality *at scale*, not
quality *discovery*. The program's twist is that the Week-6 World is the whole (small) experience, so
the bar applies to all of it; v2 and v3 replicate proven quality rather than discovering it.
