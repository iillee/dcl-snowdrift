# Pilgrimage Camp — Rolling Workplan

**Feature branch:** `feat/pilgrimage-camp`
**Owner:** ile (solo)
**Started:** 2026-08-27
**Related docs:** `docs/PLAN.md` §Pilgrimage, `docs/gameloop-vision.md`

---

## How to use this doc

This is a **rolling, session-handoff workplan**, not a spec. It is designed so a fresh Claude session (or a fresh ile at 2am) can pick up in <5 minutes with a small context budget.

Every session:

1. **Read top-to-bottom until the end of "Current state"** — that plus the phase checklist is enough to start work.
2. **Do the work.** Reference deeper sections only when a specific phase or decision needs it.
3. **Before ending:** update "Current state", tick / untick boxes in the Phase checklist, and prepend a new entry to the Session log with what changed, why, and what the next session should pick up.

Keep session-log entries short. Anything reusable (a recipe, a gotcha, a tuning value) gets promoted into "Reference & decisions" so it survives log rotation.

**Log rotation:** when the Session log passes ~10 entries, move the oldest to `docs/archive/pilgrimage-camp-log-YYYY-MM.md` and leave a single-line pointer here.

---

## Current state

*Last updated: 2026-08-27 (session with claude/opendcl)*

**On disk (feat/pilgrimage-camp, clean typecheck):**
- Central hearth at world centre — always lit, always visible, smoke plume.
- Hidden campfires: unchanged behaviour, **beacons temporarily ON** (`BEACON_ENABLED = true` in `src/client/hiddenCampfire.ts`) for waypoint-distance eyeballing. **Flip back to `false` before deploy.**
- Pilgrimage camp: spawns at deterministic per-cycle-seed position, fixed 120 m from centre, angle snapped to 16 compass points. Hearth GLB + audio + roaring-hearth smoke. Rebuilds on midnight-UTC rollover.
- Dev reroll button visible (`SHOW_DEV_ROLL_BUTTON = true`) and now produces genuinely new seeds every click (fixed this session — see log entry 2026-08-27).

**Not on disk yet:**
- P2: tall vertical beacon that punches through fog (next big de-risking step).
- P3–P7: tents, lanterns, arrival detection, snowshoes, sign, return teleport.

**Blockers / open questions:** none active. See "Open questions" section for parked items.

**Next session, start here:** Phase P2 — vertical fog-piercing beacon at the camp. Goal is *"can I see the camp from spawn, through fog, without a minimap?"*. De-risks the whole pilgrimage concept; if the beacon can't cut fog convincingly, we rethink the whole navigation model before building tents/lanterns.

---

## Phase checklist

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` cut / deferred

### P0 — Foundations
- [x] Deterministic per-cycle-seed camp position (`src/shared/camp.ts`)
- [x] Camp spawner + midnight rebuild (`src/client/camp.ts`)
- [x] Dev reroll produces genuinely new seeds (server-side offset fix)

### P1 — Central hearth presence
- [x] Always-lit hearth at centre, no fuel decay
- [x] Smoke plume (roaring-hearth preset)
- [ ] Audio balance pass vs ambient wind (defer until P2 done)

### P2 — Fog-piercing beacon *(next)*
- [ ] Vertical beacon geometry at camp (test: visible from spawn through fog)
- [ ] Beacon at central hearth? — **decide during P2**, don't pre-build
- [ ] Tune beacon height / colour / animation so it reads as "go here" not "decoration"
- [ ] Remove temporary `BEACON_ENABLED = true` on hidden campfires once vertical beacon is validated

### P3 — Arrival & camp readability
- [ ] Tents (2–3, arranged around hearth)
- [ ] Lanterns for close-range guidance
- [ ] Arrival detection (player enters camp radius → event)

### P4 — Return
- [ ] Sign at camp with return-to-centre hint
- [ ] Return teleport / warmth boost

### P5 — Traversal aid
- [ ] Snowshoes pickup (or equivalent — decide vs. movement-speed buff)

### P6 — Polish
- [ ] Camp ambience audio
- [ ] Smoke tuning for distance readability

### P7 — Cut / deferred
- (populate as we cut things)

---

## Reference & decisions

Living section. Promote anything reusable out of session logs into here.

### Camp placement algorithm
- Radius: **120 m** from central hearth. Chosen as "far enough that fog obscures it from spawn, close enough that a walk feels like a walk, not a hike."
- Angle: snapped to 16 compass points so bearings are legible ("north-northwest today"). Prevents ugly "37.4°" positions and makes camps feel authored.
- Derived from cycle seed → mirrors `src/shared/hiddenCampfire.ts` pattern. Same seed on all clients → deterministic across the multiplayer session.

### Cycle seed & dev rollover (fixed 2026-08-27)
- `getHiddenCampfireSeed()` returns the UTC-day bucket. Manual/dev rerolls used to re-sample this, producing the same value mid-day → client short-circuited.
- Fix: `rollCycle(force = true)` bumps a module-scoped `devRollOffset` before deriving the seed, so forced rolls are guaranteed distinct. Timed midnight rolls still work and preserve prior offsets until process restart.
- Known minor caveat: client still bumps its local seed by +1 in parallel with the server. Fine as long as no one presses the button twice before the server broadcasts. If it becomes annoying, drop `forceLocalCycleRoll()` and rely on the server round-trip.

### Dev flags currently ON (must flip before deploy)
- `SHOW_DEV_ROLL_BUTTON = true` (`src/client/devFlags.ts`)
- `BEACON_ENABLED = true` on hidden campfires (`src/client/hiddenCampfire.ts`) — temporary for P2 tuning

### Design guardrails
- **No beacon on the central hearth *or* the camp until P2 is validated.** Smoke carries them for now. This is the whole point of the P2 de-risking step: prove fog + smoke isn't enough before adding beacons everywhere.
- Central hearth = always lit. Never gate on fuel. It is the sun of this world.

---

## Open questions (parked)

- Should the camp rotate its inventory / offerings between cycles, or is position-only variety enough?
- Does the return teleport (P4) undermine the walk-back tension? Alt: return teleport only if you're carrying camp-loot.
- If the fog beacon works, do the hidden campfires need beacons long-term or just smoke?

---

## Session log

*Newest first. Keep entries ≤ ~15 lines. Promote durable content into "Reference & decisions".*

### 2026-08-27 — claude/opendcl + ile

**Shipped:**
- `src/shared/camp.ts`, `src/client/camp.ts` — deterministic camp spawn, midnight rebuild.
- Wired `setupCamp()` in `src/client/index.ts`.
- Temporary: `SHOW_DEV_ROLL_BUTTON = true`, hidden-campfire `BEACON_ENABLED = true`.
- **Fixed dev-reroll no-op bug** in `src/server/cycle.ts`: `rollCycle(force)` + `devRollOffset`. Timed and forced rolls now converge on a consistent seed. Both symptoms (nothing changes on reroll; beacons ≠ pits) resolved by the same root cause.

**Not done, per plan:**
- P2 vertical beacon.
- Everything P3+.

**Hand-off to next session:**
- Start P2. Success criterion: standing at spawn, camera facing camp bearing, you can see *something* through fog that reads as "there is a place over there." Don't build tents until this is convincing.
- Before deploying anything: flip `SHOW_DEV_ROLL_BUTTON` and `BEACON_ENABLED` back to `false`.
