/** nearMonumentCheckEntry.ts - near-spawn monument stats over many seeds. Bundled by nearMonumentCheck.mjs. */
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { generateTerrain } from 'src/shared/terrain/terrainGen'
import { cellCenterWorld } from 'src/shared/terrain/terrainMap'

const args = (globalThis as unknown as { __NEAR_ARGS: { profile: string; seeds: number; baseline: boolean } }).__NEAR_ARGS
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const real = g0.__realLog
const passes: Record<string, number> = {}
let farOnlyLogs = 0
console.log = (...a: unknown[]) => {
	const s = String(a[0])
	const m = /near monument pass=(\S+)/.exec(s)
	if (m) passes[m[1]] = (passes[m[1]] ?? 0) + 1
	if (s.includes('far-only stations')) farOnlyLogs++
}
const dists: number[] = []
const lifts: number[] = []
let present = 0, sameTerrace = 0, three = 0, minOther = Infinity, ms = 0
for (let i = 0; i < args.seeds; i++) {
	const t0 = performance.now()
	const map = generateTerrain(cycleMazeSeed(1000 + i * 7919))
	ms += performance.now() - t0
	if (map.stations.length >= 3) three++
	const s = map.stations[0]
	if (!s || !s.near) continue
	present++
	const c = cellCenterWorld(s.cx, s.cz)
	dists.push(Math.hypot(c.x - CAMPFIRE_WORLD_X, c.z - CAMPFIRE_WORLD_Z))
	lifts.push(s.beamLiftM ?? 0)
	if (s.region === map.hearthRegion) sameTerrace++
	for (const o of map.stations.slice(1)) {
		const oc = cellCenterWorld(o.cx, o.cz)
		minOther = Math.min(minOther, Math.hypot(oc.x - c.x, oc.z - c.z))
	}
}
const n = args.seeds
const q = (a: number[], p: number): string => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))].toFixed(0) : '-' }
const liftHist: Record<string, number> = {}
for (const l of lifts) liftHist[l] = (liftHist[l] ?? 0) + 1
if (args.baseline) {
	real(`[${args.profile}] BASELINE (no near pick): gen ${(ms / n).toFixed(1)} ms/seed, 3 stations ${three}/${n}`)
} else {
	real(`[${args.profile}] seeds=${n} near present ${present}/${n} | 3 stations ${three}/${n} | dist m min/p10/med/p90/max ${q(dists,0)}/${q(dists,0.1)}/${q(dists,0.5)}/${q(dists,0.9)}/${q(dists,0.999)} | same terrace ${sameTerrace}/${present} | lift hist ${JSON.stringify(liftHist)} | passes(all attempts) ${JSON.stringify(passes)} | far-only logs ${farOnlyLogs} | min dist to other monuments ${minOther.toFixed(0)} m | gen ${(ms / n).toFixed(1)} ms/seed`)
}
