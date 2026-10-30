/** leaderboardCheck: boards, ranking, storage round-trip, wire form, formatting. node scripts/leaderboardCheck.mjs */
import {
	LEADERBOARD_SHOW, LEADERBOARD_STORE_MAX, LeaderboardPlayer, buildBoards, cleanName, clipName, compareFastest, compareLongest,
	compareObelisks, compareFirenet, networkCredits, decodeBoardWire, encodeBoardWire, formatElapsed, improveThaw, newPlayer, parseStoredBoard, serializeBoard,
	shortAddress, trimPlayers,
} from 'src/shared/leaderboard'
let fails = 0
const ok = (name: string, c: boolean, info = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!c) fails++ }
const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}`
const pl = (i: number, o: Partial<LeaderboardPlayer> = {}): LeaderboardPlayer => ({ ...newPlayer(addr(i), `P${i}`), ...o })
const ids = (rows: { name: string }[]) => rows.map((r) => r.name).join(',')

// improveThaw: first completion, fewer days, same days faster, worse ignored.
const p = pl(1)
ok('first completion', improveThaw(p, 5, 900) && p.td === 5 && p.ts === 900)
ok('fewer days wins even if slower', improveThaw(p, 4, 5000) && p.td === 4 && p.ts === 5000)
ok('same days faster wins', improveThaw(p, 4, 4000) && p.ts === 4000)
ok('same days slower ignored', !improveThaw(p, 4, 4500) && p.ts === 4000)
ok('more days ignored', !improveThaw(p, 6, 10) && p.td === 4)

// Ranking per board.
const list = [
	pl(1, { d: 3, mon: 2 }),
	pl(2, { d: 9, mon: 1 }),
	pl(3, { d: 9, mon: 4, td: 7, ts: 600 }),
	pl(4, { d: 5, mon: 6, td: 5, ts: 900 }),
	pl(5, { d: 5, mon: 6, td: 5, ts: 400 }),
	pl(6, { d: 0, mon: 0 }),
]
const b = buildBoards(list)
ok('longest: days desc, then obelisks', ids(b.longest) === 'P3,P2,P4,P5,P1', ids(b.longest))
ok('fastest: only completers, days then time', ids(b.fastest) === 'P5,P4,P3', ids(b.fastest))
ok('fastest carries time', b.fastest[0].v === 5 && b.fastest[0].ts === 400)
ok('monuments: total desc, then days', ids(b.monuments) === 'P4,P5,P3,P1,P2', ids(b.monuments))
ok('zero-value players excluded', !ids(b.longest).includes('P6') && !ids(b.monuments).includes('P6'))
ok('comparators antisymmetric', compareLongest(list[0], list[1]) > 0 && compareLongest(list[1], list[0]) < 0 && compareFastest(list[3], list[4]) > 0 && compareObelisks(list[0], list[1]) < 0)

// Top-10 cap and wire size.
const many = Array.from({ length: 400 }, (_, i) => pl(i + 1, { d: 1 + (i % 30), mon: i % 11, td: i % 3 === 0 ? 3 + (i % 9) : 0, ts: 100 + i }))
const wire = encodeBoardWire(many)
const boards = decodeBoardWire(wire)
ok('each board top 10', boards.longest.length === LEADERBOARD_SHOW && boards.fastest.length === LEADERBOARD_SHOW && boards.monuments.length === LEADERBOARD_SHOW)
ok('wire size < 13KB', wire.length < 13000, `${wire.length} bytes`)
ok('wire preserves rank order', boards.longest[0].v >= boards.longest[9].v && boards.fastest[0].v <= boards.fastest[9].v)
ok('wire addresses lowercase', boards.longest.every((r) => r.a === r.a.toLowerCase() && r.a.startsWith('0x')))
ok('decode junk -> empty boards', decodeBoardWire('{').longest.length === 0 && decodeBoardWire('[]').fastest.length === 0 && decodeBoardWire('{"longest":5}').longest.length === 0)
ok('unnamed -> short address on wire', decodeBoardWire(encodeBoardWire([pl(7, { n: '', d: 2 })])).longest[0].name === shortAddress(addr(7)))

// Cap keeps notable players (completers, then obelisks, then days).
const capped = trimPlayers(Array.from({ length: LEADERBOARD_STORE_MAX + 50 }, (_, i) => pl(i + 1, { d: 1, mon: 0, td: i === 0 ? 4 : 0, ts: 1 })))
ok('store capped', capped.length === LEADERBOARD_STORE_MAX, String(capped.length))
ok('cap keeps the completer', capped.some((x) => x.a === addr(1)))

// Storage round trip + garbage tolerance.
const s = serializeBoard(list)
const back = parseStoredBoard(s)
ok('round trip string', back.length === 5 && back.find((x) => x.a === addr(3))?.td === 7, String(back.length))
ok('round trip object', parseStoredBoard(JSON.parse(s)).length === 5)
ok('garbage -> empty', parseStoredBoard('nope').length === 0 && parseStoredBoard(null).length === 0 && parseStoredBoard({ players: 5 }).length === 0)
const messy = parseStoredBoard({ players: [
	{ a: 'AbC', n: '<b>Hi</b>', d: 4, td: 0, ts: 77, mon: 2 },
	{ a: 'abc', n: '', d: 9, td: 6, ts: 50, mon: 1 },
	{ n: 'no addr', d: 3 },
	{ a: 'zero', d: 0, mon: 0, td: 0 },
] })
ok('dupes merge to best, drop empties', messy.length === 1 && messy[0].a === 'abc' && messy[0].d === 9 && messy[0].mon === 2 && messy[0].td === 6 && messy[0].ts === 50, JSON.stringify(messy))
ok('name cleaned', messy[0].n === 'bHi/b', messy[0].n)

// Formatting (seconds in).
ok('elapsed s', formatElapsed(42) === '42s')
ok('elapsed m', formatElapsed(754) === '12m 34s')
ok('elapsed h', formatElapsed(3725) === '1h 02m')
ok('short addr', shortAddress('0x1e93e534c5e26b01ed242410b43ae23dd0faa52b') === '0x1e93\u2026a52b')
ok('clip', clipName('Abcdefghijklmnop', 8) === 'Abcdefg\u2026' && clipName('Ann', 8) === 'Ann')
ok('cleanName', cleanName('  Al\u0001ice   <x> ') === 'Alice x' && cleanName(5) === '' && cleanName('x'.repeat(99)).length === 24)

// Biggest Firenet: networkCredits (components of 2+, personal best across components), ranking, storage, wire, legacy rows.
{
	const who = (m: Record<number, string[]>) => (id: number) => m[id] ?? []
	// Network A: 0-1-2-3 (4 fires, chain; extra edge 1-3 makes a loop), network B: 5-6 (2 fires), solo fire 8, link to a non-burning id 9 ignored.
	const credits = networkCredits(
		[0, 1, 2, 3, 5, 6, 8],
		[[0, 1], [1, 2], [2, 3], [1, 3], [5, 6], [3, 9]],
		who({ 0: ['a'], 1: ['b'], 3: ['a'], 5: ['c', 'a'], 6: ['c'], 8: ['d'] }),
	)
	ok('network size = fires in the component (loop counted once)', credits.get('a') === 4 && credits.get('b') === 4, JSON.stringify([...credits]))
	ok('personal best across components (a: 4 beats 2)', credits.get('a') === 4)
	ok('contributor of only the small network gets its size', credits.get('c') === 2)
	ok('solo fire is not a network', !credits.has('d'))
	ok('link to a non-burning fire does not grow the network', credits.get('a') === 4)
	ok('obelisk ids never counted when absent from ids/edges', networkCredits([1, 2], [[1, 2], [2, 1000]], who({ 1: ['x'] })).get('x') === 2)
	ok('no contributors -> no credits', networkCredits([1, 2], [[1, 2]], () => []).size === 0)
	const fnList = [
		pl(1, { d: 3, fn: 5 }), pl(2, { d: 9, fn: 5 }), pl(3, { d: 1, fn: 8 }), pl(4, { d: 7, fn: 0 }),
	]
	const fb = buildBoards(fnList)
	ok('firenet: most fires, then days; zeros excluded', ids(fb.firenet) === 'P3,P2,P1', ids(fb.firenet))
	ok('firenet row carries the count', fb.firenet[0].v === 8 && fb.firenet[0].ts === 0)
	ok('compareFirenet', compareFirenet(fnList[2], fnList[0]) < 0 && compareFirenet(fnList[1], fnList[0]) < 0)
	ok('firenet-only player is stored', parseStoredBoard(serializeBoard([pl(9, { fn: 3 })])).length === 1)
	ok('firenet survives storage round trip', parseStoredBoard(serializeBoard(fnList)).find((x) => x.a === addr(3))?.fn === 8)
	const legacy = parseStoredBoard({ v: 2, players: [{ a: 'abc', n: 'Old', d: 4, td: 0, ts: 0, mon: 2 }] })
	ok('old rows without fn load with fn 0 (no wipe)', legacy.length === 1 && legacy[0].fn === 0 && legacy[0].d === 4 && legacy[0].mon === 2)
	ok('duplicate rows keep the best fn', parseStoredBoard({ players: [{ a: 'x', d: 1, fn: 3 }, { a: 'X', d: 1, fn: 6 }] })[0].fn === 6)
	const wb = decodeBoardWire(encodeBoardWire(fnList))
	ok('wire carries the firenet board', ids(wb.firenet) === 'P3,P2,P1')
	ok('old wire without firenet decodes to empty', decodeBoardWire('{"longest":[],"fastest":[],"monuments":[]}').firenet.length === 0)
	const bigWire = encodeBoardWire(Array.from({ length: 400 }, (_, i) => pl(i + 1, { d: 1 + (i % 30), mon: 1 + (i % 11), td: 3 + (i % 9), ts: 100 + i, fn: 2 + (i % 40) })))
	ok('four boards wire size < 13KB', bigWire.length < 13000, `${bigWire.length} bytes`)
	const keep = trimPlayers(Array.from({ length: LEADERBOARD_STORE_MAX + 20 }, (_, i) => pl(i + 1, { d: 1, fn: i === 0 ? 30 : 0 })))
	ok('cap keeps a big-firenet player over plain ones', keep.some((x) => x.a === addr(1)))
}

console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`)
if (fails) process.exit(1)