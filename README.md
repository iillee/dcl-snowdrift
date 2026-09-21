# Snow Drift

A shared-world winter survival game for Decentraland.

> **Hold the light against the storm.**

Snow Drift is a co-op survival scene where fires create islands of warmth in a hostile snowscape. Days are for gathering wood and expanding the network of lit fires. Nights are for defending them — the storm pushes back, snow reclaims territory, fuel drains faster. Occasionally a **solstice** arrives: the longest, coldest night of the year. Only the best-tended fires survive it.

**Deploy target:** [`snowdrift.dcl.eth`](https://play.decentraland.org/?realm=snowdrift.dcl.eth) (Decentraland World)
**Runtime:** SDK7 (`@dcl/sdk` 7.26.x, pinned exact) with authoritative headless server
**Scene:** 32 × 32 parcels (512 m × 512 m), portrait-friendly mobile-first UI

---

> **Working title:** the GDD renames this to *Cryogenia* (IP self-check on "Snow Drift"). The repo, package, and deployment URL still say Snow Drift while the rename is pending final confirmation — see `design/gdd.md`.

## Design status

Snow Drift began as a cozy hangout, pivoted to a survival-quota loop, and is consolidating around **man-vs-storm territory survival**. One big design decision remains open and gets resolved via prototype during the v1 build:

- **Defense mechanic** — **LOCKED to multi-fire territory** (see GDD §0.1).
- **Retention model** — roguelike run vs. persistent-world calendar, prototyped and locked mid-Week 2 of the Spatialize + Fun phase.

**Source of truth is [`design/gdd.md`](design/gdd.md).** Everything else supports it:

- [`design/gdd.md`](design/gdd.md) — full GDD (submission-ready). §9 has the v1 build plan.
- [`design/summary.md`](design/summary.md) — plain-English overview
- [`design/decisions.md`](design/decisions.md) — running log of design decisions
- [`docs/v1-4week-plan.md`](docs/v1-4week-plan.md) — superseded by GDD §9; kept as a pointer
- [`docs/survival-pivot-plan.md`](docs/survival-pivot-plan.md) — earlier pivot design (partially superseded)

The existing implementation (torch, snow melt, wood pickup, hearth feed, chain-lighting, authoritative server, mobile perf, weather, day/night cycle infrastructure, paint-CRDT) is the foundation the survival loop is being built on top of.

## How it plays (v1 target)

- Spawn near a lit fire. HUD shows day + season + a countdown to nightfall.
- Grab a torch. Its warmth melts snow beneath you as you walk, revealing buried wood.
- Explore. Discover other fires on the map; light them to expand your safe territory. (Territory-defense mechanic pending Week 2 prototype decision.)
- Bring wood back to any lit fire. Each fire drains fuel independently and must be tended.
- Night falls, cold accelerates, players huddle at fires to keep them alive until dawn.
- Seasons progress. Winter deepens. Nights get longer, snow gets heavier, cold gets sharper — leading up to the **winter solstice**: the longest and hardest night.
- Survive the solstice with any fire still lit → the recovery seasons begin (thaw, spring). Fail with all fires dead and no one around → the world resets. That reset is a story ("winter reclaimed the village"), not a game-over screen.

## Design pillars

- **Man vs. storm, not man vs. mob.** No combat in v1. The enemy is cold and snow.
- **Fire = safety, distance = stakes.** Emotional center is huddling around light together.
- **Multiplayer scales the design, doesn't gate it.** Solo is barely-viable; groups thrive.
- **Failure is a story, not a game-over screen.** Resets are events in the world's history.
- **Players help fires, not hurt them.** No extinguish action, no fuel drain — no grief vectors by construction.

## What's shipping in v1

Bookended by 9/23 (v0 sign-off + v1 launch) and 10/27 (submission). Five themed phases, pace flexible — see GDD §9 for details:

| Phase | Theme | One-line pitch |
|---|---|---|
| **1** | **Systems** | *Time, weather, and cold behave like a world.* |
| **2** | **Spatialize + Fun** | *Geography becomes the tech tree. Decide what a "run" is.* |
| **3** | **Depth + Holes** | *One good pattern, repeated. Sharp edges filed off.* |
| **4** | **Solstice + Game Loops** | *The peak moment and the loops that lead into and out of it.* |
| **5** | **Polish + Ship** | *Look, sound, and pitch.* |

Concrete deliverables include: day/night phase clock with server-time authority; full seasonal cycle (autumn → early winter → deep winter → solstice approach → winter solstice → thaw → spring); sleeping-ember failure model (60 s relight grace); empty-server run/world reset; multi-fire territory with fire dormancy and off-territory hostility; pine grove biome as first geography-as-tech-tree payoff; winter solstice event (warning → whiteout → recovery); level visual redesign; and a multiplayer playtest in the Solstice + Game Loops phase.

Meta-progression across cycles (some carry-forward on a "territory held" success tier) is **direction-locked but form-deferred** — scoped in Polish + Ship if scope allows, otherwise v1.1.

## Non-goals (v1)

No combat / mobs, no leaderboards, no permadeath, no tool tiers, no personal gear, no NPCs, no wallet-gated content, no trailer work until Week 4.

## Status

Vertical slice playable. Cozy-hangout loop (torch → melt → wood → feed → warmth) closed end-to-end. Chain-lighting between players shipped. Authoritative server, mobile perf, and 24 h regeneration all live. Survival pivot in progress against the plan in [`docs/v1-4week-plan.md`](docs/v1-4week-plan.md).

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
design/      # GDD, summary, decisions, hypotheses
docs/        # plan, vision, bug reports, handoffs, archived design
```

Entry point routing (`src/index.ts`) uses the **async** `isServer` from `~system/EngineApi` — the sync helper starts as `false` and would cause the headless server to take the client branch and crash. Do not change this.

## Style

Code style and agent conventions: [`AGENTS.md`](AGENTS.md).
