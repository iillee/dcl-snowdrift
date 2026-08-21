# Mobile Polish Handoff (2026-08-21)

Session on the `fun` branch, merged to `main` at the end. Small,
focused mobile-UX pass with one hydration bug fix. Read alongside
`docs/mobile-hud-handoff.md` (previous mobile session) for context on
`touchControls.ts` and the tooltip layers.


## Branch state

- Started on `fun`, work committed as one squash-style commit
  (`1e7b3ea`), then `fun` merged into `main` via `--no-ff` merge
  commit and pushed to `origin/main`.
- TypeScript compiles clean. Bundle at `bin/index.js` references the
  new asset URLs.
- Ready to deploy.


## What actually got built

### 1. Mobile action-button icons: `?` glyph + eye rescaled

`src/client/touchControls.ts`

- `HELP_ICON_SRC` now points at `assets/images/help-v3.png` — a clean
  700x700 white `?` glyph on transparent background. Was rendering as
  the DCL fallback `?` inside a white box because the previous asset
  at `help.png` was the wrong image (a pixelated torch, left over from
  a prior session).
- `EYE_ICON_SRC` now points at `assets/images/eye3.png` — the original
  eye padded to 1.4x canvas (transparent border ~20% each side) so it
  renders at ~71% of the mobile button, matching the `?` and muted
  icons as one visual family.

Both files got fresh URLs (`eye3`, `help-v3`) because the DCL Explorer
mobile client aggressively caches textures by URL. Filename bump is
the only cache-bust that survives across app relaunches. See "Caching
gotcha" below.

Generator: `scripts/make-help-icon.js` — pure-Node (`zlib` only, no
sharp / no canvas) PNG writer that rasterizes the `?` inside an inner
500x500 box on the 700x700 canvas. Tweak `GLYPH_SIZE` to resize.
Regenerate with `node scripts/make-help-icon.js`; copy the output to a
new versioned filename (`help-v4.png` etc.) and repoint
`HELP_ICON_SRC` if you edit the glyph.


### 2. Mobile pointer supports every fire

`src/client/touchControls.ts` — `IA_POINTER` handler now mirrors the
desktop E-press flow in `torchInput.ts`:

1. If the player is standing on a not-yet-lit hidden pit with a lit
   torch (`isReadyToIgniteHidden()`), the tap is an ignite request.
2. Otherwise, if inside the central bonfire radius OR
   `isInHiddenRelightRange()` (any lit hidden fire), `relightTorch()`
   fires.
3. Outside both, no-op — leaves `IA_POINTER` free for its other use
   (top-down drag-release in `topDownCamera.ts`).

Previously only the central bonfire's radius was checked, so mobile
players could not relight or top off at the hidden fires.


### 3. Campfire tooltips: 2x on mobile, shifted right

`src/client/ui/layers/layer.relightPrompt.tsx` and
`src/client/ui/layers/layer.hiddenCampfirePrompt.tsx`

- Introduced a local `const S = isMobile() ? 2 : 1` scale factor.
  Multiplied every intrinsic size (chip 26, hand icon 20, label
  height 26, `fontSizes.md`, and padding) by `S`. Desktop values
  unchanged.
- Added `margin.left: isMobile() ? 320 : 0` on the root of both
  layers so the enlarged tooltip clears the player-avatar silhouette
  centred on screen. Tune this constant if playtest reveals a better
  horizontal offset.


### 4. Hidden-campfire hydration bug fix

`src/client/hiddenCampfire.ts` — `handleCycleSeedChange()` now
early-returns when `newSeed === oldSeed` (i.e. the server's first
`cycleState` confirming the same cycle we already booted with).

Before the fix, on rejoin the sequence was:

1. `setupHiddenCampfire()` spawned unlit pits, set `currentSeed =
   getHiddenCampfireSeed()` (local Date-derived).
2. Server sent `hiddenCampfireState { lit: 1 }` for already-lit pits
   → `applyLitVisuals()` ran, flame/audio/smoke appeared, beacon
   removed, `litLocal[i] = true`, frost cleared under the ring.
3. Server sent `cycleState` (first arrival) → `cycle.ts` fires
   `onCycleSeedChange` unconditionally on hydration → old
   `handleCycleSeedChange` wiped everything: `applyUnlitVisuals`
   removed flame/smoke, respawned beacon, set `litLocal = false`;
   `relocatePit` destroyed and recreated the pit entity.
4. Server does NOT re-broadcast `hiddenCampfireState` (nothing
   changed on its end) → pit stays unlit for the rest of the session.
   Player sees no flame, a beacon, and a persistent melted frost ring
   (leftover from step 2 before the frost regenerates).

The `newSeed === oldSeed` guard preserves already-applied lit
visuals through hydration. Real cycle rollovers (new seed) still
wipe and relocate as before.


### 5. Locator beacons disabled

`src/client/hiddenCampfire.ts` — `BEACON_ENABLED = false`. Hidden
pits are now discovered by exploration alone. The spawn / remove /
pulse code is left in place so we can flip the flag back on for a
hint mode without a code change.


## Caching gotcha (write this on the wall)

DCL Explorer's mobile client caches textures **by URL**, disk-backed,
across app relaunches. Overwriting `foo.png` in place does NOT
invalidate. The reliable fix that survives every cache layer:

1. **Rename the file** so the URL changes (`eye.png` -> `eye2.png` ->
   `eye3.png`). Update the constant in code.
2. **Force-quit Explorer** (swipe out of the app switcher, not just
   background it). Otherwise the loaded scene JS bundle re-uses the
   old constants from memory.
3. **Leave the scene entirely** (teleport out and back) if force-quit
   isn't practical — cheaper than a full app relaunch.
4. If viewing the deployed World rather than local preview, a rename
   still doesn't help until you redeploy — the deployed content
   server pins the old file paths.

Files are content-addressed once deployed, so a filename bump also
means a fresh content hash → guaranteed CDN miss on the redeploy.


## Files touched this session

- `src/client/touchControls.ts` — eye/help icon refs, pointer flow
- `src/client/ui/layers/layer.relightPrompt.tsx` — 2x mobile scale +
  right shift
- `src/client/ui/layers/layer.hiddenCampfirePrompt.tsx` — 2x mobile
  scale + right shift
- `src/client/hiddenCampfire.ts` — hydration guard, beacons disabled
- `scripts/make-help-icon.js` — new, pure-Node `?` glyph generator
- `assets/images/eye3.png` — padded eye (produced with `ffmpeg pad`)
- `assets/images/help-v3.png` — generated `?` glyph
- (Older intermediate assets `eye2.png`, `help.png`, `help-v2.png`
  are still in the repo; safe to prune next pass.)


## Next-step ideas

- Prune the intermediate icon assets (`eye2.png`, `help.png`,
  `help-v2.png`, `help graphic glitch.png`) once we're confident no
  reference remains. Also fold the beacon dead-code behind an
  `#if 0`-style guard or delete it if the exploration-only design
  sticks.
- The 320 px right-shift on mobile tooltips is a rough guess. Verify
  on a range of phone aspect ratios before locking in.
- The mobile pointer button is now overloaded (relight, ignite,
  top-down drag-release). All three paths are radius/state-gated so
  they don't collide today, but if we add a fourth we should think
  about explicit intent rather than piling on gates.
