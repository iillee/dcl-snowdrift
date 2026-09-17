# Phase Clock — design draft

**Status:** draft, not yet implemented
**Branch:** `daynight-cycle`
**Related:** `docs/v1-4week-plan.md`, `docs/gameloop-vision.md`, `docs/survival-pivot-plan.md`
**Supersedes:** the client-only `src/client/skybox.ts` wall-clock triangle

---

## Purpose

Snow Drift needs one authoritative "what phase of the day is it, and how far through are we" signal that:

1. Drives the skybox time-of-day (goal 1: locked, identical across players).
2. Drives gameplay effects that must vary by phase (fuel drain rate, cold accel, spawn tables, ember relight grace, weather intensity, solstice event).
3. Is independently tunable per phase (goal 2: day length and night length adjust separately, plus dawn/dusk transitions).
4. Is authoritative on the server so all clients agree, and reset-safe on world rollovers.
5. Is legible to the player through the existing HUD (clock button + cycle popover already exist).

The current `src/client/skybox.ts` is a *decorative* client-side wall-clock triangle wave. It satisfies none of the above beyond #1 (visually), and even #1 is not truly cross-client-authoritative (each client computes from its own clock). This design replaces it.

---

## Phases

Each in-game "day" is a sequence of named phases. Base sequence:

| Phase   | Skybox range       | Default duration (real sec) | Gameplay intent |
|---------|--------------------|-----------------------------|-----------------|
| DAWN    | 05:00 -> 07:00     | 30                          | Fuel drain relaxes, snowfall thins |
| DAY     | 07:00 -> 17:00     | 240                         | Warmth easy, exploration window |
| DUSK    | 17:00 -> 19:00     | 30                          | Cold begins to bite, players return to fire |
| NIGHT   | 19:00 -> 05:00     | 180                         | Fuel drain peak, cold hard, huddle |

Total base cycle: 480s = 8 min real. Matches current baseline.

Each phase carries:
```
{
  name         : 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT'
  durationSec  : real seconds this phase lasts
  fixedTimeFrom: 0..86400 skybox seconds at phase start
  fixedTimeTo  : 0..86400 skybox seconds at phase end (may wrap for NIGHT)
}
```

Phase table is a `PhaseConfig[]` — pure data, adjustable at any point.

---

## Seasons

The phase table is not fixed forever. The survival design calls for seasonal drift:

| Season         | Day dur | Night dur | Notes |
|----------------|---------|-----------|-------|
| AUTUMN         | 300     | 60        | Nights are a rumor |
| EARLY_WINTER   | 240     | 180       | Baseline |
| DEEP_WINTER    | 180     | 300       | Nights hurt |
| SOLSTICE       | 60      | 600       | The longest night. Climax event. |
| THAW           | 240     | 120       | Recovery after solstice survived |
| SPRING         | 300     | 60        | Same shape as autumn, different lighting |

The seasonal cycle is a higher-level clock (days -> seasons -> years) that swaps the active `PhaseConfig[]`. Season transitions can happen at DAWN of a new in-game day so players never see the switch mid-phase.

This design just wires the *phase* layer. Seasonal switching is a follow-up milestone; the phase clock exposes the hook.

---

## Authority and sync

**Server owns the clock.** Client computes nothing from local time.

- Server keeps `phaseStartedAtMs` (wall-clock ms) and `activePhaseIndex`.
- Server ticks: each engine tick, check `Date.now() - phaseStartedAtMs >= currentPhase.durationSec * 1000`. If so, advance to next phase, wrap the array, broadcast.
- Server broadcasts on:
  - Every phase transition.
  - Every new player join (targeted, not broadcast).
  - Once per ~15 sec heartbeat (drift resync guard; cheap message).

**Client subscribes** to `phaseState`:
```
{
  phaseName         : string
  phaseIndex        : number
  phaseStartedAtMs  : number   // server wall-clock ms
  phaseDurationSec  : number
  fixedTimeFrom     : number
  fixedTimeTo       : number
  cycleId           : number   // increments each full loop; for HUD, achievements
}
```

Given phaseState + client `Date.now()`:
- Elapsed in phase = `(Date.now() - phaseStartedAtMs) / 1000`, clamped `[0, durationSec]`.
- t01 = `elapsedSec / durationSec`.
- Skybox `fixedTime` = interpolated from `fixedTimeFrom` to `fixedTimeTo` by t01 (with modular wrap for NIGHT).

Client clock skew: same drift model as `cycleState` today (max ~1 sec, cosmetic).

---

## Skybox integration

`src/client/skybox.ts` becomes phase-driven, not wall-clock-driven:

```
function currentSkyboxSeconds(): number {
  const p = getCurrentPhase()          // from phase client module
  if (!p) return fallbackFixedTime     // pre-first-message fallback
  const elapsed = (Date.now() - p.phaseStartedAtMs) / 1000
  const t01     = clamp01(elapsed / p.phaseDurationSec)
  return lerpModular(p.fixedTimeFrom, p.fixedTimeTo, t01)
}
```

Everything else in `skybox.ts` (write throttle, transitionMode picking, componentWrite) stays as-is. This module keeps its single responsibility: turn a target `fixedTime` into engine SkyboxTime writes cleanly.

---

## Gameplay integration

Consumers subscribe to phase changes via a light event API:

```
onPhaseEnter((phase) => { ... })
onPhaseExit ((phase) => { ... })
getCurrentPhase(): PhaseState
getPhaseT01(): number    // 0..1 through current phase
```

Initial wiring targets (in priority order):

1. **Fuel drain multiplier** — `server/hearthFuel.ts` multiplies drain rate by a per-phase factor. NIGHT drains ~2x, DAY drains ~0.5x, DUSK/DAWN 1x.
2. **Cold acceleration** — `client/torchWarmth.ts` reads phase and scales cold rate. NIGHT hurts.
3. **Snowfall intensity** — `server/weather.ts` phases weather with phase.
4. **Ember relight grace** — 60s at DAY, 30s at NIGHT (raising stakes at night).
5. **HUD readouts** — `layer.cyclePanel.tsx` (already exists) shows phase name + countdown to next.

Each of these is a follow-up task; the phase clock is the enabler.

---

## HUD

The existing clock button + `layer.cyclePanel.tsx` shows the 24 h *world rebuild* clock. Reuse it (or clone the pattern) to also show:

- Current phase name.
- Countdown to next phase.
- Optional: small icon showing the current phase symbol (sun / half sun / moon / half moon).

Full seasonal UI is deferred to season milestone.

---

## Reset behavior

- On world rollover (`server/cycle.ts`), reset the phase clock to phase 0 (DAWN) with a fresh `phaseStartedAtMs = Date.now()`. Broadcast phaseState. This synchronizes phase changes with world rebuilds and keeps solstice as a well-defined event tied to a cycle boundary in the future.
- On server restart, phase state is lost. Restart resumes at DAWN. Acceptable for v1.

---

## Testing

The existing skybox-debug overlay (`layer.skyboxDebug.tsx`) is the primary test surface. Extend it with:

- `PHASE` — current phase name.
- `PHASE t01` — 0.00..1.00 progress.
- `PHASE_ELAPSED` — sec elapsed / sec total.
- `PHASE_STARTED` — ms since epoch, for cross-client alignment.

Two-browser test: both browsers should show identical phase name, elapsed within 1 sec, identical `PHASE_STARTED` value (delta from server clock).

---

## File plan

```
src/shared/phase.ts          NEW  PhaseConfig type, base phase table,
                                  helper lerpModular, clamp01
src/shared/messages.ts       edit add phaseState message type
src/server/phase.ts          NEW  server tick loop, transition
                                  detection, broadcast, cycle hook
src/server/hearthFuel.ts     edit read phase for drain multiplier
                                  (follow-up, not in initial PR)
src/client/phase.ts          NEW  client subscriber, getCurrentPhase,
                                  getPhaseT01, event callbacks
src/client/skybox.ts         edit currentSkyboxSeconds reads phase
src/client/ui/layers/
  layer.skyboxDebug.tsx      edit add PHASE / PHASE t01 rows
  layer.cyclePanel.tsx       edit add current-phase readout
docs/phase-clock-design.md   THIS
```

Estimated implementation: ~half a day for the clock + skybox rewire + debug rows. Gameplay consumers (fuel, cold, weather) are separate follow-up tasks that each take an hour.

---

## Open questions to resolve before implementing

1. **Phase durations at server start** — should the server start mid-cycle for realism ("scene has been running") or always at DAWN for legibility? Recommendation: always DAWN. Judges and returning players get a predictable first-impression phase.
2. **How does this interact with the existing 24 h rebuild cycle in `server/cycle.ts`?** They're orthogonal — cycle is 24 real hours (rebuild), phase is 8 min real (day/night). Both broadcast independently. Consider whether the 24 h cycle should be renamed to "rebuild clock" to disambiguate.
3. **Do we ever pause the phase clock?** Solstice event might want a "hold at deepest night" moment. Deferred; keep clock monotonic for now.
4. **Should phase carry weather config directly, or should weather subscribe and choose its own?** Recommendation: weather subscribes. Keeps phase data pure.
5. **Do we broadcast phaseState on player join before or after cycleState?** Recommendation: same message batch, order doesn't matter since they're independent.
