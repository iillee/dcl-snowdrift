# Session record — wood loop for the 9/29 playtest

*Written 2026-09-25, Friday morning. Builds on [`session-2026-09-24-phase-clock.md`](./session-2026-09-24-phase-clock.md).*

Branch: `feat/wood-loop`, cut from `feat/phase-clock`. Do not merge to `main` while the snow review is on main.

Two Foundation devs are in parallel: one on further load optimization, one on the deployed-scene skybox. Nico (2026-09-25): a prod fix by Tuesday is unlikely, because it would have to land Monday. Do not wait on it. For this playtest the phase countdown is the old gold clock box, to the right of the frost bar (`layer.cyclePanel.tsx`), always on, reading `DAY  2:00` / `DUSK  0:15` / `NIGHT  1:00`. No clock icon. Temporary until Foundation fixes Worlds ignoring `SkyboxTime.fixedTime`: re-assert `SkyboxTime` every frame so the deployed skybox controls stay disabled, and switch only two times — night when the clock hits DUSK, noon at dawn. Day/night screen overlays are removed for the live test. When the bug is fixed, drop the pin and follow the phase-table sky again.

---

## Already done this morning

- Live clock counts nights. `noteEnteredPhase` runs from the tick and from the dev advance, so a real wipe can say “after N nights.” Fail cards used to stay on the zero-night line unless someone pressed the debug button.

---

## Core, in order

Stop when these are in and a trip is feelable. The cut list below waits on that.

1. **Remove the respawning hearth log.** It sits 2.5 m south of the fire and returns 10 s after pickup. One log is +60 fuel-seconds, so camping it feeds about +6/s. Solo night drain is 2/s. While it exists, nobody has to leave.
2. **Clock, after one timed trip in preview.** Start from Day **2:00** / Dusk **0:15** / Night **1:00**. The torch is 30 s and wood peaks near 50 m, so a 60 s day is one rushed attempt. If a real first trip is ~20 s, shorten the day before locking it. Durations stay the constants in `src/shared/phase.ts`.
3. **Death drops the carried log at the body.** Personal death stays cheap: torch out, wake at camp. The tax is the wasted trip. No permadeath, no dusk lock.
4. **Put a share of the existing one-shot wood in the 15–35 m ring** so one torch can finish a trip. Leave the far scatter. No in-run respawn. Ordinary snow going empty is what makes a tree matter.
5. **If the above is stable: a few authored dead trees.** Same log you already carry. About **4** logs buried under the tree, stump when the cluster is gone. One tree inside a single torch radius, one farther out. No fell-the-trunk interaction. The flame, the ring, and the tier are the reserve. No second pile yet.

Untended solo hearth at 2:00 / 0:15 / 1:00 still dies on night 1. The cycle burns about 210 fuel-seconds and the fire starts at 150. One log banked before dusk barely sees dawn. Two is a reserve.

---

## Advance only after the core is feelable

In this order:

1. **Communal stack beside the hearth**, only if Tuesday-or-sooner play shows nobody can read “stocked” off the flame. Pile means later, flame means now. Skip it while the flame already reads.
2. **Two burn values.** Weak kindling in ordinary snow, stronger deadwood at trees. Same one carry slot. No pine.
3. **Ice-block rescue.** Full frost becomes a block for ~15 s. A lit torch held close for 2–4 s thaws them in place. No rescue: drop the log, ~15 s more, respawn at the hearth. Do not add zero-heat respawn unless people still die on purpose to get home.

---

## Leave alone

Seasons, Pine Grove, Kiln, Ancient Station, procgen, persistence, extra meters, a night minigame, kindling refill, hidden-fire retune. Touch a hidden fire only if a group is clearly living at one instead of the hearth.

---

## Tuesday questions

- Did they go out again on purpose?
- The clock box already told them the phase. Separate note, not a success test: did weather, the shrinking torch, or the faster drain also register?
- Once they believed the night was covered, what did they do?
- When someone froze holding wood, did they care, and did anyone die to get home?
- Did simultaneous melting stay stable? Four people is enough for the loop. A 10–20 player pass is the load session, separate from this list.
