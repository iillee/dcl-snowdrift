# The Review Lens — Used Openly

*(The filename is historical. There is no rubric here any more: the programme retired numeric gates
and scored totals, and so has this file.)*

Derived from the merged reviewer instrument, `reviewer-checklist.md` in the programme repo, which
itself merged three predecessors on 2026-08-27. **That file is the reviewer's; this one is yours.**
Its job here is to let you see a document the way a reviewer will, early enough to act — it is
**never an authority you hold over a creator.** The submission bar is deliberately low: an unproven
promise is what a proposal *is*, and the programme decides submissions, not you.

Three consequences, and they are the whole point of the rewrite:

- **No totals, no thresholds, no predicted verdict.** The old "R1–R8, max 18" scored a dimension set
  that matched no real instrument, and a number invents certainty the process does not have. Report
  *what is weak and what would lift it* instead.
- **A hit is a move, not a rejection** — a clarification, a targeted revision, a specialist question,
  or the one thing worth deciding before more writing happens.
- **Never say any of this out loud in these words.** "P4", "preflight", "status" and the rest are
  yours (SKILL.md hard rule 7). To the owner it is *"the return section is the thin one — here is the
  cheapest way to thicken it"*.

Use it three ways: **the preflight in phase 0 and again over the finished draft in phase 3**, **the
probe questions as ready-made interview questions**, and **the review areas as the acceptance lens**
in phase 3.

---

## Preflight — P1–P9

Problems worth naming early, because they are cheaper to fix early. These rows are the merged
checklist's preflight, one for one; the letters are internal shorthand for you.

Three rules carry over verbatim from the programme's own guidance, and they override any instinct to
treat a miss as a failure:

- an untested claim is acceptable when the planned test is credible;
- an initial proposal does not fail merely because no build exists yet;
- a short contextual hint or optional help is **not** a blocker.

| # | Check | Not ready looks like |
|---|---|---|
| P1 | **Core game** (§3) | A theme, a story or a feature list, but never what the player repeatedly *does*. No loop completion, no outcome, no named source of fresh play. Waiting or queues standing in for the loop belongs here too — the "loop" turned out to be a timer, and waiting became the gameplay. |
| P2 | **Program fit** (§1, §5) | Social absent by design: pure single-player, play invisible to bystanders, no reason for a second player to exist. Designed async traces, visible play or co-presence are *fine* — an honest "solo with social evidence around it" passes. |
| P3 | **First-use clarity** (§2) | The first minute is not understandable — the 5/10 rule fails. The failure is **incomprehension, not the presence of text**: the teaching order is visible affordance → short contextual hint → optional help. (A blanket ban on reading, signs and tutorial NPCs was considered and rejected as too broad — decision D-08. Do not restore it.) |
| P4 | **Return theory** (§4) | No concrete D1 hook, no persistent first-week change, no testable return hypothesis — or the only theory is "the game is fun" / "there will be more content". |
| P5 | **Mobile path** (§6) | A desktop-only interaction model with no touch plan: mouse-precision aiming, keyboard combos, hover states. Performance unmentioned. Desktop evidence offered for a mobile claim. |
| P6 | **v1 scope** (§9) | Scope obviously beyond four build weeks — "an MMO", "10 minigames", progression plus housing plus pets in v1. Cuts that remove nothing. A complete loop that depends on unspecified later features. |
| P7 | **Name, IP, policy & deployment** (header, §7) | Unlicensed third-party IP anywhere in the concept, the visual signature or the references. Deployment permission unclear with no `TBD:` routing it. |
| P8 | **Submission evidence** (§0) | A claimed link that does not open, or does not match the stated stage. **Not** a hit: having no build at all — that leaves the claim untested, which is a legitimate state for an initial proposal. |
| P9 | **Platform feasibility** (§3, §5) | The core loop depends on what the Explorer does not have — smart wearables, portable experiences, push notifications. Usually one mechanism to redesign, not a decline. |

**A miss burns in two ways, and only one of them is about the design.** *Structural*: the design
refuses the requirement — "players wait in a queue for their turn" *is* the design. *By absence*: the
section was simply never asked. On hobbyist documents in Adapt or Solidify, P4 and P2 burn by absence
almost every time, and closing them **is the interview**, not a verdict on it. Report absences as the
interview's targets, and a structural miss as the one thing worth deciding before more writing.

**Stage matters.** P4 (return) and P2's social half judge the *submitted* GDD, and their sections
become real at stage 2 ([stages-and-gates.md](stages-and-gates.md)). At stage 1, record the intention
and move on.

---

## Review areas — the acceptance lens

One status per area, never averaged, never totalled. This is the merged checklist's decision record,
used on yourself before a reviewer uses it on the document.

- **Clear** — specific, internally consistent, scoped, and supported by suitable evidence or a
  credible test plan.
- **Follow-up** — plausible, but an important operation, assumption or proof is missing.
- **Blocker** — absent, contradictory, or incompatible with a fixed requirement or a complete v1.
- **Not applicable yet** — the evidence belongs to a later stage. Live retention data at concept
  stage is this, never "insufficient".

| Review area | Where it lives | Clear looks like |
|---|---|---|
| Player promise & Decentraland fit | §0, §1, §8 | ≤25 words, a role, a verb, a goal and exactly one strange thing; repeatable from memory. |
| Immediate comprehension | §2 | The spawn frame communicates the verb; first useful action inside 5 s, the goal stateable by 10; first reward inside a minute. |
| Core gameplay & repeatability | §3 | 3–5 verbs, a 30–90 s cycle, and a *named* source of variability answering why repetition 10 differs. |
| Progression & return design | §2, §4 | A concrete, time-anchored D1 sentence; two hooks explained *in the design*, not name-dropped; a first-week player with named persistent state. |
| Intentional social play | §5 | Better-with-others is designed — group-scaled rewards, multiplayer-only moments; the quiet hour answered; play legible to bystanders. |
| Social continuity | §5 | A player learns another player's name; one player's action changes a specific other's next session, and they learn who did it. |
| Audience & first viable crowd | §5, §8 | A primary player described through experience, not demographics; two comparables actually played, each with an honest failure. |
| Mobile readiness & world legibility | §6, §7 | Every core-loop verb mapped to touch; UI small-screen-first; the biggest performance risk named with a plan. |
| Four-week build & six-week v1 | §9 | The week plan is credible against the declared cuts; three cuts that genuinely hurt, with the twist **not** among them; a risk and its fallback named. |
| Evidence quality & testability | §0, linked artifacts | Links open and match the stated stage; what is untested says so; the cheapest next proof is named. |

**The return area carries the most weight**, and it is the one place where the programme's own move is
explicit: *return for targeted revision when the only theory is "fun" or unspecified future content*.
That is a revision, not a decline — and unproven is not the same as missing. A hook with a real
mechanism behind it and no playtest yet is Clear with a test plan; a hook that is a word is
Follow-up.

Deliver any weak area **as the next step, never as a verdict**. The collaborative register is in
[playbook.md](playbook.md)'s Voice notes — *"that is the question doing its job, not you failing"*.

---

## Probe questions — reuse them verbatim as interview questions

The full set of fourteen, with what good and bad answers sound like, is in the merged
`reviewer-checklist.md`. The ones that earn their keep mid-interview:

1. *"What does the player repeatedly do, how long is one cycle, and why is the 10th repetition still
   fun?"* — good: one verb, 30–90 s, a named variability source. Bad: features, story, "exploring".
2. *"A new player spawns in. What in the first camera frame tells them what to do — without text?"* —
   good: one dominant affordance, or other players visibly mid-loop. A short hint on top of a visible
   cue is fine.
3. *"Decentraland cannot send push notifications. What will a Day-1 player *remember*, or *who* will
   call them back on Day 2?"* — good: "their plot finishes in 20 h", "Sunday reset", "crew race
   Friday". Bad: "the fun".
4. *"What is different for a Day-7 player, and walk me through their session as a scene."* — good:
   named persistent state others can see. Bad: "they have seen more levels".
5. *"How does a player who arrives alone end up interacting with someone — by design, not luck?"*
6. *"If every other player vanished but their traces stayed — what breaks?"* — "nothing", said
   openly, is honest and legitimate: a solo game with social evidence around it. It is only a problem
   when the document claims otherwise.
7. *"What does your world look like at 4 a.m. with two concurrent players?"* — this is what separates
   a social design from a social hope on a low-concurrency platform.
8. *"Name a feature you already rejected because it did not serve a pillar."*
9. *"Which two comparables did you actually play, and what did not fit your audience in each?"*

Careful with these: **the good-answer examples are also the trap.** They come from the reviewer's own
guidance, so recommending one and hearing "yes" scores well while deciding nothing — see rubric
cosplay in [interview-moves.md](interview-moves.md), and the marker rule in SKILL.md hard rule 2.

---

## Calibration

- **Retention numbers.** The programme's figure is the dashboard's **first-week return** — the share
  of eligible new players who come back at least once during days 1–7. The v1 threshold is >10% and
  the programme target >20%, applied only once the view holds at least ten eligible new users with a
  completed window; below that it is *insufficient evidence*, not a fail. **Do not set it against
  external "D7" benchmarks**: mobile-F2P D7 counts players active *on* day 7 and runs mechanically
  lower, so the comparison overstates the bar. The matching class is UGC platforms — D1 > 30% /
  D7 > 15% is roughly where paid discovery starts to pay off, against a developer-forum reality band
  of D1 2–11%. So >20% is **ambitious by platform standards**, neither top-decile nor a formality.
  *(Traced 2026-08-27; provenance in [playbook.md](playbook.md) §4, which is the canon for these
  numbers.)*
- **D1 is bought with fun, D7 with appointments, D30 with friends.** Weak first minutes is a D1
  problem; no hooks is a D7 problem; no social or meta is a D30 problem.
- **Genre pull.** Sims, collection games and social-progression designs reach the target naturally.
  Arcade and one-shot session designs almost never do — push toward a meta layer and social
  obligations, or reset expectations out loud and early.
- **The social ladder is a spectrum, not a gate** — present → recognizable → consequential. A
  well-designed co-presence game is fundable; the top of the ladder is for designs where *these
  particular people* are part of the reason to return.
- **Churn is socially contagious** — groups amplify retention and collapse alike. Prefer small,
  re-formable groups over one large fragile community.
- **Social ties are the strongest late-retention force in the literature.** A document that nails
  social design earns benefit of the doubt elsewhere.
- **Familiar genre plus one twist beats novelty** for inexperienced teams. Do not penalize a
  derivative anchor; penalize a missing twist.
- **Text cannot prove fun.** Anything playable outranks pages of description, and the document's job
  is to answer what a prototype cannot show.

Keeping this file aligned with the merged `reviewer-checklist.md` is a maintenance job for whoever
owns the skill — not a runtime duty of yours, and not something to raise with a creator.
