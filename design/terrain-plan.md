# Terrain rework — elevation, landforms, ladders

*Written 2026-10-05. Owner + agent planning session. Implements Phase 1 of the territory-expansion direction (geography → resource pressure → expansion → fire network → territory) and P3/P5 of [`checkpoint-2026-10-07-geography-migration.md`](./checkpoint-2026-10-07-geography-migration.md).*

---

## Goal

Turn the flat 64 × 64 snowfield into geography players can describe: *"below the ridge", "up the ladder to the plateau", "the grove in the basin"*. Every visit draws a fresh seed, so the generator must produce a valid, connected map **every time**, and it must be cheap enough to compute on every client and the server at load.

## Locked decisions

| Decision | Value |
|---|---|
| Grid | 16 m cells, same 62 × 62 grid as the snow tiles |
| Level step | **16 m** (no jumping or double-jumping between levels) |
| Levels | Low ≈ 0 m · **Middle ≈ 16 m (hearth)** · High ≈ 32 m · Mountain band 48 m+ (impassable) |
| Hearth | Middle level, so there is always one level above and one below |
| Connections | **Ladders only.** No ramps: snow is a flat per-cell grid and cannot follow a slope |
| Ladder use | Click / tap an invisible box at the ladder → `movePlayerTo` the other end (flagtag `ladderSystem.ts` pattern). Climb animation later, separately |
| Going down | Free: drop off any cliff. Climbing back up needs a ladder. Ladders also work downward |
| Perimeter | The 64 m tile ring is replaced by a generated mountain band |

Because the hearth is on the middle level, the whole world shifts up 16 m. Hardcoded ground heights (`SNOW_GROUND_TOP_Y`, `CAMPFIRE_WORLD_Y`, log pile, `scene.json` spawn, dawn pad and composite props) become `groundY(level)` so the step lives in one place.

## Architecture

### One shared terrain map

`src/shared/terrain/` exposes `generateTerrain(seed)` → `TerrainMap`. Pure, deterministic, integer RNG, no engine imports, so client and server agree. ~3,800 cells, a few milliseconds.

Per cell: level, region id, landform tag. Plus ladder list, destinations, and `groundY(x, z)`.

The server (wood, hidden fires) reads the map instead of importing `src/client/perimeter.ts`.

### Generation pipeline

1. **Mountain band** around the edge, with jittered thickness.
2. **Level field**: low-frequency value noise, cut into Low / Middle / High by quantile so every seed has similar proportions. Gives contiguous regions of varying width.
3. **Hearth**: forced Middle in a disc, noise blended toward Middle around it.
4. **Landform stamps** in separate directions from the hearth: canyon (Low corridor carved through), ridge (High line), plateau (High blob, far), basin (Low blob ringed by Middle). Guarantees the vocabulary appears every seed and makes directions uneven.
5. **Cleanup**: majority smoothing, merge tiny regions, remove diagonal-only contacts (keeps the art kit to three shapes).
6. **Regions + ladders**: connected regions per level. A spanning tree from the hearth region over one-step boundaries places one ladder per tree edge, on straight cliff runs. Long shared boundaries get a second ladder. Regions with no one-step neighbour are flattened.
7. **Destinations**: far, large High or Low regions become grove candidates (Phase 2 hook). Route distance from the hearth is stored for fire placement.
8. **Validate**: connectivity, hearth clearance, at least one region above and below, at least one destination. A failing seed retries deterministically with seed + 1. This is how "works every time" is guaranteed.

### Rendering — dual-grid cliff kit

At each grid corner, look at the four touching cells (is each at or above level *t*?). The 16 combinations reduce to three meshes with rotation:

```
outer corner   straight edge   inner corner
   . .             # #             # #
   . #             . .             # .
```

- Run once per step *t* (Low→Middle, Middle→High, High→Mountain). A two-step wall stacks two pieces.
- Flat tops are merged boxes (greedy rectangles) with colliders, not models.
- Long straight runs can use longer edge pieces to cut entity count.
- Until models land, every piece renders as boxes at the final dimensions.

### Systems that become elevation-aware

- **Snow renderer**: per-cell ground offset; coarse far sheets only merge within one level; no snow on cliff faces.
- **Melt brush, snow query, footsteps**: compare the player to the ground at that cell, not 0.25.
- **Wood, trees, fires, dropped logs**: Y from `groundY`; never on a cliff face.
- **Warmth + melt rings**: vertical check so a fire on a plateau does not warm the level below.

## Models to author (owner)

| Rule | Value |
|---|---|
| Grid | 16 m |
| Pivot | piece centred on a grid corner, base at y = 0 |
| Taper | face leans in ~3–4 m from base to top |
| Budget | < 300 triangles, one shared material |
| Collider | the mesh itself, or a simple `_collider` mesh |

Priority:

1. `cliff-outer-corner`, `cliff-edge`, `cliff-inner-corner` — 16 × 16 × 16 m.
2. `ladder` — ~17–18 m tall (rises slightly past the lip), 1–1.5 m wide. Physics collider only; the click box is added in code.
3. Mountain set — same three shapes, 32–48 m tall.
4. Later: optional `cliff-edge-32` / `-64` for long runs, 2–3 visual variants per piece, separate snow caps.

Not needed: per-shape blocks (fork, cross, wide corner, 32 × 32 plateau). The dual-grid kit covers every width.

## Milestones

1. **Shared terrain map + generator + offline seed preview** (`scripts/terrainPreview.mjs` renders seeds to PNG with stats). No in-world change.
2. **In-world greybox**: boxes for cliffs, box ladders with click-to-climb, world shifted up 16 m, old perimeter retired.
3. **Elevation-aware systems**: snow, brush, query, footsteps, scatter, fires, warmth.
4. **Swap boxes for the owner's GLB kit.**
5. **Destinations + fire placement along routes** (Phase 2).
6. **Fire network melt paths** (Phase 3). Snow regrowth stages already give "recently lost → abandoned → reclaimed".

Milestones 1–3 are the Oct 7 target.

## Open questions (after stabilising, before milestone 4)

- **Level step: keep 16 m or go back to 8 m?** 16 m makes the immediate
  area read well — tight, enclosed, and too tall to double-jump — but the
  boundary walls swallow the distant horizon line the flat playfield used
  to have, so the map as a whole reads as an arena. 8 m is worth a test
  once load times are measured. Both are one constant
  (`TERRAIN_LEVEL_STEP_M`), but the `scene.json` spawn, the composite
  props, and the ladder rise all follow from it.
- **Boundary treatment** (see the arena discussion): ragged mountain
  heights, variable band depth, and whether to open one or two sides out
  to a drop rather than a wall. Deliberately unresolved.
- **Load time with the full terrain** — measure before deciding either of
  the above.

## Risks

- **Entity count on mobile** (H1-06): the preview tool reports cliff piece counts per seed; long-edge pieces and far-chunk culling are the levers.
- **Every flat-ground assumption** has to move to `groundY`; missing one shows up as props floating or buried 16 m off.
- **Canyons** narrower than 2 cells read as slots: dark and cramped for the camera. Kept rare on purpose.
