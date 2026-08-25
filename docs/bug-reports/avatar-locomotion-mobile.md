# Bug investigation: `AvatarLocomotionSettings` appears to be ignored on mobile Explorer

Status: **investigation paused** — enough evidence to file, but one confirmation
step outstanding before submitting to the Decentraland client team.

## Summary

In the Snow Drift scene, `AvatarLocomotionSettings.createOrReplace` on
`engine.PlayerEntity` produces the expected walk/jog/run speed change on the
**desktop** Explorer but produces **no perceptible change on the mobile
Explorer**, whether the applied speed is lower than the client default (e.g.
1.0–2.5 m/s) or well above it (e.g. 14 m/s).

`InputModifier` writes on the same entity, in the same function call, on the
same frame **do** take effect on mobile (jump/run disable is honored). So this
is not a CRDT sync or entity-targeting issue — it is specific to the
`AvatarLocomotionSettings` component on the mobile client.

## Environment

- Scene: `dcl-snowdrift` (deployed to the `snowdrift.dcl.eth` World).
- SDK: `@dcl/sdk@7.26.1-31714079767.commit-96e9a29`.
- Desktop client: works as expected.
- Mobile client: build/commit **TBD — capture before filing**.
- Transport tested: preview via Creator Hub. Not yet re-tested against a
  deployed build (see "Before filing" below).

## Reproduction (in this scene)

1. Run the scene on mobile.
2. Walk around. The `locomotion` module polls player position and writes an
   `AvatarLocomotionSettings` profile based on snow-fill stage under the
   player's feet (see `src/client/locomotion.ts`).
3. Console logs confirm the writes are firing:

   ```
   locomotion: applyStageProfile: stage=1 speed=2.5 disableJump=false
   locomotion: heartbeat: pos=(270.5, 0.2, 253.3) insidePlayfield=true observed=1 currentStage=1 appliedSpeed=2.5
   ```

4. Movement speed does not change between stages on mobile. Same joystick
   throw produces the same felt speed regardless of the applied profile.

## Evidence collected

### 1. Scene side is provably correct

Heartbeat log (added to `initLocomotionGate` for this investigation) confirms
on the mobile console that:

- `initLocomotionGate` runs on mobile (heartbeat fires every 2 s).
- `getSnowStageAtWorld` returns different values in different terrain
  (`observed=0` on melted paths, `observed=1` on light snow, etc.).
- Hysteresis promotes `currentStage` and `applyStageProfile` fires with the
  correct target speed.
- The next heartbeat reflects the new `appliedSpeed`.

Excerpt from a mobile session (see the full paste in the investigation
transcript):

```
locomotion: heartbeat: pos=(254.0, 0.2, 254.0) insidePlayfield=true observed=0 currentStage=0 appliedSpeed=4
...
locomotion: applyStageProfile: stage=1 speed=2.5 disableJump=false
locomotion: heartbeat: pos=(270.5, 0.2, 253.3) insidePlayfield=true observed=1 currentStage=1 appliedSpeed=2.5
locomotion: heartbeat: pos=(259.0, 0.2, 262.9) insidePlayfield=true observed=0 currentStage=0 appliedSpeed=4
```

### 2. `InputModifier` on the same entity works on mobile

`applyStageProfile` writes `InputModifier` and `AvatarLocomotionSettings`
back-to-back on `engine.PlayerEntity`:

```ts
InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({ disableRun: true, disableJump }),
})
AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, {
    walkSpeed: speed, jogSpeed: speed, runSpeed: speed,
})
```

On mobile, `disableJump` at stage 2/3 is honored (player cannot jump out of
deep snow). `walkSpeed`/`jogSpeed`/`runSpeed` on the same entity, same frame,
are ignored. This rules out CRDT sync, entity mis-targeting, and component
staleness.

### 3. Not a minimum-speed floor / clamp

Initial theory was that the mobile joystick clamps to some internal minimum
speed and silently rejects lower values (which would explain why flagtag's
mushroom *boost* is reported to work but our snow *drag* does not).

Diagnostic: temporarily inverted the profile so deep snow was the fastest
value and all values were above the client default (~8–10 m/s):

```ts
const SNOW_STAGE_SPEED = { 0: 8.0, 1: 10.0, 2: 12.0, 3: 14.0 }
```

Result on mobile: **no perceptible change on any terrain**, including
walking on stage 3 (14 m/s applied). This rules out a min-speed floor —
mobile does not appear to be reading the component at all, regardless of
value.

### 4. Cross-scene comparison

Checked `flagtag` (sibling scene, mushroom power-up):

- Uses the identical API: `AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, {...})`.
- Writes the full struct (`walkSpeed`, `jogSpeed`, `runSpeed`, `jumpHeight`,
  `runJumpHeight`, `glideSpeed`, `doubleJump`) rather than just the three
  speed fields.
- No mobile-specific branch or fallback.

If flagtag's mushroom boost works on mobile, then either the fuller struct
matters, or the direction (speed-up vs slow-down) matters. If flagtag's
mushroom does NOT work on mobile, this is a general client-side gap for the
whole component.

**This confirmation is still outstanding.** See "Before filing" below.

## Working hypothesis

The Decentraland mobile Explorer build does not honor
`AvatarLocomotionSettings` writes from a scene, or honors only a subset of
its fields, while the desktop Explorer does. `InputModifier` on the same
entity is honored correctly on both platforms.

## Alternative hypotheses (ranked)

1. **Mobile ignores `AvatarLocomotionSettings` entirely.** Best fit for the
   observed evidence. Would predict flagtag's mushroom boost is also silent
   on mobile.
2. **Mobile requires the full field set** (jumpHeight, glideSpeed, etc.) and
   silently drops writes that are missing fields. Would predict flagtag's
   mushroom boost works on mobile because it sets everything. Testable by
   writing the full struct from snowdrift.
3. **Mobile only reacts to speed *increases* from the client default,
   ignoring decreases.** Partially contradicted by the 8/10/12/14
   diagnostic — none of those decreases below 14 were felt either — but not
   fully ruled out because the baseline stage-0 was also above default in
   that test. Testable by writing e.g. `runSpeed: 30` and seeing if the
   sprint is felt.
4. **Some other snowdrift-specific component is fighting the write** (e.g.
   `frost/death` writing `InputModifier` on a different cadence). Searched
   for other writers of `AvatarLocomotionSettings` in `src/` — none found.
   Low probability but not conclusively ruled out.

## Before filing the bug

Do these in order — each is quick and each meaningfully sharpens the report.

1. **Capture the mobile client build/commit.** Note whichever Explorer is
   being tested (Unity Explorer, Bevy Explorer, DCL Mobile, launcher build,
   etc.) and its version string. Without this the report is not actionable.
2. **Test flagtag's mushroom boost on mobile.** If it feels identical with
   vs without the boost, we have a clean universal repro that is not
   snowdrift-specific. If it does feel faster, hypothesis (2) or (3)
   becomes primary and we need the extended diagnostic below.
3. **Extended diagnostic in snowdrift (only if flagtag mushroom works).**
   Temporarily write the full struct from `applyStageProfile` (add
   `jumpHeight`, `runJumpHeight`, `glideSpeed`, `doubleJump`) and re-test.
   Then separately try `runSpeed: 30` to test hypothesis (3).
4. **Test against a deployed build, not just preview.** Preview and
   production sometimes use different transport paths. If the deployed
   Snow Drift on `snowdrift.dcl.eth` behaves the same on mobile, that's
   noted in the report; if it behaves differently, that itself is useful.
5. **Minimal repro scene.** ~20 lines: on load, set
   `walkSpeed: 1.0, jogSpeed: 1.0, runSpeed: 1.0` on `engine.PlayerEntity`
   and nothing else. Confirm on mobile that movement is not slowed. This
   is the artifact the Decentraland engineer will actually run.

## Where to file

- **GitHub:** the appropriate Explorer repo based on which client build was
  tested. Candidates:
  - `decentraland/unity-explorer` — https://github.com/decentraland/unity-explorer/issues
  - `decentraland/bevy-explorer` — https://github.com/decentraland/bevy-explorer/issues
- **Discord:** cross-post a short note in `#sdk` on the Decentraland Discord.
  A maintainer will usually confirm within a day whether it's a known gap.

## What to include in the report

- Client build / commit (from step 1 above).
- SDK version: `@dcl/sdk@7.26.1-31714079767.commit-96e9a29`.
- Expected: `AvatarLocomotionSettings.walkSpeed/jogSpeed/runSpeed` changes
  the player's movement speed on mobile as it does on desktop.
- Actual: no change on mobile regardless of value.
- Repro: the minimal-repro scene from step 5.
- Evidence that other components on the same entity (specifically
  `InputModifier`) do take effect on mobile, ruling out sync/targeting.
- Note that a scene with a real use case for this API (Snow Drift's snow
  drag mechanic) has to fall back to a physics-based drag layer to work on
  mobile.

## Scene-side path forward while waiting on the client fix

Even after the bug is filed, this will likely take weeks or months to reach
a released mobile build. Recommended: ship "Option B" — a physics-based drag
fallback using the player-physics API (`applyContinuousForce` or a
repulsion-field pattern) that layers on top of the existing
`AvatarLocomotionSettings` writes. Physics forces move the player on both
desktop and mobile because they bypass the locomotion pipeline and push the
CharacterController directly. Desktop gets a small double-effect (slightly
heavier than intended); mobile finally gets the drag. See the
`player-physics` skill for the API.

## Files touched during investigation

- `src/client/locomotion.ts` — added `DIAG_LOG_INTERVAL_S` heartbeat logging
  and reverted temporary speed values. Both should probably stay in place
  until the client fix ships, so playtesters can confirm from the console
  whether the gate is working.
