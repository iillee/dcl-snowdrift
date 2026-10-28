/**
 * socketLavaCheck - lava on the floor of a released monument's socket (src/shared/socketLava.ts, client/socketLava.ts):
 *  - geometry: the pool sits inside the socket (floor .. floor + thickness, below ground, never under y = 0.03 on a low terrace);
 *  - timing: it appears only once the crystal's bottom tip has cleared it (frozen / rising = none), fills in over SOCKET_LAVA_RISE_S, stays,
 *    and is gone when the monument is not released (new world);
 *  - sync / late join: presence is a pure function of (released, crystal pose), so clients that joined at different times converge to the
 *    same value, a late joiner snapped to the hovering pose gets the full pool after the same ramp; works for any monument count / profile;
 *  - relight (the existing torch interaction): beside the socket at ground height = yes, far / far above / not yet lit = no;
 *  - NOT living flame: it never keeps the world from ending and is no wake point for frozen players (no server / wake path knows it);
 *  - wiring (source facts): same lava material as the volcano, no new message / asset / collider, E prompt + torch button use it, reset on world change.
 * Bundled by scripts/socketLavaCheck.mjs.
 */
import { readFileSync } from 'node:fs'

import {
	SOCKET_LAVA_ABOVE_M, SOCKET_LAVA_CLEAR_M, SOCKET_LAVA_LIT_MIN, SOCKET_LAVA_REACH_M, SOCKET_LAVA_RISE_S,
	SOCKET_LAVA_SIZE_M, SOCKET_LAVA_THICK_M, socketLavaCanRelight, socketLavaClear, socketLavaDistance, socketLavaFloorY, socketLavaHeightM,
	socketLavaPresenceStep, socketLavaThickM, socketLavaTopY,
} from 'src/shared/socketLava'
import { MONUMENT_SOCKET_DEPTH_M, MONUMENT_SOCKET_MIN_FLOOR_Y, MONUMENT_SOCKET_SIZE_M } from 'src/shared/terrain/terrainMap'

const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
let bad = 0
const fail = (m: string): void => { bad++; if (bad <= 40) say('FAIL ' + m) }
const src = (p: string): string => readFileSync(p, 'utf8')
const code = (p: string): string => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// --- geometry (terraces: low ground 0.25 m, normal ground, high ground) ---
for (const ground of [0.25, 0.9, 4, 17.5]) {
	const floor = socketLavaFloorY(ground), top = socketLavaTopY(ground)
	if (floor < MONUMENT_SOCKET_MIN_FLOOR_Y - 1e-9) fail(`floor ${floor} under the minimum floor Y at ground ${ground}`)
	if (ground - floor > MONUMENT_SOCKET_DEPTH_M + 1e-9) fail(`socket deeper than ${MONUMENT_SOCKET_DEPTH_M} m at ground ${ground}`)
	if (Math.abs(top - floor - socketLavaThickM(ground)) > 1e-9 || socketLavaThickM(ground) > SOCKET_LAVA_THICK_M + 1e-9 || socketLavaThickM(ground) <= 0) fail('lava thickness wrong')
	// the pool always stays under the ground / the invisible plug (a pool poking above it would block the player)
	if (top > ground + 1e-9) fail(`pool top ${top} above the ground ${ground}`)
}
if (!(SOCKET_LAVA_SIZE_M < MONUMENT_SOCKET_SIZE_M)) fail('pool wider than the socket')
if (!(SOCKET_LAVA_THICK_M < MONUMENT_SOCKET_DEPTH_M)) fail('pool thicker than the socket is deep')

// --- timing: frozen (obelisk bottom 14-18 m down) / rising = none, hovering = pool ---
const G = 3
const frozenBottom = G - 14, hoverBottom = G + 20
if (socketLavaClear(frozenBottom, G)) fail('the pool shows while the obelisk still fills the socket')
if (socketLavaClear(socketLavaTopY(G) + SOCKET_LAVA_CLEAR_M - 0.01, G)) fail('the pool shows before the crystal tip cleared it')
if (!socketLavaClear(socketLavaTopY(G) + SOCKET_LAVA_CLEAR_M, G)) fail('the pool is not shown once the crystal cleared it')
if (!socketLavaClear(hoverBottom, G)) fail('hovering crystal does not show the pool')
if (Math.abs(socketLavaHeightM(1, G) - SOCKET_LAVA_THICK_M) > 1e-9 || socketLavaHeightM(0, G) !== 0 || socketLavaHeightM(2, G) !== SOCKET_LAVA_THICK_M) fail('height(presence)')

function run(p0: number, steps: number, dt: number, clear: boolean): number { let p = p0; for (let i = 0; i < steps; i++) p = socketLavaPresenceStep(p, dt, clear); return p }
{
	const full = run(0, Math.ceil(SOCKET_LAVA_RISE_S / 0.05) + 1, 0.05, true)
	if (full !== 1) fail(`presence after ${SOCKET_LAVA_RISE_S} s is ${full}, not 1`)
	if (run(0, Math.floor(SOCKET_LAVA_RISE_S / 0.05 / 2), 0.05, true) >= 1) fail('the pool is full before the ramp ended')
	if (run(1, 1000, 0.05, true) !== 1) fail('presence exceeds 1')
	if (run(1, Math.ceil(SOCKET_LAVA_RISE_S / 0.05) + 1, 0.05, false) !== 0) fail('the pool does not go away when the monument is not released (new world)')
	// frame-rate independence: 30 fps vs 60 fps vs one big step reach the same value
	const a = run(0, 60, 1 / 60, true), b = run(0, 30, 1 / 30, true), c = run(0, 1, 1, true)
	if (Math.abs(a - b) > 1e-9 || Math.abs(a - Math.min(1, 1 / SOCKET_LAVA_RISE_S)) > 1e-9 || c !== Math.min(1, 1 / SOCKET_LAVA_RISE_S)) fail('presence depends on the frame rate')
}

// --- sync / late join: clients that joined at different moments converge (state = released + pose only), any monument count ---
for (const count of [3, 6, 8]) {
	for (let m = 0; m < count; m++) {
		const ground = 1 + m * 2.3
		const released = m % 2 === 0 || count === 3
		// client X watched the rise (bottom climbs over 10 s), client Y joined at the end (snapped to the hovering pose), client Z reloaded 30 s later
		let px = 0
		for (let t = 0; t < 40; t += 0.1) { const bottom = (ground - 14) + Math.min(1, t / 10) * (hoverBottom - (ground - 14) + 14); px = socketLavaPresenceStep(px, 0.1, released && socketLavaClear(bottom, ground)) }
		const py = run(0, 100, 0.05, released && socketLavaClear(hoverBottom + ground, ground))
		const pz = run(0, 600, 0.05, released && socketLavaClear(hoverBottom + ground, ground))
		const want = released ? 1 : 0
		if (px !== want || py !== want || pz !== want) fail(`monument ${m}/${count}: clients disagree (${px}, ${py}, ${pz}), want ${want}`)
	}
}

// --- relight (the existing torch interaction) ---
{
	const cx = 100, cz = 200, ground = 3
	const half = SOCKET_LAVA_SIZE_M / 2
	const ok = (x: number, y: number, z: number, p = 1): boolean => socketLavaCanRelight(x, y, z, cx, cz, ground, p)
	if (!ok(cx + half + 1, ground, cz)) fail('cannot relight beside the socket')
	if (!ok(cx, ground + 1, cz)) fail('cannot relight standing over the pool')
	if (!ok(cx + half + SOCKET_LAVA_REACH_M - 0.01, ground, cz)) fail('cannot relight at the edge of the reach')
	if (ok(cx + half + SOCKET_LAVA_REACH_M + 0.5, ground, cz)) fail('relight reaches too far')
	if (ok(cx + half + 1, ground + SOCKET_LAVA_ABOVE_M + 1, cz)) fail('relight from high above')
	if (ok(cx + half + 1, ground - 5, cz)) fail('relight from far below')
	if (ok(cx + half + 1, ground, cz, SOCKET_LAVA_LIT_MIN - 0.01)) fail('relight from a pool that is not lit yet')
	if (socketLavaDistance(cx, cz, cx, cz) !== 0 || Math.abs(socketLavaDistance(cx + half + 3, cz, cx, cz) - 3) > 1e-9) fail('distance to the pool edge')
}

// --- not living flame: the world end / frozen wake never see the socket lava ---
{
	for (const f of ['src/server/stations.ts', 'src/server/frostLife.ts', 'src/server/worldFlame.ts', 'src/client/frost/death.ts', 'src/shared/messages.ts']) {
		if (/socketLava|SocketLava|SOCKET_LAVA/.test(code(f))) fail(f + ' knows the socket lava (it must not act as living flame / wake point)')
	}
	if (/KEEPS_WORLD_ALIVE|isSocketLavaLit|nearestSocketLava/.test(code('src/shared/socketLava.ts') + code('src/client/socketLava.ts') + code('src/client/volcanoCrown.ts'))) fail('a living-flame path for the socket lava exists')
}

// --- wiring (source facts) ---
{
	const cli = code('src/client/socketLava.ts'), look = code('src/client/lavaLook.ts'), vol = code('src/client/volcanoCrown.ts'), sm = code('src/client/stationMarkers.ts')
	if (!/paintLava\(pool\.e, SOCKET_LAVA_HEAT, SOCKET_LAVA_EMISSIVE \* pool\.p\)/.test(cli)) fail('socket lava is not painted with the shared lava material')
	if (!/paintLava\(c\.e, p\.heat, p\.emis \* a\)/.test(vol) || !/export function paintLava/.test(look)) fail('the volcano lava no longer uses the shared lava material')
	if (/MeshCollider|ColliderLayer/.test(cli)) fail('socket lava has a collider (the socket plug already keeps players out)')
	if (/GltfContainer|AudioSource|room\.send|room\.onMessage/.test(cli)) fail('socket lava adds assets / messages (it must derive from the synced release only)')
	if (!/isInSocketLavaRelightRange\(\)\) return true/.test(vol)) fail('volcanoCrown.isInLavaRelightRange ignores the socket lava')
	if (!/isInLavaRelightRange\(\)/.test(code('src/client/torchInput.ts')) || !/isInLavaRelightRange\(\)/.test(code('src/client/ui/layers/layer.relightPrompt.tsx'))) fail('E / torch button / prompt do not use the lava relight')
	if (!/engine\.addSystem\(socketLavaSystem\)/.test(sm) || !/updateSocketLava\(i, slot\.x, slot\.z, slot\.groundY, slot\.active, bottomY, dt\)/.test(sm)) fail('stationMarkers does not drive the socket lava from slot.active + the crystal pose')
	if (!/function clearAll\(\): void \{[\s\S]*?clearSocketLava\(\)/.test(sm)) fail('the socket lava is not cleared on a world change')
	if (/socketLava|SOCKET_LAVA/.test(code('src/shared/messages.ts'))) fail('socket lava added a message')
}

say(bad === 0 ? 'socketLavaCheck: OK' : `socketLavaCheck: ${bad} FAILURES`)
if (bad) process.exitCode = 1