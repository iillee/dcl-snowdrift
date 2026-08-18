# Cliffs-v2 branch — session handoff

---

## SESSION 2 UPDATE (post-810d977 / fbfdd37)

The generator refactor from §4 landed in `810d977` (dynamic pool
policy) and `fbfdd37` (perimeter→maze wiring). This session built on
that with the actual worldgen richness the refactor was meant to
unlock, plus a few polish items.

### What landed

- **Playfield grown 256 → 480 m** (`src/shared/settings.ts`,
  `MAZE_PLAYFIELD_METERS = 480`). Grid is now 30×30 (900 cells).
  Empty ring between perim and playfield collapsed to −16 m (i.e.
  playfield overlaps perim by 3 rings). Reservation layer keeps snow
  out of cliff geometry — see erosion note below.
- **Variable-depth canyons** (`src/client/perimeter.ts`,
  `canyonDepth`, `planCanyonTail`). Each fork slot picks depth 1–3
  via a deterministic hash of (edge, slot). Depth 2–3 canyons place
  intermediate `straight` tiles and cap with an `end`. Truncated with
  an `end` cap if the tail would enter the campfire cliff buffer or
  run off-scene.
- **Interior mesas** (`planMesas`). Scattered pairs of `end` tiles
  with openings facing each other — forms enclosed 1×2 cliff chunks.
  Slot grid 128 m, density hash-modulated (~1/3 of slots become mesas).
- **Cliff placement dedup** (`computeAllCliffPlacements`). Two forks
  on perpendicular edges at slot 64 both target the same corner-
  adjacent tile (world 64,64); the first writer wins, later collisions
  are dropped. Same list is used by spawn AND reservation so they
  agree by construction. Downside: the losing fork opens toward the
  side of the winner's cap; reads as a dead-end.
- **Union-erode reservation** (also in perimeter.ts, replacing per-
  tile shrink). Compute the union of every cliff footprint, then
  4-way erode by 1 cell. Cells with any non-cliff neighbour survive
  (playfield-facing outer ring). Result: 1-cell snow overlap on
  playfield-facing sides only; shared boundaries between adjacent
  cliff tiles fully reserved (no wasted snow between them).
- **Island prune** (`src/client/maze/rebuild.ts::pruneIslands`).
  Flood-fill from the maze centre through non-reserved cells; anything
  unreached becomes an additional reservation. Keeps the maze one
  contiguous body so perpendicular canyons don't pinch off orphan
  pockets.
- **Campfire tile fix** (`rebuild.ts::isNearCampfire`). Replaced the
  order-based `p.order <= 8` instant-spawn check (broken post BFS→
  row-major refactor) with a spatial check against the campfire
  world position. All 4 tiles at the campfire junction now spawn
  instantly + are marked `alwaysSpawned`, not just the 1 that
  happened to land in the first 9 solve slots.
- **Loading splash** (`src/client/ui/layers/layer.loadingSplash.tsx`).
  Full-screen `snowdrift.png` overlay from scene start until the
  first rebuild's spawn queue drains. Latch lives in `rebuild.ts`
  as `isInitialLoadComplete()`. No fade — hard cut when done.
- **Per-tile pop SFX removed** (`rebuild.ts`, in `spawnTileWithGrow`).
  Was noisy on cold-open. If we want an ambient "world assembling"
  sound back, do it as a single loop on the campfire, not per tile.
- **Composite shifted onto campfire** (`assets/scene/main.composite`).
  Log+rock cluster centroid now sits at (256, 256). Lever tagged
  along and ended up at (197, 198); reposition in CH if needed.
  `main.crdt` regenerates on SDK build.

### Tuning knobs (all in `src/client/perimeter.ts` unless noted)

| Constant | Default | Effect |
|---|---|---|
| `MAZE_PLAYFIELD_METERS` (settings.ts) | 480 | Grid size, overlap depth |
| `FORK_EVERY_N` | 3 | 1-in-N edge slots become a fork |
| `CANYON_MIN_DEPTH` / `CANYON_MAX_DEPTH` | 1 / 3 | Canyon tail length range |
| `MESA_SLOT_SPACING` | 2 × PERIM_TILE | Distance between mesa candidate slots |
| `MESA_DENSITY_MOD` | 3 | 1-in-N candidate slots become a mesa |
| `CLIFF_SHRINK` (currently unused) | 16 m (1 cell) | Legacy per-tile shrink; kept for reference |

### Known edge cases (deferred)

1. **Losing fork after dedup collision** — when two perpendicular
   edge forks target the same tile, one loses its cap and opens
   toward the side of the winner. Reads as dead-end but visually
   awkward. Cleaner fix: truncate the losing canyon with an `end`
   cap one tile earlier, or shift its fork rotation to a different
   direction. Not blocking.
2. **Cliff GLBs aren't authored for 4× scale.** Some overlap /
   gap behaviour is really a modelling concern (open passageways
   visible from above, floor slabs occluding snow underneath, base
   silhouette not matching the reservation footprint). Slated for
   the cliff art remodel pass. When cliffs get real art with a
   defined wider/shorter base, the current 1-cell overlap will read
   as a clean tuck-under.
3. **Composite lever position.** After the campfire re-centre, the
   `lever_pirates` entity landed at (197, 198). Move in the CH UI
   if it wants a better home.

### Files touched this session

| File | What |
|---|---|
| `src/shared/settings.ts` | `MAZE_PLAYFIELD_METERS = 480` |
| `src/client/perimeter.ts` | Canyons, mesas, dedup, union-erode reservation |
| `src/client/maze/rebuild.ts` | Island prune, campfire spatial check, splash latch, no pop SFX |
| `src/client/ui/layers/layer.loadingSplash.tsx` | New — splash overlay |
| `src/client/ui/index.tsx` | Register splash layer |
| `assets/scene/main.composite` | Log+rock cluster shifted onto campfire |
| `main.crdt` | Regenerated from composite |

---

## ORIGINAL HANDOFF (session 1)



**Branch:** `cliffs-v2` (off `main`, which already has the cell-streaming
merge `d402d10`).

**As of end of session:** ready to start the maze-generator coordination
refactor. All prep is in place; no code has been written yet for the
generator changes.

---

## 1. Scene state at handoff

Everything auto-derives from these two constants in
`src/shared/settings.ts`:

```ts
SCENE_WORLD_SIZE_X/Z_METERS = 512   // 32 x 32 parcels
MAZE_PLAYFIELD_METERS       = 256   // 16 x 16 tiles
```

Derived:
- `MAZE_ORIGIN_OFFSET_METERS` = (512 − 256) / 2 = **128**
- Playfield bounds: **128..384**
- Scene centre / campfire: **256**
- Empty ring for cliff intrusions: **64 m per side** (playfield edge → perimeter inner face)
- Perimeter edge slots per side: **6** (dynamic, `(512 − 128) / 64`)
- Far-plane count when idle: 256 (one per interior tile)

`scene.json` = 1024 parcels (32×32); spawn point at (248–264, 248–264)
with `cameraTarget` (256, 256). Player is teleported to
`(campfire − 2, 2, campfire − 2)` 2 s after scene load, via
`src/client/player.ts::teleportHome()`, which now reads
`CAMPFIRE_WORLD_X/Z` directly — spawn is bound to the fire and will
re-centre automatically on future resizes.

**Creator Hub note:** CH scene footprint must match `scene.json` at
deploy time. Bump CH parcel config in lockstep whenever settings.ts
changes. Deploy via CH app UI (CLI deploy still blocked by the Node 24
`Symbol(map)` proxy bug from PLAN.md v2.7).

---

## 2. Perimeter cliff generator (current shape)

`src/client/perimeter.ts` — 12 base tiles per side (4 corners + 6 edge
slots at current scene size), each edge slot deterministically picking
`straight` or `fork` (`FORK_EVERY_N = 3`). Every fork's spur points
inward and gets capped by a matching `end` tile placed one
perimeter-tile-width further inward.

Two coordination guards on fork placement — if either fires, the fork
downgrades to a straight (no cap emitted, no open passage):

1. `isInsideCliffBuffer(capCenterX, capCenterZ)` — 64 m sphere around
   campfire (`src/shared/campfire.ts`, `CAMPFIRE_CLIFF_BUFFER_M`).
   Prevents cliffs crowding the fire on small scenes.
2. `isInsidePlayfield(capCenterX, capCenterZ)` — snow-tile rectangle
   (`src/shared/settings.ts`, `PLAYFIELD_MIN_M..PLAYFIELD_MAX_M`).
   Prevents caps overlapping the maze area.

**Guard (2) is the one to drop in the refactor** — once the maze
generator can retreat around reserved cells, cliff caps *should* push
into the playfield.

Perimeter tile GLBs use the non-`-full` variants (`PERIM_MODELS`
override); interior maze still uses `-full`. Vertical scale
`PERIM_SCALE_Y = 25` (horizontal `PERIM_SCALE = 4`).

---

## 3. Inner maze generator (current shape)

`src/shared/maze/generator.ts` — rigid rectangular grid, hard-coded
pool policy:

| Wall count | Tile pool |
|---|---|
| 2 (corner) | `turn` |
| 1 (edge)   | `fork` |
| 0 (interior) | `cross` |

Wall count is derived purely from position (`x === 0`, `x === GRID_W-1`,
etc.). Ramps and `end`/`straight` never appear.

This is why the maze reads as a perfect lattice of `+` intersections
with `T`-junctions on the edges. Any irregular boundary breaks it.

Rebuild flow: `src/client/maze/rebuild.ts::rebuildMaze(seed)` calls
`generateWithRetry(startSeed, maxAttempts=500)` which iterates seeds
until `validate()` passes. On failure aborts with a log line and
spawns nothing.

---

## 4. Refactor plan — coordination between the two generators

The whole point of this branch's next phase: cliffs push into the
playfield, maze retreats around them. Both systems are deterministic
(perimeter has no RNG; maze uses shared seed) → every client computes
the same reservation set → identical mazes with no network sync.

### 4a. `perimeter.ts` — export the reservation set

Add:

```ts
export interface ReservedTile { tx: number; tz: number }
export function getReservedPlayfieldCells(): ReservedTile[]
```

Walks the same edge-slot iteration as `setupPerimeter()`, but instead
of spawning geometry, computes which playfield grid cells each
would-be end-cap (or future canyon extension) occupies. Deterministic,
cheap, pure function of settings + `FORK_EVERY_N`.

Coordinate conversion:
- `tx = Math.floor((capCenterX - MAZE_ORIGIN_OFFSET_METERS) / MAZE_TILE_WORLD_METERS)`
- `tz = Math.floor((capCenterZ - MAZE_ORIGIN_OFFSET_METERS) / MAZE_TILE_WORLD_METERS)`

Emit only cells with `0 <= tx < GRID_W` and same for tz (a cap
straddling the playfield boundary contributes 1 cell inside, ignore
the outer half).

Also **drop the `isInsidePlayfield` guard on end-cap placement** — the
whole point is to let them intrude. Keep the `isInsideCliffBuffer`
guard (that's still a real constraint).

### 4b. `generator.ts` — respect reserved cells

Module-level state:

```ts
const reservedCells = new Set<string>()  // keys via key(x, z, 0)

export function setReservedCells(cells: Array<{ tx: number; tz: number }>): void {
	reservedCells.clear()
	for (const c of cells) reservedCells.add(key(c.tx, c.tz, 0))
}
```

Called by `rebuildMaze()` **before** `generateWithRetry()`.

Changes:

1. **`canPlace()`** — treat reserved neighbors identically to off-grid.
   Any opening pointing into a reserved cell is invalid, same as any
   opening pointing off-grid.

2. **`solveCells()` pool policy — go dynamic.** Replace the
   position-only wall count with actual "closed sides" count:

   ```ts
   const isClosedSide = (nx, nz) =>
     !inBounds(nx, nz) || reservedCells.has(key(nx, nz, 0))
   ```

   Then the pool per cell:

   | Closed sides | Pool |
   |---|---|
   | 4 | *skip cell entirely — unreachable island* |
   | 3 | `end` |
   | 2 opposite | `straight` |
   | 2 adjacent | `turn` |
   | 1 | `fork` |
   | 0 | `cross` |

3. **`validate()`** — skip reserved cells in the coverage check.
   Change `if (grid.size !== GRID_W * GRID_H)` to
   `if (grid.size !== GRID_W * GRID_H - reservedCells.size)`.
   Skip reserved cells in the opening-alignment loop
   (`for (const p of grid.values())` naturally skips them since they
   were never placed).

4. **`resetGrid()`** — clear `grid` and `placeCounter` as today; do
   NOT clear `reservedCells` (caller owns that lifecycle via
   `setReservedCells`).

5. **`generate()` center-cross anchor** — guard: if the centre cell is
   reserved, skip the pre-placement. The solver's from-scratch fallback
   handles it.

6. **`getPlacedTilesInOrder()`** — unchanged. Reserved cells never
   entered `grid`, so they naturally don't appear in the output.

### 4c. `rebuild.ts` — wire the reservation call

Before `generateWithRetry`, call `setReservedCells(getReservedPlayfieldCells())`.

Since reserved tiles never enter the placement grid, `rebuild.ts` and
`paint.ts` need no changes — they iterate `getPlacedTilesInOrder()`,
which already omits reserved cells. Streaming module registers only
placed tiles. Far-planes only spawn for registered tiles. All
downstream systems auto-follow.

### 4d. Bump `maxAttempts`

Irregular shapes make the solver work harder. Bump
`generateWithRetry(startSeed, maxAttempts = 500)` default to `2000` (or
make it a settings constant). Cheap — solver quits at first success.

---

## 5. Files touched by the refactor

| File | Kind of change |
|---|---|
| `src/client/perimeter.ts` | Drop `isInsidePlayfield` guard on end-caps; add `getReservedPlayfieldCells()` export. |
| `src/shared/maze/generator.ts` | Add `reservedCells` + `setReservedCells`, rewrite `solveCells` pool policy, update `canPlace`, update `validate`, guard center-cross anchor, bump `maxAttempts`. |
| `src/client/maze/rebuild.ts` | Wire `setReservedCells(getReservedPlayfieldCells())` before `generateWithRetry`. |

Everything downstream (rebuild spawn queue, paint.ts, streaming,
far-planes, locomotion, footsteps) is unchanged.

---

## 6. Test plan

1. **Regression:** with `reservedCells = ∅`, the maze must generate
   identically to today. Same seed → same maze. If not, the dynamic
   pool policy has a subtle off-by-one in wall counting.
2. **Single intrusion:** manually seed one reserved cell in the middle
   of the playfield, verify the maze generates around it with a
   `fork`/`turn` on the adjacent cells.
3. **Full run:** with `getReservedPlayfieldCells()` wired, deploy and
   walk the perimeter. Fork intrusions should now poke into the
   playfield as cliff bump-ins with the maze wrapping around them.
4. **Solver stress:** if `generateWithRetry` returns null on some
   seeds, either bump `maxAttempts` further or check for a specific
   topology the pool policy can't satisfy (likely candidate: a
   reserved cell that leaves a neighbouring cell with 4 walls →
   unreachable island → coverage fails).

---

## 7. Deferred to future sessions

Not to do now. Listed here so the next session doesn't reinvent them.

1. **Deeper / branching cliff canyons.** Currently a fork intrusion is
   1 tile deep (just the `end` cap). Extension: each fork can spawn a
   short mini-maze reaching further inward (2–4 tiles), using
   `turn`/`straight`/`end`. Would reserve more playfield cells;
   generator handles it once the coordination layer exists.
2. **Alt models per topology.** Visual variety — 3 different `end`
   meshes, 2 different `turn` meshes, etc. Deterministic per-placement
   RNG picks. No topology change.
3. **Non-uniform / more circular outer perimeter.** After (1) works,
   see if the outer silhouette actually needs softening. Blocky ring +
   organic canyons may read as circular enough.
4. **Diagonal / decorative cliff wall tiles.** Purely cosmetic mesh
   swaps for outer-ring straights/turns. No topology impact.
5. **Non-uniform perimeter depth.** Multi-row cliff ring, staircased
   silhouettes. Bigger work; wait for real cliff assets first.

---

## 8. Gotchas / things I learned this session

- **`main.crdt` gets stale.** If you regenerate `main.composite`
  externally (via Creator Hub or by scripting), `main.crdt` — which is
  a compiled snapshot of it — must be regenerated too. The SDK build
  regenerates it, but if you're just editing composite manually you
  may need to nudge the build.
- **`scene.json` parcels vs `SCENE_WORLD_SIZE`.** These two must stay
  in lockstep. If parcels < scene size, entities outside the parcel
  bounds silently don't render → looks like "only a quarter of tiles
  loading". Regen script one-liner in the session log below.
- **CH scene footprint** is independent of `scene.json` at CH publish
  time. Must be updated in the CH UI too.
- **CLI `sdk-commands deploy` still blocked** by Node 24 `Symbol(map)`
  proxy bug. Deploy from CH app UI. SDK version pinned exactly (no `^`)
  in package.json to prevent CH publish drift.

### One-liner for scene.json regen at new size

```bash
node -e "
const fs=require('fs'); const N=32; const CENTER=N*16/2; const RANGE=8;
const s=JSON.parse(fs.readFileSync('scene.json','utf8'));
const parcels=[]; for(let z=0;z<N;z++)for(let x=0;x<N;x++)parcels.push(\`\${x},\${z}\`);
s.scene.parcels=parcels; s.scene.base='0,0';
const sp=s.spawnPoints[0];
sp.position.x=[CENTER-RANGE,CENTER+RANGE]; sp.position.z=[CENTER-RANGE,CENTER+RANGE];
sp.cameraTarget.x=CENTER; sp.cameraTarget.z=CENTER;
fs.writeFileSync('scene.json', JSON.stringify(s,null,2)+'\n');
console.log('scene.json:', parcels.length, 'parcels, center', CENTER);
"
```

Change `N` for other sizes. Composite entity coords need a matching
shift; see the second one-liner:

```bash
node -e "
const fs=require('fs'); const path='assets/scene/main.composite';
let t=fs.readFileSync(path,'utf8'); const SHIFT=128; let n=0;
t=t.replace(/\"([xz])\": (-?\d+(?:\.\d+)?)/g,(m,a,v)=>{
  const f=parseFloat(v); if(f>60&&f<200){n++;return \`\"\${a}\": \${f+SHIFT}\`} return m;
});
fs.writeFileSync(path,t); console.log('shifted',n,'coords');
"
```

Adjust `SHIFT` = new_centre − old_centre. Range `60..200` is
plausible-entity-position filter; may need widening for very large
scenes.

---

## 9. Ready-to-run first commit

If the next session wants to land the smallest useful piece
independently:

- Just add `setReservedCells` API + the dynamic pool policy in
  `generator.ts`, leave `reservedCells` empty by default.
- Verify same-seed regression (test 1 above).
- Commit as `refactor(maze): dynamic wall-count pool policy (no
  behaviour change)`.

Then wire `perimeter.ts` and `rebuild.ts` in a second commit — the
behavioural change is isolated and revertable.
