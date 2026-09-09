# Snow Drift — Survival Pivot Plan

**Author:** opendcl session with ile, 2026-09-09
**Status:** design + implementation plan, pre-code
**Context:** Snow Drift is being repurposed from the cozy multiplayer hangout described in `docs/gameloop-vision.md` into a harsher, quota-driven survival experience for a **Creator Success Program** submission (not the game jam). The cozy vision doc is now superseded by this one.

---

## 1. New design in one paragraph

*Snow Drift is a shared-world winter survival game with a wood quota loop. Each in-game day, players gather wood and bank it at the central hearth to survive the coming night. Nights get progressively colder and longer as the winter equinox approaches. The equinox is a boss-storm event — the hardest night to survive. Two equinoxes fire every real 24 hours (roughly 12 h apart), giving two scheduled "everyone log in" moments per day. If a group survives an equinox, the game enters a grace period, then ramps back up toward the next one. If the central fire ever goes out with nobody tending it, the run resets from scratch. Solo is possible; multiplayer is better — quota scales with roster size.*

---

## 2. Design goals & pillars

- **Frantic > cozy.** Snow depth, melt mechanics, and cold pressure are tuned for tension, not vibes.
- **Multiplayer-first, solo-viable.** Quota scales with roster; solo is barely-survivable, groups thrive.
- **Two nested loops.**
  - **Micro (per day, minutes):** gather wood → bank at hearth → survive the night.
  - **Macro (per ~12h real-time):** days escalate toward equinox → equinox event → grace period → repeat.
- **Failure is meaningful but not brick-the-session.** Death respawns you; but if the *hearth* dies with the server empty, the run resets.
- **Scheduled retention beat.** Two equinoxes per real 24 h. Players know when to log in.
- **Server-authoritative persistence.** Stockpile + hearth persist across sessions as long as someone (or the fire) is still there.

---

## 3. Open design questions (not blocking; resolve during build)

1. **Quota scaling formula.** Linear? Sub-linear? Starting guess: `required = ceil(N * 3 * (1 + 0.5 * dayNumber))`.
2. **Day/night duration.** Starting guess: 5 min day / 3 min night. Iterate via playtest.
3. **Fire "floor" model.** Two options:
   - Hard 0 — fire out = run reset immediately (if no one tending).
   - "Sleeping ember" state — fire visually out, can be relit for ~60 s before reset. Playtest-kind.
   Leaning toward ember.
4. **Empty-server grace period.** How long can the server sit empty before the run resets? 5 min? Instant on fire-death only?
5. **Failure carry-over.** Does anything persist across a reset? Day-count high score? Best equinox survived? Nothing?
6. **Equinox warning window.** How much lead-time before the storm hits (siren, sky change)? 2 min? 5?
7. **Grace period length.** After surviving an equinox, how many easy days before the ramp restarts?
8. **Hidden campfires.** Cut, keep as warmth waypoints for wood runs, or repurpose? (Deferred.)
9. **Scene size.** 32×32 parcels may be too big for a survival arena. Revisit if wood-run pacing is off.
10. **Torch chain / warmth aura.** Keep — reads well as co-op survival. No changes planned.

---

## 4. What we keep, mutate, or cut

### Keep (already fit the new design)

| System | Why it fits |
|---|---|
| `client/frost/` (accumulation, death FSM, flash) | Freeze-death is the survival stakes. Death FSM already handles emote + fade + respawn. |
| `client/torch.ts`, `torchChain.ts`, `torchWarmth.ts`, `torchEquip.ts` | Torch loop + chain-lighting + warmth aura all read as co-op survival. |
| `server/wood.ts`, `server/logs.ts`, `client/wood.ts`, `client/logs.ts` | This IS the resource loop. Wood banked at hearth becomes the quota. |
| `client/snowfall.ts`, `snowfallAudio.ts`, `snowFootsteps.ts` | Atmosphere. Weather intensity now driven by phase. |
| Paint sync CRDT infrastructure (`shared/paintSync.ts`, `paintGrid.ts`) | Solid, don't rebuild. Mobile-race bug still needs Option B fix (`docs/handoff-paint-sync-mobile.md`) — orthogonal to pivot. |

### Mutate (repurpose, don't rewrite)

| System | Change |
|---|---|
| `server/cycle.ts` | Repurpose from "24 h cozy reroll" to authoritative day/night/equinox phase clock. Keep the `onCycleRoll` subscriber pattern — becomes `onPhaseChange`. |
| `server/hearthFuel.ts` + `shared/hearthFuel.ts` | Drop or gate `FUEL_MAIN_FLOOR`. Fire must be able to die. Add phase-driven decay multiplier so night drains faster than day, equinox drains hardest. |
| `server/weather.ts` | Stop being random. Bind weather to phase: DAY = LIGHT, NIGHT = MEDIUM, EQUINOX = HEAVY (whiteout). Keep the `weatherRequest` handler dev-flagged. |
| `shared/frost/tuning.ts` | Add phase-driven cold multiplier. Baseline freeze time shortens at night, shortens further during equinox. |
| Snow depth & melt tuning (`paint.ts` regrowth cadence + `FROST_TIME_SNOW_STAGE_S`) | Tune harsher. Deep snow should be a real threat at night, near-lethal during equinox. Regrowth accelerates when the sun's down. |
| `client/ui/layers/layer.frostBar.tsx` | Add a "Night in X:XX" pill and a wood-quota bar alongside the existing frost meter. |

### Cut or defer

| System | Rationale |
|---|---|
| Cozy 24 h reroll behavior (world seed regen, splash, teleport) | Replaced by the new phase loop. Splash/teleport UX can be reused for equinox arrival. |
| `client/ui/layers/layer.loadingSplash.tsx` (rebuild-triggered path) | Repurpose for equinox onset instead of world reroll. |
| Hidden campfires (`server/hiddenCampfire.ts`, `client/hiddenCampfire.ts`) | Deferred. Not in the way of pivot; will decide keep-vs-cut once the base loop is in. |
| Torch island quest (from cozy vision doc §3) | Cut. Onboarding is now "the fire is dying, get wood." |
| Named fires + community hearth log (cozy vision §12.3.1) | Deferred. Nice to have, not core. |

---

## 5. New authoritative model (target shape)

```
server/phase.ts           NEW — replaces the reroll half of cycle.ts
  ├─ dayNumber                     // increments each dawn
  ├─ phase: 'DAY' | 'DUSK' | 'NIGHT' | 'EQUINOX_WARN' | 'EQUINOX' | 'GRACE'
  ├─ phaseStartedAt / phaseDurationS
  ├─ coldMultiplier                // 1.0 baseline; scales with dayNumber, spikes at equinox
  ├─ onPhaseChange subscribers     // weather, hearthFuel, frost tuning, HUD
  └─ evaluateSurvival()            // called at dawn: was the hearth alive all night?

server/quota.ts           NEW
  ├─ woodBanked                    // logs deposited at hearth since last dawn
  ├─ nightQuota(dayNumber, N)      // wood needed to comfortably survive the night
  ├─ onNightStart / onDawn          // reset banked at dawn, snapshot for HUD
  └─ broadcasts quotaState

server/runState.ts        NEW
  ├─ isHearthAlive
  ├─ emptyServerGraceMs
  └─ resetRun(reason)              // clears fuel, wood, banked; broadcasts runReset

shared/messages.ts        EXTEND
  ├─ phaseState  { phase, dayNumber, coldMultiplier, phaseEndsAtMs }
  ├─ quotaState  { banked, required, playerCount }
  └─ runReset    { reason }

client/ui/layers/
  ├─ layer.dayPhase.tsx    NEW    // "Day 3 — Night in 4:12" pill
  ├─ layer.quotaBar.tsx    NEW    // "Wood banked: 12 / 20"
  └─ layer.frostBar.tsx    EDIT   // reads coldMultiplier from phaseState

client/phase.ts           NEW    // receives phaseState, drives skybox + audio + HUD
```

---

## 6. Implementation sequencing

Ordered by leverage (smallest, most reversible first). Do NOT batch — each step gets its own commit + smoke test.

### Step 1 — Cut the fuel floor + add empty-server run reset
- `FUEL_MAIN_FLOOR` gated behind a phase flag, or dropped entirely.
- New `server/runState.ts`: watch roster + hearth fuel; if fire hits 0 AND roster empty for N seconds, `resetRun()`.
- `resetRun()` clears fuel, wood piles, banked wood; broadcasts `runReset`.
- **Effect:** the game becomes a survival game. Nothing else changes yet.
- **Playtest question:** does the hearth dying feel scary or annoying?

### Step 2 — Introduce the phase clock
- Repurpose `server/cycle.ts` → `server/phase.ts`.
- Phases: DAY / DUSK / NIGHT / EQUINOX_WARN / EQUINOX / GRACE.
- Start with dumb values: 5 min day, 1 min dusk, 3 min night. Equinox fires every 12 real hours; grace lasts 2 in-game days after survival.
- Bind weather + skybox + `FROST_TIME_BASELINE_S` to `coldMultiplier`.
- HUD "Night in X:XX" pill.
- **Effect:** world has a rhythm. Cold gets worse at night. Weather stops being random.

### Step 3 — Wood quota bar
- New `server/quota.ts`. Count logs deposited at main hearth since last dawn.
- HUD `layer.quotaBar.tsx` shows banked / required.
- At dusk, snapshot the count. If under quota, night frost tuning gets a further penalty (or hearth decay accelerates).
- **Effect:** players understand "gather wood before dark" without a tutorial.

### Step 4 — Snow / melt tuning pass
- Harsher `FROST_TIME_SNOW_STAGE_S` at night.
- Faster regrowth when phase != DAY.
- Higher max snow stage or steeper stage transitions if playtest shows it's too soft.

### Step 5 — Equinox event
- `EQUINOX_WARN` phase: siren audio, sky darkens, 2 min countdown HUD.
- `EQUINOX` phase: HEAVY weather locked, `coldMultiplier` peaks, night duration doubled.
- Survive it (hearth alive at end) → `GRACE` phase for 1–2 in-game days.
- Failure = `runReset('equinox_failed')`.

### Step 6 — Persistence + polish
- Day count / best equinox survived (if we want any progression).
- Equinox arrival cinematic (reuse loading splash pattern).
- Onboarding: first-30-seconds prompts (torch → wood → hearth).

---

## 7. Known adjacent work (not part of pivot but nearby)

- **Mobile paint sync race** — `docs/handoff-paint-sync-mobile.md`. Option B (deferred-retry) still unbuilt. Mobile is a hard target for CSP. **Fix before playtest of the new loop**, but not before Step 1.
- **Cold-open perf** — `docs/handoff-loadin-reintroduce.md`. Reintroduce the center-out spawn optimization after the pivot stabilizes. Not blocking.
- **`landscapeTerrain: false`** already set; no change needed.

---

## 8. What we are NOT doing

- Not building a leaderboard. Shared-pool survival, not competitive.
- Not adding permadeath. Individual death respawns; only the *run* can end.
- Not adding tools/tiers (axes, upgraded torches) in v1. The one verb is still "gather + burn."
- Not adding NPCs, quests, or dialogue.
- Not designing the trailer / marketing beat until the loop is playable.

---

## 9. Success criteria for the first survival-loop playtest

1. A solo player can survive day 1 comfortably and starts to sweat by day 3.
2. A pair of players can survive further than a solo player, and the reason is legible ("we split up to gather").
3. The first equinox is memorable — either a triumph or a wipe. Both are acceptable outcomes.
4. When the hearth dies with the server empty, the reset feels earned, not arbitrary.
5. Mobile performance holds through a full day/night cycle.

If those five hold, the pivot is working and we push on toward CSP submission polish. If any fail, we tune before adding more mechanics.
