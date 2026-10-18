# Session 2026-10-18 — Monuments rework, ignition cinematic, isometric overview

Source of truth for the monument pass (on `main` as `7cfaf4b`) and the `cinematic` branch work on top of it. Supersedes the **Ignition monuments** section of [`session-2026-10-07-v1-loop.md`](./session-2026-10-07-v1-loop.md) (the loop itself is unchanged: ignite 3 monuments in any order → the 3rd triggers the thaw). Review handoff: [`review-2026-10-18-monuments-cinematic.md`](./review-2026-10-18-monuments-cinematic.md).

Nothing here has been verified in a live preview yet; the check scripts, `npx tsc --noEmit -p .` and `npm run build` pass.

## Branches

- **`main`** — `7cfaf4b` *Monuments: socketed obelisks with corner-ice melt test, hover bob/spin, fixed volcano beam, crystal hum + gaze sound, far-side near monument, snowfall column* (on top of `457befe`, which already made monuments give no heat / melt).
- **`cinematic`** — branched from `7cfaf4b`: ignition cinematic + letterbox (`865763f`), then survival pause, 14.2 s retime, beam.wav, ±0.3 m bob, matte deep-black material, iso FOV 24° + desktop pan fix (follow-up commit). 10 s rise, higher hover, seated pyramid flush with the ground, isometric overview camera. Not merged into `main`.

## Monuments (`src/client/stationMarkers.ts`, `src/server/stations.ts`, `src/shared/monumentIce.ts`, `src/shared/terrain/terrainMap.ts`, `src/client/terrain/terrainRenderer.ts`)

### Look and socket

- Each monument is a matte deep-black **obelisk**: square shaft `OB_SHAFT_M = 14` m, a `OB_TIP_M = 4` m pyramid on each end, width `MONUMENT_OBELISK_WIDTH_M = 3` m (low-poly GLBs from `scripts/make-obelisk-glb.js`: `assets/models/obelisk_shaft.glb`, `obelisk_pyramid.glb`).
- **Material (cinematic branch):** `src/client/monumentMaterial.ts` — `MONUMENT_BLACK` rgb(0.02, 0.02, 0.02), metallic 0, roughness 1, specular 0, black reflectivity (`MONUMENT_MATTE_PBR`). Applied to the obelisk glb parts with a global `GltfNodeModifiers` material override (`stationMarkers.ts` `part`) and to the socket border + socket bottom slabs (`terrainRenderer.ts` `paintMonumentMatte`). The glbs were regenerated to match (base 0.02, metallic 0, roughness 1, `KHR_materials_specular` factor 0). Beams keep their emissive material.
- Seated in a square **socket** (`MONUMENT_SOCKET_SIZE_M` = width + 0.1 m, `MONUMENT_SOCKET_DEPTH_M = 1.5` m) in the centre of a `MONUMENT_PIT_SIZE_M = 6` m square. `MONUMENT_PIT_DEPTH_M = 0`: no recess and no steps, the ground around the socket is flat.
- **Seated height (cinematic branch):** `FROZEN_SHAFT_ABOVE_GROUND_M = 0` — the base of the top pyramid is flush with the ground, so only the 4 m pyramid shows (tip 4 m up). The shaft runs down through the socket, hidden in the terrain. The rise starts from here.
- **Black border:** a matte deep-black perimeter band (same material as the obelisk) around the socket drawn as full-height slabs, flush with the surrounding ground cap (no lip, no step) — `addMonumentPit` in `terrainRenderer.ts`.
- **Invisible socket floor:** a physics-only box collider fills the socket to ground level, so nobody can drop into the empty socket after the obelisk rises.

### Ice test (one far monument only)

- Exactly **one** monument per seed has ice: `icedStationIndex(map)` hashes `usedSeed` over the stations **not** flagged `near` (fallback: excludes the one with the shortest route from the hearth). The near-spawn monument never has ice. The other two can be ignited straight away.
- The ice is **4 corner blocks** (2 × 2 grid of `MONUMENT_ICE_CHUNK_M = 3` m columns; the obelisk stands where the inner corners meet).
- Block height `MONUMENT_ICE_TOP_M` = snow stage 2 (1.0 m, too tall to step onto) plus a one-section snow cap `MONUMENT_ICE_SNOW_CAP_M` (stage 1) → mound top `MONUMENT_MOUND_TOP_M` (1.5 m). Snow falls on the ice like anywhere else (`setSnowCellOffsets` raises those snow cells).
- **Melt:** a lit torch within `MONUMENT_ICE_MELT_RADIUS_M = 3.0` m of a block's centre melts it top-down over `MONUMENT_ICE_CHUNK_MELT_S = 6` s; a partly melted block refreezes over `MONUMENT_ICE_CHUNK_REFREEZE_S = 12` s when the torch leaves. Server owns the melted-chunk bitmask (`monumentIceMelt` → `monumentIceState`, broadcast + late-join hydration) and clears the snow that lay on each melted block.
- **Melt sound:** `icemelt.mp3` loops for the melter at `ICE_MELT_SFX_VOLUME = 0.3` (fade-out `ICE_MELT_SFX_FADE_S = 0.5`); others within `ICE_MELT_REMOTE_HEAR_M = 40` m hear a positional hit per confirmed block at `ICE_MELT_REMOTE_VOLUME = 0.4`.
- Ice blocks reuse the frozen-player ice look (`paintIce` exported from `src/client/frost/rescue.ts`).

### Ignite

- Only one prompt: **IGNITE MONUMENT** (`getMonumentPromptText`). It shows only when the player is at the monument (within `NEAR_RADIUS_M` = pit half + 2.5 m = 5.5 m XZ, and within `NEAR_HEIGHT_M = 4` m of the station ground), **all ice is gone** (server-confirmed; trivially true for un-iced monuments) and the **torch is lit**. No melt prompt / torch hints. Press **E**, tap the bubble, or the torch button on mobile.
- The server refuses `stationActivate` while the iced monument still has ice.
- After activation the server stops protecting the pit cells, so snow regrows over them.

### Rise, hover, beams

- **Rise:** `MONUMENT_RISE_S = 10` (was 6; every client), straight up, no rotation. `MONUMENT_SETTLE_S = 0.6` pause once stationary.
- **Hover height** (`monumentHoverBottomY` in `terrainMap.ts`, shared with terrain gen): bottom tip = max(volcano aim Y + `MONUMENT_HOVER_ABOVE_TARGET_M = 35`, ground + `MONUMENT_HOVER_BOTTOM_H_M = 70`) + `beamLiftM`, capped so the top tip stays `HOVER_CEILING_MARGIN_M = 24` m under the scene height limit. (Was +20 / ground + 50.) The volcano beam always angles slightly down.
- **Bob / spin:** `HOVER_BOB_M = 0.3` m (barely noticeable; was 2.5) over `HOVER_BOB_PERIOD_S = 10` s, spin `HOVER_SPIN_DEG_S = 5` °/s; both ease in from zero over `HOVER_EASE_IN_S = 4` s once fully risen.
- **Sky beam:** drops over `SKY_BEAM_DROP_S = 1.2` s from just under the ceiling (`SKY_BEAM_CEILING_MARGIN_M = 4`) into the **top tip**; it bobs with the obelisk.
- **Volcano beam:** draws over `VOLCANO_BEAM_DRAW_S = 1.5` s from the **bottom tip** to the volcano. Its far end is **fixed in world space**: `aimVolcanoBeam` re-aims and re-stretches it from the live (bobbing) bottom tip every frame. When it lands, the active count goes to volcano smoke / the 3/3 thaw.
- Late joiners / remote ignites snap to the hovering pose with both beams; only a fresh ignite plays the rise + `monument.mp3`.

### Sound

- **Crystal hum:** `assets/sounds/crystal.mp3`, positional loop on every risen / hovering obelisk at `CRYSTAL_HUM_VOLUME = 0.7`, emitted from a fixed invisible point `CRYSTAL_HUM_HEIGHT_M = 2` m above the socket (audible from the ground), not from the obelisk.
- **Gaze hum:** a soft 2D crystal loop while the camera looks at an activated obelisk at any distance: cone `GAZE_CONE_DEG = 12`, `GAZE_VOLUME = 0.25`, fades `GAZE_FADE_IN_S = 1.5` / `GAZE_FADE_OUT_S = 2`; obelisks closer than `GAZE_MIN_HORIZ_M = 8` m horizontally are skipped (the ground hum covers them).

- **Beam whoosh (cinematic branch):** `assets/sounds/beam.wav`, camera-parented non-positional one-shot at `BEAM_SFX_VOLUME = 0.8` (`playBeamSfx` in `audio.ts`) for the igniting player only, the moment the volcano beam starts drawing (`startVolcanoBeam`). Still plays if the cinematic was skipped (it is tied to the local ignite, not the camera).

### Warmth

- Monuments give **no heat and melt no snow** (since `457befe`). They are no longer Warm campfires; the tablet X still turns red when lit (`summitMapTable.ts`).

## Monument placement (`src/shared/terrain/terrainGen.ts`)

- 3 stations per seed (`STATION_COUNT`). **No volcano line of sight is required** for any station: the obelisk hovers above the rim and `beamLiftM` raises the hover until the beam clears; sockets whose beam never clears are a last resort.
- **Near monument** (`pickNearStation`, flagged `near`): on the far side of the hearth from the volcano, at the outer edge of the starting grove.
  - Preferred band `NEAR_STATION_MIN_M = 136` – `NEAR_STATION_MAX_M = 192` m, target `NEAR_STATION_TARGET_M = 160` m; relaxed band `NEAR_STATION_RELAX_MIN_M = 48` – `NEAR_STATION_RELAX_MAX_M = 256` m.
  - Bearing within `NEAR_STATION_AWAY_MAX_DEG = 75` of directly away from the volcano (relaxed `NEAR_STATION_AWAY_RELAX_DEG = 110`).
  - Score = cos(angle off "away") × `NEAR_W_AWAY = 2` − distance error × `NEAR_W_DIST = 1.5`, plus small same-terrace / enclosure / lower-ground bonuses.
  - **Campfire line of sight** (`nearStationHasHearthLos`): from eye height `NEAR_LOS_EYE_M = 1.7` above the hearth to the seated tip `NEAR_LOS_TIP_M = 4` above the socket ground. Terrain only (trees and snow are not counted). Required in every pass except the last two, which are logged as `LAST RESORT: no campfire line of sight`.
  - Passes: band+away+los → relaxed+away+los → relaxed+wideAway+los → relaxed+anySide+los → relaxed+wideAway+NOLOS → relaxed+anySide+NOLOS. Up to `NEAR_STATION_TRIES = 8` ranked picks; `buildOnce` tries the next if station spacing blocks one. No near cell → far-only stations (logged).
  - `NEAR_LOS_TIP_M` must equal `FROZEN_TIP_Y_M` in `stationMarkers.ts` (duplicated so terrain gen does not import the client chain).

## Ignition cinematic (cinematic branch: `src/client/monumentCinematic.ts`, `src/client/ui/layers/layer.cinematic.tsx`, `src/client/ui/index.tsx`)

- **Trigger:** local only — `requestActivate` → `startIgniteCinematic` when *this* player ignites. Never from remote ignites, hydration or reloads, so it never replays.
- One VirtualCamera interpolated between live key poses (smoothstep), aimed via `lookAtEntity`; keys read the live obelisk rig.
- **Timeline** (T after ignition; the rise stays `MONUMENT_RISE_S = 10` for everyone):

  | T (s) | Shot / event |
  |---|---|
  | 0 | blend in from the player camera (`CINE_BLEND_IN_S = 0.6`) |
  | 0 – 2.5 | a) low close shot at the socket (`CINE_LOW_DIST_M = 7`, eye `CINE_LOW_EYE_M = 1.2`) looking up at the tip (`CINE_LOW_HOLD_FRAC = 0.25` of the rise) |
  | 2.5 – 6.5 | b) pull back and up tracking the top tip (`CINE_MID_END_FRAC = 0.65`; `CINE_MID_DIST_M = 28` or hover height × `CINE_MID_DIST_PER_H = 0.3`; height `CINE_MID_HEIGHT_FRAC = 0.65`) |
  | 6.5 – 8.4 | c) move to the wide shot (`CINE_WIDE_DIST_M = 58` or hover height × `CINE_WIDE_DIST_PER_H = 0.5`), reached `CINE_WIDE_LEAD_S = 0.2` before the sky drop |
  | 8.6 – 10.0 | sky beam drops (`CINE_SKY_DROP_S = 1.4`) during the end of the rise and lands in the top tip as the rise ends; wide keeps easing to 10.2 (`CINE_WIDE_LAND_S = 0.2`) |
  | 10.0 – 10.6 | settle (`CINE_SETTLE_S = 0.6`) |
  | 10.6 – 12.4 | volcano beam draws (`CINE_VOLCANO_DRAW_S = 1.8`) + `beam.wav`; camera in behind the bottom tip by 11.0 (`CINE_BEAM_CUT_S = 0.4`; `CINE_BEAM_BACK_M = 14`, `CINE_BEAM_UP_M = 5`, `CINE_BEAM_SIDE_M = 5`), then dolly `CINE_BEAM_DOLLY_M = 22` along the beam |
  | 12.4 – 13.2 | hold on the volcano (`CINE_END_HOLD_S = 0.8`) |
  | 13.2 – 14.2 | blend back to the player camera (`CINE_BLEND_OUT_S = 1.0`) |

  **Total ≈ 14.2 s** (was ≈ 21 s).
- The sky-beam overlap, settle and draw timings apply on **this client only** while `slot.cine` is set; the server and other players keep the normal sequence (settle 0.6, sky 1.2, volcano 1.5 s after the rise). Skipping mid-drop hands back to the normal sequence, which finishes the reveal.
- **Survival pause:** while the cinematic (incl. blend-out) runs, the watching player's frost, warmth reserve, day-idle drain and torch fuel are held exactly (`isSurvivalPausedByCinematic`, read by `frost/accumulation.ts` and `torchInput.ts`; paused time is dropped, not banked). The frost-rising state is cleared, so no tint / flash / freeze sound. Both are client-owned, so no server message and nobody else is affected. Ends on finish, skip, abort (reset / layout rebuild) or a wall-clock cap `CINE_SURVIVAL_PAUSE_MAX_S = 30`, which also force-ends the cinematic.
- Camera safety: `CINE_GROUND_CLEAR_M = 2` above terrain, `CINE_BOUNDS_MARGIN_M = 2` inside the scene, `CINE_CEILING_MARGIN_M = 3` under the height limit.
- **Letterbox:** two full-width black bars, `CINE_BAR_FRAC = 0.12` of screen height each, slide in / out over `CINE_BAR_SLIDE_S = 0.6`.
- **HUD hide:** `hideDuringCinematic` wraps the gameplay HUD layers (overview pan controls, action bar, frost bar, hotbar + bridge, relight / feed / chop / campfire-or-monument prompts, help panel) and sets `display: 'none'` while active, without unmounting. Splashes / death screens stay above.
- **Input:** `InputModifier` disableAll while running, only if no other system already owns one.
- **Skip:** E / Space / click after `CINE_SKIP_GRACE_S = 0.75`, or the SKIP label in the bottom bar (mobile). Layout rebuild / cycle reset aborts with no blend.

## Isometric overview camera (cinematic branch: `src/client/topDownCamera.ts`)

- The HUD camera button / **1** key now enters an angled isometric view instead of the straight-down overview. Public API unchanged.
- Pose: pitch `ISO_PITCH_DEG = 35.26` down, yaw `ISO_YAW_DEG = 45` (camera south-west of the focus looking north-east), `VirtualCamera.fov = ISO_FOV_DEG = 24` (was 30; SDK default 60). No orthographic camera in DCL, so it is approximated by a distant camera with a narrow FOV.
- Zoom keeps the old altitude scale (12 – 75, step 6, default 30 desktop / 20 mobile); distance = scale × `ISO_DIST_PER_SCALE` (tan 30° / tan 12° ≈ 2.72, same framing size as before) → 32.6 / 54.3 / 81.5 / 203.7 m at zoom 12 / 20 / 30 / 75 (height above focus 18.8 / 31.4 / 47.0 / 117.6 m). On mobile the camera passes the ~100 m fog band from zoom 42 up.
- Focus = player (follow) or the pan target; focus height follows the terrain under it.
- Safety: camera stays `ISO_BOUNDS_INSET_M = 2` inside the scene (pulls in toward the focus near the south / west edges), `ISO_GROUND_CLEAR_M = 3` above terrain below it, `ISO_CEILING_MARGIN_M = 3` under the limit; distance smoothed (`ISO_DIST_RATE = 6`).
- Pan in the rotated frame: screen-up = camera forward on the ground (NE), screen-right = SE. Desktop drag is grab-and-pull, the ground moves with the cursor (the pointer delta's y grows downward, so the vertical term uses +dy; fixed an inverted vertical pan; vertical drags ÷ sin(pitch) for foreshortening); the mobile d-pad's legacy axes are converted inside `beginPan`; movement keys recenter. Off-screen avatar hint re-derived for the tilted view.
- Transition speed `TRANSITION_SPEED = 260` m/s (was 200).

## Other changes in `7cfaf4b`

- **Snowfall** (`src/client/snowfall.ts`): one world-space particle column following the player (`SNOW_COLUMN_HALF_M = 160`, moves every `SNOW_FOLLOW_STEP_M = 4` m), spawning from `SNOW_BOTTOM_Y` up to `SNOW_TOP_Y` = height limit − `SNOW_CEILING_MARGIN_M = 6` (above hovering monuments); per-level `terminalSpeed`, lifetime derived so flakes from the top reach the lowest ground. `MAX_PARTICLES = 6000`.
- **Far snow LOD** (`src/client/snow/snowRenderer.ts`): distant 16 m nodes are full boxes with sides that just don't cast shadows (no more top-only planes floating next to lower snow).
- **Hidden fire ground fix** (`src/client/hiddenCampfire.ts`): pits take their Y from the terrain actually drawn (`activeTerrain`) and re-seat when the layout changes (`reseatPitsOnTerrain`). Check: `scripts/hiddenFireGroundCheck.mjs`.
- **Frost bar** (`layer.frostBar.tsx`): no deep-blue colour shift while frozen.
- **Day idle frost** (`src/client/frost/accumulation.ts`, `src/shared/frost/tuning.ts`): by day with the torch out and off snow, once the warmth reserve is empty frost creeps up slowly (`FROST_DAY_IDLE_FILL_S = 180`).

## Check scripts

| Script | What it reports |
|---|---|
| `node scripts/nearMonumentSideCheck.mjs [seeds=40] [profile...]` | Per seed: near distance, angle off "away" from the volcano, campfire LOS, pass used; totals, quantiles, farthest feasible LOS distance, min monument spacing. |
| `node scripts/monumentHoverCheck.mjs [seeds=40] [profile...]` | Hover bottom / top heights, height above ground, volcano beam angles, ceiling caps (mirrors `OB_TOTAL_M`, `HOVER_BOB_M`, `HOVER_CEILING_MARGIN_M` — keep in sync). |
| `node scripts/hiddenFireGroundCheck.mjs [seeds=40]` | Hidden campfire pits vs the drawn ground. |
| `node scripts/make-obelisk-glb.js` | Regenerates the obelisk GLBs. |

Bundles go to `scripts/out/` (git-ignored). Profiles default to `playtest_52` and `full_100`.
