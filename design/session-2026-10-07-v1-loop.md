# Session 2026-10-07 — V1 MVP loop (monuments → thaw → new winter)

Source of truth for what the playtest build does after the 10/06–10/07 pass. Supersedes the "next build" scope in [`checkpoint-2026-10-07-geography-migration.md`](./checkpoint-2026-10-07-geography-migration.md) for this playtest.

## Locked V1 MVP loop

Survive → explore → find the volcano → climb → read the **summit tablet** (world map) → find the **3 ignition monuments** → **ignite** all three (**any order**) → volcano smoke ramps at **1/3** and **2/3** → the **3rd** auto-thaws the world → win → 3 warm days → new winter.

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
- On ignite: grow ~50% taller + spin 180° → beam to the volcano → stone glows **ember red** with a campfire flame on top.
- Lit monuments are **eternal Warm campfires**: ~8 m warmth and snow melt, no fuel, never go out.
- Lit state lives in server memory: a full server restart (or cycle roll) resets it.
- Not built: relighting a torch from a monument; respawning at a monument.

## Volcano (`src/client/volcanoCrown.ts`, `src/shared/terrain/volcanoCrown.ts`, `src/client/volcanoSmoke.ts`)

- Extruded caldera crown: **blue exterior** like other terrain; **dark inner walls** that extend below the snow / ice-cap level on the rim.
- **Crater heat, always on** (`src/shared/terrain/volcanoCraterHeat.ts`): Warm-tier (~8 m) melt + frost warmth from scene start, even at 0/3. Server melt with periodic re-assert, client crater clearing, frost via the Warm radius.
- 0/3: no smoke, no lava. 1–2/3: progressive smoke. 3/3: lava appears + thaw.

## Summit tablet (`src/client/summitMapTable.ts`, `src/shared/terrain/summitMapSeat.ts`, `src/client/summitMap.ts`, `layer.summitMap.tsx`)

- A single solid **1.15 m** stone block (footprint = map face), top at waist height, base sunk slightly into the ground.
- Seated on the **inner crater rim**, with a snow pad melted around it.
- Engraved, flat **black & white** map (in-world and UI): **▲ volcano**, **○ spawn**, **✕ monuments**. No worlds, no groves.
- Click opens the **WORLD MAP** UI.

## Thaw (`src/server/snowSync.ts`, `src/client/worldThaw.ts`, `src/client/thawSplash.ts`)

- The 3rd monument starts a **radial melt wave** from the volcano over `THAW_WAVE_DURATION_S = 45` (tune in `src/server/snowSync.ts`).
- Melts ground snow and the white cliff-top caps alike (they're the same snow); blue ice underneath stays.
- Rate-limited — fixes the old freeze where all 2,704 tiles were sent and rebuilt in one frame (torch detached, ladders/fires/actions stopped).
- Then: clear weather, lava, **WORLD THAWED** splash.
- After thaw: **no night / open-air cold**. Only snow the wave hasn't reached yet still chills.
- Late joiners get what has already melted, then the rest of the wave, plus the warm state.

## Post-win reset (`src/client/daySplash.ts`, server cycle)

- The rest of the thaw day is a bonus.
- The countdown starts at the next sunrise: the day splash reads **Winter Approaches in 3 Days**, then 2, then **in 1 Day**, instead of **DAY X**.
- At the 4th sunrise the existing cycle roll starts a new winter: fresh seed, snow back, unlit monuments, night cold back on, splash back to Day 1.

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
- Celebratory eruption VFX on thaw.
- Seasons, discoveries, fire network, staged thaw lighting.
- Mid/Low monument LOS balance if placement skews High.
- Torch readability; GitHub branches beyond `main`.
