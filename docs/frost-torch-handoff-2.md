## Frost + Torch Handoff #2 (2026-08-20)

Follow-on to `docs/frost-torch-handoff.md`. Session continued on the
`frost` branch. Read this alongside `docs/PLAN.md` (v2.10 entry below)
and the first handoff.


## Branch state

- On `frost`. TypeScript compiles clean: `npx tsc --noEmit`.
- Session covered: death sequence FSM (was open in handoff #1),
  torch-fuel HUD rebuild, frost-bar rebuild, dev-flag consolidation,
  proximity-only relight, unlit-in-snow speed penalty.


## What actually got built

### 1. Proximity-only relight (removed the click affordance)

`src/client/campfire.ts` — dropped the `pointerEventsSystem.onPointerDown`
hook on the campfire GLB. Relight is now driven ENTIRELY by the E-poll
in `src/client/torchInput.ts`: stand inside `CAMPFIRE_MELT_RADIUS_SQ_M`,
press E, torch relights. No aiming required, no GLB pointer collision
mask needed.

Discoverability replaced by:

- `src/client/ui/layers/layer.relightPrompt.tsx` — bottom-center
  tooltip ("Press E to Relight torch") that appears only when the
  torch is equipped, NOT lit, and the player is inside the fire ring.
  All three gates in `shouldShowPrompt()`. Renders `display: 'none'`
  when hidden — zero cost in the common case.


### 2. Death sequence FSM (step 5 of the original plan)

Built exactly the flow sketched in handoff #1. Files:

- `src/client/frost/death.ts` — 9-phase state machine:
  1. IDLE — polls `getFrostLocal() >= FROST_MAX`
  2. COLLAPSE — fires death emote, locks input, 2s hold
  3. FADE_OUT — 0.6s to opaque black
  4. TELEPORT — first `movePlayerTo(RESPAWN_POS)`
  5. SETTLE — second same-spot teleport (flagtag double-teleport)
  6. CLEAR_MOD — `InputModifier` removed for 0.5s beat
  7. EMOTE — re-lock + re-fire emote + `resetFrostLocal()` +
     `extinguishTorch()`, hold black 1.5s
  8. FADE_IN — 1.0s reveal, player collapsed at fire
  9. WAKE_WAIT — first WASD / jump / E / F input → unlock → IDLE
- `src/client/ui/layers/layer.deathFade.tsx` — full-screen
  ZoneType.FullScreen overlay, `pointerFilter: 'none'`, alpha driven
  by `getDeathFadeOpacity()`. Sits above HUD, below loading splash.
- `setupFrostDeath()` wired into `src/client/index.ts` right after
  `initFrostAccumulation()`.
- Death emote URN: `urn:decentraland:matic:collections-v2:0x7bdc37ff3e8dca2d69f01a3dc34f3ad82e2e1870:0`
  (same one flagtag uses).
- Respawn position: `(CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Y + 0.5,
  CAMPFIRE_WORLD_Z + 3)`.

Two bugs hit + fixed during dev:

- **Torch auto-relight on wake was wrong.** I initially had death.ts
  call `relightTorch()` — user pushed back, "torch should only max out
  when actively lit." Now death.ts calls `extinguishTorch()` on the
  wake beat instead. Player must walk to fire + press E, same as any
  other relight.
- **Frost accumulator held stale 100% value.** Only reset the CRDT
  component initially; the local float in `accumulation.ts` kept
  writing back the old value next tick and re-triggered death. Fixed
  by exporting `resetFrostLocal()` from `accumulation.ts` and calling
  it in the EMOTE phase.
- **FSM read stale synced FrostLevel.** The accumulator debounces
  CRDT writes at a 0.5 epsilon, so the synced value can lag the local
  float and never quite hit 100. Death would never fire. Fixed by
  reading `getFrostLocal()` directly in the IDLE-phase check.

Corpse rendering for OTHER players still deferred — `FrostDeath`
component exists but isn't wired to a client-side visual. Add in a
follow-up when the revive mechanic is spec'd.


### 3. Frost meter rebuilt (segmented Game Boy style)

`src/client/ui/layers/layer.frostBar.tsx` — completely rewritten from
the old warm-gold-pill-with-ice-overlay.

- 10 discrete SQUARE segments (24 px desktop, 20 px mobile), 3 px
  gaps, hard corners with a tiny 2 px radius.
- Warm gold segments on the LEFT, ice-blue segments filling in from
  the RIGHT as frost rises. Every slot is always populated \u2014 the
  bar never reads as "empty," only as "warm vs cold."
- Constant warm colour at every level (earlier iteration tried
  gold\u2192amber\u2192red; user rejected \u2014 "keep the warmth colors the
  same").
- Outer frame + inner frame both use `Color4(0, 0, 0, 0.55)` \u2014 same
  alpha as the action-bar buttons \u2014 with 6 px / 4 px rounded corners
  so the HUD reads as one visual system.
- Moved from `margin.bottom: 120/100` down to `24/16` \u2014 now sits
  flush at the bottom of the screen since the hotbar moved up.


### 4. Punishing baseline frost + speed penalty

- `src/shared/frost/tuning.ts` \u2014 `FROST_TIME_BASELINE_S: 300 \u2192 30`.
  Torchless outdoors freezes you in 30 s. Snow-stage times unchanged.
- `src/client/locomotion.ts` \u2014 unlit torch in snow now multiplies
  the snow-stage walk speed by `UNLIT_SNOW_SPEED_MULT = 0.65`. Stage 0
  (melted) unaffected. Torch state changes hit immediately (no
  hysteresis) since E-press / burnout are discrete.

Combined effect: unlit + deep snow now feels visibly heavy AND
freezes you fast \u2014 the two systems both push you toward the fire.


### 5. Torch fuel cut in half + HUD rebuild

- `TORCH_FUEL_MAX_S: 90 \u2192 45` (`src/client/torchEquip.ts`).
- Torch defaults to UNLIT on load-in AND on respawn (fuel stays full,
  player relights at the fire). Comment in `torchEquip.ts` explains
  the invariant.
- Torch HUD went through three iterations:
  1. Segmented ring around the slot border. User rejected.
  2. Draining beaker column. User rejected \u2014 wanted the flagtag
     desktop charge-fill pattern.
  3. **Final:** bottom-anchored rounded rectangle that DRAINS from
     the top as fuel burns (inverse of flagtag's charge fill which
     grows from empty). Warm gold above 25 % fuel, ember orange
     below \u2014 mirrors flagtag's peak-charge gold flash, but on the
     way down.
- Torch moved OUT of its own bottom-center hotbar layer and INLINE
  with the action bar. Now lives inside `src/client/ui/layers/layer.brushSize.tsx`
  as the `TorchButton` component, right of the mute button. Same
  `BTN_SIZE` (72), same `PANEL_BG`, same `borderRadius.md`. Border
  only appears (warm amber) when lit \u2014 constant 2 px width so the
  inner content area doesn't shift on toggle.
- `hotbarLayer` unregistered from `src/client/ui/index.tsx` but file
  kept in-tree in case we revive a separate hand-slot later.
- E label removed \u2014 relight prompt tooltip already covers the
  affordance.


### 6. Dev-flags module (deploy hygiene)

`src/client/devFlags.ts` \u2014 new central toggle file. Three flags,
all default `false`:

- `SHOW_REROLL_BUTTON` \u2014 the \u21bb maze reroll button in the action bar
- `SHOW_PRECIPITATION_BUTTON` \u2014 the \u2744 weather cycle button
- `SHOW_SERVER_STATS` \u2014 the \u201c#\u201d panel (already hidden by default
  before this session; now its layer isn't even registered when the
  flag is off)

Rule: anything that lets a random visitor nuke shared state, or that
adds noise unrelated to the pitch, goes here. When adding a new dev
feature, name it `SHOW_*` / `ENABLE_*` and add a one-line comment.


### 7. Eye icon + smaller mute glyph

- `src/client/ui/layers/layer.brushSize.tsx` \u2014 replaced the procedural
  `ParcelGridIcon` (4\u00d72 grid of squares) with a textured eye
  (`assets/images/eye.png`, 60\u00d740 px, aspect-matched). Tints white in
  follow-cam, gold in top-down.
- Mute button icon dropped from 44\u00d744 to 34\u00d734, still centered.


## Files touched this session

```
src/client/campfire.ts                          modified  (removed pointer relight)
src/client/frost/accumulation.ts                modified  (resetFrostLocal export)
src/client/frost/death.ts                       new       (9-phase FSM)
src/client/index.ts                             modified  (setupFrostDeath)
src/client/locomotion.ts                        modified  (unlit-in-snow penalty)
src/client/torchEquip.ts                        modified  (fuel 90\u219245, default unlit)
src/client/devFlags.ts                          new       (dev toggle module)
src/client/ui/index.tsx                         modified  (register deathFade + relightPrompt, drop hotbar)
src/client/ui/layers/layer.brushSize.tsx        modified  (TorchButton, EyeIcon, dev-gated buttons)
src/client/ui/layers/layer.frostBar.tsx         rewritten (segmented, rounded, matched alpha)
src/client/ui/layers/layer.hotbar.tsx           modified  (retired; kept in-tree)
src/client/ui/layers/layer.deathFade.tsx        new       (full-screen fade)
src/client/ui/layers/layer.relightPrompt.tsx    new       (proximity tooltip)
src/shared/frost/tuning.ts                      modified  (baseline 300\u219230)
assets/images/eye.png                           new       (view-toggle icon)
assets/images/UI_circle.png                     new       (unused; from flagtag)
assets/images/UI_circle_filled.png              new       (unused; from flagtag)
assets/images/torch_unlit.png                   new       (unused so far)
```


## Deferred / not yet built

- **Corpse rendering for other players.** `FrostDeath` component
  exists (deathT/deathX/deathZ/awake), synced-ready, but no
  client-side visual system consumes it yet. Add when revive is
  spec'd.
- **Contagious warmth** (PLAN pillar B2). Frost is still per-player
  only.
- **Wood pickup / feed fire** (PLAN Day 4 core loop). Torch has a
  fuel timer now but there's no wood item and no feeding
  interaction. This is the next critical-path task.
- **Melt shader + cube\u2192plane demotion** (PLAN Day 7, perf lever 2).
- **Dawn sequence** (PLAN Day 11).
- **Persistence + cairns** (PLAN Day 10).


## Gotchas that bit us THIS session

- **Debounced CRDT writes hide extremes.** The frost accumulator
  clamps at 100 but only writes on `>= 0.5` delta. If you check the
  synced value it can be 99.6 forever. Always read the local
  authoritative float (`getFrostLocal()`) for FSM triggers on the
  local player.
- **`InputModifier` toggle after `movePlayerTo` gets stuck.** Copy
  the flagtag double-teleport pattern verbatim: teleport \u2192 wait Y
  stable \u2192 teleport same spot \u2192 wait \u2192 delete InputModifier \u2192 0.5 s
  beat \u2192 re-apply \u2192 fire emote. Anything simpler leaves the avatar
  frozen mid-animation.
- **`borderWidth` eats the inner content area.** Toggling
  `borderWidth: 0 \u2194 2` shifts children by 2 px. Keep width constant,
  toggle only `borderColor` (transparent when hidden). The torch
  slot fuel-fill centring bug came from this.
- **`textureMode: 'stretch'` doesn't preserve aspect.** DCL has no
  \u201ccontain\u201d mode. Size the box to the icon's native ratio, otherwise
  a wide PNG gets squashed into a square (eye icon bug).
- **DCL height prop rejects string percents in this SDK build.**
  Flagtag uses `height: '50%'` in some places; here it throws
  `TS2322`. Use pixel numbers.


## Suggested first move for the next session

1. Read this file + handoff #1 + PLAN.md v2.10 entry.
2. Ask user which they want first:
   - **Wood pickup + feed fire** (Day 4 loop closure \u2014 the biggest
     open critical-path item). Would introduce a real inventory that
     forces the torch-XOR-wood interdependence PLAN pillar B1
     depends on.
   - **Corpse rendering + revive stub** (closes the death sequence
     into a multiplayer story).
   - **Melt shader + demotion** (Day 7 perf work \u2014 flagged as
     prerequisite before growing the world further).
   - Something else the user has in mind.
3. If wood pickup: `FrostDeath` and `TorchFuel` show the pattern for
   a small synced component; the wood item wants the same shape.
