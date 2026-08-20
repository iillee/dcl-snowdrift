# Mobile HUD + Locomotion Handoff (2026-08-20)

Session on the `mobile` branch. Focus: mobile HUD refactor, desktop HUD
alignment cleanup, mobile-only touch-controls layer, and an aborted
investigation into a mobile-client locomotion bug.

Read alongside `docs/frost-torch-handoff-3.md` (previous session) and
`docs/bug-report-avatar-locomotion-mobile.md` (spun out of this session).


## Branch state

- On `mobile`, branched from `frost`. TypeScript compiles clean.
- One session-closing commit rolls everything below into a single
  change. Branch is ready to merge into `frost` / `main`.


## What actually got built

### 1. Native mobile gamepad reshape (`src/client/touchControls.ts`)

New module. Configures `TouchScreenControls` on mobile only:

- `IA_PRIMARY` (`E`) / `IA_SECONDARY` (`F`): hidden. Scene-drawn UI
  handles their affordances on mobile.
- `IA_ACTION_3` (`1`): icon swapped to the eye glyph (spectator toggle).
  Dispatch is left to `topDownCamera.ts`, which already owns
  `IA_ACTION_3` — dispatching here would double-toggle.
- `IA_ACTION_4` (`2`): icon swapped to the mute glyph, wired to
  `toggleMusic()` on rising edge. Re-applied after each toggle so the
  glyph reflects the audio state.
- `IA_POINTER`: on mobile only, gated relight — pressing the DCL native
  pointer button while inside the campfire heat ring and holding a
  torch fires `relightTorch()`. Outside those gates it is a no-op so
  the button stays free for its other use (top-down drag-release).

Padded icon copies live at `assets/images/muted_padded.png` /
`unmute_padded.png` — the source PNGs had almost no transparent border,
so the DCL native button stretched them past the eye icon's visual
size. Padded copies (700x700, glyph occupies ~65% of each axis) match
the eye glyph optically. Regenerate with `pad-icons.js` if source art
changes.


### 2. Frost bar moved top-centre, sized per-platform

`src/client/ui/layers/layer.frostBar.tsx` moved from
`ZoneType.BottomCenter` -> `ZoneType.TopCenter`. Now anchored on the
same y-baseline as the ActionBar buttons (top margin 32 desktop / 4
mobile). Every sizing dimension became per-platform (SEG_SIZE, SEG_GAP,
FRAME_PAD, BORDER_PX, all three RADIUS values) so desktop and mobile
can tune independently.

Both platforms currently render at the same 44 px segment size with
matching frame / border / radius. Outer footprint is 72 px tall (matches
`BTN_SIZE`), so the bar aligns visually with the neighbouring buttons.

Background is a single 0.80 alpha fill on desktop (transparent inner,
no lighter grey band around the segments) and the original two-layer
0.55 stack on mobile so the pre-desktop-refresh mobile look is
preserved.


### 3. Torch, spectator, mute now inline with the frost bar

Frost-bar layer body now renders `SpectatorButton`, `MuteButton`, and
`TorchButton` inline as siblings. Desktop row order (left -> right):

    [ eye ] [ mute ] [ frost bar ] [ torch (if equipped) ]

- `SpectatorButton` and `MuteButton` are new exports from
  `layer.brushSize.tsx`, extracted from the ActionBar layer inline JSX.
- `TorchButton` was already exported from `layer.brushSize.tsx`.
- Old `layer.torchButton.tsx` (its own TopRight layer) is no longer
  registered in `ui/index.tsx`. The file is still on disk (untracked)
  in case we want to revive a hand-slot separator later.
- Frost-bar outer frame carries `margin: { left: 8, right: 8 }` on
  desktop so the gap to the adjacent inline buttons matches the 16 px
  between-button gap (`BTN_MARGIN_X * 2`). Zero side margin on mobile,
  which has no inline neighbours.

Mobile does not render `SpectatorButton` or `MuteButton` inline — those
live in the native gamepad slots via `touchControls.ts` (#1 above).


### 4. Relight prompt: `E` glyph now white on desktop

`src/client/ui/layers/layer.relightPrompt.tsx`: desktop `Label` colour
changed `KEY_FG` (near-black) -> `Color4.White()`. Mobile hand-icon
inside the same amber chip is untouched.


### 5. Mobile top-down d-pad repositioned

`src/client/ui/layers/layer.topDownPan.tsx`:

- `DPAD_MARGIN_RIGHT` bumped 32 -> 96 so the d-pad clears the native
  mobile jump/interaction cluster in the bottom-right corner.
- `DPAD_MARGIN_BOTTOM` bumped 360 -> 440 to lift the d-pad above the
  native action buttons.

Desktop behaviour unchanged.


### 6. Music default on

`src/client/audio.ts`: `musicMuted` default flipped `true` -> `false`.
Players hear the loop from scene entry; the mute button is the opt-out.


### 7. Locomotion gate diagnostic (rolled back before commit)

`src/client/locomotion.ts` was untouched in the committed diff. During
the session it briefly gained a heartbeat log and two rounds of tuning
experiments to diagnose whether `AvatarLocomotionSettings` was reaching
the mobile client. All experimental changes were reverted with
`git checkout HEAD -- src/client/locomotion.ts` before commit.

Findings are captured in `docs/bug-report-avatar-locomotion-mobile.md`.
Short version: the scene writes reach the component correctly on both
platforms, `InputModifier` writes on the same entity in the same call
take effect on mobile, but `walkSpeed / jogSpeed / runSpeed` produce no
felt change on mobile at any value tested (1.0 through 14.0 m/s). Not
filed yet — see the "Before filing" checklist in that doc for the
remaining verification steps (grab a mobile client build/commit; test
flagtag's mushroom boost on mobile; try the extreme-value diagnostic).


## Files touched this session

Modified:
- `src/client/audio.ts` — music default on.
- `src/client/index.ts` — bootstrap wiring for `setupTouchControls()`.
- `src/client/ui/index.tsx` — drop `torchButtonLayer` registration.
- `src/client/ui/layers/layer.brushSize.tsx` — extract
  `SpectatorButton` / `MuteButton` exports, remove desktop-only inline
  JSX from ActionBar.
- `src/client/ui/layers/layer.frostBar.tsx` — top-centre move,
  per-platform sizing, inline neighbour buttons, single-layer desktop
  background.
- `src/client/ui/layers/layer.relightPrompt.tsx` — white `E` on desktop.
- `src/client/ui/layers/layer.topDownPan.tsx` — d-pad offset tuning.
- `src/client/ui/utils/atlas.ts` — helper for atlas-tile UVs used by
  the relight prompt.

New:
- `src/client/touchControls.ts` — mobile gamepad reshape.
- `src/client/ui/layers/layer.torchButton.tsx` — kept on disk but no
  longer registered; safe to delete in a follow-up cleanup pass.
- `assets/images/muted_padded.png`, `assets/images/unmute_padded.png`
  — padded copies for the mobile ACTION_4 mute glyph.
- `docs/bug-report-avatar-locomotion-mobile.md` — full write-up of the
  locomotion investigation.
- `docs/mobile-hud-handoff.md` — this file.


## Next up

1. Merge `mobile` into `frost` (or straight into main if `frost` has
   already merged).
2. Delete `src/client/ui/layers/layer.torchButton.tsx` in a small
   cleanup commit — nothing imports it after this session.
3. File the mobile-client locomotion bug once the remaining checklist
   items in `docs/bug-report-avatar-locomotion-mobile.md` are done.
   Ship the physics-drag fallback (Option B) in parallel so mobile
   players get snow drag before the client fix lands.
