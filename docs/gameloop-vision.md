# Snow Drift — Gameloop Vision

**Status:** design snapshot, pre-first-playtest. 24 h reset implemented + smoke-tested (2026-08-20).
**Author:** ile
**Date:** 2026-08-20
**Scope:** the core "wrap the loop" gameplay design. Complements `docs/PLAN.md` (competition build plan) by describing what the game IS once the vertical slice is stable.

This is a locked design snapshot from a brainstorm session, captured before implementing the 24 h regeneration cycle and before the first public playtest. Deferred items are called out; nothing here is final until playtest data comes back.

---

## 1. Core loop, one paragraph

*A frozen world with one persistent central campfire. New players walk from the fire out into the snow to a nearby island, pick up a torch, and carry it back to warm the world. The central fire has four heat levels and never falls below level 2, so the hangout is always livable. Every 24 hours the world regenerates — hidden bonfires move, snow returns, trees and cliffs shift — inviting players back to explore a fresh layout. Long-term, the game is about tending fires: keeping the central one healthy, discovering and lighting hidden ones, and maintaining warmth as a community.*

---

## 2. What's permanent vs. what regenerates

### Persistent (world identity — never regenerates)
- **Central campfire** — same world coordinates forever. This is home base.
- **Baseline warmth** — central fire is ALWAYS at level 2 minimum, so a solo player joining a dead server still lands in a livable world.
- **Player identity + long-term stats** *(if we ever add them)* — not touched by cycle roll.

### Regenerates per 24 h cycle (midnight UTC)
- **Hidden bonfire positions** — 3 pits, deterministic per seed, mutually separated
- **Torch island position** — deterministic per cycle, same island for every player in that window (becomes a named landmark: "the torch island is west today")
- **Tree / prop layout** — via existing SeedHolder → setupProps pipeline
- **Cliff layout** — recomputed each cycle
- **Snow / paint state** — reset to virgin. Prevents the world from becoming "ancient graffiti."
- **Hidden fire lit-state** — resets to all-unlit; the hunt begins again.

### Timing note
Boundary is midnight UTC because that's where the cycle bucket math lands cleanly (Unix epoch is midnight UTC). This favors European/African timezones over American ones; may want to revisit or lean on "all lit → early reset" (see §7) if that skew hurts US-heavy sessions.

---

## 3. The torch quest (mandatory on every join)

Purpose: onboarding ritual, bot friction gate, veteran comfort routine.

- **Every join, every player** must fetch a torch from the torch island before doing anything else meaningful.
- **Island is always within slow walking distance** of the central fire (deterministic per cycle so groups all see the same landmark).
- **Unlimited torch supply** on the island — once a player has one, the island shows no torch for them, but other players still see their own.
- **Losing your torch on death** requires a return trip to the island. Real death consequence without permadeath sting.
- Duration: ~60–90 seconds. Long enough to teach frost + torch mechanics on first join; short enough that returning players don't chafe.

### Why this works
- Teaches walking-in-snow (frost), torch pickup, and "fire is the goal" without a single UI hint.
- Bots CAN walk, but the ritual has enough steps + variability that it raises the bar.
- For veterans, it's a familiar coffee-and-newspaper opener before real play.

---

## 4. The central fire (the hangout heartbeat)

- **Four heat levels**: 1, 2, 3, 4.
- **Floor: 2.** Fire never decays below level 2. World is always livable.
- **Ceiling: 4** for now. Coupling with hidden fires (each lit hidden fire raises the central ceiling) is **parked for later** as a stage-3 escalation.
- **Decay: time-based only.** No player interaction penalty.
- **Fuel: wood chunks** found under the snow. Players scan for wood using their torch's melt radius (piggybacks on the existing paint-melt system — search becomes exploration, not lottery).

### Level → world feel (targets, tune during playtest)
- **Level 1** = torch's own heat radius (this is the design unit for scaling everything else)
- **Level 2** = current melt radius, minimum livable. Chilly but okay.
- **Level 3** = comfortable hangout. Frost decays quickly inside.
- **Level 4** = full warmth. Widest melt radius, brightest ambient audio. **The delta from 2 → 4 must be palpable** or nobody will bother feeding it.

### Meter
Numeric readout ("3/4") visible somewhere subtle. Ideally the *flame size + smoke density* communicates the level from 50m away, and the numeric is HUD backup — not the primary read.

---

## 5. Hidden bonfires (the discovery / adventure layer)

- **Three per cycle.** Deterministic positions from the current seed, mutually separated so their melt rings don't overlap.
- **Currently marked with a gold beacon pillar** for playtest visibility. **Beacons are DEV-ONLY** and will be removed at deploy pending playtest feedback on whether unmarked fires are:
  - a fun exploration challenge → beacons stay off, discovery becomes the game
  - too frustrating to find → some wayfinding replacement (distant smoke plume, ambient audio cue, compass hint)
- **Ignition**: carry a lit torch inside the ignite radius, press E.
- **Can burn out** if not maintained — the central fire never dies, but hidden fires are ephemeral commitments.
- **Once lit**, contribute warmth (frost thawing) equivalent to the central fire.

### Long-term goal
Hidden fires become a *maintenance* game once the discovery loop stabilizes — the game becomes "how many fires can the community keep alive at once." Fits the cozy-multiplayer emergent-cooperation tone.

---

## 6. Wood, warmth, and the fueling loop

- **Wood chunks** hidden under the snow — invisible until the torch's melt radius clears the snow above them.
- **Discovery is passive teaching**: player sees wood → intuits "maybe this feeds the fire."
- **Placement**: TBD. Likely coupled to tree positions so wood spawns where the world says trees have shed branches. Regenerates each cycle with the tree layout.
- **Respawn during a cycle**: TBD — playtest will show whether players deplete the field faster than fires consume it.

---

## 7. 24 h reset — the loop-closing piece

**Status: implemented.** The world regenerates every 24 h at midnight UTC. What rolls, and how:

- **Hidden fire positions** reroll (server picks fresh seed → `pickHiddenCampfireTiles(seed)`).
- **Hidden fire lit-state** → all false, fresh `hiddenCampfireState` broadcast per index.
- **Snow / paint canvas** returns to virgin (`clearPaintState()`), central campfire's melt ring is reseeded (`seedStartingArea()`).
- **Trees, props, cliffs, maze** reshuffle via a derived `SeedHolder` value that the existing client-side seed watcher already reacts to.
- **Central campfire** entity + position: **unchanged** (persistent identity).
- **Torch island**: not yet built; will regenerate per cycle when it lands.

### Where the code lives
- `src/server/cycle.ts` — authoritative clock, `rollCycle()`, subscriber registry (`onCycleRoll`), boundary-detection tick.
- `src/server/hiddenCampfire.ts` — subscribes to `onCycleRoll`; resets `lit[]`, recomputes positions, rebroadcasts state per index.
- `src/server/server.ts` — subscribes to `onCycleRoll`; runs `clearPaintState()` + `seedStartingArea()`.
- `src/client/cycle.ts` — receives `cycleState`, mirrors seed + `nextRebuildEpochMs`, dispatches to subsystem handlers, publishes derived `SeedHolder` for maze/props/cliffs regen, orchestrates splash + teleport UX.
- `src/client/hiddenCampfire.ts` — subscribes to `onCycleSeedChange`; tears down flame/smoke/audio, moves pit entities, respawns beacons.
- `src/client/ui/layers/layer.loadingSplash.tsx` — `showRebuildSplash(ms)` API; splash stays visible for the greater of the requested duration OR while `isRebuilding()` is true.

### Client UX at rollover
1. Server broadcasts new `cycleState`.
2. Client shows loading splash (6 s minimum, extends until maze cascade finishes).
3. Player teleported to campfire spawn pad.
4. Maze / cliffs / props reshuffle under the splash.
5. Hidden fires relocated, beacons respawn.
6. Splash clears; player sees the new world.

### Dev-testing shortcut (currently disabled)
`devFlags.SHOW_DEV_ROLL_BUTTON` — when true, a `⇆` button appears in the top-centre HUD cluster. Runs the local rebuild UX immediately AND sends `devRollCycle` to the server (which runs the real reset). Flip to true, save, hot-reload to smoke-test without waiting for midnight UTC. Currently `false` for playtest.

### "All lit → early reset" (deferred, but likely valuable)
If all three hidden fires are lit before the 24 h boundary, consider rolling the cycle early (with a brief celebration moment) so the loop stays tight during active-player windows. Not building this yet — playtest will show whether the loop is even paced for it to matter.

---

## 8. Emotional / audio-visual punctuation (deferred)

These aren't in the first playtest but are logged for later:

- **4/4 celebration**: when the central fire reaches full, brief particle burst, melt radius pushes outward, ambient music swells for ~10s. Makes teamwork feel rewarded.
- **All-lit celebration**: when all three hidden fires are lit simultaneously, world-scale moment — aurora across the sky, snowfall pauses, distant howl. Punctuates the cooperative accomplishment.
- **Hidden fire lit / burn-out audio**: a distinct cue so players elsewhere in the world know something happened.

---

## 9. What we're NOT deciding now

Explicitly parked, in rough priority for the next design pass:

1. **Coupling** — do lit hidden fires raise the central fire's ceiling? (Leaning yes, defer.)
2. **Points / warmth meter / leaderboard tone** — if we add any scoring, it should be shared-pool warmth rather than personal leaderboard (keeps the cozy tone).
3. **Wayfinding without beacons** — smoke plume visible from far, ambient crackle, compass, or nothing at all.
4. **Wood respawn cadence.**
5. **Central fire ceiling escalation** past 4/4 as multi-fire stage kicks in.
6. **"Named fires"** — each fire gains a name when first lit that cycle; players build a personal hearth log over time.

---

## 10. First playtest — what we're testing

The first public playtest is NOT a test of the full loop above. It's a test of the vertical slice we already have. Success criteria:

1. **Core mechanics work** — frost accumulates, torch lights, campfire warms, painting/melting reads correctly.
2. **LOD / performance** — the scene runs smoothly for other users on other machines. Not laggy or buggy.
3. **UI is intuitive** — HUD buttons (clock, help, spectator, mute, torch) discoverable and understandable without instruction.

Data gathered here determines:
- Whether to keep the beacon system on or ship without it
- Whether the multi-fire hunt reads as fun or frustrating
- Whether the current pacing is right for adding the reset cycle on top

**Post-greenlight**, next step is a deeper design pass on the campfire gameplay loop (fueling, wood, decay tuning, celebration moments). 24 h reset is already in place.

---

## 11. Non-goals for this design

To keep the vision honest:

- **Not a survival grind.** Nobody dies from AFK. Central fire's floor guarantees a safe hangout.
- **Not competitive.** No PvP, no leaderboard combat. Warmth is shared, not fought over.
- **Not a puzzle game.** Discovery is the reward, but the mechanics are straightforward.
- **Not a solo game.** Solo is peaceful and possible, but the loop *sings* with 2–5 players cooperating.
