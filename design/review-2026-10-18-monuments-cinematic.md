# Review handoff — monuments rework + `cinematic` branch (2026-10-18)

> **Status 2026-10-28:** snapshot of the classic volcano ruleset (3 monuments, volcano beams / thaw wave, hidden campfires). The current build runs `RULESET = 'floating-crystals'` (6 monuments charged by player-built fires, oasis, World Thaws ending); see [`../docs/HANDOFF.md`](../docs/HANDOFF.md). Where this note and the code disagree, the code wins.


Full system reference with every tunable: [`session-2026-10-18-monuments-cinematic.md`](./session-2026-10-18-monuments-cinematic.md).

**Status:** `npx tsc --noEmit -p .` and `npm run build` pass, and the seed check scripts were run. **Nothing has been verified in a live preview.** `assets/scene/main.composite`, `scene.json` and `main.crdt` have local changes that are deliberately **not** committed.

## Branches and commits

| Branch | Commit | Contents |
|---|---|---|
| `main` | `457befe` | (earlier) Unified survival bar; monuments no longer give heat / melt. |
| `main` | `7cfaf4b` | Monuments: socketed obelisks with corner-ice melt test, hover bob / spin, fixed volcano beam, crystal hum + gaze sound, far-side near monument, snowfall column. Plus far snow LOD boxes, hidden fire ground fix, frost bar without dark-blue freeze, day-idle frost creep. |
| `cinematic` | `865763f` (on top of `7cfaf4b`) | Ignition cinematic + letterbox + HUD hide, 10 s rise, higher hover (+35 / ground + 70), seated pyramid flush with the ground (`NEAR_LOS_TIP_M` 4), isometric overview camera, `monumentHoverCheck` script, docs. |
| `cinematic` | head (follow-up) | Survival pause during the cinematic, cinematic retimed to ≈ 14.2 s, `beam.wav` on the volcano beam, bob ±0.3 m, matte deep-black monument material (`monumentMaterial.ts`, regenerated glbs), iso FOV 24°, desktop pan vertical fix, docs. **Not merged into `main`.** |

## Changes by area

### Monument look / socket — `stationMarkers.ts`, `terrainRenderer.ts` (`addMonumentPit`), `terrainMap.ts`
- Matte deep-black obelisk (14 m shaft + two 4 m pyramids, 3 m wide) in a 3.1 m × 1.5 m socket at the centre of a 6 m square; no recess, no steps.
- Black border flush with the ground (same matte material: `MONUMENT_BLACK` 0.02, metallic 0, roughness 1, specular 0, black reflectivity; glb parts overridden with `GltfNodeModifiers`, glbs regenerated to match; beams unchanged); invisible physics collider fills the socket to ground level.
- `cinematic`: `FROZEN_SHAFT_ABOVE_GROUND_M = 0` → only the 4 m top pyramid shows.

### Ice test — `src/shared/monumentIce.ts`, `src/server/stations.ts`, `src/server/snowState.ts`, `messages.ts`
- One monument per seed (`icedStationIndex`, seed hash over non-near stations; the near one never has ice).
- 4 corner blocks (2 × 2 of 3 m), 1.0 m ice + 0.5 m snow cap; lit torch within 3 m melts a block in 6 s (refreeze 12 s).
- Server bitmask via `monumentIceMelt` / `monumentIceState`; activation refused while ice remains; snow over melted blocks cleared; pit snow released after activation.
- Melt loop volume 0.3, remote hits 0.4 within 40 m.

### Ignite prompt — `stationMarkers.ts` (`getMonumentPromptText`, `isReadyToIgniteMonument`), `layer.hiddenCampfirePrompt.tsx`
- Only **IGNITE MONUMENT**; shown only within 5.5 m XZ / 4 m height, with no ice left and a lit torch. E, tap or the mobile torch button.

### Placement — `src/shared/terrain/terrainGen.ts` (`pickNearStation`, `nearStationHasHearthLos`)
- Near monument: target 160 m (band 136–192, relaxed 48–256), within 75° of directly away from the volcano (relaxed 110°), terrain LOS from campfire eye (1.7 m) to the seated tip (`NEAR_LOS_TIP_M = 4`) required except in the two logged last-resort passes.
- No station needs volcano LOS (hover + `beamLiftM` instead).
- Root cause of the old bias: a `facing` score term pulled the near monument toward the volcano while the other terms were nearly uniform.

### Rise / hover / beams — `stationMarkers.ts`, `terrainMap.ts` (`monumentHoverBottomY`)
- `MONUMENT_RISE_S = 10` (all clients; `cinematic`), `MONUMENT_HOVER_ABOVE_TARGET_M = 35`, `MONUMENT_HOVER_BOTTOM_H_M = 70` (`cinematic`), top tip ≥ 24 m under the ceiling.
- Bob ±0.3 m / 10 s (barely noticeable), spin 5°/s, eased in over 4 s after the rise.
- Sky beam into the top tip; volcano beam from the bottom tip with a fixed world endpoint (`aimVolcanoBeam`).

### Sound — `stationMarkers.ts`
- Crystal hum (`crystal.mp3`) positional, 0.7, from 2 m above the socket.
- `beam.wav` (camera-parented one-shot, `BEAM_SFX_VOLUME = 0.8`) for the igniting player when the volcano beam starts drawing; still plays if the cinematic was skipped.
- Gaze hum: 2D loop, 0.25, 12° cone, fade 1.5 / 2 s, skips obelisks < 8 m away horizontally.

### Ignition cinematic — `monumentCinematic.ts` (new), `layer.cinematic.tsx` (new), `ui/index.tsx`, `stationMarkers.ts` (`startIgniteCinematic`, `slot.cine`) — `cinematic`
- Local only (from the local ignite request; never on hydration / remote ignites).
- Timeline (≈ 14.2 s total): blend in 0.6 s → low look-up 0–2.5 → pull back 2.5–6.5 → wide by 8.4 → sky beam drops 8.6–10.0 and lands as the rise ends → settle 10.0–10.6 → volcano beam + `beam.wav` 10.6–12.4 (camera behind the bottom tip by 11.0, dolly along the beam) → hold to 13.2 → blend out 1.0 s to 14.2.
- Client-only while running: sky drop overlaps the rise (1.4 s), settle 0.6 s, volcano draw 1.8 s; others see the normal sequence.
- Survival pause: frost, warmth reserve, day-idle drain and torch fuel held for the watcher (client-owned, no server message), cleared frost-rising state (no tint / flash / sound); ends on finish / skip / abort or a 30 s wall-clock cap that also force-ends the cinematic.
- Letterbox 12% bars (0.6 s slide), gameplay HUD hidden via `hideDuringCinematic` (display none, no unmount), `InputModifier` disableAll if free, skip on E / Space / click after 0.75 s or the SKIP label.
- Camera clamped 2 m above terrain, 2 m inside bounds, 3 m under the ceiling.

### Isometric overview — `topDownCamera.ts` — `cinematic`
- Pitch 35.26°, yaw 45°, `VirtualCamera.fov` 24° (was 30°), distance = old altitude scale × ~2.72 (32.6 / 54.3 / 81.5 / 203.7 m at zoom 12 / 20 / 30 / 75), same framing size.
- Pan: screen-up = NE ground direction, screen-right = SE; desktop drag is grab-and-pull (vertical sign fixed: it was inverted), ÷ sin(pitch) vertically; mobile d-pad is a separate path (`beginPan`, legacy axes converted), unchanged.
- Camera kept 2 m inside bounds (pulls in near S / W edges), 3 m above terrain, 3 m under ceiling. Transition 260 m/s.

### Other (`7cfaf4b`)
- Snowfall: world-space column following the player (±160 m), spawning up to ceiling − 6 m, capped fall speed, lifetime derived to reach the lowest ground.
- Far snow LOD: shadowless boxes with sides instead of top-only planes.
- Hidden fire pits re-seated on the drawn terrain (`reseatPitsOnTerrain`).
- Frost bar: no deep-blue shift while frozen. Day idle: frost creeps up slowly once the reserve is empty (`FROST_DAY_IDLE_FILL_S = 180`).

## How to test

1. `git checkout cinematic && npm install && npm start` (plus `npm run auth-server` in a second terminal).
2. Seed checks: `node scripts/nearMonumentSideCheck.mjs 40`, `node scripts/monumentHoverCheck.mjs 40`, `node scripts/hiddenFireGroundCheck.mjs 40`.
3. From spawn: look away from the volcano; a pyramid tip of the near monument should be visible from the campfire (may be barely visible).
4. Walk up with the torch out → no prompt. Light the torch → **IGNITE MONUMENT** → press E.
5. Watch the cinematic (≈ 14 s): bars slide in, HUD hides, sky beam lands as the rise ends, `beam.wav` as the volcano beam starts, blend back. Frost bar and torch fuel must not move during it (try at night). Try skipping (E / Space / click / SKIP) before and after the beam and a second ignite.
6. With a second client: the remote player sees the normal (unstretched) rise, no cinematic; a late joiner sees the hover pose with both beams.
7. Find the iced far monument: 4 corner blocks, melt each with a lit torch (~6 s), melt sound, prompt only once all are gone.
8. Hovering obelisk: matte deep black with no highlights, bob ±0.3 m, spin 5°/s, volcano beam endpoint stays fixed; crystal hum from the ground; gaze hum when looking at it from afar.
9. Press **1** / the camera button: isometric view, zoom in / out, desktop drag moves the ground with the cursor (check vertical), mobile d-pad follows the rotated frame, movement recenters; try near the south / west edges.
10. Snowfall: dense down to the ground, no visible spawn plane over mountains / volcano; check FPS in HEAVY.

## Known risks / untested

- No preview verification of anything above.
- **VirtualCamera blend-out** may hard cut instead of blending (transition on release untested).
- **Survival pause** relies on the cinematic lifecycle + the 30 s cap; untested in the explorer.
- **Matte material:** `GltfNodeModifiers` material override and `reflectivityColor` / `specularIntensity` support depend on the explorer; the regenerated glbs are matte too, but `KHR_materials_specular` may be ignored.
- **FOV support:** `VirtualCamera.fov` is in the SDK (default 60) but units / limits are undocumented and some explorers may ignore it (view would be wider, still functional).
- **Mobile fog at far iso zoom:** with FOV 24° the camera passes ~100 m from zoom 42 up; max zoom 75 → ~204 m (foggy on phones). A zoom cap of ~36 would avoid it. Longer throw also pulls in near S / W edges more often and may hit the ceiling clamp at max zoom over high ground.
- **Snowfall** density / particle cost and the ±160 m column edge are untested in the explorer.
- **Trees are not counted** in the near-monument campfire LOS check (terrain only), so a tree can still hide the tip.
- **`NEAR_LOS_TIP_M` (terrainGen) duplicates `FROZEN_TIP_Y_M` (stationMarkers)**; they must be kept equal by hand. `monumentHoverCheckEntry.ts` also mirrors `OB_TOTAL_M` / `HOVER_BOB_M` / `HOVER_CEILING_MARGIN_M`.
- Cinematic ≈ 14.2 s, slightly over the 13–14 s target; the wide → beam-shot move is the tightest (0.8 s).
- Sky beam drops while the obelisk is still finishing its rise (cinematic only): a small gap closes as it lands; check it reads well.
- Iso camera pulls in near the south / west scene edges (camera clamp) — framing changes there.
- The campfire info board still lies flat in the iso view (legible but foreshortened).

## Open questions

- With monuments giving no heat, is carrying a lit torch at night safe enough on the trip out?
- Should each landed beam partially thaw the volcano (instead of all at 3/3)?
