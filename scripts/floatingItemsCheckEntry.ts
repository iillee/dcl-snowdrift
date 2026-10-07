/**
 * floatingItemsCheckEntry.ts - scans seeds and counts hidden pits / buried
 * wood whose Y is off the terrain surface (centre or footprint) by > 0.3 m.
 * Bundled by scripts/floatingItemsCheck.mjs.
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { pickHiddenCampfires } from 'src/shared/hiddenCampfire'
import { LOGS_PILE_WORLD_Y } from 'src/shared/logs'
import { WORLD_PROFILE } from 'src/shared/settings'
import { getTerrain, offHearthCellsForMazeSeed } from 'src/shared/terrain/terrainCache'
import { groundYAtWorld, TerrainMap } from 'src/shared/terrain/terrainMap'
import { computeWoodScatter, WOOD_BAND_TREE } from 'src/shared/woodScatter'
import { scatterProps } from 'src/shared/props/scatter'
import { groundFlatWithin, cellOfWorld, cellCenterWorld } from 'src/shared/terrain/terrainMap'

/** tree_4 footprint per unit scale: root flare and canopy-vs-wall reach. */
const ROOT_R = 0.6
const WALL_R = 1.0
function tallerWithin(map: TerrainMap, x: number, z: number, r: number): boolean {
	const y = groundYAtWorld(map, x, z)
	const a = cellOfWorld(x - r, z - r), b = cellOfWorld(x + r, z + r)
	for (let cz = a.cz; cz <= b.cz; cz++) for (let cx = a.cx; cx <= b.cx; cx++) {
		const c = cellCenterWorld(cx, cz)
		const dx = Math.max(Math.abs(x - c.x) - 8, 0), dz = Math.max(Math.abs(z - c.z) - 8, 0)
		if (dx * dx + dz * dz >= r * r) continue
		if (groundYAtWorld(map, c.x, c.z) > y + TOL) return true
	}
	return false
}

const TOL = 0.3
const SEEDS = Number(process.argv[2] ?? 12)
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const quiet = g0.__realLog
console.log = () => {}

function footprintOff(map: TerrainMap, x: number, z: number, y: number, r: number): boolean {
	for (let k = 0; k < 16; k++) {
		const a = (k / 16) * Math.PI * 2
		for (const rr of [r * 0.5, r]) {
			if (Math.abs(groundYAtWorld(map, x + Math.sin(a) * rr, z + Math.cos(a) * rr) - y) > TOL) return true
		}
	}
	return false
}

let trees = 0, treeOff = 0, treeEdge = 0, treeWall = 0
let pits = 0, pitCentre = 0, pitEdge = 0, wood = 0, woodCentre = 0, woodEdge = 0
const examples: string[] = []
for (let s = 0; s < SEEDS; s++) {
	const seed = 20000 + s * 7
	const map  = getTerrain(cycleMazeSeed(seed))
	for (const p of pickHiddenCampfires(seed)) {
		pits++
		const g = groundYAtWorld(map, p.x, p.z)
		if (Math.abs(p.y - g) > TOL) { pitCentre++; if (examples.length < 6) examples.push(`pit seed=${seed} (${p.x.toFixed(1)},${p.z.toFixed(1)}) y=${p.y.toFixed(2)} ground=${g.toFixed(2)}`) }
		else if (footprintOff(map, p.x, p.z, p.y, 1.5)) pitEdge++
	}
	for (const p of scatterProps(cycleMazeSeed(seed), offHearthCellsForMazeSeed(cycleMazeSeed(seed)))) {
		if (p.propId !== 'tree_4') continue
		trees++
		const gy = (p as { groundY?: number }).groundY
		if (gy !== undefined && Math.abs(gy - groundYAtWorld(map, p.worldX, p.worldZ)) > TOL) treeOff++
		if (!groundFlatWithin(map, p.worldX, p.worldZ, p.scale * ROOT_R)) treeEdge++
		if (tallerWithin(map, p.worldX, p.worldZ, p.scale * WALL_R)) treeWall++
	}
	const chunks = computeWoodScatter(seed, offHearthCellsForMazeSeed(cycleMazeSeed(seed)))
	for (const c of chunks) {
		if (c.band === WOOD_BAND_TREE) continue
		wood++
		const y = (c as { worldY?: number }).worldY ?? LOGS_PILE_WORLD_Y
		const g = groundYAtWorld(map, c.worldX, c.worldZ)
		if (Math.abs(y - g) > TOL) { woodCentre++; if (examples.length < 12) examples.push(`wood band=${c.band} seed=${seed} (${c.worldX.toFixed(1)},${c.worldZ.toFixed(1)}) y=${y.toFixed(2)} ground=${g.toFixed(2)}`) }
		else if (footprintOff(map, c.worldX, c.worldZ, y, 1.0)) woodEdge++
	}
}
quiet(`[${WORLD_PROFILE}] seeds=${SEEDS}`)
quiet(`  pits : ${pits} total, ${pitCentre} off-ground at centre, ${pitEdge} overhang a cliff edge`)
quiet(`  trees: ${trees} total, ${treeOff} off-ground, ${treeEdge} roots over a cliff edge, ${treeWall} clipping a taller wall`)
quiet(`  wood : ${wood} total, ${woodCentre} off-ground at centre, ${woodEdge} overhang a cliff edge`)
for (const e of examples) quiet('   e.g. ' + e)

