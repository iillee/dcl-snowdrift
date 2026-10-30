/**
 * expeditionCheck - the NEW EXPEDITION reset (src/shared/expedition.ts ExpeditionServerCore = the code the server runs, src/server/expedition.ts
 * wires it; src/client/expedition.ts + the Help panel / HUD chip read it):
 *  - validation: nothing before the expedition is complete AND the world restored, no anonymous sender, a stale world is refused;
 *  - ONE shared countdown (NEW_EXPEDITION_COUNTDOWN_S = 60): any number of presses (any player) never restart / duplicate it;
 *  - cancel: initiator only (wallet case-insensitive), others and a cancel without a countdown change nothing, BEGIN is back after a cancel;
 *  - deadline sync: the clients derive a local deadline from the broadcast ONCE; clients with different clock skews / latencies and a late
 *    joiner agree on the time left to the second, the clock never jumps, it ends exactly at the server deadline;
 *  - reset at zero: one roll (fresh seed, Day 1, finale / obelisks reset, button hidden), no countdown left, a late joiner after it gets
 *    the idle state; the initiator leaving changes nothing (nothing listens for it);
 *  - wiring (source facts): no automatic winter after the ending, the roll is the existing rollCycle path, the reset never touches the
 *    leaderboard's record functions or the run taint (and the roll clears contributors + taint), Help panel / HUD / messages exist.
 * Bundled by scripts/expeditionCheck.mjs.
 */
import { readFileSync } from 'node:fs'

import {
	ExpeditionServerCore, ExpeditionWire, NEW_EXPEDITION_COUNTDOWN_S, beginExpedition, cancelExpedition, expeditionLocalDeadline,
	expeditionRemainingMs, expeditionSecondsLeft, expeditionWire, formatExpeditionClock, isExpeditionComplete, newExpeditionCountdown,
} from 'src/shared/expedition'
import { FINALE_PULSE_S, finaleRestoredS, finaleTimes } from 'src/shared/finale'
import { OASIS_FINALE_MELT_S } from 'src/shared/terrain/oasis'

const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
let bad = 0
const fail = (m: string): void => { bad++; if (bad <= 40) say('FAIL ' + m) }
const src = (p: string): string => readFileSync(p, 'utf8')
/** Source without comments (the facts below are about code, not about what the header says). */
const code = (p: string): string => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const A = '0xAaaa000000000000000000000000000000000001'
const B = '0xbbbb000000000000000000000000000000000002'
const C = '0xcccc000000000000000000000000000000000003'

// --- constants / timeline ---
if (NEW_EXPEDITION_COUNTDOWN_S !== 60) fail(`countdown is ${NEW_EXPEDITION_COUNTDOWN_S} s, not 60`)
const CD_MS = NEW_EXPEDITION_COUNTDOWN_S * 1000
const restored = finaleRestoredS()
if (!(restored >= finaleTimes().pulseAtS + OASIS_FINALE_MELT_S - 1e-9 && restored >= finaleTimes().pulseAtS + FINALE_PULSE_S)) fail('the world counts as restored before the ground / snow finished')
if (!(restored > finaleTimes().cineEndS - 3)) fail('button could appear well before the ending shot is over')
{
	const T = 1_000_000_000_000
	if (isExpeditionComplete(0, T)) fail('complete without an ending')
	if (isExpeditionComplete(T, T + restored * 1000 - 1)) fail('complete one ms before the world is restored')
	if (!isExpeditionComplete(T, T + restored * 1000)) fail('not complete once the world is restored')
	if (isExpeditionComplete(T + 5_000, T)) fail('complete before the ending started')
}

// --- pure validation / dedupe / cancel ---
{
	const T = 5_000_000
	const st = newExpeditionCountdown()
	if (beginExpedition(st, A, T, false) !== 'not_complete' || st.deadlineMs !== 0) fail('a request before the expedition is complete started a countdown')
	if (beginExpedition(st, '', T, true) !== 'no_sender' || beginExpedition(st, 'unknown', T, true) !== 'no_sender' || st.deadlineMs !== 0) fail('anonymous sender accepted')
	if (cancelExpedition(st, A) !== 'none') fail('cancel without a countdown')
	if (beginExpedition(st, A, T, true) !== 'started') fail('valid request refused')
	if (st.deadlineMs !== T + CD_MS || st.initiator !== A.toLowerCase()) fail('deadline / initiator wrong')
	const d0 = st.deadlineMs
	for (let i = 0; i < 500; i++) {
		const who = i % 3 === 0 ? A : i % 3 === 1 ? B : C
		if (beginExpedition(st, who, T + i * 100, true) !== 'already_running') fail('repeated press not refused')
	}
	if (st.deadlineMs !== d0 || st.initiator !== A.toLowerCase()) fail('repeated presses changed the countdown')
	if (cancelExpedition(st, B) !== 'not_initiator' || cancelExpedition(st, C) !== 'not_initiator' || st.deadlineMs !== d0) fail('a non-initiator cancelled')
	if (cancelExpedition(st, A.toUpperCase().replace('0X', '0x')) !== 'cancelled' || st.deadlineMs !== 0 || st.initiator !== '') fail('the initiator could not cancel')
	if (beginExpedition(st, B, T + 10_000, true) !== 'started' || st.initiator !== B.toLowerCase()) fail('BEGIN not available again after a cancel / another player cannot start next')
	if (expeditionRemainingMs(st, T + 10_000) !== CD_MS || expeditionRemainingMs(st, T + CD_MS + 220_000) !== 0) fail('remaining time')
}

// --- the server core against a fake world, with simulated clients ---
interface Client { name: string; skew: number; latency: number; ready: boolean; active: boolean; localDeadline: number; initiator: string; seed: number }
function run(): void {
	const world = { now: 2_000_000_000_000, seed: 1234, day: 9, finaleStartMs: 0, rolls: 0, records: 0, taint: false, contributors: 3 }
	const inbox: Array<{ to: string | undefined; p: ExpeditionWire; at: number }> = []
	const clients = new Map<string, Client>()
	const mk = (name: string, skew: number, latency: number): Client => { const c = { name, skew, latency, ready: false, active: false, localDeadline: 0, initiator: '', seed: 0 }; clients.set(name, c); return c }
	const local = (c: Client): number => world.now + c.skew
	const deliver = (): void => {
		for (const m of inbox.splice(0)) {
			for (const c of clients.values()) {
				if (m.to !== undefined && m.to !== c.name) continue
				// the client applies the message latency later; model it by anchoring the deadline at ITS receive time
				const recv = m.at + c.latency * 1000 + c.skew
				c.ready = m.p.ready === 1; c.active = m.p.active === 1
				c.localDeadline = c.active ? expeditionLocalDeadline(m.p.remainingMs, recv) : 0
				c.initiator = c.active ? m.p.initiator.toLowerCase() : ''
				c.seed = m.p.seed
			}
		}
	}
	let core!: ExpeditionServerCore
	core = new ExpeditionServerCore({
		nowMs: () => world.now,
		seed: () => world.seed,
		finaleStartMs: () => world.finaleStartMs,
		roll: () => {
			// = cycle.rollCycle: fresh seed, every subsystem's onCycleRoll (Day 1, finale / obelisks reset), then the expedition handler
			world.rolls++; world.seed = (world.seed * 7 + 13) % 1_000_003; world.day = 1; world.finaleStartMs = 0; world.taint = false; world.contributors = 0
			core.onRolled()
		},
		send: (p, to) => { inbox.push({ to, p, at: world.now }) },
	})
	const advance = (ms: number): void => { world.now += ms; core.tick(); deliver() }
	const a = mk(A.toLowerCase(), 0, 0.05), b = mk(B.toLowerCase(), 3_600_000, 0.4), c2 = mk(C.toLowerCase(), -86_400_000, 0.9)

	// before the ending: nothing to press, requests refused, nobody told anything new
	core.hydrate(a.name); deliver()
	if (a.ready || a.active) fail('button offered before the ending')
	if (core.request(A, world.seed) !== 'not_complete') fail('request before the ending accepted')
	// the ending starts: still no button while it plays (finale + restoring)
	world.finaleStartMs = world.now
	for (let t = 0; t < restored * 1000 - 500; t += 500) { advance(500); if (a.ready || b.ready) { fail('button offered while the ending is still playing'); break } }
	if (core.request(B, world.seed) !== 'not_complete') fail('request during the ending accepted')
	// the world is restored: the button state is broadcast
	advance(1500)
	if (!(a.ready && b.ready && c2.ready) || a.active) fail('button not offered to everybody once the world is restored')
	// a stale world id is refused
	if (core.request(A, world.seed + 1) !== 'stale' || core.countdown().deadlineMs !== 0) fail('request for another world accepted')
	// A starts it; B and C press at the same time: still one countdown
	const t0 = world.now
	if (core.request(A, world.seed) !== 'started') fail('valid request not accepted')
	for (let i = 0; i < 20; i++) { core.request(i % 2 ? B : C, world.seed); core.request(A, world.seed) }
	deliver()
	if (core.countdown().deadlineMs !== t0 + CD_MS) fail('deadline moved by repeated presses')
	if (!(a.active && b.active && c2.active)) fail('countdown not shown to everybody')
	// only A is the initiator for the UI: A sees CANCEL; B / C do not
	if (!(a.initiator === A.toLowerCase() && b.initiator === A.toLowerCase() && c2.initiator === A.toLowerCase())) fail('initiator not synced')
	// B cannot cancel
	if (core.cancel(B, world.seed) !== 'not_initiator' || !a.active) fail('non-initiator cancel changed the countdown')
	// the clocks agree (client clocks are off by hours; the deadline is derived from the remaining time, not from epoch)
	let prevShown = new Map<string, number>()
	for (let t = 1; t <= CD_MS / 2000; t++) {
		advance(1000)
		const left = (c: Client): number => expeditionSecondsLeft(c.localDeadline, local(c))
		const sa = left(a), sb = left(b), sc = left(c2)
		const truth = Math.ceil((t0 + CD_MS - world.now) / 1000)
		for (const [cl, v] of [[a, sa], [b, sb], [c2, sc]] as Array<[Client, number]>) {
			// a client lags the server by its latency at most
			if (Math.abs(v - truth) > 1) fail(`client ${cl.name.slice(0, 6)} shows ${v} s, server ${truth} s`)
			const was = prevShown.get(cl.name)
			if (was !== undefined && (v > was || was - v > 1)) fail(`clock jumped for ${cl.name.slice(0, 6)}: ${was} -> ${v}`)
			prevShown.set(cl.name, v)
		}
	}
	if (Math.abs(expeditionSecondsLeft(a.localDeadline, local(a)) - 30) > 1) fail(`A shows ${expeditionSecondsLeft(a.localDeadline, local(a))} s with 30 s left`)
	// a late joiner (new client, odd clock) at half time
	const late = mk('late', 777_777, 0.3)
	core.hydrate('late'); deliver()
	if (!late.active || Math.abs(expeditionSecondsLeft(late.localDeadline, local(late)) - 30) > 1) fail(`late joiner shows ${expeditionSecondsLeft(late.localDeadline, local(late))} s, want ~30`)
	if (late.initiator !== A.toLowerCase()) fail('late joiner does not know the initiator')
	// the initiator disconnects: nothing to do, the countdown continues (no presence handling at all)
	clients.delete(a.name)
	advance(10_000)
	if (core.countdown().deadlineMs !== t0 + CD_MS) fail('the countdown changed when the initiator left')
	// cancel by the initiator after a reconnect (same wallet): HUD removed everywhere, BEGIN back, world unchanged
	const a2 = mk(A.toLowerCase(), 5, 0.1)
	core.hydrate(a2.name); deliver()
	const before = { seed: world.seed, day: world.day, fin: world.finaleStartMs, rolls: world.rolls }
	if (core.cancel(A, world.seed) !== 'cancelled') fail('initiator (reconnected) could not cancel')
	deliver()
	for (const cl of clients.values()) if (cl.active || !cl.ready || cl.localDeadline !== 0 || cl.initiator !== '') fail(`after cancel ${cl.name.slice(0, 6)} still shows a countdown / lost BEGIN`)
	if (world.seed !== before.seed || world.day !== before.day || world.finaleStartMs !== before.fin || world.rolls !== before.rolls) fail('cancel changed the world')
	for (let i = 0; i < 20; i++) advance(1000)
	if (world.rolls !== 0) fail('a cancelled countdown still rolled the world')
	// start again (C this time), let it run out: exactly one roll at the deadline
	const t1 = world.now
	if (core.request(C, world.seed) !== 'started') fail('new countdown after a cancel refused')
	deliver()
	if (a2.initiator !== C.toLowerCase()) fail('new initiator not synced')
	const seedBefore = world.seed
	let rollsAt = -1
	for (let t = 0; t < 200; t++) { const r0 = world.rolls; advance(1000); if (world.rolls > r0) { rollsAt = world.now - t1; break } }
	if (rollsAt !== CD_MS) fail(`rolled at +${rollsAt} ms, want exactly ${CD_MS}`)
	for (let t = 0; t < 30; t++) advance(1000)
	if (world.rolls !== 1) fail(`${world.rolls} rolls for one countdown`)
	if (world.seed === seedBefore) fail('same world seed after the reset')
	if (world.day !== 1) fail(`day ${world.day} after the reset, want Day 1`)
	if (world.finaleStartMs !== 0 || world.taint || world.contributors !== 0) fail('finale / run state not reset')
	if (world.records !== 0) fail('the reset wrote a leaderboard record')
	for (const cl of clients.values()) if (cl.active || cl.ready || cl.localDeadline !== 0 || cl.seed !== world.seed) fail(`after the reset ${cl.name.slice(0, 6)} still sees a countdown / the button / the old world`)
	// late joiner after the reset: idle, no button
	const l2 = mk('late2', 1, 0.2); core.hydrate('late2'); deliver()
	if (l2.active || l2.ready || l2.seed !== world.seed) fail('late joiner after the reset got a stale state')
	if (core.request(A, world.seed) !== 'not_complete') fail('request right after the reset accepted (no ending yet)')
	// a roll from elsewhere (dev roll / fail) while a countdown runs ends it too
	world.finaleStartMs = world.now - restored * 1000 - 1
	advance(500)
	if (!l2.ready) fail('button not offered after the next ending')
	core.request(B, world.seed); deliver()
	if (!l2.active) fail('second expedition countdown did not start')
	world.rolls++; world.seed++; world.day = 1; world.finaleStartMs = 0; core.onRolled(); deliver()
	if (l2.active || l2.ready || core.countdown().deadlineMs !== 0) fail('another roll did not end the countdown')
}
run()

// --- wiring (source facts) ---
{
	const ex = code('src/server/expedition.ts')
	if (!/rollCycle\(\)/.test(ex) || !/new ExpeditionServerCore/.test(ex)) fail('server/expedition.ts does not roll through cycle.rollCycle / the shared core')
	if (/leaderboard|runIntegrity|markRunTainted|recordRunProgress|noteContributor|roster|presentPlayerIds|frostLife/.test(ex)) fail('server/expedition.ts touches the leaderboard / run taint / presence (reset must not record, taint, or watch the initiator)')
	if (!/onCycleRoll\(\(\) => \{ core\.onRolled\(\) \}\)/.test(ex)) fail('the roll does not clear the countdown')
	if (!/'newExpeditionRequest'/.test(ex) || !/'newExpeditionCancel'/.test(ex)) fail('server does not handle the request / cancel messages')
	const cy = src('src/server/cycle.ts')
	if (!/export function rollCycle/.test(cy) || !/setActiveTerrain\(cycleMazeSeed\(currentSeed\)\)/.test(cy) || !/freshSeed\(oldSeed\)/.test(cy)) fail('rollCycle no longer draws a fresh world')
	const ph = src('src/server/phase.ts')
	if (!/onCycleRoll\(\(\) => \{\s*resetToDay\('cycle roll'\)/.test(ph) || !/phaseIndex\s*=\s*0[\s\S]{0,120}cycleId\s*=\s*0/.test(ph) || !/return cycleId \+ 1/.test(ph)) fail('a cycle roll no longer resets to Day 1')
	const lb = src('src/server/leaderboard.ts')
	if (!/onCycleRoll\(\(\) => \{\s*(?:if \(throttle\.isDirty\(\)\) throttle\.markDirty\(true\)[^\n]*\s*)?contributors\.clear\(\)[\s\S]{0,200}resetRunTaint\(\)/.test(lb)) fail('a cycle roll no longer clears the contributors + run taint')
	const st = src('src/server/stations.ts')
	if (!/function resetForCycle[\s\S]{0,600}oasisSetFinalePulse\(Number\.POSITIVE_INFINITY\)[\s\S]{0,700}finaleStartMs = 0/.test(st)) fail('a cycle roll no longer resets the ending / oasis')
	if (!/onPhaseChange\(\(\) => \{\s*if \(isFloatingCrystals\(\)\) return/.test(st)) fail('a post-win winter return is still wired for floating crystals')
	if (!/export function getFinaleStartMs/.test(st)) fail('stations does not export the finale start')
	const wf = src('src/server/worldFlame.ts')
	if (!/isWorldThawed\(\) \|\| isExpeditionWon\(\)/.test(wf)) fail('the world still ends when the fires go out after the ending')
	const sv = src('src/server/server.ts')
	if (!/setupExpeditionServer\(\)/.test(sv) || !/sendExpeditionStateTo\(from\)/.test(sv)) fail('server.ts does not install / hydrate the expedition reset')
	for (const f of ['src/server/emberFail.ts', 'src/server/stations.ts', 'src/server/expedition.ts', 'src/server/cycle.ts']) void f
	const msg = src('src/shared/messages.ts')
	for (const m of ['newExpeditionRequest', 'newExpeditionCancel', 'newExpeditionState']) if (!new RegExp('\\b' + m + '\\s*:').test(msg)) fail(`message ${m} missing`)
	const cl = src('src/client/expedition.ts')
	if (!/expeditionLocalDeadline\(m\.remainingMs/.test(cl) || !/newExpeditionRequest/.test(cl) || !/newExpeditionCancel/.test(cl)) fail('client does not derive the local deadline / send the requests')
	if (!/export function isNewExpeditionMine[\s\S]{0,200}me === initiator/.test(cl)) fail('CANCEL is not initiator-only on the client')
	if (!/setupExpeditionClient\(\)/.test(src('src/client/index.ts'))) fail('client does not set up the expedition state')
	const hp = src('src/client/ui/layers/layer.helpPanel.tsx')
	if (!/BEGIN NEW EXPEDITION/.test(hp) || !/CANCEL NEW EXPEDITION/.test(hp) || !/NEW EXPEDITION IN/.test(hp)) fail('Help panel is missing the BEGIN / CANCEL / status text')
	if (!/begin\s*=\s*canBeginNewExpedition\(\)/.test(hp) || !/cancel\s*=\s*isNewExpeditionMine\(\)/.test(hp)) fail('Help panel does not gate BEGIN / CANCEL on the synced state')
	const hud = src('src/client/ui/layers/layer.expeditionCountdown.tsx')
	if (!/NEW EXPEDITION IN/.test(hud) || !/isNewExpeditionCounting\(\)/.test(hud)) fail('HUD countdown chip missing')
	// on-screen buttons (not only the Help panel): BEGIN when eligible, CANCEL for the initiator only, tap-sized, server-validated actions
	if (!/BEGIN NEW EXPEDITION/.test(hud) || !/CANCEL NEW EXPEDITION/.test(hud)) fail('HUD is missing the on-screen BEGIN / CANCEL buttons')
	if (!/const begin\s*=\s*canBeginNewExpedition\(\)/.test(hud) || !/const cancel\s*=\s*isNewExpeditionMine\(\)/.test(hud)) fail('HUD buttons are not gated on the synced eligibility / initiator')
	if (!/\{begin && \(/.test(hud) || !/\{cancel && \(/.test(hud)) fail('HUD BEGIN / CANCEL are not rendered conditionally')
	if (!/onPress = \{requestNewExpedition\}/.test(hud) || !/onPress = \{cancelNewExpedition\}/.test(hud)) fail('HUD buttons do not send the requests')
	{ const m = /EXPEDITION_BTN_H\s*=\s*(\d+)/.exec(hud); if (!m || Number(m[1]) < 44) fail('HUD button is below a 44 px tap height') }
	if (!/if \(!counting && !begin\) return null/.test(hud)) fail('HUD shows something while nothing is eligible / running')
	if (!/expeditionCountdownLayer/.test(src('src/client/ui/index.tsx'))) fail('HUD countdown chip not registered')
}

say(bad === 0 ? 'expeditionCheck: OK' : `expeditionCheck: ${bad} FAILURES`)
if (bad) process.exitCode = 1