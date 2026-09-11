# Snow Drift — the plain-English version

*A short read of the current design. If anything reads wrong, tell me — that's what we'll fix.*

---

## What it is

Snow Drift is a shared-world winter survival game for Decentraland. Fires create islands of warmth in a hostile snowscape. Players tend those fires against a storm that grows worse as winter deepens, culminating in the **winter solstice** — the longest, coldest night of the year.

The pitch:

> **Hold the light against the storm.**

---

## How a session actually plays

You spawn near a lit fire. Other players (if any are online) are near it too. Above your view: a day counter, the current season, and a countdown to nightfall.

You grab a torch and step out. Its warmth **melts the snow beneath you as you walk** — and under the snow, you can see wood chunks starting to glow. You pick up a log. You bring it back to a fire. The fire's fuel refills. Its warmth radius grows.

That's the whole verb: **warm the ground to see what's there, bring it back, feed a fire.**

There may be multiple fires across the map. Each has to be individually tended. If a fire's fuel hits zero, it enters a **sleeping ember** state for 60 seconds — anyone with a lit torch can relight it in that window. If nobody does, the fire dies, and its territory refreezes.

When night falls, cold accelerates and snow regrows faster. Fires drain fuel faster. Players huddle at fires or split up to defend outer ones. If a fire is well-tended, it holds. If not, it dies and its warmth zone is lost.

Seasons progress. **Autumn → early winter → deep winter → solstice approach → winter solstice → thaw → spring → autumn again.** Each season makes the night worse than the one before, up until the solstice, then the storm gradually eases through the recovery seasons.

The **winter solstice** is the peak challenge — a whiteout night, cold at its worst, doubled in length. Survive it with any player alive and any fire lit, and the world enters recovery seasons. Fail with everyone frozen or every fire dead, and the world sits dead until the next player arrives to a "winter reclaimed the village" splash and a fresh start.

---

## Why you'd come back

**Two design decisions still open**, resolved by prototype in Weeks 1–2:

1. **Roguelike or persistent-world calendar?** In the roguelike model, the run is the unit of play — "how deep did we get this run?" — and everything resets on failure. In the persistent-world model, the world has its own calendar that keeps ticking even when the server is empty; visitors drop in and check the season. Both retention hooks work; each has different feel.

2. **Single hearth or multi-fire territory?** Single hearth = defend one central fire, quota is the pressure. Multi-fire = a network of fires with individual tending, territory means access and mobility. The territory model is a stronger fit for the "man vs. storm" pitch but is a larger design surface.

Both decisions get prototyped and locked before Week 3.

Independent of those decisions, there's also a **direction lock** on meta-progression: surviving winter with territory intact should carry *something* forward into the next cycle. The form is TBD (a "Legacy" counter, a well-tended hearth buff, a starter woodpile — pick one small thing), but the intent is that a successful winter matters beyond the current session. Communal only — no personal gear, no returning-veteran advantage.

---

## What's actually shipping in v1 (4 weeks)

- Day/night phase clock with server-time authority
- Seasonal cycle across a full year (winter arc + short recovery arc)
- Sleeping-ember failure model
- Empty-server run/world reset when all fires dead + roster empty for 60 s
- Whichever defense mechanic wins the Week 2 prototype (quota bar OR multi-fire territory + 2 fire archetypes)
- Winter solstice event with warning phase, whiteout weather, and post-solstice recovery arc
- Block redesign + environment-layout tuning
- Multiplayer playtest during Week 3

**Meta-progression carry mechanism:** direction locked, form deferred to Week 4 or v1.1.

Live at `snowdrift.dcl.eth` by Week 4.

---

## Design pillars

- **Man vs. storm, not man vs. mob.** No combat in v1.
- **Fire = safety, distance = stakes.** The emotional center is huddling around light together.
- **Multiplayer scales the design, doesn't gate it.** Solo is barely-viable; groups thrive.
- **Failure is a story, not a game-over screen.** Resets are events in the world's history ("winter reclaimed the village").
- **Players help fires, not hurt them.** No extinguish action, no fuel drain — no grief vectors by construction.

---

## Non-goals (v1)

No combat / mobs, no leaderboards, no permadeath, no tool tiers, no personal gear, no NPCs, no wallet-gated content, no more than 2 fire archetypes if territory wins, no trailer work until Week 4.

---

## What I'm still unsure about (worth talking through)

- **Solo solstice difficulty.** "Any player alive + any fire lit" is the loose success condition, so solo survival is theoretically possible. In practice this needs playtest — if solo is straight-up unwinnable at solstice, the retention math breaks.
- **Retention model choice.** The scheduled-log-in hook of a real-world clock is strong for the CSP pitch; the persistent-world framing is stronger for long-term worldbuilding and DCL-native identity. Playing both in Week 2 will make it obvious.
- **How many fires on the map** if territory wins. Two feels sparse, five feels dense. Number tunes during Week 2 prototype.

---

## Where the plan lives

- **Source of truth for the schedule:** [`../docs/v1-4week-plan.md`](../docs/v1-4week-plan.md)
- **Full submission-ready GDD:** [`gdd.md`](gdd.md)
- **Design decisions log:** [`decisions.md`](decisions.md)
- **Earlier pivot design (partially superseded):** [`../docs/survival-pivot-plan.md`](../docs/survival-pivot-plan.md)
