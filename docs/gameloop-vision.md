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

**12.2.3 Chain-lighting hidden fires.** *(shipped 2026-08-24, see PLAN v2.14)*
Torches have a 40 s burn timer. To light a hidden fire far from the central pit, players have three options:
- **Sprint solo** — barely possible, thrilling, frost closes hard.
- **Relay-light with a partner** — you carry a lit torch, they meet you with an unlit one, torch touches torch (within 2 m, auto-fires), their torch lights with 20 s of fuel (half a full torch), they run the rest.
- **Chain three or more players** across the map for the deepest pits.

Cooperation as *literal transmission of light*. Scales naturally 2 → 5 players (the more of you, the further you can reach). Turns "we lit a hidden fire together" into a genuine collaborative story. Mobile-perfect: walking + zero buttons.

**v1 rule set (locked):** lit torch touches unlit torch = ignition, always. Pure duplication (giver's fuel untouched, no cost, no gate). Receiver gets exactly 20 s regardless of giver's fuel level — half-torch feels weaker than a campfire relight, preserving central-hearth gravity (§4). Both-lit case does nothing (no top-off) so the rule stays legible in one sentence.

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
7. **Axes + tree-chopping as a v2 wood source.** Considered 2026-08-22 as a legibility upgrade ("chop tree → wood" is universally readable in a 3-minute judge session). Rejected for v1 because it fractures the "one verb: melt" thesis (§12.1) that ties wood-gathering to fire-discovery, turns the two-slot hand (§12.2.1) into a three-slot swap-dance, and requires 5+ new systems (chop input, felling anim, stump entities, respawn logic, tool-tier UI). Preserved as a strong v2 pivot for a more classic survival tone — would coexist with a torch, not replace it, and could introduce tool-tier progression that Snow Drift v1 does not currently need.

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

---

## 16. The Pilgrimage Pivot — 2026-08-27

**Status:** design pivot, post-first-playtest. Not yet implemented. Supersedes §5 (hidden fires as the long goal) and §12.1 (wood-gathering as the sole discovery channel) in the specific sense that hidden fires are demoted from the game's headline long-loop to secondary aspirational content; the pilgrimage below becomes the primary mid-length goal. Nothing already shipped is being ripped out — this is a *reframing* of existing systems around a new focal point.

### 16.1 What changed and why

**Playtest finding (2026-08-26):** the game has a legible short loop (feed the fire, ~30 s) and a legible long loop (light all 3 hidden fires, community-scale, multi-hour), but nothing in between. Players finished the short loop in under a minute and had no next thing to aim at. The long loop is invisible in a 3–5 minute judge session and effectively unfindable solo (per §12.1's own admission).

**Diagnosis:** we shipped a hangout without a horizon. Cozy hangouts work when the *vibe* carries them, but a Buildathon judge has a 3-minute attention window that vibe alone can't fill (this was already flagged in PLAN §3-B). We need a clear, per-session goal that a judge can name in one breath and pursue without instruction.

**The pivot in one line:**

> *A distant camp waits at the edge of the world. Reach it before your torch dies — alone by leapfrogging waypoint fires, or with strangers by chain-lighting torches along the way.*

### 16.2 The camp

- **One camp per cycle.** Deterministic position per seed, always on the outskirts of the play area. Direction reshuffles every 24 h at midnight UTC (same cycle rollover as hidden fires).
- **Distance from spawn: ~120 m+.** This sits *beyond* the mobile fog line (fade starts at 76 m, full fog at 100 m). The camp itself is invisible from spawn — but a **tall vertical beacon** (smoke column + light shaft, tuned to poke above the fog envelope) is visible from anywhere on the map. Players walk toward the beacon; the camp resolves out of the mist in the last ~20 m.
- **Why the fog is a feature, not a bug:** the beacon reads as *distant landmark*, the arrival reads as *revelation*. You don't see the camp until you've earned it. The tech constraint becomes atmosphere.
- **The camp is a place, not a win screen.** More established than the central hearth — larger fire, some tents or lanterns, a subtle sense of prior habitation. Players who arrive can stay and hang out; later arrivals see them already warm. It's a *second hangout*, positioned as reward and destination in one.
- **Fallback wayfinding:** if the vertical beacon doesn't read on mobile after real-device testing, add a compass UI arrow (mobile-only, camp-only). Compass is the safety net, not the default — it's the most game-y UI element in an otherwise atmospheric game, and we save it for if we need it.

### 16.3 The route — waypoint fires

A new entity class, distinct from hidden fires (§5). Where hidden fires are scattered and discovered by luck, waypoints are deterministic infrastructure on the direct line to camp.

- **Two waypoint fires per cycle**, roughly at 40 m and 80 m along the direct spawn→camp line (slight jitter for terrain).
- **Visibly unlit at cycle start.** A stone ring / bare pit on the ground, findable when close but not a beacon from distance. Players see the next waypoint only after they've reached the previous one.
- **First pilgrim of the cycle lights them.** Every subsequent pilgrim of that cycle benefits — the waypoints stay lit for the whole 24 h. This creates **cross-time cozy co-op**: someone playing at 06:00 UTC paves the road for someone at 15:00 UTC without ever meeting them. The first arrival of the day is doing something genuinely heroic; the tenth is walking a warm trail.
- **Waypoints act as full warmth stations while lit** — you can refill torch, thaw frost, catch your breath. They are safe spots, not just markers.

### 16.4 Solo vs co-op

**Solo path.** Leapfrog waypoint to waypoint. If waypoints are unlit (first pilgrim), you must light each one on arrival before continuing — this makes the *first* solo pilgrimage of the cycle the hardest possible run of the game. If waypoints are already lit (subsequent pilgrim), you just walk through the warm zones. Chain-lighting between torches is not available to a solo player, so waypoint infrastructure is mandatory.

**Co-op path.** Two or more players can chain-light torches along the route (per shipped §12.2.3 rules — torch touches torch, ignition, receiver gets 20 s). This lets a pair skip waypoints entirely and go directly, or use waypoints as fallback if the relay times out. A group of 3+ can reach the camp in one go with disciplined handoffs.

**Tuning target:** solo trip on lit waypoints ~3–4 min. Solo first-of-day (all waypoints cold) ~6–8 min and genuinely tense. Two-player relay ~2–3 min. This gives a clear mid-loop shape at every party size and every point in the day.

### 16.5 Rewards for arrival

Three rewards, only one of which is mechanical. This ratio is deliberate — mechanical rewards that trivialise the game's own challenge are anti-cozy.

**16.5.1 Snowshoes (mechanical, cycle-scoped).**
Awarded on first arrival at camp each cycle. Faster movement on snow for the rest of the cycle. Not a permanent unlock, not carried across cycles. Legible ("you're faster now"), pro-social (you can support newcomers faster, gather wood faster, help chain-light more efficiently), and doesn't invalidate the pilgrimage itself since you've already done it. If we ship one mechanical item, this is it.

**16.5.2 "XXXX wuz here" sign (persistent-social).**
A wooden sign at the camp lists everyone who has arrived that cycle, in order. The first name of the cycle gets a distinguishing mark ("First to camp — 03:42 UTC"). Persistent for the full cycle, then archived to a rolling `docs/hearthlog` (community lore layer, mirrors §12.3.1 named-fires). Zero balance impact, endless replay hook, coziest possible acknowledgement.

**16.5.3 Daily arrival count (community outcome).**
At the midnight-UTC splash (per §12.3.2), the previous cycle's arrivals are reported alongside fires-alive: *"Yesterday, Snow Drift kept 2 of 3 fires alive for 18 hours. 7 souls reached the camp."* One number, one line. Makes the community feel legible without a leaderboard.

**Cut / deferred rewards.** Explicitly noted so we don't drift back into them:
- **Long-lasting lantern** — considered, cut. Invalidates chain-lighting (the co-op verb §12.5 identifies as the game's heart). If we ever revisit, "torch with 1.5× fuel that still chain-lights" is the only shape that's safe.
- **Voice radio to origin camp** — parked for post-v1. Voice comms, mic permissions, moderation, and the "how does this reach the central camp" plumbing are all a rabbit hole. Kept in vision as post-v1 fantasy only.
- **Additional camps (multi-pilgrimage).** One camp for v1 to concentrate community focus. If the loop works, v1.1 can add 2–3 more camps around the perimeter for choose-your-pilgrimage variety. Do not build ahead of playtest confirmation.

### 16.6 The return trip

Arriving at the camp offers a **one-way "warm wind home" teleport** (or a fade-to-black cut back to the central hearth). Available at any time after arrival, no cost. The pilgrimage is the game; the return is admin. Making players walk back cold with their reward is punitive and cuts against the cozy tone.

Players who *want* to stay at the camp and hang out can do so — the teleport is a button they press when ready, not automatic.

### 16.7 What happens to the central fire

The central fire's role narrows but does not diminish. It is now, explicitly:

1. **The trailhead** — where you start, where you equip a torch, where every pilgrimage begins.
2. **The homebody hangout** — for players who don't want to do the pilgrimage. The feed-fire loop (§4, §6) stays fully intact. Someone can log in, hang out at the central hearth, tend the flame, chat, and never leave. This is a valid and supported way to play.
3. **The fallback warm spot** — if you turn back mid-pilgrimage, the central fire is always there, always at floor level 2 (§4).

**Two audiences, both served.** Adventurers get the pilgrimage; hangout-ers get the hearth. Neither audience is subsidised at the other's expense. The warmth aura between paired players (§12.2.2) is still the game's cozy heartbeat regardless of which mode you're playing.

### 16.8 What happens to hidden fires (§5)

Hidden fires are **demoted from primary long-loop to secondary aspirational content**. They still exist, still reroll each cycle, still contribute warmth when lit, still get named (§12.3.1). But they are no longer the game's headline long goal — the pilgrimage is the mid-loop, and lighting all hidden fires becomes the "and there's more" community stretch for the deepest engaged players.

This is *more* honest to what §12.1 already concluded: hidden fires are unfindable without wayfinding in a 128×128 field, and adding wayfinding felt wrong. Making them aspirational rather than mandatory resolves the tension. Wood-gathering still surfaces them by chance (§12.1 mechanic unchanged) — the difference is that a player who never finds one has not missed the game.

### 16.9 Mobile / perf constraints locked

Numbers to design against:
- **Fog:** fade starts at 76 m, full fog at 100 m. Confirmed on default settings across devices.
- **Camp position:** ~120 m from central hearth. Beyond the fog line by design.
- **Beacon:** must be vertical (tall thin geometry stays visible farther than volume). Smoke column + light shaft. Height tuned so the top is visible from spawn even when the base is invisible.
- **Waypoints:** ~40 m and ~80 m from central hearth, both inside the clear-view envelope.
- **Compass UI:** fallback only, mobile-only, gated on real-device visibility testing.

### 16.10 Open questions for next design pass

Not blocking, but worth resolving before or during implementation:

1. **Beacon tuning.** How tall does the smoke column / light shaft need to be to punch through 100 m fog on a mid-range Android? Requires early real-device test.
2. **Camp visuals.** What does "more established" mean concretely — larger hearth, tents, lanterns, a totem, a partial cabin? Aesthetic pass needed. Should feel like *someone else's camp*, not just a bigger version of the central hearth.
3. **Snowshoes visual + audio.** Do other players see them on your feet? Distinct footstep SFX? Free polish opportunity.
4. **First-arrival recognition scope.** Does the first arrival of the cycle trigger a world-wide cue (aurora flash, distant horn) or is it purely a sign entry? Leaning sign-only for v1 to avoid spam if a cycle sees rapid solo runs, but the aurora-flash version is emotionally stronger if it can be gated correctly.
5. **Camp fire fuel.** Does the camp fire also decay and need feeding, or is it eternal like the central fire's floor? Leaning eternal — arriving at a fire that might be out on arrival is a bad first impression.
6. **Waypoint durability.** Do lit waypoints stay lit for the full 24 h regardless, or can they burn out? Leaning full 24 h — burnable waypoints make the cross-time co-op story (§16.3) fragile.
7. **What if the first pilgrim never comes?** If a cycle sees zero pilgrimages until hour 20, does anything happen? Probably nothing — the game shouldn't nag. But worth naming so it's an intentional non-decision.

### 16.11 Tone check

This pivot is a real tonal shift: cozy hangout → cozy pilgrimage. We're moving from "sit by the fire with strangers" to "there's a place to go." That's a different audience appeal — closer to Journey or A Short Hike than to Cozy Grove.

The mitigation is that the pilgrimage is *available, not mandatory*. Central hearth remains a full hangout. Warmth aura between paired players still gives the "just being here together" mechanic. Someone who wants a chill hangout still has one. Someone who wants a goal now has one.

If real playtest shows the pilgrimage overshadows the hangout — if nobody's staying at the central fire anymore — that's a tuning problem to address then (make the pilgrimage longer, rarer, harder to start), not a reason to walk back the pivot.

