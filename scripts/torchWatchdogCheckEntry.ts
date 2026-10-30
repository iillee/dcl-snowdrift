/**
 * torchWatchdogCheck - the hand torch can no longer silently go missing (src/client/torchHealth.ts, torch.ts, remoteTorches.ts):
 *  - decideTorchHeal: a healthy rig needs nothing; every way the torch can be absent (entity removed, AvatarAttach missing / on the
 *    wrong anchor / empty or stale avatarId, model not parented, GLB missing / wrong / failed / stalled, model hidden or collapsed)
 *    maps to a repair, with the GLB retry back-off (a fresh failure is not retried every tick);
 *  - the local avatar attach waits for the avatar but never longer than TORCH_ATTACH_MAX_WAIT_S;
 *  - the log gate emits one line per TORCH_LOG_GAP_MS and keeps counting;
 *  - wiring (source): torch.ts runs the watchdog system every <= 2 s, never creates the AvatarAttach while building (only attachTorch
 *    does, without avatarId), rebuilds a removed rig, logs "torchWatchdog: HEALED"; remoteTorches.ts runs the same rules from its
 *    reconcile; index.ts still builds the torch.
 * Bundled by scripts/torchWatchdogCheck.mjs.
 */
import { readFileSync } from 'node:fs'

import {
	TORCH_ATTACH_MAX_WAIT_S, TORCH_GLB_RETRY_MS, TORCH_GLB_STUCK_MS, TORCH_LOG_GAP_MS, TORCH_WATCHDOG_S,
	TorchLogGate, TorchProbe, decideTorchHeal, shouldAttachNow,
} from 'src/client/torchHealth'

const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
let bad = 0
const fail = (m: string): void => { bad++; if (bad <= 40) say('FAIL ' + m) }
const code = (p: string): string => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const HAND = 5 // any anchor id; only equality matters
const SRC  = 'assets/torch.glb'
const healthy = (over: Partial<TorchProbe> = {}, remote = ''): TorchProbe => ({
	expectAvatarId: remote, anchorAlive: true, tipAlive: true,
	attach: { anchorPoint: HAND, avatarId: remote === '' ? undefined : remote }, expectAnchor: HAND,
	tipParentIsAnchor: true, glbSrc: SRC, expectGlbSrc: SRC, glbState: 'finished', glbAgeMs: 20000, sinceGlbRetryMs: 20000,
	visible: true, scaleOk: true, ...over,
})
const acts = (p: TorchProbe): string => decideTorchHeal(p).actions.join('+')
const expectActs = (name: string, p: TorchProbe, want: string): void => { const got = acts(p); if (got !== want) fail(`${name}: actions "${got}", want "${want}"`) }

// --- numbers ---
if (!(TORCH_WATCHDOG_S >= 1 && TORCH_WATCHDOG_S <= 2)) fail(`watchdog period ${TORCH_WATCHDOG_S} s (design: every 1-2 s)`)
if (!(TORCH_GLB_RETRY_MS >= 1000 && TORCH_GLB_STUCK_MS > TORCH_GLB_RETRY_MS)) fail('GLB retry / stuck timings')
if (!(TORCH_ATTACH_MAX_WAIT_S > 0 && TORCH_ATTACH_MAX_WAIT_S <= 10)) fail('attach max wait')

// --- decideTorchHeal: local torch ---
expectActs('healthy local', healthy(), '')
expectActs('healthy remote', healthy({}, 'abc'), '')
expectActs('anchor removed', healthy({ anchorAlive: false }), 'rebuild')
expectActs('model removed', healthy({ tipAlive: false }), 'rebuild')
expectActs('AvatarAttach missing', healthy({ attach: null }), 'attach')
expectActs('wrong anchor point', healthy({ attach: { anchorPoint: HAND + 1, avatarId: undefined } }), 'attach')
expectActs('local attach with an EMPTY avatarId', healthy({ attach: { anchorPoint: HAND, avatarId: '' } }), 'attach')
expectActs('local attach with an explicit avatarId', healthy({ attach: { anchorPoint: HAND, avatarId: '0xabc' } }), 'attach')
expectActs('remote attach on the wrong avatar', healthy({ attach: { anchorPoint: HAND, avatarId: 'someone-else' } }, 'abc'), 'attach')
expectActs('remote attach with a missing avatarId', healthy({ attach: { anchorPoint: HAND, avatarId: undefined } }, 'abc'), 'attach')
expectActs('model lost its parent', healthy({ tipParentIsAnchor: false }), 'reparent')
expectActs('GltfContainer missing', healthy({ glbSrc: null, glbState: 'none' }), 'glb')
expectActs('GltfContainer wrong src', healthy({ glbSrc: 'other.glb' }), 'glb')
expectActs('GLB failed', healthy({ glbState: 'failed' }), 'glb')
expectActs('GLB failed, retried a moment ago', healthy({ glbState: 'failed', sinceGlbRetryMs: TORCH_GLB_RETRY_MS - 1 }), '')
expectActs('GLB loading, fresh', healthy({ glbState: 'loading', glbAgeMs: TORCH_GLB_STUCK_MS - 1 }), '')
expectActs('GLB stalled', healthy({ glbState: 'loading', glbAgeMs: TORCH_GLB_STUCK_MS }), 'glb')
expectActs('GLB stalled, retried a moment ago', healthy({ glbState: 'loading', glbAgeMs: TORCH_GLB_STUCK_MS, sinceGlbRetryMs: 10 }), '')
expectActs('model hidden', healthy({ visible: false }), 'show')
expectActs('model scale lost', healthy({ scaleOk: false }), 'show')
expectActs('several faults at once', healthy({ attach: null, glbState: 'failed', tipParentIsAnchor: false }), 'attach+reparent+glb')
{
	const v = decideTorchHeal(healthy({ attach: null, glbState: 'failed' }))
	if (v.reasons.length !== v.actions.length || v.reasons.some((r) => r.length < 4)) fail('every repair carries a log reason')
	const v2 = decideTorchHeal(healthy({ anchorAlive: false, attach: null }))
	if (v2.actions.length !== 1 || v2.actions[0] !== 'rebuild') fail('a removed anchor is a rebuild only')
}
// a random walk over fault combinations: the repair list is never empty for a faulty rig and always empty for a whole one
{
	let seed = 12345
	const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
	for (let i = 0; i < 2000; i++) {
		const remote = rnd() < 0.5 ? 'abc' : ''
		const p = healthy({}, remote)
		let faulty = false
		if (rnd() < 0.2) { p.attach = null; faulty = true }
		else if (rnd() < 0.15) { p.attach = { anchorPoint: HAND, avatarId: remote === '' ? '' : 'zzz' }; faulty = true }
		if (rnd() < 0.15) { p.glbState = 'failed'; faulty = true }
		if (rnd() < 0.1) { p.glbSrc = null; p.glbState = 'none'; faulty = true }
		if (rnd() < 0.1) { p.visible = false; faulty = true }
		if (rnd() < 0.1) { p.tipParentIsAnchor = false; faulty = true }
		if (rnd() < 0.05) { p.anchorAlive = false; faulty = true }
		const a = decideTorchHeal(p).actions
		if (faulty !== (a.length > 0)) fail(`fault walk ${i}: faulty=${faulty} actions=${a.join('+')}`)
	}
}

// --- attach timing ---
if (shouldAttachNow(false, 0)) fail('attached before the avatar is known')
if (shouldAttachNow(false, TORCH_ATTACH_MAX_WAIT_S - 0.01)) fail('attach wait ended early')
if (!shouldAttachNow(false, TORCH_ATTACH_MAX_WAIT_S)) fail('no avatar signal must not leave the hand empty past the max wait')
if (!shouldAttachNow(true, 0)) fail('avatar ready but not attached')

// --- log gate ---
{
	const gate = new TorchLogGate()
	let lines = 0, covered = 0
	for (let i = 0; i < 100; i++) { const n = gate.note(1000 + i * 50); if (n > 0) { lines++; covered += n } }
	if (lines !== 1 || covered !== 1) fail(`log gate: ${lines} lines in 5 s (want 1)`)
	const n2 = gate.note(1000 + TORCH_LOG_GAP_MS + 1)
	if (n2 !== 100) fail(`log gate: next line covers ${n2} repairs (want 100)`)
	if (gate.total !== 101) fail(`log gate total ${gate.total}`)
}

// --- wiring ---
{
	const t = code('src/client/torch.ts')
	if (!/engine\.addSystem\(tickTorchWatchdog, 0, 'torchWatchdog'\)/.test(t)) fail('torch.ts does not register the watchdog system')
	if (!/watchdogClock < TORCH_WATCHDOG_S/.test(t)) fail('watchdog is not paced by TORCH_WATCHDOG_S')
	if (!/decideTorchHeal\(readLocalProbe\(nowMs\)\)/.test(t)) fail('watchdog does not use decideTorchHeal on the live probe')
	if (!/torchWatchdog: HEALED local torch/.test(t) || !/logGate\.note\(nowMs\)/.test(t)) fail('watchdog log line missing / not rate limited')
	const build = t.slice(t.indexOf('function buildTorch'), t.indexOf('function teardownTorch'))
	if (/AvatarAttach\.(create|createOrReplace)/.test(build)) fail('buildTorch creates the AvatarAttach before the avatar is known')
	const att = t.slice(t.indexOf('function attachTorch'), t.indexOf('function isLocalAvatarReady'))
	if (!/AvatarAttach\.createOrReplace\(torchAnchor, \{ anchorPointId: AvatarAnchorPointType\.AAPT_RIGHT_HAND \}\)/.test(att)) fail('attachTorch must bind the local avatar without an avatarId')
	if (/avatarId/.test(att)) fail('attachTorch sets an avatarId on the local avatar')
	if (!/shouldAttachNow\(ready, /.test(t)) fail('first attach is not gated on the avatar')
	if (!/teardownTorch\(\)\s*buildTorch\(\)/.test(t)) fail('a removed rig is not rebuilt')
	if (!/AvatarBase\.getOrNull\(pe\) !== null/.test(t)) fail('avatar readiness does not look at the avatar profile')
	if (!/sig !== avatarSig/.test(t)) fail('an avatar rebuild does not re-bind the torch')
	const r = code('src/client/remoteTorches.ts')
	if (!/else healRemoteTorch\(addr, have\)/.test(r) || !/decideTorchHeal\(probe\)/.test(r)) fail('remote torches are not watchdogged from the reconcile')
	if (!/torchWatchdog: HEALED remote torch/.test(r) || !/healGate\.note\(nowMs\)/.test(r)) fail('remote heal log missing / not rate limited')
	const ix = code('src/client/index.ts')
	if (!/\r?\n\tsetupTorch\(\)\r?\n/.test(ix)) fail('index.ts no longer builds the torch')
}

console.log = say
if (bad > 0) { say(`torchWatchdogCheck: ${bad} FAILURES`); process.exit(1) }
say(`torchWatchdogCheck: OK (every way the hand torch can go missing maps to a repair; GLB back-off ${TORCH_GLB_RETRY_MS} ms, stall ${TORCH_GLB_STUCK_MS} ms; attach waits <= ${TORCH_ATTACH_MAX_WAIT_S} s for the avatar; watchdog every ${TORCH_WATCHDOG_S} s, one log line per ${TORCH_LOG_GAP_MS / 1000} s)`)