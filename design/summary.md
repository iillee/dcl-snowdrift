# Cryocene — the plain-English version

*A short read of the current design. Full source of truth is [`gdd.md`](gdd.md); this is the reader on-ramp. Last synced 2026-09-22.*

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

- **First 30 seconds.** You spawn at the central hearth. Others are here (or their traces are — melted paths, banked wood, still-warm fires). You grab a torch from the hearth pile.
- **First 5 minutes.** Step out. Melt snow. Reveal wood chunks (kindling scatter everywhere; deadwood clustered around dead trees; pinewood clustered around pines). Fell a tree by holding torch heat at its base until it falls. Carry logs back. Feed a fire.
- **Session shape.** Gather → tend → hold territory → decide which fires matter → make it to the next solstice.

## The three nested loops

Cryocene runs on three interlocking cycles, each with its own pressure and payoff:

- **Day / night cycle (micro, minutes).** The heartbeat of the game. Dawn resets frost; day is for gathering and expanding; dusk is the regroup beat; night is when fires drain fastest, cold bites, and players huddle for warmth. Every session lives inside this rhythm — it is what makes *"one more day"* the natural stopping point.
- **Seasonal / yearly cycle (meso, in-game days).** Autumn → early winter → deep winter → solstice approach → winter solstice → thaw → spring. Each season plays as a distinct strategic phase (Expand → Prepare → Consolidate → Hold → Survive → Reclaim → Expand). The solstice is the peak.
- **Civilization cycle (macro, hours to days of real time).** One shared run per world, persistent across sessions, ends when the last fire dies. Whoever witnesses extinction sees the reset; the next seed rerolls geography.

Same verb at three scales: tend the torch through the night, tend the network through the winter, tend the civilization across many winters.

## The world model — persistent civilizations, finite worlds

- **One shared civilization per world.** Every player in the scene is part of the same run.
- **World state persists between logins.** Log off Day 17, come back to Day 28. Every session start shows a personal *"while you were gone"* summary of what changed.
- **Offline continues at full rate.** If nobody is online, fires keep draining. Most civilizations don't last forever — that's the point.
- **Civilization ends when the last fire dies.** Not when the hearth dies — if the hearth falls but a satellite anchor is still lit, the community migrates there, and the oldest surviving fire becomes the new home. Only extinction (last fire out) triggers a new-world seed.
- **The new seed rerolls geography.** Biomes, discoveries, fire placements, hazards — all different. Rediscovery is the reward for the loss.

## Geography is the tech tree

The v1 world contains, arranged procedurally per seed:

- **Wilderness** (baseline terrain, sparse kindling scatter).
- **Deadwood Grove** biome — clustered dead trees, deadwood logs. Reliable **quantity** fuel.
- **Pine Grove** biome — clustered pines, pinewood logs. Efficient **quality** fuel.
- **Cabin / Charcoal Kiln** discovery — a ruined cabin with a kiln that converts deadwood into charcoal. Charcoal is **portability** fuel — one carry slot delivers ~5 minutes of fire instead of ~2, making long expeditions and remote-anchor upkeep tractable.
- **Ancient Station foreshadow** (mystery discovery, ~50% of seeds) — a partially buried structure that hints at something much larger. Torch can't activate it. The *"what the hell is this?"* beat that seeds v2.

Three fire types anchor the network: the central **spawn hearth**, **biome anchors** (one per biome/discovery), and **rest stops** (2–3 procgen fires supporting the corridors between them).

## The rules that make it hard

- **The world's fuel is finite.** Every tree has a fixed budget (~3–5 logs). No respawn within a run. Depleted trees leave permanent stumps. Long civilizations play out against a visibly depleted map.
- **Fires drain. Cold accumulates.** Winter compounds every axis: nights lengthen, snow deepens, fire drain accelerates.
- **The solstice is the boss beat.** Whiteout, doubled night, cold at peak. Communities that lose territory beforehand face it with fewer fires.
- **Territory = redundancy.** Every satellite fire is a potential last home. Territorial expansion isn't just capability; it's insurance.

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

- **v1** (this build) — prove the gameplay. Persistent civilization model, seasonal reversal, tree-mining, fuel tiering, Kiln, solstice, extinction reset. Core scope: one biome + Kiln; Reach scope: two biomes + Kiln + Ancient Station foreshadow.
- **v1.5** — expand the discovery pool. **Coal mine** biome (rarer, longer-burning). **Ancient fuel cache** discovery (pre-processed premium fuel, ties into ignition-manual lore). More mystery discoveries. Named graves. Longer lore prose.
- **v2** — the volcano ignition network. The v1 loop scaled up: tending fires becomes waking volcanoes. Successful civilizations physically transform geography — snow retreats, ice fractures, new terrain opens. The final answer to *"why is it winter?"* — and the win condition: **break the cycle. End the ice age.**

Torch → Hearth → Volcano. Same verb at three scales.
