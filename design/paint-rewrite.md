# Snow Layer Rewrite — implementer spec

*Written 2026-09-23. Supersedes §6 of [`optimization-branch-handoff.md`](optimization-branch-handoff.md). Branch: `optimization`. Revert point: tag `pre-paint-rewrite`.*

---

## 1. Why (corrected diagnoses)

The handoff's direction (rewrite, not patch) stands. Several of its root-cause claims did not survive a code read; the corrected versions below are what this rewrite targets.

| Playtest symptom | Handoff claim | What the code actually does |
|---|---|---|
| Melt shows, base stays white for seconds | Server batches paint on a 5 s tick | No such batch. Clients send at `PAINT_TICK_HZ = 10`, the server flushes dirty tiles every frame; the 5 s value is only the log-summary interval. The client already paints optimistically. The real cause: the optimistic visual silently no-ops when the cell's cube entity does not exist yet. Cubes are created 24/frame from one FIFO queue shared by the whole map, and every tile anyone ever melted sticky-loads forever — under 19 players the queue backs up by thousands. |
| Whole map "reloads" | 20 s safety resync | Confirmed. Each resync re-applies the grey material and restarts a tween on every partially-regrown cell across every spawned tile at once. |
| Snow turns blue | Team palette leaking through seams | Confirmed in spirit. Fully melted cells are 2 cm blue slabs on top of a tile GLB floor; z-fight and tween overlap show blue edges. |
| Off-white chunks | Lighting between cube Y positions | Plausible; resolves with the rewrite. |

Additional problems found during review:

- **Shared material object.** `CUBE_GREY_MAT` is one object passed to thousands of `Material.setPbrMaterial` calls — violates the dcl-place mobile invariant (fresh `MaterialInfo` per call).
- **O(n) cell lookup on the hot path.** `lookupTile` scans all 900 tiles per call; brush / frost / locomotion / footsteps call it 10–120 times per frame.
- **Ground height.** The walkable top is Y = 0.5 (`WALKABLE_TOP`), not Y = 0. The new ground slab keeps that height so campfire, props, wood and spawn are untouched.

## 2. Goals / non-goals

**Goals:** fix all four playtest bugs; cut boot entity count by an order of magnitude; make melt cost proportional to the melted area; make scene size a setting so H1-06 can test 32 / 64 / 100 parcel envelopes.

**Non-goals:** changing melt resolution (stays 1 m), regrowth feel (stays 4-stage), server tick cadence, perimeter cliffs, or any gameplay layer above the snow.

## 3. Data model

### 3.1 Grid

- Cell = 1 m × 1 m. Playfield = `MAZE_PLAYFIELD_METERS` square offset by `MAZE_ORIGIN_OFFSET_METERS` (currently 480 m at 16 m offset → 480 × 480 cells).
- Tile (network partition) = 16 × 16 cells → 30 × 30 = 900 tiles. Tiles are a CRDT batching detail only; the renderer's quadtree roots happen to share the same 16 m grid.
- Global cell coords `(gx, gz)`, `0 <= gx < CELLS_X`.

### 3.2 Integer cell key (wire-compatible)

```
tx       = gx >> 4            col = gx & 15
tz       = gz >> 4            row = gz & 15
tileKey  = tz * TILES_X + tx
localIdx = row * 16 + col
cellKey  = tileKey * 256 + localIdx
```

This is identical to the legacy `packCellKey(tx, tz, level = 0, col, row)`, so the legacy client's `cellIdToKey` produces the same integers and tile network ids (`TILE_NETWORK_BASE + tileKey`) are unchanged.

### 3.3 Snow stage

| Stage | Meaning | Height | Rendered |
|---|---|---|---|
| 0 | Fully melted | 0 | Nothing — blue ground shows |
| 1 | Regrowth 1 | 0.5 m | Box |
| 2 | Regrowth 2 | 1.0 m | Box |
| 3 | Pristine | 1.5 m | Box |

### 3.4 Wire byte (`PaintTile.cells[i]`)

- `0` = pristine (stage 3). Zero-filled buffers stay valid.
- Otherwise `MELT_FLAG | stage` where `MELT_FLAG = 2 << 2 = 0x08` and `stage ∈ {0, 1, 2}`.

`MELT_FLAG` deliberately equals the legacy "Blue team, palette index 2" encoding so the legacy client renders the new server's output correctly during the transition. Decoders only test `byte === 0` and `byte & 3`, so the flag value never matters again after cutover.

## 4. Server

- `src/server/snowState.ts` replaces `paintState.ts`: `Map<cellKey, { stage, changedAtMs }>`, `Set<cellKey>` of fire-protected cells, regrowth tick (unchanged timings), `meltDisc(cx, cz, r)` shared by the hearth and hidden fires, `releaseDiscOutside(...)` replacing `shrinkMeltRingTo`.
- `src/shared/snowSync.ts` replaces `paintSync.ts`: tile buffers, dirty-set flush per frame, `syncEntity` retry. No palette entities. `PaintCoverage` keeps publishing (`blue` = melted count) until the UI is rewired.
- Message `paintTick` carries `cells: Int[]` (cell keys) instead of string ids.
- Team logic removed from paint attribution. Roster stays (join gating + `pleaseRejoin`).
- Dev message `devMeltBulk { count }` melts `count` random unprotected cells to reproduce playtest load solo.

## 5. Client

### 5.1 Model (`src/client/snow/snowModel.ts`)

- Authoritative stage per cell from the `PaintTile` shadow diff.
- Optimistic overlay: local melts/stomps write the model immediately, whether or not any entity exists, and mark the owning root dirty with top priority. Server echo reconciles.
- `getSnowStageAtWorld(x, y, z)` keeps its existing signature and airborne gate; O(1) via `snowGrid` math. No tile lookup.

### 5.2 Renderer (`src/client/snow/snowRenderer.ts`)

- **Ground slab:** one box spanning the playfield, top at Y = 0.5, melt-blue `#6A99FC`, `MeshCollider` on `CL_PHYSICS`. Replaces 900 tile GLBs + 900 per-tile colliders.
- **Quadtree per 16 m root:** a node renders as one box when every unmasked cell in it has the same stage; otherwise it splits into four children (16 → 8 → 4 → 2 → 1). Stage-0 nodes render nothing. Masked (cliff) cells are treated as "don't care" so pristine roots next to cliffs still collapse when possible; a node that is entirely masked renders nothing.
- **Rebuild on dirty:** when a root's cells change, recompute its desired node set and diff against the live set — spawn new nodes, remove stale ones in the same frame (atomic swap). Only nodes that actually change are touched.
- **Budget:** one global allocation budget per frame (start 150, hard cap 300). Dirty roots are processed nearest-to-local-player first; the optimistic-dirty root always goes first. CRDT hydration apply completes before any visual spawn (dcl-place sequential-gate invariant).
- **Materials:** a fresh `{ albedoColor, roughness, metallic, specularIntensity }` object per `setPbrMaterial` call. `Color4` constants may be shared.
- **Tweens:** only 1 m leaves animate (drop on melt, rise on regrowth). Coarser nodes appear at their final height.

### 5.3 Boot / splash

Splash holds until: `isStateSyncronized()` AND the first full pass over all `PaintTile` entities has been applied AND the renderer's dirty queue is empty. A `hydrationSettled` latch prevents live paint from re-triggering it.

## 6. Deletions at cutover

`src/client/paint.ts`, `paintStreaming.ts`, `paintResync.ts`, `scatter.ts`, `src/client/maze/rebuild.ts`, `src/shared/maze/generator.ts`, `src/shared/maze/graph.ts`, `src/shared/paintGrid.ts`, `src/shared/paintSync.ts`, `src/server/paintState.ts`, `src/shared/palette.ts`, `src/shared/team.ts`, `PaletteEntry` component. `src/shared/maze/tiles.ts` stays (perimeter uses it). `SeedHolder` stays (drives perimeter + props).

## 7. Verification

1. `npm run build` clean at every step.
2. Preview, single player: melt, stomp, regrowth under each weather level, hearth ring grow/shrink, hidden fire ring, wood reveal, frost + slow-walk parity.
3. `devMeltBulk(15000)` solo: entity count, frame time, no flash.
4. Two clients: live sync, late-join hydration, no splash re-trigger.
5. Mobile smoke test.
