/** heatFrontCheckEntry.ts - crystal heat front geometry is monotonic, reaches R + band, and matches the sphere. Bundled by heatFrontCheck.mjs. */
import { HEAT_FRONT_BAND_M, heatFrontRadiusM, heatFrontSphereRadiusM } from 'src/shared/heatFront'

let bad = 0
const fail = (m: string): void => { bad++; console.log('FAIL ' + m) }
for (const [R, h] of [[50, 0], [50, 12], [50, 27], [50, 40]]) {
	let prev = -1
	for (let k = 0; k <= 200; k++) {
		const u = k / 200
		const r = heatFrontRadiusM(u, R, h)
		if (r < prev - 1e-9) fail(`non-monotonic R=${R} h=${h} u=${u}`)
		prev = r
		// ground circle of the sphere: r^2 + h^2 = sphere^2 once the sphere has reached the ground
		const s = heatFrontSphereRadiusM(u, R, h)
		if (s > h && Math.abs(r * r + h * h - s * s) > 1e-6) fail(`sphere mismatch R=${R} h=${h} u=${u}`)
	}
	if (Math.abs(heatFrontRadiusM(1, R, h) - (R + HEAT_FRONT_BAND_M)) > 1e-6) fail(`end radius R=${R} h=${h}`)
	if (heatFrontRadiusM(0, R, h) !== 0) fail(`start radius R=${R} h=${h}`)
	// reaches R strictly before the end (so the last cells melt inside the burst)
	let uR = 1
	for (let k = 0; k <= 1000; k++) if (heatFrontRadiusM(k / 1000, R, h) >= R) { uR = k / 1000; break }
	console.log(`R=${R} h=${h}: front reaches R at u=${uR.toFixed(3)}`)
}
console.log(bad === 0 ? 'heatFrontCheck: OK' : `heatFrontCheck: ${bad} FAILURES`)
if (bad) process.exitCode = 1