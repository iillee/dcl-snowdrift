# Snow Drift

A cozy multiplayer survival hangout for Decentraland.

A single campfire is the only warm thing in the world. Players melt snow — carving revealed paths through a field of white extruded cubes — to gather wood, feed the fire, and stay warm together. You can carry a torch or an axe, but not both, so the game only works when someone else is there. Warmth is contagious: stand near another player and you both last longer in the cold.

**Deploy target:** [`snowdrift.dcl.eth`](https://play.decentraland.org/?realm=snowdrift.dcl.eth) (Decentraland World)
**Runtime:** SDK7 (`@dcl/sdk` 7.26.x) with authoritative headless server
**Scene shape:** 8 × 8 parcels (128 m × 128 m, square)

---

## Status

Early WIP. Build plan lives in [`docs/PLAN.md`](docs/PLAN.md). A proper design document will be written once the core loop is playable.

## Running locally

```bash
npm install
npm start        # preview
npm run auth-server   # (separate terminal) local authoritative server
```

## Deploying

```bash
npm run deploy
```

## Repository layout

```
src/
  client/    # rendering, input, UI, VFX, audio
  server/    # authoritative state, roster, spawners
  shared/    # components, messages, pure logic shared by both
assets/      # models, images, audio, source files
docs/        # plan and (eventually) design docs
```

See [`AGENTS.md`](AGENTS.md) for code style conventions.
