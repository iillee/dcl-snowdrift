# Cryocene — the plain-English version

*A short read of the current design. Full source of truth is [`gdd.md`](gdd.md); this is the reader on-ramp. Last synced 2026-10-04.*

> **Title locked 2026-09-23:** *Cryocene* (pivoted from *Snow Drift* — IP conflict). Repo, package name, deploy URL (`snowdrift.dcl.eth`), and CRDT component IDs still use `snowdrift` — these are infrastructure identifiers that would break live state or require a new DCL NAME to change. All user-facing surfaces now say Cryocene.

---

## What it is

Cryocene is a **persistent shared-world survival roguelike** for Decentraland, set on Earth at the edge of the Cryogenian freeze (Snowball Earth, ~720 million years ago).

Players wake in a village around a central hearth. They melt snow with torches to reveal wood, feed the fires, tend a network of satellite fires that hold territory, and try to survive winter — culminating in a **winter solstice** event that tests how much of the fire network the community can hold.

The pitch:

> **Hold the light against the storm.**

## The three-horizon fantasy

> *Stay home and you can survive today.*
> *Expand and you may survive the winter.*
> *Keep pushing the frontier across many winters and you may discover how to end the ice age.*

## How a session actually plays

- **First 30 seconds (playtest build).** Black screen: "A new hearth is kindled." / "Don't let the fire die." You wake by the hearth. Day 1 if you started the world; otherwise the world's current day. Light the torch at the fire.
- **First few minutes (playtest build).** Melt snow to reveal a branch (30 s) or a log (60 s). Wood sits out to the far trees, and never on a cliff. Or walk to a tree and chop: four logs, the tree shrinks, then it is gone. One thing in the F slot. Feed the fire. The flame shrinks as the fuel does, and the warmth shrinks with it. Six hidden fires grow outward from the hearth in steps of 48–80 m, so the far trees have a place to rest. A full frost bar freezes you in the ice. Another player's lit torch can thaw you.
- **v1 target, not in this build.** Kindling everywhere, deadwood and pine around groves, fell a tree by holding torch heat, charcoal at a kiln.
- **Session shape.** Gather → tend → hold territory → decide which fires matter → make it to the next solstice.

## The three nested loops

Cryocene runs on three interlocking cycles, each with its own pressure and payoff:

- **Day / night cycle (micro, minutes). Shipped.** Dawn, day, dusk, night. Day is for gathering. Dusk is the regroup. Night is when fires drain fastest and the cold bites. Players gather at the fires. Warmth comes from a lit torch or a campfire, not from standing near each other.
- **Seasonal / yearly cycle (meso). Planned, not in this build.** Autumn → early winter → deep winter → solstice approach → winter solstice → thaw → spring.
- **The run (macro). The end condition is shipped. The empty-server half is not.** One shared run per world. It ends when every player still connected is frozen and no fire is left. A fresh seed follows. Persistence across an empty server, and a "while you were gone" screen, are still planned.

Same verb at three scales: tend the torch through the night, tend the network through the winter, tend the run across many winters. The winter and the many-winter scales are the v1 target.

## The world model

**Shipped now**

- **One shared run.** Every player in the scene is in the same winter.
- **A live server keeps that winter.** Leave and come back to the same seed, the same day, the same fires. A new server start draws a fresh seed. So does every regen. That is not the UTC-day layout, and it is not the unbuilt empty-server save.
- **Freeze is personal. Extinction is the run.** You freeze in the ice where you stand. A lit torch can thaw you. A lit fire wakes the frozen. No fire, and no one left standing, and the run ends. Someone still moving can relight a dark fire and recover the group.
- **The fire you see is the fire you get.** Fuel sets the flame size, the melt ring, and the warmth rate together. The smallest flame still heats. From dusk it loses to the cold. Wood is what makes it safe.
- **Wood is finite inside a run.** Nothing grows back until the world regenerates.

**Planned, not in this build**

- **World state survives an empty server.** Log off Day 17, come back to a later day. A personal "while you were gone" summary. Offline advance at full rate.
- **Oldest surviving fire becomes the new home** if the hearth falls and another fire is still lit. That migration is not built. What is built is simpler: any lit fire is a way back for the frozen.
- **A new seed rerolls the long-term geography** (biomes, discoveries, hazards). The playtest already rerolls trees, buried wood, and the six hidden fires.

## Geography is the tech tree

*Planned v1 layout. The playtest world is the shorter map in [Where the build is](#where-the-build-is-2026-09-30).*

The v1 world contains, arranged procedurally per seed:

- **Wilderness** (baseline terrain, sparse kindling scatter).
- **Deadwood Grove** biome — clustered dead trees, deadwood logs. Reliable **quantity** fuel.
- **Pine Grove** biome — clustered pines, pinewood logs. Efficient **quality** fuel.
- **Cabin / Charcoal Kiln** discovery — a ruined cabin with a kiln that converts deadwood into charcoal. Charcoal is **portability** fuel — one carry slot delivers ~5 minutes of fire instead of ~2, making long expeditions and remote-anchor upkeep tractable.
- **Ancient Station foreshadow** (mystery discovery, ~50% of seeds) — a partially buried structure that hints at something much larger. Torch can't activate it. The *"what the hell is this?"* beat that seeds v2.

Three fire types anchor the network: the central **spawn hearth**, **biome anchors** (one per biome/discovery), and **rest stops** (2–3 procgen fires supporting the corridors between them).

## The rules that make it hard

- **The world's fuel is finite. Shipped in the playtest as four logs a tree, and buried wood that does not grow back.** The longer form is a budget of about 3–5 logs and a stump left standing. That stump is not in this build. The tree hides when it is empty.
- **Fires drain. Cold accumulates. Shipped.** A weaker flame warms less. Winter lengthening the nights is still planned.
- **The solstice is the boss beat. Planned.** Whiteout, doubled night, cold at peak.
- **Territory = redundancy. Partly shipped.** A lit fire is a way back for anyone frozen. The older "oldest fire becomes the new home" migration is still planned. Expansion is insurance either way. Standing near each other is not warmth.

## What's *not* in the game

- No combat, no mobs, no NPCs.
- No leaderboards, no personal power progression, no gear tiers.
- No inventory beyond torch + one carry slot.
- No world map, no minimap, no crafting menu, no unlock notifications.
- No hunger/thirst/cooking. Cold is the only survival axis.
- No wallet-gated content in v1.

## What players carry forward

- **The world accumulates capability** — day counts, records, communal state.
- **Players accumulate biography** — worlds witnessed, solstices survived, discoveries credited to them, places where they froze.

No individual gets stronger. Everyone shares the same starting capabilities. The story is what changes.

## Where the build is (2026-10-04)

Phase 1 **Systems** is underway. The playtest World is **64 × 64 parcels** (1024 m) with coarse far snow LOD. The day/night loop and wood trip out to the far trees are live. Scatter density is still the old 32 × 32 tuning.

**Playable now:** Dawn / Day / Dusk / Night; night pressure from dusk; mortal spawn hearth; fuel tiers from Ember to Roaring (flame, ring, and warmth move together; Ember still heats and loses to the night); melt-to-reveal branches and logs out to 160 m, clear of cliffs; six choppable trees with uneven gaps (chop reach scales with size); six hidden fires grown in generations off the hearth; one carry slot; freeze in ice, with a first-pass torch thaw (desktop elevates ice on mobile peers); a lit fire wakes the frozen; the run ends only when everyone connected is frozen and no fire is left, then three cards and a fresh seed (wood lost, torch emptied); a new server start is also a fresh seed, and a live server keeps the world in progress; Day N on join and at sunrise; three gold segments when you wake at a fire; black cold open; ? menu is Day N, the phase and its countdown, and "Don't let the fire die"; phone mute in the old + slot, overhead zoom under the pan pad, off-screen face finder; gold warmth pulse while the bar refills; coarse far snow sheets.

**Not yet:** seasons, solstice, sleeping-ember / dormancy, oldest-fire-becomes-home, empty-server persistence, return-screens, pine, kiln, communal pile, hold-torch-to-fell. 100 × 100 envelope. Scatter retune for 64 × 64.

**Handoff:** [`session-2026-10-04.md`](./session-2026-10-04.md). Earlier: [`session-2026-09-30.md`](./session-2026-09-30.md), [`session-2026-09-29-playtest.md`](./session-2026-09-29-playtest.md).

## v1 build plan — at a glance

The v1 build has **two scope tiers**: a **Reach** target (full ambition, ~175–255 estimated solo-with-AI hours) and a **Core** committed deliverable (5-week solo-with-AI envelope, ~75–100 hours). We build toward Reach and ship Core. Anything from Reach that lands within the calendar is upside. Full detail in [`gdd.md`](gdd.md) §9.

### Condensed 5-phase reference

| # | Phase | Pitch |
|---|---|---|
| **1** | Systems | Time, weather, cold, and the persistent-civ backbone behave like a world. |
| **2** | Spatialize + Fun | Biomes + Kiln discovery on the map. Fuel tiers + charcoal portability. Fires anchor territory. |
| **3** | Depth + Holes | Hazards placed. Sharp edges filed off. |
| **4** | Solstice + Game Loops | The solstice is the moment. Day / year / reset loops all resolve cleanly around it. |
| **5** | Polish + Ship | Audio, UI, art, deploy. |

### Reach v1 — the ambition target

*What an 8–10-week calendar would deliver. Presented to reviewers as the vision; internally we build toward this.*

| # | Phase | Headline deliverables |
|---|---|---|
| **1** | Systems | World clock (day/night + seasonal cycle + weather-per-season + sleeping-ember + optional fog). Persistence backbone (serverless + CRDT + deterministic offline advancement + extinction reset). Debug commands. Four perf disciplines. Data-driven content pool scaffolding. H1-06 mobile perf gate on parcel envelope. |
| **2** | Spatialize + Fun | **Two biomes** (Deadwood Grove + Pine Grove). Charcoal Kiln discovery. Three-tier fuel (kindling / deadwood / pinewood) + charcoal portability. Three fire archetypes + dormancy. **Full procgen generator** (biomes, anchors, rest stops, hazards, Kiln per seed with invariants). Return-screens live. Balancing pass. |
| **3** | Depth + Holes | **Ancient Station foreshadow discovery** (~50% of seeds, mystery beat that seeds v2). Hazards. Holes list. Respawn logic. Discovery broadcast. **Day 100 lore cliffhanger** (aurora + fragment naming the first station location). |
| **4** | Solstice + Game Loops | Solstice event end-to-end. Seasonal cadence readable across seven strategic phases. Empty-server reset verified. **Meta-progression form picked + implemented.** Multiplayer playtest. |
| **5** | Polish + Ship | Full audio pass. UI unification. **Full block/prop art pass toward the Cryogenian look.** First-30-seconds onboarding. Cryocene rebrand assets. **Cinematic 60–90 s trailer.** Deploy → submit. |

### Core v1 — the committed deliverable (Foundation-facing)

*The honest 5-week scope. Every gameplay pillar still has at least one mechanical proof. What's cut is content redundancy and polish surface — not load-bearing verbs or systems.*

| # | Phase | Headline deliverables | Cut from Reach |
|---|---|---|---|
| **1** | Systems | *(Full Phase 1 scope — nothing cut. This is the load-bearing systems layer.)* | — |
| **2** | Spatialize + Fun | **One biome** (Deadwood Grove) + Charcoal Kiln. Fuel = kindling / deadwood / charcoal (two source tiers + portability variant). Tree-mining, per-tree budgets, three fire archetypes + dormancy. **Single authored 500 m layout with seeded variation** (positions shuffle within invariants). Return-screens (basic). Balancing pass. | Pine Grove → v1.1. Full procgen generator → v1.1. |
| **3** | Depth + Holes | Hazards. Holes list. Respawn logic. Discovery broadcast for Kiln. | Ancient Station foreshadow → v1.1. Day 100 lore → v1.1. |
| **4** | Solstice + Game Loops | Solstice event end-to-end. Seasonal cadence readable. Empty-server reset verified. Multiplayer playtest. | Meta-progression implementation → v1.1 (direction stays locked, form stays deferred). |
| **5** | Polish + Ship | Essential SFX only. UI unification. **Minimum-viable art:** unified palette + distinctive silhouettes for hearth / anchor / Kiln (the three landmarks). Cryocene rebrand assets. **60-second walkthrough capture** in place of cinematic trailer. Deploy → submit. | Cinematic trailer → walkthrough. Full block/prop art pass → v1.1. |

**Why the Core cuts are safe:** Pillar 4 (geography-as-tech-tree) is proven by *any two capability classes* interacting — Deadwood (quantity) + Charcoal (portability) is enough. Pillar 5 (finite fuel) fully lands with one biome. The Ancient Station is a nice-to-have mystery layer, not a gameplay-hypothesis proof. Meta-progression across cycles was always direction-locked, form-deferred. The three landmark silhouettes carry all the navigation-critical art; everything else can survive as greybox-plus for v1.

**What v1.1 picks up (priority order):** Pine Grove → full procgen generator → Ancient Station + Day 100 lore → meta-progression → full art pass → cinematic trailer.

## Where this is going

- **v1** (the target, not all of it in the playtest) — prove the gameplay. Shared mortal run, seasonal reversal, tree-mining, fuel tiering, Kiln, solstice, extinction when no one can bring the fire back. Core scope: one biome + Kiln; Reach scope: two biomes + Kiln + Ancient Station foreshadow.
- **v1.5** — expand the discovery pool. **Coal mine** biome (rarer, longer-burning). **Ancient fuel cache** discovery (pre-processed premium fuel, ties into ignition-manual lore). More mystery discoveries. Named graves. Longer lore prose.
- **v2** — the volcano ignition network. The v1 loop scaled up: tending fires becomes waking volcanoes. Successful civilizations physically transform geography — snow retreats, ice fractures, new terrain opens. The final answer to *"why is it winter?"* — and the win condition: **break the cycle. End the ice age.**

Torch → Hearth → Volcano. Same verb at three scales.
