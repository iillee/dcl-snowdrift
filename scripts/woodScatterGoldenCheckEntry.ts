/**
 * woodScatterGoldenCheck: guards the buried / scatter wood and tree layout against silent loss (e.g. a cleanup that drops a band, a
 * pool or a constant). For the compact_3 profile and 6 fixed seeds it pins the number of wood chunks per band and the tree count.
 * The numbers are the ones the build produced before the 2026-10-29 cleanup (commit ee078cd) and after it: identical.
 * If a deliberate wood change moves them, update the table below in the same commit. Other profiles are skipped.
 * Bundled by scripts/woodScatterGoldenCheck.mjs.
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { WORLD_PROFILE } from 'src/shared/settings'
import { offHearthCellsForMazeSeed } from 'src/shared/terrain/terrainCache'
import { computeWoodScatter, WOOD_BAND_DEST, WOOD_BAND_FRONTIER_RING, WOOD_BAND_FRONTIER_ROUTE, WOOD_BAND_ICED_CLUSTER, WOOD_BAND_TREE } from 'src/shared/woodScatter'
import { scatterProps } from 'src/shared/props/scatter'

const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
let fails = 0
const ok = (name: string, c: boolean, info = ''): void => { say(`${c ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!c) fails++ }

if (WORLD_PROFILE !== 'compact_3') {
	say(`woodScatterGoldenCheck: skipped (profile ${WORLD_PROFILE}; the table is for compact_3)`)
} else {
	const SEEDS = 6
	const byBand: Record<number, number> = {}
	let trees = 0
	for (let s = 0; s < SEEDS; s++) {
		const seed  = 20000 + s * 7
		const cells = offHearthCellsForMazeSeed(cycleMazeSeed(seed))
		for (const c of computeWoodScatter(seed, cells)) byBand[c.band] = (byBand[c.band] ?? 0) + 1
		trees += scatterProps(cycleMazeSeed(seed), cells).length
	}
	// band index -> chunks over the 6 seeds (0 near, 1 far, 2 tree, 3 outer, 4 destination, 5 frontier route, 6 frontier ring, 7 iced cluster)
	const GOLDEN: Record<number, number> = { 0: 360, 1: 1080, 2: 596, 3: 420, 4: 776, 5: 480, 6: 480, 7: 138 }
	for (const b of Object.keys(GOLDEN).map(Number)) ok(`wood band ${b} count`, byBand[b] === GOLDEN[b], `got ${byBand[b]} want ${GOLDEN[b]}`)
	ok('no unknown wood band', Object.keys(byBand).every((k) => k in GOLDEN))
	ok('buried destination wood exists', (byBand[WOOD_BAND_DEST] ?? 0) > 0)
	ok('tree wood exists', (byBand[WOOD_BAND_TREE] ?? 0) > 0 && WOOD_BAND_FRONTIER_RING > 0 && WOOD_BAND_FRONTIER_ROUTE > 0 && WOOD_BAND_ICED_CLUSTER > 0)
	ok('scattered props (trees)', trees === 149, `got ${trees} want 149`)
}
if (fails) process.exit(1)