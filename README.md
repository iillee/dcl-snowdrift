# Cryocene

*Title locked 2026-09-23 (pivoted from **Snow Drift** — IP conflict). Repo, package name, deploy URL (`snowdrift.dcl.eth`), and CRDT component IDs still use `snowdrift` — these are infrastructure identifiers that would break live state or require a new DCL NAME migration to change. All user-facing surfaces (scene title, splash, Discord notifications, docs) now say Cryocene.*

A persistent shared-world winter survival roguelike for Decentraland, set on Earth at the edge of the Cryogenian freeze.

> **Hold the light against the storm.**

Cryocene is a co-op survival scene where fires are islands of warmth in a hostile snowscape. Days are for gathering wood and expanding a network of lit fires. Nights are for defending them — the cold bites, fuel drains faster, snow reclaims territory. Seasons, culminating in a **winter solstice**, are the v1 target and are not in the playtest build. A full frost bar freezes you in the ice. Another player can thaw you with a lit torch. The run ends when everyone still connected is frozen and no fire is left to recover them. A player who is still moving can relight and save the group. Empty-server persistence is still unbuilt. While a server is up, leaving and coming back returns you to the world in progress. A new server start, and every regen, draws a fresh seed.

**Deploy target:** [`snowdrift.dcl.eth`](https://play.decentraland.org/?realm=snowdrift.dcl.eth) (Decentraland World)
**Runtime:** SDK7 (`@dcl/sdk` 7.26.x, pinned exact) with authoritative headless server
**Scene (playtest):** **64 × 64 parcels** (1024 m × 1024 m, 992 m playfield, 16 m pad). Portrait-friendly mobile-first UI. **v1 target** remains 100 × 100, gated on H1-06 mobile perf at the live size.

---

## Status

**v1 Systems in progress** (2026-10-04). The World at `snowdrift.dcl.eth` is this slice when the latest deploy has finished.

**In the current build:** torch, melt, branch/log pickup out to the far trees, choppable trees (chop reach scales with size), six hidden fires, fuel tiers (the flame you see is the warmth you get; the smallest flame still heats), frost that freezes you in ice, a first-pass torch thaw (desktop elevates ice on mobile peers), chain-light, weather, **Dawn / Day / Dusk / Night**, a run that ends only when everyone connected is frozen and no fire is left, then three cards and a fresh seed, Day N on join and at sunrise, black cold open, ? menu (Day N, the phase and its countdown, "Don't let the fire die"), phone mute and overhead zoom + off-screen face finder, **64 × 64** World with coarse far snow LOD.

**Not in this build:** seasons, solstice, sleeping-ember, empty-server persistence, return screens, pine, kiln, a communal wood pile. Scatter density not yet retuned for 64 × 64.

Full spec [`design/gdd.md`](design/gdd.md). What the build actually does: [`design/session-2026-10-04.md`](design/session-2026-10-04.md) (and [`design/session-2026-09-30.md`](design/session-2026-09-30.md)). The phased plan lives in GDD §9.

The major v1 design decisions are locked (see [`design/gdd.md`](design/gdd.md) \§0.1):

- **Retention model** — persistent shared-world survival roguelike.
- **Defense mechanic** — multi-fire territory. The run ends when everyone still connected is frozen and no fire is left, not when the last flame goes out. Oldest-fire-becomes-home is still planned.
- **Cabin discovery** — Charcoal Kiln (portability logistics).

## Design documentation

- [`design/gdd.md`](design/gdd.md) — full GDD.
- [`design/summary.md`](design/summary.md) — plain-English overview.
- [`design/decisions.md`](design/decisions.md) — running log of design decisions and rationale.
- [`design/session-2026-10-04.md`](design/session-2026-10-04.md) — 64×64 World, coarse snow LOD, ice + overhead polish.
- [`design/session-2026-09-30.md`](design/session-2026-09-30.md) — what the playtest build did as of 9/30.
- [`design/session-2026-09-29-playtest.md`](design/session-2026-09-29-playtest.md) — the 9/29 wood-loop pass.
- [`design/session-2026-09-24-phase-clock.md`](design/session-2026-09-24-phase-clock.md) — earlier clock + last-fire handoff.
- [`design/hypothesis-log.md`](design/hypothesis-log.md) — hypotheses (`H1-xx`) referenced from the GDD.
- [`design/spatialization-plan.md`](design/spatialization-plan.md) — procgen biome + fire archetype spec.
- GDD §9 — phased v1 plan (`docs/v1-4week-plan.md` is archived).

## How it plays

**Playable now**

- Spawn laid down by the hearth under a black screen: **A new hearth is kindled.** / **Don't let the fire die.** The day title shows the world's current day. The ? panel is **Day N**, then the phase and its countdown (`Dawn: 0:12`), then **Don't let the fire die**. Every sunrise shows the day again.
- Light a torch at the fire. Heat comes from *your* lit torch or a campfire. Standing near another player does not warm you.
- The fire's size is its health. A smaller flame warms a smaller circle, more slowly. Ember still heats. From dusk it loses to the cold. Wood is what makes a fire safe.
- Melt snow, pick up a branch or a log, or chop a tree. One thing in the F slot. Feed the fire. Night starts at dusk: heavier weather, weaker flame, faster drain. The torch still melts 3-wide.
- A full frost bar freezes you in the ice where you stand. Another player's lit torch can thaw you. If a fire is still lit, frozen players wake at it. The run ends only when everyone still connected is frozen and no fire is left. The cards are: **After N day/days, the world's flame goes out.** **Centuries pass in the cold.** **A new hearth is kindled.** / **Don't let the fire die.** Then a fresh seed, and dawn under that last card.

**Still the v1 target, not in this build**

- Seasons deepen toward a **winter solstice**. Empty-server persistence and a return screen are unbuilt. A live server keeps the world already in progress.

## Design pillars

The full 10-pillar list lives in [`design/gdd.md`](design/gdd.md) \§3. Highlights:

- **Man vs. winter, not man vs. mob.** No combat in v1. The enemy is cold and snow.
- **Warm the ground to see what's there.** One legible verb; variety comes from what you find.
- **Fire = safety, distance = stakes.** The emotional center is gathering in the light. Warmth comes from the fire and your torch.
- **Geography is the tech tree.** Different biomes and discoveries grant different capabilities.
- **The world's fuel is finite. Every burn subtracts. Reset is the only renewal.**
- **The run survives while someone can still bring the fire back.** A freeze is recoverable. The world is lost when everyone still connected is frozen and no fire is left. Migration to the oldest surviving fire is still planned.
- **Progress belongs to the civilization. Memory belongs to the player.** No personal power progression.
- **Complexity from the world, not the verbs.** New depth comes from new content, not new inputs.

## Non-goals (v1)

No combat / mobs, no leaderboards, no permadeath, no tool tiers, no personal gear, no NPCs, no world map, no crafting UI, no hunger/thirst, no wallet-gated content. Full list in [`design/gdd.md`](design/gdd.md) \§9.

## Running locally

```bash
npm install
npm start              # preview client
npm run auth-server    # (separate terminal) local authoritative server
```

## Deploying

Prefer **CLI** when changing parcel layout — Creator Hub Publish rewrites parcels from its editor Layout and can stomp a larger `scene.json`:

```bash
npm run deploy -- --target-content https://worlds-content-server.decentraland.org
```

Keep Creator Hub **Layout** at 64 × 64 so the composite and CLI stay aligned. If the CLI proxy errors out on Node 24, Creator Hub Publish still works for content — just confirm Layout matches before publishing.

## Repository layout

```
src/
  client/    # rendering, input, UI, VFX, audio, frost, maze, props
  server/    # authoritative state, roster, spawners, cycle, weather
  shared/    # components, messages, pure logic shared by both
assets/      # models, images, audio, source files
design/      # GDD, summary, decisions, hypotheses, spatialization plan
docs/        # plan, vision, bug reports, handoffs, archived design
```

Entry point routing (`src/index.ts`) uses the **async** `isServer` from `~system/EngineApi` — the sync helper starts as `false` and would cause the headless server to take the client branch and crash. Do not change this.

## Style

Code style and agent conventions: [`AGENTS.md`](AGENTS.md).
