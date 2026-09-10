# Scope and Evidence

Covers §9 the 4 Week Plan and the evidence rules behind §0 — the reality-check act. Two rubric
review areas live here — the four-week build and evidence quality — plus the v1-scope preflight (P6). The template no longer
has team, success-criteria or deliverables sections; what survives of them is folded in below.

## Why playable evidence outranks everything written

This is the part studios most often get backwards, and it is worth quoting the industry at them:

- Kowloon Nights states the ranking outright: **"Demo > Video > Concept Art > Words"**, and is
  "generally unable to assess projects without a build".
- Raw Fury's Head of Scouting: **"no deck can save a bad build"** — and the vast majority of publishers
  will not invest in a pitch with no playable build at all.
- Chucklefish: it is "unusual now to sign based on a design document or pitch deck alone". Indie Fund
  evaluates primarily by playing. Epic MegaGrants requires being past the idea phase with a working
  prototype. Wings: the deck covers only what the demo cannot show — team, business model, comparables.
- The funnel is brutal by construction: Raw Fury sees roughly 1,500 pitches a year and signs under 1%.

Hence the program's own gradation, which belongs in §0 as a link and nowhere else as a promise:

| Evidence | Weight |
|---|---|
| Rough prototype of the core mechanic, any engine, even a web demo | **good** |
| Playable core loop in SDK7 | **great** |
| Small vertical slice live in a World | **excellent** |

One link outweighs pages of description. If nothing playable exists, the useful question is not "how do
we describe it better" but **"what is the cheapest thing that could be linked here by next week?"** —
and that thing is a Hypothesis Log row, so go make it one.

**A claim of past validation is not evidence.** "We tested it by hand", a `design/decisions.md` line, a memory
of a playtest — these are *words* until the artifact can be opened and played right now. If the owner
claims the mechanic was validated but nothing playable is reachable, do not record it as evidence:
park *"the verb is fun"* as a hypothesis and offer the jump to `dcl-prototype` to rebuild it as a
greybox. **Fun first, build first** — rebuilding a mechanic the owner already knows how to build takes
days, and it converts wind into a linkable artifact.

**Pre-production is cheap on purpose.** Pre-production runs about 10–15% of a budget against
production's 60–70%; killing a bad mechanic after two weeks of prototyping costs nothing next to
discovering it six months into production. That is the entire economic argument for the spiral, and it
is worth saying to an owner who wants to skip straight to building content.

## Team hours — an interview input, not a section

The template has no team section, but **scope is arithmetic over hours**, so the hours question is
still asked — once, at the top of the §9 step. Hours per week as a number, per person; credentials
are not the input, hours are. Jam games, open-call builds and mods all count as proof of ability, and
a link to one beats a paragraph of experience — such links belong in §0 as playable evidence.

The answer is not written into the document. If it is load-bearing (it usually is), park it as one
line in `design/decisions.md`. A named skill gap — code (SDK7 / TypeScript), 3D and art, design —
with a plan reads as competence; an unnamed gap gets found in week 3, so raise it in the interview
even though no section asks for it — the honest landing spot is §9's top risk.

## §9 The 4 Week Plan — do the arithmetic out loud

**All development happens in weeks 1–4**, and the plan table has exactly those four rows. Program
milestones are still fixed: **Week 2** a functional test version of the core loop with basic
single-player and multiplayer working, including a playtest at §5's first social threshold; **Week 6**
live in their own World with the public repository delivered. Weeks 5–6 are for going live, not for
building — which is precisely why they are no longer a row anyone can spill into.

**Scope arithmetic.** Multiply the content plan by its per-unit cost and compare it to hours × **4
weeks**, not six. State the result even when it is ugly — especially then. A plan that needs 240
person-hours from a team providing 120 is not an ambitious plan, it is a plan that fails in week 3,
and saying so now is the most useful thing the document does. The old six-week framing hid this: the
buildable window is four weeks, and the arithmetic has to use that number.

**Rule of three.** Anywhere content is listed — levels, minigames, items, biomes — at most three
examples. Three shows variety; ten shows unscoped ambition, and reviewers read it exactly that way.

**Exactly three cuts, and they must hurt.** "Nothing to cut" means the scope was never thought
through. A cut list is the clearest evidence in the whole document that real decisions were made — a
painless cut list is decoration. The template adds two rules: the §1 twist can never appear on the
list, and if v1 hits its numbers, the owner names which cut comes back first in v2. If the owner
cannot find three, use constraint injection: *"half the hours and no artist — what survives?"*

**Top risk plus fallback.** One risk, technical, design or performance, and the plan B. Naming a risk
raises reviewer confidence; it never lowers it. A document with no risk named is read as a document
whose author has not looked.

**The live-ops block — "what keeps the experience changing after launch".** Maximum 4 lines, and the
template gives the shape: what changes or rotates without building a new level and how often; what
still creates variation if an update is skipped; what persists across resets and how fast a new or
returning player becomes meaningful again; one player behaviour that would change what gets built
next. `N/A` is legal if nothing resets and progression creates no power gap. Price the answer: the
sustainable shape for a one-or-two-person team is a single weekly anchor event built from a reusable
template plus an automated reset — 1–2 person-days a week at most. "New content every week" from a
tiny team is a documented burnout trap, and it is a red flag on sight.

## Success criteria are the program's, not the owner's

The old template asked owners to invent metrics; the new one does not. The criteria and thresholds
live in the template's **submit self-check** and in the program's *What Makes a Great Experience*
doc: the 5/10 rule, voluntary continuation, the v1 floor of >10% first-week return (dashboard D7),
the >20% D7 program target, the Discoverability Bar. The dashboard already tracks return — **do not
plan around custom in-game tracking**, and do not let a GDD invent a measurement framework. What
the owner *can* still own is the design response: which section they would revisit if a number came
back low (D1 low → §2 FTUE; D7 low → §4 hooks; D30 low → §5 social).

## IP and content declaration — now a header self-check

There is no deliverables section. The IP & Content Policy self-check sits in the header table
(clear / permission documented / `TBD:`), and unlicensed third-party IP anywhere — in §7's visual
signature, in the §8 comparables, in a borrowed name or trade dress — still fails the IP preflight (P7) and it stops
everything. Check it when the header fills at the TL;DR step, and earlier the moment a reference
smells borrowed. The template no longer has a visual-references field, so borrowed art surfaces in
conversation rather than in a list — ask directly whenever a look is described in someone else's
terms.

## What this act always parks

Scope hypotheses are cheap to test and almost never tested. Park them anyway:

- "This content takes N hours to build" — testable by building one unit and measuring, which is the
  single most useful thing a team can learn in week 1.
- Economy, progression and timer pacing — paper and arithmetic, no build needed. These must never
  survive untested to a later rung.
