# The Design Playbook — what "good" looks like, section by section

**Internal skill reference — creators never see this file.** Synced to the light template (§0–§9) on
2026-08-27. [section-map.md](section-map.md) says *when* to ask and in what order; this file says
**what a good answer looks like** when you get there: what each section must prove, the shapes that
work, the tests, the anti-patterns, real excerpts from funded pitch decks, and the probes.

Per section: **Job** → **Shapes** (formulas) → **Tests** → **Anti-patterns** → **Show, don't tell**
(excerpts from real decks) → **Probes**.

**Provenance and freshness.** Distilled from [research/](research/) next to this file; full sources
and URLs live there. Six dated files, all in Russian — reach for the one that matches the claim:

- [dcl-platform-affordances](research/dcl-platform-affordances-2026-08.md) — what the platform
  actually allows: rewards, events, Worlds, wearables.
- [anchor-formulas](research/anchor-formulas-research-2026-08.md) — eleven promise-and-anchor shapes
  with thirteen real deck lines; the full catalogue behind §1's five.
- [metaverse-ugc-funding](research/metaverse-ugc-funding-research-2026-08.md) — pitching inside UGC
  platforms, and the source of every retention band quoted in §4.
- [funding-pitch](research/funding-pitch-research-2026-08.md) — what the *game* part of a funding
  document contains, across programmes and publishers.
- [pitch-deck-archives](research/pitch-deck-archives-research-2026-08.md) — teardowns of real decks
  from the GameDiscoverCo and Glitch Founder's Kit archives; the source of the "Show, don't tell"
  excerpts.
- [example-source-candidates](research/example-source-candidates-2026-08.md) — how the filled
  example's game was chosen.

Three standing rules:

- **Platform facts** (rewards, events, Worlds, wearables — and client features such as voice chat,
  text chat, friends and jump-in) get checked against
  [research/dcl-platform-affordances-2026-08.md](research/dcl-platform-affordances-2026-08.md)
  before you quote them — that research is dated August 2026 and the platform moves.
- **SDK and scene-capability claims** (components, inputs, media, multiplayer APIs) get checked
  against the official SDK7 docs — <https://docs.decentraland.org/creator/scenes-sdk7/getting-started>
  is the entry point, and
  [research/dcl-capability-links-2026-08.md](research/dcl-capability-links-2026-08.md) is the
  verified per-capability index (each link fetched 2026-08-27; includes the desktop-only list and
  client features with no docs page, such as Point-At In World) — never against memory or a general
  web search alone. **Never tell an owner a
  capability does not exist because you failed to find it**: the docs move faster than any model's
  knowledge, and a missing search result is not evidence of absence. When the owner states a platform
  fact from their own experience, record it as owner-stated and design with it; if you could not
  confirm it, that becomes a quiet `TBD:` with the docs check as its plan — not a counter-argument,
  and never a second one after the owner has said "don't verify". When a design starts leaning on a
  capability nobody is sure of, **offer the check instead of running it silently**: *"want me to
  check the docs whether Decentraland can do this, as a first estimate?"* — and treat the docs
  answer as exactly that, a first estimate: if the capability is load-bearing, it is still parked
  as a hypothesis and settled by building, whatever the docs say.
- **The pitch decks are not bundled.** "Show, don't tell" names files under `research/pitch-decks/`
  which live only in the source repo; the excerpts quoted here are self-contained, so use the quote
  and treat the filename as a citation, not a path.

**Where the light template dropped a section, its coaching survives here as a named block rather
than a number:** Pillars now close §3 · Platform fit is cut as a section and coached inside §1, §4,
§5 and §9 · Success criteria are program-side, in the delete-before-submitting block · the
Hypothesis Log is a separate generated file under [hypothesis-log.md](hypothesis-log.md).

This is still a v0 god object: one file organized by section, which is also where it will be sliced
when it becomes a per-section knowledge base.

---

## §0 TL;DR

**Job:** evidence over words. The hierarchy is Demo > Video > Concept Art > Words; the written
document answers *what could not be seen in the prototype*.
**Tests:** a prototype is ready to show when it has found the fun — not when it has features. The
hours arithmetic must survive multiplication: stated hours × 6 weeks against the week plan. The light
template has no team section, so the hours are an **interview input**
([scope-and-evidence.md](scope-and-evidence.md)) and the multiplication happens out loud at the §9
step.
**Anti-patterns:** polished document, no playable link (the effort went into the document, not the
game); invented traction ("everyone we showed it to loved it", with no names and no numbers).
**Probes:** "What can I click right now?" · "Who outside your family has played it, and what did they
do wrong?"

## §1 Player Promise

**Job:** one line that makes the game instantly understood AND gives a reason to play THIS one. Four
required pieces: role or situation, main verb, goal, one meaningful tension or distinction; the
sentence shape itself is free.
**Shapes:** *"You are [role or situation]. You [main verb] to [goal], while [distinctive tension or
twist]."* Alternative — one mechanical sentence: "Time moves only when you move" (SUPERHOT). Logline
check (Hacura): Who am I? What do I do? Why is it cool?
**The anchor is a technique, not a field.** In the interview it lives in two places: the one-phrase
seed at Step A, which aims the hunt for the verb, and §1's optional familiar comparison, decided at
Step D once a real comparable is on the table. Data: a familiar frame plus one twist beats a wild
mashup (Zukowski); one twist, not five. Never sell the anchor game better than your own
(Saltsman/Overland) — the reason to play lives in the promise, not in the reference. Platform note to
verify before using: the publishing categories on the Discovery card are the platform's genre shelf,
so read the promise next to the chosen categories and check they tell one story.
**The five shapes worth offering** — a *menu*, not a choice set, and the sanctioned place to put five
things in front of an owner at once (full catalogue of eleven forms and thirteen real deck lines in
[research/anchor-formulas-research-2026-08.md](research/anchor-formulas-research-2026-08.md)). The
template carries only the first two; these all landed real deals, and each is one line. Show the real
example **and** a version rewritten into the owner's own idea — recognising a shape is easy, applying
it to your own game is the hard part:

1. **Genre or activity, plus one twist, naming no other game.** The reference standard: *"Management
   adventure game where you take care of a cabin in the woods, **but you're a bear**."* (Bear &
   Breakfast, signed). The frame is a genre, the twist is the identity, and no competitor appears.
2. **One rule — the mechanic itself as the pitch.** *"Time moves only when you move"* (SUPERHOT);
   *"…one rule: dodge everything."* (HyperDot). Zero dependence on anyone else's game, and it passes
   the subject-line test automatically. Only works where the rule is genuinely crystalline — never
   squeeze one out.
3. **Something familiar that is not a game at all.** *"GOBLIN ETSY, THE VIDEO GAME"* (Trash Goblin);
   *"an oversized playground for plump dads"* (Totally Reliable Delivery Service); Nanomon anchored
   on a childhood tamagotchi and compared itself to *hardware*, not games. The most under-used
   category, and the strongest fit here — a Decentraland reviewer may not know a niche Steam title,
   but everyone knows Etsy. Watch the promise the metaphor makes: Etsy implies trading.
4. **A genre for someone else's crowd.** *"powerwash sim for the RPG crowd"* (Trash Goblin). Five
   words: what it is, plus whose audience it is for — not "better than X".
5. **A tonal pair, or a genre neologism.** *"a cute and creepy adventure game within a magical
   storybook"* (Beacon Pines, signed); *"Retro-futuristic psychiatry simulator"* (Mind Scanners). Two
   adjectives that fight each other carry more than a paragraph of atmosphere.

Two more for the right owner: **comparison in other people's mouths** — Cosmoteer's own hook line,
then separately *"Often described as 'SimCity on a starship'"*, which sidesteps the Saltsman rule
because players are the ones comparing (it requires the comparison to actually exist); and the
**nostalgic gap** — Wargroove's *"a modern take on… gameplay popularised… by handheld games such as
Advance Wars… in our search for something new… coming up short"*, which frames the reference as a
market hunger rather than a ceiling.

**Why the order matters** (Zukowski): *hook* is what distinguishes the game, *anchor* is what makes
it feel familiar and safe — "the hook gets them to your store page but the anchor is what makes them
push the buy button". Buyers "almost always cited something about what makes the game familiar to
them rather than unique", and genre is the first anchor type on his list. So a game comparison is the
**last** rung of the ladder, not the first. Two failure modes to name out loud: an anchor with no hook
reads as "a lesser version of an old game" (Derek Lieu), and "game X but BETTER / IN SPACE" produces
merely competent games (Ryan Clark).
**The Overland lesson, corrected:** *"XCOM meets Oregon Trail"* was coined by **journalists**, not by
Finji — Saltsman's complaint is that the label stuck ("I don't necessarily want someone talking about
XCOM when thinking about Overland"). So the rule is sharper than "don't compare": if you do not give
your own anchor, someone else's gets attached for you, and it lasts years.

**Tests:** it works as plain text with no trailer (hooks exist before the game — Ryan Clark); a
stranger repeats it after one hearing — test on strangers, friends lie about promises; would it work
as an email subject line? (tinyBuild). If the owner hesitates when reading their promise to someone
who has not seen the game, that hesitation is the signal to add an anchor line — not the other way
round.
**Anti-patterns:** adjectives nobody claims the opposite of ("immersive", "unique", "fun"); five
twists; "game X but BETTER / in SPACE"; genre cliché as promise ("Racing with explosive obstacles" —
Turbo Boom, 0 deals); self-positioning as a clone ("has all the same core features" — One Lonely
Outpost); a promise that only stands while leaning on the reference.
**Show, don't tell — funded hooks:** "…management adventure game where you take care of a cabin in
the woods, **but you're a bear**" (`bearbreakfast/`); "one rule: **dodge everything**"
(`hyperdot/`); "**cute and creepy** adventure within a magical storybook" (`beaconpines/`); "GOBLIN
ETSY, THE VIDEO GAME" (`trashgoblin.pdf` — great hook, the deal died elsewhere).
**Optional block — "Why this game":** keep it if true, cut it if generic — deciding which is your
job. Substitution test: would the sentence survive with any other team's name on it? If yes it is
generic, and advising deletion is a legitimate, respectable answer. Push to *keep* when a personal
reason explains an odd design choice ("I ran a real board-game café for six years" justifies a café
sim's obsessive detail). Creative intent only — not a CV, not team credentials, not market belief.
Provenance: CNC's *note d'intention*; Raw Fury's "Why are you doing it" (question 2 of 6).
**Probes:** "Repeat your promise without naming another game." · "Which words would make someone
*tell a friend* — and what exactly would they say?" · "Why do YOU want to make this — and does the
answer explain any decision visible elsewhere in the document? If not, cut the block."

## §2 First Minutes & How to Play

**Job:** prove the scene teaches itself. The 5/10 rule: first useful action within 5 seconds,
comprehension within 10, no reading.
**Shapes:** second person, present tense — "You spawn at… you see… you grab…" (Tim Ryan, 1999: the
reader becomes the player). Cover 0–10 s (what you SEE), the first minute (action plus reward), the
first ten minutes (goal completed, next goal visible), and the last thing before leaving (tomorrow's
hook shown today). Then **How to Play — exactly 3 bullets, at most 8 words each**: the main verb plus
the immediate objective, how progress works, how another player changes the experience.
**Smells, not bans:** UI narration, lore, a tutorial NPC, a sign with instructions, first minutes
spent walking and reading. The creator-facing template deliberately stopped phrasing these as
prohibitions — name them as smells, never refuse a design over them. Other players mid-loop are the
best instructions there are.
**Anti-patterns:** "a sign or an NPC explains…"; the twist from §1 never appears inside the first
session.
**Show, don't tell:** `mindscanners.pdf` slides 4–9 — the whole core loop and the moral dilemma told
in-world, in second person ("Greetings Mind Scanner! …Personality loss may happen. But don't worry!
You will still get paid."); `bioshock/` — a page of second-person fan fiction before the table of
contents.
**Probes:** "A new player spawns in. What in the first camera frame tells them what to do — without
text?"

## §3 Core Loop

**Job:** prove this is a game, not a moodboard. Verbs, not systems; 3–5 steps; a 30–90 second cycle;
a *named* source of variety for repetition 10.
**Tests:** every step is something a player *does*; the "why do it again" column never says "to
progress".
**Anti-patterns:** loop steps that are systems ("the economy", "crafting") instead of actions; no
cycle length; variety promised as "more content".
**Pillars close this section** (the light template folded them into §3): 2 or 3 short phrases the
team protects when scope pressure comes. Removal test — remove a pillar and you get a different game;
if the game survives, it was a feature. Every section should serve at least one pillar, and the
standing non-goals in §9 are pillars with a minus sign, so check they do not contradict.
Anti-patterns: features dressed as pillars ("great graphics", "deep progression"); more than three;
"a game that includes everything is about nothing" (Tim Cain). Examples: God of War — Combat /
Father & Son / Exploration; Fallout (Cain) — "Mega Level of Violence", "No Right Solution".
**Show, don't tell — loops as artifacts:** `buttoncity2018/` — the loop as a four-vignette comic
(Explore / Solve / Challenge / Talk); `bearbreakfast/` — four banners BUILD→MANAGE→EXPLORE→REPEAT;
`firstdwarf.pdf` — a seven-node loop diagram; `outsmart.pdf` — an explicit loop schema. A drawn loop
reads as thinking; a listed loop reads as filler.
**Probes:** "What does the player repeatedly do, how long is one cycle, and why is the 10th
repetition still fun?" · "Name a feature you already rejected because it did not serve a pillar."

## §4 Why Players Come Back

**Job:** a retention *theory*, not a wish. Frame: the first session is bought with fun, the next day
with an appointment, the long term with friends — and Decentraland has **no push notifications**, so
the reason to return lives in the player's own memory or in their friends.
**Shapes:** the next-day (D1) sentence, concrete and time-anchored ("my crop is ready at 6pm", "the
league resets Sunday"). The end of the first week as a *scene*, in the same second-person style as
§2, which must read differently from the first session. A long-term goal beyond two weeks whose
progress is *visible to others* — a wearable, a title, a board, never invisible XP.
**Tests:** exactly two hooks, each explained inside *this* design rather than name-dropped; the
named-rival test — when you beat someone, do they learn who did it?
**Anti-patterns:** "players return because it is fun / because there will be more content" (content
is consumed once); hooks picked from the menu with no mechanics behind them; a first-week state that
is "they have seen more levels"; punishing streak resets.

**Calibration — and what the numbers actually measure** *(traced 2026-08-27)*. **This block is the
canon for every retention number in the skill.** Two working copies mirror it —
[retention.md](retention.md)'s **Benchmarks** block and
[review-rubric.md](review-rubric.md)'s **Calibration** — and they
carry the figures inline on purpose, because both are read mid-interview. Change a number here and
change it in both, or bump the trace date in all three: three copies drifting apart is how a skill
starts quoting two different bars at the same creator. The program's own
numbers are **dashboard D7 = first-week return**: the share of new players who come back *at least
once* during days 1–7 (defined in the template's glossary). The v1 floor is >10% and the
program-level target is >20%. Do **not** equate these with mobile-F2P "D7 retention", which counts
players active *on* day 7 — a cumulative week-return figure is mechanically higher, so "our 20%
against an industry median of 4–8%" compares two different metrics and overstates the bar. The
comparison class that actually matches is UGC platforms: **D1 > 30% and D7 > 15% is where paid
discovery starts to make sense, and D7 ≥ 15% predicts CCU growth** (RoLearn / Roblox culture, in
[research/metaverse-ugc-funding-research-2026-08.md](research/metaverse-ugc-funding-research-2026-08.md)),
measured against a devforum reality band of **D1 2–11%** for ordinary experiences. Honest framing for
a creator: >20% is ambitious by platform standards — neither a top-decile miracle nor a formality.
The mobile-F2P figures (median ~4–8%, "good" 13–16%) have **no source in this repo**: treat them as
private orientation, never quote them at a creator as a benchmark. Arcade and one-shot designs almost
never reach the target — push toward a meta layer and social obligations, or reset expectations early.

**Hook operating cost** — coach with this when a small team picks its retention meta: async traces
and collections are **evergreen once shipped**, at near-zero ongoing cost; a **weekly reset is
automatic** — no new content needed, and the deadline drives a return surge; daily streaks lean on
**loss aversion**, so use milestone recovery and never a punishing reset; **"my crew expects me"** is
among the strongest retention forces known. The full nine-hook menu with failure modes is in
[retention.md](retention.md).
**Probes:** "Decentraland cannot send push notifications. What exactly will a player *remember*, or
*who* will call them back?" · "Walk me through the end-of-first-week session as a scene." · "What
takes more than two weeks, and how do others *see* progress toward it?"

## §5 Social by Design

**Job:** place the design honestly on the ladder — *present → recognizable → consequential* — and
design the step it claims.
**Tests:** the disappearance test — if every other player vanished but their traces stayed, what
breaks? ("nothing" is an honest, passable answer when said out loud); the name test — where does a
player learn another player's NAME?; reciprocity — "Marta beat your 47.2" starts a relationship, an
anonymous rank change does not; interchangeability — if the same experience happens with Alice or
Bob, the partner is traffic, not a person.
**Patterns to suggest** when a design is socially flat — offer ONE, do not redesign: stable cohorts
of roughly 10–20 for weeks, which produce a recognizable cast; "X beat your ghost" plus a rivalry
score ("Marta 4–3 Bay"); a duo streak with *the same* person; memory of events between people
("Carlos finally beat Maya after six days") rather than records; a quiet hour populated by *my*
rivals' ghosts instead of the global top.
**Anti-patterns:** optional social ("there is chat", "they can team up"); social data dressed as
social design (leaderboards and ghosts claimed as relationships); one big fragile community instead
of small re-formable groups — churn is socially contagious.
**Calibration:** the platform baseline is 0–3 concurrent players in a scene. Judge every social claim
against that first and event peaks second. A well-designed co-presence game is fundable; "these
particular people" is the top of the ladder, not the entry bar.
**Constructive reciprocal-authorship chain** — a coaching ladder above "consequential", never a
template requirement: the creator authors the conditions through ___ → players author the event
through ___ → the community carries meaning or history forward through ___ → the creator or host
observes ___ → and responds next time by ___.
**Probes:** "How does a player who arrives alone end up interacting with someone — by design, not by
luck?" · "If every other player vanished but their traces stayed, what breaks?" · "Where does a
player learn another player's name?" · "What does your world look like at 4 a.m. with 2 players?"

## §6 Mobile-First

**Job:** touch is the primary design target, not a port. Every core-loop verb needs a touch mapping;
the UI is small-screen-first; one named performance risk with a plan.
**Calibration:** mobile is officially "optimized for shorter, more frequent visits" — 3–5 minute
loops and instant entry into gameplay ("fun in 20 seconds", "repeatedly fun in 5-minute sessions", in
Meta's judging language). Performance targets are 60 fps on recommended desktop and 30 fps on a
**named** mobile device, both at the tested player maximum from §5.
**Anti-patterns:** "we will adapt it later"; mouse-precision aiming, keyboard combos or hover states
in the core loop; performance unmentioned; a performance claim with no named device.
**Never quote numeric scene budgets from memory** — triangle, entity, texture and file-size limits
get looked up ([mobile-first.md](mobile-first.md)).
**Probes:** "Show me the touch mapping for your rarest core-loop verb." · "What is the heaviest thing
in your scene, and what is the plan when it breaks 30 fps?"

## §7 World, Look & Story

**Job:** story in 2 sentences — lore walls are the single most reported pitch mistake industry-wide —
and story matters only where it changes what the player does. Visuals prove, they do not decorate.
**Tests:** the Finji screenshot test — someone looking at your screenshot thinks of YOUR experience,
not "ah, it is like X"; the fake-screenshot honesty rule — a *typical* moment, not the most
spectacular one (Boury); the tone of the document is the tone of the game.
**Anti-patterns:** world and story taking more of the document than everything else; concept-art
polish standing in for a space you can read; sound never mentioned — ask the optional question, and
ask what survives on a muted phone.
**Show, don't tell:** `flameflood/` — three UI mockups as a tension curve (day 8 healthy → day 11
illness stacking → day 14 red screen); `cryptmaster.pdf` — the whole document styled as a D&D module,
95% game; `backbone/` — a deck set in the game's own noir, which is itself proof of art competence.
**Probes:** "Cover the caption: is this screenshot recognizably yours?" · "Which sentence of your
story changes what the player *does*?"

## §8 Audience & Comparables

**Job:** audience through experience; comparables as positioning, with honest failure analysis.
**Shapes:** audience — *"For players who already enjoy ___, arriving alone / with friends / from an
Event or Community, looking for ___"*, or a mood ("chill players who prefer a feeling of stability" —
Bear & Breakfast). Comparables — **exactly two**: one from outside Decentraland, and one from inside
if the owner knows the catalog (two outside games are fine). Three rows each: what works, what does
not fit this audience or context, what we will do differently.
**Tests:** the "what did not fit" row carries real insight; the document never makes the reader want
to play the comparable more than the proposal (Saltsman).
**Anti-patterns:** "it is for everyone" (a red flag everywhere in the industry); AAA megahits as
comparables for a first project; comparables that outshine — Turbo Boom's nearest analogs had sold
poorly, so its comparables argued *against* the game.
**Show, don't tell:** `bearbreakfast/` — the comparables shape as covers, one per pillar (Stardew
Valley × Night in the Woods × Theme Hospital); it uses three, we ask for two, and the discipline is
what transfers. `buttoncity2020/` — honest ceiling / middle / floor comparables with the methodology
footnote ("Steam reviews × 50").
**Probes:** "Tell me what your comparable got *wrong* — and where you would repeat their mistake if
you are not careful."

## §9 4 Week Plan (v1 scope)

**Job:** scope realism. Cuts that hurt, a plan that matches the stated hours, risks named before a
reviewer finds them. All development sits in weeks 1–4; weeks 5–6 go live and are not a row in the
table, so the arithmetic multiplies hours by four weeks.
**Tests:** the §1 twist is never in the cut list — a differentiator sold as a budget option killed
One Lonely Outpost's pitches; standing non-goals refuse something concrete or stay empty; the
after-launch block ("What keeps the experience changing after launch") names a rhythm, and if v1 hits
its numbers, which cut returns first. Listing discipline, misnamed the "rule of three": anywhere the
document lists content (levels, minigames, items), *at most* three examples — three shows variety,
ten shows unscoped ambition. It is a cap on examples in writing and a scope *smell detector*, never a
quota: do not push a design to *have* three of anything.
**Anti-patterns:** "nothing to cut"; weekly-content promises from a one-or-two-person team — a
documented burnout trap, so suggest one templated weekly anchor event at 1–2 person-days a week; a
risk section silent about the thing reviewers will worry about. Turbo Boom never mentioned its custom
engine and was rejected for it; Cosmoteer had the same risk, gave the engine a slide with a port
plan, and signed.
**Standing non-goal teaching pair:** "never a rage game, so death never rolls back progress" refuses
something concrete; "never boring" refuses nothing. A non-goal earns its line only once it has
already killed an idea, a mechanic or a comparable.
**Probes:** "Show one week of your after-launch calendar and its cost in person-days." · "Which of
your three cuts hurt the most — and why is it still the right cut?"

---

## Platform fit — cut as a section, still design knowledge

The light template has no Platform Fit section. Coach these facts where they belong instead: arrival
and identity in §1, rewards and events as hooks in §4, co-presence in §5, the traffic plan in §9.
Verify every line against
[research/dcl-platform-affordances-2026-08.md](research/dcl-platform-affordances-2026-08.md) before
quoting — statuses change.

A scene can *read* the avatar (name, worn wearables, guest status) but never *change* it. Wearables
and emotes earned here stay visible in every other scene, and a scene can recognize them on return
(WonderMine is the reference case). Guests without a wallet cannot receive NFT rewards, so the guest
path needs its own motivation. A World is invisible to passers-by, so traffic has to be brought —
events, Community, streamers, links. The events calendar (RSVP → in-world alert) is the creator's
only push channel. Players earn Marketplace Credits partly by attending events. **Smart wearables and
portable experiences are not supported**, so a core loop resting on them cannot ship — this is no
longer a preflight row of its own (the nine are P1–P9 in [review-rubric.md](review-rubric.md)), but it is still
a hard stop worth raising the moment it appears.

**Anti-patterns:** platform-blind design that could ship on Steam unchanged, ignoring avatar
identity, voice, jump-in and glide; "Places will surface my World" (it mostly will not); reward loops
that silently exclude guests.

## Success criteria — now program-side

The light template merged them into the delete-before-submitting block: the program owns the
measurement framework, and the creator's job is to say how the design meets it. **Never demand custom
instrumentation from a creator.** The pivot-threshold shape is still a useful coaching device in
conversation — "if fewer than X% return, we rethink Y" — but it is not a field to fill. Place cards
and campaign tests are not part of the light template; do not introduce them.

## The Hypothesis Log — moved out of the document

It is no longer an appendix. It is a separate generated file, `design/hypothesis-log.md`, under the
contract in [hypothesis-log.md](hypothesis-log.md), and creators never fill it. The coaching that
still applies: write every claim as *"IF [design choice], THEN [observable player behaviour with a
number]"*, including social claims ("IF brackets stay stable for two weeks, THEN half of returning
players can name another player unprompted"); if the owner cannot describe what *failure* looks like,
it is a `TBD:`, not a hypothesis; never spend an expensive test on a question arithmetic could
answer. Anti-patterns: a decorative log whose rows restate the document as unfalsifiable
"hypotheses"; statuses edited by hand instead of earned.
**Probe:** "Pick your riskiest claim — what is the cheapest thing that could prove it wrong this
week?"

---

## Voice notes — tone when talking to a novice

- "If a question feels hard, that usually means the design needs more thought right there — **that is
  the question doing its job, not you failing**."
- "**Anything playable beats everything written.**" — the evidence hierarchy in six words.
- Around the most painful rule, that the differentiator cannot be a cut: "…the scope needs another
  look — **tell us and we will figure it out together**." Collaborative framing, never punitive.

## How the skill uses this file

The old "working modes" sketch is obsolete: the skill has no modes — one voice, six entry states,
and a single session-wide mode (document-only). What survive are **moves**, not modes:

- **Fill** — the phase-2 interview in [section-map.md](section-map.md) order.
- **Brainstorm** — the two-versions move and the one-liner menus in
  [interview-moves.md](interview-moves.md); "note the moment the listener lights up" (Chucklefish) —
  hooks are found empirically, not derived.
- **Grill** — the phase-3 pressure tests, plus the probes above.
- **Wayfind** — when the owner is lost between options, apply one lens (the social ladder, the
  return-horizon frame, platform affordances) and show a real example instead of explaining.
