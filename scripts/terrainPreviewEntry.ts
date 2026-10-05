/**
 * terrainPreviewEntry.ts — Node-only preview of generateTerrain().
 *
 * Renders a contact sheet of seeds plus a stats table so the generator
 * can be tuned without launching the Explorer. Bundled and run by
 * scripts/terrainPreview.mjs.
 *
 * Legend: Low = dark blue, Middle = grey-blue, High = white,
 * Mountain = brown, dark lines = cliffs, orange = hearth,
 * yellow = ladder, green = destination. Landform tint: canyon red,
 * ridge cyan, plateau green, basin violet.
 */

import { writeFileSync } from 'fs'
import { join } from 'path'

import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import {
	TERRAIN_LEVEL_HIGH,
	TERRAIN_LEVEL_LOW,
	TERRAIN_LEVEL_MID,
	TERRAIN_LEVEL_MOUNTAIN,
} from 'src/shared/settings'
import { generateTerrain, mergeLevelRects, terrainPieceStats } from 'src/shared/terrain/terrainGen'
import {
	LANDFORM_BASIN,
	LANDFORM_CANYON,
	LANDFORM_PLATEAU,
	LANDFORM_RIDGE,
	TerrainMap,
} from 'src/shared/terrain/terrainMap'
import { encodePngRgb } from 'src/shared/utils/pngEncoder'

declare const process: { argv: string[] }

const PX      = 5
const GAP     = 6
const COLS    = 4

const LEVEL_RGB: Record<number, [number, number, number]> = {
	[TERRAIN_LEVEL_LOW]:      [70, 92, 135],
	[TERRAIN_LEVEL_MID]:      [165, 180, 202],
	[TERRAIN_LEVEL_HIGH]:     [240, 244, 250],
	[TERRAIN_LEVEL_MOUNTAIN]: [110, 92, 80],
}
const LANDFORM_TINT: Record<number, [number, number, number]> = {
	[LANDFORM_CANYON]:  [200, 60, 60],
	[LANDFORM_RIDGE]:   [60, 200, 220],
	[LANDFORM_PLATEAU]: [80, 200, 90],
	[LANDFORM_BASIN]:   [170, 90, 220],
}


// MARK: main
function main(): void {
	const count    = Number(process.argv[2] ?? 12)
	const firstRun = Number(process.argv[3] ?? 1)
	const maps: TerrainMap[] = []
	const rows: string[]     = []
	let maxMs     = 0
	let maxPieces = 0
	let sumPieces = 0
	let retries   = 0

	for (let k = 0; k < count; k++) {
		const run    = firstRun + k
		const seed   = cycleMazeSeed(run)
		const t0     = Date.now()
		const map    = generateTerrain(seed)
		const ms     = Date.now() - t0
		const pieces = terrainPieceStats(map)
		maps.push(map)

		const area = [0, 0, 0, 0]
		for (const lv of map.levels) area[lv]++
		const walk = area[0] + area[1] + area[2]
		const pct  = (n: number): string => `${Math.round((n / walk) * 100)}%`.padStart(4)
		const dests = map.destinations.map(d => `${d.level === TERRAIN_LEVEL_HIGH ? 'H' : 'L'}${d.area}@${d.route}`).join(' ')

		rows.push(
			`run ${String(run).padStart(3)}  try ${map.attempts}  ` +
			`L/M/H ${pct(area[0])}${pct(area[1])}${pct(area[2])}  ` +
			`regions ${String(map.regionLevel.length).padStart(3)}  ` +
			`hearth ${String(map.regionArea[map.hearthRegion]).padStart(4)}c  ` +
			`ladders ${String(pieces.ladders).padStart(2)}  ` +
			`slabs ${String(mergeLevelRects(map).length).padStart(4)}  ` +
			`kit o${pieces.outer} e${pieces.edge} i${pieces.inner} d${pieces.diag} = ${pieces.total}  ` +
			`dest ${dests || '-'}  ${ms}ms`
		)
		maxMs     = Math.max(maxMs, ms)
		maxPieces = Math.max(maxPieces, pieces.total)
		sumPieces += pieces.total
		if (map.attempts > 1) retries++
	}

	console.log(rows.join('\n'))
	console.log(
		`\n${count} seeds  avg pieces ${Math.round(sumPieces / count)}  max pieces ${maxPieces}  ` +
		`max gen ${maxMs}ms  seeds needing retry ${retries}`
	)

	const out = join('scripts', 'out', 'terrain-preview.png')
	writeFileSync(out, renderSheet(maps))
	console.log(`wrote ${out}`)
}


// MARK: renderSheet
function renderSheet(maps: TerrainMap[]): Uint8Array {
	const tileW = maps[0].w * PX
	const tileH = maps[0].h * PX
	const rows  = Math.ceil(maps.length / COLS)
	const W     = COLS * tileW + (COLS + 1) * GAP
	const H     = rows * tileH + (rows + 1) * GAP
	const rgb   = new Uint8Array(W * H * 3).fill(24)

	const put = (x: number, y: number, c: [number, number, number]): void => {
		if (x < 0 || y < 0 || x >= W || y >= H) return
		const o = (y * W + x) * 3
		rgb[o]     = c[0]
		rgb[o + 1] = c[1]
		rgb[o + 2] = c[2]
	}

	maps.forEach((map, k) => {
		const ox = GAP + (k % COLS) * (tileW + GAP)
		const oy = GAP + Math.floor(k / COLS) * (tileH + GAP)
		// Image Y grows downward; flip so +Z (north) is up.
		const px = (cx: number, cz: number, dx: number, dy: number): [number, number] =>
			[ox + cx * PX + dx, oy + (map.h - 1 - cz) * PX + dy]

		for (let cz = 0; cz < map.h; cz++) {
			for (let cx = 0; cx < map.w; cx++) {
				const i    = cz * map.w + cx
				const lv   = map.levels[i]
				let c      = LEVEL_RGB[lv]
				const tint = LANDFORM_TINT[map.landforms[i]]
				if (tint) c = mix(c, tint, 0.3)
				for (let dy = 0; dy < PX; dy++) {
					for (let dx = 0; dx < PX; dx++) {
						const [x, y] = px(cx, cz, dx, dy)
						put(x, y, c)
					}
				}
				// Cliff lines on the high side of every level change.
				const nb = (nx: number, nz: number): number =>
					nx < 0 || nz < 0 || nx >= map.w || nz >= map.h ? lv : map.levels[nz * map.w + nx]
				const dark = mix(c, [20, 20, 30], 0.6)
				if (nb(cx - 1, cz) < lv) for (let d = 0; d < PX; d++) put(...px(cx, cz, 0, d), dark)
				if (nb(cx + 1, cz) < lv) for (let d = 0; d < PX; d++) put(...px(cx, cz, PX - 1, d), dark)
				if (nb(cx, cz + 1) < lv) for (let d = 0; d < PX; d++) put(...px(cx, cz, d, 0), dark)
				if (nb(cx, cz - 1) < lv) for (let d = 0; d < PX; d++) put(...px(cx, cz, d, PX - 1), dark)
			}
		}

		for (const l of map.ladders) {
			for (const [cx, cz] of [[l.lowCx, l.lowCz], [l.highCx, l.highCz]]) {
				for (let dy = 0; dy < PX; dy++) {
					for (let dx = 0; dx < PX; dx++) put(...px(cx, cz, dx, dy), [255, 220, 40])
				}
			}
		}
		for (const d of map.destinations) {
			for (let dz = -1; dz <= 1; dz++) {
				for (let dx = -1; dx <= 1; dx++) {
					for (let y = 0; y < PX; y++) {
						for (let x = 0; x < PX; x++) put(...px(d.cx + dx, d.cz + dz, x, y), [40, 210, 80])
					}
				}
			}
		}
		for (let dz = 0; dz <= 1; dz++) {
			for (let dx = 0; dx <= 1; dx++) {
				for (let y = 0; y < PX; y++) {
					for (let x = 0; x < PX; x++) put(...px(map.hearthCx - 1 + dx, map.hearthCz - 1 + dz, x, y), [255, 130, 30])
				}
			}
		}
	})

	return encodePngRgb(W, H, rgb)
}


// MARK: mix
function mix(
	a: [number, number, number],
	b: [number, number, number],
	t: number,
): [number, number, number] {
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t),
	]
}


main()
