# Design Lenses — the theory under the rules

Three books distilled into working questions. The other references tell you *what* good looks like;
this one tells you **why it works**, which is what lets you handle a design the checklists never
anticipated. Read it before a core-mechanic decision or a gate audit.

Adapted from the Army of Darkness team's `docs/design-lenses.md` (`decentraland/dcl-army-of-darkness`),
which distilled it for an autonomous gamedev team; the section anchors already match this template's
numbering.

**Two standing rules for this file.** The lenses are **agent-side**: they generate better questions
and sharper hypotheses, and they never add a field to the document — nobody asks a creator to score
their loop against eight drives. And per hard rule 1, every lens output that is a claim about how
players will *feel* or *behave* is a `[HYPOTHESIS]` with a row in the log
([hypothesis-log.md](hypothesis-log.md)). The lenses produce hypotheses; only a playtest settles
them.

Where a lens has an operational menu already written, this file points at it rather than repeating
it: the nine return hooks with their failure modes are in [retention.md](retention.md), the
co-presence patterns and the quiet-hour toolkit in [social-design.md](social-design.md), the
repetition-10 machinery in [core-loop-and-ftue.md](core-loop-and-ftue.md).

## A Theory of Fun for Game Design — Raph Koster

**Fun is the brain grokking a pattern.** A game is a set of patterns the player learns to read and
master; the pleasure of play is the moment of learning, not the reward at the end. Everything else
follows:

- **Boredom is a mastered pattern.** When a player says "boring", the pattern is either fully
  grokked (nothing left to learn) or invisible (noise — they cannot find the pattern at all). The two
  need opposite fixes: new depth versus clearer feedback. Diagnose which before proposing anything.
- **Players optimize the fun out.** Given a dominant strategy, players will grind it. If the optimal
  way to play is dull, the design is wrong, not the player.
- **The game is its mechanics, not its fiction.** Reskin chess and it is still chess. Fiction sets
  expectations and teaches the pattern faster, but a weak mechanic under a strong theme is still a
  weak game — judge the mechanic naked, which is exactly what a greybox is for.
- **The mastery curve is the content.** A mechanic's lifespan is how long it keeps generating new
  learnable situations. Depth comes from variation the mechanic itself produces — opponents,
  combinations, terrain — not from content poured in beside it.

**Apply at Step B (§3 core loop):** *what is the player still learning on the 10th repetition?* If the
honest answer is "nothing", the mechanic carries minutes, not sessions — and that is the single most
valuable hypothesis in the log. At **Step E (§2)**: the pattern must be findable in the first minute,
because noise kills faster than shallowness. At **Step F (§4)**: what new layer of the pattern does
the end of the first week unlock?

## Actionable Gamification — Yu-kai Chou

**The Octalysis check: eight core drives, run as a checklist over any loop.**

1. **Epic Meaning & Calling** — part of something bigger than yourself
2. **Development & Accomplishment** — progress, mastery, overcoming challenge
3. **Empowerment of Creativity & Feedback** — express, combine, see the result
4. **Ownership & Possession** — it is mine, and I want to improve and protect it
5. **Social Influence & Relatedness** — mentorship, competition, companionship, envy
6. **Scarcity & Impatience** — wanting what you cannot have yet
7. **Unpredictability & Curiosity** — what happens next?
8. **Loss & Avoidance** — playing to not lose what you have

Working rules:

- **White hat versus black hat.** Drives 1–3 feel empowering and carry long-term retention; drives
  6–8 create urgency but burn players out — use them only for deliberate, time-boxed spikes (an
  event, a season end), never as the loop's engine. Drives 4–5 sit between. This is the theory behind
  two rules already in [retention.md](retention.md): why a punishing streak reset is a failure mode,
  and why "retention theatre" is the standard way to fail the return area while looking complete.
- **Intrinsic beats extrinsic.** Drives 3, 5 and 7 are intrinsic — the activity is the reward — while
  2, 4 and 6 are extrinsic. Points, badges and leaderboards are the shell of drive 2: a loop that
  scores *only* there is decoration on an empty mechanic.
- **Four experience phases, each designed on purpose:** Discovery (why they come), Onboarding
  (learning the rules), Scaffolding (the repeating journey), Endgame (why veterans stay). Most
  designs stop at scaffolding; most games die at endgame — which is what the week-3+ row of §4 is
  actually asking about.

**Apply at Step B (§3):** score the loop against the eight drives — a healthy loop hits at least
three, at least one of them intrinsic. At **Step E (§2)**: discovery and onboarding, where curiosity
(7) pulls them in and a real accomplishment (2) lands inside the first minute. At **Step F (§4)**:
scaffolding and endgame run on white hat; name any black-hat use and its time-box. In reward design,
prefer creativity (3) over another badge (2).

## Getting Gamers — Jamie Madigan

**Players are psychology, not demographics.** The reliable levers:

- **Self-determination theory.** Three needs a session must feed: **competence** (optimal challenge
  with clear, immediate feedback), **autonomy** (choices that visibly matter), **relatedness** (other
  people notice you exist). A session that feeds none of them does not get a second session.
- **Anticipation beats reward.** Dopamine spikes on *wanting*, not having: variable rewards,
  near-misses and a known-unknown ("something is waiting next session") outpull any fixed prize. This
  is why §4's hooks are appointments rather than content.
- **Loss aversion and endowment.** Owning a thing inflates its value; streaks, upkeep and expiry
  motivate hard — and they overlap Chou's black hat, so the same time-box discipline applies.
- **Social psychology.** **Social proof:** players do what they can see other players doing, so
  visible activity is the strongest onboarding there is. **Identity:** self-expression binds players
  to a world — avatars and wearables, Decentraland's native strength. **Comparison:** leaderboards
  only motivate near-peers, so bracket them or they demotivate everyone below rank 10 (the theory
  behind "small leagues, always"). **Reciprocity:** a favour received demands one returned — cheap
  fuel for cooperation loops.

**Apply at Step G (§5):** social proof (what does a newcomer *see* other players doing?), identity
expression, near-peer comparison, one reciprocity loop. At **Step F (§4)**: the anticipation hook at
session end, plus something owned that grows. At **Step E (§2)**: competence fed inside the first
minute, with feedback the player cannot miss.

## Cross-lens audit

A pass over the whole draft, not a question — run it in phase 3 alongside the pressure tests, and at
a gate. One line each:

1. **Koster:** what is the player learning on the 10th repetition — and what is new by the end of the
   first week?
2. **Chou:** which drives does the loop hit, is at least one intrinsic, and is every black-hat use
   deliberate and time-boxed?
3. **Madigan:** where do competence, autonomy and relatedness each get fed inside one session?
4. **Anticipation:** what exactly does the player look forward to when the session ends?

Report what fails as a fix, a `TBD:` with a plan, or an explicit "accepted, and here is why" — the
same three outcomes as any pressure test.
