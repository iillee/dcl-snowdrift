# Spatialization + Geography-as-Tech-Tree — working plan

*Working doc for the Spatialize + Fun phase of v1. When the design converges here, it folds back into GDD §3 (Pillars 5–6, Core Loop, Reveal table, Seasonal cadence, Scale and traversal).*

**Status:** draft v2 · 2026-09-22 · converging via owner review
**Related:** [`gdd.md`](gdd.md) §3, [`decisions.md`](decisions.md)
**Supersedes:** the 2026-09-22 v1 draft of this doc (which proposed torch tiers, meadow/scrub as biomes, and a mixed density/biome model — all replaced).

---

## 0. What we know works, what this doc locks

**Works (prototyped):** wood clusters around trees; the player learns to walk toward tree cover without any UI hint. The `hearthFuel` system already models fire fuel as burn-time seconds, with fire radius scaling from remaining fuel. Torch relight + chain-lighting between players ships in v0.

**Locked by this doc (owner review, 2026-09-22, multi-pass):**
- **Biome + discovery vocabulary split** (GDD Pillar 9): biomes are landscape (regions the community moves through); discoveries are landmarks (singular authored places the community finds).
- **v1 biomes** (2): Deadwood Grove + Pine Grove. Wilderness is the null baseline between biomes, not a biome.
- **v1 discoveries** (up to 2): **Cabin / Charcoal Kiln** (functional — portability logistics) + **Ancient Station foreshadow** (mystery — hints at v2). Kiln always present; Ancient Station appears in ~50% of seeds (proves per-seed presence/absence architecture).
- **Three-tier fuel system** (kindling / deadwood / pinewood) fed into the existing burn-time model; **charcoal** produced at the Kiln adds a 4th type optimized for portability, not tier.
- **Three fire archetypes** (spawn hearth / biome anchor / rest stop) with uniform decay. Every anchor fire attaches to either a biome (Deadwood/Pine) or a discovery (Kiln).
- **Fire-survives extinction rule** (GDD Pillar 6): civilization ends only when the last fire dies; oldest continuously-burning surviving fire becomes new home if hearth falls.
- **Persistent civilization model** (GDD Pillar 7): Multiplayer Server, world state persists between logins, offline continues at full rate, per-player return-screens on session start.
- **Procedural generation per new seed**; only the central spawn hearth is spatially constant.
- **Data-driven content pool architecture** (GDD Pillar 10): biomes, discoveries, fuel types, hazards all declared as data; generator reads pools. Adding v1.5+ content = authoring data, not rewriting systems.
- **Torches remain unchanged from v0** (no tiers, no crafting, no stubs — deferred to v2 exploration).

**The two design principles that carry this doc:**

> **Biomes are landscape. Discoveries are landmarks.** *(GDD Pillar 9)*
> **The world's fuel is finite. Every burn subtracts. Reset is the only renewal.** *(GDD Pillar 5)*

The first is the vocabulary split that structures every content decision. The second is the setting-consistent scarcity model: Cryogenia is Snowball Earth, nothing grows, trees are pre-freeze remnants with fixed budgets, no wood respawns in-run.

---

## 1. Design principles (inherited from GDD, not up for debate here)

- **Pillar 3:** Fire = safety, distance = stakes.
- **Pillar 4:** Geography is the tech tree. Reaching a place (biome or discovery) unlocks a capability.
- **Pillar 6:** Civilization survives while any fire remains — territory = redundancy, not just capability.
- **Pillar 9:** Biomes are landscape; discoveries are landmarks. Every content element resolves cleanly against this split.
- **Pillar 10:** Complexity from the world, not the verbs. One legible input; many geographic contexts. Data-driven content pools, not hardcoded scenes.
- **Two-hand rule:** Torch in one hand, one carry slot in the other.
- **Communal only:** Capabilities belong to the community's *map state*, not to inventories.

Additional principles locked by this doc:

- **Every fire is a decision.** No decorative fires. Every lit fire either extends the network or supports a corridor. If a fire has no strategic reason to exist, cut it.
- **Every content element is a biome or a discovery.** No third category. Any authored content that doesn't fit either bucket is a design smell — rethink until it does.

---

## 2. The fuel model — three tiers into the existing burn-time system

The existing `hearthFuel` system already models fire fuel as burn-time seconds; fire size and warmth radius already scale from remaining fuel. Nothing about this changes. What v1 adds is **three log types with distinct burn-value contributions**, plus applying the same model to biome anchor fires and rest stops.

### The three tiers

| Tier | Source | Burn added *(guess, playtest-tunable)* | Reading |
|---|---|---|---|
| **Kindling / brushwood** | Under-snow scatter, everywhere. Sparse. No above-snow signal. No in-run respawn. | ~30 s | *"Something is better than nothing."* Wilderness scavenging when you can't reach a grove. |
| **Deadwood log** | Felled Deadwood Grove trees (clustered). Fixed ~3–5 log budget per tree. No in-run regrowth. | ~2 min | *"The bread and butter."* Standard sustenance fire. |
| **Pinewood log** | Felled Pine Grove trees (clustered). Fixed ~3–5 log budget per tree. No in-run regrowth. | ~5 min | *"The premium fuel."* Covers most of a night on one log. |

**Rough ratios:** kindling / deadwood / pinewood at ~1 / 4 / 10 by burn-value. Playtest-tunable but meaningfully different at these ratios.

### Why this is enough to make Pillar 5 read

If a fire decays at 1 real-second per burn-second and drains ~1 log's worth of fuel per minute at rest:

- **Kindling-only:** feed every ~30 s. Constant babysit. Tender is pinned to the fire.
- **Deadwood-only:** feed every ~2 min. Calm. Tender can share duty.
- **Pine-fed:** feed every ~5 min. Breathing room. Gatherers can push far and return.

**That is the tech tree.** No new verbs, no new UI, no unlock notifications. A community that has pine can *breathe*. A community without pine is *grinding*. The gap between those two states IS the geography-as-tech-tree pillar in mechanical form.

### Fire size + radius as diegetic HUD

Because fire size and radius already scale from remaining burn-seconds, the model gives us readable state without a HUD:

- Big fire = safe. Gatherers see it from far away.
- Small fire = urgent. A shrinking radius is ambient panic.
- A pine log being deposited = visible leap in fire size, everyone nearby sees it. Social moment, no UI.
- A kindling deposit = a small bump. Legible-but-underwhelming, which is exactly the design intent.

---

## 3. Fire archetypes

Three types. Every fire is one of these; there are no "unpurposed" fires.

| Archetype | Count per seed | Decay | Ember grace | Sustains itself? | Its job |
|---|---|---|---|---|---|
| **Spawn hearth** | 1 (fixed at scene center) | Yes, but floors at "livable" (existing behavior) | N/A — never dies | Never fully dies; only its true death triggers world reset | The world's constant. The place you return to. |
| **Biome anchor** | 1 per biome (2 in v1) | Yes, uniform rate | 60 s (existing ember state) | No | Unlocks the biome's capability by enabling sustained presence in it. |
| **Rest stop** | 2–3 per seed, procgen | Yes, uniform rate | 60 s | No | Supports a torch/warmth corridor between hearth and biomes. |

**Uniform decay** means all non-spawn fires drain at the same rate, use the same fuel model, and enter the same ember grace when they hit zero. One rule for the whole system. Simpler to explain, simpler to build, simpler to balance.

**Rest stops earn their slot** by supporting corridor travel — they extend the effective torch/warmth range without extending capability set. During Autumn expand phase they're where the community pre-lights the paths. During Deep Winter a dying rest stop breaks a corridor, making that biome's anchor much harder to defend.

### Dormancy + reclaim

From GDD §0.1 (locked): a fire that fully dies without a relight becomes *dormant* (cold-but-not-dead). Dormant fires can be reclaimed with a wood cost (3–5 logs' worth). Only the spawn hearth's death triggers the world reset.

Dormancy applies uniformly to biome anchors and rest stops. Simmering embers (60 s window after fuel hits 0) is the last-chance relight; miss the window, it's dormant.

---

## 4. Biomes and discoveries for v1

Under the biome/discovery vocabulary split (GDD Pillar 9), v1's content pool is: 1 baseline terrain + 2 biomes + 2 discoveries (1 always-present, 1 per-seed).

### Wilderness (baseline)

Not a biome — the terrain between biomes. Sparse kindling scatter under snow, no above-snow signal, slow respawn. A player can walk anywhere in wilderness and eventually find kindling by melting; they cannot *thrive* there. The wilderness is what makes biomes matter.

### Deadwood Grove (biome, ships v1)

- **Above-snow signal:** bare standing dead trees, clustered.
- **Reveal:** deadwood logs, gathered from felled trees (see tree-mining mechanic below).
- **Per-tree budget:** ~3–5 logs, fixed. **No in-run respawn** (Pillar 8). Depleted trees leave permanent stumps.
- **Anchor fire:** one, placed procedurally at the biome's near edge (gateway position).
- **Tech reading:** "we have a reliable pantry — for now." Holding the anchor means the hearth stays fed on deadwood tempo *while the grove lasts*.

### Pine Grove (biome, ships v1)

- **Above-snow signal:** dark pine silhouettes (distinct from deadwood — this is the primary contrast the player learns to read).
- **Reveal:** pinewood logs, gathered from felled pines (see tree-mining mechanic below).
- **Per-tree budget:** ~3–5 logs, fixed. **No in-run respawn** (Pillar 8). Depleted pines leave permanent stumps.
- **Anchor fire:** one, placed farther from the hearth than the Deadwood Grove anchor.
- **Tech reading:** "we have the upgrade — while it lasts." Holding the anchor means the hearth stays fed on pine tempo — dramatically more comfortable — but the community is watching the grove deplete run by run.

### Tree-mining mechanic (v1, locked 2026-09-22)

Trees do not drop logs on approach. To gather wood, the player must first fell the tree by sustaining torch heat at the trunk base until it falls (~3 s target, playtest-tunable). This is an extension of the melt verb, not a new verb. Once fallen, the trunk yields its fixed budget (~3–5 logs).

**Downed-trunk gather visual — build-time decision, two options:**
- **(a) Shatter-on-fall:** the fallen tree resolves immediately into N pickup-able log entities on the ground.
- **(b) Progressive chunking:** the fallen trunk stays as one model; each pickup removes a chunk from the model until gone. More diegetic; higher art/rig cost.

Depleted trees leave permanent stumps for the rest of the run — a Day 80 world reads visibly lived-in, and by the 2nd–3rd solstice of a long run the map shows real scarcity pressure that forces outward exploration.

### Cabin / Charcoal Kiln (discovery, ships v1 — always present, LOCKED 2026-09-22)

**Locked tech: Charcoal Kiln (portability logistics).** Cocoa / map room / seasonal calendar alternatives retired. Decision C in GDD §0.1.

- **Above-snow signal:** ruined cabin with a stone chimney + partial walls, distinctive silhouette. The chimney is the kiln.
- **Anchor fire:** the chimney itself. Relight with a torch to activate the discovery.
- **Mechanic (uses existing verbs only — no new UI, no crafting menu):**
    1. Player carries deadwood to the kiln.
    2. Deposits several pieces into the kiln (target ratio ~3 deadwood → 1 charcoal).
    3. Ignites with a torch.
    4. After a processing timer, kiln produces charcoal (retrievable as a single carry-slot item).
- **Charcoal properties (starting guesses, playtest-tunable):** ~5 min burn per charcoal (vs. ~2 min per deadwood). Slight total-energy loss on conversion (3 deadwood = ~6 min raw → 1 charcoal = ~5 min processed). The *win* is portability: one carry slot delivers ~5 min of fire instead of ~2 min. Long expeditions, remote-anchor stockpiling, and reclamation become tractable.
- **Strategic role in the fuel triangle:** Deadwood = **quantity** (sustain), Pine = **quality** (efficiency), Charcoal = **portability** (reach). Three capabilities that solve different problems, not a linear tier.
- **Tech reading:** "we can operate farther from home." A civilization with a working Kiln can push into the frontier that unlocks more of the game.

### Ancient Station foreshadow (discovery, ships v1 — per-seed presence, LOCKED 2026-09-22)

The v1 mystery discovery. Present in ~50% of seeds (tunable) so the discovery pool architecture exhibits real per-seed presence/absence variability with only two discoveries authored.

- **Above-snow signal:** partially buried structure with distinctive silhouette — pipes, geometry, or symbols that suggest scale beyond what's visible. Large enough to be a landmark from ~100 m.
- **Interaction:** torch cannot activate it. Approaching produces mood/atmosphere (ambient sound, particle effect, subtle light). Nothing more.
- **No reward, no unlock.** The point is the *"what the hell is this?"* beat.
- **Placement:** procgen selects location per seed; may spawn inside the 500 m ring or (more evocatively) in the outer wilderness where reaching it is its own expedition. Never overlaps the Kiln.
- **Purpose:** seeds the v2 volcano-ignition-network arc diegetically. The desired reaction is curiosity + Discord chatter ("has anyone seen the big buried thing east of the pines?"). V2 eventually provides the answer.

### What is not in v1 (deferred to v1.5+)

Retained here as scope-fence. Split by the biome/discovery vocabulary so future authoring routes cleanly.

**Deferred biomes** (regions the community moves through):
- **Coal mine / coal field** (v1.5 headline biome, scarcity-ladder middle rung). Rarer than pine, longer-burning fuel. Above-snow signal: exposed black seam or pit-head structure. Placed outside the 500 m ring — a *destination* biome, not a corridor biome. The mechanical answer to Pillar 5's finite-wood pressure.
- **Peat bog** (v1.5+ alternate fuel biome).
- **Hot springs / geothermal region** (v1.5+ passive-warmth biome).
- **Frozen lake** (v1.5+ traversal biome; movement modifier + hazard).

**Deferred discoveries** (specific places the community finds):
- **Ancient fuel cache** (v1.5 companion to coal). Small rare ruin-flavoured sites; pre-processed premium fuel, no torch-melt-fell required. Ties directly into the §7 lore.
- **Watchtower, mine entrance, ancient storehouse, weather station** (v1.5+ functional discoveries).
- **Ancient ignition station** (v2, the volcano-network endpoint).
- **Frozen expedition, ancient marker, buried settlement, strange monument, ancient machine** (v1.5+ mystery/lore discoveries).

**Deferred infrastructure:**
- Portable compass (v2, volcano-station pointer)
- Kindling zone as a distinct biome (rejected — kindling lives in wilderness scatter)
- Any additional fire archetypes beyond 3

---

## 5. Procgen constraints — what the generator guarantees per seed

The world regenerates on hearth death (existing world-reset behavior). Each seed produces a fresh map with the following invariants:

**Fixed:**
- Central spawn hearth at scene center (0, 0)
- Baseline kindling scatter across all wilderness tiles

**Per seed (procgen, deterministic from seed):**

All placements below live inside the **v1 anchored network zone**: an inner ring roughly 500 m radius from the spawn hearth (see GDD §3 Scale and traversal). Outside 500 m is procgen wilderness — sparse kindling scatter, sparse deadwood, hazard belts, ambient LOD-friendly texture. The v1 loop closes entirely inside the 500 m ring.

- **Two biome regions** placed in a mid-ring band around ~350–450 m from the hearth, with minimum angular separation so they're not adjacent (encourages the community to *choose* which biome to push toward first).
- **One Cabin/Kiln discovery** placed at similar mid-ring distance, angularly separated from the two grove biomes (roughly opposite them).
- **One Ancient Station foreshadow discovery** per seed *if* the seed's roll includes it (~50% probability). Placement may be inside or outside the 500 m ring; never overlaps Kiln.
- **One anchor fire per biome + one at the Kiln** — three anchors total — positioned at each biome or discovery's near-edge (gateway position, ~350 m from hearth typical).
- **2–3 rest stops** on the paths between hearth and biome anchors, placed at torch-fuel midpoints (~150–200 m from hearth). Ensures that a torch from the hearth can reach a rest stop, and a torch from a rest stop can reach the anchor.
- **Deep snow / hazard belts** placed to add friction on biome-access paths (not blocking, just costly at night).
- **Wilderness tree/log clusters** scattered outside the 500 m ring — sparse, one-shot, low authoring load.

**Concrete distance targets (playtest-tunable):**

| Path | Distance | Walk time (DCL 6 m/s) |
|---|---|---|
| Hearth → rest stop | ~150–200 m | ~25–35 s |
| Rest stop → anchor | ~150–200 m | ~25–35 s |
| Hearth → anchor (via rest stop) | ~350 m | ~60 s |
| Anchor ↔ anchor (via hearth) | ~700 m | ~2 min |
| Full v1 network end-to-end | ~1 000 m | ~3 min |
| Frontier round trip (v1.5+) | ~1 500 m+ | ~4–5 min |

**Constraints the generator enforces:**
- Every biome anchor is reachable from the hearth via a rest stop on a fresh deadwood torch with margin (torch-fuel budget check per seed).
- Every rest stop is on a straight-ish path between hearth and an anchor.
- Biomes do not overlap.
- Every anchor is visually distinct from every other anchor (silhouette diversity guaranteed).
- All anchors + rest stops placed inside the 500 m inner ring; outer envelope reserved for wilderness texture.

**Reset behavior:**
- Hearth dies + server empty → world sits dormant (frozen state) until next player returns.
- Returning player triggers reset splash ("the world was lost on Day X") + new seed rolls.
- All biome positions, anchor positions, rest stop positions rerolled. Only the spawn hearth stays put.

---

## 6. Seasonal reversal — how winter takes the tech tree away, concretely

The GDD §3 seasonal cadence claims "winter reverses the tech tree." Here's the mechanical chain that produces the effect:

**Autumn (Expand):** All anchors lit. Full biome capability available. Fresh per-tree wood budget across every grove. This is where the community *acquires* the tech, and where fell-vs-defer decisions on individual trees start compounding.

**Early Winter (Prepare):** Fuel drain rate ↑. Roster still shifting. Community stockpiles at anchors, keeps rest stops fed to preserve corridors.

**Deep Winter (Consolidate):** Roster too small to tend all fires. **Choice: which anchor do we let sleep?** Letting the Kiln sleep loses charcoal-portability tech (moderate cost — long-range expeditions and remote-anchor upkeep get much harder). Letting the Deadwood Grove sleep drops the hearth to kindling tempo (moderate cost). Letting the Pine Grove sleep drops the hearth to deadwood tempo (large cost — hearth burns ~2.5× faster than before). Each sleep decision loses a different *capability class* (quantity / quality / portability). **The choice of which fire to let sleep IS the tech-tree decision, made under pressure.**

**Solstice Approach (Hold):** Everyone home. Corridors stocked. Decision from Deep Winter is now committed — you're holding whatever set of anchors that decision left you.

**Winter Solstice (Survive):** Realistically hearth + one anchor is the honest ceiling for small rosters. Pre-solstice choice of *which* anchor determines what wood tier is available during the whiteout push.

**Thaw (Reclaim):** Sleeping fires can be reclaimed at wood cost — drawn from what's left of the world's finite budget. *"First thing we're doing this spring is taking the pine back — no pine since Deep Winter."* The reclaim expedition IS the year's opening beat. The map itself does not regenerate; only the fires come back online.

**Spring (Expand again):** Full fire network restored (if wood remains). By this point in a long-running world, the community is looking at a map dotted with stumps and thinking about what happens when the last grove goes. That's the diegetic on-ramp to v1.5 coal / ancient stores. Next winter starts with less wood in the world than last winter did — the tension is real.

**Mechanical hooks required in code:**
1. Anchor + rest stop dormancy state (shared with hearth ember model — one implementation)
2. Reclaim-a-dormant-fire cost (3–5 logs, deposited to a dormant fire relights it)
3. Uniform 60 s ember grace window across all non-spawn fires
4. Per-tree finite wood budget (~3–5 logs) + torch-melt-fell interaction + downed-trunk gather + persistent stump entity. **No respawn timers.** The map's total wood budget resets only on world reset.

---

## 7. Legibility — how a first-time player learns this without UI

- **Trees as biome signal** (prototyped): dead-tree silhouette ≠ pine silhouette. Contrast on the skyline is the map. The player learns to walk toward whichever silhouette they need.
- **Fire size = fuel state** (existing behavior): big = safe, small = urgent. No number required.
- **Firelight columns visible through ice-haze** (GDD §7): anchor and rest-stop fires read as beacons at distance. A lit rest stop tells you the corridor is open. A dark one tells you it's cut.
- **Reveal pattern teaches biome identity:** melt in wilderness → sparse kindling, kindling, kindling. Melt near a dead tree → deadwood log (surprise beat: *"this place gives real fuel"*). Melt near a pine → pinewood (bigger surprise beat: *"this place gives a lot more"*).
- **Deposit feedback:** kindling deposit = small fire bump. Deadwood = bigger bump. Pine = leap. The player learns tier hierarchy by watching the fire respond.
- **Names emerge from player behavior, not signage.** The first time someone says "meet me at the pines," the landmark is real. Don't label it.

**Session-1 read target (Week 2 playtest):** by minute 10, a first-time player, unprompted, has walked to at least one biome, picked up a non-kindling log, and returned to feed a fire. Ask them after: *"Where did the pine come from?"* — answer names a **place** ("north where the pines are"), not a resource ("in the snow").

---

## 8. v1 ship list vs. deferred

### Ships in v1 (across Spatialize + Fun and Depth + Holes phases)

**Fuel + fires:**
- [ ] Three log types (kindling, deadwood, pinewood) as distinct wood pickups
- [ ] Burn-value constants for each type into the existing `hearthFuel` model
- [ ] Uniform decay + 60 s ember state applied to biome anchors and rest stops
- [ ] Dormancy state + reclaim-with-wood-cost for anchors and rest stops
- [ ] Fire size + radius scaling with remaining burn-seconds (existing behavior, verify applies to non-hearth fires)

**Biomes:**
- [ ] Deadwood Grove biome — clustered dead trees with per-tree wood budgets (~3–5 logs); tree-mining (torch-melt-fell + downed-trunk gather); persistent stumps
- [ ] Pine Grove biome — clustered pine trees with per-tree wood budgets; same tree-mining pipeline; persistent stumps
- [ ] Cabin / Charcoal Kiln discovery — ruin shell + relightable chimney; charcoal interaction wired in Phase 2 (uses existing verbs: carry → deposit → ignite → retrieve)
- [ ] Ancient Station foreshadow discovery (Phase 3) — authored buried structure; torch cannot activate; ~50% per-seed spawn probability
- [ ] Wilderness kindling scatter (baseline, sparse, one-shot; no in-run respawn)
- [ ] Deep snow / hazard belts on biome-access paths

**Fires:**
- [ ] Biome anchor fire at each biome's near edge
- [ ] 2–3 rest stops on paths between hearth and anchors

**Procgen:**
- [ ] Per-seed placement of biome regions, anchors, rest stops, hazard belts
- [ ] Reachability check: hearth → rest stop → anchor on fresh deadwood torch
- [ ] Reset behavior: world regens on hearth death + first-return trigger

**Game balancing (Phase 2 pass, playtest-refined through Phase 4):**

Every dial below has an interacting effect on the others. Lock starting guesses in Phase 2, playtest end-of-Phase 2, re-tune in Phase 3 "Holes," final polish in Phase 4 after solstice tests.

- [ ] **Fuel burn-values per tier** — starting guess: kindling ~30 s / deadwood ~2 min / pinewood ~5 min. Ratios ~1 / 4 / 10.
- [ ] **Fire decay rate** — uniform across non-spawn fires; drain enough per minute at rest that a pine-fed fire runs ~5 min unattended.
- [ ] **Ember grace duration** — 60 s across all non-spawn fires (locked v1).
- [ ] **Per-tree wood budget** — starting guess: 3–5 logs per tree, uniform across Deadwood and Pine (tier differentiation is burn-value, not budget size). Playtest to confirm the range doesn't feel arbitrary.
- [ ] **Total-world wood budget** — sum of per-tree budgets across all groves in a seed. Tuned **generous v1**: comfortable within a normal-length run; scarcity begins to bite by the 2nd–3rd solstice across long-running worlds, forcing outward exploration and (in v1.5) the search for coal / ancient stores. Track logs-burned as a fraction of world-budget in playtest to calibrate.
- [ ] **Tree-fell melt duration** — how long the player must hold torch at the trunk base before the tree falls. Starting guess: ~3 s. Too short = felling is trivial; too long = tedious. Playtest for the right friction.
- [ ] **Wilderness kindling density** — solo player scavenging kindling only can *barely* keep the spawn hearth alive at floor level. Density is the primary knob; too generous and biomes stop mattering, too sparse and solo is dead.
- [ ] **Torch fuel budget** — must span hearth → nearest rest stop with margin, and rest stop → nearest anchor with margin. Playtest confirms both paths.
- [ ] **Dormant-fire reclaim cost** — 3–5 deadwood-equivalent seconds' worth of fuel to bring a dormant fire back. Cheap enough to be reclaimable in Thaw, expensive enough that letting fires sleep in Deep Winter is a real cost.
- [ ] **Deep snow belt speed** — starting guess: –40% walk speed inside belt tiles.
- [ ] **Frost accumulation vs. warmth radius** — frost meter vs. distance-to-nearest-lit-fire curve tuned so that being *inside* a fire's radius fully halts accumulation and being *at the edge* is a slow drain.
- [ ] **Wood pickup + deposit prompt distances** — pickup radius large enough to feel forgiving on mobile; deposit prompt only fires when a fire is within a clear "you can help" range.
- [ ] **Chain-light range** — unchanged from v0 unless playtest exposes an issue.
- [ ] **Hearth livable floor** — the minimum fuel level below which the spawn hearth cannot decay. Existing floor value preserved unless playtest shows it's undermining solo tension.

**Balancing anti-pattern to avoid:** tuning any single dial in isolation. Every playtest tunes at least two related dials together (e.g. kindling burn-value + wilderness density; torch fuel + anchor distance). Record ratios not just absolutes in playtest notes so re-scaling is possible.

**Kiln balancing (Phase 2–3):**
- [ ] Charcoal conversion ratio (starting guess: 3 deadwood → 1 charcoal)
- [ ] Charcoal burn value (starting guess: ~5 min, tuned to deliver ~2.5× fire-time per carry slot vs. raw deadwood)
- [ ] Kiln processing timer (long enough to feel like real work; short enough that a Phase-2 playtest can complete a conversion)

### Deferred to v1.5+

- **Torch tiers / crafting.** Explicitly cut from v1 to preserve mechanical simplicity. Reasoning: solves a problem (Pine Grove double-value) that is already solved by hearth-fuel tiers; adds four new concepts (crafting, stubs, wood-decision-per-log, chain-light semantics) for one benefit. Revisit in v2 as a depth-add if playtest shows "wood-in-hand as tactical decision" is missing.
- **Kindling as reclamation tech.** Nice thematic but adds tuning surface for a niche benefit. v2 exploration.
- **Frozen lake** (movement modifier + fall hazard).
- **Hot spring** (hidden passive-warmth biome).
- **Ancient ruin as separate biome** (compass artifact reserved for v2 as volcano-station pointer).
- **Portable compass** (v2 pointer to volcano station, tied to lore drip).
- **Coal / peat / ancient stores** (v1.5 headline fuel tier). Rarer than pine, longer-burning, at fixed procgen sites outside the 500 m ring. The natural answer to the scarcity pressure that emerges by the 2nd–3rd solstice under v1's finite-wood model. Confirmed 2026-09-22 as the v1 → v1.5 → v2 scarcity ladder's middle rung.
- **Named graves, survivor plaques, per-player identity surfacing** (from GDD §5) — orthogonal to spatialization; deferred as GDD flags.

---

## 9. Playtest questions that lock or kill the pillar

Week 2 playtest (end of Spatialize + Fun) resolves whether Pillar 5 is working.

**Primary — does the pillar read?**
> *"Where would you go right now if you needed fuel?"* Answer names a **place** ("north, the pines") → pillar works. Answer names a **resource** ("wherever there's wood") → pillar broken; rebuild.

**Secondary — do the tiers feel meaningfully different?**
> *"What's the difference between a kindling fire and a pine fire?"* Answer describes **tempo** ("you have to tend the kindling fire constantly; the pine one you can leave") → tier design is landing. Answer describes only visuals or numbers → tuning is off; ratios need widening.

**Tertiary — is the seasonal-reversal choice a real decision?**
> *"You can only tend two fires tonight. Which do you let sleep, and why?"* Answer references a **capability class** ("let the ruin sleep, we need pine tonight") → coupling works. Answer is uniform ("whichever is farthest") → biome↔anchor coupling isn't landing.

**Legibility check:**
> *"Point at the pines."* Asked to a player 20 min in, no signage, no prior discussion. If they can gesture toward them, the silhouette signal works.

**Kindling-as-baseline check:**
> *"If nothing else worked, could you survive on just kindling?"* Answer "barely, for a while" → baseline is tuned right. Answer "easily" → wilderness is too generous. Answer "no way" → wilderness is too hostile for solo.

---

## 10. Open questions (need owner input, but not build-blocking)

1. **Rest stop count per seed.** Locked at 2–3. Actual number tuned playtest to playtest. Two is minimum-viable (one per biome corridor). Three adds a triangular safety net if biomes and hearth aren't collinear.

2. **Do rest stops need any additional tech beyond warmth?** Locked as pure warmth for v1. A future depth-add could give rest stops a small resource (one guaranteed kindling per cycle) but it complicates the "biomes are where resources renew" line. Leave clean.

3. ~~**Cabin Ruin tech pick.**~~ **RESOLVED 2026-09-22:** Charcoal Kiln (portability logistics). See §4 Cabin/Kiln section and GDD §0.1 Decision C.

4. **Deep snow belt tuning.** How much is friction, how much is wall? Playtest question tertiary above covers this. Starting guess: –40% walk speed inside belt tiles. Painted along biome-access paths but not blocking every route.

5. **How many trees per biome cluster?** Under the finite-wood model, tree count sets *how long the biome lasts*, not how densely it respawns. Guess: 6–10 trees per biome (Deadwood and Pine each). At ~3–5 logs per tree that's ~20–50 logs per grove — comfortable for a normal-length run, biting across long-running worlds. Playtest against the total-world-budget dial.

6. **Meta-progression tie-in** (from GDD §3 direction lock): if a communal Legacy counter or well-tended-hearth buff carries between winters, does it affect biome behavior (faster respawn? extra rest stop unlocked?)? Deferred to Polish + Ship phase; scoped as a v1.1 add if it doesn't land in v1.

---

## 11. Success criteria — this doc has done its job when

- [x] Every fire on the map has a specific reason to defend, mapped to a capability class.
- [x] Torch mechanics require zero changes from v0; the tech-tree work rides on the existing fuel model.
- [x] Winter's tech-tree reversal is a mechanical chain, not a narrative claim.
- [x] The v1 build scope for Spatialize + Fun + Depth + Holes reduces to a concrete checklist against existing systems.
- [x] The Week 2 playtest has specific questions that will either confirm or kill Pillar 5.
- [x] Nothing in v1 requires torch tiers, crafting mechanics, new verbs, or new UI.

Next step: fully integrated into GDD as of 2026-09-22 (Pillars, §0.1 Decisions A/B/C, §3 reveal table, §3 seasonal cadence, §9 phase table, §9 non-goals, §9 deferred). This doc remains the working reference for Phase 2–3 spatialization work; GDD is the reviewer-facing source of truth. Divergences between the two should trigger an update pass on this doc, not on GDD.
