# Handoff \u2014 Reintroduce Cold-Open Load Optimization Safely

**Author:** claude (opendcl) session with ile, 2026-08-26 late evening
**Status:** open \u2014 optimization reverted, safe to reintroduce with care
**Priority:** medium \u2014 not blocking playtest; polish work for post-buildathon
**Related branches:** `paint-loadin-revert` (merged to main this session), previously reverted commit `d06486e`

---

## TL;DR

The center-out cold-open optimization from `d06486e` ("Speed up cold-open by ~50% via center-out spawn + inner-ring splash gate") is **correct in intent but introduced a paint-sync race** that made cells in the always-spawned campfire tiles fail to visually melt \u2014 the "four chunks around the campfire, outer edges never melt" symptom. This session reverted d06486e and confirmed via A/B test that the bug disappeared immediately.

We now understand the exact failure mode. Reintroducing the optimization is safe **if** the always-spawned tile registration is coordinated with `PaintTile` CRDT observability. This doc is the recipe.

**Recommended next step:** rebuild the optimization on a new branch off main. Do NOT copy d06486e verbatim; the reseed-timing fix (see "The recipe" below) must ship with it or the same bug returns.

---

## Sprint context

- **Playtest:** 2026-08-28 (Friday). paint-loadin-revert is on main; scene is playtest-ready with the correctness fixes.
- **Buildathon submission:** 2026-09-11. This work is post-playtest polish, not blocking.
- **User is `ile`** \u2014 solo dev, mobile-first, values honest tradeoffs. Do not ship speculative fixes; validate the theory first.

---

## What was tested and observed this session

### The bug

Multiplayer desktop (2 players). Reproducible cold-open + reload:

- Around the central campfire, the seed melt ring rendered as **four chunks of persistent snow**, one per corner tile.
- Cells inside the campfire's melt radius (nearest the fire) melted correctly.
- Cells on the outer edges of each chunk \u2014 that should also be within the seed ring \u2014 stayed snowy forever, even after reload, even after leaving and returning.
- Symptom appeared for both players simultaneously (both viewers saw the same snowy chunks, though the specific chunks could vary).
- Painting outside the ring showed the same pattern: some cells never visually melted despite the server-side paint state being correct.

### Server state was healthy the whole time

Server logs across multiple sessions consistently showed:
- `[Server] seedStartingArea: painted 208 cells in a 16.0m ring at (256.0, 256.0)` on every join.
- Steady `paintTick 5s` broadcasts with `droppedCap=0 droppedTeam=0`.
- Coverage counters growing normally with player painting.

The bug is 100% client-side. Server does its job correctly.

### What the client diagnostics showed (previous session, `paint-sync-diag` branch)

An earlier solo desktop session with `SHOW_PAINT_SYNC_DEBUG=true` produced **zero** counter hits across ~3 minutes of gameplay for:
- `applyPaintIndex` `!data` drops
- `advanceSnowFillStage` `!data` drops
- `spawnCube` / `spawnOne` `paintByTile` guard drops

**This is critical for understanding why the "obvious" race in the previous handoff wasn't the cause.** The drops the previous handoff pinned as root cause were not firing at observable frequency in solo play. But multiplayer + load-in center-out ordering shifted the timing enough that a *different* code path started dropping visual dispatches. See "Root cause" below.

---

## Root cause (confirmed by revert A/B test)

### The load-in change that broke things (`d06486e`)

Three coupled changes:
1. **Center-out tile spawn order** \u2014 sort tiles by squared distance from campfire, spawn nearest first. Before: row-major from `(0, 0)`.
2. **Inner-ring latch** \u2014 loading splash drops as soon as tiles within 8-tile radius of campfire have spawned (not the full 900-tile drain).
3. **Deferred non-essential setups** \u2014 hidden campfire, snowfall, torches, cliffs deferred behind the inner-ring latch to free GLB-fetch bandwidth for the campfire itself.

### Why it breaks paint sync

The **4 always-spawned tiles** around the campfire (`isNearCampfire()` in `rebuild.ts`: tiles `(14,14)`, `(14,15)`, `(15,14)`, `(15,15)`) get spawned first under the new ordering \u2014 within the first few frames of cold-open. They register into the paint streaming system:

```typescript
// paintStreaming.ts::registerTile
if (alwaysSpawned || entry.hasPaint) {
  entry.spawnFn()
  entry.spawnedNow = true
  reseedRequests.add(tileKey)  // <-- reseed queued
}
```

The next tick, `syncCellsFromCrdt` runs and calls `consumeReseedRequests()` which **drains the whole set unconditionally**. But at this point in cold-open, the tile's `PaintTile` CRDT entity **has not yet been observed by the client** (server broadcasts are still in flight; the CRDT replicator hasn't materialized the entity). So the `for (const [entity, tile] of engine.getEntitiesWith(PaintTile))` loop doesn't include the tile. The reseed request is consumed for nothing.

When `PaintTile` finally becomes observable a frame or two later:
- `!shadow` = true \u2192 shadow initialized to zeros \u2713
- `needsReseed` = false (already consumed) \u2192 `cellApplied` NOT wiped
- Diff loop runs. For each non-zero byte, checks `prev = cellApplied.get(cellKey)`.

**If any earlier code path populated `cellApplied` for these cells** \u2014 e.g. an optimistic paint that dispatched into `!data` and left `cellApplied` half-set (see the previous handoff's "Failure mode #1" \u2014 `cellApplied.set` at the end of `syncCellsFromCrdt`'s diff loop fires regardless of dispatch outcome) \u2014 then `prev.index === index && prev.stage === nextStage` matches, `continue` fires, **no dispatch runs, cell renders as snow forever.**

Under the row-major (pre-d06486e) ordering, campfire tiles spawned in the middle of the drain, at frame ~500 of the cascade. By then `PaintTile` observability was well-established, the reseed request landed on the correct tick, `cellApplied` was cleared, and everything worked. Center-out order collapsed the race window into "always fires."

### Why the drop counters showed zero

The `applyPaintIndex` `!data` drop is only one of several ways `cellApplied` can get poisoned. In this case the poisoning likely happens through a different path we didn't instrument \u2014 possibly via a stale `cellApplied` entry from an earlier partial dispatch, or from `cellApplied.set` at line 227 firing without the dispatch actually completing. Instrumenting **every** `cellApplied.set` call site would confirm this, but the revert made it moot for playtest.

Worth noting: the drops-are-zero finding from the previous session was **valid but incomplete** \u2014 the theorized race path was not firing, but a *different* one was. If someone reintroduces the optimization, they should re-enable `SHOW_PAINT_SYNC_DEBUG` and consider adding counters at each `cellApplied.set` and `cellApplied.get` site to catch this.

---

## What shipped this session (all on main via `paint-loadin-revert`)

Three commits, in order:

### 1. `b2f5afd` \u2014 paintResync safety net (Option A from previous handoff)

Periodic 20-second resync that wipes `tileShadow` + `cellApplied` for spawned tiles and lets the diff loop re-dispatch. Belt-and-suspenders. Left in place \u2014 it's cheap and provides recovery for any other paint-sync issue that slips through.

### 2. `7d7843c` \u2014 Optimistic melt mirrors into `cellApplied`

**Independent bug**, discovered mid-investigation. `enqueuePaintCandidate` targetStage=0 (melt) branch updated `renderedIndex` and queued the drop tween, but did NOT write `cellApplied`. Since `getSnowStageAtWorld` (used by both frost accumulation and locomotion) reads `cellApplied`, the visual would melt but slow-walk + frost damage kept ticking until the server round-tripped the paintTick echo. The stomp branch of the same function got the pattern right; the melt branch was missing it. Validated by ile in local test.

### 3. `cfc345a` \u2014 Revert of d06486e

Conflict resolution note: main had evolved since d06486e. `setupRemoteTorches`/`setupTorchChain`/`setupTorchWarmth` were moved eagerly BEFORE `joinRoster` in a later commit for hydration correctness (unrelated to the load-in). Revert preserved that \u2014 only `setupTorch` + `setupTorchInput` were restored to eager cold-open. A comment warning against re-adding the message-subscriber siblings was added.

---

## What did NOT work (do not repeat)

Two branches were built and tested before the revert. Both failed to fix the bug. They stay parked so their negative results are reproducible.

### `paint-sync-diag` \u2014 diagnostic counter rollup

Instrumented three suspected drop paths (`applyPaintIndex !data`, `advanceSnowFillStage !data`, `spawnCube` guard drop). Zero drops observed across ~3 minutes of solo desktop play. Useful confirmation that the theorized "silent dispatch drop" race in the previous handoff was not the actual bug. Keep this branch \u2014 next session should re-enable and extend it (see "The recipe" below).

### `paint-firstobs-cellapplied-wipe` \u2014 wipe `cellApplied` on every first-observation

Attempted a defensive fix by moving `cellApplied.delete` out of the `if (needsReseed)` guard in `syncCellsFromCrdt`, so cellApplied got wiped on every fresh shadow init (first observation OR reseed OR length mismatch). Logically consistent hypothesis, tested by ile in the same multiplayer session that eventually needed the full revert \u2014 **did not fix the bug**. This falsifies the "poisoned cellApplied at first observation" as the sole failure mode; something more subtle is happening around the `PaintTile` observability timing.

That said, the change was safe (wiping empty entries is a no-op) and *might* still be worth including as belt-and-suspenders. Not urgent.

---

## The recipe for reintroducing the optimization safely

### The core fix

The optimization is worth reintroducing \u2014 splash drops noticeably sooner, cold-open feels much snappier. But it must ship with a coordination fix so always-spawned tiles do not process their reseed until their `PaintTile` CRDT entity has been observed at least once.

**Concrete approach** (~30-60 min of work):

1. **Change `consumeReseedRequests` to be conditional.** Instead of unconditionally draining and returning the whole set, take a callback or a Set of "currently-observable tileKeys" and only drain entries that match. Retained entries stay pending for the next tick.

2. **In `syncCellsFromCrdt`**, build the set of observable tileKeys **first** (walk `getEntitiesWith(PaintTile)` once to collect tileKeys), then call `consumeReseedRequests(observableKeys)`. Non-observable tiles keep their reseed request pending.

3. **Test**: with the fix in place, always-spawned tiles registered before their `PaintTile` is observable should still get their reseed applied on the tick where `PaintTile` first appears.

Alternative simpler approach: instead of changing the API, add a `Map<tileKey, pendingReseed>` in paintStreaming, and in `syncCellsFromCrdt` process a tile's reseed *only* when the tile is being diffed. Same effect, smaller diff.

### Before shipping

- **Re-enable `SHOW_PAINT_SYNC_DEBUG`** in devFlags and add counters at all `cellApplied.set` / `cellApplied.get` call sites. Run a 5-minute multiplayer session with the optimization + fix. Confirm no anomalies before merging.
- **A/B test**: cold-open with the optimization + fix should feel as fast as `d06486e` did, and the four-chunk pattern must not reappear.
- **Regression check**: streaming despawn/respawn at map edges still works. Frost/slow still stops immediately on melt. Stomp still works.

### What NOT to try

- **Do not re-add the setup deferrals** without checking `setupRemoteTorches`/`setupTorchChain`/`setupTorchWarmth` are still installed eagerly before `joinRoster`. They're message subscribers; deferring them silently drops the initial `torchLitFrom` hydration burst for remote players.
- **Do not shrink the inner-ring radius below 8 tiles** without checking that the visible edge of the maze on the horizon has actually spawned by the time the splash drops. 8 tiles = 128m radius. Player fov + campfire orientation matters here.

---

## Other issues flagged during the session (not fixed)

### 1. "Level regenerated when another player joined"

Observed by ile during the multiplayer test. When a second player joined an in-progress session, the maze re-rebuilt for the first player. Should not happen \u2014 the maze is deterministic per 24h cycle and joins should not trigger regen.

**Suspected path**: `joinRoster` handler on server calls `clearing paint + reseeding` (that log line is present on every join in the server log). Client-side, there's a `cycle: publishing new mazeSeed` line that fires on hydration \u2014 if that publish fires unconditionally on join, it might trigger rebuild on all clients even when the seed hasn't changed.

Not investigated. Flag for a separate session. Not related to the load-in optimization directly, though the load-in revert also happens to make it more visible because rebuild now takes longer.

### 2. Cold-open feels slow again after revert

Expected tradeoff. Splash now waits for the full ~900-tile drain. First-time users on slow machines may bounce. Reintroducing the optimization (this doc's main topic) fixes this.

---

## Recommended plan for next session

1. **Read this doc + `docs/handoff-paint-sync-mobile.md`** end-to-end. The two docs cover the same subsystem from different angles; both are useful.
2. **Read `d06486e`** (the reverted commit) to understand what the optimization was trying to do. `git show d06486e`.
3. **Branch off main**: `git checkout -b paint-loadin-v2`.
4. **Cherry-pick the tile-ordering + inner-ring latch changes** from `d06486e` but **do NOT copy the reseed-timing behavior verbatim**. Implement the coordination fix in "The recipe" above.
5. **Enable `SHOW_PAINT_SYNC_DEBUG`** during development. Add counters at each `cellApplied.set` call site.
6. **Test on desktop first, then multiplayer, then mobile.** The four-chunk pattern is the acceptance test \u2014 if it appears anywhere, the fix is incomplete.
7. **Investigate the "regen on join" bug** as a separate branch. Should be quick to trace once someone actually looks.

---

## Contact

Deploy target: `snowdrift.dcl.eth` (Decentraland World). Deploy via Creator Hub app UI.

User is `ile` (iillee on GitHub). Prefers precise diagnosis over pattern-matched fixes. When a theory doesn't pan out, say so \u2014 don't paper over with more theory. When the direct test (like this session's revert) is faster than more diagnostics, take the direct test.
