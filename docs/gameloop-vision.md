# Snow Drift — Gameloop Vision

**Status:** design snapshot, pre-first-playtest. 24 h reset implemented + smoke-tested (2026-08-20). Cooperative + replayability design pass appended 2026-08-21 (see §12).
**Author:** ile
**Date:** 2026-08-20 (updated 2026-08-21)
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

### Discovery model — reframed 2026-08-21
The beacon-vs-wayfinding debate is resolved: **no explicit wayfinding cue**. Hidden fires are discovered *only* by stumbling on a pit while gathering wood, since both wood and pits are surfaced by the same torch-melt action. Wood-hunting IS fire-hunting without the player experiencing it as a hunt. This reframes hidden fires from mandatory content into aspirational content — a bonus outcome of playing the base loop, not a task. The current gold beacons stay dev-only and are removed at deploy. Full rationale in §12.1.

---

## 6. Wood, warmth, and the fueling loop

- **Wood chunks** hidden under the snow — invisible until the torch's melt radius clears the snow above them.
- **Discovery is passive teaching**: player sees wood → intuits "maybe this feeds the fire."
- **Placement**: TBD. Likely coupled to tree positions so wood spawns where the world says trees have shed branches. Regenerates each cycle with the tree layout.
- **Respawn during a cycle**: TBD — playtest will show whether players deplete the field faster than fires consume it.

### Scatter tuning (added 2026-08-21)
Wood **cannot cluster near the central fire** or players never wander far enough to stumble on hidden pits (§5, §12.1). Wood should be sparse but map-wide, with richer caches deep in the field to pull players into expedition mode. Tuning target: an average solo session should walk 40–80 m from the central fire.

### Stone ring memory signal (added 2026-08-21)
Once discovered, a hidden pit displays a shallow stone ring even when unlit. Visible only within ~10 m — enough for a returning player to spot it while passing, invisible from any distance that would give the position away. Doubles as a subtle "someone found this" community trace. Alternatives considered and rejected: persistent scorched patch (gives too much away from distance), nothing at all (harsh — a stumbled-on pit you can't relocate is a discovery wasted).

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

## 12. Design additions — 2026-08-21 brainstorm

A design session covering hidden-fire discoverability, the cooperative pillar, and replayability hooks. Nothing here is built yet. Priority-ordered.

### 12.1 Hidden fires — wood-gathering as the discovery channel

**Problem observed in the first small-group playtest:** hidden fires are effectively unfindable in a 128×128 field without wayfinding cues. Every explicit cue tested in brainstorm (smoke plume, compass, directional wisp from central fire) either gave the position away outright, was mobile-hostile due to render distance, or felt UI-gamey against the cozy tone.

**Resolution:** wood-gathering IS fire-discovery. Both are surfaced by torch-melt. Players don't hunt fires — they gather wood and get lucky.

**Consequences:**
- No beacons at deploy. Gold beacons remain dev-only (§5).
- Wood scatter must be map-wide, not clustered near center (§6).
- Discovered pits get a proximity-only stone ring (§6).
- The 24 h reset (§7) becomes emotionally stronger: it wipes the informal map players were building. That tension — *the world remembers* (persistent central fire) vs. *the world forgets* (daily reroll) — is the core cozy-game beat.
- Buildathon judges playing 3–5 min almost certainly won't find a hidden fire. **The central-fire loop must fully carry the demo on its own**; hidden fires are the "and there's more" hook for the trailer, not something the judge experiences firsthand. Healthy constraint: if the base hangout isn't fun without the discovery layer, the discovery layer was masking a problem.

### 12.2 Cooperative pillar — the mechanics

The buildathon rewards social gameplay, interpreted as *cooperative* (not competitive) to preserve the cozy tone. Five mechanics; the first three together are the headline pitch — see §12.5.

**12.2.1 Torch cannot be dropped — only handed off or extinguished.**
Leading co-op mechanic candidate from PLAN §3-B1. Solo: to pick up wood you must extinguish the torch and walk back cold. Paired: the torch is immortal — one player holds it forever, hands it off when needed. The handoff itself is the game's ritual moment: two players meeting, one glowing object passing between them. Zero new systems, one rule change, biggest single social payoff. Legible in the first 90 s of play.

**12.2.2 Contagious warmth with a *visible* glow between paired players.**
Contagious warmth is already in the vision (§4 implicit, PLAN §3-B2 explicit). The visual has never been specced. Design target: when two players stand within ~3 m, both frost meters slow visibly AND a soft warm shimmer / light-strand connects them — as if their auras are holding hands. The *cozy payoff*: not just "less cold" but "you are warmer *because* they are here." Also the game's screenshot / marketing moment.

**12.2.3 Chain-lighting hidden fires.**
Torches have a ~90 s burn timer. To light a hidden fire far from the central pit, players have three options:
- **Sprint solo** — barely possible, thrilling, frost closes hard.
- **Relay-light with a partner** — you carry a lit torch halfway, they meet you with an unlit one, torch touches torch, they run the rest.
- **Chain three or more players** across the map for the deepest pits.

Cooperation as *literal transmission of light*. Scales naturally 2 → 5 players (the more of you, the further you can reach). Turns "we lit a hidden fire together" into a genuine collaborative story. Mobile-perfect: walking + one button.

**12.2.4 Fire tending gives a small aura buff.**
Single tap on the central fire = a 30 s warmth-regen boost for anyone within 8 m. Creates a natural "you go, I'll stay and stoke" role split without mandating it. Pairs organically divide: one adventurer, one hearth-keeper.

**12.2.5 Shared visible hearth level.**
The 4-tier flame (§4) already scales with fuel. Extend: recent-nearby-players also contribute. When 3+ people are near the central fire, the flame is visibly larger and the warm radius pushes wider — everyone benefits. Solo sees a modest fire; a group sees a bonfire. Positive-sum social "score" with no leaderboard.

### 12.3 Replayability hooks

**12.3.1 Named fires + community hearth log.**
When a player first lights a hidden fire in a cycle, a one-time prompt to name it. The name is visible on the fire for the whole cycle and appended to a persistent world hearth log ("Ile's Fire, first lit 2026-08-21, kept alive for 4:22"). No stats, no leaderboard, no XP — just a record of the world's small events. The coziest form of progression: your fingerprints stay on the world. Discord will feed on this naturally.

**12.3.2 Daily community outcome.**
At midnight UTC rollover, the loading splash flashes the previous cycle's result: "Yesterday, Snow Drift kept 2 of 3 fires alive for 18 hours." One line, one number. Makes every day feel like it mattered even if you weren't there. Stretch: if the community lit all 3 fires within a cycle, the next-day sky carries a subtle aurora — silent reward, community lore.

**12.3.3 Rollover as a shared vulnerability moment.**
The 24 h reset is currently a splash + teleport (§7). Elevate it: every player online sees the same slow fade, the same short pause, a single line ("A new day begins in Snow Drift"), and then the new world. Two strangers online at midnight UTC now share a moment they didn't plan. Small production cost, high memory value.

### 12.4 Mobile-friendly protections

Constraints these designs must respect:
- **Every co-op interaction is a single tap.** Torch handoff = walk up + tap. Fire poke = tap. Wood pickup = tap. No aim, no chords.
- **Passive contribution counts.** Standing near the central fire boosts hearth level even AFK. Cozy games reward *being there*, not skill.
- **Sessions of 3 min feel complete.** Core loop must satisfy without the discovery layer — one warm-up, one wood run, one handoff, done.
- **The warmth aura between paired players is the marketing shot.** Make it beautiful.

### 12.5 Headline pitch (three-mechanic coherence)

**Torch-can't-be-dropped + chain-lighting + visible warm aura between paired players.**

These three together tell one story: *this is a game where light passes between people.* That's a pitch. That's a trailer beat. That's what judges will remember. Everything else in §12.2–12.3 supports it.

---

## 13. What we're NOT deciding now

Explicitly parked, in rough priority for the next design pass:

1. **Coupling** — do lit hidden fires raise the central fire's ceiling? (Leaning yes, defer.)
2. **Points / warmth meter / leaderboard tone** — if we add any scoring, it should be shared-pool warmth rather than personal leaderboard (keeps the cozy tone).
3. **Wayfinding without beacons** — smoke plume visible from far, ambient crackle, compass, or nothing at all.
4. **Wood respawn cadence.**
5. **Central fire ceiling escalation** past 4/4 as multi-fire stage kicks in.
6. **"Named fires"** — each fire gains a name when first lit that cycle; players build a personal hearth log over time.

---

## 14. First playtest — what we're testing

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

## 15. Non-goals for this design

To keep the vision honest:

- **Not a survival grind.** Nobody dies from AFK. Central fire's floor guarantees a safe hangout.
- **Not competitive.** No PvP, no leaderboard combat. Warmth is shared, not fought over.
- **Not a puzzle game.** Discovery is the reward, but the mechanics are straightforward.
- **Not a solo game.** Solo is peaceful and possible, but the loop *sings* with 2–5 players cooperating.
