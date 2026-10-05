/**
 * migrationSliceCheckEntry.ts — Node sanity check for three-tier groves
 * + home teaching fires + grove clusters + world scatter.
 * Bundled by scripts/migrationSliceCheck.mjs.
 */

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { listGroveSites } from 'src/shared/grove'
import {
	HIDDEN_CAMPFIRE_COUNT,
	HIDDEN_DEST_PIT_MAX,
	HIDDEN_DEST_PIT_MIN,
	HIDDEN_HOME_COUNT,
	HIDDEN_WORLD_COUNT,
	pickHiddenCampfires,
} from 'src/shared/hiddenCampfire'
import { scatterProps } from 'src/shared/props/scatter'
import {
	TERRAIN_LEVEL_HIGH,
	TERRAIN_LEVEL_LOW,
	TERRAIN_LEVEL_MID,
} from 'src/shared/settings'
import {
	getTerrain,
	offHearthCellsForMazeSeed,
} from 'src/shared/terrain/terrainCache'
import { cellCenterWorld, levelAtWorld } from 'src/shared/terrain/terrainMap'

const seed     = 1
const mazeSeed = cycleMazeSeed(seed)
const map      = getTerrain(mazeSeed)
const groves   = listGroveSites(seed)

console.log(
	'dests',
	map.destinations.map(d => ({
		lv: d.level,
		area: d.area,
		route: d.route,
		at: [d.cx, d.cz],
	})),
)
console.log(
	'groveParams',
	groves.map(g => ({
		lv: g.dest.level,
		trees: g.params.treeCount,
		scale: g.params.radiusScale.toFixed(2),
		wood: `${g.params.woodActive}/${g.params.woodPool}`,
		logs: g.params.logChance.toFixed(2),
		special: g.params.specialDiscovery,
	})),
)

const reserved = offHearthCellsForMazeSeed(mazeSeed)
const trees    = scatterProps(mazeSeed, reserved).filter(p => p.propId === 'tree_4')
console.log('treesTotal', trees.length)

for (const g of groves) {
	const centre = cellCenterWorld(g.dest.cx, g.dest.cz)
	const near = trees.filter(t => {
		const dx = t.worldX - centre.x
		const dz = t.worldZ - centre.z
		return Math.hypot(dx, dz) < 200 * Math.max(0.8, g.params.radiusScale)
	})
	console.log(`treesNear lv=${g.dest.level}`, near.length, 'want~', g.params.treeCount)
}

const pits = pickHiddenCampfires(seed)
console.log('pits', pits.length, '/', HIDDEN_CAMPFIRE_COUNT)
console.log(
	'budget',
	`home=${HIDDEN_HOME_COUNT} grove=${HIDDEN_DEST_PIT_MIN}-${HIDDEN_DEST_PIT_MAX}×` +
	`${map.destinations.length} world=${HIDDEN_WORLD_COUNT} maxSlots=${HIDDEN_CAMPFIRE_COUNT}`,
)

const homeDists = pits
	.map(p => Math.hypot(p.x - CAMPFIRE_WORLD_X, p.z - CAMPFIRE_WORLD_Z))
	.sort((a, b) => a - b)
const near120 = homeDists.filter(d => d < 120).length
console.log(
	'homeNear120',
	near120,
	'nearest',
	homeDists.length ? homeDists[0].toFixed(0) + 'm' : '-',
)

const levels = { L: 0, M: 0, H: 0 }
for (const p of pits) {
	const lv = levelAtWorld(map, p.x, p.z)
	if (lv === TERRAIN_LEVEL_LOW) levels.L++
	else if (lv === TERRAIN_LEVEL_MID) levels.M++
	else if (lv === TERRAIN_LEVEL_HIGH) levels.H++
}
console.log('pitLevels', levels)

for (const g of groves) {
	const centre = cellCenterWorld(g.dest.cx, g.dest.cz)
	const nearFires = pits.filter(p => Math.hypot(p.x - centre.x, p.z - centre.z) < 160).length
	console.log(
		`firesNear160 lv=${g.dest.level}`,
		nearFires,
		`want ${HIDDEN_DEST_PIT_MIN}-${HIDDEN_DEST_PIT_MAX}`,
	)
}
