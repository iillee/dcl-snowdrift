/**
 * playtestFixesCheck - the fixes from the playtest log analysis:
 *  1. snow: ONE republish per join (shared/snowJoin.ts): joinRoster no longer republishes, the joiner's snowResync is the single send, a missing
 *     resync is covered by one fallback republish, a resync without a join (recovery) still works, a stalled retrying joiner cannot push the fallback out;
 *  2. leaderboard: Storage writes throttled to SAVE_MIN_INTERVAL_S (45 s), releases / completions / new records / cycle rolls flush on the next tick,
 *     failed writes retry after SAVE_RETRY_S, nothing is lost (the last state is always written), board separation (storage key) untouched;
 *  3. log noise: no per-slot hidden-campfire lines, no mojibake in scatter.ts, ONE terrainGen summary per generated layout;
 *  4. frost: frostMeltRequest / frostRescue log WHY a request was refused (rate-limited), including a missing context.from.
 * Bundled by scripts/playtestFixesCheck.mjs.
 */
import { readFileSync } from 'node:fs'

import { SAVE_MIN_INTERVAL_S, SAVE_RETRY_S, SaveThrottle } from 'src/shared/saveThrottle'
import { SNOW_JOIN_FALLBACK_MS, SnowJoinGate } from 'src/shared/snowJoin'

const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
let bad = 0
const fail = (m: string): void => { bad++; if (bad <= 40) say('FAIL ' + m) }
const raw = (p: string): string => readFileSync(p, 'utf8')
const code = (p: string): string => raw(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// ---------- 1. one snow republish per join ----------
{
	// the server's behaviour, driven by the real gate: every `true` = one full republishAllSnowTiles
	let republishes = 0
	const gate = new SnowJoinGate()
	const join = (id: string, now: number): void => gate.onJoin(id, now)
	const resync = (id: string): void => { if (gate.onResync(id)) republishes++ }
	const tick = (now: number): void => { if (gate.tick(now)) republishes++ }

	join('0xA', 0); tick(10); resync('0xA'); tick(SNOW_JOIN_FALLBACK_MS + 1)
	if (republishes !== 1) fail(`join + resync republished ${republishes}x (want exactly 1)`)

	republishes = 0
	join('0xB', 0); tick(SNOW_JOIN_FALLBACK_MS - 1)
	if (republishes !== 0) fail('fallback fired before its deadline')
	tick(SNOW_JOIN_FALLBACK_MS + 1); tick(SNOW_JOIN_FALLBACK_MS * 3)
	if (republishes !== 1) fail(`a join whose resync never came republished ${republishes}x (want exactly 1 fallback)`)
	resync('0xB') // a very late resync is still honoured (recovery) - its own single send
	if (republishes !== 2) fail('a late resync was ignored')

	republishes = 0
	resync('0xC') // server restart / silence recovery: resync with no pending join
	if (republishes !== 1) fail('a recovery resync without a join did not republish')

	republishes = 0
	join('0xD', 0); join('0xD', 2000); join('0xD', 4000); join('0xD', 5900) // stalled client retrying joinRoster
	tick(SNOW_JOIN_FALLBACK_MS + 1)
	if (republishes !== 1) fail('a retrying joiner pushed the fallback out / republished more than once')

	republishes = 0
	join('0xE', 0); join('0xF', 100); tick(SNOW_JOIN_FALLBACK_MS + 200)
	if (republishes !== 1) fail('two overdue joiners did not share one fallback republish')
	join('0xG', 0); join('0xH', 0); resync('0xG'); resync('0xH'); tick(SNOW_JOIN_FALLBACK_MS * 2)
	if (republishes !== 3 || gate.pendingCount() !== 0) fail('two joiners with their own resync must each get their single send and leave nothing pending')
	if (join('0xI', 5), gate.pendingCount() !== 1 || gate.onResync('0XI') !== true || gate.pendingCount() !== 0) fail('join ids are not case-insensitive')

	// source facts
	const srv = code('src/server/server.ts')
	const joinHandler = /room\.onMessage\('joinRoster'[\s\S]*?\n\t\}\)/.exec(srv)?.[0] ?? ''
	if (joinHandler.length < 200) fail('joinRoster handler not found')
	if (/republishAllSnowTiles/.test(joinHandler)) fail('joinRoster still republishes the snow tiles (the join must send them once, via snowResync)')
	if (!/snowGate\.onJoin\(/.test(joinHandler)) fail('joinRoster does not record the join for the fallback')
	const resyncHandler = /room\.onMessage\('snowResync'[\s\S]*?\n\t\}\)/.exec(srv)?.[0] ?? ''
	if (!/snowGate\.onResync\(from\)/.test(resyncHandler) || !/republishAllSnowTiles\(\)/.test(resyncHandler) || !/sendHearthFuelStateTo\(from\)/.test(resyncHandler)) fail('snowResync no longer republishes (recovery path) / hydrates the hearth fuel')
	if (!/snowGate\.tick\(Date\.now\(\)\)[\s\S]{0,80}republishAllSnowTiles\(\)/.test(srv)) fail('the fallback republish is not wired')
	if (!/room\.send\('snowResync', \{\}\)/.test(code('src/client/clientHandler.ts'))) fail('the client no longer sends snowResync once synced')
}

// ---------- 2. leaderboard write throttle ----------
{
	if (SAVE_MIN_INTERVAL_S < 30 || SAVE_MIN_INTERVAL_S > 60) fail(`save interval ${SAVE_MIN_INTERVAL_S} s is outside 30..60 s`)
	const ms = SAVE_MIN_INTERVAL_S * 1000
	// 10 minutes of ordinary changes every 3 s: writes at most one per interval
	{
		const t = new SaveThrottle(); let writes = 0, last = -1e9
		for (let now = 0; now < 600_000; now += 250) {
			if (now % 3000 === 0) t.markDirty(false)
			if (t.shouldSave(now)) { if (now - last < ms && last > -1e8) fail(`two writes ${now - last} ms apart`); writes++; last = now; t.onSaved(now, true) }
		}
		if (writes > Math.ceil(600_000 / ms) + 1 || writes < 10) fail(`${writes} writes in 10 min of constant changes (want ~${Math.round(600_000 / ms)})`)
	}
	// the first change after a long quiet period is written at once, a second one right after waits
	{
		const t = new SaveThrottle()
		t.markDirty(false)
		if (!t.shouldSave(1000)) fail('the first change after a quiet period was held back')
		t.onSaved(1000, true)
		t.markDirty(false)
		if (t.shouldSave(1000 + ms - 1)) fail('an ordinary change was written inside the interval')
		if (!t.shouldSave(1000 + ms)) fail('an ordinary change was never written after the interval')
	}
	// urgent (release / completion / new record / cycle roll) flushes on the next tick, even right after a write
	{
		const t = new SaveThrottle()
		t.markDirty(false); t.onSaved(5000, true)
		t.markDirty(true)
		if (!t.shouldSave(5001)) fail('an urgent change (release / completion) was held back by the throttle')
		t.onSaved(5001, true)
		if (t.isDirty() || t.shouldSave(5002)) fail('still dirty after a successful write')
		// ordinary change queued, then urgent: one write carries both
		t.markDirty(false); t.markDirty(true)
		if (!t.shouldSave(5003)) fail('urgent after ordinary was held back')
	}
	// a change during the write keeps the board dirty and written later (nothing lost)
	{
		const t = new SaveThrottle()
		t.markDirty(false); t.onSaved(0, false)
		if (!t.isDirty()) fail('a change that arrived during a write was forgotten')
		if (t.shouldSave(ms - 1) || !t.shouldSave(ms)) fail('the change made during a write is not written after the interval')
	}
	// failure: retry after SAVE_RETRY_S, urgent stays urgent, still nothing lost
	{
		const t = new SaveThrottle()
		t.markDirty(true); t.onFailed(1000)
		if (t.shouldSave(1000 + SAVE_RETRY_S * 1000 - 1)) fail('a failed write retried too early')
		if (!t.shouldSave(1000 + SAVE_RETRY_S * 1000)) fail('a failed urgent write was not retried')
		const u = new SaveThrottle(); u.markDirty(false); u.onSaved(0, true); u.markDirty(false); u.onFailed(10_000)
		if (!u.shouldSave(Math.max(ms, 10_000 + SAVE_RETRY_S * 1000))) fail('a failed ordinary write was never retried')
	}
	// source facts
	const lb = code('src/server/leaderboard.ts')
	if (!/new SaveThrottle\(\)/.test(lb) || !/throttle\.shouldSave\(Date\.now\(\)\)/.test(lb)) fail('the leaderboard does not write through the throttle')
	if (/saveDirty/.test(lb)) fail('a direct saveDirty path is left in leaderboard.ts')
	if (!/improveThaw\(p, day, ts\)\s*\}\s*return changed\s*\}, true\)/.test(lb)) fail('recordRunProgress (release / completion) is not an urgent write')
	if (!/onCycleRoll\(\(\) => \{\s*if \(throttle\.isDirty\(\)\) throttle\.markDirty\(true\)/.test(lb)) fail('a cycle roll does not flush the board')
	if (!/throttle\.onSaved\(/.test(lb) || !/throttle\.onFailed\(/.test(lb)) fail('save result is not reported to the throttle')
	if (!/LEADERBOARD_STORAGE_KEY/.test(lb) || !/Storage\.set\(LEADERBOARD_STORAGE_KEY/.test(lb)) fail('board separation (storage key per profile) changed')
}

// ---------- 3. log noise ----------
{
	const hc = code('src/server/hiddenCampfire.ts')
	if (/slot \$\{i\} unused/.test(hc)) fail('hiddenCampfire still logs one line per unused slot')
	if (/hiddenCampfire\[\$\{i\}\]: (cycle seed|reset for cycle)/.test(hc)) fail('hiddenCampfire still logs one line per slot at setup / reset')
	if (!/slots unused this cycle/.test(hc) || !/slots, \$\{placed\} placed/.test(hc)) fail('hiddenCampfire summary lines missing')
	const sc = raw('src/shared/props/scatter.ts')
	if (/[\u00c3\u00c2\u00c5\u00e2][\u0080-\u00bf\u2018-\u203a\u20ac\u2122]/.test(sc.split('\n').filter((l) => /placeDestinationGrove|missed/.test(l)).join('\n')) || /missed [^\n]*sparse fill/.test(sc) === false) fail('scatter.ts: the "missed ... sparse fill" log string is missing or still mojibake')
	if (!/missed - sparse fill/.test(sc)) fail('scatter.ts log string not ASCII')
	const tg = code('src/shared/terrain/terrainGen.ts')
	if (/console\.log\('terrainGen: ' \+ nearPicks\[k\]\.log/.test(tg)) fail('buildOnce still logs the near monument for every attempt')
	if (!/nearMonumentLog = nearPicks\[k\]\.log/.test(tg) || !/after \$\{attempt \+ 1\} attempt\(s\)/.test(tg)) fail('terrainGen summary (once per accepted layout) missing')
}

// ---------- 4. frost rejection logs ----------
{
	const fl = code('src/server/frostLife.ts')
	const melt = /room\.onMessage\('frostMeltRequest'[\s\S]*?\n\t\}\)/.exec(fl)?.[0] ?? ''
	const resc = /room\.onMessage\('frostRescue'[\s\S]*?\n\t\}\)/.exec(fl)?.[0] ?? ''
	for (const [name, h] of [['frostMeltRequest', melt], ['frostRescue', resc]] as const) {
		if (h.length < 200) { fail(name + ' handler not found'); continue }
		for (const reason of ['no context\\.from', 'missing target id', 'rescuer is the target', 'rescuer is frozen', 'target not frozen']) {
			if (!new RegExp(`logReject\\('${name}', [\`']${reason}`).test(h)) fail(`${name} does not log the reason "${reason.replace('\\', '')}"`)
		}
		// every early return in the validation logs (no silent \`return\` before the freeze lookup)
		const head = h.split('clearFrozen')[0].split('setMelt')[0]
		const silent = /if \([^\n]*\) return\s*\n/.test(head.replace(/logReject\([^\n]*\n/g, ''))
		if (silent) fail(name + ' has a silent early return')
	}
	if (!/REJECT_LOG_EVERY_MS = 10_?000/.test(fl) || !/repeats suppressed/.test(fl)) fail('rejection logs are not rate limited (frostMeltRequest repeats every ~0.35 s)')
}

say(bad === 0 ? 'playtestFixesCheck: OK' : `playtestFixesCheck: ${bad} FAILURES`)
if (bad) process.exitCode = 1