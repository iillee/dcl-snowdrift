# Session record — phase clock + last-fire wipe

*Written 2026-09-24. Start a **new chat** for Monday’s wood pass. Point that session at this file plus [`gdd.md`](gdd.md) and [`decisions.md`](decisions.md).*

The snow-rewrite notes in [`session-2026-09-24-optimization-complete.md`](./session-2026-09-24-optimization-complete.md) are still true for snow. This file is the live product handoff.

---

## Calendar

- **Owner away:** 2026-09-26–27 (sister’s wedding).
- **Build day:** Monday 2026-09-28 — **wood**. Make gather → carry one → bank → night drain a trip you can feel in one day/night.
- **Playtest:** Tuesday 2026-09-29. Primary question: is the day/night loop a game, or a waiting room?
- **v1 submit target:** 2026-10-27 (unchanged).

Do not start seasons, fog, empty-server persistence, or biomes on Monday unless wood is already fun.

---

## Where the repo is

- **Branch:** `feat/phase-clock` (commit after the 2026-09-24 docs pass).
- **Do not use** the old `optimization` branch.
- **Do not commit** `.cursor/mcp.json` (local Creator Hub / Explorer MCP; tokens change per launch).

---

## What shipped this session

### Clock

- Server-owned phase clock: `DAY` (60 s) → `DUSK` (10 s) → `NIGHT` (60 s). Shared table in `src/shared/phase.ts`.
- `SOLSTICE_WARN` / `SOLSTICE` / `GRACE` exist as unused rows. Do not enter them yet.
- Skybox follows the phase. Sky change is the time sign. Do not pin midnight or fight SkyboxTime for darkness.
- `cycleId` increments on wrap; **Day number = `cycleId + 1`**. `resetToDay` sets `cycleId = 0` so a new civilization is Day 1.

### Night pressure (from dusk, not from a later night pin)

- Fire drain 2× from dusk.
- Torch melt cap 1 tile; weaker flame.
- Weather snaps toward HEAVY and will not sit fully CLEAR.
- Frost / torch leak scale off the night row.
- Shift-run stays off. Heat only from **your lit torch** or a **visible campfire**. Huddle warmth is gone (`torchWarmth.ts` deleted).

### Last fire

- Spawn hearth fuel can hit zero (`FUEL_MAIN_FLOOR = 0`).
- Last lit fire out → all clients fade to black (ember-fail three-card copy) → new seed while black → hold last line until load-ish, then fade in.
- `snowdrift.png` splash is **cold-open only**. Mid-run regen stays black.
- 60 s sleeping-ember and dormancy are **not** in. Non-last fires currently just go out.

### Day UI

- Help panel: large **Day X** at the top; phase countdown under **Now**. No 24 h rebuild line.
- Gold **Day X** splash at each sunrise (skip join hydration and ember-fail).
- No always-on `DAY  3:42` HUD chip.
- Spectator **+** / **–** dock left of the eye with absolute position so the default top HUD does not shift. Glyphs nudged up 8 px.

### Snow / load (same session, secondary)

- 16 m LOD planes, cubes near player / melt (48 m keep, 16-cell pad). Planes receive shadows, do not cast.
- Snowfall particles start **stopped**, arm after snow settled + perimeter ready.
- Ember-fail load bar was tried and removed (percent width never moved). Fallback hold 48 s.

---

## Phase 1 score (honest)

About **a third** of the Systems checklist; closer to **half** if you only ask “does a session feel like a world.”

| Box | Status |
|---|---|
| DAY / DUSK / NIGHT clock | In |
| Last-fire wipe (in-scene) | In |
| Night pressure from dusk | In enough to playtest |
| Snow LOD / delayed flakes | Started |
| Debug (advance phase, roll seed) | Mostly there |
| Seasons | Not started |
| Weather-per-season | Not started (weather follows *phase*) |
| Fog | Not started |
| Sleeping-ember / dormancy | Not started |
| Empty-server persistence / return-screens | Not started |
| Content pools | Not started |
| H1-06 8-player mobile gate | Not run. Envelope still 32×32. |

---

## What Monday should build

1. **Wood as a loop** — find, carry one, bank at the fire, see the fire eat it faster after dusk. Enough that night is “defend the pile,” not “stand in the dark.”
2. **Death drops carried wood at the corpse** — if wood is in. Personal death stays cheap (fade, torch out, wake at camp). The tax is the wasted trip. Do **not** add permadeath or a dusk lock.

Do **not** invent night minigames. If night is still empty after wood, shorten night or raise drain.

---

## What to watch on 2026-09-29

1. Do people go out by day and come home at dusk, or treat night like day with worse weather?
2. When someone dies with wood, do they care?
3. If nobody tends, does the world end before people get bored?

---

## Code map (new / hot)

| Path | Role |
|---|---|
| `src/shared/phase.ts` | Phase table + helpers |
| `src/server/phase.ts` | Authoritative clock, `resetToDay` |
| `src/client/phase.ts` | Mirror + dawn splash hook |
| `src/shared/emberFail.ts` | Fail copy |
| `src/server/emberFail.ts` / `src/client/emberFail.ts` | Last-fire FSM |
| `src/client/daySplash.ts` + `layer.daySplash.tsx` | Sunrise title |
| `src/client/ui/layers/layer.helpPanel.tsx` | Day X header |
| `src/client/ui/layers/layer.brushSize.tsx` | Spectator zoom docked on the eye |
| `src/client/snow/snowRenderer.ts` | Planes + keep-near-player |
| `src/client/snowfall.ts` | Arm after load |

---

## If something looks wrong

- Clock stuck at 0:00: `phaseAgeSec` must be a number, not a Date via `Schemas.Number`.
- Day splash on join: hydration must not call `beginDaySplash`.
- Day splash after wipe: `cycleId` drop skips the splash; ember-fail owns the screen.
- HUD gone after torch attach: never parent Gltf + particles to `CameraEntity`.
- See-under planes while running: raise player-keep / melt pad, do not jump to 32/64 m merges yet.

---

## Style

`AGENTS.md` at repo root: tabs, `MARK:` comments, absolute `src/...` imports, no silent failures.
