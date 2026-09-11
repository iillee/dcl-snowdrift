# Snow Drift v1 — 4-Week Execution Plan

**Author:** opendcl session with ile, 2026-09-11
**Status:** proposal, pre-code
**Supersedes:** timeline half of `docs/survival-pivot-plan.md` (design half still authoritative, subject to the two decision gates below)
**Target:** Creator Success Program submission

---

## 1. v1 in one paragraph

Snow Drift is a shared-world winter survival game about **holding the light against the storm**. Players tend fires that create islands of warmth in a hostile snowscape. Days are for gathering, exploring, and expanding the network of lit fires. Nights are for defending them — the storm pushes back, snow reclaims territory, fuel drains faster. Occasionally a **solstice** arrives — the longest, coldest night — and only the best-tended fires survive. Solo is possible; multiplayer thrives because more warm bodies means more fires can be held.

*Note: the exact retention shape (persistent world calendar vs. roguelike run) and the exact defense mechanic (single-hearth quota vs. multi-fire territory) are **decision gates** in Weeks 1 and 2 respectively — see §3.*

## 2. Pillars

- **Man vs. storm, not man vs. mob.** The enemy is the cold and the snow, not agents. Combat is not part of v1.
- **Fire = safety, distance = stakes.** Emotional center is huddling around the light together.
- **Multiplayer scales the design, doesn't gate it.** Solo is barely-viable; groups thrive.
- **Failure is a story, not a game-over screen.** When a run/world resets, it's "winter reclaimed the village," not "you lose."
- **Server-authoritative persistence.** State survives session churn.

## 3. Key Design Decisions (locked and open)

Two design questions materially reshape the plan and cannot be resolved by conversation alone. Each has a **prototype + decision gate** built into the schedule.

### 3.1 LOCKED — Failure model

**Sleeping ember.** When a fire's fuel hits 0, it enters an `EMBER` state for 60 s. Any player relighting from a torch during that window saves it. Ember expires unsaved → fire dead. This applies to every fire equally (see §3.3).

### 3.2 OPEN — Retention model (decision by end of Week 1)

**Question:** Is Snow Drift a series of discrete runs, or a persistent world with its own calendar?

| Option | Retention hook | Failure meaning | CSP pitch |
|---|---|---|---|
| **Roguelike run** | "Our run is alive — come defend it" | Run ended, restart from day 1 | Strong: "How deep can your village go?" |
| **Persistent world** | "Check on Snowdrift, see what season it is" | An event in the world's history | Softer: "A living world with seasons" |

**Decision criteria (locked before prototype):**
1. Which framing makes the fire dying feel like a story instead of a game over?
2. Which framing survives an empty server better — what does the world *mean* when nobody's there?
3. Which gives a clearer 90-second CSP pitch?
4. Which do you want to keep building post-v1?

**Prototype scope:** Week 2 Step 4. Both sketches share the same `dayNumber` + `season` counters from Week 1's phase clock; the difference is reset semantics (roguelike zeroes them on `resetRun`, calendar preserves them). Code delta is a flag, not an architecture.

### 3.3 OPEN — Defense mechanic (decision by end of Week 2)

*(See also §3.4 — the meta-progression direction is a soft pull toward the territory model.)*


**Question:** Is v1 about defending **one hearth** (single-quota model from the pivot doc) or about defending **a network of fires** (territory-as-mobility model)?

| Option | Verbs | Solo experience | Group experience |
|---|---|---|---|
| **Single hearth** | Gather → bank at hearth → survive | Feed the fire, don't die | Everyone feeds the same fire |
| **Multi-fire territory** | Gather → tend N fires → hold access | Hold one small fire | Split up to hold multiple fires, emergent roles |

**All fires are equal.** No special "capital" fire. The map has multiple fires; each has its own fuel state, each needs individual tending, each unlocks access to some region of the map. Losing a fire = losing access to its area. Reclaiming a lost fire is a real daytime investment.

**Failure model under multi-fire:** run/world resets when **all fires are dead and the roster is empty for 60 s**. No "capital hearth" concept.

**Decision criteria (locked before prototype):**
1. Does moving between fires feel tactical, or just annoying?
2. Does losing an outer fire at night feel like a *loss*, or a shrug?
3. Can solo hold one fire? Can pairs meaningfully hold two?
4. Does "man vs. storm" come through, or does it just feel like walking on ice?

**Prototype scope:** Week 2 Step 5. Reuses existing `hiddenCampfire`, `frost`, and `locomotion` systems — retune them so **off-territory** is meaningfully hostile and **on-territory** is safe. No new fire archetypes, no reclamation-cost pass, no per-fire benefits yet. Just enough to *feel* the shape of the game.

**If territory wins:** Week 3 builds fire archetypes (grove, way-station), tunes snow regrowth curve, and the "quota bar" becomes a multi-fire HUD.
**If single-hearth wins:** Week 3 builds the wood quota bar as originally specced in the pivot doc.

### 3.4 LOCKED (as direction, not feature) — Meta-progression across cycles

**Direction:** Snow Drift wants a meta-loop where surviving winter with territory intact carries forward into the next cycle. This creates graduated stakes above bare survival and gives the game a reason to protect base and gear beyond making it through one night.

**Two-tier success condition (locked as direction):**

1. **Any player alive at solstice end** → run/world continues; minimal state loss.
2. **Player alive AND territory held through solstice** → progression carries forward (form TBD).
3. **Nobody alive** → full reset (already the failure mode from §3.1).

**What carries forward (deferred to Week 4 or v1.1):** exact form is undecided. Likely candidates:

- **Legacy counter** — single server-persisted integer, ticks up on successful winters, quietly buffs the world (larger starting radius, faster wood respawn, +N starting fuel). Vampire Survivors–style. Cheapest to implement.
- **Well-tended hearth** — anchor fire starts next run with +N fuel or +larger warmth radius.
- **Woodpile foundation** — next run starts with X wood pre-banked.
- **Warmth memory** — frost baseline gentler for the first M days of next run.

**Communal only.** No personal gear, no per-player upgrades, no returning-veteran advantage. All progression belongs to the village/world. See §7.

**Design implications for open decisions:**

- **§3.2 (retention):** meta-progression reads more naturally in a roguelike frame ("our village survived last winter, our torches are better this run") than a calendar frame (which already has world persistence). Soft argument for roguelike.
- **§3.3 (defense):** "reclaim your camp upgrades" only makes sense if there's a camp network. Soft argument for territory-defense.

**Refinement scheduled for Week 1.** The direction is locked, but concrete answers to "what carries, in what form, from what condition" will be revisited once the phase clock + seasonal cycle are running and we can feel what "holding territory through winter" actually means in play.

## 4. Success gates (from pivot §9, adapted)

1. Solo player survives day 1 comfortably, sweats by day 3.
2. A pair goes further than a solo, for a **legible** reason.
3. The first solstice is memorable — triumph or wipe, both acceptable.
4. Fire-death-empty-server reset feels earned, not arbitrary.
5. Mobile perf holds through a full day/night cycle.

---

## 5. Four-week schedule

Working assumption: 4 calendar weeks, ~5 working days/week, weekends absorbed into buffer. Each step is its own commit with a smoke test — no batching.

**Shape:** Week 1 = backbone (temporal infrastructure). Week 2 = design decisions (both prototypes). Week 3 = build the winning game + playtest. Week 4 = polish + ship.

### Week 1 — Backbone: temporal cycles + failure model

Build the time-and-failure infrastructure that everything else sits on. No design decisions this week — just the machinery.

- **Step 1: Cut the fuel floor + empty-server run reset.**
  - Drop `FUEL_MAIN_FLOOR` so fire fuel can reach 0.
  - Sleeping ember (§3.1) applies at fuel=0: 60 s grace before the fire is officially dead.
  - New `server/runState.ts` watches fire state + roster. Fires `resetRun(reason)` when *all* fires are dead AND roster empty for `EMPTY_SERVER_GRACE_S = 60 s`.
  - `resetRun()` clears fuel, wood piles, banked wood; broadcasts `runReset`.
  - **Starting condition:** one lit fire at map center whenever a new run begins. Not special, just the anchor.
- **Step 2: Day/night phase clock.**
  - Repurpose `server/cycle.ts` → `server/phase.ts` with phases DAY / DUSK / NIGHT / SOLSTICE_WARN / SOLSTICE / GRACE.
  - Starting values: 5 min day, 1 min dusk, 3 min night. Solstice + grace scaffolded but not wired to a trigger yet (that lands Week 3).
  - Bind weather, skybox, and `FROST_TIME_BASELINE_S` to `coldMultiplier`.
  - New shared message `phaseState { phase, dayNumber, coldMultiplier, phaseEndsAtMs }`.
  - New HUD layer `layer.dayPhase.tsx` — "Day 3 — Night in 4:12" pill.
  - Server-time authority for the countdown (mobile-safe).
- **Step 3: Seasonal cycle.**
  - `dayNumber` accumulates. Every `SEASON_LENGTH_DAYS` (starting value: 5) the season advances.
  - Seasons trend the baseline `coldMultiplier` upward. Day pulses on top of season baseline.
  - Season list for v1: `AUTUMN` → `EARLY_WINTER` → `DEEP_WINTER` → `SOLSTICE_APPROACH`. Solstice fires as the transition out of `SOLSTICE_APPROACH` (Week 3 wires the trigger).
  - `phaseState` extended with `{ season, seasonDayIndex }`.
  - HUD gets a small season indicator (icon or one-word label) alongside the day pill.
  - **Season persistence semantics deferred to Week 2** — whether seasons reset with the run (roguelike) or persist across resets (calendar) is exactly the retention decision. Ship Week 1 with both code paths behind a flag; flip the flag Week 2.
- **Exit criteria:**
  - Any fire can die; empty server resets cleanly.
  - Day/night cycle visible and readable, driving frost + weather.
  - Season advances visibly. Cold trends up over multiple days.

**Parked from Week 1:** mobile hardening, ember visual/audio, force-reset dev button, solstice trigger wiring, richer `runReset` client reaction.

### Week 2 — Design decisions: retention + defense

With the temporal backbone live, both design questions can be prototyped and judged in the same testbed.

- **Step 4: Retention-model prototype + decision gate (§3.2).**
  - Roguelike sketch: `dayNumber` and `season` reset to 1/AUTUMN on `resetRun`. HUD framing: "Day X of run."
  - Calendar sketch: `dayNumber` and `season` do NOT reset on `resetRun` — they persist as world history. Wall-clock tick continues while server is empty. HUD framing: "World Day X, [season]."
  - Play both solo across at least one full day/night. Decide against §3.2 criteria.
  - Code delta is small — mostly a flag on the season-persistence logic built in Week 1.
  - **Decision by mid-Week 2.**
- **Step 5: Territory-defense prototype + decision gate (§3.3).**
  - Resurrect hidden campfires as the multi-fire scaffold.
  - Retune existing `frost` and `locomotion` so off-territory (outside any lit fire's melt radius) is meaningfully hostile — faster frost, slower movement — and on-territory is safe.
  - No new systems, no fire archetypes, no reclamation-cost pass.
  - Play with 1–2 people across at least one full night. Decide against §3.3 criteria.
  - **Decision by end of Week 2.**
- **Exit criteria:**
  - Both decisions locked and documented in this file.
  - Week 3 has a single, unambiguous build target.

**Parked from Week 2:** the wood quota bar (Week 3 if single-hearth wins) or the territory HUD + fire archetypes (Week 3 if territory wins).

### Week 3 — Build the winning game + solstice + first real playtest

Conditional on the two decisions locked at end of Week 2.

**If single-hearth quota model won §3.3:**
- **Step 6a: Wood quota bar.** `server/quota.ts`, `layer.quotaBar.tsx`, dusk-snapshot penalty on missed quota. Quota scaling: `ceil(N * 3 * (1 + 0.5 * dayNumber))`.
- **Step 7a: Snow/melt tuning.** Harsher `FROST_TIME_SNOW_STAGE_S` at night, faster regrowth off-DAY, tune night severity by `coldMultiplier` curve.

**If territory-defense model won §3.3:**
- **Step 6b: Fire archetypes.** Ship with 2 types: `warmth` (default) and `grove` (near a rich wood cluster, unlocks safe gathering there). Way-station and overlook parked for v2.
- **Step 7b: Snow regrowth curve.** Regrowth speed drives territory shrink at night. Tune the difficulty curve here — this is where `coldMultiplier` mostly lives.
- **Step 7b.5: Reclamation cost.** Cold fires cost extra wood to relight (creates the "invest real daytime minutes" pressure).

**Both branches:**
- **Step 8: Solstice event.**
  - Wire the solstice trigger to the end of `SOLSTICE_APPROACH` season (built Week 1).
  - `SOLSTICE_WARN` phase: siren, sky darkens, 2 min countdown.
  - `SOLSTICE` phase: HEAVY weather locked, `coldMultiplier` peaks, night doubled.
  - Survive → `GRACE` phase (1–2 easy days), then seasons roll back to AUTUMN (or advance to a new named season if calendar model won). Fail → `resetRun('solstice_failed')`.
  - Solstice cinematic reuses loading-splash pattern.
- **Multiplayer playtest.** 3+ players from Discord, top-down observer, structured questions against the success gates.

**Exit criteria:** solo finishes day 3 tense; a pair goes visibly further; the first solstice is a story afterwards.

### Week 4 — Polish and ship

- **Step 7: Polish pass.**
  - Ember visual/audio (deferred from Week 1).
  - Onboarding: first-30-seconds prompts (torch → wood → fire).
  - Solstice arrival VFX/audio.
  - Optional: cross-restart persistence via Storage API.
- **Deliverables.**
  - 60–90 s trailer (mood + mechanic + solstice beat).
  - `docs/VISION.md` refresh, player-facing README pass.
  - Final mobile perf smoke on desktop + phone.
  - Deploy dry-run.
- **Submit.**

---

## 6. Rolling risks

| Risk | Mitigation |
|---|---|
| Both prototypes succeed and we want both | Force honest scope call end of Week 2 — one may need to defer to v2. |
| Retention model decision drags past end of Week 1 | Hard deadline: pick the one you'd rather build on Monday. Sunk-cost bias is real. |
| Territory prototype "kinda works" but isn't clearly better | Default to single-hearth. Simpler ships. |
| Solstice arrival not readable | 2-min warn window with siren + sky darken; playtest question covers it. |
| Mobile perf regresses under HEAVY weather | Perf test end of Week 2 + Week 3; fall back to lighter particle counts before cutting mechanics. |
| Trailer eats Week 4 | Protected day; do not skip for "one more feature." |

## 7. Explicit non-goals for v1

- **No mobs / combat.** Man vs. storm, not man vs. agents. Combat is a v2 conversation.
- **No leaderboards.** Shared-pool survival, not competitive.
- **No permadeath.** Individual death respawns; only the run/world can reset.
- **No tool tiers.** No axes, no upgraded torches, no crafting.
- **No personal gear or per-player upgrades.** Meta-progression (§3.4) is communal-only — belongs to the village/world, not the individual. A returning veteran's torch is the same as a new player's torch.
- **No NPCs, quests, or dialogue.**
- **No fire archetypes beyond 2** (if territory model wins). Way-station, overlook, ancient — all v2.
- **Design principle: players help fires, not hurt them.** No extinguish action, no fuel drain, no interaction locks. Eliminates most grief vectors by construction.
- **No trailer or pitch work until the loop is playable** (Week 4 only).
