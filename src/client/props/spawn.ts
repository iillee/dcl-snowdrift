/**
 * spawn.ts ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â client-side spawning of scattered props.
 *
 * Converts the pure PropPlacement list produced by
 * src/shared/props/scatter.ts into live entities. Props follow the
 * seed: the seed watcher calls clearProps() then setupProps() on every
 * new seed so they never sit inside a newer cliff layout.
 *
 * Placement is fully deterministic on the shared maze seed, so every
 * client spawns the same props at the same coords without CRDT sync.
 */

import {
	engine, Entity, GltfContainer, Transform,
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { PROP_CATALOG, PropDef } from 'src/shared/props/catalog'
import { scatterProps } from 'src/shared/props/scatter'
import { WOOD_LOGS_PER_TREE } from 'src/shared/woodScatter'


// MARK: Module state
const spawnedEntities: Entity[] = []
const trees: { entity: Entity, fullScale: number }[] = []
let hasSpawned = false
let onTreesSpawned: (() => void) | null = null

const defsById = new Map<string, PropDef>(PROP_CATALOG.map(d => [d.id, d]))


/**
 * Metres each tree sinks below its ground height, per unit of scale.
 * A slight overlap into the ground hides root/base gaps; 0.03 gives
 * 0.12 m at scale 4 up to 0.24 m at scale 8, under the trunk flare.
 */
const TREE_SINK_PER_SCALE_M = 0.03

// MARK: setupProps
/**
 * Spawn all cataloged props for the given seed. Ignored until
 * clearProps() runs, so call clearProps() first on a seed change. Pass
 * the cliff reserved-cell set so props don't land on cliffs.
 */
export function setupProps(seed: number, reservedCells: ReadonlySet<string>): void {
	if (hasSpawned) {
		console.log('props: setupProps: already spawned, ignoring re-invocation')
		return
	}
	if (seed === 0) {
		console.log('props: setupProps: seed is 0, refusing to spawn')
		return
	}
	hasSpawned = true

	const placements = scatterProps(seed, reservedCells)
	for (const p of placements) {
		const def = defsById.get(p.propId)
		if (!def) {
			console.log(`props: setupProps: unknown propId "${p.propId}" ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â skipping`)
			continue
		}
		const e = engine.addEntity()
		// worldY is the prop's own offset; groundY is the terrain surface
		// scatterProps sampled for this seed's map.
		const groundY = p.groundY - (p.propId === 'tree_4' ? p.scale * TREE_SINK_PER_SCALE_M : 0)
		Transform.create(e, {
			position: Vector3.create(p.worldX, groundY + p.worldY, p.worldZ),
			rotation: Quaternion.fromEulerDegrees(0, p.yawDeg, 0),
			scale   : Vector3.create(p.scale, p.scale, p.scale),
		})
		GltfContainer.create(e, { src: def.model })
		spawnedEntities.push(e)
		if (p.propId === 'tree_4') {
			trees.push({ entity: e, fullScale: p.scale })
		}
	}
	console.log(`props: setupProps: spawned ${placements.length} props for seed ${seed}`)
	if (onTreesSpawned) onTreesSpawned()
}


// MARK: clearProps
/**
 * Tear down all spawned prop entities. Called by the seed watcher
 * before every setupProps(). No-op before the first spawn.
 */
export function clearProps(): void {
	for (const e of spawnedEntities) engine.removeEntity(e)
	spawnedEntities.length = 0
	trees.length = 0
	hasSpawned = false
}


// MARK: onPropTreesSpawned

/**
 * Run after the tree models exist. Wood uses this to size them from
 * the logs still at each trunk.
 */
export function onPropTreesSpawned(fn: () => void): void {
	onTreesSpawned = fn
}


// MARK: syncTreeScales

/**
 * Size each tree from how many of its logs are left. 4/4 is the
 * spawned scale, 3/4 is 75% of that, and 0 hides the model.
 */
export function syncTreeScales(remainingByTree: number[]): void {
	for (let i = 0; i < trees.length; i++) {
		const remaining = remainingByTree[i] ?? 0
		const frac      = remaining / WOOD_LOGS_PER_TREE
		const s         = trees[i].fullScale * frac
		Transform.getMutable(trees[i].entity).scale = Vector3.create(s, s, s)
		console.log(
			`props: syncTreeScales: tree ${i} logs=${remaining}/${WOOD_LOGS_PER_TREE} ` +
			`scale=${s.toFixed(2)}`
		)
	}
}
