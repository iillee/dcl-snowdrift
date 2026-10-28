# Cryocene

*Title locked 2026-09-23 (pivoted from **Snow Drift** — IP conflict). Repo, package name, deploy URL (`snowdrift.dcl.eth`), and CRDT component IDs still use `snowdrift` — these are infrastructure identifiers that would break live state or require a new DCL NAME migration to change. All user-facing surfaces (scene title, splash, Discord notifications, docs) now say Cryocene.*

A persistent shared-world winter survival roguelike for Decentraland, set on Earth at the edge of the Cryogenian freeze.

> **Hold the light against the storm.**

Cryocene is a co-op survival scene where fires are islands of warmth in a hostile snowscape. Days are for gathering wood and expanding a network of lit fires. Nights are for defending them — the cold bites, fuel drains faster, snow reclaims territory. Seasons, culminating in a **winter solstice**, are the v1 target and are not in the playtest build. A full frost bar freezes you in the ice. Another player can thaw you with a lit torch. The run ends when everyone still connected is frozen and no fire is left to recover them. A player who is still moving can relight and save the group. Empty-server persistence is still unbuilt. While a server is up, leaving and coming back returns you to the world in progress. A new server start, and every regen, draws a fresh seed.

**Deploy target:** [`snowdrift.dcl.eth`](https://play.decentraland.org/?realm=snowdrift.dcl.eth) (Decentraland World)
**Runtime:** SDK7 (`@dcl/sdk` 7.26.x, pinned exact) with authoritative headless server
**Scene (playtest):** profile **`playtest_52`** - **52 x 52 parcels** (832 m, 0 pad; `scene.json` has 2704 parcels). `full_100` (100 x 100, 16 m pad) is kept as an alternate. **`compact_3`** (3 monuments, no volcano, 34 x 34 parcel playfield inside the same 52 x 52 scene, own leaderboard) is the 15-player playtest profile: flip `WORLD_PROFILE` in `src/shared/settings.ts`, nothing else; see the end of [`docs/HANDOFF.md`](docs/HANDOFF.md). Portrait-friendly mobile-first UI. **Known blocker (H1-07):** mobile Explorer reported only **51 x 51** parcels for the 100 x 100 World (not re-tested at 52 x 52) - see [`design/session-2026-10-05.md`](design/session-2026-10-05.md).

---

## Status

**Current build (2026-10-28, branch `floating-crystals`, `f22ee9e`): the *floating-crystals* ruleset** (`RULESET` in `src/shared/ruleset.ts`). Full change log, constants, tests and known issues: [`docs/HANDOFF.md`](docs/HANDOFF.md).

The loop: wake at the permanent hearth -> light a torch -> gather **logs** (the only wood) -> **build your own fires** with a log and a lit torch -> fires within 140 m link into a network -> fires within 40 m of one of the **6 monuments** charge it -> a full charge releases the monument (rise, sky beam, 2 s charge, burst) and melts a 50 m heat zone plus an **oasis** that regrows grass, bushes, rocks and pines -> releasing the last monument starts the **"THE WORLD BEGINS TO THAW"** ending (all beams link the monument tips at once, then every monument releases a pulse that thaws a much larger area) -> play continues. A fire that runs out turns to ash and vanishes; it cannot be relit, so a new fire always costs a log.

**In the current build**

- **Building fires:** carry a log with a lit torch, press E (or the torch button) away from other fires. The avatar plays a squat-and-strike emote (2.6 s, movement locked); the fire appears 1.2 m ahead. Min 18 m from any burning fire, max 40 burning built fires, no steep, deep-snow, lava or monument spots.
- **Spent fires:** a fire that runs out of fuel turns to cold ash (no logs, no relight, no feed), disappears after 60 s and drops its network links. Ash never blocks building or counts toward the cap. The hearth is exempt (a lit torch can still spark a dead hearth to Ember).
- **Wood:** logs only (120 s of fuel each). Branches / sticks are gone. Logs come from choppable trees and loose logs in the snow, with six extra loose logs near every monument.
- **Fire network:** dense topology (every pair within 140 m links except near-duplicates), per-monument trees plus **cluster links** between the fires feeding a monument, link ends ~0.3 m from the obelisk, orb trails, shared fuel (50 % stays, rest to the hungriest fire within 2 hops).
- **Monuments:** 6 per world, charged by linked fires (full charge in about a minute with 3 fires at 20 m; `CHARGE_TARGET_S = 60` is a playtest value). Near-spawn monument ~41 m from the hearth. Release: hold 2 s, rise 4 s, sky beam, 2 s charge, burst. Letterboxed cinematic (FOV 60) for viewers who can watch. Sounds: `monument.mp3` at rise start, looping `crystal.mp3` from the beam hit, quiet burst cue, and a charging `hum.mp3` that fades with distance from the monument only.
- **Oasis:** the 12 m centre melts instantly, the rest melts outward over 60 s to a ragged ~32 m clearing across every terrace and wall top in reach; bare earth (0.27 m lower), then grass, bushes, rocks and pines (pine trunks and rocks are solid). Synced from the server release age, so late joiners see the same state.
- **Ending ("THE WORLD BEGINS TO THAW"):** 14.5 s after the last release (6th, or 3rd in the compact profile), all beams link the monument tips in a closed ring at the same time, then every monument releases a synchronized pulse: the snow, ground and vegetation around each monument thaw out to ~64 m (the first oasis is 32 m). The snow melts in ~12 s, the permafrost cap and plants open gradually over ~60 s, and each monument's warm area grows with the snow. A high cinematic frames the whole ring, the title shows, and play carries on. About a minute later the Help panel (key 4) offers **BEGIN NEW EXPEDITION**: any player can start a shared 3-minute countdown (only the starter can cancel it) that ends in a fresh world on Day 1. No new winter starts automatically (see below).
- **Leaderboard:** star button / key 3, four tabs: Longest, Fastest, Monuments, **Biggest Firenet**. Dev-shortcut runs are tainted and not recorded.
- **Also:** Dawn / Day / Dusk / Night, frost bar, freeze in ice and torch thaw, run-end cards (only when no campfire and no torch is lit for 4 s) and fresh seed, Day N, flame variety per fire, desktop zoom steps 7 / 29 / 60 / 84 / 118 (mobile 5 / 15 / 25), isometric overview camera, server-restart resync, invisible perimeter wall, summit tablet map.

**Not in this build:** seasons, solstice, sleeping-ember, empty-server persistence, return screens, pine fuel, kiln, a communal wood pile, an automatic new winter after the ending. The classic volcano flow (ignite 3 monuments with E, volcano beams, 45 s thaw wave, "WORLD THAWED", "Winter Approaches" countdown) is still in the code behind `RULESET = 'classic'` / `'build-your-own-fire'` but is **not active** in this ruleset. Hidden campfires and torch relighting of spent fires are gone. Geography destinations for migration (Oct 7 checkpoint) are not built.

Full vision [`design/gdd.md`](design/gdd.md) (long-term spec; the status header says where it lags the build). The major v1 design decisions are locked (see [`design/gdd.md`](design/gdd.md) \S0.1):

- **Retention model** - persistent shared-world survival roguelike.
- **Defense mechanic** - multi-fire territory. The run ends when no campfire and no torch is lit. Oldest-fire-becomes-home is still planned.
- **Cabin discovery** - Charcoal Kiln (portability logistics), not built.

## Design documentation

- [`docs/HANDOFF.md`](docs/HANDOFF.md) - current handoff: what changed since `520cc6b`, constants, files, how to test, known issues. **Start here.**
- [`design/decisions.md`](design/decisions.md) - running log of design decisions and rationale (newest first).
- [`design/gdd.md`](design/gdd.md) - full GDD (long-term vision; sections written before 2026-10-27 describe earlier rulesets).
- [`design/summary.md`](design/summary.md) - plain-English overview.
- [`design/ideas.md`](design/ideas.md) - parked ideas.
- [`design/hypothesis-log.md`](design/hypothesis-log.md) - hypotheses (`H1-xx`) referenced from the GDD.
- [`design/spatialization-plan.md`](design/spatialization-plan.md) - procgen biome + fire archetype spec (older plan).
- Dated session notes, each a snapshot of its day (the ones from 2026-10-07 on describe the classic volcano ruleset and carry a note saying so): `session-2026-10-26-volcano-stages-world-end.md`, `session-2026-10-18-monuments-cinematic.md` (+ `review-2026-10-18-monuments-cinematic.md`), `session-2026-10-07-v1-loop.md`, `session-2026-10-05.md`, `session-2026-10-04.md`, `session-2026-09-30.md`, `session-2026-09-29-playtest.md`, `session-2026-09-24-phase-clock.md`, `checkpoint-2026-10-07-geography-migration.md`.
- `docs/archive/` and `design/archive/` are old plans and handoffs, kept for history. `docs/bug-reports/` holds platform bug reports.

## How it plays

**Playable now**

- Spawn laid down by the hearth under a black screen: **A new hearth is kindled.** / **Don't let the fire die.** The day title shows the world's current day. The ? panel shows **Day N**, **n/6 monuments activated** and **Don't let the fire die**. Every sunrise shows the day again.
- Light a torch at a fire. Heat comes from *your* lit torch, a campfire, a charging monument's heat or a released crystal's heat zone. Standing near another player does not warm you.
- The fire's size is its health. A smaller flame warms a smaller circle, more slowly. Ember still heats. From dusk it loses to the cold. Wood is what makes a fire safe. Feeding a burning fire with a log works as before; a fire that runs out is gone for good.
- Melt snow, pick up a log, or chop a tree. One thing in the F slot. Feed a fire, or **build a new one** (carry a log, lit torch, E). Night starts at dusk: heavier weather, weaker flame, faster drain. The torch still melts 3-wide.
- Link fires into a network. Fires linked to a monument within 40 m charge it faster the more they are (and the closer, and through up to 3 hops of relay fires); charging fires burn 1.5x faster. A full charge releases the monument automatically.
- A full frost bar freezes you in the ice where you stand. Another player's lit torch can thaw you. If a fire is still lit, frozen players wake at it. The run ends only when no campfire and no torch is lit for 4 s. The cards are: **After N day/days, the world's flame goes out.** **Centuries pass in the cold.** **A new hearth is kindled.** / **Don't let the fire die.** Then a fresh seed, and dawn under that last card.
- Find the volcano and read the stone tablet on its inner rim: a B&W engraved map (volcano, spawn, monument marks). A monument with ice around it (the ice-locked one, which has a guaranteed log cluster nearby) loses its ice chunk by chunk as it charges; it is fully clear at 90 % charge.
- Each release thaws a 50 m zone and opens an oasis. After the last one, the **THE WORLD BEGINS TO THAW** ending plays.

**Still the v1 target, not in this build**

- Seasons deepen toward a **winter solstice**. Empty-server persistence and a return screen are unbuilt. A live server keeps the world already in progress; the platform shuts a server down after the last player leaves, and the next start draws a fresh seed.
## Design pillars

The full 10-pillar list lives in [`design/gdd.md`](design/gdd.md) \§3. Highlights:

- **Man vs. winter, not man vs. mob.** No combat in v1. The enemy is cold and snow.
- **Warm the ground to see what's there.** One legible verb; variety comes from what you find.
- **Fire = safety, distance = stakes.** The emotional center is gathering in the light. Warmth comes from the fire and your torch.
- **Geography is the tech tree.** Different biomes and discoveries grant different capabilities.
- **The world's fuel is finite. Every burn subtracts. Reset is the only renewal.**
- **The run survives while someone can still bring the fire back.** A freeze is recoverable. The world is lost when no campfire and no torch is lit. Spent fires are gone for good, so a new fire always costs wood. Migration to the oldest surviving fire is still planned.
- **Progress belongs to the civilization. Memory belongs to the player.** No personal power progression.
- **Complexity from the world, not the verbs.** New depth comes from new content, not new inputs.

## Non-goals (v1)

No combat / mobs, no permadeath, no tool tiers, no personal gear, no NPCs, no world map (except the in-world summit tablet), no crafting UI, no hunger/thirst, no wallet-gated content. Full list in [`design/gdd.md`](design/gdd.md) \§9. (A per-player leaderboard was added with the floating-crystals ruleset.)

## Running locally

```bash
npm install
npm start              # preview client
npm run auth-server    # (separate terminal) local authoritative server
```

Logic checks (headless, no preview needed): `node scripts/<name>.mjs`, for example `node scripts/oasisCheck.mjs`, `finaleCheck`, `spentFireCheck`, `topologyCheck`, `leaderboardCheck`. The list, and what each covers, is in [`docs/HANDOFF.md`](docs/HANDOFF.md).

Debug toggles live in `src/client/devFlags.ts` (all `false` in a committed build; flip back before deploying). For example `DEBUG_FINALE_BUTTON` adds an **END** button that plays the ending without activating every monument.

## Deploying

Prefer **CLI** when changing parcel layout - Creator Hub Publish rewrites parcels from its editor Layout and can stomp a larger `scene.json`:

```bash
npm run deploy -- --target-content https://worlds-content-server.decentraland.org
```

Keep Creator Hub **Layout** matching `scene.json` (currently **52 x 52** for `playtest_52`; 100 x 100 for `full_100`) so the composite and CLI stay aligned. If the CLI proxy errors out on Node 24, Creator Hub Publish still works for content - just confirm Layout matches before publishing. Before deploying: all `devFlags.ts` toggles off, and check `CHARGE_TARGET_S` (60 is a playtest value).

**Mobile note:** the 51 x 51 parcel clamp (H1-07) was observed on the 100 x 100 World; it has not been re-checked on the 52 x 52 profile. The **xy** debug chip was removed from the build.

## Repository layout

```
src/
  client/    # rendering, input, UI, VFX, audio, frost, terrain, props
  server/    # authoritative state, roster, fires, monuments, leaderboard, cycle, weather
  shared/    # components, messages, pure logic shared by both (ruleset, fire network, oasis, finale)
assets/      # models, images, audio, animations, source files
scripts/     # headless check scripts (*Check.mjs) and asset generators
design/      # GDD, summary, decisions, hypotheses, dated session notes
docs/        # HANDOFF.md (current), bug reports, archived plans
```

Entry point routing (`src/index.ts`) uses the **async** `isServer` from `~system/EngineApi` - the sync helper starts as `false` and would cause the headless server to take the client branch and crash. Do not change this.

## Style

Code style and agent conventions: [`AGENTS.md`](AGENTS.md).