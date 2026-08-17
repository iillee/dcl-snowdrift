# DCL Canvas — Design Document

**Version:** 0.3 (brush lift overlays + starting seed)
**Repo:** https://github.com/iillee/dcl-canvas
**Deploy target:** Decentraland World (`dcl-canvas.dcl.eth`)
**Runtime:** Decentraland SDK7 (`@dcl/sdk` 7.25.x) with authoritative server (`hammurabi-server`)
**Forked from:** [pixelwars](../../dcl-pixelwars) `refactor-component-based-pixels` branch

---

## 1. Vision

**A free-for-all multiplayer paint canvas in Decentraland.** Players walk
around a small procedurally generated maze; the floor beneath them
paints in real time in their current color. Anyone can paint over
anyone. No timer, no win condition — just a shared social space where
friends drop in and doodle together.

The scene is intentionally a **collaborative toy**, not a game. It lives
in a World rather than Genesis City so it's always accessible, always
persistent within a session, and cheap to iterate on.

---

## 2. Goals

### Product goals
1. **Zero friction.** Load into the World, walk, paint. No login screen,
   no tutorial, no round timer.
2. **Multiplayer by default.** Every paint stroke is broadcast to every
   other player in the room in real time.
3. **Personal expression.** Every player picks Red or Blue at will —
   colors are swappable mid-session via a HUD swatch (server-authoritative).
4. **Mobile-first framing.** The scene fits on a portrait phone screen
   in spectator mode so the canvas can be viewed as a whole.

### Engineering goals
1. **Authoritative server.** All paint state lives on the headless
   server; clients send intents, receive CRDT-synced state.
2. **Deterministic level.** The maze layout is derived from a fixed
   seed and placement rules, not authored by hand.
3. **Small, legible code.** Forked from pixelwars but continuously
   trimmed. Round timing, team-locked assignment, and stale UI
   have been ripped out or repurposed.

### Non-goals
- Game mechanics (scoring, winning, losing).
- LAND deployment (Worlds only for now).
- Persistent-across-sessions paint state (deferred).

---

## 3. Level design

### Scene shape
- **4 × 7 parcels** = 64 m × 112 m, aspect ≈ 9:16 (portrait).
- Chosen to fit inside DCL mobile's ~100 m fog band when viewed at
  50 m altitude in spectator mode.
- Single flat level, ground floor only (`MAZE_MAX_STACK_Y = 0`).

### Tile system (v0.2 — full-footprint GLBs)
| Tile   | Openings   | GLB                       | Paint mask                                    |
|--------|------------|---------------------------|-----------------------------------------------|
| `turn` | 2 (N,E)    | `tile-turn-full.glb`      | Corridor arms + **NE** corner                 |
| `fork` | 3 (N,S,W)  | `tile-fork-full.glb`      | Corridor arms + **NW** and **SW** corners     |
| `cross`| 4 (all)    | `tile-cross-full.glb`     | Entire 16 × 16 area (`FULL_MASK`)             |

The `-full` GLBs replaced the older corridor-only meshes in v0.2: the
new tiles fill the entire 16 × 16 area for any corner between two
**open** edges. Paint masks in `src/shared/maze/graph.ts` were updated
to match — cells now cover the full visible floor without leaving
unpaintable gaps at corners.

Ends, straights, and ramps from pixelwars' catalog are excluded — the
solver never picks them on a flat canvas.

### Generation algorithm
A **backtracking full-coverage solver** in
`src/shared/maze/generator.ts`:

1. Iterate every cell in row-major order.
2. Pick the tile pool by wall count: 2 walls → `turn`, 1 wall → `fork`,
   0 walls → `cross`.
3. For each candidate rotation, `canPlace()` rejects mismatched
   openings vs already-placed neighbours.
4. On success, place; on failure, backtrack.

Guarantees full parcel coverage, connected corridors, and deterministic
tile-type placement (only rotations vary per seed).

### Paint layer
- **Cell resolution:** `PAINT_CELLS_PER_TILE_AXIS = 16` → 1 m paint
  cells. Full scene grid = **64 × 112 = 7,168 cells**.
- **Cell mesh:** `MeshRenderer.setPlane` per walkable cell, at
  `FLAT_OFFSET ≈ 0.275 m` above the tile slab.
- **Cell id format:** `"tx,tz,ty:col,row"` — stable across rebuilds
  and used verbatim on the wire.

---

## 4. Painting mechanics

- **Trigger:** every frame, a system reads the local player's Transform
  and paints an **N × N** cell footprint under their feet, where N is
  the current brush size (`getBrushCells()`).
- **Ground check:** only fires when the player's Y is within 0.4 m of
  the walkable surface — jumping/gliding doesn't paint.
- **Brush sizes (odd only, 0 = off):** `0, 1, 3, 5, 7, 9, 11`. `0`
  disables painting entirely — a "brush off" state.
- **Color source:** the local player's `Team` (Red or Blue), set from
  the server-authoritative `teamAssigned` message.
- **Optimistic local rendering:** the client colors the cell
  immediately, then the server-authoritative CRDT (`PaintCell`) resolves
  and any mismatch is overwritten within a frame or two.
- **Brush lift overlays (v0.3):** for each cell currently under the local
  brush footprint, the client spawns a transient overlay box that pops up
  (~0.25 m, `EF_EASEOUTBACK`, 140 ms) and, once the player walks off,
  tweens back down (`EF_EASEOUTQUAD`, 220 ms) and despawns. The base
  paint mesh stays a cheap 1-sided plane; only the transient overlays
  are boxes, capped at ~brush² live entities. Each overlay is an anchor
  entity with a colored core box + 12 thin black edge boxes as children,
  so it reads as a crisp outlined tile. Box thickness = lift height +
  peek amount, so the box bottom never rises above the paint plane while
  lifted (no visible white gap). See `BRUSH_LIFT_METERS`,
  `OVERLAY_THICKNESS`, `OVERLAY_EDGE_THICKNESS` in `src/client/paint.ts`.

---

## 5. Networking (authoritative server)

Small, deliberately-flat message set in `src/shared/messages.ts`:

| Direction | Message              | Purpose                                              |
|-----------|----------------------|------------------------------------------------------|
| C → S     | `joinRoster`         | Register in the roster on connect                    |
| S → C     | `teamAssigned`       | Server-assigned or newly-switched team               |
| C → S     | `paintTick { ids[] }`| Cells the local player just walked over (10 Hz)      |
| C → S     | **`switchTeam`**     | *(new v0.2)* Request a colour switch; server echoes `teamAssigned` |
| S → C     | `roundReset`         | Reserved (rounds stripped from client)               |
| C → S     | `updateName`         | Push display name for leaderboard                    |
| C → S     | `requestLeaderboard` | Ask for a fresh leaderboard snapshot                 |

Paint **state** is not sent over messages — it lives entirely in
per-cell `PaintCell` CRDT components (`shared/components.ts`) plus a
`PaletteEntry` colour lookup and a `PaintCoverage` counter. Late
joiners get the whole canvas from CRDT sync alone.

**Startup seed + refresh reset (v0.3):** on server boot, `seedStartingArea()`
pre-paints every cell of the centre tile (`tx = ⌊W/2⌋`, `tz = ⌊H/2⌋`) as
Team.Red so the canvas isn't empty on first load. Additionally, every
`joinRoster` currently triggers `clearPaintState()` + `seedStartingArea()`
— a dev-friendly reset so a browser refresh gives a clean slate. This
wipes everyone else's paint too, so it will be gated behind a flag once
multi-player sessions matter (TODO in `src/server/server.ts`).

**Team-switch flow (v0.2):**
1. Client clicks the swatch button → sends `switchTeam { team }`.
2. Server updates `teamOverride` in `roster.ts`, re-attributes future
   paintTicks to the new team, and echoes `teamAssigned` back.
3. Client `clientHandler` forwards to `eventBus`, `paint.ts` updates
   `localTeam` → swatch + optimistic colour flip together.

---

## 6. UI (HUD toolbar)

Built with React-ECS, mounted in `src/client/ui/index.tsx`. **v0.2
consolidates every HUD control into a single right-edge vertical
stack** with identical footprint (72 × 72) and spacing.

### Right-edge stack (top → bottom)
| Button      | Icon              | Action                                                   |
|-------------|-------------------|----------------------------------------------------------|
| **+**       | glyph             | Increase brush size (clamps at 11×11)                    |
| **−**       | glyph             | Decrease brush size (clamps at 0 = off)                  |
| **Grid**    | 2×4 white cells   | Toggle spectator (top-down) camera; cells turn gold when active |
| **Swatch**  | red / blue circle | Toggle paint colour via `switchTeam`                     |
| **#**       | glyph             | Toggle debug ServerStats panel                           |
| **▣**       | glyph             | Toggle Canvas Snapshot overlay                           |
| **🔊 / 🔇** | image             | Toggle background music                                  |

### Keyboard hotkeys
| Key | Action                             |
|-----|------------------------------------|
| `E` | Brush size UP (wraps 11 → 1)       |
| `F` | Brush size DOWN (clamps at 0)      |
| `1` | Toggle spectator / top-down view   |

### Other HUD layers
- **Leaderboard** (`layer.leaderboard.tsx`) — persistent top players
- **Server stats** (`layer.serverStats.tsx`) — hidden by default; `#` button toggles
- **Version chip** (`layer.version.tsx`) — bottom-right build tag
- **Snapshot overlay** (`layer.snapshot.tsx`) — see §8

### Removed from pixelwars
Round-end banner, countdown timer HUD, teleport-orb prompts, Discord
UI, center-bottom mute pill (now a stack button).

---

## 7. Spectator (top-down) camera

`src/client/topDownCamera.ts` — built on `VirtualCamera` + `MainCamera.virtualCameraEntity`.

- **Altitude:** 50 m. Chosen to stay inside DCL mobile's ~100 m fog
  band.
- **Position:** scene centre X/Z + 3 m east offset. The tiny offset
  keeps `lookAtEntity` producing a real forward vector so DCL's
  camera-relative WASD stays aligned with the view.
- **Rotation on screen:** east offset makes the camera face west, so
  the scene's long Z axis reads as horizontal — landscape framing of
  the portrait scene, matching the snapshot export.
- **Toggle:** grid button in the HUD stack, or the `1` key.

---

## 8. Canvas snapshot export (new in v0.2)

Players can save a clean image of the current canvas without needing
a screenshot from the game camera.

### Files
- `src/shared/utils/pngEncoder.ts` — pure-TS uncompressed PNG encoder
  (CRC32, Adler-32, deflate stored blocks) + base64. No dependencies;
  works inside the QuickJS sandbox.
- `src/client/paintSnapshot.ts` — reads every `PaintCell` CRDT +
  `PaletteEntry` palette map into a Color4 grid, rotates 90° CW to
  landscape, and encodes an uncompressed PNG data URL.
- `src/client/ui/layers/layer.snapshot.tsx` — overlay UI with a live
  mosaic + **Download PNG** / **Close** buttons.

### Behaviour
- **Orientation:** 90° CW rotation so world **+X** is at the image top
  and world **+Z** at the image right — matches the spectator camera.
- **Colours:** painted cells use their palette Color4; unpainted /
  non-walkable cells render as **white** (`#FFFFFF`).
- **Preview mosaic:** rendered as a wall of `UiEntity` boxes. Cell
  size is computed each render from the live canvas dimensions
  (`sizing.ts`), respecting a right-side reserve for the HUD stack.
  Cells overlap by 1 px in both dimensions to eliminate hairline
  sub-pixel gaps on high-DPI (mobile) displays.
- **Download (desktop):** the Download PNG button generates a real
  PNG at 4 px per cell (~448 × 256), base64-encodes it, and calls
  `openExternalUrl(data:image/png;base64,…)`. The player's browser
  opens the image; right-click / long-press to save.
- **Download (mobile):** the intended workflow is a device screenshot
  of the mosaic panel followed by crop. Browser data-URL downloads
  are unreliable on mobile.
- **Backdrop:** the overlay wrapper uses `pointerFilter: 'none'` so
  the HUD toolbar is still reachable while the mosaic is open —
  useful for tweaking brush / colour and re-opening later.

### Why not encode a JPG or use the in-game camera?
The QuickJS sandbox has no image libraries and no filesystem access.
Uncompressed PNG can be written in ~150 lines of pure TS; JPG cannot.
The Explorer's built-in camera also has no scene-side API and hides
the HUD in photo mode.

---

## 9. World / deployment

- **Deploy target:** Decentraland World, `dcl-canvas.dcl.eth`.
- **Authoritative multiplayer:** enabled in `scene.json`
  (`"authoritativeMultiplayer": true`). Creator Hub launches the
  hammurabi-server automatically on preview.
- **Permissions:** `ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE`,
  `ALLOW_TO_TRIGGER_AVATAR_EMOTE`.
- **Feature toggles:** voice chat + nearby voice chat enabled.

---

## 10. Feature list (as of v0.2)

**Working:**
- 4 × 7 parcel scene (64 × 112 m)
- Procedural 4 × 7 tile maze regenerated from seed
- Full-footprint tile GLBs (`-full`) with matching paint masks
- Real-time painting via variable **0–11 × 11** brush footprint
- HUD toolbar: brush ±, spectator, colour swatch, stats, snapshot, mute
- Keyboard hotkeys: **E** / **F** / **1**
- Server-authoritative team switching (`switchTeam` → roster override)
- Top-down spectator camera (mobile-fog-safe altitude)
- **Canvas snapshot export** — live UI mosaic + PNG data-URL download

**Present but underused:**
- Leaderboard on the server
- Discord webhook (candidate for removal)
- `roundReset` message (rounds stripped from client)

**Missing (see roadmap):**
- Cross-session paint persistence
- "Clear my paint" button
- Onboarding hint
- Multi-colour palette beyond Red / Blue

---

## 11. Roadmap

### Near-term
1. **Mobile UX polish** on the snapshot overlay — hide the Download
   button when on mobile, add crop-guide marks at the four corners of
   the mosaic.
2. **Rip unused server pieces** — Discord webhook, `roundReset` code
   paths, leaderboard if we drop the competitive framing.
3. **Move `SeedHolder` to server-only** (currently client-authored,
   flagged with a TODO in `setupClient`).

### Mid-term
4. **Multi-colour palette.** Extend `Team` (or replace with a
   `paletteIndex`) so more than two colours are available.
5. **Paint persistence** via server-side Storage — canvas survives
   restart.
6. **"Clear my paint"** authoritative action, only affecting cells
   owned by the caller.
7. **Split `client/paint.ts`** (579 lines, largest file) into
   input / grid-apply / coverage / net modules.

### Long-term / speculative
8. **Time-lapse replay** — server records paint history; a UI slider
   scrubs through canvas evolution.
9. **Multiple canvases** — portal to switch between named World rooms,
   each with its own persistent canvas.

---

## 12. Constants reference

Single source of truth: `src/shared/settings.ts`.

| Constant                        | Value | Purpose                                    |
|---------------------------------|-------|--------------------------------------------|
| `SCENE_WORLD_SIZE_X_METERS`     | 64    | Scene width (X axis)                       |
| `SCENE_WORLD_SIZE_Z_METERS`     | 112   | Scene depth (Z axis)                       |
| `MAZE_TILE_GLTF_SCALE`          | 1     | GLB scale (1 = 16 m tiles)                 |
| `MAZE_TILE_WORLD_METERS`        | 16    | Derived tile width                         |
| `MAZE_GRID_WIDTH`               | 4     | Tiles across X                             |
| `MAZE_GRID_HEIGHT`              | 7     | Tiles across Z                             |
| `MAZE_MAX_STACK_Y_METERS`       | 0     | Elevation cap — 0 = flat only              |
| `PAINT_CELLS_PER_TILE_AXIS`     | 16    | Mask resolution — must be multiple of 16   |
| `PAINT_CELL_SIZE_METERS`        | 1     | Derived cell size (16 / 16)                |
| `PAINT_BRUSH_SIZE_CELLS`        | 3     | Default brush footprint                    |
| `PAINT_TICK_HZ`                 | 10    | Client → server flush rate                 |
| `PAINT_COVERAGE_PUBLISH_HZ`     | 5     | Server CRDT publish rate                   |

Brush size range (`src/client/brush.ts`):
| Constant            | Value | Purpose                              |
|---------------------|-------|--------------------------------------|
| `BRUSH_MIN_CELLS`   | 0     | 0 = brush off, no paint emitted      |
| `BRUSH_MAX_CELLS`   | 11    | Largest odd footprint                |
| `BRUSH_STEP_CELLS`  | 2     | Odd-only progression 1 → 3 → …       |

Top-down camera constants (`src/client/topDownCamera.ts`):
| Constant           | Value | Purpose                                       |
|--------------------|-------|-----------------------------------------------|
| `CAM_ALTITUDE`     | 50    | Height above ground                           |
| `CAM_EAST_OFFSET`  | 3     | Small tilt for WASD-alignment                 |
| `TRANSITION_SPEED` | 200   | m/s transition into / out of spectator view   |

---

## 13. File map (v0.2)

```
src/
├── index.ts                          # Server/client router (isServer())
├── client/
│   ├── index.ts                      # setupClient boot sequence
│   ├── clientHandler.ts              # room.onMessage wiring + outbound flush
│   ├── paint.ts                      # paint grid, systems, mesh spawn
│   ├── brush.ts                      # brush size state (0 & odd values, hotkey helpers)
│   ├── topDownCamera.ts              # spectator VirtualCamera + hotkey binds
│   ├── paintSnapshot.ts              # NEW — snapshot pixels + PNG data URL
│   ├── audio.ts
│   ├── waitForLoad.ts
│   ├── player.ts
│   ├── stress.ts
│   ├── maze/
│   │   └── rebuild.ts
│   └── ui/
│       ├── index.tsx                 # UI root + renderer
│       ├── theme/settings.ts
│       ├── components/               # shared UI atoms
│       ├── utils/sizing.ts           # canvas-dimensions helpers
│       └── layers/
│           ├── layer.brushSize.tsx   # right-edge HUD stack (all toolbar buttons)
│           ├── layer.cameraToggle.tsx  # (legacy, no longer mounted)
│           ├── layer.leaderboard.tsx
│           ├── layer.serverStats.tsx # toggleable via # button
│           ├── layer.snapshot.tsx    # NEW — canvas snapshot overlay
│           └── layer.version.tsx
├── server/
│   ├── server.ts                     # setupServer entry + switchTeam handler
│   ├── roster.ts                     # roster + team override map (v0.2)
│   ├── paintState.ts                 # authoritative paint map
│   ├── leaderboard.ts
│   ├── discord.ts
│   └── serverStats.ts
└── shared/
    ├── settings.ts
    ├── messages.ts                   # includes switchTeam (v0.2)
    ├── components.ts                 # CRDT component defs
    ├── team.ts
    ├── paintGrid.ts
    ├── palette.ts
    ├── roundTiming.ts
    ├── data/version.ts
    ├── utils/
    │   ├── eventBus.ts
    │   └── pngEncoder.ts             # NEW — pure-TS uncompressed PNG encoder
    └── maze/
        ├── tiles.ts                  # references *-full.glb (v0.2)
        ├── rng.ts
        ├── generator.ts
        └── graph.ts                  # FULL_MASK + per-tile corner-aware masks (v0.2)
```

---

## 14. Change log (high level)

Ordered fork-to-now, most recent last.

### v0.1 — initial fork
1. Forked pixelwars `refactor-component-based-pixels` as `dcl-canvas`.
2. New project ID + World name (`dcl-canvas.dcl.eth`).
3. Removed teleport orbs, timer HUD, round-end banner (client-side).
4. `MAZE_MAX_STACK_Y_METERS = 0` → flat single level.
5. Replaced random-BFS generator with row-major backtracking full-coverage solver.
6. Tile pool restricted to `turn` / `fork` / `cross`.
7. Iterated scene size to 4 × 7 parcels; paint cell resolution to `SIZE = 16`.
8. Added top-down spectator camera + UI toggle button.

### v0.2 — HUD toolbar + snapshot export
9. Swapped tile GLBs for `-full` variants; updated masks so corner
   quadrants between two open edges become walkable / paintable.
10. Introduced a right-edge vertical HUD stack unifying **+/-**,
    spectator, colour swatch, **#** stats, snapshot, and mute buttons.
11. Brush size extended down to **0** (brush off); **E**/**F**/**1**
    hotkey bindings added.
12. New `switchTeam` message + server roster override so clicking the
    swatch actually re-attributes future paint.
13. `ServerStats` panel now hidden by default, toggled via **#**.
14. Added pure-TS uncompressed PNG encoder + snapshot overlay UI
    (`Canvas Snapshot`) with live mosaic preview and Download PNG.
15. Snapshot orientation rotated 90° CW to landscape; unpainted cells
    render as white; overlay backdrop removed so HUD stays reachable
    while open.

### v0.3 — brush lift overlays + starting seed
16. Cells under the local brush footprint now spawn transient overlay
    boxes that pop up (`EF_EASEOUTBACK`, 140 ms) and tween down
    (`EF_EASEOUTQUAD`, 220 ms) once vacated. Overlays are anchor +
    colored core + 12 thin black edge boxes; base paint mesh remains a
    plane. Box thickness is sized so the bottom never rises above the
    plane while lifted.
17. Server pre-paints the centre tile Red on boot (`seedStartingArea`)
    so the canvas has a visible starting mark on first load.
18. Dev-friendly reset: every `joinRoster` clears paint state and
    reseeds — a browser refresh gives a clean canvas. Flagged with a
    TODO to gate behind a dev flag before multi-user use.

---

*This document lives at `docs/DESIGN.md` and is updated as the project
evolves. When you fork or hand off, read this first.*
