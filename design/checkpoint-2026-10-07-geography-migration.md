# Checkpoint — Geography & Migration (target Wed 2026-10-07)

*Owner sketch reviewed 2026-10-04. Folds playtest findings into the next build slice. Does not replace [`spatialization-plan.md`](./spatialization-plan.md) (v1 biomes / Kiln); that plan stays the longer Spatialize target. This file is the **immediate** geography test.*

Related: [`session-2026-10-05.md`](./session-2026-10-05.md) (100×100 authored + mobile parcel clamp), [`session-2026-10-04.md`](./session-2026-10-04.md), [`gdd.md`](./gdd.md) §3 Scale / Pillars 3–4, [`decisions.md`](./decisions.md).

---

## What playtests already proved

Do **not** redesign the survival loop this week.

Observed (small multiplayer, ~1 h, ≤3 concurrent):

- Trees → wood is intuitive.
- Freeze is learned after one experience; teammates rescue.
- Wood economy pushes exploration; local exhaustion is felt.
- Multiple fires divide labor and fuel — understood even when satellites are rare.
- Hidden fires are hard to find and hard to keep fed.
- After the accessible area is empty, there is **nowhere meaningful to migrate toward**.

Working loop today:

> Fire → consume wood → exhaust local resources → travel farther → cold risk → cooperation / rescue

Desired next loop:

> Fire → depletion → distant opportunity → expedition → foothold → migration → new territory

**Primary design goal:** turn *"we ran out of wood and died"* into *"we ran out of wood, so we moved."*

This is a **geography problem**, not a new-mechanics problem. No quest saying "go find more wood." Success is someone looking across the landscape and saying: *"There are trees over there. We need to go there."*

---

## Oct 7 success criterion

From an **exhausted** starting hearth (artificially deplete if needed — do not wait an hour):

1. **Can I see somewhere worth going?** At least one environmental clue of opportunity.
2. **Can I navigate there without a map?** Major terrain helps; it does not only obstruct.
3. **Does distance feel dangerous?** Leaving fire territory still matters.
4. **Do intermediate fires become strategic?** "We should keep this one alive."
5. **Does the destination justify the journey?** Survival situation materially improves.
6. **Can I return?** Recognizable geography orients the way home.

---

## In scope (priority order)

### P1 — Configurable world dimensions

Authored playtest is **100 × 100** (`scene.json` + settings; Worlds content server verified). Size must stay a setting (parcels + `SCENE_*` / playfield knobs), not buried constants.

- **Mobile blocker (H1-07, 2026-10-05):** Explorer on phone reports only **51 × 51** parcels for the same World desktop sees as 100 × 100 — hearth sits ~10–18 m from the NE edge on mobile. Phone geography playtests are blocked until that client fix lands (or we temporarily author a ≤50×50 envelope — not the preferred path).
- **Gameplay constraint:** a full torch must **not** casually reach the world edge. The map should feel like wilderness, not an arena whose walls are psychologically reachable.

### P2 — Snow LOD cheaper with distance (iterate, don't trash)

Larger maps cannot multiply today's near-field cost. Build on the **2026-10-04** coarse far sheets (32 / 64 / 128 m far from melt).

Target ladder (distances tuned in play):

| Band | Role |
|---|---|
| Near player | High-detail meltable snow |
| Mid | Aggregated / lower detail |
| Far | Very large inexpensive white surfaces |
| Horizon | Minimal geometry for a continuous freeze |

LOD should be **relative to the local player**, not only the hearth. Principle: **reduce detail with distance, preserve information with distance.** Far snow can be almost nothing; far **destinations** cannot.

### P3 — Macro geography (hierarchical, not more random cliffs)

Do **not** spray the current random cliff ring across a bigger square.

Generate (or author for this checkpoint) hierarchy:

> World → macro landforms → regions → routes / passes → fire sites → resources → local detail

Wanted vocabulary in play: pass, ridge, basin, shelf, corridor, dead end, open plain, mountain-like mass.

**Oct 7 pragmatism:** one clear **direction of opportunity** (ridge / pass / corridor + destination) beats a half-finished full hierarchical generator. Prove migration first; generalize the generator next.

### P4 — Resource destinations (not concentric bands)

Starting area: enough wood to establish civilization and survive a meaningful period — still **exhaustible**.

Outside: several meaningful **concentrations**, ordinary trees/wood only (no new resource types this week). Uneven directions — different economic value. At least one distant concentration **visually identifiable** from far away (dark mass → grove → trees → harvestable wood).

### P5 — Reposition fixed satellite fires (no build-anywhere)

Keep the fixed fire system. Move satellites onto **routes and territories**: passes, sheltered valleys, near peripheral concentrations, crossroads, under landmarks.

> Resources create the destination. Fire makes occupation possible.

Hidden fires become strategic discoveries, not arbitrary collectibles. They need not be obvious from the hearth.

### Preserve distant geography

Major formations are **navigation infrastructure**. Do not unload all cliffs at distance.

| Tier | Examples | Visibility |
|---|---|---|
| Horizon landmarks | Major mountains, huge cliff masses, future volcano sockets, very large groves | Extreme distance, ultra-cheap proxies OK |
| Navigation landmarks | Ridges, significant trees, smaller cliffs, shelters, fire/smoke | Substantial but shorter |
| Local gameplay | Wood pieces, snow cells, small rocks, fire interaction | Drop quickly |

Silhouette > detail for horizon proxies.

---

## Explicitly out of scope until after Oct 7

Unless required to ship the geography test: crafting, camp upgrades, build-anywhere fires, pine, charcoal/kiln, coal, food/hunger, fishing/hunting, mobs/combat, wildlife, artifacts, lookouts, shelters, seasons, seasonal snow accumulation, moon cycles, volcano gameplay, major progression systems.

---

## Future direction (backlog — not Oct 7 work)

Parked so geography leaves room for them. Full owner sketch retained in conversation / this section.

### Migration as a central characteristic

Establish → exhaust → explore → foothold → migrate → old territory abandoned → next horizon.

Civilization is wherever its surviving people and fires are. Abandoned regions can keep evidence: stumps, dead fires, melted paths, excavated ground.

### Player-created fires — later, not default

`wood + lit torch → fire anywhere` is intuitive and supports migration, but risks deleting *Fire = safety, distance = stakes* if every grove gets a disposable fire. **v1 keeps fixed fires.** Kindling a **new hearth** should feel like a transformational discovery/tech, not a starting verb.

### Avoid Valheim-style camp upgrade trees

Permanent hearth investment pushes *establish → improve → stay*. Cryocene is more interesting as *establish → exhaust → explore → migrate*. Future tech via exploration/discovery, not elaborate base crafting.

### Peripheral biomes = capability, not more of the same

Deadwood → Pine → Kiln/charcoal → coal / ancient infrastructure → volcano / climate intervention. **Geography is the tech tree.**

### POI sockets

Lookout (survey without a map), buried night shelter (expedition refuge, not a second home), artifacts that only matter when carried across the map, ancient infrastructure. Prefer questions over loot.

### Hazards that use existing meters

Deep snow, wind corridors, cold pockets, whiteouts — cold + fire + movement + geography + time before new bars.

### Wildlife without "man vs mob"

Tracks, avoid strong fire, pressure weak fire, force grouping when far from warmth. Passive can be sightings. No hunger just because animals exist.

### Seasons as two exaggerated states first

Thaw vs deep winter: day length, cold, weather, sun path, accessibility. Same map should feel larger/safer in thaw and smaller/hostile in winter.

### Environment as UI

Sun, sky, snow depth, melt scars, firelight, mountains — simulation before HUD. Return screen: atmospheric "while you were gone," not analytics spam.

### Retention & progression philosophy

Prefer *"I want to know what happened to our world"* over login rewards and permanent power. World accumulates capability; player accumulates biography.

---

## Immediate decision rule

Until Oct 7, for any task ask:

> Does this help us test whether resource exhaustion can produce migration across meaningful geography?

If yes, prioritize. If no, backlog.

**The next build does not need more features. It needs somewhere to go.**
