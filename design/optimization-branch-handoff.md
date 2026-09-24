# Optimization Branch — Session Handoff

> **Status (2026-09-24): DONE.** Merged to `main` and pushed (`a2e1a5c`). Live pickup doc: [`session-2026-09-24-optimization-complete.md`](session-2026-09-24-optimization-complete.md).
>
> **Errata (2026-09-23):** superseded by [`paint-rewrite.md`](paint-rewrite.md). Corrections: there is no 5 s server paint batch (5 s is only the log interval; bug 2 is cube entities not existing yet when the optimistic melt fires); the ground walkable top is Y = 0.5, not Y = 0; fixed 16 m coarse blocks are replaced by a quadtree; the server is refactored, not rewritten.

*Written 2026-09-23 for pickup by a new Claude session (likely a newer model). Everything decided in the prior session is captured here so no context is lost.*

---

## 0. Where we are right now

- **Branch:** `optimization` (branched from `main` this session)
- **Safety tag:** `pre-paint-rewrite` on commit `b6004d8` — full revert point if the rewrite goes sideways
- **Working tree:** clean, no in-flight changes
- **Nothing has been implemented yet.** All work below is planned but not started. The prior session paused after gathering design info, immediately before writing the design doc.

To revert if anything breaks: `git reset --hard pre-paint-rewrite`

---

## 1. Context — why this branch exists

Cryocene had a 12–19 player playtest on 2026-09-23. It ran, but with four bugs and a load-time problem:

1. **Level "reloads" while player is in-scene as new players join.** Root cause: `src/client/paintResync.ts` fires a 20s safety-net resync that re-hydrates all spawned PaintTiles at once. Under high paint load (peak 15,201 painted cells, 34+ tiles) this causes a visible whole-map flash. New joiners also trigger initial hydration bursts.
2. **Snow melts but base tile stays white for several seconds.** Root cause: server batches paint updates on a 5s `paintTick`. Client melt is optimistic locally (scatter clears instantly) but base-cell color change is authoritative and lags by up to 5s. Under load, some ticks show `applied=0` followed by big catch-up ticks — throttle may be dropping newest melts.
3. **Snow blocks turn blue unexpectedly.** Root cause: the paint palette is `0=None (white), 1=Red, 2=Blue` — **vestigial from the Flagtag competitive team-paint system**. Every current player is auto-assigned team BLUE, so every melted cell is painted `#6A99FC` (light blue). The user perceives this as "snow cubes randomly turning blue" — really it's the intended melt-reveal color leaking through z-fight seams with paint cubes still at the same Y as the base tile.
4. **Off-color white snow chunks clashing with regular white.** Was suspected to be `scatter.ts` GLBs with mismatched materials, but `scatter.ts` is actually **dead code** — not imported anywhere. Bug is likely lighting/AO differences between paint cubes at different Y positions during mid-melt tweens. Will resolve on its own in the rewrite.

Server logs at peak: `roster size 19`, `paintCells=15201`, `tiles=34+`, `droppedCap=0` (server never throttled, so all melts were faithfully broadcast to 19 clients — which is the perf load).

---

## 2. Reference project — dcl-place

Path: `C:\Users\luke\AppData\Roaming\creator-hub\Scenes\dcl-place\`

dcl-place solved essentially the same problem (mass CRDT hydration + per-cell paint entities on mobile) and its `docs/DESIGN.md` §7 lists load-bearing invariants. Key lessons imported:

- **300 addEntity/frame ceiling.** Mobile's entity allocator silently drops cells above this under sustained load with CRDT replay in flight. Cell-spawn and CRDT-apply paths must BOTH respect it and be **sequentially gated** — the grey-fill spawn queue waits for `applyQueue.length === 0` before spawning anything. Never overlap two allocation sources.
- **Fresh `MaterialInfo` per `setPbrMaterial` call.** Do NOT cache and share the object across cells. Mobile silently blanks the canvas if you do — the SDK/renderer references or mutates it internally. Color4 constants can be reused, but the wrapping object must be new per call.
- **Splash gate holds until real hydration state is quiescent**, not on a timer. `isSpawningCanvas() || isApplyingHydration() || !paintHydrated`. Uses a `hydrationFullySettled` latch so live paints post-boot don't re-trigger the splash.
- **Server hydrates persistent state before accepting first join.** No client should connect and act against state that's about to be overwritten.

These invariants map to our current bugs 1 & 2 directly.

---

## 3. Optimization opportunities identified (in priority order)

The prior session evaluated several optimization ideas from Foundation friends:

1. **Sphere primitive mesh recycling.** Godot Explorer shares the sphere mesh across all `MeshRenderer.setSphere` entities. `setBox` may or may not — worth asking Foundation. But we would NOT swap our snow cubes for spheres (voxel look, z-fighting). The real question is whether the client instance-batches `setBox` with identical materials. Deferred to *"ask Foundation, don't restructure around a client-implementation detail."*
2. **Quadtrees for spatial indexing.** Overkill at 30×30 tiles (uniform grid is already O(1) lookup, faster than quadtree's O(log n)). Wins at 100×100 parcels with sparse content. **Bookmark for v1.5.** Note: quadtrees ARE useful in this rewrite as a **rendering-coarsening structure** (large cubes for pristine areas, small cubes where melt happens) — different use of the same word.
3. **Melt-based LOD instead of proximity LOD.** Big win — melt is naturally sparse. Adopted into the rewrite plan.
4. **Tile GLB removal.** Every walkable tile currently has a `tile-*.glb` slab underneath (30×30 = 900 GLBs at boot, plus 120 perimeter cliffs). File sizes are tiny (2.6–4.8 KB, 7 unique files) but the load-time cost is per-entity GLB parse + collider setup + material bind = seconds on mid mobile. Also 1000 collider meshes for player physics / torch raycasts every frame.
5. **Single unified ground collider plane.** User confirmed this — snow is always a single Y elevation (no ramps ever in Cryocene). One giant collider plane replaces 1000 per-tile colliders.

---

## 4. The rewrite decision

The prior session's recommendation: **do a paint layer rewrite rather than incremental patches.** Rationale:

- The current `paint.ts` is 1,449 lines built around Flagtag's competitive tile-painting model. Cryocene remixed it into a melt-and-regrow system without removing the underlying tile-visual abstraction. Every bug root cause traces back to this mismatch.
- Nine planned incremental fixes collapse into the rewrite for free (tile GLB removal, team palette retirement, MaterialInfo audit, melt-based LOD, snow chunk normalization).
- Estimated 1–2 weeks incremental vs. 1 focused session for the rewrite. Similar total hours, but rewrite eliminates architectural debt permanently.
- Fits the GDD Phase 1 (Systems) window — perf disciplines are explicitly Phase 1 constraints.

**User accepted, wants to attempt tonight, playtest next week.**

---

## 5. Locked design decisions for the rewrite

Six questions were posed. All five that matter are locked (question 6 was moot because scatter.ts is dead code):

| # | Decision | Locked value | Rationale |
|---|---|---|---|
| 1 | Cell resolution | **1m × 1m** (current) | User preferred to keep current melt granularity |
| 2 | Coarse-LOD block size | **16m × 16m** | Matches cliff snap grid — LOD blocks fit exactly between cliffs. 256 cells per LOD block |
| 3 | Regrowth model | **4-stage** (current: 0/1/2/3) | Preserve current game feel |
| 4 | Playfield shape | **Flat rectangle inside cliffs** — no maze corridors | Maze concept retired. Cliff-aware mask still required so snow (both LOD blocks and fine cubes) never spawns under a cliff footprint |
| 5 | Ground plane color | **Same blue as current melt paint** (`#6A99FC`) | Ground plane may intersect cliff geometry (fine); cliffs are opaque so nobody sees the plane underneath them |

**Also cut in the rewrite:**
- `scatter.ts` — dead code, delete it
- Maze generator (`src/shared/maze/`) — no longer needed. Keep only the cliff-cutout logic as a small pure helper (~50 lines).
- Per-tile far-plane LOD proxies (replaced by the single ground plane).
- Team-based palette (`src/shared/palette.ts` — collapse to `0=snow, 1=melted-stage-0, 2=melted-stage-1, 3=melted-stage-2` or similar. Team enum retired.)
- `src/client/paintResync.ts` — the 20s safety-net resync becomes unnecessary if the new architecture doesn't have the same drift class. Re-evaluate after basic path works.

---

## 6. New architecture (target)

### Server side (KEEP CRDT batching — it's a hard DCL constraint)

- **PaintTile CRDT stays.** Each tile-entity packs cell state (palette index + regrowth stage per cell) into one networked component. Batching cells into 16×16 tile chunks gives ~900 network IDs vs. 230,400 — this is a *network sync partition*, not a visual/gameplay concept. The client will not see or care about tile boundaries.
- **Server melt/regrow authority unchanged in principle.** Torch raycasts hit server → server updates cell state → server writes to PaintTile CRDT → all clients receive diffs.
- **Server paint tick** (currently 5s batch) — worth revisiting cadence, but not tonight. Keep behavior; tune later.

### Client side (complete rewrite)

**Entities:**
1. **1 ground plane** (visual + collider) covering the full playfield at Y=0. Color `#6A99FC`. Doubles as physics collider — no per-tile colliders anywhere.
2. **Coarse-LOD snow blocks:** 16m × 16m entities using `MeshRenderer.setBox`, one per playfield cell-block that is fully unmelted. Spawned procedurally at boot based on the cliff-aware mask.
3. **Fine snow cubes:** 1m × 1m entities using `MeshRenderer.setBox`, one per cell where any melt activity has happened. Spawned lazily on demand.
4. **Perimeter cliffs:** unchanged — keep the existing `tile-cliff-*.glb` system in `src/client/perimeter.ts`.
5. **Everything else** (fires, wood, torches, players, UI): unchanged, doesn't touch paint layer.

**LOD swap logic:**
- **Unmelted world state:** each 16m block = 1 coarse LOD cube covering 256 cells. Total ~900 coarse cubes for the whole world (matches current tile count, but no GLBs).
- **First melt in a block:** despawn the coarse cube, spawn 256 fine 1m cubes to represent that block at cell resolution. Melted cells get their stage-appropriate cube (or no cube at stage 0). Cells still unmelted in that block get a fine cube each.
- **Fully re-buried block:** collapse back to 1 coarse cube.

This is the "melt-based LOD" pattern — most of the map stays coarse at rest; fine cubes only exist where players are actively touching.

**Cliff-aware playfield mask:**
- A pure helper (`src/shared/playfieldMask.ts`?) that walks `computeAllCliffPlacements()` from `perimeter.ts` and marks which 16m blocks (and by extension which 1m cells) are covered by cliff footprints.
- Neither coarse LOD cubes nor fine cubes are spawned on masked cells.
- Ground plane doesn't care about the mask — it's fine for the plane to run under cliffs.

### Data flow

1. **Boot:** ground plane spawned. Cliff placements resolved. Cliff-aware mask built. Coarse LOD cubes spawned for all unmasked 16m blocks. Server sends initial PaintTile hydration. Client applies any pre-melted state (spawns fine cubes where needed, despawns coarse cubes for those blocks). Splash gate holds until this is quiescent.
2. **Runtime melt:** torch → server melt request → server updates cell state + CRDT → client receives PaintTile diff → for each changed cell: if it's the first melt in an unmelted coarse block, swap coarse→fine for that block; then apply the specific cell change (spawn/despawn/retween fine cube).
3. **Runtime regrow:** server ticks stage 3 → PALETTE_NONE, client despawns fine cube. If all 256 cells in a block are back to unmelted, collapse block back to coarse cube.

---

## 7. Implementation plan (from prior session, ~4-5 focused hours)

Executed in this order, committing at each checkpoint:

1. **Design doc** (~15 min): `design/paint-rewrite.md` — expand section 6 above into an implementer-facing spec, add CRDT schema + component layout + coord math.
2. **`src/shared/paintGridV2.ts`** (~30 min): cell math, coarse-block math, coord conversions. Pure functions, no ECS, testable.
3. **`src/shared/playfieldMask.ts`** (~20 min): cliff-cutout helper. Consumes `computeAllCliffPlacements` output; produces `isCellMasked(cx, cz)` and `isBlockMasked(bx, bz)`.
4. **`src/server/paintStateV2.ts`** (~45 min): server melt/regrow authority + PaintTile CRDT writes. Keep tile-batching-for-network trick, drop everything else.
5. **`src/client/paintV2.ts`** (~1.5 hr): ground plane, coarse cube pool, fine cube pool, melt event subscription, LOD swap.
6. **Wire it up in `src/client/index.ts` and `src/server/server.ts`.** Cut old paint imports. Delete `scatter.ts`. Retire `paintResync.ts` (rename to `.deprecated.ts` first, don't delete yet — may need reference).
7. **Boot test → single-player melt test → commit.**

**Realistic checkpoints:**
- **Tonight:** compiles, boots, 1 player can melt, cubes appear/disappear, server sync works. That's the "working draft" bar.
- **Tomorrow:** feels right for 1 player, LOD swap works cleanly, hearth/torch/wood integration verified, mobile smoke test.
- **Next week (before playtest):** 3–5 person internal test, edge cases hardened (regrowth thrash, resync-on-join, fire-protected cells).

---

## 8. Files that will change

**New files:**
- `design/paint-rewrite.md`
- `src/shared/paintGridV2.ts`
- `src/shared/playfieldMask.ts`
- `src/server/paintStateV2.ts`
- `src/client/paintV2.ts`

**Deleted/renamed:**
- `src/client/scatter.ts` — delete (dead code)
- `src/client/paint.ts` — delete after V2 is wired
- `src/client/paintResync.ts` — likely delete
- `src/client/paintStreaming.ts` — likely delete
- `src/server/paintState.ts` — delete after V2 is wired
- `src/shared/paintGrid.ts` — replaced by V2
- `src/shared/paintSync.ts` — replaced or heavily trimmed
- `src/shared/maze/` — most of this folder can go; keep only the cliff-cutout function if used

**Modified:**
- `src/client/index.ts` — swap paint imports
- `src/server/server.ts` — swap paint imports
- `src/shared/palette.ts` — collapse team-based palette to melt-stage palette
- `src/shared/team.ts` — likely retire entirely
- Any file that imports the old paint API (torch, hearthFuel, hiddenCampfire, brush) — audit and update to V2 API

**Untouched:**
- `src/client/perimeter.ts` — cliff GLBs stay
- `src/client/campfire.ts`, `hearthFuel.ts`, `torch.ts`, `wood.ts`, `logs.ts`, etc. — gameplay layer above paint
- `scene.json`, `package.json`, build tooling

---

## 9. Things the new session should know

- **AGENTS.md style guide** at repo root defines coding conventions (tabs, `MARK:` comments, absolute imports from `src/`, no defensive silent failures, etc.). Follow it.
- **User is a designer, not a programmer** — explain choices in plain language, be direct with recommendations. User has been steering conversations well but relies on the AI for engineering judgment calls.
- **AGENTS.md pacing rule:** "Do exactly what the user asks — one focused change per response. Don't pile on extras." But for this rewrite the user has explicitly authorized a large multi-file change in one session.
- **Preview server:** OpenDCL has `/preview` and `/screenshot` commands. Screenshot tool auto-navigates on first call (~15s), then instant. Use screenshots to verify visual state after major changes.
- **v1 timeline (from GDD):** 5-week Reach vs. Core split. This rewrite is Phase 1 (Systems) work. Playtest next week. Full v1 submit target 2026-10-27.
- **Bug 4 (off-color white snow) is expected to resolve on its own in the rewrite** — don't chase it separately.

---

## 10. Open questions the new session may need to ask

- **Server paint-tick cadence** (currently 5s) — leave as-is or tune? Recommend leaving; separate optimization.
- **Fine cube spawn budget per frame** — start with 300/frame (dcl-place invariant) and tune down for mobile if needed.
- **Coarse→fine swap timing** — atomic (despawn coarse, spawn fines same frame) risks visible pop. Overlapping (spawn fines, wait N frames, despawn coarse) risks z-fight. Recommend atomic first, add 1-frame overlap only if visible flicker on mobile. See paint.ts:497-511 for prior notes on this exact problem.
- **`hearthFuel` "protected cells" mechanic** — fires currently keep nearby cells melted permanently. Must be preserved in V2. Server-side logic in `paintState.ts:protectedCells`.

---

## 11. Fallback plan

If the rewrite proves too big for one night:

- **Minimum viable ship for playtest next week:** just kill the tile GLBs (replace with single ground plane) and retire the team palette (Bug 3). These are the two highest-impact incremental changes. Would take 1-2 hours vs. 4-5 for the full rewrite. Preserves the current paint system otherwise; melt-based LOD refactor slips to a later session.
- **Nuclear revert:** `git reset --hard pre-paint-rewrite`. Ship the incremental fixes (from section 12) directly on main-branch base.

## 12. The original 9-item incremental plan (fallback reference)

If the rewrite is abandoned, this is the ordered list of smaller fixes to ship:

1. Global 300/frame allocation budget shared across all spawn sources
2. Splash gate on real hydration state, not timers
3. Kill tile GLBs → single ground plane (biggest single load-time win — do first even in incremental mode)
4. Retire team palette (Bug 3)
5. Audit `Material.setPbrMaterial` calls for shared MaterialInfo objects
6. Melt-based LOD refactor (hardest incrementally because paint.ts is tightly coupled to tiles)
7. Resync backoff / sticky-settle latch
8. Client-side optimistic paint (Bug 2 fix)
9. Snow chunk material normalization (Bug 4 — may resolve on its own)

Items 3, 4, 5, 6 are the ones that overlap most with the full rewrite. If any of them ship first, the rewrite gets easier.

---

*End of handoff. Good luck.*
