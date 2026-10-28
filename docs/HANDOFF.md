# Handoff - floating-crystals build (520cc6b -> f22ee9e)

Branch `floating-crystals`. Latest commit `f22ee9e` (2026-10-28). Written 2026-10-28 against the code at that commit. Ruleset: `RULESET = 'floating-crystals'` (`src/shared/ruleset.ts`). Profile `playtest_52` (52 x 52 parcels).

Nothing here is verified in-game by the author of this doc: the facts below come from the code and the check scripts. Items that need eyes are listed under Known issues.

## The game now (one paragraph)

Players start at a permanent hearth, carry a lit torch, and **build their own fires** from logs (hidden campfires are gone). Fires within 140 m link into a network; fires within 40 m of a monument with a routed link **charge** it. A full charge **releases** the monument: it rises, a sky beam lands in its tip, it charges 2 s and bursts, melting a 50 m heat zone and an **oasis** (a ragged clearing of bare earth that regrows grass, bushes, rocks and pines). Six monuments per world. Releasing the last one starts the **"THE WORLD BEGINS TO THAW"** ending (section 9). A fire that runs out turns to ash and disappears; it cannot be relit, so logs are always needed.

## What changed, by commit

| Commit | Date | Summary |
|---|---|---|
| `fffbc4f` | 10-27 | Charge/burst cinematic rework, campfire squat emote, dense fire links, flame variety, Biggest Firenet tab, sticks removed, server session resync, leaderboard tabs |
| `6ba5778` | 10-27 | Monument burst: `release_burst` clip dropped, charge cue and original beam sound kept |
| `08837c7` | 10-27 | Oasis gradual melt + regrowth, hearth re-seat, charging hum, near-spawn monument ~41 m, earth colour |
| `471a9dc` | 10-27 | Smaller ragged oasis, spans terraces, pine/rock colliders, terrain base raised 0.1 m |
| `f22ee9e` | 10-28 | world-thaw ending, spent fires -> ash, monument cluster links, closer link ends, quieter sounds, oasis on wall tops, per-height grass merge fix, extra desktop zoom step |

`520cc6b` (restore monument snow burial, skip classic world thaw, disable finale beams, 90 degree rotate button) is the baseline; `fffbc4f` is its first child here.

## 1. Building a fire

- Needs: lit torch, a carried log, not at a fire/monument, not within `CAMPFIRE_RELIGHT_RADIUS_SQ_M` of the hearth. Prompt reads **BUILD CAMPFIRE** only when the server would accept it (`src/client/buildFire.ts`).
- E / torch button: the player plays the **campfire emote** (`assets/animations/campfire_emote.glb`, 2.57 s: squat over the logs, strike with quick alternating hand strokes, flare-up, stand). Movement is locked for 2.6 s (`src/client/campfireEmote.ts`, `lockedEmote.ts`, `movementLock.ts`; camera look still works; lock folded into the locomotion InputModifier profile). The server refusing the build calls `stopCampfireEmote` and returns the log.
- The fire spawns **1.2 m ahead** of the player (`BUILT_FIRE_FRONT_M`, `builtFireFrontSpot`): client sends feet position + facing yaw, client pre-check and server derive and validate the same point. The fire appears when the server accepts, not at the end of the clip.
- Rules (`ruleset.ts`): min spacing 18 m from any burning fire, max 40 burning built fires (`BUILT_FIRE_MAX`), slope check 0.3 m over 1.5 m, snow stage <= 1 at the spot, not next to a monument pit (`BUILT_FIRE_MONUMENT_CLEAR_M` 2 m on top of the station clearance), 4 m of the crater heat disc, not on lava / mountain level.
- A log is 120 s of fuel (`LOG_FUEL_SECONDS`); a fresh built fire starts with one log.
- **Torch emote removed**: there is no torch-light emote; `lockedEmote.ts` still mentions a `torchLightEmote.ts` in its header comment, that file does not exist (stale comment).
- **Sticks / branches removed**: logs are the only wood (`src/shared/woodKind.ts`, `WOOD_KIND_LOG = 1`). `assets/models/branch.glb` and `assets/images/branch.png` deleted. The wire still carries a kind int so old messages parse.

## 2. Spent fires (ash)

A built fire whose fuel hits 0 is **spent** (`src/server/hiddenCampfire.ts` `markSpent`):

- Stones go dark, a grey ash disc (diameter 1.1 m, `ASH_COLOR` 0.42 grey) shows, a small smoke wisp for `SPENT_FIRE_WISP_S` = 8 s. No relight prompt; a torch cannot relight it (client skips spent slots, server refuses ignite).
- `SPENT_FIRE_REMOVE_S` = 60: after that the server removes it (`fireRemoved`), its network links drop, the slot is free.
- Ash is ignored for build spacing, the 40-fire cap and charging. A new fire built within `SPENT_FIRE_CLEAR_M` = 2.5 m of ash clears that ash at once.
- Exempt: the hearth and monuments. A lit torch can still spark a **dead hearth** to Ember (`hearthSparkRequest`).
- Late joiners get `fireSpent` with an age so the ash/wisp state matches.
- The run itself still ends only when no campfire and no torch is lit for `WORLD_FLAME_GRACE_MS` = 4 s (`src/server/worldFlame.ts`).
- Check: `node scripts/spentFireCheck.mjs`.

## 3. Fire network

File: `src/shared/fireNetwork.ts` (pure, shared); server `src/server/fireNetwork.ts`, `fireNetworkLinks.ts`; client glow `src/client/fireNetworkGlow.ts`.

- **Dense topology** (`NETWORK_TOPOLOGY = 'dense'`): every pair within `NETWORK_DENSE_RANGE_M` 140 links except near-duplicates (`NETWORK_DENSE_COLLINEAR_DEG` 25); parallel-route drop and cross drop still apply; reconnect step joins split pieces. (`rng`, `gabriel`, `legacy` kept as switches.)
- **Monument trees**: fires with a charge link link only to the monument; relay fires link to one parent one hop closer (`NETWORK_MONUMENT_TREE_ENABLED`, `NETWORK_TREE_FIRE_HOPS` 2). Chain charging: hops 1..3 with weights `CHARGE_HOP_FACTOR` [1, 0.6, 0.35].
- **Cluster links** (`NETWORK_CLUSTER_LINKS_ENABLED`, `NETWORK_CLUSTER_LINKS_WANT` 2): every hop-1 fire also links to its 1..2 nearest other fires of the same monument, so the fires feeding a monument visibly support each other. They skip the near-duplicate prune, parallel drop and cross drop (a crossing-free route is only preferred). Chain hops and charge never change.
- **Link ends near the obelisk**: `CHARGE_LINK_END_HALF_M` = 1.8 (Chebyshev from the monument centre, ~0.3 m off the obelisk face; was 3.75 m, ~5 m out). Client clears glow pieces only 0.5 m around it (`NETWORK_TILE_MONUMENT_CLEAR_M`).
- Monument node ids start at `MONUMENT_NODE_ID_BASE` 1000. Monument links always keep (`NETWORK_MONUMENT_LINKS_KEEP_ALL`).
- Routes: A* over terrain incl. ladders; shared code on server and clients; path width 4 m, orbs 0.25 m every 1.5 m (see `design/decisions.md` 2026-10-26 for the older tuning).
- Checks: `topologyCheck`, `routeEndCheck`, `fireShareCheck`, `fireNetworkVCheck` (see odd output note below).

## 4. Biggest Firenet leaderboard tab

`src/shared/leaderboard.ts`, `src/server/leaderboard.ts`, `src/client/leaderboard.ts`, `src/client/ui/layers/layer.leaderboard.tsx`.

- Four boards over one stored record per wallet: `longest` (days in one run), `fastest` (6/6 completion: days then real seconds), `monuments` (lifetime released), `firenet` (most campfires in one connected network the player built or fed; networks of 2+ only; `networkCredits`).
- Storage key `cryocene.leaderboard.v2` (the optional `fn` field is compatible, no bump). 300 players stored, 10 rows shown.
- HUD star button, hotkey 3 (1 view, 2 mute, 3 leaderboard, 4 help). Opening the leaderboard closes the help panel and vice versa.
- A run is **tainted** (no leaderboard writes) when a dev shortcut was used (`src/server/runIntegrity.ts`: dev advance phase, debug thaw / finale / volcano-stage buttons).
- Check: `node scripts/leaderboardCheck.mjs`.

## 5. Flame variety

`src/shared/flameVariant.ts`, `src/client/flameBillboards.ts`. Each fire gets a deterministic variant: size +-22 %, speed 0.75..1.3x, heat colour shift 0.12, arm yaw jitter 14 deg, tongue/ember period and height variance, max 16 tongues / 16 embers. `FLAME_NEUTRAL` is the baseline. Check: `flameVariantCheck`.

## 6. Monument release sequence and sound

Timeline (`src/shared/ruleset.ts`, `src/client/stationMarkers.ts`, `src/client/monumentCinematic.ts`, `src/shared/crystalCineFrame.ts`):

1. Hold 2 s (`CRYSTAL_RELEASE_HOLD_S`), then rise 4 s (`CRYSTAL_RISE_S`) to the float height (`CRYSTAL_FLOAT_HEIGHT_M` 25 m).
2. Sky beam drops over the last 1.4 s (`CRYSTAL_SKY_DROP_S`) and lands in the top tip.
3. **Charge 2 s** (`CRYSTAL_CHARGE_S`), no colour change / tint, then the burst sphere (`CRYSTAL_BURST_S` 3 s) which the server thaw front tracks to the 50 m radius (`CRYSTAL_HEAT_RADIUS_M`).
4. The sky beam stays on permanently with a slow synced idle pulse.
- Cinematic (every viewer who can watch it, i.e. not frozen / loading / ember-fail; skippable, letterboxed; late joiners never replay it): `CINE_CRYSTAL_FOV_DEG` = 60, end pose frames the whole thaw disc, zoom lead `CINE_CRYSTAL_ZOOM_LEAD_S` 2.5 s, end hold 2 s. `CRYSTAL_THAW_DELAY_S` = hold + rise + charge = 8 s.
- **Sounds**:
  - `assets/sounds/monument.mp3` plays once when the monument starts to rise (fresh activation only; positional; `playIgnitionSfx`).
  - `assets/sounds/crystal.mp3` loops from the moment the sky beam lands (`startHum`, volume `CRYSTAL_HUM_VOLUME` 0.7; positional from 2 m above the socket). Late joiners start it at once.
  - Burst / pulse cue (`beam.wav` via `playBeamSfx`): `BURST_SFX_VOLUME` 0.22 (was 0.45).
  - Unused now: `charge.wav`, `charge_start.wav`, `release.wav`, `release_burst.wav` (the release_burst clip was dropped in `6ba5778`; `scripts/trim-release-burst.js` is leftover).
- **Charging hum** (`src/client/monumentChargeHum.ts`, `assets/sounds/hum.mp3`): one shared camera-attached voice while any monument charges. Volume `CHARGE_HUM_VOLUME` 0.25 x distance gain, where the distance is from the **monument only** (fires never count) to the nearer of the avatar and the overview camera focus: full within 6 m, falling off squared to silence at 160 m (~0.6 at 40 m). Fades 1.0 s in / 0.6 s out. Ignores the mute toggle (mute is music only).
- Check: `cineFrameCheck`, `monumentHoverCheck`.

## 7. Monument placement

- Six per world (`MONUMENT_COUNT`), distance bands from the hearth (`MONUMENT_DISTANCE_BANDS`), min 35 deg apart, soft outer-wall bias (`MONUMENT_EDGE_PREF_M` 30).
- **Near-spawn monument ~41 m** from the hearth (`CRYSTAL_NEAR_MONUMENT_TARGET_M` 40, band 36..44, relax to 60). `monumentCountCheck` reports nearest 41 m on all 12 seeds. 
- 6 loose logs near every monument (12..40 m). A guaranteed log cluster sits near the ice-locked monument (`WOOD_ICED_CLUSTER_*`). Its ice mound recedes chunk by chunk as it charges (`recedeIce` in `stations.ts`, all gone at `CHARGE_ICE_GONE_AT` 0.9); no torch melting.
- **Test value**: `CHARGE_TARGET_S = 60` (comment: "TEST VALUE for playtesting, design target 210"). Reference setup of 3 fires at 20 m charges in 60 s. Check this before a real deploy.
- Checks: `monumentCountCheck`, `nearMonumentSpawnCheck`, `monumentEdgeCheck`, `crystalCheck`, `byofCheck`, `byofCapCheck`.

## 8. Oasis (permafrost melt and regrowth)

Files: `src/shared/terrain/oasis.ts` (registry + cell math, shared by client and server ground queries), `oasisVeg.ts` (deterministic plan), `src/client/terrain/oasisVegetation.ts` (entities), `terrainRenderer.ts` (cap/earth pieces), `src/client/hearthSeat.ts` (hearth re-seat).

- Every terrain rect has a **cap** (`CAP_M` 0.28 m, was 0.15, melt-blue) on top of the rock. An oasis removes the cap and shows **earth** (`COLOR_EARTH`, grey-brown) `OASIS_DROP_M` = 0.27 m lower (under `DCL_MAX_AUTO_STEP_M` 0.3).
- Cells are 4 m (`OASIS_CELL_M`) on **every walkable terrace** in reach and on **mountain wall tops** (blocks with a flat top inside the circle; each cell keeps its own terrace height; cliff walls untouched). Never on lava, the volcano crown, or the monument pit square.
- Timing, all derived from the server release age (`ageMs`), so late joiners see the same state: the burst melts the inner `OASIS_INNER_M` 12 m **instantly**; from the end of the burst the rest melts **outward over `OASIS_MELT_S` 60 s** in 4 m rings (`OASIS_BAND_M`) with a per-cell ragged edge (`OASIS_JITTER_M` 4), to a nominal `OASIS_RADIUS_M` 32 m (28..36 m). The snow itself still melts to 50 m; the caps beyond stay frozen for good.
- Oases are permanent for the cycle; overlaps are a plain union.
- **Regrowth** (seconds after a cell melts): grass pops in 2..42 s in dark/mid/light patches (10-20 % of cells stay bare earth); rocks from 10 s; bushes from 14 s (scale in 6 s); pines from 15 s, growing 45..80 s; sized 4.5..30.5 m (tall ones >= 19 m kept 13 m apart). Caps per oasis scale with area: trees `VEG_MAX_TREES`, bushes `VEG_MAX_BUSHES`, rocks `VEG_MAX_ROCKS` (area scale 0.46 of the original 47 m oasis).
- **Colliders** (physics layer only): pine trunks (once growth >= 0.3) and rocks. Bushes have none. A collider is never switched on while the player stands in its footprint. Keep-clear: monument pit + 3 m, hearth 6 m, ladders 7 m, cliff edge 1.5 m.
- **Per-height grass merge**: finished grass is greedy-merged into rectangles per owner, but only cells at the **same floor height** merge (`mergeGrassRects`), so every merged piece sits at its own floor. This fixed grass floating at the top level's height.
- **Terrain base raised 0.1 m**: `TERRAIN_BASE_SURFACE_Y` 0.25 -> 0.35 (`src/shared/settings.ts`) so the earth stays above the ground plane.
- Check: `node scripts/oasisCheck.mjs` (asserts no lowered cell sits in an uncapped rect, per-height merge, colliders).
- Rough entity cost: ~120 settled per oasis (about 15 pines, 33 bushes, 8 rocks, 68 merged grass), peak ~185 while growing, plus ~55 terrain pieces. Six oases ~700-1100 extra entities. **Not measured on mobile.**

## 9. Ending: "THE WORLD BEGINS TO THAW"

Files: `src/shared/finale.ts` (pure timeline + ring + camera pose), `src/shared/terrain/oasis.ts` (the enlarged oasis), `src/server/stations.ts` (schedule + snow), `src/client/crystalFinale.ts` (beams, pulse, camera, title), `stationMarkers.ts` (`startFinalePulse`), `monumentCinematic.ts` (`startFinaleCinematic`), `thawSplash.ts` + `shared/titleFit.ts` (title).

- Starts `FINALE_START_DELAY_S` = 14.5 s after the LAST monument's release (6th in the standard profile, 3rd in `compact_3`; its own cinematic finishes first). Server sends `crystalFinaleState` (hydrated to late joiners).
- **Beams**: `FINALE_BEAM_BEAT_S` 1.5 s after the start, ALL ring beams draw at the same time (`FINALE_BEAM_DRAW_S` 2.5 s, one shared progress) between the top tips of all monuments (closed ring, `finaleOrder`: shortest non-crossing tour, counter-clockwise). Thickness `FINALE_BEAM_XZ_M` 0.42 = the vertical (sky) monument beam (`stationMarkers.SKY_BEAM_XZ_M` is defined from it), same glow material. They stay up.
- **Pulse**: `FINALE_PULSE_GAP_S` 0.8 s after the ring closes every monument releases the same pulse: a bright expanding energy sphere (the release burst's look, reused burst sound) and a **much larger melt** around each monument. Tunable constants: `OASIS_FINALE_RADIUS_M` = 64 m (nominal, ragged +/- 4 m, multiple of 4) and `OASIS_FINALE_MELT_S` = 60 s (how long the permafrost cap / earth / plants take to open, like the first oasis). The SNOW is much faster: `FINALE_PULSE_S` = 12 s. The first oasis stays 32 m (unchanged for the normal release).
  - Ground (cap removed, earth floor, re-seating of logs / fires / props): `oasisSetFinalePulse(ms)` schedules it; the existing oasis registry keeps growing every oasis to 64 m over `OASIS_FINALE_MELT_S` (linear, from the radius it had when the pulse started: 32 m, or less for the last oasis if it is still melting, so there is no jump; `oasisEntryPulseReveal`) with the same cell / jitter / pit / lava / crown rules (cells beyond 32 m just get a later melt time, ~8 ring steps of 4 m about 7.5 s apart). `finaleTimes().pulseAtS` is derived from the finale start on the server and every client, so a late joiner (even after the pulse) sees the finished state; `oasisClear` does not reset it (`resetFinale` / `resetForCycle` do).
  - Warmth: `finaleWarmRadiusM(pulseMs, now)` (shared): every released monument's warm / frost-safe radius (`stationMarkers.crystalHeatAt`, the only warmth source for the frost model) is `CRYSTAL_HEAT_RADIUS_M` (50 m) until the pulse and grows linearly with the snow front (`FINALE_PULSE_S`) to `FINALE_WARM_RADIUS_M` = 68 m (= the snow disc incl. the ragged edge), so it always covers the melted snow and the oasis. It depends only on the pulse time (derived from the finale start, same on every client / late joiner). No separate indicator exists: the frost bar just reads the warmth.
  - Snow: the server starts one held heat front per monument (`startHeatZoneFront`, radius `FINALE_SNOW_RADIUS_M` 68 m, `FINALE_PULSE_S`), same stepping 2 -> 1 -> 0 as a release, held melted for the rest of the cycle.
  - Vegetation: the cells opened only by the pulse form their own group per oasis (`<x,z>#f`) planned when the pulse is scheduled (`oasisCapR` changes -> `oasisVegetation.sync` replans only the new cells; already planned cells are never touched). Same grass / pine / bush / rock rules and timings relative to each cell's melt time; the per-oasis caps scale with the number of ring cells (`VEG_BASE_CELLS`), i.e. the same density as the first patch.
- **No thaw corridors** any more (`corridorStep` etc. removed from `finale.ts` / `snowState.ts`).
- **Title**: `FINALE_TITLE = 'THE WORLD BEGINS TO THAW'`, `FINALE_TEXT_AFTER_PULSE_S` 2 s after the pulse starts (~4.6 s card). `shared/titleFit.ts` keeps it on one line when it fits and else breaks it in the middle into two lines and shrinks it to fit (390 px portrait phone: 2 lines at ~36 px; 1080 px+ desktop: 2 lines at 96 px, 1 line at 1920 px).
- **Camera**: one steady high pose that frames the whole ring (`finaleCameraPose`, FOV 60, letterbox; `finalePoseOpts` for compact) from the first frame to `pulseEnd + 3.5 s` (~20 s total). Skippable; a viewer sees it only if `canWatchCinematic()`. Late joiners see beams, enlarged oases and thawed snow without the cinematic.
- **Game continues** afterwards: no new-winter countdown, no victory card (the classic volcano flow is off in this ruleset). The world only resets by a player's NEW EXPEDITION (section 11).
- Cost (measured by `node scripts/finaleCheck.mjs`, averages over layouts, "steady" = everything grown): compact_3 (3 oases): vegetation entities ~437 -> ~1760 (+~1320; merged grass rects 192 -> 767, pines 45 -> 181, bushes 99 -> 396, rocks 30 -> 121, colliders 75 -> 302), terrain pieces ~164 -> ~355, lowered cells ~600 -> ~2400, new snow cells beyond the 50 m discs ~20 000. Standard 6 oases: vegetation entities ~900 -> ~3590 (+~2700), colliders ~150 -> ~605, terrain pieces ~365 -> ~710, new snow cells ~40 000. **Not measured on a phone.** If it hurts: lower `OASIS_FINALE_RADIUS_M` (cost ~ r^2; 52 m would cut the added entities by about a third) or thin the ring caps.
- Debug: `DEBUG_FINALE_BUTTON` (below). Check: `node scripts/finaleCheck.mjs` (all three profiles) and `compactProfileCheck`.

## 10. Smaller changes

- Desktop view zoom: five steps `[7, 29, 60, 84, 118]` (`DESKTOP_ZOOM_FAR_MULT` 1.4 applied twice; default stays 29). Mobile `[5, 15, 25]` unchanged. `src/client/topDownCamera.ts`.
- Server session resync (`src/client/serverSession.ts`): the platform shuts the server down after the last player leaves and cold-starts a new one; the client now notices the new session (or 12 s of missing `serverBeat`) and rejoins instead of keeping stale snow, fires and monuments.
- Help panel (`?`): Day N, `n/6 monuments activated`, "Don't let the fire die".
- Overview rotate button (90 degrees, HUD only) and star (leaderboard) button; top HUD row order: +, -, rotate, eye, mute, star, ?.

## Key files

| Area | Files |
|---|---|
| Ruleset and constants | `src/shared/ruleset.ts` |
| Build a fire | `src/client/buildFire.ts`, `campfireEmote.ts`, `lockedEmote.ts`, `movementLock.ts`, `src/server/hiddenCampfire.ts`, `src/shared/fireSlots.ts` |
| Spent fires | `src/server/hiddenCampfire.ts`, `src/client/hiddenCampfire.ts`, `src/shared/fireSlots.ts` |
| Network | `src/shared/fireNetwork.ts`, `src/server/fireNetwork.ts`, `fireNetworkLinks.ts`, `chargeLinks.ts` |
| Monuments | `src/server/stations.ts`, `src/client/stationMarkers.ts`, `monumentCinematic.ts`, `monumentChargeHum.ts`, `src/shared/crystalFloat.ts`, `crystalCineFrame.ts` |
| Oasis | `src/shared/terrain/oasis.ts`, `oasisVeg.ts`, `src/client/terrain/oasisVegetation.ts`, `terrainRenderer.ts` |
| Ending | `src/shared/finale.ts`, `src/client/crystalFinale.ts` |
| Leaderboard | `src/shared/leaderboard.ts`, `src/server/leaderboard.ts`, `src/client/leaderboard.ts` |

## How to test

Run locally: `npm start` (preview) and `npm run auth-server` (separate terminal).

Flags in `src/client/devFlags.ts` (all false in the committed build; flip, save, hot-reload; the server reads some of them too):

| Flag | Effect |
|---|---|
| `DEBUG_FINALE_BUTTON` | **END** button right of the frost bar: silently releases every unreleased monument and starts the ending ~3 s later (`FINALE_DEBUG_DELAY_S`). Taints the run (no leaderboard). Server handler gated on the same flag. **Set false before deploy.** |
| `DEBUG_THAW_BUTTON` | Legacy classic-volcano THAW button (not used by this ruleset). Set false before deploy. |
| `DEV_DISABLE_FROST` | Holds the frost bar at full warm. |
| `DEV_KEEP_TORCH_LIT` | Torch never drains. |
| `SHOW_DEV_SNUFF_BUTTON` | **OUT** button: snuffs every fire (ember-fail / world end). |
| `SHOW_DEV_ROLL_BUTTON` | Forces a cycle rollover (new winter, new seed). |
| `SHOW_DEV_ADVANCE_PHASE` | Jumps the day/night phase. Taints. |
| `SHOW_SERVER_STATS` | `#` button + stats panel (tile counts, entity budget). |
| `DEBUG_VOLCANO_STAGE_OVERRIDE` | Local volcano stage preview (classic); keep -1. |

Quick manual passes:

- **Build a fire**: carry a log, light the torch at the hearth, walk 18+ m from any fire, press E. Expect squat/strike emote, movement locked ~2.6 s, fire 1.2 m ahead.
- **Spent fire**: wait out a fire (or use OUT). Expect dark stones + ash + wisp, no relight prompt, gone after 60 s, build on or next to it works at once.
- **Charge and release**: link 2-3 fires within 40 m of the near monument (~41 m from the hearth). With `CHARGE_TARGET_S` 60 it charges in about a minute. Listen for the hum near the monument (quiet at the fires), `monument.mp3` at rise start, `crystal.mp3` loop when the beam hits, then watch the oasis melt and regrow.
- **Ending**: `DEBUG_FINALE_BUTTON = true`, click END.

### Checks

Run each with `node scripts/<name>.mjs` from the repo root (they bundle with esbuild and run the shared logic headless; outputs go to `scripts/out`, git-ignored). All 28 exited 0 on 2026-10-28 against `f22ee9e`:

`byofCapCheck`, `byofCheck`, `cineFrameCheck`, `crystalCheck`, `finaleCheck`, `fireNetworkCheck`, `fireNetworkVCheck`, `fireShareCheck`, `flameVariantCheck`, `floatingItemsCheck`, `heatFrontCheck`, `hiddenFireGroundCheck`, `leaderboardCheck`, `mapSeatCheck`, `migrationSliceCheck`, `monumentCountCheck`, `monumentEdgeCheck`, `monumentHoverCheck`, `nearMonumentCheck`, `nearMonumentSideCheck`, `nearMonumentSpawnCheck`, `oasisCheck`, `routeEndCheck`, `spentFireCheck`, `thawRadiusCheck`, `topologyCheck`, `volcanoLadderCheck`, `volcanoTerraceCheck`.

New since 520cc6b: `cineFrameCheck`, `finaleCheck`, `flameVariantCheck`, `heatFrontCheck`, `leaderboardCheck`, `monumentEdgeCheck`, `nearMonumentSpawnCheck`, `oasisCheck`, `spentFireCheck`. Extended: `topologyCheck`, `byofCapCheck`, `crystalCheck`, `routeEndCheck`.

Odd output (exit 0 but not meaningful):

- `fireNetworkCheck` prints `fires/seed avg=1.0`, `isolated=100%`, `degree avg=0.00`; `migrationSliceCheck` prints `pits 0 / 42`, `firesNear160 ... 0 want 5-7`. Both measure the **old hidden-campfire placement**, and in build-your-own-fire mode a seed has only the hearth, so there are no links or pits to count. They only prove the generator still runs. `fireNetworkVCheck` shows `0 per link` for the same reason. Real network behaviour is covered by `topologyCheck`, `routeEndCheck`, `fireShareCheck`.
- `thawRadiusCheck` and `nearMonumentCheck` report the classic 3-station volcano setup.

## Known issues and untested

- **Not seen in-game by the author**: ash visual size/colour (ash disc and charred stone tint were guessed), the campfire emote timing against the fire spawn, quieter hum / burst levels, the full finale sequence.
- **Ladders sit ~0.27 m off** on terraces lowered by an oasis (`OASIS_DROP_M`); `src/client/terrain/ladders.ts` does not account for the drop. Cosmetic, unfixed.
- **Finale wide shot does not fit the whole ring** (~2 km around on `playtest_52`): beams run off the frame edge.
- **Mobile entity counts are unmeasured.** Estimates above; nothing was run on a phone. A live entity-count readout would give a real number (not built). Separately, the mobile Explorer 51 x 51 parcel clamp (H1-07) was seen on the 100 x 100 World and has not been re-checked at 52 x 52.
- **No automatic new winter after the ending.** Before the ending the run still resets when all fires and torches are out for 4 s (`worldFlame.ts`); once the ending was scheduled (`stations.isExpeditionWon`) that check is off too, so the restored world stays playable indefinitely. It resets only by a player's NEW EXPEDITION (section 11) or the dev roll button. The old "Winter Approaches in N days" flow is still in the code but off for this ruleset.
- `CHARGE_TARGET_S = 60` is a playtest value (design target 210).
- The working tree shows `scene.json`, `assets/scene/main.composite` and `main.crdt` modified by Creator Hub. They are not part of this work; do not hand-edit them.
- Stale comments: `lockedEmote.ts` mentions a non-existent `torchLightEmote.ts`; `ruleset.ts` `CHARGE_LINK_EDGE_PAD_M` is unused; `VEG_PLINTH_CLEAR_M` is named for the old plinth but is just the monument pit clearance (pit 6 m / 2 + 3 m).
- Unused assets: `charge.wav`, `charge_start.wav`, `release.wav`, `release_burst.wav`, `scripts/trim-release-burst.js`.

## Open ideas

- Auto new winter after the ending: after a day or a few warm days show "Winter Approaches" and roll a new seed (the old victory flow could be reused).
- Entity-count readout (debug HUD) to measure mobile with the enlarged finale oases (see section 9).
- Distance culling for bushes and rocks.
- Wood types beyond logs (`WOOD_TYPES` table is ready).
- Lava-themed or other post-thaw content so the end of a run has a reason to start another.

## compact_3 playtest profile (15 players, ~30 min) - added 2026-10-28

Uncommitted work on top of `f22ee9e`. Nothing committed or pushed.

### The one switch
`src/shared/settings.ts`: `export const WORLD_PROFILE: WorldProfile = 'playtest_52'` -> `'compact_3'` (and back). That is the only edit. Everything else derives from `WORLD_PROFILE_SPEC`: monument count (`WORLD_MONUMENT_COUNT` -> `ruleset.MONUMENT_COUNT`), volcano on/off (`WORLD_HAS_VOLCANO`), playfield padding, the leaderboard storage key suffix, the monument distance bands. `playtest_52` and `full_100` are unchanged (6 monuments, volcano, standard board). `scene.json` needs NO change: `compact_3` keeps the 52 x 52 parcel scene (so the finale camera ceiling, `sceneHeightLimitM`, is the same) and shrinks the playfield to the centred 34 x 34 parcels (544 m, 65% per side) with 144 m padding behind the mountain band. If you ever want the scene itself smaller, set `parcels: 36, paddingMeters: 16` in the spec AND change `scene.json` parcels to 0,0..35,35 (not done; the ceiling drops to ~103 m).

### What compact_3 is
- 3 monuments: A introduction (always ~41 m from the hearth, route ~64 m), B exploration (118-260 m straight, route 176-370 m), C expedition (120-317 m straight, route 224-690 m; the farthest by route). Roles are not an enum in code: they fall out of `MONUMENT_DISTANCE_BANDS` (compact: [0.25,0.42] and [0.5,0.72] of the playfield radius), `MONUMENT_MIN_ANGLE_DEG` (55) and the unchanged near-monument pick.
- NO volcano: no peak, crater, lava, smoke, ladders, summit tablet / map. `terrainGen` stamps a plain high plateau instead (`stampPlainPlateau`), skips `pickVolcano` and the crown loop, and the monument validation does not need a volcano line of sight. Every volcano-dependent consumer was already null-safe (map tablet, crown, smoke, snow model, finale avoid zone = null). Consequence: there is no in-world map in this profile.
- Standard-profile generation does not change (the volcano code is gated; RNG draw order is the same).
- Finale: already n-based (`map.stations.length`). 3 monuments -> a triangle ring, the same connection logic, simultaneous beams, the enlarged-oasis pulse, title + cinematic (section 9). New: `finaleCameraPose(..., opts)` with `finalePoseOpts()` (compact only: shallower pitches 26..85 deg, camera kept inside the scene parcels, least-overflow fallback) so the end shot frames the whole triangle (fills the target on 478/480 poses over 160 seeds x 3 aspects, never outside the frame). The standard finale uses the original search exactly (`opts` undefined).
- Leaderboard: its own board, same four categories. Storage key `cryocene.leaderboard.v2.compact3` (standard `cryocene.leaderboard.v2` is unchanged and its blob bytes are unchanged). A compact blob also carries `b: '.compact3'`; the server refuses (and does not overwrite) a stored blob whose tag differs from the active profile. The server only ever sends its own board, so the key-3 panel shows the active profile's board; compact shows the heading "PLAYTEST BOARD - 3 MONUMENTS". Scene Storage is per deployed world, so no backend, table or endpoint exists to deploy: publishing the scene with the switch flipped is enough. A fresh key starts empty.
- Dev shortcuts never write records: `debugFinale` / `debugThaw` / `debugVolcanoStage` / dev phase advance call `markRunTainted` first and every leaderboard writer is gated on `isRunTainted()`.

### Finale fallback for the playtest host
`DEBUG_FINALE_BUTTON` stays `false` (`src/client/devFlags.ts`). To keep a fallback in a playtest build: set it `true` AND put the host wallet (lower case) in `DEBUG_FINALE_HOSTS`. Then only that wallet sees the END button and the server ignores `debugFinale` from anyone else (`debugFinaleAllowed`, used by the button and the server handler). It releases every unreleased monument silently, taints the run (no leaderboard record) and starts the finale ~3 s later. Set it back to `false` before publishing for the public. An empty `DEBUG_FINALE_HOSTS` with the flag on means everyone (the old behaviour).

### Fire cap and wood (numbers from `node scripts/compactProfileCheck.mjs 160`)
- Cap left at `BUILT_FIRE_MAX = 40` (global, burning fires only; ash does not count). There are 42 fire slots (`HIDDEN_CAMPFIRE_COUNT`), so raising the cap means more slots too; not done.
- Minimum fires to light all 3: 3 per monument (3 fires at 20 m = 60 s) + ~1 relay = ~10. Each monument ring has >= 13 buildable spots at the 18 m spacing (`crystalCheck`). Four times the minimum is the cap, so 15 players building 2-3 each can hit it only if fires pile up; if it bites in the playtest the quick profile-scoped fix is a bigger cap AND slot count (needs a message / slot-array check) - decide after the playtest.
- Expected ACTIVE logs within 60 m: A mean 40 (min 32), B mean 29 (min 12), C mean 25 (min 8); guaranteed iced cluster within 45 m of every monument >= 6; within 80 m of the hearth ~81; whole world ~324 (~21 per player at 15). Route wood scales with the monument count (14 per monument).
- Travel (one way, mean straight .. route upper bound): A 41..64 m; B 170..228 m; C 223..369 m. At the engine jog speed (assumed ~8 m/s on melted ground) 0.1 / 0.5 / 0.8 min; in light snow (3 m/s) 0.4 / 1.3 / 2.0 min; deep snow (1.5 m/s) 0.7 / 2.5 / 4.1 min. Real walks are between the straight and route numbers.

### Checks
- New: `scripts/compactProfileCheck.mjs` (+ `Entry.ts`). All three profiles: spec wiring; standard profiles unchanged; leaderboard keys/blobs separated and the wrong-board guard; dev handlers taint before changing state; no hard-coded monument counts in finale / progression / leaderboard code; the 3-fire / 60 s charge and the release -> N/N completion model; per-seed monument count, no volcano or crown cells, spacing >= 100 m, hearth reachability, role distances, wood, finale ring, late joiner, camera framing.
- `compact_3` was added to the profile loops of byofCap, byof, cineFrame, crystal, finale, floatingItems, hiddenFireGround, monumentCount, monumentEdge, monumentHover, nearMonument(+Side/Spawn), thawRadius, topology. Not added (volcano-only or standard-only): mapSeat, volcanoLadder, volcanoTerrace, fireNetwork, fireNetworkV, oasis, routeEnd, spentFire, fireShare, flameVariant, heatFront, migrationSlice, leaderboard (all pass as before).
- Not covered by scripts: the server `sendStationStateTo` late-join path (generic over `stationTotal()`, read, not run), real devices.

### Manual checklist for Luke (not done by the agent)
1. Flip to `compact_3`, `npm run build`, start the preview. Spawn, find A (~40 m) - no volcano on the skyline, no summit tablet, key 3 shows the PLAYTEST BOARD heading.
2. Light A with 3 fires (60 s), release; walk to B and C (watch snow speed and wood on the way); light C with deliberate fire placement. Check B and C are not blocked by terrain, and not both trivial.
3. HUD / help says 0/3 -> 3/3 monuments; world explorable after.
4. Finale at 3/3: the 3 beams connect together (same thickness as the vertical beams), all 3 monuments pulse, the snow around each melts out to ~64 m over ~12 s while the permafrost cap and plants open gradually over ~60 s, and the warm radius grows with the snow (stand 60 m from a monument after the pulse: no frost), title "THE WORLD BEGINS TO THAW" (2 lines on a portrait phone), the camera frames the whole triangle on desktop and a portrait phone; a second client joining mid-finale sees the beams and the enlarged oases complete.
5. Leaderboard: finish a run, reopen key 3 (record under the playtest heading); switch back to `playtest_52` and confirm the standard board is untouched and the compact record is not there.
6. With the host flag on: END works for the host wallet only; the run it triggers writes no record.
7. Mobile: all 3 oases grown + finale running, look at frame rate; also zoom out fully at the map edge to see the 144 m flat padding beyond the mountain band.
8. 15 players: fire cap messages, wood running out at B/C, networks separate.

## 11. New Expedition reset (after the ending)

Files: `src/shared/expedition.ts` (rules + `ExpeditionServerCore`, run by the server AND by `scripts/expeditionCheck.mjs`), `src/server/expedition.ts` (wiring), `src/client/expedition.ts` (state), Help panel section in `layer.helpPanel.tsx`, HUD chip `layer.expeditionCountdown.tsx`, messages `newExpeditionRequest` / `newExpeditionCancel` (client -> server) and `newExpeditionState` (server -> client).
- The button **BEGIN NEW EXPEDITION** is ON SCREEN (a 44 px tap-sized button under the top HUD row, `layer.expeditionCountdown.tsx`) and in the Help panel (key 4 / ? button, same copy); both only show when the server says `ready`: the ending was scheduled and the world is restored (`finaleRestoredS` = pulse start + 60 s, about 65 s after the ending starts). Hidden before / during the ending and during a countdown (then it shows the status line and, for the initiator, CANCEL NEW EXPEDITION). Any connected player can press it; no hearth trip, no extra screen.
- Server: validates the sender, the world id and `isExpeditionComplete`; starts ONE countdown of `NEW_EXPEDITION_COUNTDOWN_S` = 60 s (repeated presses by anyone do nothing). Cancel works only for the initiator's wallet. If the initiator disconnects the countdown goes on (the same wallet can still cancel after reconnecting). At zero it calls `rollCycle()` (same path as the dev roll): fresh seed, Day 1, monuments / finale / oasis / fires / snow / wood / torches reset by their own `onCycleRoll` handlers, leaderboard contributors and run taint cleared. The reset never writes a record or taints a run.
- Time sync: the server keeps one deadline; each message carries `remainingMs` at send time (epoch ms does not fit the wire), the client turns it into a local deadline once and shows `ceil((deadline - now) / 1000)` every frame (no per-second decrement, clock skew does not matter). Joiners are hydrated from the server deadline. On-screen HUD: "NEW EXPEDITION IN m:ss" chip for everyone while the countdown runs, plus CANCEL NEW EXPEDITION for the initiator only, under the top button row (the HUD steps aside while the Help panel / leaderboard is open, which show the same status and buttons).
- Check: `node scripts/expeditionCheck.mjs`.

## Later fixes (playtest build)

- Fire links route around monuments: `fireNetwork.detourMonuments` (arc radius `NETWORK_MONUMENT_ARC_M` 6.8 m, switch `NETWORK_MONUMENT_AVOID_ENABLED`); charge links still end at `CHARGE_LINK_END_HALF_M`. Checked in `compactProfileCheck` and `fireNetworkCheck` (all profiles).
- Top-down camera: drag / pan / free mode removed (desktop and mobile). Zoom (wheel, pinch, mobile +/- buttons), key 1 toggle and cliff auto-rotate remain; mobile cluster is `layer.topDownZoom.tsx`.
- Wood no longer respawns under snow (all profiles; checked in `compactProfileCheck`).
- `compact_3` profile (3 monuments, no volcano, own leaderboard): switch `WORLD_PROFILE` in `src/shared/settings.ts`, `node scripts/compactProfileCheck.mjs` runs all three profiles.
- **Socket lava (all profiles, floating crystals):** once a monument is released and its crystal has left the socket, a thin lava pool (same material as the volcano lava, `client/lavaLook.ts`) fills the socket floor over `SOCKET_LAVA_RISE_S` and stays for the world. It is a permanent torch relight source: the same E / torch button / prompt as a campfire (`volcanoCrown.isInLavaRelightRange` includes it, reach `SOCKET_LAVA_REACH_M` = 4 m from the pool edge). No new message / asset / collider: it derives from the server's release (`stationState`, hydrated to joiners) plus the crystal's pose, so late joiners agree. It is a torch relight source ONLY: it is not living flame (it never keeps the world from ending, so the world reset is never blocked) and not a wake point for frozen players; no server code knows it. Files: `shared/socketLava.ts`, `client/socketLava.ts`, `client/lavaLook.ts`, `stationMarkers.socketLavaSystem`. Check: `node scripts/socketLavaCheck.mjs`.
- **Freeze / thaw between players (unchanged, now guarded):** a full frost bar freezes you in ice; another player's LIT torch held within `ICE_RESCUE_RADIUS_M` (3 m) for `ICE_THAW_S` (3 s) thaws you; after `ICE_RESOLVE_S` (15 s) you wake at a lit fire, with every fire dark you stay frozen. `client/frost/*`, `shared/frost/*` and `server/frostLife.ts` are unchanged since the baseline `f22ee9e` except the socket-lava wake source in `anyLivingFire`. Check: `node scripts/freezeThawCheck.mjs`.
- **Fire burn rate:** fuel burns at `hearthDecayRate(players) * phase drainMul` (* 1.5 while a fire charges a monument), `hearthDecayRate = 1 + c * log2(players)` with the crowd coefficient `c` from the world profile (`settings.WORLD_PROFILE_SPEC.crowdBurnCoef`, `WORLD_CROWD_BURN_COEF`): **0.5 in `playtest_52` / `full_100` (unchanged since `f22ee9e`), 0.25 in `compact_3`** (15-player playtest: 1.98x instead of 2.95x). One function feeds the hearth, hidden / built fires and the xN chip; torches use only the phase multiplier (no crowd factor). Dawn / day 0.5, dusk / night 1.5. A 120 s log lasts (day / night / charging at night): 1 player 240 / 80 / 53 s; 4 players 120 / 40 / 27 (standard) vs 160 / 53 / 36 (compact_3); 15 players 81 / 27 / 18 (standard) vs 121 / 40 / 27 (compact_3). Checked per profile in `compactProfileCheck`.
