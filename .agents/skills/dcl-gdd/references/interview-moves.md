# Interview Moves

The section map says *what* to ask. This says *how*, how to unstick an answer that will not come, and
how to stress-test what came back.

## The rules of the room

1. **One decision per message.** Never a batch, never "also, quick follow-up". A list lets the owner
   answer the easy questions and skip the load-bearing one. Three questions is three messages.
2. **Always carry your own answer.** End the question with a recommendation and its reasoning: *"my
   take: a Sunday reset, because your loop is 60 seconds and a daily is too tight — but you decide."*
3. **Look it up before you ask it.** Play or read up on the comparables. Fetch the actual retention
   numbers. Check what the platform allows. Put the finding *inside* the question. A subagent in
   parallel is the right tool for this.
4. **Refuse abstraction.** An adjective is not an answer. "Immersive" → *"name a moment in another
   game that felt like that, and what caused it."* "Lots of replayability" → *"what specifically is
   different on run four?"* Every section resolves into verbs, numbers, or named games.
5. **Do not ask ahead of the fog.** A question downstream of an unanswered one produces a guess that
   has to be unwound later. Park it as `[OPEN: waiting on <the dependency>]` — the named tail is what
   obliges you to come back unprompted the moment that dependency resolves (SKILL.md hard rule 1).
6. **Surface contradictions immediately.** When an answer conflicts with an earlier one, say so in the
   next message and make the owner choose which survives. Silently reconciling two answers is how a
   document ends up describing a game nobody wants.
7. **Read the energy.** A rich answer means dig there — that is where the design lives. "Whatever you
   think" means decide it, mark `[agent-decided]`, move on. Never re-ask the same question in
   different clothes.
8. **Amplify, do not extract.** Every question should leave the owner knowing something they did not
   know before — a benchmark, a named pattern, how a shipped game solved it. Extraction produces a
   filled-in template; amplification produces a better design.

**Tooling:** if an `AskUserQuestion`-style structured-choice tool is available, use it — full context
in the body, real consequences in each option description, your recommendation first and labelled.
Otherwise plain prose with lettered options. Either way, still one decision.

**How many options.** Two when they are written-out drafts of three lines each — the contrast is the
point, and four such drafts are a wall of text in which owners pick the middle one. Three or four
when each option is a one-liner with its consequence, since those are cheap to read. **Never more
than four** (also the hard limit of the structured-choice tool). **The ceiling governs choices, not
menus** — a menu of named shapes is material to recognise yourself in, so it may run longer; the five
promise-and-anchor shapes at Step C are the standard case, and they come with each shape rewritten
into the owner's own idea. The owner can always widen it:
*"more options"* takes it to four, and *"more examples"* is a different request — answer it with a
**menu of named patterns** from the section's reference, which is material to recognise yourself in,
not a set to choose from. Those menus are real and already written: nine return hooks with their
failure modes in [retention.md](retention.md), the co-presence patterns and the quiet-hour toolkit in
[social-design.md](social-design.md), what good looks like per section with excerpts from funded
decks in [playbook.md](playbook.md), and the whole filled example next to the template in `assets/`,
which can be shown section by section.

**Park more than they pick.** A menu's rejects are byproducts, not waste. When a line is too strong
to lose but wrong for the field on the table — a twist that reads as a tagline, a phrase that wants
to be a banner, a trailer beat, an audio motif — **offer to park it** in `design/ideas.md` with a
suggested surface (*"tagline for a banner or trailer, not the player promise"*). Offer it yourself:
an owner will not think to save a line they just declined, and hook-work throws these off
constantly. One answer enters the document; several keepers can leave the step.

## Moves that unstick a stuck answer

All of these replace *specifying* with *reacting*, which is far easier.

- **Two concrete versions.** Never ask "how should the return hook work". Write two genuinely
  different versions, three lines each, and ask which is closer. The answer is usually "B, but with
  A's ending" — which is the real design, and no direct question would have reached it.
- **The playtest transcript.** Narrate a fictional player's first three minutes, beat by beat,
  present tense. Ask what is wrong with it. People who cannot design in the abstract correct a
  concrete session instantly.
- **The angry review.** Write the two-star review this experience gets at launch. Ask which
  criticisms are fair. The fastest known way to surface the flaw the designer already suspects.
- **The Places listing.** Draft the scene's Places entry — title, one paragraph, screenshot captions —
  plus the launch event announcement. A DCL player deciding whether to jump in reads exactly this and
  nothing else. If it is boring, the experience is boring.
- **The 4 a.m. walkthrough.** Narrate arriving alone at a dead hour. This kills naive social designs
  faster than any question, and on a low-concurrency platform it is the common case, not the edge.
- **The steal test.** "Which shipped game already does this well, and what do we do that it doesn't?"
  No answer to the second half means it is not a feature.
- **Work backwards from a clip.** "Describe the one moment someone would record and share." Then ask
  which systems must exist for that moment to be possible. Whole designs fall out of this.
- **Constraint injection.** "Half the hours, no artist. What survives?" Cutting is easier than
  choosing, and what survives *is* the core.
- **Name the hypothesis instead of arguing.** When the owner insists on a claim you doubt, stop
  debating: write it as a falsifiable IF/THEN, park it, and offer to test it. Disagreement is an
  experiment, not an argument.

## Pressure tests

Run these in phase 3, over the full draft. Each is a pass over the document, not a question — report
what fails, then fix it, park it as `TBD:` with a plan, or accept it out loud with a reason.

- **Verb trace.** Every verb in §3 appears in §2's first session and has a touch row in §6. Any verb
  missing from either is a hole.
- **Promise trace.** Does §2's first session actually *show* the twist from the §1 promise? A twist
  the player does not meet in session one is marketing, not design.
- **Repetition test.** Read §3's answer for repetition 10 and ask whether the named variability source
  is real or restated. "It's different every time because it's procedural" restates.
- **No-push test.** Walk §4 assuming nothing will ever remind the player this experience exists.
  Anything that survives is a hook; anything that does not is a wish.
- **Quiet-hour test.** Re-run §5 at 2 concurrent players. Silence is a failing answer.
- **Scope arithmetic.** Content plan × per-unit cost vs the stated team hours (asked at the §9 step —
  the template has no team section, so the number lives in the interview), written out as numbers.
  Then the live-ops cost per week in person-days. State ugly totals plainly.
- **Cut-list test.** Is the cut list painless? Then nothing was decided; go back.
- **Stranger test.** Could someone who was not in this conversation prototype the core loop from this
  document alone? Name every place they would have to guess.
- **Evidence test.** Is there a link to anything playable in §0? If not, what is the cheapest thing
  that could exist there by next week — and is it already in the Hypothesis Log?
- **Hypothesis audit.** Count the `[HYPOTHESIS]` markers. Each one has a row in
  `design/hypothesis-log.md`; each row has a falsifiable IF/THEN and a cheapest killing test. If the
  core loop itself is still hypothetical, that is the next experiment, before anything else in the
  document gets built.
- **Lore ratio.** If world and story exceed the rest of the document, the GDD is a lore wall
  regardless of how good the lore is.

## Failure modes to check yourself against

This is what an AI-written GDD looks like. Check before presenting anything.

- **Feature soup** — a list of systems with no loop connecting them.
- **Retention theatre** — daily quests, streaks and a battle pass bolted onto an experience whose
  players will never open it twice in a day. Hooks must follow from the loop, not decorate it.
- **Menu-picking** — return hooks copied from the template's menu with no mechanics behind them. The
  reviewer reads integration, not naming; this is the exact way to fail the return area while looking complete.
- **Numberless design** — no cycle length, no session length, no hours per week, no thresholds.
- **Uniform depth** — every section the same length regardless of weight. A section with nothing to
  say gets one honest line saying so.
- **Answering for the owner** — inventing a taste decision they never made, then building on it. If
  they did not say it, it is `[agent-decided]` where you put it.
- **Rubric cosplay** — writing the words the rubric rewards without the design underneath. This is
  caught by the log (rubric-words with no testable row are empty) and, earlier, by the marker: a
  recommendation accepted with a bare "yes" is `[agent-decided]` until the owner specialises it to
  their own numbers (SKILL.md hard rule 2). Your own good-answer examples are the trap here — they
  are drawn from the rubric, so an owner can agree their way to a high score without deciding
  anything.
- **The unbuilt Week 6** — a "minimum" live World containing every system described.
