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

import { SeedHolder, seedHolder } from 'src/shared/components'
import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'

import {
  Placed, TILE_SCALE, CELL, STEP, ROT_OFFSET, MAZE_ORIGIN,
  GRID_W, GRID_H,
  generateWithRetry, getPlacedTilesInOrder, gridSize,
} from 'src/shared/maze/generator'
import { TILES } from 'src/shared/maze/tiles'
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
// BFS `order` threshold below which tiles spawn INSTANTLY at full
// scale, with no grow-in tween. Covers the center tile + its immediate
// ring, so a fresh spawn lands the player on solid ground and never
// gets pushed sideways by a growing collider under their feet.
const INSTANT_SPAWN_ORDER_MAX = 8

/** True while the reveal cascade is still in-flight for the current maze. */
export function isRebuilding(): boolean {
  return spawnQueue.length > 0
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

  const winningSeed = generateWithRetry(seed)
  if (winningSeed === null) {
    console.log(`⚠️ Maze exhausted seeds starting at ${seed} — aborting spawn`)
    return
  }
  currentSeed = winningSeed
  console.log(`Maze rebuilt from seed ${seed} → winning seed ${winningSeed}, ${gridSize()} tiles`)

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

  // Tiles at the very base of the BFS (center + immediate ring) spawn
  // instantly at full scale, no tween. This guarantees solid ground is
  // under the player from the first frame after they spawn in — a
  // growing collider under them was pushing them sideways.
  const isInstant = p.order <= INSTANT_SPAWN_ORDER_MAX

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
  // Soft positional "pop" as each tile appears. Every-other only, so a
  // cascade of ~100 tiles reads as rhythmic sparkle rather than a buzz.
  // Skip pops for instant spawns — they all fire on the same frame and
  // stack into a single loud burst.
  if (!isInstant && p.order % 2 === 0) {
    AudioSource.create(e, {
      audioClipUrl: 'assets/sounds/pop.mp3',
      playing: true,
      loop: false,
      volume: 0.25,
      global: true,
    })
  }
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
