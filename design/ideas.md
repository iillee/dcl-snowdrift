# Parked ideas — Cryocene

Unjudged. Dated + attributed. Nothing gets lost.

---

- **2026-09-24 · death drops carried wood at the corpse · not taken** — Owner chose the opposite on 2026-09-29. Personal death keeps the wood. World death deletes it. See [`decisions.md`](decisions.md).
- **2026-09-09 · banner tagline candidate · agent-drafted, near-miss at §1** — *"You woke up cold. There's a fire. It's dying. Everyone else here is trying to save it, and twice a real day the storm returns."* — reads like a trailer opening; too much scene-setting for the §1 promise cap, but works as a store-page or Discord banner line.
- **2026-10-28 - auto new winter after the ending - open.** After a day or a few warm days show "Winter Approaches" and roll a new seed; the classic victory flow in `stations.ts` / `cycle.ts` could be reused. Today, before the ending, the run resets when no campfire and no torch is lit; after the ending only a player's BEGIN NEW EXPEDITION (60 s shared countdown) or the dev roll button resets it.
- **2026-10-28 - entity-count readout (debug HUD) - open.** Needed to measure mobile with the enlarged finale oases; `node scripts/finaleCheck.mjs` estimates are in `docs/HANDOFF.md` section 9 (`compact_3` vegetation ~437 -> ~1760 entities; standard 6 oases ~900 -> ~3590). First oasis alone: ~120 entities each.
- **2026-10-28 - plants along the finale corridors - dropped.** The snow corridors under the finale beams were removed the same day (the synchronized pulse and enlarged oases replaced them), so there is nothing to plant along. If entity cost bites: distance culling for bushes and rocks, thinner ring caps.
- **2026-10-28 - more wood types (pine, maple, oak, yew) - parked.** `WOOD_TYPES` in `ruleset.ts` is the data table; only logs exist.