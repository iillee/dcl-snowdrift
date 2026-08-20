## Frost + Torch Handoff #3 (2026-08-20)

Follow-on to `docs/frost-torch-handoff-2.md`. Session continued on the
`frost` branch. Read this alongside `docs/PLAN.md` (v2.11 entry) and
handoffs #1 and #2.


## Branch state

- On `frost`. TypeScript compiles clean: `npx tsc --noEmit`.
- Session was a polish + tuning pass on top of the death sequence
  and HUD unification work from handoff #2. Two additive systems
  landed (torch smoke, stomp/melt paint split); everything else was
  refinement.
- Two commits sit on `frost`:
  - `c646080` — feature commit (all polish + the stomp/melt split).
  - `a2799fd` — cleanup commit (dropped deprecated brush shims etc).
- Session-closing commit adds the mobile fuel-bar fix, unlit-icon
  visibility fix, optimistic-stomp render, spectate-exit on death,
  plus these docs. See "Files touched this session" below.


## What actually got built

### 1. Torch smoke (world-space wisp)

`src/client/torch.ts` gained a small `ParticleSystem` emitter parented
to the same right-hand AvatarAttach anchor as the flame orb. Sized
and coloured to match `campfireSmoke.ts` but proportionally tiny.

Key detail: `simulationSpace: PBParticleSystem_SimulationSpace.PSS_WORLD`.
The emitter rides the hand, but each spawned particle is frozen into
world coordinates at birth. Without this the whole plume whipped
around with wrist animation — with it, the wisp trails naturally
behind the walking torch.

Toggled by `playbackState` in the existing per-frame fuel system:
`PS_PLAYING` when lit, `PS_STOPPED` when not. Booted into `PLAYING`
(then immediately stopped on first tick if unlit) — some SDK builds
ignore a `PS_STOPPED` initial state and never accept a later
`PS_PLAYING` toggle. Same trick `snowfall.ts` uses.


### 2. Snow tuning + prop count

- `src/client/snowfall.ts` — `PROFILES` shifted up one tier. What
  was MEDIUM is now the baseline LIGHT; what was HEAVY is now MEDIUM;
  new HEAVY is a true whiteout tier (rate 2200, lifetime dropped to
  8s to churn more particles through the ~1000-particle engine cap
  per second, size 0.42–0.80, gravity 0.45, speed up to 5.2 m/s).
- Both smoke plumes (`campfireSmoke.ts` + `torch.ts`) lightened to a
  warm mid-grey palette so they don't read as sooty against the
  winter sky. Torch smoke lifetime cut from 2.8 s → 1.8 s so wisps
  dissipate promptly.
- `src/shared/props/catalog.ts` — tree `count` 6 → 3.


### 3. Removed unlit-in-snow speed multiplier

`src/client/locomotion.ts` — deleted `UNLIT_SNOW_SPEED_MULT = 0.65`
and all torch-lit tracking (`currentLit`, `litChanged`, `isTorchLit`
import). Snow speed is now purely a function of stage (0/1/2/3),
identical whether the torch is lit or not. The multiplier felt
redundant once the stomp/melt split (below) landed as the real
"unlit is worse" cost.


### 4. Split relight radius from melt radius

`src/shared/campfire.ts` — added `CAMPFIRE_RELIGHT_RADIUS_M = 3` and
`CAMPFIRE_RELIGHT_RADIUS_SQ_M` as separate exports. Melt radius stays
`CAMPFIRE_MELT_DIAMETER_M / 2 = 8`. Consumers:

- `torchInput.ts` — E-press relight gate uses the tighter 3 m.
- `layer.relightPrompt.tsx` — prompt visibility uses the same 3 m.
- `frost/accumulation.ts` + `server/server.ts` (melt ring) still use
  the 8 m melt radius.

So the "step up to the flames to light your torch" affordance is
tight, but the fire's warmth halo remains generous.


### 5. Top-off + one-line label

`layer.relightPrompt.tsx`:

- Prompt visibility no longer hides when the torch is lit; it hides
  only when `isTorchLit() && getTorchFuelFraction() >= 0.98`. So
  walking back to the fire with a partly-drained torch surfaces the
  tooltip again to invite a top-off press. E-press handler in
  `torchInput.ts` was already unconditional inside the radius, and
  `relightTorch()` already sets fuel to max, so top-off works without
  any input-side changes.
- Label is now always `"Light torch"` (earlier iteration swapped to
  `"Top off torch"` when lit; user rejected — keep it one string).
- The `E` chip is a flex-centred `Label` with a small optical nudge
  (`margin.top: -2, left: 2`) — DCL's `uiText` shorthand anchors from
  the top-left of the cell regardless of `textAlign: 'middle-center'`,
  hence the earlier off-centre look.


### 6. HUD outline unification

- `layer.brushSize.tsx` — torch button `TORCH_BORDER_W` 2 → 4. Kept
  constant (not toggled) per the handoff #2 warning that changing
  `borderWidth` shifts child content by the delta. Border stays
  transparent when unlit (`TORCH_BORDER_OFF = rgba(1,1,1,0.75)` cool
  white) and warm gold (`TORCH_BORDER_ON`) when lit.
- Eye + mute buttons got the same 4 px outline treatment. Eye border
  and eye icon both go gold when spectate is active — the border,
  icon, and existing action all read as one affordance.
- Torch icon swaps to `assets/images/torch_unlit.png` when out. Both
  icons render at full white (unlit tint was `rgb(0.45)` originally,
  which read as near-invisible on the dark panel especially on
  mobile — dropped the dim).
- Fuel colour kept constant warm gold across the whole drain (the
  25 %-threshold amber swap was tried and rejected — height alone
  should communicate fuel).
- `layer.frostBar.tsx` — outer frame gained the same 4 px white
  outline so the whole HUD reads as one visual system.


### 7. Stomp/melt paint split (paintTick extended)

This is the biggest architectural change of the session. Full
walkthrough is in-line in the code, summarised here.

**Motivation.** Previously an unlit torch could still melt snow all
the way to bare ground via the walking brush — just at 1×1
footprint instead of 3×3. User wanted torchless walking to compress
snow to a low crust (stage 1) but never fully melt, and to leave
existing blue melted paths alone.

**Model change.** `paintTick` wire message now carries
`{ ids, targetStage: 0 | 1 }`. Server-side `applyPaint(id, team,
targetStage)`:

- `targetStage=0` → unchanged full-melt behavior.
- `targetStage=1` → only writes if the cell is currently at stage 2
  or `PALETTE_NONE` (pristine, treated as stage 3). Cells at stage
  0 or 1 are skipped. Sets `{index=team, stage=1, paintedAtMs=now}`,
  so regrowth from 1 → 2 measures from the moment of the stomp.

The campfire seed area still calls `applyPaint(id, Team.Blue)` with
the 2-arg form, which defaults to `targetStage=0`.

**Client side.** Two outboxes (`paintOutboxMelt`, `paintOutboxStomp`),
`drainPaintOutbox(max, targetStage)`, per-flush `clientHandler.ts`
sends up to two `paintTick` messages. `enqueuePaintCandidate(id,
targetStage=0)`: stomps have a client-side skip mirroring the server
rule (avoid queuing no-ops).

**Optimistic local render for stomp.** First iteration only enqueued
for the server and waited for CRDT echo — visibly lagged by ~100–
200 ms behind the walking avatar (user caught this in mobile
testing). Fixed by calling `advanceSnowFillStage(id, 1)` locally
(the same rise/drop tween the CRDT observer uses when server
regrowth advances a cell) and patching `cellApplied` to
`{index=team, stage=1}` so subsequent brush passes in the same
frame don't re-fire. Server echo then reconciles as a no-op in the
steady case. Feels identical to the lit-melt path now.

Walking loop in `paint.ts` chooses `brushTargetStage = isTorchLit()
? 0 : 1`.


### 8. Spectate exit on death

`src/client/frost/death.ts` — `enterDying()` now calls
`toggleTopDownCamera()` if `isTopDownActive()` before starting the
sequence. The emote + fade + teleport all read wrong from the
overhead spectator view, and the wake beat wants the avatar filling
the frame.


### 9. Mobile fixes (the trigger for handoff #3)

Two mobile-only issues user hit in testing that landed here before
the branch was opened:

- **Fuel-bar overlap.** `TORCH_FUEL_INSET` was a raw `6`, less than
  the new `TORCH_BORDER_W = 4` plus visual gap. On mobile DCL
  counts absolute insets from the border box, so the fill bled
  onto the border edge. Changed to `TORCH_BORDER_W + 6` (= 10) so
  the inset always sits inside the border on every platform. If we
  ever bump the border width again this stays correct.
- **Unlit torch icon invisible.** The dim-grey tint (`rgb(0.45)`)
  on a dark panel plus a dark unlit-torch PNG left the button
  reading as empty on phone screens. Dropped the dim; icon now
  renders at full white for both lit and unlit — swap between
  `torch.png` and `torch_unlit.png` alone communicates state.

**Not yet addressed** — user flagged and paused for a dedicated
mobile branch:

- Full mobile UI audit (bar placement, touch target sizes, portrait
  viewport constraints).
- On-screen mobile control tuning (the joystick + jump/E/F buttons
  are still stock DCL defaults).
- Anything `TouchScreenControls`-related. See handoff #2's warning
  about mobile-specific quirks and next-session guidance below.


### 10. Cleanup pass (`a2799fd`)

- `topDownCamera.ts` — stopped consuming `IA_PRIMARY` (E) and
  `IA_SECONDARY` (F). E was calling the deprecated `cycleBrushUp()`
  no-op AND competing with `torchInput.ts` for the light-torch key.
  **This was a real bug latent in the code**, not just dead style.
- `brush.ts` — with the last callers gone, deleted DEPRECATED
  `increaseBrush` / `decreaseBrush` / `cycleBrushUp` /
  `cycleBrushDown` + `BRUSH_MIN_CELLS` / `BRUSH_MAX_CELLS` /
  `BRUSH_STEP_CELLS`. Public API is now just `BRUSH_TORCH_LIT`,
  `BRUSH_UNLIT`, and `getBrushCells()`.
- `torch.ts` — dropped unused `Billboard` import and unused
  `fuelTrack` / `fuelFill` module-state vars (never assigned or
  read).
- `layer.brushSize.tsx` — removed `TORCH_FUEL_COLOR_LOW` + `void`
  reference; removed unused `TORCH_ICON_DIM` constant.
- `layer.relightPrompt.tsx` — removed unused `promptLabel()` helper
  and the hidden `BORDER` swatch probe.
- `frost/accumulation.ts` — refreshed stale header comment (torch
  protection isn't a TODO anymore).


## Files touched this session

```
src/client/campfireSmoke.ts                     modified  (lighter grey palette)
src/client/clientHandler.ts                     modified  (drain melt + stomp outboxes separately)
src/client/frost/accumulation.ts                modified  (header comment refresh only)
src/client/frost/death.ts                       modified  (exit spectate on enterDying)
src/client/locomotion.ts                        modified  (removed unlit-snow speed multiplier)
src/client/paint.ts                             modified  (stomp path + optimistic local render)
src/client/snowfall.ts                          modified  (precipitation tier shift-up)
src/client/torch.ts                             modified  (smoke wisp, world-space simulation)
src/client/torchInput.ts                        modified  (relight uses new radius)
src/client/topDownCamera.ts                     modified  (dropped E/F handlers + brush.ts imports)
src/client/brush.ts                             rewritten (dropped deprecated shims)
src/client/ui/layers/layer.brushSize.tsx        modified  (border/outline unification, icon swap, mobile fuel inset)
src/client/ui/layers/layer.frostBar.tsx         modified  (white outline)
src/client/ui/layers/layer.relightPrompt.tsx    modified  (top-off, E-chip centering, cleanup)
src/server/paintState.ts                        modified  (applyPaint targetStage)
src/server/server.ts                            modified  (paintTick handler reads targetStage)
src/shared/campfire.ts                          modified  (relight radius split from melt radius)
src/shared/messages.ts                          modified  (paintTick schema + targetStage)
src/shared/props/catalog.ts                     modified  (tree count 6 → 3)
docs/PLAN.md                                    modified  (v2.11 change log entry)
docs/frost-torch-handoff-3.md                   new       (this file)
```


## Deferred / not yet built

Same set carried from handoff #2, unchanged in this session:

- **Corpse rendering for other players.** `FrostDeath` component
  synced-ready, no client-side visual consumer yet.
- **Contagious warmth** (PLAN pillar B2). Frost still per-player.
- **Wood pickup / feed fire** (PLAN Day 4 core loop). Not started.
- **Melt shader + cube→plane demotion** (PLAN Day 7 perf).
- **Dawn sequence** (PLAN Day 11).
- **Persistence + cairns** (PLAN Day 10).

New this session:

- **Mobile UI overhaul.** Fuel-bar inset and unlit-icon fixes
  landed, but the broader mobile audit + `TouchScreenControls` work
  is deferred to its own branch. This is the reason handoff #3
  exists — user closed the session to open a dedicated mobile
  branch for that work.


## Gotchas that bit us THIS session

- **`simulationSpace: PSS_LOCAL` is the default.** A hand-attached
  smoke emitter without `PSS_WORLD` will drag its entire particle
  cloud around with wrist rotation on every animation frame. Always
  use world-space for trails whose emitter is animated.
- **`ParticleSystem.playbackState: PS_STOPPED` at creation may be
  ignored.** Some SDK builds accept only a later transition FROM a
  played state. Boot into `PS_PLAYING`, then let the first tick of
  your control system stop it if the source isn't "on" yet.
- **Optimistic local paint has two paths.** Full-melt calls
  `applyPaintIndex(id, index, force)`; stage-1 regrowth calls
  `advanceSnowFillStage(id, 1)`. If you add a third target stage
  (e.g. stage 2 stomp for "half-frozen"), it needs its own local
  render call OR you accept the server round-trip lag. Both paths
  also need to patch `cellApplied` and `renderedIndex` so subsequent
  same-frame brush passes correctly no-op.
- **`TORCH_FUEL_INSET` must exceed `TORCH_BORDER_W`.** Otherwise the
  absolute-positioned fuel-fill bleeds onto the border edge on
  mobile. The current relation `TORCH_FUEL_INSET = TORCH_BORDER_W
  + 6` is the safe form — bare-number insets break silently.
- **Any input handler you write on `IA_PRIMARY` (E) or
  `IA_SECONDARY` (F) must acknowledge who else claims the key.**
  E is torch light/relight (`torchInput.ts`). F is currently free.
  See the `topDownCamera.ts` cleanup for what happens when a dead
  handler stays registered.


## Suggested first move for the next session (mobile branch)

1. Read this file + PLAN.md v2.11 entry + handoff #2.
2. Cut a new branch off `frost`: `git checkout -b mobile`.
3. Open the scene in the mobile preview (Explorer or Creator Hub
   mobile emu) and capture a baseline screenshot inventory of every
   HUD state:
   - Frost bar at 0 / 50 / 100 %.
   - Action bar with torch equipped lit / unlit / low-fuel.
   - Spectate on/off.
   - Relight prompt visible.
   - Death fade midway.
4. Load `.agents/skills/advanced-input/SKILL.md` for the current
   `TouchScreenControls` surface and mobile-input notes. Also grep
   `node_modules/@dcl/ecs/dist/components/generated/pb/decentraland/
   sdk/components/touch_screen_controls.gen.d.ts` for the exact
   fields the current SDK build supports (handoff #2 flagged this
   as fast-moving).
5. Likely first concrete tasks (unranked, pick what looks worst in
   the baseline shots):
   - Reposition or resize action bar for portrait viewport.
   - Custom on-screen action button for E (light torch) since
     mobile has no keyboard. Currently only the auto-shown DCL
     action buttons cover it, and their labels don't match the
     game's affordance.
   - Investigate whether the current mobile joystick + jump button
     overlap the torch/eye/mute row (`isMobile()` branches exist
     but haven't been visually audited since the border-width
     change).
   - Frost bar segment sizes (`SEG_SIZE_MB = 20`) — verify against
     portrait width and current outline.
