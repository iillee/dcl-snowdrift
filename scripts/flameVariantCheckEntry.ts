/** flameVariantCheck: per-fire flame variety is deterministic, position-seeded, distinct, bounded. node scripts/flameVariantCheck.mjs */
import {
	FLAME_ARM_YAW_JITTER_DEG, FLAME_EMBER_PERIOD_VAR, FLAME_HEAT_SHIFT, FLAME_NEUTRAL, FLAME_SIZE_VARIANCE, FLAME_SPEED_MAX, FLAME_SPEED_MIN,
	FLAME_TONGUE_PERIOD_VAR, flameLightSeed, flameVariantFor,
} from 'src/shared/flameVariant'
let fails = 0
const ok = (name: string, c: boolean, info = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!c) fails++ }

const a1 = flameVariantFor(12.34, -56.78)
const a2 = flameVariantFor(12.34, -56.78)
ok('deterministic: same position, same variant', JSON.stringify(a1) === JSON.stringify(a2))
ok('same cm-rounded position matches', JSON.stringify(flameVariantFor(12.3401, -56.7799)) === JSON.stringify(a1))
ok('light seed deterministic', flameLightSeed(1, 2) === flameLightSeed(1, 2))

// Bounds over a grid of positions.
let inBounds = true
let minSize = 9, maxSize = 0
const sigs = new Set<string>()
const near: ReturnType<typeof flameVariantFor>[] = []
for (let x = -150; x <= 150; x += 7.5) for (let z = -150; z <= 150; z += 7.5) {
	const v = flameVariantFor(x, z)
	sigs.add(`${v.speed.toFixed(3)}|${v.timeOffset.toFixed(3)}|${v.tonguePhase[0].toFixed(3)}`)
	if (v.size < 1 - FLAME_SIZE_VARIANCE - 1e-9 || v.size > 1 + FLAME_SIZE_VARIANCE + 1e-9) inBounds = false
	if (v.speed < FLAME_SPEED_MIN || v.speed > FLAME_SPEED_MAX) inBounds = false
	if (v.timeOffset < 0 || v.timeOffset >= 10) inBounds = false
	if (Math.abs(v.heatShift) > FLAME_HEAT_SHIFT + 1e-9) inBounds = false
	if (Math.abs(v.armYawDeg - 90) > FLAME_ARM_YAW_JITTER_DEG + 1e-9) inBounds = false
	for (const p of v.tonguePeriod) if (Math.abs(p - 1) > FLAME_TONGUE_PERIOD_VAR + 1e-9) inBounds = false
	for (const p of v.emberPeriod) if (Math.abs(p - 1) > FLAME_EMBER_PERIOD_VAR + 1e-9) inBounds = false
	for (const p of [...v.tonguePhase, ...v.emberPhase]) if (p < 0 || p >= 1) inBounds = false
	minSize = Math.min(minSize, v.size); maxSize = Math.max(maxSize, v.size)
	if (near.length < 6 && Math.abs(x) < 20 && Math.abs(z) < 20) near.push(v)
}
ok('all variant values within documented bounds', inBounds)
ok('grid of 1681 fires -> (almost) all distinct', sigs.size > 1600, `distinct=${sigs.size}`)
ok('size actually varies', maxSize - minSize > FLAME_SIZE_VARIANCE, `range ${minSize.toFixed(2)}..${maxSize.toFixed(2)}`)

// Two fires 18 m apart (the minimum spacing) must differ in clock AND card phases.
const p = flameVariantFor(0, 0), q = flameVariantFor(18, 0)
ok('18 m neighbours: different clock', Math.abs(p.timeOffset - q.timeOffset) > 0.05 || Math.abs(p.speed - q.speed) > 0.02)
let diffPhases = 0
for (let i = 0; i < 12; i++) if (Math.abs(p.tonguePhase[i] - q.tonguePhase[i]) > 0.05) diffPhases++
ok('18 m neighbours: most tongue phases differ', diffPhases >= 8, `${diffPhases}/12`)
ok('neutral variant is identity', FLAME_NEUTRAL.size === 1 && FLAME_NEUTRAL.speed === 1 && FLAME_NEUTRAL.timeOffset === 0 && FLAME_NEUTRAL.tonguePeriod.every(v => v === 1))
ok('has near samples', near.length === 6)

console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`)
if (fails > 0) process.exit(1)