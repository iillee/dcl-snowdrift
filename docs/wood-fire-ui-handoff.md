# Wood + Fire + UI handoff

Session focus: unifying the mobile / desktop hotbar-flush tooltip
system across all three fire actions, hardening the log-pickup FX
path, fixing a cross-fire melt-ring regression on the server, and
adapting the fuel billboards for the spectator camera.

Branch: `wood+fire+UI`

---

## 1. Hotbar-flush tooltip system

### Unified design

All three action tooltips now share one visual language: a solid
warm-gold bubble with a matching gold border, positioned absolute
against the outer edge of a hotbar button. Same layout on mobile and
desktop; only pixel budgets differ.

Files:
- `src/client/ui/layers/layer.relightPrompt.tsx` — Light Torch
- `src/client/ui/layers/layer.feedPrompt.tsx` — Feed Fire
- `src/client/ui/layers/layer.hiddenCampfirePrompt.tsx` — Light Campfire (rebuild)
- `src/client/ui/layers/layer.hotbarBridge.tsx` — gold connector strip

Sizing constants are duplicated across the three prompt layers and
the bridge and MUST stay in sync (kept as local constants with an
in-file "keep in sync" comment on each). If a hotbar button ever
changes size, update all four files.

Per-platform values (identical across all three prompt files):

| Constant           | Mobile | Desktop |
|--------------------|--------|---------|
| `TOOLTIP_H`        | 112    | 71      |
| `HOTBAR_HALF`      | 128    | 80      |
| `BOTTOM`           | 0      | 30      |
| `BORDER_W`         | 4      | 3       |
| `PADDING_X`        | 20     | 14      |
| Font size          | `md*2` | `md*1.25` |

Desktop uses `TOOLTIP_H = 71` (not 72 = `BTN_SIZE`) as the least-bad
integer compromise for a subpixel-alignment issue: Yoga rounds
absolute-positioned boxes on a different grid than in-flow flex
boxes. At `h72/b30` the tooltip top overshoots the button top by
1 px; at `h71/b30` the top is ~0.5 px shy and the bottom is flush.
The half-pixel shy is invisible in practice.

### Left / right slot arbitration

The relight and hidden-campfire tooltips both target the LEFT side of
the Torch button. Both cannot render on the same frame:

- `layer.relightPrompt.shouldShowPrompt()` yields to the hidden-
  campfire tooltip when `isHiddenCampfirePromptVisible()` is true
  (bigger gameplay payoff wins).
- `layer.hotbarBridge` shows the LEFT gold connector when EITHER
  tooltip is visible: `isRelightPromptVisible() || isHiddenCampfirePromptVisible()`.
- `TorchButton` in `layer.brushSize` flips its border to gold when
  either tooltip is visible.

### Tap reliability + rich-text bug

The label uses `<b>...</b>` rich-text markup ONLY on desktop. Mobile
uses a plain uppercase string.

Why: react-ecs measures rich-text `<b>` labels at plain-text width but
paints them at bold-glyph width. Parents with `width: 'auto'` size
their hitbox to the measured (narrower) width while their background
paints to the wider bold rectangle. Result on touch: taps on the
outer portion of the visible gold bubble hit nothing.

Full write-up: `docs/bug-reports/react-ecs-richtext-hitbox-mismatch.md`.
On desktop the mouse cursor is pixel-precise so the mismatch doesn't
matter — bold ships there.

### Hotbar slot opacity

`src/client/ui/layers/layer.brushSize.tsx`: the Torch and Logs slots
now use `SLOT_BG_DT = rgba(0.08, 0.08, 0.10, 1)` on desktop too. The
old `PANEL_BG` (alpha 0.85) let the gold bridge strip bleed through
the button. Other HUD panels still use the semi-transparent
`PANEL_BG`.

---

## 2. Log pickup FX robustness

### Bugs fixed

1. **"Teleported to (0, 0) on pickup"** — `src/client/wood.ts`
   `woodChunkRemoved` handler called `spawnLogsBounce(pickerId)` when
   `getPlayer()` returned null (early join races), passing the local
   player's own userId as an explicit avatarId. `AvatarAttach` with
   an explicit avatarId on the LOCAL avatar silently fails and leaves
   the FX rig orphaned at world (0, 0, 0). The user reads this as a
   teleport.
2. **"Log stuck above heads"** — same failure mode: mismatched-case
   avatar ids cause `AvatarAttach` to silently no-op, leaving stale
   attach state that the pool's release path can't fully clear.

### Fixes

- `src/client/logsPickupFx.ts` — `spawnLogsBounce()` now normalises
  its `playerId` argument:
  - Lowercases any incoming id.
  - Drops the id if it matches the local player's userId (routes back
    to the local-attach branch that omits `avatarId`).
- `src/client/wood.ts` — the `woodChunkRemoved` handler skips remote
  FX entirely when `getPlayer()` is null, and does an explicit
  lowercase compare against the local id before spawning.

Both changes are defensive; the underlying `AvatarAttach` engine
behaviour is unchanged.

### Colliders removed

`src/client/logs.ts` and `src/client/wood.ts` both spawn their GLBs
with `visibleMeshesCollisionMask: 0` and
`invisibleMeshesCollisionMask: 0`. Players walk through logs to pick
them up rather than bumping over them.

---

## 3. Cross-fire melt-ring regression

**Bug:** feeding one fire to grow its melt radius appeared to reset
other fires' rings.

**Root cause:** `src/server/paintState.ts::shrinkMeltRingTo(cx, cz, r)`
iterated `protectedCells` globally and cleared any cell farther than
`r` from `(cx, cz)`. The protected set has no per-fire ownership, so
any tier-crossing shrink call scrubbed cells belonging to OTHER fires.

**Fix:** the function now takes a fourth argument `previousRadiusM`.
Cells outside `previousRadiusM` from `(cx, cz)` are skipped — they
can't be this fire's cells. Callers pass their fire's max possible
radius:

- `src/server/hearthFuel.ts` — `FUEL_MAX_BURST_RADIUS_M`
- `src/server/hiddenCampfire.ts` — `hearthRadiusFromFuel(FUEL_MAX)`
  (called from both `snuffFire` and the tier-decay branch of the
  decay tick)

The 4 Hz ring-refresh tick was masking this bug on hidden fires by
repainting their rings within ~250 ms of a wipe, which appeared as
a flash. The main hearth ring lacked that safety net and would stay
gone.

---

## 4. Fuel-bar billboards in spectator mode

`src/client/hearthBillboard.ts`:

Eye-level view keeps the previous behaviour — `BillboardMode.BM_Y`,
rotating around Y to face the walking camera.

Spectator (top-down) view:
- `Billboard` component is REMOVED. `BM_ALL` was tried first but the
  overhead camera has a fixed orientation, so a chasing billboard
  visibly spins as the camera pans.
- Root gets a fixed rotation: `Quaternion.fromEulerDegrees(90, -90, 0)`
  — 90° tilt to lay flat, -90° yaw to make text read correctly for
  the overhead camera's up vector.
- Position shifts to `(baseX - 4, 2.5, baseZ)` — screen-left of the
  fire (out of the smoke column), 2.5 m up (clear of snow depth).

Constants:
```ts
TOP_DOWN_ROT       = Quaternion.fromEulerDegrees(90, -90, 0)
TOP_DOWN_OFFSET_X  = -4
TOP_DOWN_OFFSET_Z  =  0
TOP_DOWN_GROUND_Y  =  2.5
```

Applied to all rigs on top-down toggle in `updateAllBillboards`, AND
to any rig that spawns while top-down is already active (hidden fire
ignites during spectator mode) via the same block inside
`spawnHearthBillboard`. Without the spawn-time snap, late-ignited
hidden fires get the default eye-level billboard until the next
camera toggle.

---

## 5. Files changed

```
src/client/hearthBillboard.ts
src/client/logs.ts
src/client/logsPickupFx.ts
src/client/ui/layers/layer.brushSize.tsx
src/client/ui/layers/layer.feedPrompt.tsx
src/client/ui/layers/layer.hiddenCampfirePrompt.tsx  (full rewrite)
src/client/ui/layers/layer.hotbarBridge.tsx
src/client/ui/layers/layer.relightPrompt.tsx
src/client/wood.ts
src/server/hearthFuel.ts
src/server/hiddenCampfire.ts
src/server/paintState.ts
```

New doc:
```
docs/wood-fire-ui-handoff.md   (this file)
```
