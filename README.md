# Snow Drift

A shared-world winter survival game for Decentraland.

> **Melt the snow to find wood. Feed the fire to survive the night. Twice a real day the equinox tests whether "together" was enough.**

One frozen planet, one central hearth, one shared clock. Every player who logs in is in the same world on the same in-game day. Keep the fire fed and the day-count climbs. Let it die with no one around to save it, and the next player to arrive spawns into a fresh Day 1 — with a splash telling them which day the world was lost on.

**Deploy target:** [`snowdrift.dcl.eth`](https://play.decentraland.org/?realm=snowdrift.dcl.eth) (Decentraland World)
**Runtime:** SDK7 (`@dcl/sdk` 7.26.x, pinned exact) with authoritative headless server
**Scene:** 32 × 32 parcels (512 m × 512 m), portrait-friendly mobile-first UI

---

## The pivot

Snow Drift began as a cozy hangout with a 24-hour world reset. The design has since pivoted to a **shared-time survival game** with tidal progression, a persistent world day-count, and a scheduled storm event (the *equinox*) twice per real day. Design work lives in [`design/`](design/):

- [`design/gdd.md`](design/gdd.md) — full GDD (submission-ready)
- [`design/summary.md`](design/summary.md) — 5-minute plain-English review
- [`design/decisions.md`](design/decisions.md) — running log of design decisions
- [`design/hypothesis-log.md`](design/hypothesis-log.md) — hypotheses parked for playtest

The existing implementation (torch, snow melt, wood pickup, hearth feed, chain-lighting, authoritative server, mobile perf) is the foundation the survival loop is being built on top of.

## How it plays (v1 target)

- Spawn cold at a lit central hearth. HUD shows day counter, countdown to next night, shared wood quota.
- Grab a torch. Its warmth melts snow beneath you as you walk, revealing buried wood.
- Bring wood back to the fire. Quota bar ticks. Fire brightens.
- Night falls, cold accelerates, everyone huddles and feeds the flame until dawn.
- Twice per real 24 h at fixed UTC times (target 08:00 / 20:00), the **equinox** storm hits — longer, colder, harder. Survive it and the world enters a short grace period.
- Fire dies with no one around → world sits dead until the next player logs in and triggers a Day 1 reset.

## What's shipping in v1 (4 weeks)

- Full survival quota loop (gather → feed → survive → day++).
- Two scheduled equinox events per real day.
- Persistent world day-count and all-time high score, both visible on the hearth.
- World reset on next-player-return after fire death.
- **Day 10 territory unlock** — NE satellite pit thaws.
- **Day 30 tool unlock** — torch fuel duration +30%.
- **Block redesign + level visual development** — art pass on hearth, torch, wood, and satellite pit dressing plus environment-layout tuning, lifting the world from greybox to a cohesive winter-survival look.
- Discord integration for equinox announcements, milestones, and world-reset notices.

Cut from v1 to keep the loop tight (returning in v1.5): lore/story fragments, named survivor plaques, Day 20+/Day 75+/Day 100 unlocks. The v2 aspiration is the *melt* win-condition — the community activates ancient tech, the planet's orbit corrects, snow melts, grass returns.

## Status

Vertical slice playable. Cozy-hangout loop (torch → melt → wood → feed → warmth) closed end-to-end. Chain-lighting between players shipped. Authoritative server, mobile perf, and 24 h regeneration all live. Survival pivot in progress — see [`docs/survival-pivot-plan.md`](docs/survival-pivot-plan.md) and [`docs/PLAN.md`](docs/PLAN.md).

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
design/      # GDD, summary, decisions, hypotheses (design pivot)
docs/        # plan, vision, bug reports, handoffs, archived design
```

Entry point routing (`src/index.ts`) uses the **async** `isServer` from `~system/EngineApi` — the sync helper starts as `false` and would cause the headless server to take the client branch and crash. Do not change this.

## Style

Code style and agent conventions: [`AGENTS.md`](AGENTS.md).
