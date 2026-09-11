*Work in progress · revised 2026-09-11 against `docs/v1-4week-plan.md`*
*Doc: `▓▓▓▓▓▓▓▓▓▓` · all sections drafted · two open design decisions gated by Week 1–2 prototypes (see §0.1)*

# Snow Drift

| Field | Value |
|---|---|
| **Title** | Snow Drift — IP self-check: clear (all assets owner-created or platform-licensed) |
| **Deployment target** | Decentraland World — `snowdrift.dcl.eth` |
| **Studio** | ile (solo) |
| **Date** | 2026-09-09 |
| **Contact** | Discord: `ile9466` · Email: `lukeeescobar@gmail.com` |
| **Requested round** | **v1** — with a **retroactive v0 request** for what is already live at `snowdrift.dcl.eth` (the pre-pivot cozy build, playable now). |

---

## 0. TL;DR

**Snow Drift** is a shared-world winter survival scene for Decentraland.

> *Hold the light against the storm.*

**Primary player.** Players who enjoy cozy-toned co-op survival games (Don't Starve Together, The Long Dark, Valheim's early-game loop), arriving alone or in a small group of 2–3 from an Event, a Discord community, or a friend invite — looking for a persistent shared-world game with escalating stakes and a community-scale run to push.

**Current status.** Playable core loop in SDK7, live at `snowdrift.dcl.eth`. The current build (v0 baseline) implements the verbs — torch, hearth, wood-gathering by melting snow, frost-death, torch chain-lighting, weather, day/night cycle. The v1 delivery pivots this from cozy hangout to **man-vs-storm territory defense**: seasons progress, cold deepens, and a winter solstice event tests whether the fires have been tended well enough to survive.

**At end of v1 (Week 4).** Live at `snowdrift.dcl.eth` with: a day/night phase clock, a full seasonal cycle (autumn → early winter → deep winter → solstice approach → winter solstice → thaw → spring), the sleeping-ember failure model, empty-server world reset, the winner of the Week 2 defense-mechanic prototype (single-hearth quota OR multi-fire territory with 2 fire archetypes), a winter solstice event with warning + whiteout + recovery arc, a **level visual redesign** (block/prop art pass + environment-layout iteration) that lifts the world from greybox to a cohesive winter-survival look, and a first multiplayer playtest during Week 3.

**Playable link.** `https://play.decentraland.org/?realm=snowdrift.dcl.eth`

> **⚠️ Reviewer note on the playable link:** this URL currently serves the **v0 baseline** — the pre-pivot *cozy* multiplayer hangout described in `docs/gameloop-vision.md`. The **v1 build described in this GDD** redeploys to the same URL at Week 4. What you see today proves the *verbs* (torch, hearth, wood, frost death, weather, torch-chain, day/night, mobile playability); the *seasonal cycle, solstice event, sleeping-ember failure model, and defense mechanic* are the v1 delivery.

---

## 0.1 Open design decisions (resolved by prototype)

Two load-bearing design decisions are deliberately open at start of v1 and get locked via prototype in Weeks 1–2. This GDD describes v1 in terms that work for either resolution; specific mechanics diverge in §9's weekly milestones.

**Decision A — Retention model (locked mid-Week 2):**
- *Roguelike run:* the run is the unit of play; `dayNumber` and `season` reset on failure; strong pitch hook ("how deep can your village go?").
- *Persistent-world calendar:* the world has its own calendar that ticks even when empty; visitors drop in and check the season; DCL-native worldbuilding, softer retention hook.

**Decision B — Defense mechanic (locked end of Week 2):**
- *Single-hearth quota:* one central fire, banked-wood quota per night, dusk-snapshot penalty; simpler, shorter design surface.
- *Multi-fire territory:* a network of fires with individual tending, off-territory hostility, fire archetypes (warmth + grove) that gate map access; deeper, stronger fit for the "man vs. storm" pitch.

**Direction lock (form deferred) — Meta-progression:**
Surviving winter with territory intact carries *something* forward into the next cycle. Communal only (no personal gear, no per-player upgrades). Concrete form (Legacy counter, well-tended hearth buff, starter woodpile, warmth memory) decided during v1 build once the loop feels real. Full detail in [`docs/v1-4week-plan.md`](../docs/v1-4week-plan.md) §3.

**Retroactive v0 ask.** The scene as it exists today (the cozy multiplayer hangout in `docs/gameloop-vision.md` — now superseded by this GDD) represents ~14 sessions of work over the pre-pivot window. Full engineering changelog in `README.md` v2.7–v2.14+.

---

## 1. Player Promise

> **Hold the light against the storm.**

*(6 words, owner-confirmed 2026-09-11)*

**Longer form:** *Warm the ground to find wood. Tend the fires against the cold. Winter deepens season by season until the solstice tests whether the light was tended well enough to survive.*

**Familiar comparison:** *(dropped — the promise stands without it; comparables live in §8)*

**Why this game:** `TBD: not discussed yet`

---

## 8. Audience & Comparables

### Comparables

| Game | Where it lands | What worked (to keep) | What didn't fit this audience | What we do differently |
|---|---|---|---|---|
| **GONE Fishing** (Steam, app 3645890) | Outside DCL — the **daily quota loop** reference | Collaborative progression gated by a nightly quota; missing the quota resets progress; the shared-fate stakes drive coordination. | `[agent-decided]` Hard restart on a missed quota assumes a committed friend group in one session. DCL's shared world has drop-ins, latecomers and strangers — punishing everyone because one player logged off would be brutal. | Only the *world* can lose. Individual players respawn; the run only resets if the central hearth dies during a storm with no one tending it. Quota is a survival cushion, not a hard gate. |
| **Frostpunks** (DCL scene) | Inside DCL — the **big-storm boss-event** reference | Upgrading a base toward a scheduled storm event; the storm has real teeth and rewards preparation. | `[agent-decided]` The political/faction layer reads great with committed players and terrible with drop-in strangers on a public shared world. | No politics, no PvP, no factions. One shared hearth; everyone's on the same side against the storm. Twist: the storm is on a **real-world clock** (two solsticees per real day), turning it into a scheduled retention beat instead of a per-session climax. |

*Two `[agent-decided]` cells above — my inferences from your one-line descriptions of what each game does. Overrule any wording that misreads the source.*

### Primary player + arrival context

For players who already enjoy **cozy-toned co-op survival games (Don't Starve Together, The Long Dark, Valheim's early-game loop)**, arriving **alone or in a small group of 2–3** from **an Event, a Discord community, or a friend-invite link**, looking for **a persistent shared-world game with scheduled reasons to log in and a community record to push.**

### How the first group arrives

The first group comes through **the CSP program's DCL Events feed and Snow Drift's Discord** at the scheduled solstice timestamps — the solstice itself is the recurring arrival channel. Individual players arrive through Discover, friend invites, and streamer content once the loop is stable and the record is climbing.

### Deliberately not for

Players who want **PvP, competitive leaderboards, personal levelling, wallet-gated content, fast-twitch action, or a solo campaign with a fixed ending in v1**. The game rewards patience, coordination, and returning at scheduled times. It does not reward mastery of individual skill.

---

---

## 2. First Minutes & How to Play

### First 0–10 minutes (you)

**0–5 sec.** You wake in a warm circle around a fire. Snow falls beyond it. Others stand nearby with lit torches. HUD: *"Day 3 — Night in 4:12"* and a wood-quota bar.

**5–10 sec.** You step out; a chill cue plays, a frost meter appears. You grab a torch from the hearth pile. Wood chunks glow under the snow when your torch is near.

**10–60 sec.** You walk to a glow. Snow melts under you. Pick up a log — wood 0→1. Deposit at the hearth; the bar ticks; the fire brightens.

**1–3 min.** "Night in" hits 1:00. Sky darkens; players run for the fire; you follow. Cold accelerates. Someone feeds a log. The fire holds. Dawn breaks.

**3–10 min.** Day 2. Quota higher; a *"Cold ×1.4"* chip appears. Wood near the hearth is gone — you walk further. Torch drops low; you hand off to an incoming player. First coordination beat.

**Stopping point.** Day 3. HUD reads *"Solstice in 8:23"*. You know tomorrow's reason to return.

**5/10 rule** (80% of first-time players perform the first useful action within 5 sec and can state the immediate goal within 10 sec): `[HYPOTHESIS]` H1-02.

### How to Play

- **Melt snow with your torch to find wood.**
- **Feed the fire before night falls.**
- **Every player raises the shared night quota.**

---

## 4. Why Players Come Back

> **⚠️ Section status:** the return hooks below describe the **roguelike + scheduled-solstice** resolution as one possible v1 shape (the original pivot direction). Weeks 1–2 prototypes may resolve differently — in particular if the persistent-world calendar model wins §0.1 Decision A, the retention framing shifts from "scheduled log-in for the solstice" to "check on the world, see what season it is." See [`docs/v1-4week-plan.md`](../docs/v1-4week-plan.md) §3.2 for the decision criteria.

### 4.3 Return hooks (2)

**Hook 1 — ⚡ The scheduled solstice.**
- **Trigger:** two real-world timestamps published, ~12 h apart (target 08:00 and 20:00 UTC; final times set by playtest).
- **What players anticipate:** the world will be in a defense at exactly that time — they want to be there.
- **Reminder channel:** Discord announcement 15 min before every solstice; in-world HUD countdown always visible when logged in.
- **No-reminder fallback:** the HUD countdown is the reminder. It is the last thing you see before you log off (§2 stopping point).
- **D1 coverage:** always — two events per real day means the next solstice is always inside 12 hours.

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
| **End of first week** | You've lived through multiple solsticees and probably one reset. You know which satellite pit sites are thawed at the current day count. Your torch has visibly upgraded once. | Your torch's fuel bar is visibly longer than a first-session player's; you know routes that first-day players don't. |
| **Week 3+** | You're a regular — present at solsticees on schedule. You've seen the world at higher day counts than most, and know what territory unlocks past Day 40+. You've participated in at least one record-push. | You show up in Discord threads about solstice timing; you're one of the players others follow toward known-good routes when night falls. |

**End of first week (scene, 3–4 sentences):**
> It's Sunday evening. You log in — the hearth reads *Day 41 · Best: 62*. You've been here for four solsticees; you missed one. Someone in the group chat: *"we're 21 days from the record, can we do it?"* You head out with a torch that burns 30% longer — the Day 30 unlock. The northeast satellite pit, thawed at Day 20, is your first stop. Tonight's solstice is at 20:00 UTC. You're not going to miss another.

### Unlocks (progressive, community-scale)

Tied to the world's current day count, lost on world reset. Concrete list — iterate on numbers via playtest:

| Day | Unlock | Category | Ship |
|---|---|---|---|
| **Day 5** | First **lore fragment** — a journal page thaws near the hearth. | Lore | *(v1.5)* |
| **Day 10** | First **satellite pit site** thaws — territory NE of the central hearth. | Territory | **v1** |
| **Day 15** | Second **lore fragment** — context for the solstice. | Lore | *(v1.5)* |
| **Day 20** | Second **satellite pit site** thaws — territory SW. | Territory | *(v1.5)* |
| **Day 30** | **Torch upgrade tier 1** — fuel duration +30%. | Tool | **v1** |
| **Day 40** | Third **lore fragment** — the world before the winter. | Lore | *(v1.5)* |
| **Day 50** | Third **satellite pit** — far zone, denser wood. | Territory | *(v1.5)* |
| **Day 75** | **Torch upgrade tier 2** — melt radius +25%. | Tool | *(v1.5)* |
| **Day 100** | Final lore fragment + aurora world-visual signature. | Lore + cosmetic | *(v1.5)* |

**Three unlock categories woven together:** *territory* (what map you can reach), *tools* (how well you can work it), *lore* (why you're here at all). Every ~10 days the player has a reason to push forward, and the reasons rotate so it never feels like grinding one axis.

**Lore content itself:** `TBD: written by owner; premise-first drafting at §7 (World, Look & Story)`. Fragments are short (a paragraph each), diegetic (found objects the player can read in-world), and the whole set answers *"why is it winter, and what happens after the solsticees stop?"* by Day 100.

**Currency / tradable rewards:** none. All progression is community-level and resets with the world. No wallet interactions, no NFTs required to play.

---

## 5. Social by Design

### The repeatable social loop

The main social vector is **emergent role coordination toward the shared quota and the shared storm defense**, not any single scripted interaction. Roles are not picked from a menu — they emerge from where each player naturally spends their time:

- **Gatherers** — push out with lit torches, melt snow, bring back wood.
- **Tenders** — stay near the hearth, feed banked wood as fuel drains, coordinate the deposit rhythm.
- **Chain-lighters / bridges** — relight gatherers' torches mid-map so no one has to return to the hearth for fuel.
- **Scouts** — push furthest edges toward newly-thawed territory or lore fragments at high day counts.

A player who signals what they're doing (heading out, staying to tend, pushing north) lets others fill the gaps. The **shared consequences** are directly visible: quota bar moves, hearth flame changes size, cold multiplier holds or spikes. The **regrouping beat** is dusk — everyone comes home before night.

**Torch chain-lighting** (already built) is one concrete instance of this loop — a gatherer far from the hearth signals by holding a low-fuel torch; a chain-lighter voluntarily walks out to relight it; both players' reach just extended. Ships in v1 as a proof of the vector; more role-specific mechanics `[OPEN: waiting on Week 2 playtest]` emerge from what players actually do.

### Meeting and recognition

**Strangers to a group in 30 seconds — without voice or shared language.**
Spawn puts everyone at the same central hearth. A new arrival sees other players around the fire immediately. The wood-quota bar is shared and visible — depositing your first log ticks a communal number, and the fire visibly brightens. That's the 2-second social verb: *"I helped."* No voice, no language required.

**Where a name is first learned.**
Baseline: DCL floating name labels. Deliberate moment: when a player deposits a log, a subtle *"iridis · +1 wood"* pill appears briefly near the hearth. Same when your torch is chain-lit by someone — their name flashes for a second. Names surface tied to positive actions, never as a scoreboard.

**What persists between returning players.**
No personal progression persists (per §4). But the hearth carries **survivor plaques**: the names of the ~10 players present when the current record day was reached. Returning players check the plaques to see if their name is up; new players see who kept the world alive. Plaques update when the record is beaten; lost with the world on reset.

*Note: the surfacing mechanics above will evolve as build reveals what feels right. Locked as v1 baseline, expected to deepen.*

### Population and thresholds

**Realistic baseline: 1–2 players concurrent, most of the time.** 3+ concentrates at scheduled solstice timestamps (Hook 1) and Discord-pushed events. The design is tuned around this: solo-and-duo is the *primary mode*, groups are the *social peak*.

| Row | Value | Notes |
|---|---|---|
| **Quiet-hours count** | **1 player** | The expected default. Solo can gather, tend, feed, survive normal nights, and participate in the community record push over multiple sessions. Sees all lore + tool + territory unlocks (they belong to the world, not the individual). |
| **Solo solstice** | **Very hard, not impossible** | Quota scales down for a solo defender, but the cold ramp still fires. Expected outcome: solo solstice survivals are rare and memorable; more often the world resets. The reset *is* the story. |
| **Social threshold (design clicks)** | **3 players** | Full role coordination emerges. Achievable during scheduled solstice events with even a small Discord push. |
| **Meaningful step from solo** | **2 players** | Not full role emergence, but role-splitting starts (one gathers while the other tends). Materially better survival odds than 1. |
| **Ideal group size (event)** | **3–6** | Realistic Discord-group scale at solstice times. |
| **v1 tested maximum** | **8 players** | Honest ceiling for the 4-week timeline. Program baseline reaches 20; we don't stress-test what won't happen at this scale. `[HYPOTHESIS]` H1-06 covers the 8-player 30fps mobile target. |

**Solo-meets-another-player by design:** single spawn point at the central hearth. Any player logging in during another's session lands next to them by geometry — no matchmaking system needed. If solo hours are truly solo, they play until logout or reset.

**Wood scatter + quota tuning implication:** density and per-day quota formula must feel achievable for 1 player through normal days. The DIFFICULTY comes from solsticees and the compounding cold ramp, not from the daily grind being solo-hostile. `[OPEN: waiting on Week 2 playtest tuning]`.

### Disappearance test

*If every other player vanished but their traces (melted paths, banked wood, hearth fuel, day-count history) remained, what breaks?*

- **What survives:** the gather-and-feed loop still works. A solo player can play a full session. The verbs, the day/night rhythm, and even individual solsticees as timed challenges still function — with a scaled-down quota.
- **What breaks:** the solstice becomes a solo endurance test instead of a communal defense — the **emotional peak of the game evaporates**. The high-score day count, still visible, feels *borrowed* — someone else set it. Torch-chain and every other role-coordination beat have no B to respond. Lore fragments unlock but nobody to share the *"did you see this?"* with.

Honest one-line: **solo play is complete-feeling for a session; the record run and the solstice as event are the parts that require other players to matter.**

### Robustness and colour

**Drop-in / drop-out.**
A late arrival contributes immediately by picking up any log and depositing it. A leaver takes nothing with them; wood banked at the hearth stays for the group. A spoiler player cannot break play — no PvP, no destructible progress; the worst they can do is refuse to help. Trolls have nothing to grief.

**Bystander test.**
A player who just watches sees a lit hearth with a countdown, a shared quota bar, other players' torches moving across the field, and — when night falls — the whole crew huddled at the fire feeding logs. The stakes are legible without a tutorial: *"they're trying to keep the fire alive."*

**Memorable moment.**
Logging in to find the hearth burning low with 90 seconds of fuel left, the previous player's Discord message still fresh, and dropping your first log in just before it snuffs — the day streak saved by a shift handoff neither of you planned in detail. The target emergent pattern of the game.

**Bring-a-friend.**
A new friend spawns next to you at the hearth with nothing to learn — hand them a torch and point at the snow. Duo doubles your reach and unlocks the 2-player role-splitting threshold; if you time the invite before the next solstice, they see the game's peak on their first session.

---

## 6. Mobile-First (Cross-Platform)

### Design posture

**Snow Drift is designed for desktop's ambition and ships with full mobile playability.** The core loop is inherently touch-native — walking + tap is the whole verb set — so mobile compatibility is not the constraint on the design; the *fidelity ceiling* is. Desktop players experience the full visual and atmospheric build; mobile players play the same game at leaner particle and shader budgets.

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

Top strip: day count + solstice countdown + high-score record. Bottom strip: shared quota bar + personal frost bar + torch fuel icon. Everything else is diegetic — fire size, snow depth, other players' torches, thawed territory. No inventory screen, no minimap, no multi-panel menus.

### Performance targets

| Platform | Target | Concurrent players |
|---|---|---|
| **Recommended desktop** (mid-tier laptop) | 60 fps, full visual fidelity | 8 |
| **Named mobile: Pixel 6a on DCL mobile client** | 30 fps, lean variant | 8 |

**Mobile lean-variant specifics:** reduced snowfall particle counts, simplified hearth particles, no aurora at Day 100, fewer per-tile paint updates per frame. Same core loop, same verbs, same visuals in structure — tuned-down in density. Detection via DCL platform APIs, applied at scene load.

### Biggest performance risk + plan

**Risk:** snowfall + hearth particles + melt-tile CRDT updates during a nighttime scene with 8 concurrent players. The paint-sync tile refactor (repo README v2.7) already handled the tile-CRDT case at scale; the outstanding concern is particle count during HEAVY weather + solstice effects. `[HYPOTHESIS]` H1-06 covers the 8-player 30 fps mobile target.

**Plan:** cap engine particles at 1000/sec globally; snowfall rate on mobile drops one tier below the desktop equivalent (mobile HEAVY = desktop MEDIUM density, at the same visible weather level). Contingency: if the mobile lean-variant still fails H1-06 at Week 2 playtest, drop mobile v1 tested max from 8 to 6 concurrent players and update §5 accordingly.

### Desktop-only dependencies

None load-bearing. Click-drag spectator pan is desktop-only (mouse-native input); the mobile client uses the existing on-screen d-pad for the same action. No mechanic requires precision aiming, hover states, or keyboard combos.

---

## 7. World, Look & Story

### The world (2 sentences)

The planet has been knocked from its orbit — no one alive remembers when — and the sun has slipped too far away for warmth. What passes for a "day" and an "solstice" here are wobbles of a broken world, and somewhere beneath the snow lies the tech that once held it in place. `[agent-decided]` *(wording; premise content owner-directed)*

### Visual signature

The sky is always wrong. The sun sits low and blue-white on the horizon at all hours; stars are visible in the middle of the day; auroras thread through daytime clouds. A screenshot reads as *"this world's astronomy is broken."* Cool palette dominated by pale blues and violets, warm gold only from fire.

**Tone:** quiet · ancient · myth-shaped · astral undercurrent — **cosmic-archaic**. Not sci-fi collapse. Not folk-tale.

**Reads on a small screen:** avatars stand out against pale snow; lit torches are the brightest thing on-screen at any distance; wood chunks glow faintly under melting snow. Navigation is legible by fire-light: the central hearth is the brightest fixed point in the world; satellite pits (once unlocked) are dimmer secondary beacons.

### v2 hook (not shipping in v1)

`[v2 scope]` The lore drip in v1 (fragments at Day 5 / 15 / 40 / 100) points at ancient orbital-control tech buried under the deepest snow. In v2, sufficient community day-count unlocks the search for it — the final "melt" win-condition. If activated: the planet shifts back into orbit, snow melts, grass and flowers bloom, world-state persists for a season, then the cycle begins anew. The Day 100 fragment in v1 sets this up explicitly — a cliffhanger by design.

---

## 9. 4 Week Plan (v1 scope)

**Team:** 1 solo dev, AI-assisted · **15–20 hours/week** on Snow Drift · 60–80 total build hours over weeks 1–4. AI assistance shortens draft-code and design-doc time; testing, playtest coordination, deploy work, and community setup remain real calendar hours.

**Foundation:** the existing repo already ships the verbs (torch, hearth fuel, wood scatter, frost death, torch chain, weather, cycle infrastructure, paint-CRDT). The 4 weeks are a **pivot from cozy hangout to man-vs-storm territory defense**, not a build from scratch. Source-of-truth plan lives in [`docs/v1-4week-plan.md`](../docs/v1-4week-plan.md).

**Structure:** Week 1 = backbone (temporal infrastructure). Week 2 = design decisions (two prototypes, two decision gates). Week 3 = build the winning game + first playtest. Week 4 = polish + ship.

### Weekly milestones

**v1 delivery principle: fun first. Ship the tight core loop, defer feature spread to v1.5.**

| Week | Playable state |
|---|---|
| **Week 1 — Backbone** | Fuel floor cut; sleeping-ember failure model live (60 s relight grace); empty-server run-reset installed (fires when all fires dead + roster empty for 60 s). Day/night phase clock (`server/phase.ts`) with all 6 phases scaffolded (DAY / DUSK / NIGHT / SOLSTICE_WARN / SOLSTICE / GRACE); server-time authority for the countdown. Seasonal cycle live (autumn → early winter → deep winter → solstice approach → winter solstice → thaw → spring); cold trends up through winter arc, back down through recovery. Both season-reset code paths built behind a flag (flipped in Week 2). |
| **Week 2 — Decisions** | Two prototypes live in the Week 1 phase-clock testbed. **Retention prototype:** flip season-reset flag between roguelike (resets on `resetRun`) and calendar (persists as world history); play both solo across a full day/night cycle; decide by mid-week. **Territory-defense prototype:** resurrect hidden campfires; retune existing frost + locomotion so off-territory is hostile and on-territory is safe; play with 1–2 people across a full night; decide by end of week. Two decisions locked and documented before Week 3. |
| **Week 3 — Build + first playtest** | Conditional on Week 2 decisions. If single-hearth won: wood quota bar + dusk-snapshot penalty + snow/melt tuning. If territory won: fire archetypes (warmth + grove), snow regrowth curve driving territory shrink at night, reclamation cost for cold fires. **Both branches:** solstice event wiring (SOLSTICE_WARN siren + 2 min countdown → SOLSTICE whiteout + doubled night → recovery arc). Multiplayer playtest with 3+ from Discord. |
| **Week 4 — Polish + ship** | Ember visual/audio (deferred from Week 1). First-30-seconds onboarding (reactive to playtest). Solstice arrival VFX/audio. Optional meta-progression carry mechanism (§3.4) if scope allows. Block redesign + environment-layout tuning (lift the world from greybox to cohesive winter-survival look). 60–90 s trailer. `docs/VISION.md` refresh, player-facing README pass. Final mobile perf smoke. Deploy dry-run. Submit. |

### Live-ops — what keeps the experience changing after launch

- **Changes without a build:** seasons progress → the world visibly changes state day to day → the game *feels* different across visits without a code change.
- **Variation on missed updates:** weather system randomises profile per cycle inside phase bounds; solstice timing derives from retention model (fixed day count in roguelike, world-calendar date in persistent model).
- **Persists across resets:** direction locked (see §3.4), form deferred. In v1.1 or Week 4 if scope allows, a communal Legacy counter or a well-tended-hearth buff carries forward from successful winters.
- **Player behaviour that would change what's built next:** if solo solstice survival is impossible → tune quota/cold curve; if territory decision reveals a clear winner → double down; if playtest reveals onboarding gaps → Week 4 protects the first-30-seconds pass.

### Explicit non-goals for v1

- **No combat / mobs.** Man vs. storm, not man vs. agents. Combat is a v2 conversation.
- **No leaderboards.** Shared-pool survival, not competitive.
- **No permadeath.** Individual death respawns; only the run/world can reset.
- **No tool tiers.** No axes, no upgraded torches, no crafting.
- **No personal gear or per-player upgrades.** Meta-progression is communal-only.
- **No NPCs, quests, or dialogue.**
- **No fire archetypes beyond 2** (if territory model wins). Way-station, overlook, ancient — all v2.
- **No wallet-gated content.**
- **No trailer or pitch work until the loop is playable** (Week 4 only).

### Top risks

| Risk | Mitigation |
|---|---|
| Both prototypes succeed and we want both | Force honest scope call end of Week 2 — one may need to defer to v2. |
| Retention decision drags past end of Week 1 prototype | Hard deadline: pick the one you'd rather build on Monday. |
| Territory prototype "kinda works" but isn't clearly better | Default to single-hearth. Simpler ships. |
| Solstice arrival not readable | 2-min warn window with siren + sky darken; playtest question covers it. |
| Mobile perf regresses under HEAVY weather | Perf test end of Week 2 + Week 3; fall back to lighter particle counts before cutting mechanics. |
| Trailer eats Week 4 | Protected day; do not skip for "one more feature." |

---

## 3. Core Loop

**The verb:** warm the ground to see what's there.

**Two nested loops:**
- **Micro (one in-game day, ~9 minutes):** dawn → gather → dusk → defend → dawn resolves.
- **Macro (one full year, one evening to a weekend depending on retention model):** autumn → early winter → deep winter → solstice approach → winter solstice → thaw → spring → autumn.

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

**Cycle length:** `[OPEN: playtest tuning]` — first playtest target 5 min day / 1 min dusk / 3 min night, ~5 days per season.

**Session length:** `[OPEN: playtest tuning]` — one full in-game day = ~9 min minimum satisfying visit; one full year TBD from playtest and retention decision.

**Repetition 10 — why it stays fresh:** `[HYPOTHESIS]` H1-01 — variability comes from (a) other players and shifting roster, (b) the seasonal ramp changing what the same verbs *mean* (a day-1 walk vs. a solstice-approach walk are the same input, different game), (c) territory decisions (if territory model wins) about which fires to hold, (d) the community's persistent state carrying forward from prior winters.

**Pillars:**
1. **Man vs. storm, not man vs. mob.** The enemy is the cold, the snow, and the passage of seasons. No combat in v1.
2. **Fire = safety, distance = stakes.** Every fire is an island of warmth; every step away from one is a risk.
3. **Warm the ground to see what's there.** One legible verb: torch heat melts snow, revealed patches show wood.
4. **Players help fires, not hurt them.** No extinguish action, no fuel drain — no grief vectors by construction.
