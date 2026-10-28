/**
 * freezeThawCheck - the freeze / thaw loop between players (src/client/frost/{death,rescue}.ts, src/server/frostLife.ts):
 * "a full frost bar freezes you in ice where you stand. Another player's lit torch thaws you (hold it within ICE_RESCUE_RADIUS_M for
 * ICE_THAW_S). If you are not thawed in ICE_RESOLVE_S you wake at a lit fire; with every fire dark you stay frozen and a torch can still thaw you."
 *  - numbers: the three tuning values and the melt steps they imply;
 *  - client gate (rescue.ts tickThaw): only with a LIT torch, never while frozen yourself, only a frozen OTHER player inside the radius, the
 *    rescue ask is sent after ICE_THAW_S of held contact and the melt hold is released when the torch / target goes away;
 *  - server (frostLife.ts): a rescue / melt needs a non-frozen rescuer who is not the target, and a frozen target; thaw clears the cube;
 *  - wake: a frozen player wakes only at a lit hearth / hidden fire / volcano lava; a released monument's socket lava is a torch relight source
 *    only (never a wake point, never living flame), on the client (nearestLitFire) and on the server (anyLivingFire for the give-up).
 * Bundled by scripts/freezeThawCheck.mjs.
 */
import { readFileSync } from 'node:fs'

import { ICE_REGROW_S, ICE_RESCUE_RADIUS_M, ICE_RESOLVE_S, ICE_THAW_S } from 'src/shared/frost/tuning'

const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
let bad = 0
const fail = (m: string): void => { bad++; if (bad <= 40) say('FAIL ' + m) }
const code = (p: string): string => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// --- numbers ---
if (ICE_RESCUE_RADIUS_M !== 3) fail(`rescue radius ${ICE_RESCUE_RADIUS_M} (design: 3 m)`)
if (ICE_THAW_S !== 3) fail(`thaw time ${ICE_THAW_S} s (design: 3 s)`)
if (ICE_RESOLVE_S !== 15) fail(`resolve time ${ICE_RESOLVE_S} s (design: 15 s)`)
if (!(ICE_REGROW_S > 0 && ICE_RESOLVE_S > ICE_THAW_S)) fail('a torch could not thaw before the cube resolves by itself')
// melt steps shown to everyone: 0 .. floor(ICE_THAW_S) - 1 (thirds), the last third is the rescue itself
const partial = Math.floor(ICE_THAW_S) - 1
if (partial < 1) fail('no partial melt steps')

// --- client gate: rescue.ts tickThaw ---
{
	const r = code('src/client/frost/rescue.ts')
	if (!/if \(!isTorchLit\(\) \|\| \(selfFrozen !== null && !selfFrozen\.awake\)\) \{\s*releaseMelt\(\)/.test(r)) fail('thaw is not gated on a LIT torch and a not-frozen rescuer')
	if (!/for \(const \[id, spot\] of remoteFrozen\) \{\s*if \(id === me\) continue/.test(r)) fail('closestFrozenOther does not skip yourself / only look at frozen others')
	if (!/let bestD  = RESCUE_R_SQ/.test(r) || !/if \(d > bestD\) continue/.test(r)) fail('closestFrozenOther is not limited to ICE_RESCUE_RADIUS_M')
	if (!/if \(thawTimer < ICE_THAW_S\) return[\s\S]*?room\.send\('frostRescue', \{ userId: target \}\)/.test(r)) fail('frostRescue is not sent after ICE_THAW_S of held contact')
	if (!/if \(!target\) \{\s*releaseMelt\(\)/.test(r)) fail('the melt hold is not released when the target is gone')
	if (!/room\.onMessage\('frostRescued'[\s\S]*?grantFrostRescue\(\)/.test(r)) fail('the thawed player is not released by frostRescued')
}

// --- server: frostLife.ts ---
{
	const s = code('src/server/frostLife.ts')
	const rescue = /room\.onMessage\('frostRescue'[\s\S]*?\n\t\}\)/.exec(s)?.[0] ?? ''
	if (!/from === target/.test(rescue) || !/frozen\.has\(from\)/.test(rescue) || !/!frozen\.has\(target\)/.test(rescue)) fail('frostRescue validation (not self, rescuer not frozen, target frozen) is incomplete')
	if (!/clearFrozen\(target\)[\s\S]*?room\.send\('frostRescued'/.test(rescue)) fail('a rescue does not clear the cube and tell the player')
	const melt = /room\.onMessage\('frostMeltRequest'[\s\S]*?\n\t\}\)/.exec(s)?.[0] ?? ''
	if (!/from === target/.test(melt) || !/frozen\.has\(from\)/.test(melt) || !/!frozen\.has\(target\)/.test(melt)) fail('frostMeltRequest validation is incomplete')
}

// --- wake: client nearestLitFire ---
{
	const d = code('src/client/frost/death.ts')
	if (!/getMainFireFuel\(\) > 0\) consider\(CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z\)/.test(d) || !/getHiddenCampfireWarmthPositions\(\)/.test(d)) fail('wake ignores the hearth / hidden fires')
	if (!/const lava = nearestLitLava\(px, pz\)/.test(d)) fail('wake ignores lava')
	if (!/if \(!fire\) \{[\s\S]*?staying frozen/.test(d)) fail('with no lit fire the player must stay frozen (a torch can still thaw them)')
	const vol = code('src/client/volcanoCrown.ts')
	if (/export function nearestLitLava[\s\S]*?SocketLava[\s\S]*?return best/.test(vol)) fail('nearestLitLava (the wake point) must not include the socket lava')
	if (/SocketLava/.test(code('src/server/frostLife.ts'))) fail('the server give-up check must not know the socket lava')
	if (!/isAnyHiddenFireLit\(\) \|\| isVolcanoLavaLit\(\)/.test(code('src/server/frostLife.ts'))) fail('the server give-up check lost its fire sources')
}

say(bad === 0 ? 'freezeThawCheck: OK' : `freezeThawCheck: ${bad} FAILURES`)
if (bad) process.exitCode = 1