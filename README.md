# Cryocene

*Title locked 2026-09-23 (pivoted from **Snow Drift** — IP conflict). Repo, package name, deploy URL (`snowdrift.dcl.eth`), and CRDT component IDs still use `snowdrift` — these are infrastructure identifiers that would break live state or require a new DCL NAME migration to change. All user-facing surfaces (scene title, splash, Discord notifications, docs) now say Cryocene.*

A persistent shared-world winter survival roguelike for Decentraland, set on Earth at the edge of the Cryogenian freeze.

> **Hold the light against the storm.**

Cryocene is a co-op survival scene where fires are islands of warmth in a hostile snowscape. Days are for gathering wood and expanding a network of lit fires. Nights are for defending them — the cold bites, fuel drains faster, snow reclaims territory. Seasons compound, culminating in a **winter solstice**: the longest, coldest night. World state persists between sessions and continues advancing while the server is empty. Civilizations end when the last fire dies; the next arriving player witnesses the extinction, and a new seed rerolls the geography.

**Deploy target:** [`snowdrift.dcl.eth`](https://play.decentraland.org/?realm=snowdrift.dcl.eth) (Decentraland World)
**Runtime:** SDK7 (`@dcl/sdk` 7.26.x, pinned exact) with authoritative headless server
**Scene (v1 target):** 100 × 100 parcels (1600 m × 1600 m), portrait-friendly mobile-first UI. Currently deployed at 32 × 32 parcels for the v0 prototype.

---

## Status

**v1 Systems in progress** on `feat/phase-clock` (2026-09-24). The World at `snowdrift.dcl.eth` may still be the older v0 deploy until this branch ships.

**In the current build:** torch, melt, wood pickup, frost death, chain-light, weather, **server-owned DAY / DUSK / NIGHT**, last-fire fade-to-black + new seed, Day X help + sunrise splash, snow LOD planes.

**Next playtest:** 2026-09-29 (day/night loop). **Next build day:** 2026-09-28 — wood. Full spec [`design/gdd.md`](design/gdd.md). Handoff [`design/session-2026-09-24-phase-clock.md`](design/session-2026-09-24-phase-clock.md). The phased plan lives in GDD §9 (the old `docs/v1-4week-plan.md` is archived).

The major v1 design decisions are locked (see [`design/gdd.md`](design/gdd.md) \§0.1):

- **Retention model** — persistent shared-world survival roguelike.
- **Defense mechanic** — multi-fire territory + fire-survives-extinction rule.
- **Cabin discovery** — Charcoal Kiln (portability logistics).

## Design documentation

- [`design/gdd.md`](design/gdd.md) — full GDD.
- [`design/summary.md`](design/summary.md) — plain-English overview.
- [`design/decisions.md`](design/decisions.md) — running log of design decisions and rationale.
- [`design/session-2026-09-24-phase-clock.md`](design/session-2026-09-24-phase-clock.md) — live handoff (clock + last-fire + Monday wood).
- [`design/hypothesis-log.md`](design/hypothesis-log.md) — hypotheses (`H1-xx`) referenced from the GDD.
- [`design/spatialization-plan.md`](design/spatialization-plan.md) — procgen biome + fire archetype spec.
- GDD §9 — phased v1 plan (`docs/v1-4week-plan.md` is archived).

## How it plays (v1 target)

- Spawn near a lit hearth. The sky is the clock. Help shows **Day X**; sunrise splashes the day number.
- Grab a torch. Heat comes from *your* lit torch or a visible campfire — not from huddling.
- Melt snow, pick up wood, feed the fire. Night starts at dusk: smaller melt, heavier weather, faster drain.
- If the last fire dies, the world fades to black and a new seed begins.
- Seasons progress. Winter deepens. Nights get longer, snow gets heavier, cold gets sharper — leading up to the **winter solstice**: the longest and hardest night.
- Survive the solstice with any fire still lit \→ the recovery seasons begin (thaw, spring). Fail with all fires dead and no one around \→ the next arriving player witnesses extinction, and a new seed rolls. That reset is a story ("winter reclaimed the village"), not a game-over screen.

## Design pillars

The full 10-pillar list lives in [`design/gdd.md`](design/gdd.md) \§3. Highlights:

- **Man vs. winter, not man vs. mob.** No combat in v1. The enemy is cold and snow.
- **Warm the ground to see what's there.** One legible verb; variety comes from what you find.
- **Fire = safety, distance = stakes.** Emotional center is huddling around light together.
- **Geography is the tech tree.** Different biomes and discoveries grant different capabilities.
- **The world's fuel is finite. Every burn subtracts. Reset is the only renewal.**
- **Civilization survives while any fire remains.** Loss of the hearth is dramatic, not fatal — the oldest surviving fire becomes the new home.
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

```bash
npm run deploy
```

Note: if the CLI proxy errors out on Node 24, deploy from the Creator Hub app UI — it uses its own Electron-embedded signing flow that bypasses the broken proxy path.

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
