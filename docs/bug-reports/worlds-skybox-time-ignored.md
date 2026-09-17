# SkyboxTime.fixedTime is ignored on Decentraland Worlds

**Reported by:** Snow Drift team (snowdrift.dcl.eth)
**Status:** open, reproducible
**Severity:** blocks any scene that needs a dynamic time-of-day
**Environment:**

| Field | Value |
|---|---|
| SDK | `@dcl/sdk@7.26.1-32860802198.commit-dae48fb` (pinned exact) |
| Deploy target | Decentraland World (`snowdrift.dcl.eth`) |
| Content server | `https://worlds-content-server.decentraland.org` |
| Local preview | Creator Hub bundled preview |
| Reproduced on | 2026-09-17 |
| Working branch | `daynight-cycle` in this repo |

---

## Summary

Writing the `SkyboxTime` component to `engine.RootEntity` has **no effect** on the rendered sky or on `getWorldTime()` when the scene is deployed to a World. The component is *accepted* — its presence correctly defeats the player time-of-day UI slider — but the `fixedTime` value it carries is completely ignored by the Worlds runtime.

The **same code** works exactly as documented in local Creator Hub preview.

`scene.json > skyboxConfig.fixedTime` (the static, deploy-time equivalent) DOES work on Worlds, but is not dynamic — it locks the sky to a single baked value with no runtime control.

Net effect: on Worlds today it is impossible to implement a dynamic day/night cycle, seasonal skybox drift, solstice events, or any other runtime-driven sky change through the documented SDK7 API.

---

## Reproduction

Minimal repro (paste into any SDK7 scene's `src/index.ts`):

```ts
import { engine, SkyboxTime, TransitionMode } from '@dcl/sdk/ecs'
import { getWorldTime }                       from '~system/Runtime'
import { executeTask }                        from '@dcl/sdk/ecs'

export function main() {
  // Write once, at scene start, to a distinctive value (06:00 dawn).
  SkyboxTime.createOrReplace(engine.RootEntity, {
    fixedTime     : 21600,
    transitionMode: TransitionMode.TM_FORWARD,
  })

  // Log what the runtime says every second.
  let acc = 0
  engine.addSystem((dt: number) => {
    acc += dt
    if (acc < 1) return
    acc = 0
    executeTask(async () => {
      const t = await getWorldTime({})
      console.log(
        `RUNTIME=${t.seconds.toFixed(1)} ` +
        `LOCKED=${SkyboxTime.has(engine.RootEntity)} ` +
        `WRITTEN=21600`
      )
    })
  })
}
```

Ensure `scene.json` does NOT contain a `skyboxConfig.fixedTime` (leave it as `"skyboxConfig": {}` or omit).

### Local preview (Creator Hub)

- Sky visibly shows dawn (06:00 sun position and colours).
- Log line each second: `RUNTIME=21600.0 LOCKED=true WRITTEN=21600`
- Player UI time-of-day slider is disabled (correct).

### Worlds deploy (`snowdrift.dcl.eth`)

- Sky visibly renders as **daytime blue** \u2014 not dawn.
- Log line each second: `RUNTIME=` some value entirely unrelated to 21600, drifting slowly at DCL default 2 h cycle rate.
- `LOCKED=true` (component IS present on RootEntity).
- Player UI time-of-day slider IS disabled (component-presence lock still works).

The component is received. `fixedTime` is silently discarded.

---

## Additional verification

We also tested:

1. **Continuous 10 Hz writes** with directional `transitionMode` and modular shortest-path selection. Same result on Worlds: `LOCKED=true`, `RUNTIME` continues drifting at default 2 h cycle rate ignoring every write. In preview the same code drives a clean full 24 h skybox sweep in 8 min.
2. **`scene.json > skyboxConfig.fixedTime` alone**. Works on both preview and Worlds. Sky locks to the JSON value, player UI defeated, `SkyboxTime.has(RootEntity)` is `false` (the JSON path does not surface as a component).
3. **JSON `fixedTime` present AND component writes at 10 Hz**. On preview the component wins (documented behaviour). On Worlds the JSON wins and component writes are ignored.

So the failure is specifically the `SkyboxTime` component's `fixedTime` field being non-functional in the Worlds runtime.

---

## Impact

For Snow Drift specifically, this blocks:

- Any runtime day/night cycle at a cadence different from DCL default (2 h real per skybox day).
- Independently tunable day / night durations (design goal 2 of the phase-clock work).
- Seasonal skybox drift (autumn -> winter solstice -> spring lighting shifts).
- Solstice event (planned climax with a locked deep-night sky and dramatic post-event dawn).

More broadly, any scene that uses `SkyboxTime` for atmosphere, story pacing, or gameplay-tied lighting is silently broken when deployed to Worlds. The failure is silent because the component write reports success and `LOCKED` reads true; the divergence only shows up in `getWorldTime()` and the visible sky.

---

## Empirical characterisation (bonus)

While isolating this bug we also characterised behaviours the SDK docs do not spell out. Sharing here in case any are actual bugs vs. intentional-but-undocumented:

1. **Per-frame `SkyboxTime.createOrReplace(...)` calls** perpetually reset the engine's smooth-transition interpolator; DELTA between requested and rendered time can climb to \u00b117 h before the interpolator catches up. Recommendation to document: batch writes and only apply on `fixedTime` changes above a threshold.
2. **`transitionMode` default `TM_FORWARD`** interprets any decrease in `fixedTime` as "advance forward N hours" and races through the whole clock. Callers must set `TM_BACKWARD` when writing a smaller value than the current, and pick shortest-modular-path around the midnight seam. Would benefit from a `TM_AUTO_SHORTEST` mode or auto-detection.
3. **`SkyboxTime.has(RootEntity)` is NOT true when the sky is locked via `scene.json > skyboxConfig.fixedTime`.** The two lock mechanisms are not equivalent in observability. Consider surfacing the JSON lock as a phantom component so scene code can uniformly ask "is the sky currently locked?".
4. **The "smooth transition over a few seconds" duration is undocumented.** We measured jumpy shadow motion at 500 ms write cadence and clean motion at 100 ms; celestial body direction appears to be a discrete function of the last-written `fixedTime` with no engine-side interpolation between writes.

---

## What we'd like

1. Confirmation that this is a Worlds runtime bug and a target fix version.
2. Guidance on any workaround short of Foundation-side fix. We currently plan to fall back to a static `scene.json` fixedTime and defer the whole day/night phase-clock milestone.
3. Long-shot: any preview of upcoming custom-skybox APIs (cubemap texture upload, tint control, sun/moon direction override). Design-doc-adjacent to this bug \u2014 the phase clock plans to feed seasonal art variations that a fixed sky can't express even when working.

---

## Contact

- Repo: `daynight-cycle` branch, root of Snow Drift project.
- Owner: Luke (creator of `snowdrift.dcl.eth`).
- Reproducing files: `src/client/skybox.ts`, `src/client/skyboxDebug.ts`, `src/client/ui/layers/layer.skyboxDebug.tsx`, `src/client/devFlags.ts` (`SHOW_SKYBOX_DEBUG`).
- To reproduce quickly: on the `daynight-cycle` branch, in `src/client/index.ts` uncomment the `setupSkybox()` and `setupSkyboxDebug()` imports + calls, flip `SHOW_SKYBOX_DEBUG = true` in `devFlags.ts`, deploy to any World, compare the on-screen overlay against local preview.
