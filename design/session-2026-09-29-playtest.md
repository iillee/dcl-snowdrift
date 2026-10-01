# Session record — what shipped for the 9/29 playtest

*Written 2026-09-29. Supersedes the build-status lines in [`session-2026-09-24-phase-clock.md`](./session-2026-09-24-phase-clock.md) and the plan in [`session-2026-09-25-wood.md`](./session-2026-09-25-wood.md). Those files stay as history. Layout, the ? menu, and seeds moved on 2026-09-30: [`session-2026-09-30.md`](./session-2026-09-30.md).*

v1 systems that are still unbuilt stay unbuilt: seasons, solstice, pine, kiln, communal pile, empty-server persistence, return-screens. Freeze-in-ice and the first torch thaw shipped after this note. The end-of-run rule moved on 2026-09-30.

---

## Load and the day

- Cold open is solid black, centered white line **Don't let the fire die**. It holds until the player is laid down at the fire and the snow and cliffs are up, then fades. Mid-game rebuild covers stay black with no line.
- Gold **Day N** shows on every sunrise, and on join for the day the world is already on. The first player starts dawn, so they see Day 1. A later joiner sees the world's current day even if it is not sunrise. A new run is Day 1 again. The ? panel later dropped everything but the day, the clock, and one line. Day number is `cycleId + 1`. "After the last fire dies" as the trigger was superseded on 2026-09-30.
- Playtest clock: Dawn **0:12**, Day **2:00**, Dusk **0:15**, Night **1:00**. Night pressure still starts at dusk (faster drain, heavier weather, weaker flame). A lit torch stays 3 cells wide. The night melt pinch is unused.

## Wood

- No respawning log at the hearth. One F slot.
- A branch feeds the fire for **30 s**. A log feeds it for **60 s**.
- Branches, and a few logs, scatter in the snow. The model appears only where the snow is fully melted. Branches sit on the ground slab, laid flat.
- Six trees stand around the hearth, not on one ring. Distances: **64 m** (close), **96 / 88 / 104 m** (mid), **144 / 168 m** (far). The far pair needs a rest or a shared light. The torch lasts 30 s. Melted snow is a jog of about 8 m/s.
- Each tree holds **4** logs. There are no log models under the trunk. Within **5 m**, with an empty F slot, a gold **CHOP WOOD** chip appears on that slot (same pattern as Light Torch / Feed Fire). Each chop takes one log. The tree scales to 75%, 50%, 25%, then hides. Empty the slot before the next chop.
- Picking wood up plays a larger log or stick over the head.

## Warmth

- A blue flash covers the screen when a cold segment fills on the heat bar.
- While a fire is refilling the bar, a gold wash breathes once per segment (a full thaw is 45 s, so about 4.5 s a breath). When the bar reads full, the wash fades out and stays off.

## Death

*Superseded 2026-09-30. The lines below are what this session shipped. The current rule is freeze-in-place, a torch thaw, and a run that ends only when everyone still connected is frozen and no fire is left. See [`session-2026-09-30.md`](./session-2026-09-30.md).*

- Personal frost failure this day: the torch goes out, the fuel stays, you wake at camp. Carried wood is not dropped at the body.
- Last fire out this day: carried wood is lost, the torch is emptied (unlit, no fuel), the world reseeds. Ember-fail cards play on black. The next dawn is Day 1.
