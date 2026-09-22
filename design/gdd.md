*Work in progress · revised 2026-09-11 against `docs/v1-4week-plan.md`*
*Doc: `▓▓▓▓▓▓▓▓▓▓` · all sections drafted · two open design decisions gated by Week 1–2 prototypes (see §0.1)*

> **Reading order.** Sections are numbered by drafting priority, not reading order. Recommended read: §0 → §0.1 → §1 → §8 → §2 → §3 → §4 → §5 → §6 → §7 → §9. Hypotheses (`H1-xx`) referenced throughout resolve in [`design/hypothesis-log.md`](./hypothesis-log.md).

# Cryogenia

*Working title — pivoted from "Snow Drift" (IP conflict). "Cryogenia" references the Cryogenian period (~720–635 mya, "Snowball Earth"). Final title to be confirmed post-team-pitch after Wednesday's playtest.*

| Field | Value |
|---|---|
| **Title** | Cryogenia *(working)* — IP self-check: clear pending final confirmation |
| **Deployment target** | Decentraland World — `snowdrift.dcl.eth` *(URL retained from v0; DCL NAME may migrate with title lock)* |
| **Studio** | ile (solo) — coming off Flagtag (competitive multiplayer); building Cryogenia to learn what *collaborative* multiplayer teaches on DCL, and to push the client's skybox, seasonal, and weather systems as core game features for the first time. |
| **Date** | 2026-09-09 |
| **Contact** | Discord: `ile9466` · Email: `lukeeescobar@gmail.com` |
| **Requested round** | **v1** — with a **retroactive v0 request** for what is already live at `snowdrift.dcl.eth` (the pre-pivot cozy build, playable now). |

---

## 0. TL;DR

**Cryogenia** is a shared-world winter survival scene for Decentraland, set on Earth at the edge of the Cryogenian freeze.

> *Hold the light against the storm.*

**Primary player.** Players who enjoy cozy-toned co-op survival games (Don't Starve Together, The Long Dark, Valheim's early-game loop), arriving alone or in a small group of 2–3 from an Event, a Discord community, or a friend invite — looking for a persistent shared-world game with escalating stakes and a community-scale run to push.

**The pitch.** Earth, hundreds of millions of years ago, at the edge of the great freeze. You wake in a village around a fire. Melt snow with your torch to find wood. Feed the hearth against the night. Survive the winter solstice together — and, over many winters, uncover what the ancients left buried under the ice: a network of dormant volcanoes built to thaw the world when the time came.

**Current status.** Playable core loop in SDK7, live at `snowdrift.dcl.eth` (v0 baseline). Verbs already shipped: torch, hearth, wood-gathering by melting snow, frost-death, torch chain-lighting, weather, day/night cycle. The v1 delivery layers a **seasonal cycle culminating in a winter solstice event**, sleeping-ember fire failure, and a communal survival arc across many in-game days.

**At end of v1.** Live with: a day/night phase clock, a full seasonal cycle (autumn → early winter → deep winter → solstice approach → winter solstice → thaw → spring), the sleeping-ember failure model, **persistent shared-world survival roguelike** with lightweight persistence backend + DCL CRDT for in-scene sync (world state persists across empty-server periods; extinction triggers new-seed generation), **fire-survives extinction rule** (civilization ends only when the last fire dies; oldest surviving fire becomes new home if hearth falls), **multi-fire territory with fire dormancy** (defense mechanic locked — see §0.1), **two biomes + one functional discovery on a procgen map** (Deadwood Grove, Pine Grove, Cabin/Charcoal Kiln) with a **three-tier fuel system** (kindling / deadwood / pinewood) plus **charcoal portability** produced at the Kiln that surfaces the geography-as-tech-tree pillar as three distinct capabilities (quantity / quality / portability), one **mystery discovery** (Ancient Station foreshadow) hinting at v2, a winter solstice event with warning + whiteout + recovery arc, personal **"while you were gone" return-screens** on every session start, a **level visual redesign** (block/prop art pass + environment-layout iteration) that lifts the world from greybox to a cohesive Cryogenian look, and a first multiplayer playtest during the Solstice + Game Loops phase.

**Playable link.** `https://play.decentraland.org/?realm=snowdrift.dcl.eth`

> **⚠️ Reviewer note on the playable link:** this URL currently serves the **v0 baseline** — the pre-pivot *cozy* multiplayer hangout described in `docs/archive/gameloop-vision.md`. The **v1 build described in this GDD** redeploys to the same URL at Week 4. What you see today proves the *verbs* (torch, hearth, wood, frost death, weather, torch-chain, day/night, mobile playability); the *seasonal cycle, solstice event, sleeping-ember failure model, and defense mechanic* are the v1 delivery.

---

## 0.1 Load-bearing design decisions (all resolved)

Every major design decision that was open at start of v1 planning is now resolved and folded into this GDD. History and rationale live in [`decisions.md`](decisions.md); this section is the current locked state.

**Decision A — Retention model. LOCKED 2026-09-22: persistent shared-world survival roguelike.**
- **"Persistent civilizations. Finite worlds."** *(GDD Pillar 7)* One shared civilization per world. World state persists between player sessions and continues advancing at full rate when the server is empty. Individual player sessions are 5–30 min; civilization lifespan is typically hours to (rarely, with dedicated cross-timezone community) days. Civilizations end when the last fire dies; the next arriving player witnesses extinction, and a new seed is generated.
- **Cadence:** live seasonal cadence stays real-time (no compression in shipped builds). Debug commands (season jumps, solstice trigger, day advance) are a Phase 1 must-build for internal testing; whether they're exposed to external playtesters is a Phase 2–3 call.
- **Offline behavior:** computed illusion — last-known state + timestamp stored server-side; on next player arrival, the world is advanced to real wall-clock time at full drain rate. Harsh model by design: most civilizations will not survive extended empty-server periods. Long-lived civilizations are earned by dedicated communities and rewarded with deeper content (v1.5 coal / ancient stores; v2 volcano network).
- **Return-screen:** every returning player receives a personal "while you were gone" summary of *civilization-level* state changes (days elapsed, seasons, hearth status, solstice outcomes, extinction if it happened). Discovery-level facts (specific place names, discoverer credits, individual fire events) are *never* surfaced on the return screen — those live only on the transient live-broadcast channel during the moment they fire. This preserves personal-discovery surprise across sessions.
- **Persistence backend:** the persistent-civ model requires state that survives empty-server periods. Two responsibilities split cleanly:
  - **In-scene real-time sync between connected players** — DCL's built-in CRDT (foundation-hosted, no ops). Fire fuel state, tree state, player positions, discovery events all sync via existing DCL comms. Same pattern already used in v0.
  - **State that survives empty periods** — external lightweight backend accessed via `signedFetch`. World state (day, season, seed, per-fire state, per-tree budget), per-player last-seen state (for return-screens), extinction-witness/reset logic. Preferred shape: Cloudflare Workers + Durable Objects / KV, or Firebase / Supabase — anything serverless with scale-to-zero. **Not** a 24/7 Node process on a VPS; the ops burden of a full authoritative server is unnecessary at this shape.
  - **World advancement on read.** When the last-known state was T hours ago and a player joins, the backend computes forward from last-known state deterministically (fire drain, season progression, weather roll-forward with seeded RNG). One computation, broadcast to the arriving client. No always-on tick.
  - **Multi-scene World architecture is a viable fallback** if the single-scene 100×100 envelope hits perf walls. Cross-scene state sharing becomes harder (each scene is an isolated bundle) and canyon boundaries would hide loading hitches, but it remains an option — not the default. Decision gated on H1-06 mobile perf smoke test.

**Decision B — Defense mechanic. LOCKED: multi-fire territory + fire-survives extinction condition.**
- *Post-review lock (2026-09-11).* Territory makes §3 Pillar 3 ("fire = safety, distance = stakes") mechanically real; quota is a bar, territory is a map.
- **Fire dormancy:** fires that fully drain without a relight enter a 60 s ember state; if unsaved, they go *dormant* (cold-but-not-dead) and can be reclaimed later at a wood cost (3–5 logs).
- **Extinction rule (locked 2026-09-22, revised from earlier hearth-only model):** civilization ends only when the *last* remaining fire dies. Loss of the central hearth is a dramatic state transition, not extinction. When the hearth dies with a satellite still lit, the **oldest continuously-burning surviving fire** becomes the community's new home — the respawn point and the HUD-designated "current hearth" — until the original is reclaimed or the community migrates permanently. Produces the exile / migration / reclamation narrative arc (see GDD Pillar 6).
- **Hearth livable-floor:** *experimental during build.* Whether the spawn hearth has a decay floor that prevents death-by-neglect (only dying to a scripted stress event like solstice-with-nobody-present) versus fully mortal like every other fire — to be resolved by feel during Phase 2–3.
- **Territory concretized 2026-09-22** — three fire archetypes (spawn hearth / biome anchor / rest stop), two biomes (Deadwood Grove, Pine Grove) + one discovery (Cabin/Charcoal Kiln), procgen placement per world reset. Full spec in [`spatialization-plan.md`](spatialization-plan.md).

**Decision C — Cabin/Kiln discovery tech. LOCKED 2026-09-22: Charcoal Kiln (portability logistics).**
- The Cabin is a *discovery* (a singular authored place), not a biome (per Pillar 9 vocabulary split).
- Interaction uses existing verbs only — no new UI, no crafting menu, no recipe system. Player carries deadwood to the kiln, deposits several pieces, ignites with a torch; after a processing timer, the kiln produces charcoal (retrievable as a single carry-slot item).
- **Charcoal's role is portability, not tier-inflation.** Approximate design ratio: ~3 deadwood → 1 charcoal, where charcoal delivers ~5 min of fire from a single carry slot vs. ~2 min for one deadwood. Slight energy loss in exchange for 2.5× fire-time per carry slot. Makes long-distance expeditions and remote-anchor maintenance tractable.
- **Strategic role in the fuel triangle:** Deadwood = quantity (sustain), Pine = quality (efficiency), Charcoal = portability (reach). Three geographic capabilities that *solve different problems*, not a linear tier ladder.
- Cocoa / map room / seasonal calendar alternatives retired 2026-09-22. World map explicitly ruled out as a non-goal (would undermine geographic discovery).

**Direction lock (form deferred) — Meta-progression:**
Surviving winter with territory intact carries *something* forward into the next cycle. Communal only (no personal gear, no per-player upgrades). Concrete form (Legacy counter, well-tended hearth buff, starter woodpile, warmth memory) decided during v1 build once the loop feels real. Aligned with GDD Pillar 8 (progress belongs to civilization; memory belongs to the player).

**Retroactive v0 ask.** The scene as it exists today (the cozy multiplayer hangout in `docs/archive/gameloop-vision.md` — now superseded by this GDD) represents ~14 sessions of work over the pre-pivot window. Full engineering changelog in `README.md` v2.7–v2.14+.

**Retroactive v0 ask.** The scene as it exists today (the cozy multiplayer hangout in `docs/archive/gameloop-vision.md` — now superseded by this GDD) represents ~14 sessions of work over the pre-pivot window. Full engineering changelog in `README.md` v2.7–v2.14+.

---

## 1. Player Promise

> **Hold the light against the storm.**

*(6 words, owner-confirmed 2026-09-11)*

**Longer form:** *Warm the ground to find wood. Tend the fires against the cold. Winter deepens season by season until the solstice tests whether the light was tended well enough to survive.*

**Familiar comparison:** *(dropped — the promise stands without it; comparables live in §8)*

**Why this game:** Decentraland doesn't have a collaborative survival game yet, and its skybox, seasonal, and weather systems have never been the core of one. Cryogenia is both experiments at once: a survival challenge you can face alone or with strangers, where the world's history unlocks the longer the community keeps the fire alive.

---

## 8. Audience & Comparables

### Comparables

| Game | Where it lands | What worked (to keep) | What didn't fit this audience | What we do differently |
|---|---|---|---|---|
| **GONE Fishing** (Steam, app 3645890) | Outside DCL — the **daily quota loop** reference | Collaborative progression gated by a nightly quota; missing the quota resets progress; the shared-fate stakes drive coordination. | `[agent-decided]` Hard restart on a missed quota assumes a committed friend group in one session. DCL's shared world has drop-ins, latecomers and strangers — punishing everyone because one player logged off would be brutal. | Only the *world* can lose. Individual players respawn; the run only resets if the central hearth dies during a storm with no one tending it. We replaced the quota mechanic entirely with a **fire network** — pressure comes from how much territory you can hold, not from a bar you have to fill. |
| **Frostpunks** (DCL scene) | Inside DCL — the **big-storm boss-event** reference | Upgrading a base toward a scheduled storm event; the storm has real teeth and rewards preparation. | `[agent-decided]` The political/faction layer reads great with committed players and terrible with drop-in strangers on a public shared world. | No politics, no PvP, no factions. One shared hearth; everyone's on the same side against the storm. Twist: the storm is on a **real-world clock** (two solstices per real day), turning it into a scheduled retention beat instead of a per-session climax. |

*Two `[agent-decided]` cells above — my inferences from your one-line descriptions of what each game does. Overrule any wording that misreads the source.*

### Primary player + arrival context

For players who already enjoy **cozy-toned co-op survival games (Don't Starve Together, The Long Dark, Valheim's early-game loop)**, arriving **alone or in a small group of 2–3** from **an Event, a Discord community, or a friend-invite link**, looking for **a persistent shared-world game with scheduled reasons to log in and a community record to push.**

### How the first group arrives

The first group comes through **the CSP program's DCL Events feed and Cryogenia's Discord** at the scheduled solstice timestamps — the solstice itself is the recurring arrival channel. Individual players arrive through Discover, friend invites, and streamer content once the loop is stable and the record is climbing.

### Deliberately not for

Players who want **PvP, competitive leaderboards, personal levelling, wallet-gated content, fast-twitch action, or a solo campaign with a fixed ending in v1**. The game rewards patience, coordination, and returning at scheduled times. It does not reward mastery of individual skill.

---

---

## 2. First Minutes & How to Play

### First 0–10 minutes (you)

**0–5 sec.** You wake in a warm circle around a fire. Snow falls beyond it. Others stand nearby with lit torches. HUD: *"Day 3 — Night in 4:12"* and a fire-network status readout (which satellite fires are lit, which are dormant).

**5–10 sec.** You step out; a chill cue plays, a frost meter appears. You grab a torch from the hearth pile. Wood chunks glow under the snow when your torch is near.

**10–60 sec.** You walk to a glow. Snow melts under you. Pick up a log — carrying 1. Deposit at the hearth; its fuel gauge visibly refills; the fire brightens and its warmth radius grows.

**1–3 min.** "Night in" hits 1:00. Sky darkens; players run for a fire; you follow. Cold accelerates. Someone feeds a log. The fire holds. Dawn breaks.

**3–10 min.** Day 2. Cold multiplier climbs; a *"Cold ×1.4"* chip appears. Wood near the hearth is gone — you walk further. Torch drops low; you hand off to an incoming player. First coordination beat.

**Stopping point.** Day 3. HUD reads *"Solstice in 8:23"*. You know tomorrow's reason to return.

**5/10 rule** (80% of first-time players perform the first useful action within 5 sec and can state the immediate goal within 10 sec): `[HYPOTHESIS]` H1-02.

### How to Play

- **Melt snow with your torch to find wood.**
- **Feed the fire before night falls.**
- **Every player extends how much territory the fires can hold.**

---

## 4. Why Players Come Back

> **Section status (revised 2026-09-22):** §0.1 Decision A is now **locked** as *persistent shared-world survival roguelike* — the return hooks below have been rewritten around that model. The prior "roguelike vs calendar" framing is retired.

### 4.3 Return hooks (3)

**Hook 1 — 🌍 The persistent civilization.**
- **Trigger:** the world continues without you. Log off Day 17 in Autumn, come back to Day 28 in Deep Winter (or to a fresh Day 1 if the civilization died in your absence).
- **What players anticipate:** *"what happened while I was gone?"* — civilization progress, seasonal shift, whether the community is still standing.
- **Reminder channel:** the return-screen itself. On every login, a personal "while you were gone" summary reports civilization-level state changes since last visit (days elapsed, seasons crossed, hearth status, solstice outcomes, extinction if it happened).
- **What the return-screen shows:** civilization-level facts only — never discovery-level facts (no place names, no discoverer credits, no individual fire events). Discovery events fire on the transient live-broadcast channel at the moment they happen; players who were online then saw them, others learn via Discord or by walking.
- **D1 coverage:** always. Every session start is a return-screen beat.

**Hook 2 — ⚡ The winter solstice.**
- **Trigger:** solstice arrives on a fixed **in-game day number** within the current civilization (target Day 20, tuning-tunable). HUD countdown always visible; the closer the civilization gets, the more the community pulls returning players to be present.
- **What players anticipate:** the peak defense moment. Community coordination naturally concentrates around it.
- **Reminder channel:** in-world HUD countdown + Discord announcements when a civilization is near solstice ("World 7 is on Day 17 — solstice in 3").
- **No-reminder fallback:** the HUD countdown is the last thing you see before you log off (§2 stopping point).
- **D1 coverage:** strong when a civilization is near solstice; softer during early days of a fresh civ.


**Hook 2 — 🏆 Beat the world's high-score day count. Unlock more of the game as it survives.**
- **Trigger:** hearth displays *"Best Run: Day 62 · Current: Day 34"*. The gap is the retention pull. Progressive unlocks (see 4.2) mean the world *literally grows* the longer it survives.
- **What players anticipate:** *"we're 28 days from the record and 6 from the next unlock — push tonight."*
- **Reminder channel:** Discord milestone announcements (Day 10 / 25 / 50 / 100) + reset announcements (*"the world fell on Day 47 last night, 15 short of the record — next attempt begins when someone returns."*).
- **No-reminder fallback:** both numbers are baked into the hearth HUD.
- **D1 coverage:** strong. Layered with Hook 1.

**How the world resets:** when the central hearth dies and the server is empty, the world sits in a "dead" state — day count frozen. The next returning player is the witness: they see the *"the world was lost on Day X"* splash, then spawn into a fresh Day 1. Reset is a moment, not silent bookkeeping.

### 4.1 The D1 (next-day) sentence

A player who enjoyed their first session returns the next day because **Hook 1** — an solstice is scheduled at 20:00 UTC and they want to be there to defend the fire.

### 4.2 Progression chain

| When | What persists / what becomes possible | How another player can tell |
|---|---|---|
| **End of first session** | The world's day count — the number you contributed to. Nothing personal persists. | They see the record + current-day numbers on the hearth. |
| **End of first week** | You've lived through multiple solstices and probably one reset. You know which satellite pit sites are thawed at the current day count. Your torch has visibly upgraded once. | Your torch's fuel bar is visibly longer than a first-session player's; you know routes that first-day players don't. |
| **Week 3+** | You're a regular — present at solstices on schedule. You've seen the world at higher day counts than most, and know what territory unlocks past Day 40+. You've participated in at least one record-push. | You show up in Discord threads about solstice timing; you're one of the players others follow toward known-good routes when night falls. |

**End of first week (scene, 3–4 sentences):**
> It's Sunday evening. You log in — the hearth reads *Day 41 · Best: 62*. You've been here for four solstices; you missed one. Someone in the group chat: *"we're 21 days from the record, can we do it?"* You head out with a torch that burns 30% longer — the Day 30 unlock. The northeast satellite pit, thawed at Day 20, is your first stop. Tonight's solstice is at 20:00 UTC. You're not going to miss another.

### Unlocks (progressive, community-scale)

Tied to the world's current day count, lost on world reset. Concrete list — iterate on numbers via playtest:

| Day | Unlock | Category | Ship |
|---|---|---|---|
> **Player-facing framing (post-review reframe):** unlocks are *internal design targets*, not player-facing UI. No battle-pass roadmap, no "Day 30 unlocked!" toasts. The player should notice things are different at higher day counts ("wait, was that here before?"), not see them announced. Discord community discovers the progression collectively. The table below is planning scaffolding; player-facing surface is diegetic only.

> **✅ Progression model resolved (2026-09-22):** the day-count unlock table below is superseded by **geography-as-tech-tree via the three-tier fuel system + procgen biome discovery** (see §3 Pillar 5 and [`spatialization-plan.md`](spatialization-plan.md)). Capabilities come from *reaching biomes*, not from surviving X days. Under the new frame, Pine Grove's long-burn tempo is available on session 1 the moment a player reaches and holds Pine Grove — no day-count gate. The Day 30 torch upgrade concept is retired; torch tiers themselves are cut from v1 as explicitly non-goal. Only the Day 100 lore fragment is retained below as a v2 cliffhanger seed. Day count persists as history/difficulty/record only — not as an unlock gate.

| Day | Unlock | Category | Ship |
|---|---|---|---|
| **Day 100** | Final lore fragment + aurora world-visual signature. *"The first station lies here. This is where the thaw begins."* Names the v2 goal explicitly — volcano ignition network. | Lore + cosmetic | *(v1.5)* |

*(Retired 2026-09-22: Day 5 / 10 / 15 / 20 / 30 / 40 / 50 / 75 entries. Territory unlocks are now session-1 available via biome discovery; torch upgrades are cut from v1; lore fragments are scoped to v1.5 with the Day 100 cliffhanger as the seed for v2.)*

**Three unlock categories woven together:** *territory* (what map you can reach), *tools* (how well you can work it), *lore* (why you're here at all). Every ~10 days the player has a reason to push forward, and the reasons rotate so it never feels like grinding one axis. **All of it surfaces diegetically** — no unlock notifications, no progression UI.

**Lore content:** Fragments are short (a paragraph each), diegetic (found objects the player can read in-world), and read as **fragments of the ancients' ignition manual** — the instructions for waking the volcano network that will one day thaw the world. The stubs above are seed lines; final prose owner-drafted before v1.5. The whole set answers *"why is it winter, who saw this coming, and what did they leave for us?"* by Day 100 — which names the location of the first ignition station and sets up v2.

**Currency / tradable rewards:** none. All progression is community-level and resets with the world. No wallet interactions, no NFTs required to play.

### Identity progression (not power progression)

The world accumulates *power*; the player accumulates *biography*. Personal history is remembered, personal stats are not upgraded. v1 keeps this minimal:

- **Survivor plaques** on the hearth (already in §5) — names of the ~10 players present when the current record was set.
- **Optional hover / whisper stat on other players' avatars** at the hearth: *"Survived 2 solstices · Delivered 47 wood · Witnessed Day 34."* Read-only, cosmetic, no gameplay effect.
- **Named graves** (see §5) mark where a player froze. Their name and the day number persist as environmental storytelling.

No per-player power buffs. No gear tiers. No personal levels. A returning veteran and a new player have the same capabilities — only their history differs. This is the design line that keeps Cryogenia from drifting into MMO progression.

---

## 5. Social by Design

### The repeatable social loop

The main social vector is **emergent role coordination toward tending the fire network and defending it against the storm**, not any single scripted interaction. Roles are not picked from a menu — they emerge from where each player naturally spends their time:

- **Gatherers** — push out with lit torches, melt snow, bring back wood.
- **Tenders** — stay near the hearth, feed banked wood as fuel drains, coordinate the deposit rhythm.
- **Chain-lighters / bridges** — relight gatherers' torches mid-map so no one has to return to the hearth for fuel.
- **Scouts** — push furthest edges toward newly-thawed territory or lore fragments at high day counts.

A player who signals what they're doing (heading out, staying to tend, pushing north) lets others fill the gaps. The **shared consequences** are directly visible: each fire's fuel gauge and flame size, which satellite fires are lit or dormant, the cold multiplier holding or spiking. The **regrouping beat** is dusk — everyone comes home before night.

**Torch chain-lighting** (already built) is one concrete instance of this loop — a gatherer far from the hearth signals by holding a low-fuel torch; a chain-lighter voluntarily walks out to relight it; both players' reach just extended. Ships in v1 as a proof of the vector; more role-specific mechanics `[OPEN: waiting on Week 2 playtest]` emerge from what players actually do.

### Meeting and recognition

**Strangers to a group in 30 seconds — without voice or shared language.**
Spawn puts everyone at the same central hearth. A new arrival sees other players around the fire immediately. Depositing your first log directly refills that fire's fuel gauge and visibly brightens its flame — everyone standing near it sees the change. That's the 2-second social verb: *"I helped."* No voice, no language required.

**Where a name is first learned.**
Baseline: DCL floating name labels. Deliberate moment: when a player deposits a log, a subtle *"iridis · +1 wood"* pill appears briefly near the hearth. Same when your torch is chain-lit by someone — their name flashes for a second. Names surface tied to positive actions, never as a scoreboard.

**What persists between returning players.**
No personal progression persists (per §4). But the world carries **traces of prior play**:

- **Survivor plaques** on the hearth: names of the ~10 players present when the current record day was reached. Returning players check the plaques to see if their name is up; new players see who kept the world alive. Plaques update when the record is beaten; lost with the world on reset.
- **Melted paths and dormant fires** (from §3) leave a visible history of where recent players walked and what they tended — the world reads as *inhabited* even at CCU 1.
- **Named graves** *(v1.5)* mark where a player froze. Small stone marker with their name and the day number they died on. Purely aesthetic and diegetic — no gameplay effect — but they turn a bad moment into a gift to the next player: *"someone died past this point at night. That's information."* Deferred from v1 to keep P1–P4 focused on simulation and loop fun.

*Note: the surfacing mechanics above will evolve as build reveals what feels right. Locked as v1 baseline, expected to deepen.*

### Population and thresholds

**Realistic baseline: 1–2 players concurrent, most of the time.** 3+ concentrates at scheduled solstice timestamps (Hook 1) and Discord-pushed events. The design is tuned around this: solo-and-duo is the *primary mode*, groups are the *social peak*.

| Row | Value | Notes |
|---|---|---|
| **Quiet-hours count** | **1 player** | The expected default. Solo can gather, tend, feed, survive normal nights, and participate in the community record push over multiple sessions. Sees all lore + tool + territory unlocks (they belong to the world, not the individual). |
| **Solo solstice** | **Very hard, not impossible** | A solo defender can realistically only hold the central hearth (satellite fires go dormant under fire dormancy — see §0.1), but the cold ramp still fires. Expected outcome: solo solstice survivals are rare and memorable; more often the world resets. The reset *is* the story. |
| **Social threshold (design clicks)** | **3 players** | Full role coordination emerges. Achievable during scheduled solstice events with even a small Discord push. |
| **Meaningful step from solo** | **2 players** | Not full role emergence, but role-splitting starts (one gathers while the other tends). Materially better survival odds than 1. |
| **Ideal group size (event)** | **3–6** | Realistic Discord-group scale at solstice times. |
| **v1 tested maximum** | **8 players** | Honest ceiling for the 4-week timeline. Program baseline reaches 20; we don't stress-test what won't happen at this scale. `[HYPOTHESIS]` H1-06 covers the 8-player 30fps mobile target. |

**Solo-meets-another-player by design:** single spawn point at the central hearth. Any player logging in during another's session lands next to them by geometry — no matchmaking system needed. If solo hours are truly solo, they play until logout or reset.

**Wood scatter + territory tuning implication:** wood density and per-fire fuel drain must feel achievable for 1 player holding the central hearth through normal nights. The DIFFICULTY comes from solstices, the compounding cold ramp, and the *choice* of whether to push out for a satellite fire — not from the daily grind being solo-hostile. `[OPEN: waiting on Phase 2 playtest tuning]`.

### Disappearance test

*If every other player vanished but their traces (melted paths, banked wood, hearth fuel, day-count history) remained, what breaks?*

- **What survives:** the gather-and-feed loop still works. A solo player can play a full session. The verbs, the day/night rhythm, and even individual solstices as timed challenges still function — with a scaled-down territory (central hearth only).
- **What breaks:** the solstice becomes a solo endurance test instead of a communal defense — the **emotional peak of the game evaporates**. The high-score day count, still visible, feels *borrowed* — someone else set it. Torch-chain and every other role-coordination beat have no B to respond. Lore fragments unlock but nobody to share the *"did you see this?"* with.

Honest one-line: **solo play is complete-feeling for a session; the record run and the solstice as event are the parts that require other players to matter.**

### Robustness and colour

**Drop-in / drop-out.**
A late arrival contributes immediately by picking up any log and depositing it. A leaver takes nothing with them; wood banked at the hearth stays for the group. A spoiler player cannot break play — no PvP, no destructible progress; the worst they can do is refuse to help. Trolls have nothing to grief.

**Bystander test.**
A player who just watches sees a lit hearth with a countdown, a fire-network status readout, other players' torches moving across the field, and — when night falls — the whole crew huddled at the fires feeding logs. The stakes are legible without a tutorial: *"they're trying to keep the fires alive."*

**Memorable moment.**
Logging in to find the hearth burning low with 90 seconds of fuel left, the previous player's Discord message still fresh, and dropping your first log in just before it snuffs — the day streak saved by a shift handoff neither of you planned in detail. The target emergent pattern of the game.

**Bring-a-friend.**
A new friend spawns next to you at the hearth with nothing to learn — hand them a torch and point at the snow. Duo doubles your reach and unlocks the 2-player role-splitting threshold; if you time the invite before the next solstice, they see the game's peak on their first session.

---

## 6. Mobile-First (Cross-Platform)

### Design posture

**Cryogenia is designed for desktop's ambition and ships with full mobile playability.** The core loop is inherently touch-native — walking + tap is the whole verb set — so mobile compatibility is not the constraint on the design; the *fidelity ceiling* is. Desktop players experience the full visual and atmospheric build; mobile players play the same game at leaner particle and shader budgets.

### Verb-to-touch mapping

| Verb (from §3) | Touch input |
|---|---|
| Walk / gather | Native DCL joystick or tap-to-move |
| Melt snow with torch | Passive — happens by walking with a lit torch. No input. |
| Pick up wood | Tap prompt when close (E on desktop, tap on mobile) |
| Feed the fire at hearth | Tap prompt |
| Chain-light torch | Passive — auto-fires on torch-to-torch proximity |
| Relight torch at hearth | Tap prompt |

Zero chords, zero aim, zero hover-dependent UI. Every verb maps to walking or a single tap on any device.

### Small-screen UI

Top strip: day count + solstice countdown + high-score record. Bottom strip: fire-network status (lit / dormant / dead per satellite) + personal frost bar + torch fuel icon. Everything else is diegetic — fire size, snow depth, other players' torches, held territory. No inventory screen, no minimap, no multi-panel menus.

### Performance targets

| Platform | Target | Concurrent players |
|---|---|---|
| **Recommended desktop** (mid-tier laptop) | 60 fps, full visual fidelity | 8 |
| **Named mobile: Pixel 6a on DCL mobile client** | 30 fps, lean variant | 8 |

**Mobile lean-variant specifics:** reduced snowfall particle counts, simplified hearth particles, no aurora at Day 100, fewer per-tile paint updates per frame. Same core loop, same verbs, same visuals in structure — tuned-down in density. Detection via DCL platform APIs, applied at scene load.

### Biggest performance risk + plan

**Risk:** snowfall + hearth particles + melt-tile CRDT updates during a nighttime scene with 8 concurrent players, **now compounded by the ~5× scale increase** (§3 Scale and traversal). Density × area × particles is the risk stack. The paint-sync tile refactor (repo README v2.7) already handled the tile-CRDT case at scale; the outstanding concerns are (a) particle count during HEAVY weather + solstice effects, (b) draw distance and asset density in the expanded world. `[HYPOTHESIS]` H1-06 covers the 8-player 30 fps mobile target.

**Plan:** cap engine particles at 1000/sec globally; snowfall rate on mobile drops one tier below the desktop equivalent (mobile HEAVY = desktop MEDIUM density, at the same visible weather level); leverage Cryogenian ice-haze fog (§7) as free occlusion for far-distance LOD culling; sparse reveal density in outer zones. Contingency: if the mobile lean-variant still fails H1-06 at Week 2 playtest, first fall back scene scale from 5× to 3× (§3); if still failing, drop mobile v1 tested max from 8 to 6 concurrent players and update §5 accordingly.

### Desktop-only dependencies

None load-bearing. Click-drag spectator pan is desktop-only (mouse-native input); the mobile client uses the existing on-screen d-pad for the same action. No mechanic requires precision aiming, hover states, or keyboard combos.

---

## 7. World, Look & Story

### The world

This is Earth, hundreds of millions of years ago, at the edge of the great freeze — the epoch geologists will one day call the Cryogenian. The ice is winning. Somewhere beneath it lie the ruins of the civilization that saw this coming: a network of volcanic ignition stations built to warm the world back to life when the time came. The fires you tend now are candles next to what waits under the snow.

**The tech.** The ancients understood what you are re-learning: heat clears the way. They scaled it — chains of volcanoes, prepared and dormant, waiting for the right sequence and the right hands to wake them. The lore fragments buried in the snow are what they left behind: locations, warnings, procedures. Reading them is remembering.

**The trees.** Nothing grows in Cryogenia. The forests you find — the standing dead of the Deadwood Grove, the pines of the Pine Grove — are *pre-freeze remnants*, timber left standing when the world locked. Every tree is a finite reserve; no seedling replaces one you fell. The wood budget of the map is the wood budget of the whole civilization that walked here before the ice. This is why the ancients built the volcano network: they knew the fires would eventually run out. The v1 loop of burning down a finite forest is exactly the pressure that names the v2 answer.

**Why the premise works with the verb.** Torch melts snow to reveal wood. Hearth holds warmth against the night. Volcano network, at scale, thaws the world. Same verb, three tiers. The macro loop is the micro loop, planet-sized.

### Visual signature

The sky is heavy and low. A pale sun struggles through thick ice-haze; the horizon fades into whiteout at any distance; the world feels *pressed down* under weather. Cool palette dominated by pale blues and violets, warm gold only from fire. At night the sky clears just enough for stars and the occasional aurora — rare beauty against the cold, not decoration.

**Tone:** quiet · ancient · myth-shaped · deep-time weight — **geologic-archaic**. This is Earth, before memory. Not sci-fi. Not folk-tale.

**Reads on a small screen:** avatars stand out against pale snow; lit torches are the brightest thing on-screen at any distance; wood chunks glow faintly under melting snow. Navigation is legible by fire-light: the central hearth is the brightest fixed point in the world; satellite pits (once unlocked) are dimmer secondary beacons.

### v2 hook (not shipping in v1)

`[v2 scope]` The lore drip in v1 (Ancient Station foreshadow discovery + Day 100 lore fragment) points at the ancients' **volcano ignition network** — dormant stations buried under the deepest snow, built to break the ice-albedo feedback loop with CO₂ outgassing at planetary scale (the real-world mechanism that ended Snowball Earth). In v2, sufficient community progress unlocks the search for the first station, then the sequence of ignitions — the final "thaw" win-condition. If completed: volcanoes wake, snow melts, grass and flowers bloom, world-state persists for a season, then the cycle begins anew. Activated volcanoes eventually *physically transform geography* (snow retreats, ice fractures, new terrain reachable, new discoveries become accessible) — the macro-loop becomes: **explore geography → gain capability → use capability → alter geography → reveal new geography**.

**Torch → Hearth → Volcano — the same verb at three scales:**
- **Torch** warms the immediate environment (a few meters).
- **Hearth** makes territory habitable (a network of fires).
- **Volcano** makes regions of Earth habitable (a planetary ignition network).

All three are *bring warmth into a frozen world*. V1 teaches players to use fire to conquer geography; V2 reveals that the final fire is the Earth itself. The Ancient Station foreshadow discovery in v1 exists precisely to seed this arc — the desired reaction to encountering it is *"what the hell is this?"*, answered only in v2.

---

## 9. v1 Build Plan (5 themed weeks)

**Team:** 1 solo dev, AI-assisted · **15–20 hours/week** on Cryogenia. AI assistance shortens draft-code and design-doc time; testing, playtest coordination, deploy work, and community setup remain real calendar hours.

**Foundation:** the existing repo already ships the verbs (torch, hearth fuel, wood scatter, frost death, torch chain, weather, cycle infrastructure, paint-CRDT). v1 is a **pivot from cozy hangout to man-vs-storm territory survival at scale**, not a build from scratch.

**Delivery principle:** simulation feels good first, mechanics on top, then depth, then the peak moment, then polish. If the world doesn't feel right at Week 1, no reveal table at Week 3 saves it.

**Each phase has a theme so it can be pitched in a sentence.** The *goals* per phase are firm; the *ordering and pace* is not — in practice some phases finish in a couple of days and others take a couple of weeks. "Week" is a label for the theme, not a calendar promise.

### Schedule

**Start:** 9/23 Mon (v0 sign-off + v1 project launch)
**Submit:** 10/27 Mon (v1 sign-off)

~5 weeks of calendar between the bookends, split across the five themed phases below in whatever proportion the build demands. Playtests happen at natural seams — end of Systems, end of Depth + Holes, and inside Solstice + Game Loops — not on fixed dates.

### The five phases

| Week | Theme | One-line pitch | Playable outcome |
|---|---|---|---|
| **1 — Systems** | Foundation | *Time, weather, cold, and the persistent-civilization backbone behave like a world.* | **H1-06 mobile perf smoke test first** — result determines the parcel envelope (32×​32 / 64×​64 / 100×​100) before spatialization work commits. Day/night phase clock (server-time authority, all 6 phases scaffolded: DAY / DUSK / NIGHT / SOLSTICE_WARN / SOLSTICE / GRACE), full seasonal cycle (autumn → early winter → deep winter → solstice approach → winter solstice → thaw → spring), weather profile-per-season, optional fog system decided in/out this week (fog is a Phase 1 priority — it enables aggressive far-distance culling without visible pop-in). Sleeping-ember failure model live. **Lightweight persistence backend** stood up (Cloudflare Workers / Firebase / equivalent — not a full Multiplayer Server) with persistent world-state, per-player last-seen state, deterministic-on-read offline advancement, and extinction-witness reset logic. **DCL CRDT** confirmed for in-scene real-time sync. **Debug commands** implemented for internal testing (season jump, solstice trigger, day advance, force-extinction, seed roll). **Perf disciplines locked as Phase 1 constraints:** distance-based particle culling (fire ember particles, snow) with fog occlusion hiding the cull line; snow-tile LOD (near tiles fine-grained, far tiles coarse); lazy-spawn for wilderness kindling (entities created on melt-reveal, not upfront); inner-500 m ring at full fidelity, outer envelope decorative + heavy LOD. **Data-driven content pool scaffolding** in place: biomes, discoveries, fuel types, hazards declared as data structures the generator reads from — not hardcoded (this is the technical constraint that makes v1.5+ expansion a matter of authoring, not rewriting). World ticks correctly with no new mechanic on top. |
| **2 — Spatialize + Fun** | Geography as tech tree — prove the architecture, not the content | *Two biomes + one functional discovery on a procgen map, three-tier fuel + charcoal portability, fires anchor territory, worlds are persistent + finite.* | **V1 = gameplay proof, not content proof** (scoping principle). Deadwood Grove + Pine Grove biomes live with clustered trees holding fixed per-tree wood budgets (~3–5 logs each) and torch-melt-fell tree-mining mechanic. Wilderness kindling scatter as baseline. **No in-run wood regrowth** (Pillar 5): budget is set at world-seed and only refreshes on new-seed generation. Three-tier fuel wired into existing `hearthFuel` model. Three fire archetypes (spawn hearth / biome anchor / rest stop) with uniform decay + 60 s ember + dormancy. **Data-driven content pool architecture** (Pillar 10): biomes, discoveries, hazards, fuel types all declared as data, spawned by generator per seed. Procgen generator places biomes, anchor, rest stops, hazard belts, and the Kiln discovery per seed. Cabin/Kiln discovery visible with functional charcoal interaction wired *this* phase (upgraded from earlier plan of Phase 3, since Decision C is now locked). **Persistence backend + persistent-civ state + return-screens live** end-to-end from Phase 1. **Game-balancing pass** across interacting dials — fuel burn-values per tier, fire decay rate, ember grace duration, per-tree + total-world wood budgets (**generous v1**: comfortable within a normal run; scarcity bites by 2nd–3rd solstice on long runs), wilderness kindling density, torch fuel budget vs. hearth→anchor distances, tree-fell melt duration, dormant-fire reclaim cost, **charcoal conversion ratio + burn value (portability target: ~2.5× fire-time per carry slot vs. raw deadwood)**, **expansion-as-investment** target (establishing a route must pay back within a normal-length run — not a chore, an investment), deep-snow speed reduction, frost accumulation vs. warmth radius, wood pickup + deposit prompt distances. Loop is fun for 20 minutes; procgen produces meaningfully different strategies across ~3 different seeds. |
| **3 — Depth + Holes** | Repeat what worked, file the sharp edges | *Mystery discovery + hazards placed, sharp edges filed off.* | **Ancient Station foreshadow discovery placed** — authored buried structure, distinctive silhouette, torch cannot activate it, mostly-buried with hints of a larger network (the "what the hell is that?" beat that seeds v2). Appears in ~50% of seeds so the discovery pool exhibits per-seed presence/absence variability. Ice-hazard tiles + deep-snow belts placed on biome-access paths. **Holes list from end of Phase 2 playtest gets worked through** — death/respawn/reload/handoff mechanics (esp. respawn point when hearth dies but a satellite lives: nearest-lit-fire to death-point; oldest-continuously-burning fire becomes designated home), torch-relight edge cases, dormancy reclamation cost, procgen edge cases (unreachable anchor, biome/discovery overlap, silhouette collision), extinction-witness sequence and reset splash timing, whatever the playtest exposed. **Playtest questions:** *"Where would you go right now if you needed fuel?"* Answer names a **place** → Pillar 4 works. *"You can only tend two fires tonight. Which do you let sleep?"* Answer references a **capability class** → anchor↔biome coupling works. *"What was the strangest thing you saw?"* Answer references the Ancient Station or something similar → curiosity loop works. |
| **4 — Solstice + Game Loops** | The peak moment and the loops that lead into and out of it | *The solstice is the moment. The day, year, and reset loops all resolve cleanly around it.* | Solstice event end-to-end (SOLSTICE_WARN siren + 2 min countdown → SOLSTICE whiteout + doubled night → GRACE recovery arc). Seasonal cadence readable — each season *plays* as a distinct strategic phase (Expand → Prepare → Consolidate → Hold → Survive → Reclaim → Expand). Empty-server run/world reset behavior verified end-to-end. Multiplayer playtest with 3+ players confirms the peak lands. |
| **5 — Polish + Ship** | Look, sound, and pitch | *Audio, UI, trailer, deploy.* | Audio pass (torch, campfire, snowfall, solstice siren). UI unification (HUD strip, fire-network/frost bars, countdown). Level visual redesign (block/prop art pass toward the Cryogenian look). First-30-seconds onboarding (playtest-reactive). 60–90 s trailer. `docs/VISION.md` + README pass. Final mobile perf smoke. Optional meta-progression carry mechanism if scope allows. Deploy dry-run → submit. |

### Live-ops — what keeps the experience changing after launch

- **Changes without a build:** seasons progress → the world visibly changes state day to day → the game *feels* different across visits without a code change. Every civilization is a different procgen seed — different biome positions, different discovery selection, different terrain.
- **Variation on missed updates:** weather system randomises profile per cycle inside phase bounds; every new-seed generation reshuffles the entire tech-tree layout.
- **Persists across resets:** direction locked (see §3.4), form deferred. In v1.1 or Week 5 if scope allows, a communal Legacy counter or well-tended-hearth buff carries forward from successful winters. Aligned with Pillar 8: any carry-forward is communal, never personal.
- **Player behaviour that would change what's built next:** if solo solstice survival is impossible → tune territory/cold curve in the Solstice + Game Loops phase; if the return-screen doesn't produce D1 pull → iterate on what it shows; if the Depth + Holes playtest reveals onboarding gaps → Polish + Ship protects the first-30-seconds pass; if procgen doesn't produce meaningfully different strategies across seeds → tune biome/discovery separation and seed-time invariants.

### Explicit non-goals for v1

- **No combat / mobs.** Man vs. winter, not man vs. mob (Pillar 1). Combat is a v2 conversation.
- **No leaderboards.** Shared-pool survival, not competitive.
- **No permadeath.** Individual death respawns; only the civilization can end (Pillar 6: when the last fire dies).
- **No tool tiers.** No axes, no upgraded torches, no crafting menus. The one exception is the Charcoal Kiln — which is a *discovery interaction*, not a crafting system (carry → deposit → ignite → retrieve, no UI).
- **No personal gear or per-player upgrades.** Meta-progression is communal-only (Pillar 8).
- **No NPCs, quests, or dialogue.**
- **No world map, minimap, or place-locator UI.** Locked as non-goal 2026-09-22: player-held maps would undermine geographic discovery (Pillar 4) and turn the biome/discovery vocabulary into a checklist. Players navigate by silhouette, firelight, terrain, and memory. Discord and in-scene chat fill the coordination channel.
- **No mechanical extinguish, drain, or grief action against fires.** Players can only help fires. This removes grief vectors by construction. *(Previously a pillar; demoted to non-goal 2026-09-22 — the finite-fuel model does the load-bearing work now.)*
- **No compressed seasonal cadence in shipped builds.** Live cadence stays real-time. Debug commands for internal testing only; sped-up cadence for external playtesters is a TBD Phase 2–3 call, not a shipped feature.
- **No fire archetypes beyond 3.** Spawn hearth + biome anchor + rest stop is the full v1 fire hierarchy (locked 2026-09-22). Way-station, overlook, ancient-ruin, hot spring, and any additional archetypes — all v1.5+.
- **No torch tiers, torch crafting, or torch stubs.** Considered 2026-09-22 as a Pine Grove double-value mechanic; cut. Torches remain unchanged from v0. Wood-in-hand always goes to a fire's fuel pile, one destination, no ambiguity. Revisit as v2 depth-add if playtest shows a gap.
- **No inventory system beyond the two-hand rule.** Torch in one hand, one carry slot in the other. No bags, no menus, no crafting UI. (See §3 two-hand rule.)
- **No hunger, thirst, or cooking.** Cold is the sole survival axis in v1. Adding a second dilutes it.
- **No player equipment with persistent stats.** Warmth items are one-shot consumables, not gear. Identity progression accumulates *history*, not power (see §4).
- **v1.5 headline preview — the scarcity ladder.** v1's finite-wood model is the first rung of the game's pitch spine: **v1 wood scarcity → v1.5 coal / ancient stores → v2 volcanoes**. v1.5's headline features are new biomes and discoveries that answer the scarcity pressure v1's finite forests produce. The v1 loop of burning through a finite forest is designed to make the v1.5 hunt for coal feel *earned*, not tacked on. Coal and ancient stores are explicitly out of v1 scope.
- **Deferred to v1.5+ biomes** (regions the community moves through): **coal mine / coal field** (v1.5 headline biome — rarer than pine, longer-burning; exposed seam or pit-head silhouette; anchor fire on-site; fixed procgen destination biome outside the 500 m ring), peat bog, hot springs / geothermal region, frozen lake (traversal biome).
- **Deferred to v1.5+ discoveries** (specific places the community finds): **ancient fuel cache** (v1.5 companion — small rare ruin-flavoured sites; pre-processed premium fuel, no torch-melt-fell required; ties to §7 ignition-manual lore), watchtower, mine entrance, ancient storehouse, weather station, ancient ignition station (v2), frozen expedition, ancient marker, buried settlement, strange monument, ancient machine.
- **Deferred to v1.5+ other:** ancient marker stones (mythic world-counter), named graves, ember stones (candidate reveal), identity hover-stats on other players, portable compass (reserved v2 as volcano-station pointer), final lore prose, discovery-broadcast attribution UI polish. Simulation and Loop 1/2 fun take priority in v1; Loop 3 surface expands in v1.5.
- **The growth model, going forward.** Content expansion in v1.5+ is primarily *authoring new data* (adding biomes + discoveries + fuel types + hazards to the generator's pools) rather than new gameplay systems. That is the discipline Pillar 10 exists to enforce.
- **No wallet-gated content.**
- **No trailer or pitch work until the loop is playable** (Week 5 only).

### Top risks

| Risk | Mitigation |
|---|---|
| Persistence backend setup in Phase 1 blows scope | Ship the minimum viable state API (world-state + per-player last-seen) on a managed serverless platform — not a full Multiplayer Server. "While you were gone" full return-screen polish can slip to Phase 3–4 if needed. The persistence *has to exist*; the polish is the layer that slips. |
| H1-06 mobile perf smoke test fails at 100×​100 | Fall back to 64×​64 (already sized for the 500 m inner ring). If 64×​64 also fails, evaluate multi-scene World architecture as the next fallback. The v1 loop lives in the 500 m ring either way. |
| Phase 2 spatialization isn't fun even with the persistent-civ framing | Phase 3's "Holes" bucket absorbs re-tuning; if still not fun by end of Phase 3, cut the mystery discovery to buy tuning time (Kiln is the load-bearing discovery; Ancient Station is optional). |
| Week 3 holes list is bigger than a week | Draft the list end of Week 2 from the playtest, prioritize Monday. Anything unfixed becomes a Week 4 sidebar or a v1.1 note — do not let it eat Week 4. |
| Solstice arrival not readable | 2-min warn window with siren + sky darken; Week 4 playtest question covers it directly. |
| Mobile perf regresses under HEAVY weather | Perf test end of Week 2 + Week 4; fall back to lighter particle counts before cutting mechanics. |
| Polish week (5) gets eaten by feature debt | Week 4 is feature freeze. Anything not shipped by end of Week 4 is a v1.1 note. |

---

## 3. Core Loop

**The verb:** warm the ground to see what's there.

**The two-hand rule.** Your torch is always in one hand. The other hand carries *one thing at a time* — a log, a warmth item, an ancient find. Picking up something new drops what you had. No inventory screen, no menu. Every reveal under the snow is a decision: *is this worth the log I was carrying?*

**The three-horizon pitch:**
> *Stay home and you can survive today.*
> *Expand and you may survive the winter.*
> *Keep pushing the frontier across many winters and you may discover how to end the ice age.*

Each horizon corresponds to one of the three nested loops:

| Loop | Scope | Ships in v1? | Success = |
|---|---|---|---|
| **Day (micro)** | ~9 min realtime | Fully | Fires alive at dawn |
| **Year (meso)** | ~20 in-game days (roguelike lean) | Fully | Survive the winter solstice |
| **Ignition (macro)** | Many years, community-scale | *Foreshadowed only* | Wake the volcano network and thaw the world (v2 payoff) |

- **Day (micro, ~9 min):** dawn → gather → dusk → defend → dawn resolves.
- **Year (meso, ~20 in-game days):** autumn → early winter → deep winter → solstice approach → winter solstice → thaw → spring. Success at the solstice keeps the run alive; failure resets the world.
- **Ignition (macro, across many years):** the community's cumulative progress toward waking the ancient volcano network and thawing the world. In v1 this loop is *visible but not closable* — its surface is the lore fragments (§4.2) read as ignition-manual pages, the community day-count record, and the Day 100 cliffhanger fragment that names the first station's location. The payoff — actually igniting the volcanoes and ending the winter — ships in v2 (§7 v2 hook). Torch → hearth → volcano is the same verb at three scales.

### Per-day beats

| # | Step | Player does | Sees / hears | What changes | Why do it again |
|---|---|---|---|---|---|
| 1 | **Dawn** | Wakes near a lit fire | Fire warms, day count ticks up, season indicator visible on HUD | Frost resets | New day to expand or reclaim |
| 2 | **Day (gather / expand)** | Ventures out with lit torch; melts snow; picks up revealed wood; returns and feeds a fire. In territory model: may reclaim a lost fire | Snow melts under torch; wood chunks glow; other players' torches visible across the field | Wood picked up, torch fuel drains, frost accumulates outside warmth; fire fuel refills | Days will shorten; nights will get colder |
| 3 | **Dusk** | Regroups near a fire; commits to which one(s) to hold overnight | Sky darkens, weather thickens, "Night in 1:00" warning | Fires low on fuel may not survive without immediate feeding | Getting caught out at nightfall is fatal |
| 4 | **Night (defend)** | Stays near warmth, feeds fires from stockpile | Cold rises, snowfall heavy, fire fuel draining, snow regrows aggressively | Fire fuel drains; if under-tended, a fire enters sleeping-ember state (60 s to relight); if unsaved, the fire dies and its territory refreezes | Moments from surviving another day |
| 5 | **Dawn resolves** | Sees which fires lived | Sunrise; surviving fires still warm; dead-fire embers gone | `day++`; season may advance; cold trends up toward solstice | Tomorrow will be harder — the solstice approaches |

### Per-year beats (the seasonal arc)

| Season | Vibe | Difficulty axes moving |
|---|---|---|
| **Autumn** | Baseline. Days long, nights short, snow light. | Baseline |
| **Early winter** | Days shortening, snow thickening. | Night length ↑, snowfall ↑ |
| **Deep winter** | Cold begins to bite. Fires drain faster. | Frost damage ↑, snow stack ↑ |
| **Solstice approach** | The world is telling you something's coming. | All axes ↑↑ |
| **Winter solstice** | Whiteout night, cold at peak, night doubled in length. Warning phase precedes it (siren + darkening sky + 2 min countdown). | Peak on every axis |
| **Thaw** | The storm has passed. Cold recedes. | All axes stepping back down |
| **Spring** | Recovery. Nights short, snow light. Preparation for next winter. | Approaching baseline |

### Solstice survival

**Success condition (loose):** any player alive AND any fire still lit at solstice end. Not a strict fail-check — a lone survivor with one dying fire counts. This is a story-generator, not a scoring system.

**Failure:** every fire dead + every player frozen (or logged off) → world sits dead until the next player arrives to a "winter reclaimed the village" splash and a fresh start.

**Two-tier meaning (direction locked, form deferred):** survival alone counts as *making it*; survival with territory intact may carry meta-progression forward. See [`docs/v1-4week-plan.md`](../docs/v1-4week-plan.md) §3.4.

### Loop completion

**Per-day:** each dawn resolves the previous night. Fires either lived, entered ember state and were saved, or died. `day++`.

**Per-year:** the winter solstice is the annual climax. Post-solstice recovery seasons are the reward; the arc rolls back into a new autumn.

**Individual death:** respawn at nearest fire with frost reset. Contribution time lost, not the run.

**Cycle length:** `[OPEN: pending §0.1 Decision A + playtest tuning]` — first playtest target 5 min day / 1 min dusk / 3 min night (~9 min per in-game day), ~3 days per season.

**Solstice arrival — depends on §0.1 Decision A:**
- *Roguelike (current lean):* solstice = fixed **day number** (target Day 20). A full run = ~20 in-game days ≈ 3 real hours, played in one evening or spread across sessions. Year length scales with day count.
- *Persistent calendar:* solstice = fixed **real-world time** (08:00 / 20:00 UTC). Season and day durations back-solve to hit ~12 h between solstices; expect a longer in-game day (~12 min) and longer seasons (~8 in-game days).

**Session length:** `[OPEN: playtest tuning]` — one full in-game day = ~9 min minimum satisfying visit.

**Repetition 10 — why it stays fresh:** `[HYPOTHESIS]` H1-01 — variability comes from (a) other players and shifting roster, (b) the seasonal ramp changing what the same verbs *mean* (a day-1 walk vs. a solstice-approach walk are the same input, different game), (c) territory decisions about which fires to hold and which to let go dormant, (d) the community's persistent state carrying forward from prior winters.

**Pillars** *(revised 2026-09-22 — full session summary in [`decisions.md`](decisions.md); prior 8-pillar list superseded; #1–8 below are play/world pillars, #9–10 are architecture pillars)*:

1. **Man vs. winter — not man vs. mob.** The enemy is winter itself: the cold, the deepening snow, the shortening days, the storms that peak at solstice. Explicitly *not* combat: no mobs, no PvP, no NPCs to fight. Naming the negation prevents the survival-game default assumption of creature enemies.
2. **Warm the ground to see what's there.** One legible verb: torch heat melts snow, revealed patches reveal *something* — wood, warmth items, unlit fires, ancient objects, lore fragments. The variety comes from what you find, not from new verbs.
3. **Fire = safety, distance = stakes.** Every fire is an island of warmth; every step away from one is a risk. The whole spatial-tension core of the game rides on this.
4. **Geography is the tech tree.** The map itself is the progression system. Different biomes and discoveries grant different capabilities; the *tempo* of survival is set by which places the community can reach and hold. In v1 this shows up as a three-tier fuel system (kindling / deadwood / pinewood) plus the Charcoal Kiln discovery (portability tech). A community holding Pine Grove *breathes*; a community reduced to kindling scavenging is *grinding*; a community with a Kiln can *push farther*. That gap IS the pillar.
5. **The world's fuel is finite. Every burn subtracts. Reset is the only renewal.** Cryogenia is Snowball Earth: nothing grows. Trees are pre-freeze remnants with fixed per-tree wood budgets (~3–5 logs); no in-run respawn. The map has a total wood budget the community spends down from ignition. Depleted trees leave permanent stumps. World reset (extinction → new seed) restores the budget — the reset *is* the regrowth. Turns tending the fire from a task into a *cost*, and makes the v1 → v1.5 → v2 scarcity ladder (wood → coal / ancient stores → volcanoes) the game's spine.
6. **Civilization survives while any fire remains.** Loss of the central hearth does not end the run if any other established fire is still lit. When the hearth dies with a satellite alive, the oldest continuously-burning surviving fire becomes the community's new home (respawn point + HUD-designated "current hearth"). Only the death of the *last* remaining fire triggers extinction. This is what makes territorial expansion *redundancy*, not just capability, and produces the exile / migration / reclamation narrative arc.
7. **Worlds are shared, persistent, and mortal. When a civilization dies, a new seed begins.** *Shared* — one civilization per world, common to every player. *Persistent* — world state survives between logins and continues advancing at full rate while the server is empty. *Mortal* — civilizations can and do end; extinction is real. When the last fire dies, the next arriving player witnesses the extinction and a new world seed is rolled. This is Cryogenia's retention model: persistent shared-world survival roguelike.
8. **Progress belongs to the civilization. Memory belongs to the player.** The world accumulates capability (day count, discoveries made, territory held, records set). Players accumulate biography (worlds witnessed, solstices survived, discoveries credited to them, deaths where they froze). No personal power progression — no gear tiers, torch upgrades, character levels, or per-player unlocks. This is the design line that prevents drift into MMO progression across every future feature decision.
9. **Biomes are landscape. Discoveries are landmarks.** *(Architecture pillar.)* Biomes are regions the community moves through — spatially extended, characteristic terrain, resources distributed across them (Deadwood Grove, Pine Grove, wilderness). Discoveries are specific places the community finds — singular, authored, memorable (Charcoal Kiln, Ancient Station, Ancient Cache). Both can provide capability, resources, or mystery; the difference is spatial shape and how the world generator treats them. Every future content proposal resolves cleanly against this split.
10. **Complexity from the world, not the verbs.** *(Architecture pillar.)* New depth is added by making the world more varied — more biomes, discoveries, hazards, mysteries — not by adding new player verbs, inventory systems, or UI. One legible input; many geographic contexts. This is what makes the game growable through content-pool additions rather than mechanical redesign, and it is the technical constraint that keeps v1.5+ development a matter of authoring new data rather than rewriting core systems.

### What's under the snow (reveal table)

Snow-as-mystery-layer: the melt verb payoff is not just wood. Rare finds under the snow drive discovery and turn the same verb into a different game each session.

**v1 reveal table (tight scope):**

| Reveal | Frequency | Carry slot | Role |
|---|---|---|---|
| **Kindling / brushwood** | Sparse-but-common under any wilderness snow | Yes | Baseline scavenging fuel. Adds ~30 s to a fire. Wilderness is one-shot — no above-snow signal, no in-run respawn. *"Something is better than nothing."* |
| **Deadwood log** | Gathered from felled dead trees (Deadwood Grove biome, clustered); rare wilderness scatter | Yes | Staple fuel. Adds ~2 min to a fire. Trees are pre-freeze remnants with a fixed per-tree budget (~3–5 logs); no in-run regrowth. The community's pantry — large but finite. |
| **Pinewood log** | Gathered from felled pine trees (Pine Grove biome only, clustered) | Yes | Premium fuel. Adds ~5 min to a fire. Fixed per-tree budget; no in-run regrowth. Geographic reward for reaching *and holding* the Pine Grove anchor. First fully mechanical proof of *geography-as-tech-tree* (Pillar 5).
| **Unlit anchor / rest stop fire** | Procgen per seed (2 biome anchors + 1 Cabin/Kiln chimney + 2–3 rest stops) | No (fixed) | Territory node. Light with a torch to claim; feeds like any other fire. Anchor = biome gateway; rest stop = corridor support; Kiln chimney = Charcoal Kiln discovery anchor. |
| **Lore fragment** | Rare | Yes | Read at the hearth. Adds to community journal. Ignition-manual pages (see §4.2). Placeholder text in v1; final prose v1.5. |

**Fuel numbers are starting guesses** (playtest-tunable) with ratios of roughly 1 / 4 / 10 across kindling / deadwood / pinewood by burn-value. All three feed into the existing `hearthFuel` burn-time model — no new fuel system, three new log types. Fire size + warmth radius scale from remaining burn-seconds (existing behavior), giving the player a diegetic fuel readout with no HUD number required.

**Trees as biome signal (prototyped, extended in v1).** Trees are the visible marker of *where the good wood is*. Dead trees mark deadwood clusters; pine trees mark pinewood clusters. Wilderness kindling exists everywhere under snow with no above-snow signal — you find it by melting. This is the geography-as-tech-tree principle made explicit: silhouette on the skyline tells you what tier you're walking toward.

**Tree-mining mechanic (v1, locked 2026-09-22).** Trees do not drop logs on approach — they must be felled first. Player sustains torch heat at the trunk base until the tree falls (extension of the melt verb; ~3 s target, playtest-tunable). Downed trunks yield the tree's fixed wood budget (~3–5 logs per tree). Downed-trunk gather visual is one of two options (decision deferred to build): (a) shatter-on-fall into pickup-able log entities, or (b) progressive chunking of the trunk model as logs are pulled. Depleted trees leave permanent stumps for the rest of the run — a Day 80 world looks lived-in. **No in-run regrowth**: the world's total wood budget only refreshes on world reset (see Pillar 8).

**Fire archetypes (locked 2026-09-22):**
- **Spawn hearth** — 1, fixed at scene center. Never fully dies (livable floor). Only its true death triggers world reset.
- **Biome anchor** — 1 per biome (2 in v1: Deadwood Grove, Pine Grove) + 1 Discovery anchor (Cabin/Kiln). Anchor fires unlock the biome or discovery's tech through sustained presence. Uniform decay; 60 s ember grace; dormancy on failure.
- **Rest stop** — 2–3 per seed, procgen on paths between hearth and anchors. Supports corridor travel and torch relighting mid-expedition. Same decay + ember + dormancy rules as anchors. A dormant rest stop breaks a supply corridor without losing a biome outright.

**Procgen per world reset.** Every seed rolls fresh biome positions, anchor positions, rest stop positions, and hazard belts. The spawn hearth is the only spatially fixed feature. Generator invariants: each anchor reachable from the hearth on a fresh deadwood torch with margin, biome silhouette diversity guaranteed, biomes do not overlap. Full spec in [`spatialization-plan.md`](spatialization-plan.md).

**Deferred to v1.5+** (Loop 3 surface + progression): **coal mine / coal field** (v1.5 headline biome — rarer than pine, longer-burning fuel; exposed seam or pit-head silhouette; anchor fire on-site; fixed procgen destination biome outside the 500 m ring; the mechanical answer once wood scarcity bites in long runs), **ancient fuel cache** (v1.5 companion biome — small rare ruin-flavoured sites left by the pre-ice civilization; pre-processed premium fuel, no fell required; ties to §7 ignition-manual lore), ancient marker stones (mythic world-counter with thresholds), named graves (aesthetic trace of frozen players), ember stones (candidate reveal), **resin wood** (specialist re-ignition fuel), **hot springs / geothermal warmth zones**, **frozen lake fast-traversal route**, **ancient ruins as compass biome** (portable compass reserved for v2 as volcano-station pointer), **chopping and axes for standing timber** (v2 progression tier), **torch tiers / crafting / stubs** (considered and cut from v1 to preserve mechanical simplicity; revisit as depth-add in v2 if playtest exposes a gap). These extend geography-as-tech-tree beyond the v1 baseline; ship after the three-biome + three-tier loop proves out.

**Hazards (environmental, not reveals):**
- **Thin ice** — partially visible blue tint under snow. Fall through: frost damage + carried item drops. Punishes rushing, especially at night.
- **Deep-snow zones** — painted differently, ~40% walk-speed reduction. Makes route planning matter.

### Seasonal cadence (each season plays as a different phase)

Seasons are not just difficulty modifiers — each is a distinct strategic phase. The verbs stay the same; the question *what am I doing today?* changes.

| Season | Strategic phase | What the player is doing |
|---|---|---|
| Autumn | **Expand** | Push out. Light satellite fires. Discover new ground. |
| Early winter | **Prepare** | Stockpile wood at strong positions. Identify what to hold. |
| Deep winter | **Consolidate** | Let peripheral fires sleep (dormancy). Concentrate warmth. |
| Solstice approach | **Hold** | Everyone home, everyone tending. Preparation window closes. |
| Winter solstice | **Survive** | The boss beat. Storm attacks the network you built. |
| Thaw | **Reclaim** | Wake sleeping fires. Reoccupy lost ground. |
| Spring | **Expand again** | Push further than last year. Reveal what winter hid. |

This is what keeps repetition-10 feeling different from repetition-1: not that cold is 40% worse, but that the *question you are answering* changes.

**Winter reverses the tech tree — the concrete chain.** Under Pillar 5 (geography-as-tech-tree), losing territory during winter is not just losing a circle on the map — it is *losing access to a capability*. The mechanical chain:

- **Autumn (Expand):** all anchors lit. Full biome capability. Fresh wood budget across every tree. Community *acquires* the tech.
- **Early Winter (Prepare):** fuel drain rate ↑. Community stockpiles at anchors, keeps rest stops fed to preserve corridors.
- **Deep Winter (Consolidate):** roster too small to tend everything. **Choice: which anchor do we let sleep?** Letting the Cabin/Kiln sleep loses charcoal-portability tech (moderate cost — long-range expeditions get much harder). Letting Deadwood Grove sleep drops the hearth to kindling tempo (moderate cost — tending becomes constant). Letting Pine Grove sleep drops the hearth to deadwood tempo (large cost — hearth burns ~2.5× faster than before). Each sleep decision loses a different *capability class* (quantity / quality / portability) rather than a different tier. **The choice of which fire to let sleep IS the tech-tree decision, made under pressure.**
- **Solstice Approach (Hold):** decision committed; corridors stocked with whatever tier the surviving anchors supply.
- **Winter Solstice (Survive):** realistically hearth + one anchor is the honest ceiling for small rosters. Pre-solstice anchor choice determines fuel tier during the whiteout.
- **Thaw (Reclaim):** sleeping fires reclaimable at wood cost — spent from what's left of the world's finite budget. *"First thing we're doing this spring is taking the pine back — no pine since Deep Winter."* Late runs increasingly play out against a visibly depleted map (stumps everywhere), which is exactly the pressure that drives outward exploration by the 2nd–3rd solstice — and, in v1.5, the reason to hunt for coal / ancient stores.
- **Spring (Expand again):** full network restored; next winter starts richer.

Most survival games only give the player capabilities. Cryogenia temporarily takes them away. This is what makes the seasonal cadence mechanically consequential, not just a difficulty modifier.

**The map is the score after Solstice.** Success is not binary. A great winter might leave nearly the whole network intact; a brutal winter might leave only the central hearth and one satellite; a catastrophe extinguishes the hearth and ends the run. The *state of the map* at dawn after the Solstice tells the story of the winter without needing a scoreboard.

### Scale and traversal

**Target scale: 100×100 parcels** (1600 m × 1600 m envelope, ~1568 m playable interior after edge offset) — roughly 3× the linear dimension of the current 32×​32 scene (~9× area). **Locked 2026-09-22.** Scales up the parcel allocation in `scene.json` from 1024 to 10 000; a Decentraland World deployment supports this envelope size, but per-frame perf and asset density become the binding constraints (see mobile perf below).

**v1 anchored network zone: inner ~500 m radius from the spawn hearth.** Both biome anchors, the Cabin/Kiln discovery, and every rest stop live within this ring. Outside 500 m is procgen wilderness (kindling scatter, sparse deadwood, hazards) and future v1.5+ frontier content — present as *space to walk into* but not required for the v1 loop to close. The Ancient Station foreshadow discovery (v1) may spawn in the outer wilderness as a mystery beat.

- **Traversal time (v1 network):** hearth → rest stop ~35 s, rest stop → anchor ~35 s, so a hearth→anchor push via rest stop is ~1.1 min one-way; full round trip is ~3 min plus gather time. Anchor-to-anchor cross-map traversal (opposite sides of hearth) is ~1.7 min.
- **Traversal time (full envelope):** end-to-end diagonal is ~6 min at DCL walk speed. Frontier expeditions are multi-minute affairs by design; that's a v1.5+ feature, not a v1 requirement.
- **Torch fuel becomes a hard constraint.** Torch must span hearth→rest stop with margin *and* rest stop→anchor with margin. Chain-lighting is necessity, not cosmetic.
- **Legibility from centre degrades past ~250 m.** Anchor fires stay visible from the hearth via firelight columns through ice-haze (§7). Beyond 500 m the world reads as *space*, not *destination*.
- **Density scales with area, unevenly.** v1 authoring load concentrates in the inner 500 m ring; outer procgen wilderness runs on cheap kindling scatter + hazard belts + LOD-friendly ambient assets.
- **Mobile perf risk:** density × area × particles. At 9× area the risk stack is materially larger than the previous 5× ambition; ice-haze fog as free occlusion becomes structural, not decorative. Tracked under H1-06.

**Decision point:** the anchored 500 m inner-ring commitment is firm; the outer wilderness envelope may be reduced during Week 3–4 if mobile perf smoke tests (H1-06) fail on the 10 000-parcel allocation. Fallback: shrink the parcel envelope to ~64×​64 (1024 m per side) while preserving the 500 m anchored ring untouched. The v1 loop lives entirely within 500 m either way.

**Procgen implication for scale.** Every world reset re-rolls biome, anchor, rest stop, and hazard placements within the generator's invariants (see §3 Fire archetypes and [`spatialization-plan.md`](spatialization-plan.md)). The spawn hearth is the only spatially constant feature. This means "scale" is not just an area target — it's the *room in which procgen has to place a coherent, reachable, distinct-silhouette network per seed.* At 3× the generator has less room to differentiate biomes visually; at 5× it can push anchor separation past line-of-sight, creating real navigation moments.
