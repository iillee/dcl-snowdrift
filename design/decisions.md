# Design decisions — Snow Drift

Running log. Each line: `date · decision · why`.

> **Note (2026-09-11):** several 2026-09-09 decisions below are now marked **[REOPENED]** — the plan has evolved into a further pivot toward man-vs-storm territory defense with two open decisions gated by prototypes. Source of truth is [`../docs/v1-4week-plan.md`](../docs/v1-4week-plan.md). The 2026-09-11+ entries at the bottom of this log reflect the current direction.

---

## Open decision — Final title

**Status:** open. Cryogenia is the current working title in the GDD; feedback (2026-09-11) flagged that it sounds clinical ("-genia" reads medical) and doesn't carry the warmth/frontier feel the design has evolved into.

**Finalists:**

| Name | Status | Notes |
|---|---|---|
| **WINTEREON** | 🟢 Leading | Compound of *winter* + *-eon* (a vast span of time). Says long-ice-age scale directly. Warm-sounding for a cold-setting game. Novel enough to be Steam-clear (needs check). |
| **CRYOCENE** | 🟡 Contender | *-cene* is the geologic-epoch suffix (Pleistocene, Holocene, Anthropocene) — reads instantly as "an era of Earth's history." Still leans clinical via *cryo-*. Better than Cryogenia by a real margin. |
| **SNOWMELT** | 🟡 Contender | Names the core verb (torch melts snow). Simple, concrete, evocative. Risk: may skew too cozy, doesn't carry the ice-age scale. Common enough word that Steam collision likely — needs check. |
| **CRYOGENIA** | 🟡 Current working title | Retained as fallback. Wart-cream vibe flagged by playtest audience; "-genia" suffix reads medical. If nothing better clears Steam, defaults here. |

**Constraints:**
- Must be Steam-clear (no existing game on Steam or major platforms)
- Prefer names that carry the *Snowball Earth / long ice age* framing
- Prefer names that align with the warmth/frontier/shared-fire emotional center, not just the cold setting

**Next step:** spot-check top two on Steam / itch / Epic before locking. Rename PR touches GDD title block, README, `design/summary.md`, `scene.json` display fields, and any tagline copy.

---

## 2026-09-11 session (further pivot: man vs. storm)

- **2026-09-11 · Player Promise shortened to "Hold the light against the storm." · owner-confirmed** — Replaces the 24-word verb-first promise from 2026-09-09. Longer form retained as a paragraph in §1.
- **2026-09-11 · v1 identity: man vs. storm, not man vs. mob · owner-directed** — Combat considered and rejected for v1. Enemy is the cold and the snow. Territory defense against storms rather than tower defense against creatures.
- **2026-09-11 · Failure model: sleeping ember, 60 s relight grace · owner-confirmed** — When a fire's fuel hits 0, it enters an EMBER state for 60 s. Any player relighting from a torch during that window saves it. Cleaner than hard-zero (removes "I just missed the reset" bad-luck stories).
- **2026-09-11 · Seasonal cycle backbone: autumn → early winter → deep winter → solstice approach → winter solstice → thaw → spring · owner-directed** — The day/night cycle sits inside a seasonal wheel. Cold trends up through winter arc, back down through recovery arc. Replaces the discrete GRACE phase from the earlier pivot with a natural seasonal shift.
- **2026-09-11 · Difficulty curve: 5 axes ramping together · owner-directed** — Night length ↑, frost damage rate ↑, snowfall frequency ↑, snowfall intensity ↑, snow stack height ↑. Multiple readable axes moving together instead of one abstract cold multiplier.
- **2026-09-11 · Solstice survival condition (loose): any player alive AND any fire lit · owner-directed with agent recommendation** — Not a strict fail-check. A lone survivor with one dying fire counts. Story-generator, not scoring system.
- **2026-09-11 · Meta-progression direction locked, form deferred · owner-directed** — Two-tier success (alive vs. alive+territory) intended to carry *something* forward into next cycle. Communal only — no personal gear. Concrete form (Legacy counter / hearth buff / woodpile foundation / warmth memory) decided during v1 build.
- **2026-09-11 · Design principle: players help fires, not hurt them · owner-directed** — No extinguish action, no fuel drain, no interaction locks. Eliminates most grief vectors by construction.
- **2026-09-11 · [REOPENED] Retention model — roguelike vs. persistent-world calendar · gated by Week 2 prototype** — The 2026-09-09 lock on "shared-time tidal progression with scheduled real-world solstice" is now framed as *one option* rather than a lock. The alternative is a persistent-world calendar model. Both prototyped in Week 2.
- **2026-09-11 · [REOPENED] Defense mechanic — single-hearth quota vs. multi-fire territory · gated by Week 2 prototype** — The 2026-09-09 lock on "central hearth is singular and its fate is the run's fate" is now framed as *one option*. Multi-fire territory (all fires equal, individual tending, territory = access/mobility) is the alternative. Both prototyped in Week 2.
- **2026-09-11 · 4-week schedule restructured · owner-directed** — Week 1 = temporal backbone (phase clock + seasonal cycle + failure model). Week 2 = both prototypes + decisions. Week 3 = build winning game + first playtest. Week 4 = polish + ship. Replaces the schedule in the 2026-09-09 GDD.

---

## 2026-09-09 session (original pivot design)

Entries below are the 2026-09-09 cozy-hangout → survival-quota pivot decisions. Retained for context; several are marked [REOPENED] by 2026-09-11 entries above.


- **2026-09-09 · Shape A: shared-world, shared-time, tidal progression · [agent-decided · accepted]** — Everyone in the world is on the same day. Solstice fires on real-world schedule. Individual death respawns; only a communal failure (hearth dies during a storm) resets the world. Progression is tidal, not linear: survived solstice → grace → ramp → next solstice. Chosen over Shape B (per-group island runs) because DCL is one shared scene per deployment, and the scheduled real-world solstice is the retention beat that Shape B would lose.
- **2026-09-09 · Core loop = 5 steps (Dawn → Day → Dusk → Night → Dawn resolves) · owner-confirmed** — Melt-torch-to-reveal-wood is the gather verb. Respawn-only on individual death (no revive-drag verb). Grace period visible in HUD after surviving an solstice.
- **2026-09-09 · Pillars: (1) The central hearth is the world's heartbeat, (2) The storm is on the clock, (3) Warm the ground to see what's there · owner-confirmed with agent refinement on pillar 1**
- **2026-09-09 · §1 Player Promise: verb-first shape, 24 words · [agent-decided · accepted]** — *"Melt the snow to find wood. Feed the fire to survive the night. Twice a real day the solstice tests whether 'together' was enough."* Picked between five named alternatives; scored on naming the gather verb + survival verb + solstice twist + co-op stakes in three sentences a stranger could repeat.
- **2026-09-09 · Comparables: GONE Fishing (Steam) + Frostpunks (DCL) · owner-named** — Mapped to the two loops: GONE Fishing is the daily-quota reference, Frostpunks is the big-storm reference. "What didn't fit" rows drafted by agent from one-line descriptions; marked [agent-decided].
- **2026-09-09 · §1 familiar-comparison line dropped · [agent-decided]** — The promise stands on its own; adding a comparable inside §1 dilutes it, and the reviewer sees them in §8 anyway.
- **2026-09-09 · World reset happens on next-player-return, not on server-timer · owner-refined** — Fire dies + server empty → world sits in "dead" state, day count frozen. Next returning player triggers the reset and sees the *"the world was lost on Day X"* splash. Reset becomes a moment, not silent bookkeeping. Cheaper server-side (no grace timer) and gives Discord content.
- **2026-09-09 · §4 return hooks locked: (1) scheduled solstice, (2) high-score day count with progressive unlocks · owner-confirmed**
- **2026-09-09 · Unlock structure: three woven categories — territory, tools, lore — community-scale, resets with world · owner-directed** — Owner added lore unlocks: *"understanding why you are in the snow and what the world is actually like."* Fragments drip-fed at Day 5/15/40/100; complete set answers the premise by Day 100. Makes §7 (story) load-bearing rather than decorative — the story now unfolds through play, not upfront. — Owner: *"more territory revealed with campfires and better tools — makes the game satisfying, like you're building it up."* Specific milestone days ([agent-decided]) drafted at Day 10/20/30/50/75/100; iterate at playtest. Cosmetic + named-plaque unlocks parked to v2.
- **2026-09-09 · No wallet / no NFT dependency in v1 · [agent-decided]** — All progression is community-level and world-scoped; no tradable rewards. Reduces friction, keeps CSP submission focused on gameplay.
- **2026-09-09 · Target emergent behaviour: async shift-handoffs · owner-directed** — Owner: *"a situation I'd like to see emerge is natural shifts forming where players hand off duty to keep a day streak going."* Reframes the day-count number as a *coordination artifact* rather than a play-time count. The reset-on-empty-server + next-return-witness design is exactly what makes shift gaps costly and shift saves memorable. Memorable moment (§5c) rewritten around this.
- **2026-09-09 · v1 scope tightened: fun-first, drop lore + plaques + late unlocks · owner-directed** — Owner: *"mobile works fine on my phone, not testing low-cost phones — fine for now"* and *"cut back, make sure it is fun first."* v1 ships: quota loop, solstice events, day-count persistence + reset, Day 10 territory unlock, Day 30 torch upgrade, Discord hooks, mobile Option A safety net only (no Option B build). Cut from v1: lore fragment system + content, survivor plaques, all unlocks past Day 30. Lore fragment system parked as v1.5 headline feature.
- **2026-09-09 · Team: solo dev, AI-assisted, 15–20 h/week · owner-stated** — Two other projects competing for time. AI counted as throughput multiplier, not as a second developer. Weeks 1–4 build budget: 60–80 hours total.
- **2026-09-09 · §7 premise: astral / cosmic-archaic — planet knocked from orbit, tech under snow · owner-directed** — Framing for v1 lore reveal. Final "melt" win-condition (activate ancient tech → planet shifts back → snow melts → grass/flowers bloom) parked as **v2 hook**. Day 100 fragment in v1 is a cliffhanger by design.
- **2026-09-09 · §8 primary player: cozy-toned co-op survival fans, arriving alone or in small groups from Events / Discord / friend invites · [agent-decided · accepted]** — Consistent with realistic 1–2 concurrent scale + scheduled-solstice retention.
- **2026-09-09 · §6 posture: desktop-ambitious, mobile-playable · owner-directed** — Owner: *"it will work on mobile, but I want to push the possibilities of what I can do with this game and I will not limit my ambition for mobile requirements."* Framing C from the discussed options: desktop-primary + explicit mobile lean-variant shipping at v1. Core loop is inherently touch-native so verb mapping isn't at risk; the fidelity ceiling is the design compromise.
- **2026-09-09 · §5 realistic scale: 1–2 baseline, 3+ at events, 8 v1 max · owner-directed** — Solo-and-duo is the primary mode; groups are the social peak at scheduled solsticees. Design tunes around this: solo survives normal days, solsticees get very hard solo, quota + wood-scatter density calibrated for 1-player achievability on normal days. Reviewers respect honesty about actual scale.
- **2026-09-09 · §5 main social vector: emergent role coordination toward quota + storm · owner-directed** — Not a single scripted interaction. Roles (gatherer / tender / chain-lighter / scout) emerge from where players naturally spend time. Torch chain-lighting is one built instance; other role-specific mechanics emerge from Week 2 playtest observation. Owner: *"we will figure out what works as we build it."*
- **2026-09-09 · Satellite campfires stay in v1 as optional harder-maintenance expansion layer · owner-added** — The central hearth is singular and its fate is the run's fate; satellites are commentary, never save the run. Existing hidden-campfire code repurposed rather than cut.
