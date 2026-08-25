# Handoff — Paint Sync on Mobile

**Author:** claude (opendcl) session with ile, 2026-08-25 late evening
**Status:** open — mobile-blocking bugs identified but not fixed
**Priority:** high — mobile is the primary target for the 2026-08-28 playtest (3 days out); mobile must feel solid before then
**Related branches:** `warmth-together` (merged to main), `paint-sync-safety` (unmerged, contains Option A safety net described below)

---

## TL;DR

The paint sync pipeline has a latent race that mostly hides on desktop but breaks visibly on mobile. Two distinct bug patterns share one root cause. Option A (a periodic safety-net resync) was built and is on `paint-sync-safety` — it partially helps but does NOT fix the specific mobile symptom "player can't see their own melt while others can." The real fix is Option B (deferred-retry on dispatch failure), which is described but not built.

**Recommended next step:** build Option B on a new branch off main. Do not touch the paintResync safety net yet — leave it as belt-and-suspenders.

---

## Sprint context

- **Playtest:** 2026-08-28 (Friday). Show-and-tell / data-collection event. Unofficial.
- **Buildathon submission:** 2026-09-11 (moved from 09-04).
- **Sprint plan (already written in `docs/PLAN.md` §13b):**
  - Wed 08-26: hearth 4/4 celebration
  - Thu 08-27: all-3-lit celebration + first-90-seconds onboarding polish
  - Fri 08-28: cold-open self-tests, Discord prep, playtest
- **The mobile paint bug takes priority over the celebrations.** Everything else in the sprint plan can slip. Mobile-first is a hard project constraint.
- User is a solo dev with strong instincts about the game's cell-grid vocabulary. Prefers concise design conversations over feature dumps. Values honest tradeoffs over agreeable answers.

---

## What was tested live and observed

**Desktop:** everything works perfectly. No paint issues reported. Warmth-together mechanic validated.

**Mobile:** four distinct observations, all pointing at the same underlying pipeline issue:

1. **Cold-open: campfire seed circle had unmelted snow.** The server-authored permanent melt ring around the central fire (defined by `seedStartingArea()` in `src/server/paintState.ts`) rendered as snow on a chunk of cells that should never have snow. After ~20 seconds the `paintResync` safety net kicked in and melted most of it, but **a small section stayed unmelted permanently.**
2. **Walking in deep snow: some cells never melted from the mobile POV.** The desktop observer watching the same mobile player saw all the correct cells melting. Mobile's own screen showed patchy trails.
3. **Melt lags behind the player** on mobile. Cells clear a beat after the avatar has walked over them, not underneath.
4. **Cross-viewer asymmetry:** desktop sees mobile's melt correctly; mobile does not see its own melt correctly.

Observation #4 is the smoking gun and is critical for diagnosis.

---

## Architecture recap (only the parts that matter)

**Files involved:**

- `src/shared/paintSync.ts` — server writes cell state into per-tile `PaintTile` CRDT byte arrays. `flushDirtyPaintTiles()` broadcasts changed tiles once per server tick.
- `src/server/paintState.ts` — `applyPaint(id, team, targetStage)` writes into the tile buffer via `writeCellByte`. Also handles regrowth via `tickRegrowth`.
- `src/server/server.ts` — receives `paintTick` messages, calls `applyPaint`, later flushes.
- `src/client/paint.ts` — the client observer. Contains:
  - `syncCellsFromCrdt()` — runs every frame, diffs incoming `PaintTile.cells` bytes against per-tile `tileShadow`. On any diff, dispatches `applyPaintIndex()` / `advanceSnowFillStage()`. Updates `cellApplied` (map of last-known-rendered state).
  - `enqueuePaintCandidate(id, targetStage)` — the outbound path. Client-side paint or stomp gets queued into `paintOutboxMelt` / `paintOutboxStomp` for the next paintTick send AND runs optimistic local dispatch via `applyPaintIndex`.
  - `applyPaintIndex(id, index, force)` — the visual dispatch. Short-circuits on `renderedIndex.get(id) === index` unless `force=true`. Returns early with no visual if `cellData.get(id)` is undefined.
  - `spawnCube` inside `spawnCellsForTile()` — creates cell entities. **Reads `cellApplied` on spawn to self-hydrate** the cube at the correct thickness + material.
- `src/client/paintStreaming.ts` — distance-based streaming for cell entities. Cells spawn/despawn based on player position with sticky-loading for tiles that have any painted cells. Time-sliced spawn queue: `CELLS_PER_FRAME = 24`.
- `src/client/paintResync.ts` — **NEW in `paint-sync-safety` branch** — the periodic safety net (Option A) described below.

**State maps that matter:**

- `tileShadow: Map<Entity, Uint8Array>` — per-tile shadow of last-observed CRDT bytes. Diff source.
- `cellApplied: Map<cellKey, { index, stage }>` — last-known-rendered state per cell. Read by `spawnCube` for self-hydration. Advanced by `syncCellsFromCrdt` regardless of dispatch success.
- `renderedIndex: Map<id, number>` — the palette index last written to a cell's mesh. Read by `applyPaintIndex` for short-circuit. **Advanced by `applyPaintIndex` BEFORE the `cellData` existence check.**

---

## Root cause analysis

### The race

There are two distinct failure modes and they interact.

**Failure mode #1: cellApplied advances even when dispatch dropped.**

In `syncCellsFromCrdt`, the diff loop does:
```
if (!prev || prev.index !== index) {
  applyPaintIndex(id, index, false)  // silently no-op if cellData missing
  if (index !== PALETTE_NONE && (nextStage === 1 || nextStage === 2)) {
    advanceSnowFillStage(id, nextStage)  // also no-op if cellData missing
  }
}
// ... other branches ...
cellApplied.set(cellKey, { index, stage: nextStage })  // fires regardless
```

If the cell entity doesn't exist yet (`cellData.get(id) === undefined`), the dispatch silently drops. But `cellApplied` gets set as if the dispatch succeeded. The next sync pass sees `cellApplied` matches the incoming byte → short-circuits (`if (prev && prev.index === index && prev.stage === nextStage) continue`) → never retries.

Mitigating factor: `spawnCube` reads `cellApplied` on spawn and self-hydrates the cube at the correct thickness/material. So most of the time this doesn't matter — the cell spawns later with the right state baked in from `cellApplied`.

But this fails when the byte changes DURING the spawn queue drain. Then `cellApplied` is set for the pre-spawn dispatch (correct), cube spawns from that hydration (correct), THEN a new byte arrives, dispatch runs, cell exists now so it works. Actually — this specific sequence works. So Failure mode #1 alone isn't the mobile bug.

**Failure mode #2: `renderedIndex` advances in `applyPaintIndex` BEFORE the `cellData` check.**

```
export function applyPaintIndex(id: string, index: number, force: boolean): void {
  if (!force && renderedIndex.get(id) === index) return
  renderedIndex.set(id, index)  // <-- ADVANCES BEFORE THE DATA CHECK
  const data = cellData.get(id)
  if (!data) return  // <-- silent drop with renderedIndex already stale-set
  ...queue drop tween...
}
```

Now the deadly sequence:

1. Mobile player walks over a cell. `enqueuePaintCandidate(id, 0)` called.
2. Optimistic dispatch: `applyPaintIndex(id, index, false)` → `renderedIndex.set(id, index)` → `cellData.get(id) === undefined` (cell hasn't spawned yet on mobile because spawn queue is behind) → silent return.
3. `paintTick` sent to server. Server processes, echoes CRDT byte change.
4. Time passes. Cell entity eventually spawns via `spawnCube`. Reads `cellApplied` — **but `cellApplied` was never set in step 2** (optimistic path doesn't touch cellApplied, only the CRDT observer does). So `preexisting = undefined ?? renderedIndex.get(id) ?? PALETTE_NONE` → renderedIndex is set (to `index`) → **preexisting = index → cube spawns at painted thickness with correct material.** OK, that path works.

Wait, that path works. Let me re-check.

Actually looking at `spawnCube`:
```
const appliedIdx   = key !== null ? cellApplied.get(key)?.index : undefined
const appliedStage = (key !== null ? cellApplied.get(key)?.stage ?? 0 : 0) as 0 | 1 | 2
const preexisting = appliedIdx ?? renderedIndex.get(id) ?? PALETTE_NONE
```

Yes — it falls back to `renderedIndex` if `cellApplied` is missing. So the optimistic-then-spawn path recovers.

**So what actually breaks?** Consider:

1. Mobile: cell entity has NOT yet spawned. CRDT bytes arrive for this cell from server (say, hydrated at cold-open).
2. `syncCellsFromCrdt` runs. Byte diff detected. `applyPaintIndex(id, index, false)` → `renderedIndex.set(id, index)` → `cellData` missing → silent return. `cellApplied.set(cellKey, {index, stage})`.
3. Cell entity spawns via `spawnCube`. Reads `cellApplied` → `preexisting = index` → cube spawns at painted thickness with correct material. **This works.**

Or:

1. Mobile: cell entity has NOT yet spawned. Player walks over cell, `enqueuePaintCandidate` optimistically dispatches. Silent return, `renderedIndex.set(id, index)`. paintTick queued.
2. Server processes paintTick, echoes CRDT byte.
3. `syncCellsFromCrdt` runs. Byte diff detected. `applyPaintIndex(id, index, false)` → `renderedIndex.get(id) === index` → **early return, no tween queued, no material change.** `cellApplied.set(cellKey, {index, stage: 0})`.
4. Cell entity finally spawns via `spawnCube`. Reads `cellApplied` → `preexisting = index, appliedStage = 0` → `regrownThickness = null` → `thickness = PAINTED_THICKNESS` → cube spawns at painted thickness with material set to `cellMaterialForIndex(index)`. **This should also work.**

Hmm. Both paths appear to self-heal. So why is mobile breaking?

### Where my analysis gets uncertain

I traced the code carefully and both plausible failure sequences appear to be caught by `spawnCube`'s self-hydration. So the mobile bug must be caused by something more subtle. Candidates:

**A. Spawn queue guard drops the cell's spawn closure entirely.**

The spawnCube closure is guarded by:
```
if (paintByTile.get(tileEntity) !== tileRec) return
```

This drops the closure if the tile was despawned or re-spawned between enqueue and drain. If mobile is under heavy load, tiles might be flicking spawn/despawn near the streaming boundary and cell spawns get dropped entirely. Then the cell entity NEVER exists, `cellData.get(id)` is permanently undefined, and no amount of resync helps.

**B. `renderedIndex` interferes with the safety net's re-dispatch.**

The paintResync safety net wipes `tileShadow` and `cellApplied` but NOT `renderedIndex`. So when the re-dispatch runs, it sees `renderedIndex.get(id) === index` and short-circuits without queuing a tween. **This IS the reason paintResync doesn't fix the "mobile can't see own melt" bug.** The safety net is designed to re-trigger visual dispatch, but `renderedIndex` blocks that.

**C. `advanceSnowFillStage` writes material for stage 1 always but doesn't queue a tween when start==end. Should still be OK for stage 0 melt path though.**

**D. Frame-rate compounding.** Every time-sliced system in the paint pipeline runs proportionally slower on mobile. `syncCellsFromCrdt` fires fewer times per second, the 24-cells-per-frame spawn queue drains slower, tiles register slower, streaming poll is 4Hz (unchanged). The race window widens on mobile so more dispatches hit the failure modes.

**Most likely primary cause:** B. The `renderedIndex` short-circuit blocks the safety net's re-dispatch from doing anything on cells that already had a failed optimistic write. This is why my paintResync partially works (it does recover cells whose ONLY dispatch was the CRDT observer, since cellApplied is wiped) but doesn't fix cells where the client's OWN optimistic paint set `renderedIndex` earlier without rendering.

---

## Option A (built, on branch `paint-sync-safety`)

`src/client/paintResync.ts` — periodic safety-net resync.

- Every 20 s (after a 5 s cold-open grace), calls `requestResyncForSpawnedTiles(exceptTileKey)` in `paintStreaming.ts`.
- That adds every spawned tile's key to `reseedRequests`, excluding the player's current tile (avoid clobbering an in-flight drop tween on a just-painted cell).
- Next `syncCellsFromCrdt` pass sees `needsReseed` for those tiles → wipes `tileShadow[entity]` to zeros AND wipes `cellApplied` for every cell in the tile.
- Diff loop re-fires. Every non-zero byte is "new" vs the wiped shadow. Re-dispatches.

**What it fixes:** cells whose ONLY dispatch was a dropped CRDT observer call (cellApplied wiped, so the re-dispatch fires).

**What it does NOT fix:** cells where `renderedIndex` was stale-set by a failed optimistic paint (the re-dispatched `applyPaintIndex(id, index, false)` short-circuits on the renderedIndex match). This is the mobile-specific pattern.

Recommendation for Option A: **keep it, do not merge to main yet.** It's a valid safety net that costs almost nothing. Merge it AFTER Option B is validated so we have both belts and suspenders.

---

## Option B (not built) — the real fix

Two changes, both minimal, both isolated to `src/client/paint.ts`:

### B.1 — Don't advance `renderedIndex` until dispatch is confirmed applied

Change `applyPaintIndex`:

```
export function applyPaintIndex(id: string, index: number, force: boolean): void {
  if (!force && renderedIndex.get(id) === index) return
  const data = cellData.get(id)
  if (!data) {
    // Cell entity does not exist yet. Do NOT advance renderedIndex —
    // that would poison the short-circuit on future re-dispatch attempts.
    // Track this id for retry when the cell finally spawns (or the
    // safety-net resync fires).
    pendingApply.set(id, index)
    return
  }
  renderedIndex.set(id, index)
  ...queue drop tween as before...
  pendingApply.delete(id)
}
```

Add module-level `const pendingApply = new Map<string, number>()`.

### B.2 — Add a retry system that drains pendingApply

Runs every frame (or throttled to 4-10Hz). For each `[id, index]` in `pendingApply`:

- If `cellData.has(id)`, call `applyPaintIndex(id, index, false)` — since renderedIndex was NOT advanced last time, the check now falls through and the dispatch runs. The pendingApply entry gets deleted inside applyPaintIndex on success.
- Otherwise leave it in the set.

Cap the set size defensively (e.g. 10,000 entries) so a runaway bug can't consume memory.

### B.3 — Parallel fix for advanceSnowFillStage

Same pattern. Currently:

```
function advanceSnowFillStage(id: string, stage: 1 | 2): void {
  const data = cellData.get(id)
  if (!data || data.kind !== 'cube') return
  ...
}
```

Add: if `!data`, push into a `pendingStage` map with `{id, stage}`. Retry system drains it too.

### B.4 — Fix `cellApplied` in syncCellsFromCrdt

The final piece: `cellApplied.set` at the end of the diff loop should only fire if dispatch actually happened. Restructure to track dispatch success:

```
let dispatched = false
if (!prev || prev.index !== index) {
  dispatched = tryApplyPaintIndex(id, index, false)  // returns bool
  if (index !== PALETTE_NONE && (nextStage === 1 || nextStage === 2)) {
    tryAdvanceSnowFillStage(id, nextStage)
  }
} else if (nextStage === 0) {
  dispatched = tryApplyPaintIndex(id, index, true)
} else {
  dispatched = tryAdvanceSnowFillStage(id, nextStage)
}

if (dispatched) {
  cellApplied.set(cellKey, { index, stage: nextStage })
}
// If NOT dispatched, cellApplied stays stale. Next sync pass will
// re-diff (byte still != cellApplied's implied byte).
```

Wait — this has a problem. Shadow gets set to the incoming byte inside the loop. So next diff pass will find shadow === incoming and skip. Need to ALSO gate the shadow advance on dispatch success, OR rely purely on the pendingApply retry mechanism.

The cleaner path: **rely purely on pendingApply/pendingStage.** They are the retry mechanism. `cellApplied` and `tileShadow` continue their current semantics (record what the CRDT observer saw). The dispatch layer independently tracks what's actually rendered. On successful dispatch (from initial call or from retry drain), everything lines up.

### Estimated effort

~1 hour to write, ~1 hour to smoke test on desktop, ~30 min to validate on mobile. Would want at least one round of "walk aggressive patterns while alt account watches for stuck cells" testing before merging.

### Risk assessment

Low-to-medium. All changes localized to `paint.ts`. The retry system is additive. The `renderedIndex` change is the only behavioral change to existing hot-path code, and it only changes the "dispatch failed" branch — the "dispatch succeeded" branch is unchanged.

Regression risk on desktop: low. Desktop rarely hits the failure branch (cells almost always exist when dispatch runs). If they do, the new pendingApply retry is essentially free.

---

## Option C (Band-Aid) — bump mobile spawn budget

If Option B looks risky and playtest is imminent, `CELLS_PER_FRAME` in `paint.ts` could be bumped from 24 → 60 for the first ~10 seconds of cold-open, then back to 24. Would drain the spawn queue faster and shrink the race window.

Not a fix, just a mitigation. And it might introduce visible hitches on mobile during cold-open (bigger frame stalls). Only recommended if Option B is deemed too risky before Friday.

---

## Option D (probably not) — force-flag the safety net

Change `paintResync` to force re-dispatch by making the sync loop call `applyPaintIndex(id, index, true)` on all reseed tiles.

**Would blast through renderedIndex short-circuit.** But would ALSO cause every correctly-rendered cell to run a zero-delta drop tween — visible as a small world "ripple" every 20 seconds. Almost certainly too jarring.

Do not do this.

---

## Also worth investigating

- **`paintByTile` guard in the spawn queue closure.** If tiles are flicking spawn/despawn near the streaming boundary on mobile, the spawn closure drops the cell entirely. Cell never exists, retry mechanism can't help. Need to log occurrences of the guard dropping closures to know if this is happening in practice.
- **Streaming poll cadence on mobile.** `CELL_STREAM_POLL_HZ = 4` (see `src/shared/settings.ts`). Might be too aggressive — a fast-moving player crossing the 40m in-radius / 48m out-radius hysteresis could trigger flicker. If confirmed, either widen hysteresis or slow the poll.
- **`renderedIndex` never gets cleaned up when a cell despawns.** If cell A despawns and its entity is destroyed, `renderedIndex.get(id_A)` still returns the last painted value. When cell A re-spawns and paint state has changed, `applyPaintIndex` might short-circuit incorrectly on the stale renderedIndex. Should verify: does `removePaintForTileEntitiesOnly` (the despawn path in `paint.ts`) clear `renderedIndex` for the tile's cells? Grep for it.

---

## Diagnostic aids the next session can use

Before shipping Option B, would be great to have real numbers. Suggested cheap additions:

1. **Log every dispatch drop.** In `applyPaintIndex`'s `!data` branch, `console.log('paint: applyPaintIndex drop, id=X')`. Only enable behind a dev flag. Count occurrences per 10-second window; report if > threshold. This tells us if the theorized race actually happens with mobile-visible frequency.
2. **Log every spawn-closure drop.** In the `paintByTile.get(tileEntity) !== tileRec` guard inside spawnCube's queued thunk. Same treatment.
3. **Log every paintResync fire's queue count.** Already partially logged in `paintResync.ts` — bump verbosity.

Consider adding these behind `SHOW_PAINT_SYNC_DEBUG` in `devFlags.ts` while Option B is in development. Turn off before merge.

---

## What NOT to do

- **Don't touch the `warmth-together` merge on main.** That branch is validated and shipped. Any paint sync work is separate.
- **Don't merge `paint-sync-safety` yet.** Wait until Option B ships too, then merge both.
- **Don't chase particle/audio load as the fix.** They're a symptom accelerator, not the cause. Fix the race first, then optimize if needed.
- **Don't add code that ships to production behind a device check like `if (isMobile()) ...`** unless absolutely necessary. The bug is architectural; the fix should be architectural. Mobile-specific mitigations mask real problems and rot.

---

## Recommended plan for next session

1. **Read `src/client/paint.ts`** end-to-end, especially:
   - `syncCellsFromCrdt` (lines ~136-235)
   - `applyPaintIndex` (~761-790)
   - `advanceSnowFillStage` (~368-388)
   - `enqueuePaintCandidate` (~707-750)
   - `spawnCube` (~962-1000)
2. **Read `src/client/paintStreaming.ts`** to understand reseed flow.
3. **Read `src/client/paintResync.ts`** (on `paint-sync-safety` branch) to see Option A already built.
4. **Verify the analysis above** by tracing the code. If my diagnosis is wrong, correct the doc and re-plan.
5. **Add diagnostic logging** (see "Diagnostic aids" above) and deploy to snowdrift.dcl.eth to gather real numbers on mobile. This is the honest first move — I'm reasoning from code, not data.
6. **Implement Option B** if diagnostics confirm the theory. Test on desktop first, then mobile.
7. **Merge both branches** (`paint-sync-safety` first for the safety net, then the Option B branch) to main.
8. **Report back to ile** with what was found + what shipped. Update `docs/PLAN.md` §13b to reflect actual sprint progress.

---

## Contact

Deploy target: `snowdrift.dcl.eth` (Decentraland World). Deploy via Creator Hub app UI (CLI has a proxy bug on Node 24, see PLAN.md v2.7 change log).

Auth-server SDK bumped to `commit-dae48fb` today (2026-08-25). Both `@dcl/sdk` and `@dcl/js-runtime` pinned exact.

User is `ile` (iillee on GitHub). Solo dev, mobile-first, cozy multiplayer design ethos, prefers precise diagnosis over pattern-matched fixes.
