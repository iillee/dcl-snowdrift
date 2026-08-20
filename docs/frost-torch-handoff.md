# Frost + Torch Handoff (2026-08-19)

Session handoff for the next Claude session picking up work on the
`frost` branch. Read this alongside `docs/PLAN.md` (v2.8 + v2.9 changelog
entries) and `docs/cliffs-v2-handoff.md`.


## Branch state

- On `frost`, pushed to `origin/frost`. Latest commit: `2aa3a59`.
- `frost` diverged from `main` at `8ff4b95` and has two feature commits
  on top: prop-scatter/reroll (v2.8) + frost survival loop (v2.9).
- `torch-v2` was merged into `frost` earlier this session (unwired
  hotbar + emote stubs — most got repurposed).
- TypeScript compiles clean: `npx tsc --noEmit`.


## What actually got built

### Frost survival loop (steps 1-3 of the original plan)

- `src/shared/frost/tuning.ts` — two-term freeze model.
  - `FROST_TIME_BASELINE_S = 300` (ambient cold, halted by lit torch)
  - `FROST_TIME_SNOW_STAGE_S` per snow stage (always applies)
  - `FROST_TIME_TO_THAW_S = 45` (recovery at fire)
- `src/shared/frost/components.ts` — `FrostLevel` (0..100, per-player,
  synced) + `FrostDeath` (death spot + awake flag, synced for corpses).
  MUST be statically imported from `src/index.ts` — this bit us hard,
  see gotchas.
- `src/client/frost/accumulation.ts` — 5 Hz sampler, sums baseline
  and snow-depth rates, writes `FrostLevel` with 0.5% epsilon debouncing.
- `src/client/ui/layers/layer.frostBar.tsx` — bottom-center pill.
  Warm-gold base, `#6A99FC` paint-blue ice fills from the right,
  2px black border (fake border via wrapper — react-ecs has no native
  border). Shifted up to bottom=120px/100px on desktop/mobile so it
  clears the hotbar.

### Torch fuel loop

- `src/client/torchEquip.ts` — owns fuel + lit state.
  - `TORCH_FUEL_MAX_S = 90`, `isTorchLit()`, `relightTorch()`,
    `extinguishTorch()`, `getTorchFuelFraction()`, `consumeTorchFuel()`.
- `src/client/torchInput.ts` — REPURPOSED from torch-v2's raise-emote
  stub. Now a single per-frame system that (a) drains fuel and
  extinguishes at 0, and (b) on E-press-rising-edge inside campfire
  heat radius, calls `relightTorch()`. Raise-emote deferred; will
  come back as the relight ritual.
- `src/client/campfire.ts` — added `pointerEventsSystem.onPointerDown`
  with `hoverText: 'Relight torch'` and `IA_PRIMARY`. Also relights.
  User reported the hover text isn't showing yet — likely the GLB
  needs pointerEventsMask on its colliders. Not yet fixed.
- `src/client/torch.ts` — flame orb attached to the right-hand anchor
  at `(-0.11, 0.10, 0.28)` in avatar-local meters (found by iterating
  with user because preview never launched in reasonable time — see
  gotchas). Orb scale lerps `0.20 -> 0.06` with fuel. Shaft stays
  constant size (user rejected the shrinking-shaft alternative).
  `isTorchProtecting()` returns `isTorchLit()`.
- `src/client/brush.ts` — replaced runtime-adjustable brush with
  torch-derived brush: 3 lit, 1 unlit. The old +/- API is kept as
  no-op shims so old imports still compile.

### HUD

- `src/client/ui/layers/layer.hotbar.tsx` — bottom-center 64x64 slot.
  torch.png icon dims to grey when unlit, amber orange 5px fuel bar
  along the bottom. Border glows amber when lit or raised.
- `src/client/ui/layers/layer.brushSize.tsx` — top-center action bar.
  REMOVED `+`, `-`, and `#` buttons. Kept ↻ reroll, spectator, mute,
  precipitation.


## Immediate next work: frost step 5 (death sequence)

The plan we agreed on (from earlier in the session):

1. Frost hits 100% -> fire emote in place, lock input.
2. Player lies collapsed for ~2s so the "you died" beat registers.
3. Fade to black (0.6s), teleport to spawn (right next to campfire),
   hold black through the ~10s downed period.
4. Fade in at spawn while player is still in emote pose.
5. First movement input -> stand up, release lock, release emote.

Reference implementation to steal from:
`C:/Users/luke/AppData/Roaming/creator-hub/Scenes/flagtag/src/systems/cinematicSystem.ts`
and `.../ghostSystem.ts`. Key learnings from flagtag:

- Use death emote URN
  `urn:decentraland:matic:collections-v2:0x7bdc37ff3e8dca2d69f01a3dc34f3ad82e2e1870:0`
  (same one flagtag uses for ghost death, lightning, water). Confirmed
  by user.
- `movePlayerTo` mid-animation leaves the avatar in a stuck state
  where new emotes don't fire. Flagtag's workaround: teleport ->
  wait for Y stable -> re-teleport same spot -> wait -> remove
  `InputModifier` -> 0.5s beat -> re-apply `InputModifier` -> fire
  emote. Ugly but proven. Steal wholesale.
- Fade constants: `FADE_IN_DUR = 0.6`, hold, `FADE_OUT_DUR = 1.0`.

User also wants corpses visible to other players (synced) so a
future revive mechanic can grow out of it. `FrostDeath` component is
already defined for this — just needs a `syncEntity` call on the
local player entity and a client-side system that renders corpses
for every OTHER player whose `FrostDeath.awake === false`.

Skip the corpse rendering on the first pass — get the local
freeze -> fade -> respawn -> wake flow bulletproof first. Add
corpses in a follow-up commit.


## Deferred but discussed

- **Wood cost for relight.** Currently free. When the wood-from-snow
  system lands (per PLAN.md pillar C), relight should consume 1 wood.
  Requires an inventory beyond the torch slot.
- **Contagious warmth** (PLAN.md pillar C). Torch protection is per-
  player only in v1. Later: lit torch could halt baseline frost for
  nearby players too, matching the "warmth spreads" pitch.
- **Relight ritual emote.** User wants E-press-in-radius to eventually
  play a specific relight emote animation. torchInput.ts is the wiring
  point. torch-v2's `torchInput.ts` had a raise-emote path that got
  overwritten — check `git log torch-v2` if you want the old code.
- **Torch flame FX.** Currently a plain emissive orange sphere. A real
  flame (particle system, or a swaying textured billboard) would look
  much better. Skill: `particle-system` (Unity-explorer only though,
  Bevy/mobile won't see particles).


## Known bugs / rough edges

1. **Frost bar has visual issues** per user ("the bar has issues. but
   lets just get everything working"). Not investigated. Might be
   corner rendering on the border pill, or fill boundary artifacts.
2. **Campfire hover text not showing.** Added `pointerEventsSystem
   .onPointerDown` on the campfire entity with `hoverText: 'Relight
   torch'` but the DCL bubble isn't appearing. Likely need to set
   pointer collision mask on the GltfContainer — currently no
   `visibleMeshesCollisionMask` override, so DCL defaults apply.
   Try `visibleMeshesCollisionMask: ColliderLayer.CL_POINTER |
   ColliderLayer.CL_PHYSICS`.
3. **Torch shrinking shaft aborted.** I built it, user rejected in
   favour of shrinking flame orb. Code is gone but git history has it.
4. **Timings need tuning.** User said "we need to adjust the timing
   to make it feel right" but didn't give concrete numbers. All
   knobs live in `src/shared/frost/tuning.ts` and
   `src/client/torchEquip.ts` (`TORCH_FUEL_MAX_S`).


## Gotchas learned this session

### SDK component definitions must be statically imported from `src/index.ts`

`src/index.ts` uses `await import('./client')` inside `main()` \u2014 a
dynamic import. Anything reached only through the client tree runs
AFTER the engine seals, so `engine.defineComponent()` throws
`"Engine is already sealed"`.

Fix: add the shared components module to the static import block at
the top of `src/index.ts`. Precedent: `src/shared/components.ts` has
a comment demanding this. We hit the error when adding
`src/shared/frost/components.ts` and had to add
`import './shared/frost/components'` to `src/index.ts`.

**When you add a new shared component file, ALWAYS static-import it
from `src/index.ts` at the same time.**

### Preview never launches in reasonable time

This scene has 1024 parcels. `/preview` takes forever (never
completed in-session). Don't rely on `screenshot` or `preview` tools
for iteration. Ask the user to eyeball changes and describe deltas.
User will get frustrated if you keep trying — I did.

### Hand-anchor local axes are inverted from intuition

For the right hand `AAPT_RIGHT_HAND` anchor:
- **-Y = up** (Y-positive points DOWN toward the ground)
- **-X = right of avatar** (X-positive is LEFT relative to avatar)
- **+Z = forward** (matches expectation, thankfully)

Found by iteration. If you're placing anything in hand-local space,
save yourself pain and start with those signs.

### React-ECS has no native border

`uiTransform.borderColor` / `uiTransform.borderWidth` might work on
some versions but definitely didn't work last time we tried. Use the
"wrap a larger black background around the element with 2px padding"
trick (see `layer.frostBar.tsx`).

### Existing paint API for snow depth is perfect for frost

`getSnowStageAtWorld(x, y, z)` in `src/client/paint.ts` returns 0..3.
Same function the locomotion system uses. Safe to call before init
(returns 3 = "treat as full snow"). No need to re-sample the paint
CRDT yourself.

### Existing `CAMPFIRE_MELT_RADIUS_SQ_M` matches the paint hot-ring

Use `src/shared/campfire.ts` for radius checks so the safe zone
matches the visible melted circle. Saves us from having to teach
players two different "safe distance" concepts.


## Files touched this session

```
src/shared/frost/tuning.ts       new
src/shared/frost/components.ts   new
src/client/frost/accumulation.ts new
src/client/ui/layers/layer.frostBar.tsx  new
src/client/ui/layers/layer.hotbar.tsx    modified (wired + torch png + fuel bar)
src/client/ui/layers/layer.brushSize.tsx modified (removed +/-/# buttons)
src/client/ui/index.tsx           modified (registered frostBar + hotbar)
src/client/torch.ts               modified (flame orb + fuel-driven shrink)
src/client/torchEquip.ts          modified (fuel + lit state)
src/client/torchInput.ts          rewritten (fuel drain + E-relight)
src/client/brush.ts               rewritten (torch-derived)
src/client/campfire.ts            modified (pointer relight hint)
src/client/index.ts               modified (setupTorchInput + frost init)
src/index.ts                      modified (static import frost components)
assets/scene/main.composite       modified (removed hand-placed Tree 4)
assets/scene/entity-names.ts      modified (removed Tree__4)
```


## Suggested first move for the next session

1. Read this file + `docs/PLAN.md` v2.9 entry.
2. Ask user which they want first: **fix the frost bar visual issues**,
   **fix the campfire hover text**, or **build step 5 (death sequence)**.
3. If step 5: read `flagtag/src/systems/cinematicSystem.ts` +
   `flagtag/src/systems/ghostSystem.ts` for the fade/emote pattern.
   Sketch the FSM before writing code and check it with user.
