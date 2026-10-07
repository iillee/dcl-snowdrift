# Compressed world gen — 52×52 playtest (+ volcano)

*Written 2026-10-06. Locked with lean V1 slice plan. No code in this doc — design only.*

**Purpose:** Redesign seed/terrain generation so a ~quarter-size playtest world still delivers the full loop: Grove 1 → wilderness → Grove 2 → wilderness → volcano win. Keep the 100×100 path intact as a separate config.

**Current baseline:** `settings.ts` derives grid from scene/playfield (today 100×100 → ~98×98 terrain cells). `generateTerrain(seed)` builds mountain band, levels, hearth disc, landform stamps, ladders, then **destinations** that feed groves. Grove 1 home is **not** a destination socket today — only the far green destinations are. Volcano does not exist yet.

---

## Config (do first in code later)

- Add an explicit **world profile**: `playtest_52` vs `full_100` (names flexible).
- Profile owns: parcel/scene size, playfield meters, padding, derived `TERRAIN_GRID_*`.
- Rule: **one generator, two envelopes** — same pipeline, profile-scaled radii/counts/distances. Do not fork a second generator.
- Prefer changing scene/playfield constants (and whatever Hub/CLI deploy needs) over hacking cell size.

---

## Economic layout (progression structure, not a corridor)

Target structure on the small map:

1. **Grove 1 — Starting territory** (hearth + teaching pits) — safe home; tuned so resource pressure hits ~**3–5 game days** (test tuning).
2. **Wilderness A** — sparse deadwood + some dormant fires (discoveries, not breadcrumbs).
3. **Grove 2 — Expansion territory** — far enough that relocating beats hauling home; economically “operate from here.”
4. **Wilderness B / harder geography** — more elevation friction; expedition feel.
5. **Volcano objective** — strategic destination, **not** a grove.

Still procedural: alternate routes, cliffs, ladders, basins/ridges/plateaus. The list is the **economy/progression skeleton**, not a forced path. Skilled groups may bypass Grove 2.

---

## Where the volcano goes (plan this in generation)

Treat volcano as a first-class generator output, e.g. `MajorDestination { type: 'volcano' | 'grove', … }` (or parallel to grove destinations).

**Placement constraints (every seed must satisfy or retry):**

- Significantly separated from spawn/hearth (largest route distance class on the map).
- Not overlapping Grove 1 or Grove 2 sockets (min separation in cells/meters — tune with sprint).
- On interesting elevation (prefer High / mountain-adjacent rim reading) so it reads as a landmark.
- Reachable: walkable path via existing ladder graph (no stranded volcano).
- Visually prominent: silhouette readable from some High overlooks / distant ridgelines.
- Prefer opposite half of the map from Grove 2 so the loop is expand-then-objective, not “volcano next door to Grove 2.”

**Not:** Grove → Volcano → Grove alternating. Groves = where you live; volcano = why you expand.

**Validate:** connectivity + hearth clearance + ≥1 region above/below + Grove1 + Grove2 + volcano all placed → else `seed + 1` retry (same pattern as today).

---

## Scaling knobs when shrinking ~4× area

Roughly quarter area ⇒ distances and counts must come down or the middle feels empty / sessions run long.

| System | Direction for playtest profile |
|---|---|
| Destinations / major groves | **2** major grove territories (plus hearth home) |
| Grove wood pools / longevity | Shorten Grove 1 so migration happens in-session |
| Dormant fires | **Increase density**; keep snow dimple clue; no trail |
| Deadwood | Keep sparse; expedition fuel only |
| Landform stamps | Keep vocabulary; shorten stamp distances from hearth |
| Ladder / route length hearth→Grove2→volcano | Fit ~30–45 min competent 2–3p session |
| Mountain band thickness | Scale with envelope so playable interior isn’t eaten |

Open (carry from terrain-plan): 16 m vs 8 m level step; closed mountain box vs ragged rim — decide only if the small map makes arena-feel worse.

---

## Out of scope for this gen pass

Sprint restore, torch readability UI, activation/thaw/win VFX — those follow after the map skeleton is placeable. Activation itself stays cheap (feed wood) and does not change generator layout.

---

## Success of the gen redo

A fresh seed on `playtest_52` always yields: playable connected map, visible volcano landmark, Grove 2 worth migrating to, and a path a group can finish in one test session — without scripting a single linear corridor.

---

## Related

- Lean V1 slice plan (conversation 2026-10-06)
- `design/terrain-plan.md`
- `design/checkpoint-2026-10-07-geography-migration.md`
- Direction update: compressed full-loop prototype
