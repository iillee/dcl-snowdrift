# Session 2026-10-07 — V1 MVP loop (monuments → thaw → new winter)

Source of truth for what the playtest build does after the 10/06–10/07 pass. Supersedes the "next build" scope in [`checkpoint-2026-10-07-geography-migration.md`](./checkpoint-2026-10-07-geography-migration.md) for this playtest.

## Locked V1 MVP loop

Survive → explore → find the volcano → climb → read the **summit tablet** (world map) → find the **3 ignition monuments** → **ignite** all three (**any order**) → volcano smoke ramps at **1/3** and **2/3** → the **3rd** thaws a large ring around the volcano → win → 1 warm day → new winter.

- Tablet = **where**; terrain = **how**; survival = **whether**. The tablet is knowledge, **not** a gate.
- Monuments need no wood or puzzles — only a carried flame.
- No return-to-peak finalize: the 3rd monument triggers thaw directly.
- **Stop and playtest** before seasons, discoveries, fire network, etc.

## World profile

- Active: **`playtest_52`** (52×52 parcels, 832 m, 0 padding) — `WORLD_PROFILE` in `src/shared/settings.ts`. **`full_100`** is kept as the alternate profile. `scene.json` now lists the 2,704 parcels of the 52×52 profile.
- Low + Mid + High groves, volcano on the high plateau. Densified wood and fires for chain travel; running re-enabled; daytime frost speed halved; spawn waits for terrain + pad at the hearth.
- Torch readability work is **dropped** for V1.

## Ignition monuments (`src/server/stations.ts`, `src/client/stationMarkers.ts`)

- 3 sockets generated per seed, line-of-sight validated to the volcano.
- Grey stone stumps with colliders, tall enough to clear ~1.5 m snow; rebuilt when terrain changes.
- `STATION_DEBUG_BEACONS = false` — debug beacons off; stumps and real beams remain.
- **Ignite:** stand within **3.5 m** holding a **lit torch**. An **IGNITE MONUMENT** bubble appears in the campfire-prompt slot (`layer.hiddenCampfirePrompt.tsx`); press **E** or tap it. No flame → no prompt. Plain clicking does nothing.
- On ignite: grow ~50% taller + spin 180° → beam to the volcano → a campfire flame burns on top. The stone keeps its normal grey (`MONUMENT_LIT_RED_TINT = false`; the ember-red tint + glow is off for now).
- Ignition plays `assets/sounds/monument.mp3` at the monument for every nearby player, only on a fresh ignite (the server flags it `fresh`); late joiners, seed rebuilds and resets stay silent and snap to the lit pose.
- The summit tablet X for a monument turns **red** once it is lit (in-world engraving + WORLD MAP UI), live and for late joiners; back to black on a new cycle.
- Lit monuments are **eternal Warm campfires**: ~8 m warmth and snow melt, no fuel, never go out.
- Lit state lives in server memory: a full server restart (or cycle roll) resets it.
- Not built: relighting a torch from a monument; respawning at a monument.

## Volcano (`src/client/volcanoCrown.ts`, `src/shared/terrain/volcanoCrown.ts`, `src/client/volcanoSmoke.ts`)

- Extruded caldera crown: **blue exterior** like other terrain; **dark inner walls** that extend below the snow / ice-cap level on the rim.
- **Crater heat, always on** (`src/shared/terrain/volcanoCraterHeat.ts`): Warm-tier (~8 m) melt + frost warmth from scene start, even at 0/3. Server melt with periodic re-assert, client crater clearing, frost via the Warm radius.
- 0/3: no smoke, no lava. 1–2/3: a faint wisp of smoke. 3/3: a big eruption plume, lava appears + thaw.
- Volcano ladders: the carved stair notch's lower step (Mid → High) is 3 deep with Mid side aprons, so the lower ladder can land on the front or either side, picked by seed; a blocked side falls back to the others. Check: `node scripts/volcanoLadderCheck.mjs [seeds]` (summit reachable + side distribution).

## Summit tablet (`src/client/summitMapTable.ts`, `src/shared/terrain/summitMapSeat.ts`, `src/client/summitMap.ts`, `layer.summitMap.tsx`)

- A single solid **1.15 m** stone block (footprint = map face), top at waist height, base sunk slightly into the ground.
- Seated on the **inner crater rim**, with a snow pad melted around it.
- Engraved, flat **black & white** map (in-world and UI): **▲ volcano**, **○ spawn**, **✕ monuments**. No worlds, no groves.
- Click opens the **WORLD MAP** UI.

## Thaw (`src/shared/terrain/thawWave.ts`, `src/server/snowSync.ts`, `src/server/snowState.ts`, `src/client/worldThaw.ts`, `src/client/thawSplash.ts`)

- At the 3rd monument the volcano becomes a giant eternal campfire. A **radial melt wave** grows from the crater over `THAW_WAVE_DURATION_S = 45` and **stops at the thaw radius**.
- The radius is sized per map so the zone covers `THAW_AREA_FRACTION = 0.55` of the playfield's snow tiles (disc parts off the map edge count as lost). Works for any profile / volcano position. Check: `node scripts/thawRadiusCheck.mjs`.
- Inside the zone: ground snow, cliff-top ice caps (the cap mesh drops as the wave reaches it) and scatter wood are removed and held gone until the new-winter reset. Outside it the world stays wintry: snowfall, regrowth and accumulation carry on.
- Warmth: inside the zone the volcano warms like a Warm campfire and blocks open-air / night cold, fading to 0 over `THAW_EDGE_BAND_M = 48` m at the (growing) wave edge. Outside the zone night cold is normal.
- **No global clear-weather lock** any more.
- Rate-limited — fixes the old freeze where every tile was sent and rebuilt in one frame (torch detached, ladders/fires/actions stopped).
- Lava + **WORLD THAWED** splash.
- Late joiners get the wave's age from the server and see what has already melted, then the rest of the wave.
- Debug: `DEBUG_THAW_BUTTON` in `src/client/devFlags.ts` (**false**; server handler gated on the same flag) shows a THAW button right of the frost bar that lights all monuments and runs this same path.

## Post-win reset (`src/client/daySplash.ts`, `src/server/stations.ts`)

- The rest of the thaw day is a bonus.
- Then `POST_THAW_DAYS = 1` (in `thawWave.ts`) full day: its sunrise splash reads **Winter Approaches in 1 Day** instead of **DAY X**.
- At the next sunrise the existing cycle roll starts a new winter: fresh seed, snow back, unlit monuments, night cold back on, splash back to Day 1.

## Safety / UI

- **Perimeter wall** (`src/client/perimeterWall.ts`): invisible physics-only collider 0.5 m inside the scene edge, ~120 m tall (40 m over the highest peaks), sized from the active world profile. Blocks movement, not pointer clicks.
- The debug **xy** scene-bounds chip beside the frost bar is **removed** (`layer.frostBar.tsx`).

## Generation fixes

- **Wood and campfires** sit at real ground height where they're placed (not the hearth ledge height) and avoid cliff edges. Dropped wood lands on the ground. 12 seeds/profile: ~1,040 floating wood + 5–6 edge fires → 0.
- **Trees** need flat ground under their roots and clearance from taller walls within branch reach, everywhere (not just near the hearth); bad spots retry. 141–194 bad trees/profile → 0.
- Trees sink `TREE_SINK_PER_SCALE_M = 0.03` × scale (≈0.12–0.24 m) into the ground (`src/client/props/spawn.ts`).
- Check script: `node scripts/floatingItemsCheck.mjs` (entry `scripts/floatingItemsCheckEntry.ts`).

## Parked for after the playtest

- Monuments burning out over time (winter creeping back) as an alternative to the fixed countdown.
- Fuller celebratory eruption (beyond the 3/3 smoke plume + lava).
- Seasons, discoveries, fire network, staged thaw lighting.
- Mid/Low monument LOS balance if placement skews High.
- Torch readability; GitHub branches beyond `main`.
