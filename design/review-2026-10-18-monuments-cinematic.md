# Review handoff — monuments rework + `cinematic` branch (2026-10-18)

Full system reference with every tunable: [`session-2026-10-18-monuments-cinematic.md`](./session-2026-10-18-monuments-cinematic.md).

**Status:** `npx tsc --noEmit -p .` and `npm run build` pass, and the seed check scripts were run. **Nothing has been verified in a live preview.** `assets/scene/main.composite`, `scene.json` and `main.crdt` have local changes that are deliberately **not** committed.

## Branches and commits

| Branch | Commit | Contents |
|---|---|---|
| `main` | `457befe` | (earlier) Unified survival bar; monuments no longer give heat / melt. |
| `main` | `7cfaf4b` | Monuments: socketed obelisks with corner-ice melt test, hover bob / spin, fixed volcano beam, crystal hum + gaze sound, far-side near monument, snowfall column. Plus far snow LOD boxes, hidden fire ground fix, frost bar without dark-blue freeze, day-idle frost creep. |
| `cinematic` | head (on top of `7cfaf4b`) | Ignition cinematic + letterbox + HUD hide, 10 s rise, higher hover (+35 / ground + 70), seated pyramid flush with the ground (`NEAR_LOS_TIP_M` 4), isometric overview camera, `monumentHoverCheck` script, docs. **Not merged into `main`.** |

## Changes by area

### Monument look / socket — `stationMarkers.ts`, `terrainRenderer.ts` (`addMonumentPit`), `terrainMap.ts`
- Dark slate obelisk (14 m shaft + two 4 m pyramids, 3 m wide) in a 3.1 m × 1.5 m socket at the centre of a 6 m square; no recess, no steps.
- Dark border flush with the ground; invisible physics collider fills the socket to ground level.
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
- Bob ±2.5 m / 10 s, spin 5°/s, eased in over 4 s after the rise.
- Sky beam into the top tip; volcano beam from the bottom tip with a fixed world endpoint (`aimVolcanoBeam`).

### Sound — `stationMarkers.ts`
- Crystal hum (`crystal.mp3`) positional, 0.7, from 2 m above the socket.
- Gaze hum: 2D loop, 0.25, 12° cone, fade 1.5 / 2 s, skips obelisks < 8 m away horizontally.

### Ignition cinematic — `monumentCinematic.ts` (new), `layer.cinematic.tsx` (new), `ui/index.tsx`, `stationMarkers.ts` (`startIgniteCinematic`, `slot.cine`) — `cinematic`
- Local only (from the local ignite request; never on hydration / remote ignites).
- Shots: low close look-up (first 30% of the rise) → pull back tracking the tip → wide with the sky beam → behind the bottom tip dollying along the volcano beam → hold → 1.5 s blend back. ≈ 19 s + blend-out.
- Client-only phase stretch while running: settle 1.6 s, sky drop 2.4 s, volcano draw 3.0 s.
- Letterbox 12% bars (0.6 s slide), gameplay HUD hidden via `hideDuringCinematic` (display none, no unmount), `InputModifier` disableAll if free, skip on E / Space / click after 0.75 s or the SKIP label.
- Camera clamped 2 m above terrain, 2 m inside bounds, 3 m under the ceiling.

### Isometric overview — `topDownCamera.ts` — `cinematic`
- Pitch 35.26°, yaw 45°, `VirtualCamera.fov` 30°, distance = old altitude scale × ~2.15 (26–162 m).
- Pan: screen-up = NE ground direction, screen-right = SE; drag ÷ sin(pitch) vertically; d-pad legacy axes converted in `beginPan`.
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
5. Watch the cinematic: bars slide in, HUD hides, shots track the rise / sky beam / volcano beam, blend back. Try skipping (E / Space / click / SKIP) and a second ignite.
6. With a second client: the remote player sees the normal (unstretched) rise, no cinematic; a late joiner sees the hover pose with both beams.
7. Find the iced far monument: 4 corner blocks, melt each with a lit torch (~6 s), melt sound, prompt only once all are gone.
8. Hovering obelisk: bob ±2.5 m, spin 5°/s, volcano beam endpoint stays fixed; crystal hum from the ground; gaze hum when looking at it from afar.
9. Press **1** / the camera button: isometric view, zoom in / out, drag pan and mobile d-pad follow the rotated frame, movement recenters; try near the south / west edges.
10. Snowfall: dense down to the ground, no visible spawn plane over mountains / volcano; check FPS in HEAVY.

## Known risks / untested

- No preview verification of anything above.
- **VirtualCamera blend-out** may hard cut instead of blending (transition on release untested).
- **Frost keeps running during the cinematic** (~20 s with input locked) — could chill / freeze a player at night.
- **FOV support:** `VirtualCamera.fov` is in the SDK (default 60) but units / limits are undocumented and some explorers may ignore it (view would be wider, still functional).
- **Mobile fog at far iso zoom:** above zoom ~46 the camera passes ~100 m and may hit mobile fog; max zoom 75 → ~162 m.
- **Snowfall** density / particle cost and the ±160 m column edge are untested in the explorer.
- **Trees are not counted** in the near-monument campfire LOS check (terrain only), so a tree can still hide the tip.
- **`NEAR_LOS_TIP_M` (terrainGen) duplicates `FROZEN_TIP_Y_M` (stationMarkers)**; they must be kept equal by hand. `monumentHoverCheckEntry.ts` also mirrors `OB_TOTAL_M` / `HOVER_BOB_M` / `HOVER_CEILING_MARGIN_M`.
- Cinematic total is ~19 s (+1.5 s blend), a bit over the 12–18 s target after the 10 s rise.
- Iso camera pulls in near the south / west scene edges (camera clamp) — framing changes there.
- The campfire info board still lies flat in the iso view (legible but foreshortened).

## Open questions

- With monuments giving no heat, is carrying a lit torch at night safe enough on the trip out?
- Should each landed beam partially thaw the volcano (instead of all at 3/3)?
