# Cryogenia — the plain-English version

*A short read of the current design. Full source of truth is [`gdd.md`](gdd.md); this is the reader on-ramp. Last synced 2026-09-22.*

> **Working title:** *Cryogenia* (pivoted from *Snow Drift* — IP self-check). Repo, package, and world URL still say `snowdrift` while the rename is pending final title lock.

---

## What it is

Cryogenia is a **persistent shared-world survival roguelike** for Decentraland, set on Earth at the edge of the Cryogenian freeze (Snowball Earth, ~720 million years ago).

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

## Where this is going

- **v1** (this build) — prove the gameplay. Two biomes, one functional discovery, one mystery discovery, persistent civilization model, procgen recombination, the seasonal reversal, the solstice.
- **v1.5** — expand the discovery pool. **Coal mine** biome (rarer, longer-burning). **Ancient fuel cache** discovery (pre-processed premium fuel, ties into ignition-manual lore). More mystery discoveries. Named graves. Longer lore prose.
- **v2** — the volcano ignition network. The v1 loop scaled up: tending fires becomes waking volcanoes. Successful civilizations physically transform geography — snow retreats, ice fractures, new terrain opens. The final answer to *"why is it winter?"* — and the win condition: **break the cycle. End the ice age.**

Torch → Hearth → Volcano. Same verb at three scales.
