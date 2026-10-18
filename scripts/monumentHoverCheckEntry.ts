/** monumentHoverCheckEntry.ts - hover heights + volcano beam angles for all monuments over N seeds. Bundled by monumentHoverCheck.mjs. */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { groundYForLevel, sceneHeightLimitM } from 'src/shared/settings'
import { generateTerrain } from 'src/shared/terrain/terrainGen'
import { cellCenterWorld, monumentHoverBottomY } from 'src/shared/terrain/terrainMap'

// Mirrors stationMarkers: OB_TOTAL_M (14 + 2*4), HOVER_BOB_M, HOVER_CEILING_MARGIN_M.
const OB_TOTAL_M = 22
const BOB_M = 0.3
const CEIL_MARGIN_M = 24
const SNOW_TOP_MARGIN_M = 6

const args = (globalThis as unknown as { __HOVER_ARGS: { profile: string; seeds: number } }).__HOVER_ARGS
const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const real = g0.__realLog
let farOnly = 0
console.log = (...a: unknown[]) => { if (String(a[0]).includes('far-only stations')) farOnly++ }

const ceil = sceneHeightLimitM()
const capTop = ceil - CEIL_MARGIN_M - BOB_M
const bottoms: number[] = [], tops: number[] = [], aboveGround: number[] = [], angles: number[] = []
const lifts: Record<string, number> = {}
let three = 0, capped = 0, up = 0, maxPeak = 0
for (let i = 0; i < args.seeds; i++) {
	const map = generateTerrain(cycleMazeSeed(1000 + i * 7919))
	if (map.stations.length >= 3) three++
	for (const s of map.stations) {
		const c = cellCenterWorld(s.cx, s.cz)
		const gy = groundYForLevel(s.level)
		const aimY = s.aimY ?? 0
		const want = monumentHoverBottomY(gy, aimY, s.beamLiftM ?? 0)
		const bottom = Math.min(want, capTop - OB_TOTAL_M)
		if (bottom < want) capped++
		const top = bottom + OB_TOTAL_M
		maxPeak = Math.max(maxPeak, top + BOB_M)
		bottoms.push(bottom); tops.push(top); aboveGround.push(bottom - gy)
		const h = Math.hypot((s.aimX ?? c.x) - c.x, (s.aimZ ?? c.z) - c.z)
		const ang = Math.atan2(bottom - aimY, h) * 180 / Math.PI // + = beam descends
		angles.push(ang)
		if (ang <= 0) up++
		const k = String(s.beamLiftM ?? 0)
		lifts[k] = (lifts[k] ?? 0) + 1
	}
}
const q = (a: number[], p: number): string => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))].toFixed(1) : '-' }
real(`[${args.profile}] seeds ${args.seeds} | 3 monuments ${three}/${args.seeds} | far-only logs ${farOnly} | ceiling ${ceil.toFixed(1)} m (top cap ${capTop.toFixed(1)}, snow top ${(ceil - SNOW_TOP_MARGIN_M).toFixed(1)})`)
real(`  bottom tip Y min/med/max ${q(bottoms,0)}/${q(bottoms,0.5)}/${q(bottoms,0.999)} | top tip Y ${q(tops,0)}/${q(tops,0.5)}/${q(tops,0.999)} | peak incl bob ${maxPeak.toFixed(1)} | bottom above ground ${q(aboveGround,0)}/${q(aboveGround,0.5)}/${q(aboveGround,0.999)} m | ceiling-capped ${capped}`)
real(`  beam down-angle deg min/med/max ${q(angles,0)}/${q(angles,0.5)}/${q(angles,0.999)} | level or upward ${up} | lift hist ${JSON.stringify(lifts)}`)
