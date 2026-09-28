/**
 * spawn.ts — client-side spawning of scattered props.
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


// MARK: Module state
const spawnedEntities: Entity[] = []
let hasSpawned = false

const defsById = new Map<string, PropDef>(PROP_CATALOG.map(d => [d.id, d]))


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
			console.log(`props: setupProps: unknown propId "${p.propId}" — skipping`)
			continue
		}
		const e = engine.addEntity()
		Transform.create(e, {
			position: Vector3.create(p.worldX, p.worldY, p.worldZ),
			rotation: Quaternion.fromEulerDegrees(0, p.yawDeg, 0),
			scale   : Vector3.create(p.scale, p.scale, p.scale),
		})
		GltfContainer.create(e, { src: def.model })
		spawnedEntities.push(e)
	}
	console.log(`props: setupProps: spawned ${placements.length} props for seed ${seed}`)
}


// MARK: clearProps
/**
 * Tear down all spawned prop entities. Called by the seed watcher
 * before every setupProps(). No-op before the first spawn.
 */
export function clearProps(): void {
	for (const e of spawnedEntities) engine.removeEntity(e)
	spawnedEntities.length = 0
	hasSpawned = false
}
