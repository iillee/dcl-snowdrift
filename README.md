# Snow Drift

A cozy multiplayer survival hangout for Decentraland.

One campfire, one frozen world. Melt snow with your torch, gather wood buried underneath, feed the fire to keep it — and yourself — alive. Warmth is shared: light passes between players torch-to-torch, and the world remembers what you did until it resets at dawn (midnight UTC).

**Deploy target:** [`snowdrift.dcl.eth`](https://play.decentraland.org/?realm=snowdrift.dcl.eth) (Decentraland World)
**Runtime:** SDK7 (`@dcl/sdk` 7.26.x, pinned exact) with authoritative headless server
**Scene:** 32 × 32 parcels (512 m × 512 m), portrait-friendly mobile-first UI
**Submission:** [Friendzone Buildathon](https://dorahacks.io/) — deadline 2026-09-04

---

## Status

Vertical slice playable. Core loop (torch → melt snow → gather wood → feed fire → stay warm) closed end-to-end. 24 h world regeneration shipped. Chain-lighting between players shipped. Mobile perf confirmed on real devices every update.

- Build plan and change log: [`docs/PLAN.md`](docs/PLAN.md)
- Design vision (post-implementation): [`docs/gameloop-vision.md`](docs/gameloop-vision.md)
- Code style: [`AGENTS.md`](AGENTS.md)

## Running locally

```bash
npm install
npm start              # preview client
npm run auth-server    # (separate terminal) local authoritative server
```

## Deploying

```bash
npm run deploy
```

Note: if the CLI proxy errors out on Node 24, deploy from the Creator Hub app UI — it uses its own Electron-embedded signing flow that bypasses the broken proxy path.

## Repository layout

```
src/
  client/    # rendering, input, UI, VFX, audio, frost, maze, props
  server/    # authoritative state, roster, spawners, cycle, weather
  shared/    # components, messages, pure logic shared by both
assets/      # models, images, audio, source files
docs/        # plan, vision, bug reports, archived design
```

Entry point routing (`src/index.ts`) uses the **async** `isServer` from `~system/EngineApi` — the sync helper starts as `false` and would cause the headless server to take the client branch and crash. Do not change this.
