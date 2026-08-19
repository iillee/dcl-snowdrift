/**
 * rebuild.ts — round-to-round maze rebuild pipeline.
 *
 * Owns the visual side of the maze:
 *   - Queueing tile entities to spawn (in BFS-growth order for the reveal cascade)
 *   - Per-frame drain of the spawn queue with a scale-tween grow-in
 *   - Chunked teardown of previous tiles (each tile carries its paint cells with it)
 *
 * Import graph: uses generator (pure, no engine) + paint (spawnCellsForTile,
 * removePaintForTile). Nothing else in the client should call rebuildMaze;
 * the seed watcher in client/index.ts (or wherever it ends up) drives it.
 *
 * NOTE: we intentionally do NOT clear paint state here. Rebuilds adopt
 * whatever PaintCell CRDT colors are already present, so late-joining
 * clients see paint from ongoing sessions immediately.
 */

import {
  engine, Transform, GltfContainer, ColliderLayer,
  Tween, EasingFunction, AudioSource, Entity, MeshRenderer, Material,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { SeedHolder, seedHolder } from 'src/shared/components'
import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'

import {
  Placed, TILE_SCALE, CELL, STEP, ROT_OFFSET, MAZE_ORIGIN,
  GRID_W, GRID_H,
  generateWithRetry, getPlacedTilesInOrder, gridSize,
  setReservedCells,
} from 'src/shared/maze/generator'
import { TILES } from 'src/shared/maze/tiles'
import { getReservedPlayfieldCells, type ReservedTile } from 'src/client/perimeter'
import { spawnCellsForTile, removePaintForTile, resetPaintForTile } from 'src/client/paint'

// Suppress unused-import complaint from the linter — MeshRenderer/Material
// are only kept in the import list for future tile decoration; harmless.
void MeshRenderer; void Material

// ─── Pipeline state ─────────────────────────────────────────────────
const spawnedEntities: Entity[] = []
interface SpawnStep { p: Placed; delay: number }
let spawnQueue: SpawnStep[] = []
let spawnClock = 0
let currentSeed = 0
const teardownQueue: Entity[] = []

// ─── Persistent center cross ────────────────────────────────────────
// The generator always places a `cross` tile at grid center (see
// generate() in generator.ts). We spawn it once on the first rebuild
// and keep the same entity forever so players standing on it during a
// round boundary aren't shoved by the tear-down / grow-in animation.
// On subsequent rebuilds we skip it in both teardown and spawn queues,
// and reset its paint via resetPaintForTile() instead.
let centerTileEntity: Entity | null = null
const CENTER_X = Math.floor(GRID_W / 2)
const CENTER_Z = Math.floor(GRID_H / 2)
const isCenterTile = (p: Placed) =>
  p.x === CENTER_X && p.z === CENTER_Z && p.y === 0
const TILE_TEARDOWN_PER_FRAME = 25
const STAGGER = 0.03 // seconds between successive tile spawns

// Tiles adjacent to the campfire spawn INSTANTLY at full scale, with
// no grow-in tween. Solid ground under the player from frame 1, and
// no collider-under-foot push during the tween. The campfire is at
// world (CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z), which typically sits at
// the corner shared by up to 4 grid tiles — all of them qualify.
//
// (Previous version keyed off `p.order <= 8`, which was correct back
// when the solver was BFS-from-centre. The row-major solver assigns
// order in scan order, so only 1 of the 4 campfire-adjacent tiles
// happened to land in the first 9 slots — hence the "1/4 of the
// campfire tiles load first" bug.)
const CAMPFIRE_TX_F = (CAMPFIRE_WORLD_X - MAZE_ORIGIN) / CELL
const CAMPFIRE_TZ_F = (CAMPFIRE_WORLD_Z - MAZE_ORIGIN) / CELL
const isNearCampfire = (p: Placed): boolean => {
  if (p.y !== 0) return false
  const dx = Math.abs((p.x + 0.5) - CAMPFIRE_TX_F)
  const dz = Math.abs((p.z + 0.5) - CAMPFIRE_TZ_F)
  return dx < 1 && dz < 1
}

/** True while the reveal cascade is still in-flight for the current maze. */
export function isRebuilding(): boolean {
  return spawnQueue.length > 0
}

// Set to true the first time the spawn queue drains after a rebuild.
// Used by the loading splash to know when to fade out on cold-open.
let firstRebuildComplete = false
export function isInitialLoadComplete(): boolean {
  return firstRebuildComplete
}

// ─── Rebuild entry point ────────────────────────────────────────────
export function rebuildMaze(seed: number): void {
  // Push existing tiles into the teardown queue (drained per-frame below).
  // The center tile is preserved: skip its teardown and reset its paint
  // in place so players standing on it aren't disturbed.
  for (const e of spawnedEntities) {
    if (e === centerTileEntity) {
      resetPaintForTile(e)
    } else {
      teardownQueue.push(e)
    }
  }
  spawnedEntities.length = 0
  if (centerTileEntity !== null) spawnedEntities.push(centerTileEntity)
  spawnQueue = []
  spawnClock = 0

  // Feed the generator the current perimeter-cliff intrusion set BEFORE
  // solving. Deterministic on both sides (perimeter has no RNG, maze
  // uses the shared seed) → every client computes the same reservations
  // and produces the same maze without any network sync.
  //
  // We used to run pruneIslands() here — flood-fill from the campfire
  // and reserve any cell it couldn't reach — back when the generator
  // enforced tile-opening topology and orphan cells caused validation
  // failures. Now that every non-reserved cell is just a uniform
  // cross-full tile, orphans are harmless (just snow the player can't
  // walk to). Keeping them fills the narrow corridors that form
  // between mesas and canyon peninsulas — without prune, those stay
  // visibly snow-covered instead of becoming gaps.
  const reserved = getReservedPlayfieldCells()
  setReservedCells(reserved)

  const winningSeed = generateWithRetry(seed)
  if (winningSeed === null) {
    console.log(`⚠️ Maze exhausted seeds starting at ${seed} — aborting spawn`)
    return
  }
  currentSeed = winningSeed
  console.log(
    `rebuild: rebuildMaze: seed ${seed} → winning seed ${winningSeed}, ` +
    `${gridSize()} tiles / ${GRID_W}x${GRID_H} grid ` +
    `(${reserved.length} cells reserved by perimeter)`
  )

  const tiles = getPlacedTilesInOrder()
  // Skip the center tile on rebuilds — it already exists as a persistent
  // entity. On the very first rebuild (centerTileEntity === null) we spawn
  // it like any other tile; spawnTileWithGrow() will latch onto it.
  const skipCenter = centerTileEntity !== null
  spawnQueue = tiles
    .filter(p => !(skipCenter && isCenterTile(p)))
    .map((p, i) => ({ p, delay: i * STAGGER }))

  // Teleport orb pair — deterministic on the current seed: generateWithRetry
  // leaves the RNG in a fixed state, so every client picks the same tile
  // pair without any network sync. Called after tiles are queued so the
  // tiles array is stable.
}

/** For diagnostics / debug HUD only. */
export function getCurrentSeed(): number {
  return currentSeed
}

/**
 * initMazeNet — placeholder for future maze-related network wiring.
 *
 * With rounds removed the seed is set once (first-joiner init in
 * client/index.ts) and any subsequent change to SeedHolder — via CRDT
 * sync from another client, or a future server-owned seed — is picked
 * up by the seed watcher in client/index.ts and drives rebuildMaze().
 */
export function initMazeNet(): void {
  // No-op for now. Kept as an integration point so callers in client/index.ts
  // don't need to change when server-driven maze events return.
}

// ─── Per-frame spawn drain ──────────────────────────────────────────
engine.addSystem((dt: number) => {
  if (spawnQueue.length === 0) return
  spawnClock += dt
  while (spawnQueue.length && spawnQueue[0].delay <= spawnClock) {
    spawnTileWithGrow(spawnQueue.shift()!.p)
  }
  // Latch the first-drain complete signal for the loading splash.
  if (spawnQueue.length === 0 && !firstRebuildComplete) {
    firstRebuildComplete = true
  }
})

function spawnTileWithGrow(p: Placed): void {
  const [dx, dz] = ROT_OFFSET[p.r]
  const e = engine.addEntity()
  // Latch the center tile's entity on first spawn so all future rebuilds
  // can preserve it. (Only reached when centerTileEntity is null; the
  // rebuild filter skips this tile on subsequent rounds.)
  if (centerTileEntity === null && isCenterTile(p)) {
    centerTileEntity = e
  }

  // Tiles under/around the campfire spawn instantly at full scale, no
  // tween. Solid ground under the player from frame 1 and no growing
  // collider pushing them sideways.
  const isInstant = isNearCampfire(p)

  Transform.create(e, {
    position: Vector3.create(p.x * CELL + dx + MAZE_ORIGIN, p.y, p.z * CELL + dz + MAZE_ORIGIN),
    rotation: Quaternion.fromEulerDegrees(0, p.r * 90, 0),
    scale: isInstant
      ? Vector3.create(TILE_SCALE, TILE_SCALE, TILE_SCALE)
      : Vector3.create(0.001, 0.001, 0.001),
  })
  GltfContainer.create(e, {
    src: TILES[p.type].model,
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
  })
  if (!isInstant) {
    Tween.create(e, {
      mode: Tween.Mode.Scale({
        start: Vector3.create(0.001, 0.001, 0.001),
        end: Vector3.create(TILE_SCALE, TILE_SCALE, TILE_SCALE),
      }),
      duration: 500,
      easingFunction: EasingFunction.EF_EASEOUTBACK,
    })
  }
  // (Per-tile pop SFX removed — was noisy on cold-open. If we want an
  // ambient "world assembling" sound back, do it as a single loop on
  // the campfire rather than one AudioSource per tile.)
  spawnedEntities.push(e)

  // Painting overlay: registers the tile with the streaming system,
  // which owns the actual cell spawn. Tiles in the instant-spawn ring
  // (the spawn area + immediate ring) are marked `alwaysSpawned` so
  // they never despawn even if all players wander far — the ground
  // under the spawn point must always be solid.
  spawnCellsForTile(p.type, p.r, p.x, p.z, p.y, CELL, STEP, e, isInstant)
}

// ─── Chunked teardown ───────────────────────────────────────────────
// Each tile carries its paint cells with it via removePaintForTile(), so
// paint disappears the same frame as its parent tile — no ghost paint
// hanging in the air. Draining 25 tiles per frame spreads the ~30k-entity
// cost of a full maze over ~5-10 frames.
engine.addSystem(() => {
  if (teardownQueue.length === 0) return
  const n = Math.min(TILE_TEARDOWN_PER_FRAME, teardownQueue.length)
  for (let i = 0; i < n; i++) {
    const e = teardownQueue.pop()!
    removePaintForTile(e)
    engine.removeEntity(e)
  }
})
