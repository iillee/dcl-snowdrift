# The GDD Section Map

The interview order, which is **not** the document order. Sections are ordered by dependency: each
answer constrains the ones below it. Write each resolved section into its numbered slot in
`design/gdd.md` immediately; the grown file keeps template order while you ask in this
order, and a section appears only with its first answer (the growing-document model is defined in
the skill's SKILL.md).

Section numbers follow the template: §0 TL;DR · §1 Player Promise · §2 First Minutes & How to Play ·
§3 Core Loop · §4 Why Players Come Back · §5 Social by Design · §6 Mobile-First · §7 World, Look &
Story · §8 Audience & Comparables · §9 4 Week Plan.

Per step: **Ask** = what to put to the owner. **Good** = a resolved answer. **Smell** = an answer
that sounds resolved but is not. **Load** = the knowledge reference to read when this step begins.
**Park** = what in this section is *always* a claim rather than a decision, and therefore belongs in
the Hypothesis Log ([hypothesis-log.md](hypothesis-log.md)).

**And one standing Load for every step: [playbook.md](playbook.md)'s section of the same number.**
It is organised §0–§9 exactly like the template, so the step you are on names its own chapter — no
lookup needed. `Load` gives you the theory of a section; the playbook gives you what a good answer
to *this* section looks like: the shapes, the tests, the anti-patterns, excerpts from funded decks,
and the probes. It is also where the **provenance of every number** lives, so it is not optional
before quoting a benchmark at an owner (SKILL.md hard rule 5). Steps with no `Load` line of their
own — A, C, D, I, K — still have their playbook chapter.

Roughly 2–5 questions per step — **decisions, not template rows.** Where a step covers a multi-row
table (§5's nine rows, §2's six-row timeline), group the rows into decision clusters and send one
message per cluster: nine messages turn the interview into an interrogation, and one message
carrying nine rows is the batch hard rule 2 forbids. Past 2–5 without converging, propose a decision
and ask for a yes/no.

**The order binds you, not the owner.** An explicit *"let's do social now, skip retention"* is
honoured immediately — the rule and what to say when you follow them are in the skill's SKILL.md.

**On the Harvest route (1E):** fill every step from the repo first — scene code, experiment files,
`ideas.md`, `decisions.md` — and interview only the holes. The map's order still applies to the
holes; the steps filled from the repo are announced, not asked.

---

## Step A — The seed (feeds §1)

Before anything is designed, get one phrase for what this is *like* — a genre or an activity ("a
co-op cooking game", "a hidden-role game about betrayal"). One line, no table, no research: it exists
to aim the hunt for the verb, and to catch an idea that is secretly three games. Riding with it, the
**working promise**: one rough sentence, no word cap, kept in the conversation and **not written to
the document**. It is a compass, not an answer — the committed §1 is written from the decided verb at
Step C.

- **Ask:** what is this like, in one phrase? And roughly — what does the player do, and what is
  strange about it? Say plainly that both are throwaway drafts.
- **Good:** a phrase a stranger can picture. A rough promise the owner would revise without pain.
- **Smell:** a paragraph where a phrase was asked for. Three games inside one seed — decompose here
  and park the rest.
- **Already written?** If the owner arrived with a real pitch or promise, record it verbatim as §1 and
  close the step. Never make someone re-derive a decision they already made; it gets sharpened at
  **Step C**, which is where the 25-word cap gets applied to it — a promise that arrived written
  still goes through the cap, or a 60-word one rides into the document untouched.
- **Not this step:** the two named comparables and the §8 table. They need the twist, so they are
  Step D.

## Step B — §3 Core Loop

The spine. Everything below depends on it, so it is never deferred — and it comes before the
committed promise, because the promise's `[main verb]` *is* this section's verb. Asking for a
25-word promise first asks the owner to write a slogan for something they have not designed yet.

**Stage-aware:** at stage 1 this step resolves the verb, why it feels good the *first* time — **and
every structural beat of the loop**: what happens at each step, including what marks one loop's
completion and what outcome follows (the arrival, the payoff, the reset). A beat is a **decision,
not a measurement** — deferring it to a playtest defers nothing, because there is nothing to build
until it is decided, and Step C writes the promise from this loop, so a promise over an undecided
beat is you designing the game. Park only the loop **measurements** (cycle length, session length,
repetition 10) as `[OPEN: waiting on the verb being proven fun]` and mature them at stage 2
([stages-and-gates.md](stages-and-gates.md)) — it is not yet proven the first repetition is fun.
Two guards, both from a live run where the owner had to drag the interview back to this section: a
beat you inferred from the seed rather than heard is `[agent-decided]` in the table or an open
question — never an unmarked row; and **leaving this step takes a read-back** — the whole loop in
one message, *"did I get this right?"*, and their yes.

- **Ask:** What does the player repeatedly *do*? 3–5 steps, verbs not features — the template's
  table wants, per step, the input, what the player sees or hears, what changes, and **why do it
  again**; then **what marks one complete loop and what outcome follows** — the beat the steps end
  on. Then the numbers: how long is one complete loop (if over 90 seconds, where is the earlier
  payoff?), the shortest satisfying visit and the typical session, and **why repetition 10 differs
  from repetition 1** — where does fresh play come from once authored content is familiar? Then the
  decision question: what can the player choose, time, coordinate, or express — "repeat for a larger
  number" is not enough.
- **Good:** Verbs a player would use. 30–90 s per cycle. A *named source of variability* (other
  players, randomness, rising difficulty, new combinations) for repetition 10.
- **Smell:** Loop steps that are systems ("the economy runs", "the leaderboard updates") rather than
  player actions. No cycle length. "It's fun because there's a lot to do."
- **Pillars close this step:** 2 or 3 short phrases the owner protects when scope pressure comes.
  The template's test is the interview question: remove a pillar — do you get a different game? A
  pillar that changes nothing when removed is decoration.
- **Load:** [core-loop-and-ftue.md](core-loop-and-ftue.md) · and, for a core-mechanic decision worth
  getting right, [design-lenses.md](design-lenses.md) — Koster on what the player is still learning at
  repetition 10, and the Octalysis pass over the loop.
- **Park:** the repetition-10 answer is *always* `[HYPOTHESIS]` until a playtest says otherwise —
  this is the single most valuable row in the log and the cheapest to test.
- **Evidence rule applies here:** a "previously validated / tested by hand" claim surfacing in §3 is
  *words until openable* — do not record it as evidence; park *"the verb is fun"* and offer the jump
  ([scope-and-evidence.md](scope-and-evidence.md)).

## Step C — §1 Player Promise

Written from the verb Step B decided. **If the owner calls it the "hook", this is the field they
mean** — the pitch hook, distinct from §4's *return* hooks; use their word back to them. This is
where the promise stops being a working draft and enters the document — one pass, with the cap on.

- **Ask:** Fill in the promise shape: `You are [role or situation]. You [main verb] to [goal], while
  [distinctive tension or twist].` Maximum 25 words; the exact sentence shape is optional, the four
  pieces are not. One twist only. Then the test: could a stranger repeat it to a friend after hearing
  it once?
- **Good:** ≤25 words, names the role, the verb, the goal and exactly one strange thing. Survives
  being read aloud.
- **Smell:** Adjectives nobody would claim the opposite of — "immersive", "unique", "fun". Five
  twists. A genre label with "with a twist" appended and no twist named.
- **Cap:** 25 words. Hard.
- **Offer the shapes, adapted.** This is the one step where five options at once is right, because
  they are a *menu* rather than a choice set (the ceiling of four in
  [interview-moves.md](interview-moves.md) governs choices, not menus). The five promise-and-anchor
  shapes are in [playbook.md](playbook.md) §1 — genre-plus-twist with no other game named, the one
  rule, a non-game familiar thing, a genre for another crowd, a tonal pair. Show each real one-liner
  **and** the same shape rewritten into their idea, then ask which is closest. A blank page is
  expensive; five concrete rewrites of their own game are cheap to react to.
- **Harvest the near-misses — park more than they pick** ([interview-moves.md](interview-moves.md)).
  Promise-work throws off lines too strong to lose but wrong for this field: a twist that reads as a
  banner tagline, a genre line that belongs in the optional familiar comparison, a phrase for a
  trailer or the game's audio. Exactly one promise enters the document; offer to park every other
  keeper in `design/ideas.md` with its suggested surface — the owner will not think to save a line
  they just declined. From a live run: one five-shape menu yielded the promise, a banner tagline
  *and* the familiar-comparison line.
- **The optional blocks are optional for real.** The one familiar comparison (`It's like [known
  game], but [one meaningful twist]`) is settled one beat later at **Step D**, from a real
  comparable — leave it open here rather than guessing. "Why this game" is 2–3 sentences about why
  the *owner* wants to make it — skip it if the answer is generic; never invent motivation.
- **Note:** familiar genre + one twist beats a novel mashup for inexperienced teams — do not penalize
  a derivative anchor, penalize a missing twist.

## Step D — Comparables (closes §8's comparables table)

The twist now exists, so all three rows of the template's table answer in one sitting — including
*"what we will do differently"*, which is the promise re-read against someone else's game. Two
comparables — the template requires exactly two and no more. One from outside Decentraland; a second
from inside is **a plus, not a requirement** (two outside games are fine — hobbyist owners often
don't know the DCL catalog yet, and an invented Decentraland comparable is worse than an omitted
one).

- **Ask:** Which game outside Decentraland is closest to what you want — and, if the owner knows the
  catalog, which Decentraland experience? For each: what worked, and — the useful half — what did
  **not** fit this audience or context? Then, with the twist in hand, what you will do differently —
  and re-read §1 against it.
- **Research both titles as this step opens** (hard rule 5), so the question already contains what
  you found — never as a precondition to the first interview question.
- **But the research belongs in the question, not in the table.** The template asks for what the
  *owner* observed, so the rows get written from what they say back; a nod to your summary is
  `[agent-decided]`, like any bare-yes recommendation (SKILL.md hard rule 2 — a real pick between
  alternatives earns the `· accepted` tail instead). If they have not
  actually played the game, the cheap fix is to swap the title for one they have — the point of a
  comparable is their observation, and changing the game costs far less than faking it. A reviewer's
  first probe on this table is *what exactly did you see there*, and "I read about it" spends the
  credibility of the whole document.
- **Good:** Two named, specific titles the owner has actually played, each with an honest failure. A
  "differently" row that points at the twist rather than at being better.
- **Smell:** Fortnite / Elden Ring / "an MMO" as a comparable for a first project. A "what does not
  fit" row that is empty or flattering — the template warns against making the comparable sound
  better than the owner's own game. "We do everything better."
- **Then close §1:** decide its optional familiar comparison now that a real comparable is on the
  table — take it or drop it, and §1 is written once.
- **Not this step:** the rest of §8 — primary player, arrival context, deliberately-not-for. Those
  depend on §5's social threshold and close at Step I.

## Step E — §2 First Minutes & How to Play, written as "you"

- **Ask:** Second person, present tense, along the template's time table: 0–5 seconds (what do you
  SEE at spawn that tells you what to do, with nothing to read), 5–10 seconds (what happens when you
  act — by 10 seconds the player can state the immediate goal), 10–60 seconds (first complete
  micro-goal, shortest necessary hint, first reward, first optional social signal), 1–3 minutes
  (first complete loop or a smaller cycle with a meaningful payoff), 3–10 minutes (first meaningful
  choice or escalation, next visible goal), and the natural stopping point — the last thing you see
  before leaving should already show tomorrow's reason to return (the §4 hook, staged in session
  one).
- **Then:** the player-facing **How to Play** — exactly 3 bullets, maximum 8 words each: the main
  verb + immediate objective, how progress works, how another player changes the experience.
- **Good:** Reads like someone describing a game they played. The spawn frame communicates the verb.
- **Smell:** UI narration ("you click the button"), a tutorial, an NPC, a sign with instructions,
  lore, or the first minutes spent walking and reading.
- **Cap:** 180 words for the table, 3×8 words for How to Play.
- **Load:** [core-loop-and-ftue.md](core-loop-and-ftue.md)
- **Park:** the template's **5/10 rule** — 80% of playtesters perform the first useful action within
  5 seconds and can state the immediate goal within 10 — is a program bar *and* a hypothesis; park
  it; it is testable with three people and a greybox. Untested is fine at this stage, and the
  template says so.

## Step F — §4 Why Players Come Back

Worth double in the rubric, so do not let it be answered quickly — **that is a note to you, not a
line to say aloud.** To the owner this is where a promise gets specific, not an exam.

- **Ask,** in this order — note the template fills 4.1 *after* 4.3, so interview hooks first:
  (4.3) exactly **two** return hooks, chosen from the template's menu or invented, each with its
  exact trigger or timing, what the player anticipates, and the reminder channel plus the
  no-reminder fallback — at least one must create a concrete next-day (D1) reason; (4.1) the D1
  sentence — *"a player who enjoyed their first session returns the next day because [Hook 1 or 2]
  ___ at ___"* — pointing at one of the chosen hooks, concrete and time-anchored; (4.2) the
  progression chain — end of first session / end of first week / week 3+, each row naming what
  persists, what becomes possible next, and **how another player can tell**; then the end of the
  first week as a 3–4 sentence second-person scene — if it reads the same as the first session, the
  section has work left; and if the game has currency or tradable rewards, the one-line
  earn/spend/abuse answer.
- **Good:** "Their plot finishes in 20 hours." "Sunday league reset." "Their crew races Friday
  20:00 UTC." A first-week state that is visible to strangers — a rank, 7/20 collected, a wearable, a
  title.
- **Smell:** "Because it's fun." "More content." Hooks name-dropped from the menu with no mechanics
  behind them. The week-3+ row empty or "a bigger number". An invisible XP number.
- **Load:** [retention.md](retention.md) — read it before asking anything here, not after. The theory
  under its rules, when a hook needs to be invented rather than picked, is in
  [design-lenses.md](design-lenses.md): Chou's scaffolding-and-endgame phases and Madigan's
  anticipation-beats-reward.
- **Park:** every hook is a hypothesis about human behaviour. Park each as its own row; they are
  testable at wildly different costs, and the log is ordered by cost.

## Step G — §5 Social by Design

- **Ask:** the template's table, hardest rows first. The repeatable social loop (A signals → B
  responds voluntarily → shared consequence → reason to regroup — the response must change another
  player's options, outcome, reward, status, relationship, or moment-to-moment play). The
  **disappearance test**: if every other player vanished but their traces remained, what exactly
  breaks? — "nothing" is an honest answer if said openly; it means a solo game with social evidence
  around it. From strangers to a group in 30 seconds, without voice or shared language. Recognition
  & continuity: where does a player first learn another player's name, and what persists between
  returning players. **Quiet hours & player counts**: what a solo player can do, the social
  threshold, the ideal group, the v1 tested maximum — and how a solo arrival meets another player
  **by design, not luck**. Drop-in / drop-out: a late arrival contributes immediately; a leaver or
  spoiler does not break play. Then one sentence each: the bystander test, the memorable moment, and
  bring-a-friend (max 2 sentences).
- **Four clusters, four messages** — the nine rows group, and the count rule at the top of this file
  counts clusters: **is it social at all** (the repeatable loop plus the disappearance test) ·
  **meeting and recognition** (strangers to a group in 30 seconds, where a name is first learned,
  what persists) · **population** (quiet hours, the social threshold, the ideal group, the v1 tested
  maximum — four numbers, one decision) · **robustness and colour** (drop-in / drop-out, then the
  bystander test, the memorable moment and bring-a-friend).
- **Good:** Group-scaled rewards, multiplayer-only moments, an audience, async traces, 2-second
  social verbs a stranger can use on you. A quiet-hour answer that survives 2 concurrent players.
  Real numbers in the player-counts row — §6 performance and §8 audience both depend on them.
- **Smell:** "There's chat." "They can team up if they want." Parallel solo play in one room. A design
  that assumes a full world.
- **Rows are lenses, not requirements.** The template says so outright: no game uses all of them, and
  a row that is simply not how this game works gets one honest line or gets **deleted** — `TBD:` is
  for answers that will arrive later, deletion is for questions that do not apply. Offer the deletion
  yourself when a row is clearly foreign to the design; a creator will not dare. Two rows are not
  deletion candidates. The **disappearance test** has *"nothing"* as a legal and informative answer —
  take the answer, never offer to drop the question, because "nothing" tells a reviewer something and
  an absent row tells them nothing. And **quiet hours & player counts** is read by §6's performance
  target and §8's social threshold: it can still go, but only out loud, with those fields becoming
  `TBD:` (SKILL.md, **The growing document**).
- **Load:** [social-design.md](social-design.md) · [design-lenses.md](design-lenses.md) for Madigan's
  levers when the design is socially flat — social proof, identity, near-peer comparison, reciprocity.
- **Loop back:** if Step F picked a crew or team hook, this section has to make it real — and if this
  section produced a strong social obligation, go back and check it is claimed in 4.3.

## Step H — §6 Mobile-First

- **Ask:** Copy the verbs from §3 and map every one to touch. Then: how is the UI small-screen-first
  (one or two sentences)? Performance against the template's targets — 60 fps on recommended desktop
  and 30 fps on a **named** mobile device and client, both at the v1 tested maximum from §5 (the
  program baseline covers up to 20 players) — and the single biggest risk with its plan. Any
  desktop-only dependency (check the Desktop vs Mobile Feature Gap tracker, never memory), and how it
  switches on later without a redesign.
- **Good:** A row per verb with a real touch gesture. One named perf risk (asset weight, physics,
  effects) with a plan. Honest desktop-only dependencies with a switch-on path.
- **Smell:** "We'll adapt it later." Mouse-precision aiming, keyboard combos, hover states. Perf
  unmentioned. A performance answer with no named device.
- **Load:** [mobile-first.md](mobile-first.md)
- **Park:** most input and performance claims are mobile-sensitive — mark them so in the log
  (`Mobile-sensitive: yes`). Their verdicts still close terminal on desktop; the index renders
  *… — mobile pending* until the mobile rung is settled — the QR pass costs minutes and is offered
  at core-loop stage close.

## Step I — §7 World, Look & Story, and closing §8

- **Ask:** the world in **2 sentences** — really two; only premise and context that change what the
  player does. Then the visual direction: how avatars, interactables, objectives and navigation stay
  readable on a small screen, and one screenshot-level visual signature that is unmistakably theirs.
  That is the whole section — the template no longer asks for an annotated image or a list of visual
  references, so **do not ask for either**. An image is still the strongest thing they can attach, so
  mention it once as a bonus for the TL;DR link and drop it if they hesitate; never turn it into a
  requirement, and never let the section wait on one.
- **Hand them a generation prompt.** When the visual signature settles — or two candidates are
  tied — offer a ready-to-paste image-generation prompt for each (composition, palette, mood,
  lighting, aspect ratio; no text or logos in the image), so the owner can make the picture in any
  image model and *see* the choice instead of imagining it. **Anchor the style to the platform**:
  the prompt names Decentraland's look (its avatars and art direction) so the picture stays
  buildable rather than a AAA concept painting — and since many generators are chat AIs, include a
  line telling the generator to look up Decentraland's current in-world visuals if it can browse. The evidence hierarchy stands: a greybox
  screenshot still outweighs generated art in a submission — a generated image is for choosing the
  signature, or placeholder duty while nothing real exists; say which duty this one is doing.
- **Then close §8:** the primary player + arrival context in one sentence (the template's shape:
  *for players who already enjoy ___, arriving alone / with friends / from an Event or Community,
  looking for ___*); how the first group plausibly arrives (max 2 sentences — Discover, an Event, a
  Community, friend invites, an external link) and why enough people overlap to reach §5's social
  threshold; and the **deliberately-not-for** line. The comparables table closed back at Step D —
  check it still matches the game the interview has produced since, and say so if it does not.
- **Good:** Story that changes what the player *does*. A visual signature someone could recognise in
  one screenshot. A first-group answer that names a channel, not "organic growth".
- **Smell:** Lore walls — the single most reported pitch mistake industry-wide. Polished concept art
  in place of a space plan. A primary player who is "everyone".
- **Cap:** 2 sentences of story. No exceptions; if the story does not fit, it is not load-bearing.

## Step J — §9 4 Week Plan (v1 scope)

- **First, the reality-check input:** who is building this, and how many hours per week? The
  template has no team section, so the answer is not written into the document — but scope is
  arithmetic over hours, and the arithmetic cannot run without it. One question, and the answer
  informs everything below (park the number in `design/decisions.md` if it is load-bearing).
- **Ask:** What is playable at each milestone. **All development lands in weeks 1–4** — that is the
  whole plan table, and there is no week 5–6 row to spill into. The program dates are still fixed:
  **Week 2** a functional core-loop test version (basic single-player and multiplayer), including a
  playtest at §5's first social threshold; **Week 6** live in their own World with a public repo, with
  weeks 5–6 for going live rather than for building. Then the
  **live-ops block** — the template's "What keeps the experience changing after launch" (max 4
  lines): what changes or rotates without building a new level, what
  creates variation if an update is skipped, what persists across resets and how fast a newcomer
  becomes meaningful, and one player behaviour that would change what gets built next (`N/A` is legal
  if nothing resets and there is no power gap). Then exactly **3** cuts — the §1 twist can never be
  among them; if v1 hits its numbers, which cut returns first in v2. What a cut removed parks as a
  line in `design/ideas.md` marked `cut from §9 scope` — future material, not garbage. Then the top
  risk and its fallback.
- **Good:** A plan whose content plan × per-unit cost fits the stated hours — show the arithmetic out
  loud, especially when it is ugly. Cuts that visibly hurt. A named risk with a plan B.
- **Smell:** "Nothing to cut." Trivial cuts. A wish list per week. Weekly-content promises from a
  1–2 person team.
- **Non-goals — ask next to the cuts, optional:** any standing `never X, because Y` lines (0–3). A
  *cut* is wanted-and-deferred — it has an expiry, v2 may return it, and it proves scope realism. A
  *non-goal* is identity through negation — no expiry, a pillar with a minus sign. A non-goal is
  legal only if it has already **refused something concrete** — an idea, a mechanic, a comparable;
  a generic "not boring" refuses nothing. Never press for them: an empty optional slot is itself
  informative. The template slot holds the current truth; `design/decisions.md` holds the history
  and the why.
- **Rule of three:** anywhere content is listed (levels, minigames, items) — at most 3 examples.
- **Load:** [scope-and-evidence.md](scope-and-evidence.md)

## Step K — §0 TL;DR, and the header table

Filled last, read first.

- **Ask:** almost nothing new. Compose it from what is already decided: the one-line promise copied
  from §1, the primary player copied from §8, the current status (idea / sketches / greybox /
  core-mechanic prototype / playable core loop / vertical slice), and one sentence on what is live at
  the end of the round.
- **One genuinely new question — the requested round:** **v0** (vertical slice) or **v1** (4-week
  scope), as those rounds are defined in [stages-and-gates.md](stages-and-gates.md). This step owns
  the question — phase 0 only flags a frame that conflicts, it does not settle the round, so ask it
  here even if the frame came up earlier. It is a program decision rather than a design one, so put
  it plainly with a recommendation:
  a design whose fun is not yet found and whose evidence is a greybox is usually asking for v0; a
  design with a playable core loop and a §9 plan that fits its stated hours is asking for v1. If they
  do not know, `TBD:` is legal here like anywhere else — but say which one their own document argues
  for, because a mismatch between the requested round and the evidence in §0 is the kind of thing a
  reviewer notices first.
- **Non-negotiable:** if anything playable exists, its **link goes here**. Playable evidence
  outweighs pages of description, weighed in this order: core-mechanic prototype (*good*) → playable
  core loop in SDK7 (*great*) → vertical slice live in a World (*excellent*).
- **A claim is not evidence.** A `design/decisions.md` line or a remembered hand-test counts as words until
  the thing can be opened and played now. Nothing reachable → no link in §0: park the fun claim as a
  hypothesis and offer the jump ([scope-and-evidence.md](scope-and-evidence.md)).
- **Fill the header table too:** experience title with the IP & Content Policy self-check (clear /
  permission documented / `TBD:` — an unresolved IP issue fails the IP preflight, P7), the deployment target (World
  NAME, Genesis City coordinates, or `TBD:`), studio, date, and contact in the template's own form — **Discord plus email**, not one or the other.
- **The one-last-question block** at the template's end is optional feedback to the program — offer
  it once ("which section was hardest?"), never press.

---

## The Hypothesis Log

Not interviewed, and not in the document. It is **generated** into `design/hypothesis-log.md` by
globbing the stage folders — see [hypothesis-log.md](hypothesis-log.md). The owner is never asked to
fill it; never hand-maintain the status column.
