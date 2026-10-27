/** fireShareCheck: keep-and-share split math. node scripts/fireShareCheck.mjs */
import { splitFuelChainFirst, splitFuelKeepShare, splitFuelWaterFill } from 'src/shared/fireNetwork'
let fails = 0
const ok = (name: string, c: boolean, info = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!c) fails++ }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)
let w = splitFuelWaterFill([100, 300, 500], 600, 120)!
ok('waterfill lowest first', near(w[0], 120) && near(w[1], 0) && near(w[2], 0), JSON.stringify(w))
w = splitFuelWaterFill([100, 200], 600, 300)!
ok('waterfill levels', near(w[0], 200) && near(w[1], 100), JSON.stringify(w))
ok('waterfill all full -> null', splitFuelWaterFill([600, 590], 600, 60) === null)
let r = splitFuelKeepShare(200, [100, 400], 600, 60, 0.5)!
ok('keep half', near(r.fed, 30) && near(sum(r.others), 30) && near(r.others[0], 30), JSON.stringify(r))
r = splitFuelKeepShare(200, [590], 600, 60, 0.5)!
ok('others capped -> back to fed', near(r.fed, 50) && near(r.others[0], 10), JSON.stringify(r))
r = splitFuelKeepShare(590, [100], 600, 60, 0.5)!
ok('fed capped -> to others', near(r.fed, 10) && near(r.others[0], 50), JSON.stringify(r))
ok('all capped -> null', splitFuelKeepShare(590, [595], 600, 60, 0.5) === null)
r = splitFuelKeepShare(200, [100, 100, 100], 600, 60, 0.5)!
ok('total conserved', near(r.fed + sum(r.others), 60), JSON.stringify(r))
r = splitFuelKeepShare(600, [200, 500], 600, 120, 0.5)!
ok('fed full -> all to others, lowest first', near(r.fed, 0) && near(r.others[0], 120) && near(r.others[1], 0), JSON.stringify(r))
r = splitFuelKeepShare(600, [500, 540], 600, 120, 0.5)!
ok('fed full, overflow water-filled', near(r.fed, 0) && near(r.others[0], 80) && near(r.others[1], 40), JSON.stringify(r))
ok('fed full, others too small -> null', splitFuelKeepShare(600, [550, 560], 600, 120, 0.5) === null)
// Fuel follows heat (chain charging): share goes to the lowest-hop chain fire with room first.
r = splitFuelChainFirst(200, [500, 100], [1, 0], 600, 60, 0.5)!
ok('chain: share to hop-1 first (not lowest fuel)', near(r.fed, 30) && near(r.others[0], 30) && near(r.others[1], 0), JSON.stringify(r))
r = splitFuelChainFirst(200, [590, 100], [1, 0], 600, 60, 0.5)!
ok('chain: hop-1 fills, rest falls back to lowest fuel', near(r.others[0], 10) && near(r.others[1], 20) && near(r.fed, 30), JSON.stringify(r))
r = splitFuelChainFirst(200, [300, 100, 100], [2, 1, 0], 600, 60, 0.5)!
ok('chain: lowest hop wins', near(r.others[1], 30) && near(r.others[0], 0), JSON.stringify(r))
r = splitFuelChainFirst(600, [580, 400], [1, 0], 600, 120, 0.5)!
ok('chain: fed full overflow to hop-1 then lowest', near(r.fed, 0) && near(r.others[0], 20) && near(r.others[1], 100), JSON.stringify(r))
r = splitFuelChainFirst(200, [100, 100], [1, 1], 600, 60, 0.5)!
ok('chain: total conserved', near(r.fed + sum(r.others), 60), JSON.stringify(r))
ok('chain: all capped -> null', splitFuelChainFirst(590, [595], [1], 600, 60, 0.5) === null)
console.log(fails ? `${fails} FAILED` : 'all pass')
if (fails) process.exit(1)
