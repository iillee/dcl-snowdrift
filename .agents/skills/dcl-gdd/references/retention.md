# Retention — The Section Graded Double

Load this **before** the §4 step opens, so the first question already carries a benchmark and a
pattern. Note the template's fill order inside §4: the two hooks (4.3) are chosen first, then the
D1 sentence (4.1) points at one of them, then the progression chain (4.2).

## The platform fact everything follows from

**Decentraland cannot send push notifications.** Nothing will remind a player this experience exists.
The template says it as *"Events and Community channels can remind players, but don't rely on
reminders alone"* — so the reason to return must live in exactly one of two places:

1. **the player's own memory** — "my crop is ready at 6pm", "the league resets Sunday";
2. **their friends** — "my crew races every Friday".

Any third answer is a wish. Run the no-push test over every hook: assume no reminder ever fires. What
survives is a hook — and the template's hook table demands exactly this, as the *"reminder channel +
no-reminder fallback"* column.

## The three-horizon model

The template's own frame: **first session is bought with fun, next-day with an appointment, long-term
with friends.** This maps weaknesses to fixes with no guesswork:

| Symptom | Real problem | Where to fix it |
|---|---|---|
| Players do not finish session one | D1 — the experience is not fun *yet* | §2 first minutes, §3 loop |
| They enjoy it and never come back | D7 — nothing is scheduled | §4.3 hooks |
| They return for a fortnight then drift | D30 — no people, no meta | §5 social, §4.2 week-3+ goal |

**Benchmarks, so nobody promises 40%** *(traced 2026-08-27; full provenance in
[playbook.md](playbook.md) §4).* The program's numbers are the dashboard's **first-week return**
(dashboard D7): the share of new players who come back *at least once* during days 1–7. The v1 floor
is >10%, the program-level target >20%. Two cautions before quoting anything at an owner. It is a
**cumulative week** measure, so it does not compare with mobile-F2P "D7 retention", which counts
players active *on* day 7 and runs mechanically lower. And the matching comparison class is UGC
platforms, not mobile F2P: **D1 > 30% / D7 > 15%** is where paid discovery starts to make sense, and
D7 ≥ 15% predicts CCU growth (Roblox culture), against a devforum reality band of D1 2–11%. So >20%
is **ambitious by platform standards** — neither top-decile nor a formality. Sims, collection games
and social-progression
designs have natural pull toward it; arcade one-shot session games almost never get there. If the
design is the latter, say so early and push toward a meta layer plus social obligations rather than
letting the number sit unchallenged.

## 4.3 — The hooks, with what each one actually costs

**Exactly two**, each explained *as it works in this experience*, and at least one must create a
concrete next-day (D1) reason. Naming them is worth nothing — the reviewer reads integration, and the
template's table forces it: exact trigger or timing, what the player anticipates, reminder channel
plus no-reminder fallback. The menu below mirrors the template's (which the owner deletes before
submitting); own inventions are welcome.

| Hook | Why it works with no push | What it demands from the design | How it fails |
|---|---|---|---|
| **Appointment timer** — something finishes, respawns or unlocks at a known future time | The player's memory is the notification | Persistent state per player; a readable countdown; the timer must gate something they *want* | Waiting becomes the gameplay — the loop turned out to be a timer, which fails the core-game preflight (P1). The timer must shorten a future session, never fill the current one |
| **Daily goals + streak** — rotating tasks, escalating reward track | Loss aversion is the strongest short-horizon force | Enough loop variety that a rotation is not arbitrary; milestone recovery, never a punishing reset to zero | Retention theatre: dailies bolted onto an experience nobody opens daily. Match the cadence to the real session rhythm |
| **Weekly leaderboard reset / small leagues** — rank inside small groups, fresh weekly | Near-zero content cost, automatic weekly event, the deadline drives a surge | A comparable score; group sizes small enough that mid-table players can still move | One global board — the top ten own it and everyone else stops looking. Small leagues, always |
| **Named rival** — a specific player to beat, who learns who beat them back | A specific person turns a score into a relationship: "Marta beat your 47.2" is a return reason no anonymous board gives | The score must be attributable and the beaten player must find out; needs enough overlap for rematches | An anonymous leaderboard wearing a rival's name — if the beaten player never learns, no relationship forms |
| **Collection** — visible x/N toward a displayable reward | An unfinished set feels unfinished; evergreen once shipped | N items that are cheap to author and visibly different; the reward must be *displayable*; define what happens when the set completes | A grind disguised as a set. If item 14 of 20 takes ten hours, the set is a wall |
| **Recurring scheduled event** — e.g. every Friday 20:00 UTC | The fixed time itself is the return reason; the Event listing and a community channel only remind | One reusable template, automated; someone has to actually show up to run it week after week | A different bespoke event every week from a two-person team. Documented burnout trap |
| **Team / crew obligation** — small persistent groups with shared goals | "My crew expects me" is the strongest known retention force | A grouping mechanic, a shared goal, and something a group can lose by not showing | Churn is contagious — one big fragile community collapses at once. Small, re-formable groups |
| **Season track** — a free time-limited progress track, 6–8 weeks, running live after launch | A deadline plus a comeback moment at each new season | Enough progression breadth to fill a season; alignment with the program's own cycles; latecomers stay useful | Season one is authored lovingly, season two never ships |
| **Async traces** — things players leave behind for others to find | The world feels alive at quiet hours, at zero ongoing cost | Persistence and a place to put traces; traces must be legible without explanation; account for storage, moderation, expiry | Traces nobody notices. They have to be on the path the loop already walks |

**Choosing well.** Pick hooks whose rhythm matches the measured session rhythm from §3 — a 60-second
loop with a 20-minute session supports a weekly league and a collection; it does not support three
daily quest chains. Prefer hooks that reuse the loop already designed over hooks that add a system.
Cheap and automatic beats rich and manual, every time, for a team this size.

## 4.1 — The next-day (D1) sentence

*"A player who enjoyed their first session returns the next day (D1) because [Hook 1 or 2] ___ at
___."*

Filled after the hooks, and it must **point at one of the two chosen hooks** with its exact trigger
or timing. "Because it's fun" and "because there's more content" both fail for the same reason:
content is consumed once, and fun is what bought the first session, not the second. An appointment is
a different kind of object — it exists in the player's calendar, not in the build.

Good answers name a *when*: "their plot finishes in 20 hours", "the league resets Sunday 00:00 UTC",
"their crew races Friday at 20:00".

## 4.2 — The progression chain

The template's frame: **repeatable action → persistent reward → new capability, status, or social
role → new decision or challenge.** A larger number alone does not count. Three rows, each answering
what persists, what becomes possible next, and — the multiplier — **how another player can tell**:

- **End of first session.** Something must already persist, or the natural stopping point in §2 has
  nothing to show.
- **End of first week.** Demand persistent state with a name: a rank, a collection at 7/20, a crew,
  an upgraded thing, a cosmetic other players can see. "They have seen more levels" means the design
  churns by default — every player is on a conveyor toward the end of the content. Then the
  template's scene check: the end of the first week as 3–4 second-person sentences — if it reads the
  same as the first session, the section is not done.
- **Week 3+ — what takes more than two weeks?** The long-term goal, and the load-bearing half is
  that other players can *see* progress toward it. Ask specifically: at what moment does a stranger
  notice? If the answer needs an inspect screen, it is invisible. An invisible XP number motivates
  nobody in a social world; a wearable, a title or a spot on a board does the motivating for free,
  and doubles as marketing to everyone who sees it.

If the game has currency or tradable rewards, the template wants one line: how they are earned, how
they are spent or removed, and the main abuse risk.

## What this section always parks

Every hook is a hypothesis about human behaviour, and their test costs differ by an order of
magnitude. Park each as its own row, ordered by cheapest killing test:

- appointment and timer lengths → arithmetic on paper, sometimes before any build;
- collection pacing and season length → a spreadsheet, then a session;
- "the crew obligation actually forms" → needs real people in a live World; the most expensive claim
  in the section, and the one most often assumed.

Do not let §4 close with both hooks resting at "obviously true". The D1 sentence itself is a
hypothesis until a live World says otherwise.
