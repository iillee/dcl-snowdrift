# Snow Drift — Build Plan (v2)

**Deadline:** 2026-09-04 (Friendzone Buildathon submission)
**Start:** 2026-08-15
**Working window:** ~19 days, 4–8 h/day, solo dev (+ possible audio collaborator)
**Base:** fork of `dcl-canvas` @ digger WIP → this repo
**Deploy target:** `snowdrift.dcl.eth` (World)
**Repo:** must be public GitHub before submission (open-source requirement)

---

## 0. Purpose

Snow Drift is a **Friendzone Buildathon submission** with two intertwined goals:

1. **Place top 5** in the public $8k prize pool. This requires the game to be *fun, social, and memorable* on first play by a judge who spends 3–5 minutes on a phone.
2. **Serve as a pitch** for continued work with Regenesis Labs (Grants Program S2 / Creator Success). This requires the *ceiling* of the concept to be visible — a judge or funder should think "and imagine what this becomes."

These goals are aligned but not identical. Goal 1 rewards executed polish; goal 2 rewards clear headroom. The build must serve both without diluting either.

**What this document is not:** a shipped-product roadmap. It's a competition entry and a vertical slice.

---

## 1. The pitch, in one paragraph

*Snow Drift is a cozy multiplayer survival hangout set on a portrait-oriented snowfield. A single campfire is the only warm thing in the world. Players melt snow — carving revealed paths through a field of white extruded cubes — to gather wood, feed the fire, and stay warm together. You can carry a torch or an axe, but not both, so the game only works if someone else is there. Warmth is contagious: stand near another player and you both last longer in the cold. The world is persistent; the melt trails of everyone who came before are still slowly healing when you arrive.*

---

## 2. Design pillars

1. **Cozy, not punishing.** Freeze is a slow squeeze. Cold is atmospheric, not adversarial.
2. **The canvas *is* the world.** Melting cubes = exploration = fuel gathering. One mechanic serving three needs.
3. **Co-op by mechanical necessity.** Solo is possible but strictly worse. Two players is qualitatively different, not quantitatively.
4. **The World remembers.** Sessions aren't isolated — the snowfield carries traces of prior play, healing on real-world time.
5. **Ship the spine, sketch the future.** Judges must play a complete loop *and* see the horizon.

---

## 3. The three-pillar spine

Everything in v1 serves exactly one of these three. Cut anything that doesn't.

### Pillar A — **Beautiful melt & fire** (the visual pitch)
The mechanic must be *stunning* on first sight. Every screenshot, clip, and share hinges on this.
- Shader-driven melt (non-uniform compression, edge softening, wet sheen).
- Steam puff particle on melt.
- Campfire that breathes with fuel: flame scale, ember drift, light pulse.
- Snow that reads as snow (subsurface tint, sparkle flecks, lingering footprints).
- Layered melt audio (one *shff* per cube, mixed to become a wave for wide melts).
- Contextual soundtrack from audio collaborator (if confirmed) or curated free source.

### Pillar B — **Friendzone mechanics** (the social pitch)
The Buildathon thesis in code. Two mechanics, both non-negotiable.

**B1. Torch XOR Wood.**
- Hands are a single inventory slot with two states: `torch` or `wood`.
- Torch: melts snow around you, lights the way. Reveals buried wood as you go. Cannot pick up wood while equipped.
- Wood: warm cargo, but you're now walking back in the dark with no personal melt — warmth drains faster and you can't reveal more logs.
- Solo: painful ping-pong between the two states. *Possible* but the fire dies faster than you can feed it.
- Two players: one holds torch permanently (guide + reveal), one ferries wood back and forth. Range doubles, warmth stays high.
- Three+: someone tends fire while pair ventures further.

**B1 candidate reinforcements (hypotheses — confirm by playtest, not by planning).**
With the axe cut, the interdependence went from *hard* (can't perform both roles alone) to *soft* (solo is possible, just slow). These are layered pinches that could restore the co-op pull without adding new systems. Prototype the base loop first, then decide which (if any) are needed after Day 5–6 playtest.

- **Torch cannot be dropped, only handed off or extinguished.** To pick up wood solo, you must extinguish the torch (walk back dark and cold). With a partner, the torch lives forever — you hand it off. Zero new systems, one rule change, biggest single social payoff. **Leading candidate.**
- **Wood is heavy.** Carrying wood slows movement ~40%. Return trip *feels* like a real journey. Naturally creates the "take the torch, I'll be slow" moment. Pairs well with the above.
- **Contagious warmth actively regenerates in pairs**, not just drains slower. Solo has a bounded venture radius; pairs can stay out indefinitely as long as they stay close. Makes paired play feel *warm*, not just less cold — the cozy payoff.
- **Fire needs tending, not just feeding.** Every ~30s the fire sputters unless someone within 3m taps to poke it. Solo cuts venture range in half; pairs get natural division of labor ("you go, I've got the fire"). Bigger design addition — new tuning surface, risk of feeling nagging if mis-tuned. **Hold for v2 or late-week-2 addition.**
- **Some cells require two overlapping torches to melt** (deep-snow far from fire). Explicit pair-only content. Feels gamey for the cozy tone. **Hold for v2.**

Design guideline: cozy multiplayer (Stardew, Palia, Cozy Grove) mostly works on *vibe of shared presence*, not forced interdependence. But jam judging has a 3-minute attention window that vibe can't fill — so we need **at least one legible mechanical hook** that reads in the first playthrough, then fades to background over an hour. The three light-touch candidates above are chosen to be legible immediately (you feel the weight, see the handoff, notice the warm glow) and unobtrusive later.

**B2. Contagious warmth.**
- Warmth radiates a small aura (~2 m) around each player.
- Two players within each other's auras drain warmth slower (or refill slightly from body heat).
- Fire aura + body-heat aura stack.
- Mechanically: a paired venture-out lasts ~2× as long as solo, without needing more torches or wood.
- Visually: subtle glow between paired players, breath particles reduce, small warm pulse SFX on aura overlap.

### Pillar C — **Persistent world** (the retention pitch)
The World never fully resets. This is what makes judges reopen it.

- Snow regrowth uses **real time**, not session time. A melt trail heals over ~30 real-world minutes, not 30 seconds.
- Cairns mark where past fires died — small permanent stone piles visible to all future players.
- Each session's starting fuel is inherited from the previous session's final fuel state (long runs leave gifts).
- v1 fake-persistence: hold state in server memory across restarts of a single deploy; if the server restarts, state resets. Real Storage is a v1.1 upgrade.

---

## 4. Cut list (execute day 1)

From the `dcl-canvas` fork, delete or gut:
- `layer.leaderboard.tsx`, `server/leaderboard.ts` — no leaderboard.
- `server/discord.ts` — no webhook.
- `shared/roundTiming.ts` — no rounds.
- `switchTeam` message + team override in `roster.ts` — no teams.
- Brush size HUD (`layer.brushSize.tsx`) — melt radius is driven by fire/torch state, not player choice.
- All hotkeys except spectator toggle (mobile-first — hotkeys are secondary).

Repurpose:
- HUD stack → freeze bar, wood count, context-sensitive action button.
- Snapshot export → **keep and elevate** — becomes "share your night" post-run screen.

---

## 5. New systems

| # | System | Complexity | Files (planned) |
|---|---|---|---|
| N1 | Campfire (state, flame scale, melt radius, fuel decay) | M | `shared/campfire.ts`, `server/campfireState.ts`, `client/campfire.ts` |
| N2 | Warmth (per-player, drain rules, aura) | M | `shared/warmth.ts`, `client/warmth.ts` |
| N3 | Single-slot inventory (torch XOR axe XOR wood) | M | `shared/inventory.ts`, `client/handSlot.ts` |
| N4 | Torch (equip, personal melt, burn timer, drop) | M | `client/torch.ts` |
| N5 | Wood-under-snow: buried log entities revealed by melting the cube above | S | `server/spawner.ts`, `client/pickup.ts` |
| N6 | Feed-fire interaction | S | extends N1 |
| N7 | Snowfall regrowth (real-time, gated to outside melt radius) | S | retune digger decay |
| N8 | Mobile HUD (freeze bar, hand-slot icon, context button, session timer) | M | rewrite `client/ui/` |
| N9 | **Melt shader + fire VFX** (the beautiful pass) | L | `client/vfx/`, custom materials |
| N10 | Snow environment (skybox, fog, particles, palette, breath) | M | `client/environment.ts` |
| N11 | Audio layer (positional fire, wind, melt, footsteps, breath) | M | `client/audio.ts` |
| N12 | Dawn sequence (fire-dependent, run-ending) | M | `server/dayCycle.ts`, `client/sky.ts` |
| N13 | Persistent state (in-memory across sessions v1) | S | `server/worldState.ts` |
| N14 | Cairn markers | S | extends N13 |
| N15 | Cube→plane distance demotion (perf) | M | `client/paint.ts` extend |
| N16 | Onboarding-free choreography (first 90s tuning) | S | pure tuning |
| N17 | Post-run "share your night" screen | S | extends existing snapshot |

Complexity: S = ½–1 day, M = 1–2 days, L = 2–3 days.

---

## 6. Nineteen-day calendar

Numbered by working day. Weekends absorbed into buffer. Sep 4 is submission — deploy no later than Sep 3.

### Week 1 — Foundation + core loop functional (not pretty)

**Day 1 (Aug 15) — Fork cleanup + snow reskin start**
- Rename scene.json, package.json, README to Snow Drift + `snowdrift.dcl.eth`.
- Execute cut list (§4).
- Verify shared material caching in cube paint path (perf lever 1).
- Commit as clean baseline. Push to public GitHub.

**Day 2 — Snow reskin visual**
- Cube colour → off-white with subtle blue tint.
- Melted colour → wet dark ground.
- Skybox → dusk / night. Fog → cool blue, tuned for mobile viewport.
- Retune digger decay to 30 s as placeholder (real-time tuning comes later).
- **First mobile perf smoke test.** Deploy to a preview World, open on your actual phone. Note framerate, entity budget warnings. This informs whether N15 (demotion) is urgent or comfortable.

**Day 3 — Campfire N1**
- CRDT `CampfireState` component: `{ fuel, radiusMeters, alive }`.
- Server tick decays fuel, computes radius, marks alive/dead.
- Server continuously paints cubes within radius (drives melt).
- Client spawns campfire GLB at scene centre; flame scales with fuel.
- No interaction yet. Fire just burns down.

**Day 4 — Single-slot inventory + feed interaction (N3, N6)**
- Server-authoritative single hand slot per player.
- Wood pile GLB near fire, stack of N logs as pickup entities.
- Pointer/interact button → pickup log → hand slot = wood.
- Walk to fire while holding wood → context button "Feed fire" → +fuel, slot empties.
- Simple HUD: hand-slot icon + wood counter.
- **Loop closed in one screen: pick up → feed → flame grows.**

**Day 5 — Warmth + contagious warmth (N2)**
- Per-player warmth 0–100.
- Drain: 1/s outside melt radius, 3/s in "deep snow" (>10 m from any melted cell), refill fast inside campfire radius.
- Aura: 2 m radius per player, halves drain of any player inside another's aura.
- HUD warmth bar (portrait-safe).
- At 0: force shiver emote + `InputModifier` slowdown. No death yet.
- **Playtest solo for 15 min.** Does the cold feel cozy or annoying?

**Day 6 — Torch + buried wood (N4, N5)**
- Equip torch from campfire (costs 0 wood, torch is a persistent item near fire).
- Torch in hand: personal melt ring + light source + 90 s burn timer.
- Server places `BuriedLog` entities at random walkable cells at world start.
- When a cube melts, if a buried log sits at that cell it becomes visible + pickup-able.
- Pickup swaps hand slot: torch drops, wood equipped. Return to fire to feed.
- **Teaching setup:** starting clearing around fire is pre-melted; 1–2 logs poke half-out of the snow at the clearing edge so first venture is 3 m and finds a log in ~20 s. No tutorial text needed.
- **The core loop is playable end-to-end by end of day 6.** Recruit a friend on Discord for a 15-min two-player test if possible.

### Week 2 — The beautiful pass + friendzone completion

**Day 7 — Melt shader + cube→plane demotion (N9 start, N15)**
- Replace linear scale tween with shader-driven non-uniform compression.
- Add edge softening + wet sheen on melted state.
- Steam puff particle on each melt event.
- Implement cube→plane demotion beyond 20 m from any player. Hysteresis 18/22 m.
- Second mobile perf test. This is the gate — if it's still bad, escalate to chunk merging or resolution reduction.

**Day 8 — Fire VFX + audio (N9 cont, N11 start)**
- Campfire flame breathes with fuel value (scale + colour temp + light intensity).
- Ember drift particles.
- Layered melt audio (mixed).
- Positional fire crackle, wind ambient.
- Footstep-in-snow SFX.
- Contact audio collaborator with scene reference + mood board. Confirm scope.

**Day 9 — Mobile HUD pass (N8)**
- Redesign HUD for portrait phone:
  - Bottom-left: warmth bar, wood/hand-slot icon, session timer.
  - Bottom-right: single big context-sensitive action button ("Pick up" / "Feed fire" / "Light torch" / "Chop").
  - Top-right: spectator toggle, mute.
- Test on real phone. Every UI element must be tap-target-sized (44+ px).
- Kill anything that doesn't fit or isn't tappable.

**Day 10 — Persistence + cairns (N13, N14)**
- Server holds paint state + fire state + cairn list in memory across player sessions.
- Snowfall regrowth switched to real-time clock, ~30 min per cell heal.
- On fire death: place a cairn entity at the fire's location, add to persistent list.
- New joiners see all existing cairns + current melt state on connect.
- **The World is now a place, not a game.**

**Day 11 — Dawn sequence + run end (N12)**
- Fire-dependent dawn: high fuel accelerates dawn arrival; low fuel delays.
- Dawn = sky pinks, snow tints warm, strings cue swells, embers fade, run "ends."
- On dawn: post-run "share your night" screen with snapshot mosaic + stats ("You kept the fire alive until dawn. 3 players, 12:34, 47 logs.").
- On fire death (bad ending): "The fire went out. 8:22. A cairn now marks where it burned." Different music cue.
- This is the *feel* of the game — spend time here.

### Week 3 — Polish, multiplayer test, submission

**Day 12 — Multiplayer full session test**
- Two clients (ideally two devices) into `snowdrift.dcl.eth`.
- Verify: shared fire, shared melt, independent warmth + inventory, contagious warmth actually works, cairns persist.
- Fix desync bugs. Log every "huh?" moment.

**Day 13 — First 90-seconds choreography (N16)**
- Spawn point: right next to fire, wood pile visible, one log already at your feet.
- Tune fuel/decay/warmth so a solo new player experiences the full arc — feed, venture, cold, torch, return — inside 4 minutes.
- Add non-intrusive UI hints only if playtest shows confusion. Prefer visual cues (glow on interactable, arrow on empty slot).

**Day 14 — Playtest with 3+ friends**
- Real cold-open test: don't explain anything. Watch what confuses them.
- Prioritise top 3 issues into day 15.
- Record footage during test (permission first) — this becomes trailer material.

**Day 15 — Playtest fixes + audio pass finalisation**
- Address the top 3 only. Resist scope creep.
- Final audio integration if collaborator is delivering.
- Final tune of numbers: fuel decay, warmth drain, torch burn, wood spawn.

**Day 16 — Trailer + pitch deliverables**
- Cut 60–90s trailer to music. No UI, just mood + mechanic + dawn ending.
- Update `README.md` with clear player-facing pitch (not dev notes).
- Update `DESIGN.md` to reflect shipped v1.
- Draft `docs/VISION.md` — one-page "here's what this becomes with continued funding" for Regenesis/judges.

**Day 17 — Final deploy + submission prep**
- Deploy to `snowdrift.dcl.eth`. Verify open + stable on cold-open from a fresh device.
- Scene thumbnail + display metadata.
- Submit to Dorahacks.

**Day 18–19 (Sep 3–4) — Buffer**
- Reserved for: emergency bugfixes, one Discord Friendzone-channel post, community feedback response.
- **No new features. None.**

---

## 7. Milestones (go/no-go)

| Date | Milestone | If missed, cut |
|---|---|---|
| End Day 2 | Snow reads as snow, mobile perf baseline known | Escalate N15 to day 3 |
| End Day 4 | Fire can be fed, fuel drains | Critical path — do not miss |
| End Day 6 | Core loop playable end-to-end | Cut torch or axe (keep the other), drop hand-slot exclusivity |
| End Day 8 | Melt looks *beautiful* on a phone | Ship without shader upgrade — but the pitch weakens |
| End Day 10 | World is persistent | Fall back to "session-persistent" — heals over 30 min but resets on restart |
| End Day 11 | Dawn sequence lands emotionally | Cut dawn, replace with fade-to-black + stats screen |
| End Day 14 | Multiplayer stable, playtest done | This is the real deadline — buffer is for playtest fallout only |

---

## 8. Perf strategy (mobile)

Snow Drift's #1 technical risk is cube count on mobile. Layered mitigations, apply in order as needed:

1. **Shared materials** (day 1): cache material per palette index. Zero visual cost.
2. **Distance-based cube→plane demotion** (day 7): cubes only within ~20 m of any player; farther cells render as flat planes at cube-top height. Biggest single lever.
3. **Chunk merging** (reserve, day 10+): if (2) insufficient, group distant cells into 4×4 chunk entities with a mask texture. Real engineering — only if forced.
4. **Resolution reduction** (emergency): drop `PAINT_CELLS_PER_TILE_AXIS` from 16 → 8 (2 m cells). Cuts entity count 4×. Visible fidelity cost.
5. **Frustum culling** (built in): top-down spectator is the perf worst case, not the play view. Measure both.

**Perf test dates:** Day 2 (baseline), Day 7 (after shader + demotion), Day 12 (multiplayer full session), Day 17 (final deploy).

---

## 9. Deliverables (for judging)

The World is necessary but not sufficient. Ship all four:

1. **Public `snowdrift.dcl.eth` World**, stable on mobile cold-open.
2. **Public GitHub repo**, open-source-licensed, README pitched at players (not devs).
3. **60–90s trailer video** — mood, mechanic, dawn ending. No UI.
4. **`docs/VISION.md`** — one-page continued-work pitch for Regenesis/judges who look past the jam.

---

## 10. Judging criteria self-scorecard

Where the plan targets scoring impact:

| Criterion | Plan response |
|---|---|
| Mobile-First Experience | Portrait scene, single context button, phone-first UI (Day 9), portrait framing from day 1 |
| Social Value | Pillar B — torch XOR wood + contagious warmth. This is the whole point. |
| Mobile UX & Accessibility | Day 9 dedicated pass, real-device testing days 2/7/9/12/17 |
| Performance & Optimization | §8 perf strategy with dated gates |
| Creativity & Originality | Pillar A visual identity + Pillar C persistent world. Melt-as-exploration is uncontested in DCL. |
| Retention & Discovery | Pillar C — cairns, real-time healing, inherited fuel state |
| Overall Execution | Three-week schedule with buffer, prior Flagtag track record, hard cut list |

---

## 11. Open decisions

- [x] **Tone / "swing" direction** — **Safe: cozy realism** for v1. Winter survival hangout, acoustic/ambient audio, gentle strings. Weirder directions (sentient fire, memory/literary) preserved as v2 pivots — architecture doesn't foreclose them.
- [x] **Audio collaborator confirmed** — yes, starting ~day 6 once base prototype is playable. Score-to-picture, not score-to-brief.
- [x] **Wood source** — **buried under snow, revealed by melt.** One core verb (melt), simpler two-state hand slot, cleaner top-down aesthetic, less asset scope. Axe/tree variants preserved for v2.

---

## 12. Discord / community strategy

Low-cost, high-return:

- **Day 8ish:** post 10-second visual clip of first working melt shader to Friendzone channel. Builders share aesthetic wins.
- **Weekly:** short devlog post — genuine "figuring this out today," not marketing.
- **Day 14 after playtest:** ask other builders to try it, offer to try theirs. Reciprocal attention.

Not on the calendar because it's ~15 min at a time. But it compounds.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Mobile perf below 30fps | §8 — layered mitigations with dated gates |
| Torch-XOR-wood feels punishing solo, not cozy | Day 5 playtest gates. Fallback: aura from fire extends via torch (torch = mobile fire), softens the pain. |
| Contagious warmth is invisible to players | Day 5: strong visual (glow between paired players) + audio cue on aura overlap |
| Judges don't understand the loop in 3 min | Day 13 choreography + Day 16 trailer both address this |
| Audio collaborator unavailable | Curated free tracks as fallback, decision by day 5 |
| Persistent state bugs eat everything | v1 = in-memory only. Real Storage is post-jam. |
| Scope creep from Discord feedback | Buffer days are for bugs only, not features |

---

## 13a. Reconciliation — 2026-08-25 (Day 8 of 19)

Honest audit of PLAN v2 (2026-08-15) against what actually shipped. Written at the calendar halfway point so remaining scope is visible.

### Systems table (N1–N17) status

| # | System | Planned | Shipped | Notes |
|---|---|---|---|---|
| N1 | Campfire (fuel/flame/radius/decay) | M | **YES** | `shared/hearthFuel.ts`, `client/campfire.ts`, 4-tier flame scaling, tier-snap audio |
| N2 | Warmth (per-player drain + aura) | M | **PARTIAL** | Frost accumulation + thaw shipped (`client/frost/`). Contagious warmth aura between players NOT built — this is the §12.5 headline mechanic and still owed. |
| N3 | Single-slot inventory (torch XOR wood) | M | **YES (revised)** | Two-slot in practice: torch is persistent (can't drop, only extinguish or hand off — per vision §12.2.1); wood is the second slot. Feed/drop via F, relight via E. |
| N4 | Torch (equip/melt/burn/drop) | M | **YES (revised)** | 40 s fuel, personal melt via unlit-stomp stage-1, hand-anchored model + smoke wisp. Drop replaced with can't-drop rule. |
| N5 | Wood under snow | S | **PARTIAL** | Scatter shipped (`shared/woodScatter.ts`, deterministic per cycle, 40 chunks, 12–80 m from fire). Hearth pile system also shipped (`server/logs.ts`). "Invisible until melt reveals" gate explicitly deferred so scatter density could tune against visible baseline. |
| N6 | Feed-fire interaction | S | **YES** | F-key within 3 m of central fire OR any lit hidden pit. |
| N7 | Snowfall real-time regrowth | S | **YES (reframed)** | Regrowth is cycle-scoped rather than real-time-per-cell; the 24 h reset does the heavy lifting. |
| N8 | Mobile HUD | M | **YES** | Frost bar, torch button w/ fuel drain, feed/relight prompts, action bar, touch controls, snowflake weather nudge. Multiple polish passes (v2.10, v2.12). |
| N9 | Melt shader + fire VFX | L | **PARTIAL** | Fire VFX shipped (breathing flame, smoke, spatial crackle, surge SFX). Custom melt shader NOT shipped — using cube tween + cube→plane demotion instead, which reads well enough on mobile. |
| N10 | Snow environment | M | **YES** | Skybox, cool palette, 4-tier weather, snowfall particles, wind vector shared with smoke. Fog dome attempted and dropped (Bevy back-face culling). |
| N11 | Audio layer | M | **YES** | Positional fire, wind ambient, footsteps (distance-cadence), snowfall, torch ignition, surge, frost chunk cue, chain-light whoosh. v2.14 hardening pass. |
| N12 | Dawn sequence + run end | M | **NO (superseded)** | Replaced by the 24 h cycle reset from `docs/gameloop-vision.md` §7. Splash + teleport + world regen at midnight UTC. No "share your night" post-run. |
| N13 | Persistent state (in-memory) | S | **PARTIAL** | Cycle state + hidden fire lit-state + paint state persist within a server process. Not verified across server restarts. |
| N14 | Cairn markers | S | **NO** | Replaced by the stone-ring-around-discovered-pits idea (`gameloop-vision.md` §6), also not built yet. |
| N15 | Cube→plane demotion (perf) | M | **YES** | Shipped in v2.12 mobile hitch fix with time-sliced work queue (`CELLS_PER_FRAME = 24`) — different mechanism than planned, same outcome. |
| N16 | 90-second choreography | S | **NO** | Spawn/onboarding pass not done. Torch quest from vision §3 (fetch-from-island) not built either. |
| N17 | Post-run share screen | S | **NO** | Cut with N12. |

### Shipped beyond original plan

Things PLAN v2 didn't scope that landed anyway:

- **24 h world regeneration cycle** (`server/cycle.ts`) — this replaced the entire "session-ends-at-dawn" concept with a persistent world that rolls at midnight UTC. Bigger design win than N12 would have been.
- **Hidden bonfires** (3 per cycle, deterministic seed, discoverable via wood-hunting) — became the retention layer instead of cairns.
- **Chain-lighting** (torch-to-torch ignition, v2.14) — the §12.5 headline social mechanic, shipped mid-week 2.
- **Maze / cliffs / prop scatter** with per-cycle reroll — atmospheric layer no plan item covered.
- **Weather system** — server-authoritative 4-tier precipitation with client-side snowfall + audio + locomotion coupling.
- **Top-down spectator camera** with hybrid follow + pan (desktop drag, mobile d-pad).
- **Frost death sequence** with fade + teleport + wake-on-input (v2.10).
- **Paint tile CRDT refactor** (v2.7) — one synced entity per tile instead of per cell; unblocked the whole scale-up.

### Cut, deferred, or replaced

| Original | Fate |
|---|---|
| Axe / wood-chopping | Cut on Day 1 — one-verb (melt) design. Preserved as v2 pivot in vision §13.7. |
| Torch drop mechanic | Replaced by can't-drop-only-hand-off-or-extinguish (vision §12.2.1). |
| Dawn sequence / run end (N12) | Replaced by 24 h cycle. |
| Post-run "share your night" (N17) | Cut. |
| Cairns (N14) | Replaced by proximity-visible stone rings around discovered pits (not yet built). |
| Melt shader (N9 shader part) | Deferred; cube tween + demotion carries the visual. |
| Persistent state across server restart (N13 full) | Deferred to v1.1. |
| Fog dome | Attempted, dropped — Bevy back-face culling. |
| Contagious warmth aura | Owed — biggest gap vs. original pitch. |
| Onboarding choreography (N16) | Not started. |
| Torch island / mandatory fetch quest (vision §3) | Not built. |

### Timeline reality check

Today is **Day 8** of 19 (2026-08-25). Working time to submission: ~10 days. Original Week 2 focus ("beautiful pass + friendzone completion") is where we are, and the picture is:

- **Ahead of plan** on: multiplayer social mechanics (chain-lighting, hidden fires), persistent world (24 h reset already shipped and smoke-tested), audio polish, atmosphere.
- **On plan** for: mobile HUD, perf (real-device tested each update), core loop playability, fire VFX.
- **Behind or unstarted**: contagious warmth aura (headline visual — the §12.5 marketing shot), onboarding choreography (Day 13), trailer/pitch deliverables (Day 16), `docs/VISION.md`.

### Remaining critical path (revised for 10 days)

Ordered by judging-impact-per-hour. Cut ruthlessly below the line if any slips.

1. **Contagious warmth + visible glow between paired players** — this is the §12.5 headline the whole pitch rests on. Without it, the "cozy multiplayer" thesis is verbal, not visible. **Highest ROI item remaining.**
2. **First-90-seconds choreography** — spawn beside fire, one log at feet, torch discoverable within 20 s. Torch-island fetch quest (vision §3) is *nice*, but simple spawn-tuning gets 80% of the value in 10% of the time.
3. **Multiplayer full-session test on real devices** (Day 12 in original plan). Non-negotiable.
4. **Trailer** (60–90 s, mood + mechanic + warmth-glow shot).
5. **`docs/VISION.md`** — one-page continued-work pitch.
6. **README pitched at players not devs** — done in this pass (2026-08-25).

Below the line (ship without if time runs out):

- Stone-ring memory signal on discovered pits
- Torch island fetch quest (onboarding ritual)
- Named fires / community hearth log
- Daily community outcome line at rollover splash
- Melt shader upgrade
- Real cross-restart persistence (Storage API)

### Risks worth naming

- **Contagious warmth is the pitch and it doesn't exist yet.** Everything else can be trimmed; this can't. Budget 2 days.
- **No playtest with strangers has happened.** Everything above assumes the loop is fun. First real playtest may invalidate priorities.
- **Trailer is a full day of work** and the temptation to skip it for "one more feature" is the classic jam mistake. Protect Day 16.

---

## 14. Change log

- **2026-08-24 v2.14** — Chain-lighting shipped (co-op mechanic #2 of the vision §12.5 headline triad). Torch-to-torch ignition on 2 m proximity, auto-fire (no key press), pure duplication (giver's fuel untouched), receiver gets a fixed 20 s (half of the new 40 s full-torch cap). Rule is deliberately one sentence: "lit torch touches unlit torch = ignition, always" — no fuel gates, no thresholds, learnable from a single observation. Full-torch fuel dropped 45 s → 40 s so half-torch is a round 20 s and the HUD math reads clean. **Files:** new `src/shared/messages.ts` schema `chainLightRequest { targetUserId }`; new `src/server/torch.ts` handler verifies sender-lit + target-unlit against the existing `torchLitByUser` cache, flips target to lit, rebroadcasts via the standard `torchLitFrom` pipe so every client (including the target) reacts through the same channel already used for regular relights; new `src/client/torchChain.ts` runs a 150 ms proximity poll (matches wood/logs cadence), fires `chainLightRequest` when local is lit + remote is unlit + distance < 2 m + per-pair 3 s cooldown expired, plays `playSurgeSfxAt(remoteTipPos)` for 3D positional whoosh at the target; also receives `torchLitFrom` for the local user's own id (self-echo filter in `remoteTorches.ts` skips it) and calls `relightTorchPartial(20)` + `playTorchSfxLocal()` when the incoming lit=1 disagrees with local lit-state (extinguish edges ignored). `src/client/remoteTorches.ts` extended with `isRemoteTorchLit(id)` + `getRemoteTorchUserIds()` exports plus a `remoteLitByUser` mirror map so the chain detector can iterate proximity candidates without re-querying `PlayerIdentityData`; also removes lit entries alongside torch teardown on player leave. `src/client/torchEquip.ts` gains `relightTorchPartial(fuelSeconds)` which **sets** rather than adds fuel — avoids the "invisible gift" case where a fresh receiver (fuel=full but unlit) would clamp back to max on an additive refill and the HUD would show no change. **Debug during build:** the first pass failed silently because the server's `bin/index.js` didn't have the new `chainLightRequest` message type registered — `EventBus` threw `Unknown event type: chainLightRequest` and dropped the packet. Root cause: server code is compiled ahead-of-time and hot-reload updates client-only; a full preview restart was required after adding a shared-message schema entry. Filed as a mental-note for future shared-schema changes. **Discussion trail (design pass over the review with claude/opendcl):** proximity radius set to 2 m ("torches genuinely have to meet") over 3–4 m for ritual feel; receiver gets 50 % over full 45/40 to preserve central-hearth gravity per vision §4 (infinite chain-relight at 100 % broke the leash and made the campfire feel optional); pure duplication over fuel-transfer because giver-cost had no thematic upside and would punish the helper; "both lit" case explicitly does nothing (no mid-torch top-off, no invisible fuel threshold) so the rule stays one sentence. Torch-can't-be-drop (vision §12.2.1) reconfirmed as de-facto shipped already (torch has no drop path in `logsInput.ts`; only extinguishes via burnout). Branch: `chain-lighting` → merged to main.

- **2026-08-15 v1** — First draft. Cozy survival, 14-day plan.
- **2026-08-15 v2** — Rewritten as pitch-and-competition entry. Added Pillars A/B/C, torch-XOR-wood, contagious warmth, persistent world, perf strategy, deliverables, judging scorecard.
- **2026-08-15 v2.1** — Tone locked to safe cozy realism. Audio collaborator confirmed, starts ~day 6.
- **2026-08-15 v2.2** — Wood source locked to buried-under-snow. Axe/trees removed from v1. Hand slot is torch-XOR-wood, two states.
- **2026-08-15 v2.3** — Added B1 reinforcement candidates (torch-can't-drop, heavy wood, regenerating pair warmth, fire tending, two-torch cells) as playtest-gated hypotheses — not commitments.
- **2026-08-17 v2.4** — Day 1 complete + partial Day 2. See status snapshot below.
- **2026-08-17 v2.5** — Scene reshaped 4×7 (28 parcels, portrait) → 8×8 (64 parcels, square) to test scalability toward the eventual 10– 20× world. Overhead camera reworked into a hybrid follow + pan (desktop drag + mobile d-pad). Skills bumped to the official `decentraland/sdk-skills` repo (adds `TouchScreenControls` + slider drag docs); confirmed mobile has no touch-drag delta — pan on mobile is button-driven by design.
- **2026-08-18 v2.6** — Atmosphere day. Server-authoritative random weather (4 precipitation levels), snowfall particles + audio, campfire smoke + spatial crackle, snow-crunch footstep SFX with per-stage cadence, locomotion drag gated by snow depth, held torch attached to right hand, brush overhaul (solid footprint, 4 tiers 0/1/3/5), spawn-stability fix (center + ring spawn instantly), landscape terrain hidden. See status snapshot below.
- **2026-08-22 v2.13** — Wood loop scaffolding: two-slot inventory, networked pile system, scattered chunk field. Delivered on a `wood` branch, unmerged. **UI:** `LogsButton` slot to the right of `TorchButton` in the frost-bar row (identical footprint, warm-gold border when carrying, empty otherwise); `layer.feedPrompt.tsx` mirrors `layer.relightPrompt.tsx` in visual language, stacked ~70 px above it (bottom 720→790 desktop / 200→270 mobile) so both can coexist inside a fire's ring; torch fuel-bar rescale bug fixed by swapping px math (`BTN_SIZE - 2*border - 2*inset`) for percentage sizing (`width/height: '100%'` + padding ring + `height: '${pct}%'`) so the drain scales cleanly at any canvas resolution. **Hearth pile (networked, dynamic id):** `src/server/logs.ts` owns `Map<pileId,{x,z}>` with a monotonic autoincrement id (never reused, no sync-id pool); messages `logPileAdded/Removed`, `logPickupRequest/DropRequest` (schema uses `Schemas.Number` not `Schemas.Float` — `Float` payloads arrived empty on the client in this SDK build, matches the `cycleState.nextRebuildEpochMs` precedent). Server broadcasts on drop and cycle-roll, `sendLogPilesTo(userId)` hydrates joiners. Hearth respawn timer (4 s) re-seeds the starter pile whenever the world empties; cancelled if a player drop refills the field first. **F-key flow (`logsInput.ts`):** F outside 3 m of any fire drops the log (sends `logDropRequest`, server spawns pile at player position + broadcasts); F inside 3 m feeds the fire (local consume; fuel state system N1 lands next). Feed radius previously reused `CAMPFIRE_MELT_RADIUS_M = 8` — tightened to `CAMPFIRE_RELIGHT_RADIUS_SQ_M = 9` (3 m) so "stand at the fire" means the same thing for feed and relight, and there's room in the melt ring to drop without accidental feeds. `isInFeedRange()` now returns true near the central campfire OR any lit hidden bonfire (piggy-backs `isInHiddenRelightRange()`), so hidden pits can be fed too. **Scattered chunks (deterministic per cycle):** `src/shared/woodScatter.ts` — pure `computeWoodScatter(seed) → WoodChunk[]`; identical output server + client via Mulberry32 with `'WOOD'` salt so only active/inactive state travels the wire. Rejection sampling: uniform disc up to `WOOD_MAX_RADIUS_M = 80`, accepted with a piecewise-linear density weight — zero inside `WOOD_CENTER_EXCLUSION_M = 12` (fire buffer), linear ramp to peak at `WOOD_PEAK_RADIUS_M = 50` (matches vision §12.1 target of 40–80 m average solo walk), gentle falloff to `WOOD_MAX_RADIUS_M`. Target 40 chunks. **Server (`src/server/wood.ts`):** owns `active: Set<idx>` for the current seed, handlers reject stale-seed pickups (post cycle-roll safety), trickle respawn every 60 s reactivates one random inactive chunk (`woodChunkActive` broadcast), `onCycleRoll` rebuilds scatter + broadcasts `woodActiveSet`. **Client (`src/client/wood.ts`):** re-derives scatter, spawns `logs_pickup.glb` per active idx (currently at scale 1.0 for tuning visibility), proximity poll (same 150 ms cadence + `armed` guard as pile pickup) sends `woodPickupRequest`, calls existing `pickupLogs()` so the F slot fills identically whether picked from chunks or piles. Dev locator beacons (warm-brown Y-billboarded plane, `DEV_BEACON_ENABLED` const in `wood.ts`) built + turned off before commit; visual code retained for tuning. **Bootstrap ordering fix:** `setupLogsClient()` + `setupWoodClient()` moved to BEFORE `initClientHandler()` so join-hydration broadcasts (`logPileAdded`, `woodActiveSet`) land after handlers register — same rule as `setupCycleClient` above them. **Audio:** `pop.mp3` (already in project) on pickup, `droplogs.mp3` on drop (curated for the project). Both play through the reused `muteClickEnt` camera-parented AudioSource; no new entities leaked. **Design (`docs/gameloop-vision.md`):** §13 item 7 added — axes + tree-chopping as v2 pivot candidate, with rationale for the v1 rejection (fractures the "one verb: melt" thesis from §12.1, breaks the two-slot hand from §12.2.1, requires 5+ new systems). **Cuts / follow-ups:** chunks are always visible — the "invisible until torch-melt reveals" gate from vision §6 is deferred to a follow-up pass so we could tune scatter density against a visible baseline first; chunk GLB reuses the pile model at 1.0 scale, wants a dedicated single-chunk asset; hearth-pile respawn timer was added to work around a suspected "pile not spawning" report that turned out to be the feed-radius routing bug (F inside 8 m fed instead of dropped); locomotion "walk slow with lit torch" bug reported once, resolved on reload — defensive fix (sample foot cell + 4 neighbors, take min stage) proposed but not implemented, revisit if it reproduces. Branch: `wood`, PR: https://github.com/iillee/dcl-snowdrift/pull/new/wood.

- **2026-08-20 v2.12** — Mobile paint-spawn hitch fixed + HUD polish. Root cause of the ~250 ms hitch on tile stream-in was `spawnCellsForTileImmediate` allocating all ~256 cell entities + `MeshRenderer.setBox` + `Material.setPbrMaterial` calls in a single frame; `SPAWN_DELAY_MS` only delayed *when* that frame happened, not its size. Fix: `paint.ts` gains a time-sliced work queue (`CELLS_PER_FRAME = 24`) — `spawnOne` / `spawnCube` now push closures instead of executing inline, drained N per tick, so a full tile spreads across ~11 frames. Far-plane LOD removal is now enqueued as the *tail* thunk of the tile’s cell work (was a fixed 120 ms timer that could fire before cubes finished under load), guaranteeing the plane stays under the cubes for the whole ramp-in and closing the swap-flicker. Guarded each queued thunk with `paintByTile.get(tileEntity) !== tileRec` so brief in/out flicks near the streaming boundary can’t leak orphan cell entities into a torn-down tile record. Prefetch headroom bumped: `CELL_STREAM_IN/OUT_RADIUS_M` 28/36 → 40/48 (8 m hysteresis preserved) so the sliced spawn finishes ~2–3 s before the tile is visually relevant. `LOD_SWAP_OVERLAP_MS` retained as a documented deprecation note. Frost bar redesigned: the ten segmented blocks collapsed into two continuous panels (warm-gold left, ice-blue right) with a single `segGap` breather, both fully rounded, corner radius stepped up 4→10 to match the button system (outer 18 → inner 14 → panels 10). Growth still snaps to the 10-step grid so feel is unchanged. Both panels host centred icons: `flame.png` on the warm side, existing `SnowflakeIcon` on the cold side (extended with an optional `size` prop, defaulting to 44 for the existing snow button); both auto-recenter and self-hide when their panel gets too narrow. Mobile inner frame alpha zeroed (was stacking 0.55 + 0.55 to produce a visible grey band around the pills) so mobile now matches the single-layer desktop look. Small bug fixes shipped alongside: desktop mute icon wasn’t swapping on toggle — react-ecs was diffing the same UiEntity in place and caching the texture handle; keying the icon by mute state forces a fresh element and the glyph updates. Spectator/eye button now calls `playUiClick()` on press to match the mute button’s click feedback. Relight tooltip pushed high on desktop (`margin.bottom` 200 → 720) so it lands near eye-line while running toward the fire instead of competing with the frost bar; mobile placement unchanged. Torch flame sphere albedo colour swapped to the frost bar’s warm gold `(1.00, 0.80, 0.30)` so the world flame and HUD heat readout share one palette; `FLAME_EMISSIVE` dropped 4.0 → 1.6 so the sphere reads as gold, not as a white blowout. A ground highlight ring on the campfire (driven by tooltip visibility) was prototyped and reverted — no visible impact in-scene.

- **2026-08-20 v2.11** — Polish + tuning pass on top of v2.10, plus the stomp/melt paint architecture split. Two additive systems: (1) hand-anchored torch smoke wisp (`src/client/torch.ts`), sized and coloured to match `campfireSmoke.ts` but tiny, world-space simulation (`PSS_WORLD`) so wrist animation trails the plume instead of dragging it; toggled by `playbackState` in the existing fuel system, booted into `PS_PLAYING` to sidestep some SDK builds’ refusal to accept a later `PS_PLAYING` transition after a `PS_STOPPED` initial state. (2) paintTick wire schema extended with `targetStage: 0 | 1` — `0` is the existing full-melt path; `1` is a new stomp/trample verb. Unlit walking now demotes pristine or stage-2 cells to stage 1 (still snow, just low), leaves stage 0 (blue paint) and stage 1 (existing low crust) alone. Client side: two outboxes (`paintOutboxMelt` + `paintOutboxStomp`) drained separately by `clientHandler.ts`, each sent as one `paintTick` per flush. Optimistic local render for stomp calls `advanceSnowFillStage(id, 1)` (same tween the CRDT observer uses for server regrowth) + patches `cellApplied` + `renderedIndex` so subsequent same-frame brush passes no-op — fixes a ~100–200 ms lag between the walking avatar and the stomp visual that user caught in mobile testing. Server side: `applyPaint(id, team, targetStage=0)` — for stomp, only writes if the cell is currently at stage 2 or `PALETTE_NONE`, sets `{index=team, stage=1, paintedAtMs=now}`. Campfire seed-area calls unchanged (default melt). Tuning: `UNLIT_SNOW_SPEED_MULT = 0.65` deleted from `locomotion.ts` (redundant once stomp/melt did the real “unlit is worse” work); snow precipitation profiles shifted up one tier (old MEDIUM → LIGHT, old HEAVY → MEDIUM, new HEAVY is a true whiteout at rate 2200, lifetime 8 s to churn more particles through the ~1000 engine cap per second); torch smoke lifetime cut 2.8 s → 1.8 s; both smoke plumes lightened to warm mid-grey; tree count 6 → 3. Relight radius split from melt radius: `CAMPFIRE_RELIGHT_RADIUS_M = 3` gates E-press and the light-torch tooltip; `CAMPFIRE_MELT_RADIUS_M = 8` unchanged for the frost thaw ring and server melt persistence. Prompt now surfaces for top-off too — hides only when torch is lit AND fuel ≥ 98 %. Prompt label always “Light torch” (top-off variant tried and rejected). Death sequence exits spectate before starting (`isTopDownActive()` → `toggleTopDownCamera()` in `enterDying()`); the emote + fade + teleport read wrong from top-down and the wake beat wants the avatar filling the frame. HUD outline unification: torch/eye/mute buttons all carry a 4 px outline (gold when active, cool white when idle), constant width to avoid the child-shift bug from toggling `borderWidth`. Frost bar outer frame gained the same white outline. Torch icon swaps to `torch_unlit.png` when out, both variants render at full white (dim tint made unlit invisible on mobile’s dark panel). Fuel colour kept constant warm gold. Mobile-only fixes landed in this session: `TORCH_FUEL_INSET` now expressed as `TORCH_BORDER_W + 6` so the fuel fill sits inside the border on every platform. Cleanup commit dropped a real latent bug — `topDownCamera.ts` was consuming `IA_PRIMARY` (E) to call the deprecated `cycleBrushUp()` no-op AND competing with `torchInput.ts` for the light-torch key; deleted E/F handlers there, then removed all deprecated brush-shim exports (`increaseBrush` / `decreaseBrush` / `cycleBrushUp` / `cycleBrushDown` / `BRUSH_MIN_CELLS` / `BRUSH_MAX_CELLS` / `BRUSH_STEP_CELLS`) plus unused imports and module vars in `torch.ts`. Broader mobile UI overhaul + `TouchScreenControls` work deferred to its own branch. See `docs/frost-torch-handoff-3.md` for full session notes.

- **2026-08-20 v2.10** — Death sequence + HUD unification pass. Built the full frost-death FSM (`src/client/frost/death.ts`, 9 phases): freeze → emote → fade-to-black → double-teleport-to-fire (flagtag stuck-emote workaround) → re-fire emote → fade-in → wake on first movement input. Fade overlay is a full-screen `ZoneType.FullScreen` React-ECS layer driven by `getDeathFadeOpacity()`. Torch extinguishes on death; frost fully resets on wake (both the local accumulator via new `resetFrostLocal()` export AND the CRDT component). Baseline frost time slashed 300s→30s so torchless outdoors kills fast — makes the torch a hard dependency. Torch fuel halved 90s→45s. New locomotion penalty: unlit torch in snow multiplies walk speed by 0.65. Relight is now proximity-only — removed the pointer-click on the campfire GLB, kept only the E-poll inside the heat ring; discoverability replaced by a bottom-center “Press E to Relight torch” tooltip (`layer.relightPrompt.tsx`) that only appears when torch equipped + not lit + inside the heat ring. Torch defaults to UNLIT on load-in and after respawn. Frost bar completely rewritten as a segmented Game Boy meter (`layer.frostBar.tsx`): 10 square blocks, warm-gold on the left, ice-blue takes over from the right as frost rises, rounded corners, background alpha matched to action-bar buttons (0.55). Torch HUD moved from a separate bottom hotbar into the action bar as a new `TorchButton` component (`layer.brushSize.tsx`) with same footprint / bg / radius as spectator/mute; fuel visual is an inverse of flagtag’s desktop charge-fill (rounded rect drains from the top, warm gold → ember orange below 25%). Border only visible when lit, constant 2px width so the fill stays centred. Old `hotbarLayer` unregistered but kept in-tree. Dev-flag consolidation: new `src/client/devFlags.ts` gates `SHOW_REROLL_BUTTON`, `SHOW_PRECIPITATION_BUTTON`, `SHOW_SERVER_STATS` — all default false for deploy hygiene, flip to true + hot-reload for local testing. Spectator button icon swapped from procedural parcel-grid to `assets/images/eye.png` (60×40, aspect-matched, tint gold on active). Mute icon shrunk 44→34. See `docs/frost-torch-handoff-2.md` for full session notes.

- **2026-08-19 v2.9** — Frost survival + torch fuel loop. Frost accumulates from two independent contributions (baseline ambient, halted by lit torch; snow depth, always applies). Fire trumps both and thaws over 45s. Torch has a 90s fuel timer; drains only while lit, refilled by pressing E inside the campfire heat ring (also click-to-relight via pointerEventsSystem on the campfire entity). Brush size is now torch-derived (3x3 lit, 1x1 unlit) — removed the +/- brush action-bar buttons entirely. HUD gains a bottom-center warmth pill (`layer.frostBar.tsx`, warm-gold base + paint-blue ice creeping from the right) and a hotbar slot (`layer.hotbar.tsx`, torch.png icon that dims on burnout, orange fuel bar along the bottom). Torch visuals: emissive orange flame orb attached in the right-hand anchor local frame; orb shrinks as fuel depletes and hides entirely when unlit; shaft stays a constant size. Merged the torch-v2 groundwork (unwired hotbar + emote stubs) into frost and repurposed torchInput.ts as the fuel-drain + relight handler. Torch-v2's raise-torch upper-body emote deferred; will return as the relight ritual animation.

- **2026-08-19 v2.8** — Prop-scatter system + full-seed reroll. New `src/shared/props/{catalog,scatter}.ts` + `src/client/props/spawn.ts` scaffold: deterministic per-seed placement of decorative props (currently 6 `tree_4` instances, scale 4–8 with random yaw) that spawns independently of maze tiles. `PropDef.reserves` field ready for hut/penguin/NPC types (huts pre-reserve cells so the maze flows around them). Removed the persistent center-cross tile (was preserved across rebuilds so players standing on it weren't shoved; campfire-adjacent tiles still spawn instantly via `isNearCampfire` so the same guarantee holds without a permanent entity). Top action bar gained a ↻ reroll button (`layer.brushSize.tsx` → `rerollLevel`) that clears props, publishes a fresh CRDT seed via `SeedHolder`, and the seed watcher now also drives perimeter cliffs: `PERIM_SEED` is a live variable set via new `setPerimeterSeed` / `clearPerimeter` / `hasPerimeterSpawned` exports, and `setupPerimeter` is idempotent (clear-first) so every seed change rebuilds cliffs, maze tiles, and props from the same seed. See session block below.

- **2026-08-18 v2.7** — Network fanout fix. Paint state re-architected from one-synced-entity-per-cell to one-synced-entity-per-tile carrying a packed byte array. Fixed sustained `maxSendPeers` / `maxNetworkMessageQueue` drops once coverage exceeded a few hundred cells. Also chased a Creator Hub deploy `Symbol(map)` proxy error to a Node 24 / pinned `sdk-commands` mismatch; workaround = deploy from Creator Hub app UI (bypasses CLI proxy). SDK pinned exactly (no `^`) to prevent CH publish drift. See session block below.

---

## 15. Status snapshot (2026-08-18)

**Scale-up spike (mid-Day 2, before visuals):**
- Scene resized 4×7 (28 parcels, 64×112 m portrait) → **8×8 (64 parcels, 128×128 m square)**. Everything derives from `SCENE_WORLD_SIZE_X/Z_METERS` + `scene.json` parcels — maze grid, campfire center, paint grid, top-down camera all propagated automatically.
- **Perf finding:** at 128×128 with 1 m cells, 2–3 players cutting the field trivially crosses several thousand cube entities and mobile load times degrade noticeably. Confirms PLAN §8 lever 1 (shared material caching) and lever 2 (cube→plane demotion, N15) must move from "planned" to "prerequisite" before we grow the world further.
- No world entities are currently clickable, so the pan drag catcher can safely block pointer clicks; gate this off entity interaction is added.

**Top-down camera (spectator-style, hybrid follow + pan):**
- `src/client/topDownCamera.ts` rewritten: FOLLOW / FREE modes, exponential smoothing (`1 - exp(-k·dt)`, k=5), bounds-clamped `lookTarget`, retains the small east-offset trick for WASD axis alignment.
- Follow-cam is the default. Any WASD / joystick input in FREE mode auto-recenters to FOLLOW.
- **Desktop pan:** hold-left-click + drag anywhere. Reads `PrimaryPointerInfo.screenDelta` inside `dragPollSystem`. 3-pixel dead zone so quick clicks aren't pans. Grab-and-pull convention (map style). `DRAG_M_PER_PX = 0.025`.
- **Mobile pan:** 4-button d-pad bottom-right (`src/client/ui/layers/layer.topDownPan.tsx`), hold-to-pan at `DPAD_PAN_SPEED = 22 m/s`. `TouchScreenControls` is intentionally not used yet — keeping native jump/E/F visible for future actions.
- **Mobile joystick zone:** desktop drag catcher is gated behind `!isMobile()` so it never swallows native joystick touches.
- No recenter button; auto-recenter on player-movement input covers it.
- `layer.cameraToggle.tsx` is now orphaned (existed but was never registered); the action bar's own top-down button (`layer.brushSize.tsx`) is the single entry point. File left in tree for a future repurpose.

**Complete (Day 1):**
- Rebrand: scene.json / package.json / README → Snow Drift; deploy target `snowdrift.dcl.eth`.
- SDK upgraded to `@dcl/sdk 7.26.1-...commit-96e9a29` (auth-server branch, matches flagtag).
- Canvas design doc archived to `docs/archive/DESIGN-canvas.md`.
- Cut list executed (§4): removed leaderboard, discord, roundTiming, snapshot, team-switching, `updateName`, `requestLeaderboard`, `roundReset`, and all downstream subscribers.
- Server simplified: no rounds, no name capture, no leaderboard CRDT. Messages schema reduced to `joinRoster` / `teamAssigned` / `paintTick`.

**Placeholder campfire (early Day 3 pre-work):**
- `src/client/campfire.ts` spawns `Fireplace_01.glb` at scene center (32, 0.25, 56).
- `src/shared/campfire.ts` — shared position + `CAMPFIRE_MELT_RADIUS_M` (8m) + `isInsideMeltRadius()`.
- Server paints a persistent 16m *blue* ring around the fire and refreshes it at 4Hz.
- Client refuses to schedule cube decay for cells inside the melt radius, so the cleared area never regrows into snow.

**Player defaults:**
- All players assigned `Team.Blue` (join-order team split removed).
- Default brush 3×3 (`PAINT_BRUSH_SIZE_METERS: 6 → 3`; cell size is 1m).
- Unpainted cubes now snow-white.

**UI cleanup (partial Day 9 preview):**
- Top HUD bar moved from right-edge vertical stack to top-center horizontal row.
- Removed the paint-swatch button (dead post team-switch removal).
- Mobile-only offsets: bar raised ~72px, `+`/`-`/`#` glyph nudges deepened, all via `isMobile()`. Desktop untouched.
- Overhead spectator camera lowered from 50m to 30m altitude.

**Day 2 remaining:**
- [ ] Cube colour → off-white with subtle blue tint (currently pure white).
- [ ] Melted colour → wet dark ground (currently bright team blue).
- [ ] Skybox → dusk / night.
- [ ] Fog → cool blue, tuned for mobile portrait.
- [ ] Retune cube decay to 30s (currently 10s in `paint.ts`).
- [ ] First mobile perf smoke test on `snowdrift.dcl.eth`.

**Deferred from Day 1:**
- [ ] Verify shared material caching in cube paint path (perf lever 1).

**Notes for next session:**
- Team infrastructure (roster join-order, palette CRDT, `applyPaint(id, team)`) is dormant but not removed — a future pass can rip it out when Snow Drift's mechanics fully replace the paint model.
- `layer.brushSize.tsx` filename is now a misnomer (it's the action bar) — rename during Day 9 HUD pass.
- `initMazeNet()` in `client/maze/rebuild.ts` is a no-op stub — kept as the integration point for future server-owned maze events.
- `PaintSwatchButton` is kept dormant (`_PaintSwatchButton`) in `layer.brushSize.tsx` for possible revival as a hand-slot indicator.

---

### 2026-08-18 session #2 (paint-tile-sync refactor + deploy unblock)

**Symptom that triggered it:**
- Server log spam: `maxSendPeers reached: 614 peers` and sustained `maxNetworkMessageQueue reached (~193 more/10s)` once painted coverage crossed ~1000 cells with a single player in the roster. CRDT messages were being dropped — late-joining clients would have seen partial paint state.

**Root cause:**
- `paintSync.ts` created one synced entity per painted cell (`PaintCell` component + `NetworkEntity`). Coverage of 1200 cells = 1200 synced entities × peer fanout — blew past the CRDT transport's queue and peer caps.

**Fix (branch `paint-tile-sync`, merged → main):**
- New `PaintTile` component (`cells: Schemas.Array(Schemas.Byte)`). Each byte encodes `(paletteIndex << 2) | stage` — fits palette 0..63 + stage 0..3, zero byte = unpainted/full snow.
- One synced entity per `(tx, tz, level)` tile chunk. Bounded at `tiles × levels` (64 × N) regardless of painted coverage. New network band `TILE_NETWORK_BASE = 200000`; retired `CELL_NETWORK_BASE`.
- `src/shared/paintGrid.ts` — added `splitCellKey` / `joinCellKey` / `tileNetworkId` / `tileKeyFromNetworkId` / `packCellByte` / `unpackCellByte`. Retired `cellNetworkId` / `cellKeyFromNetworkId`.
- `src/shared/paintSync.ts` rewritten: in-memory `tileBuffers` (`number[]` per tile), `dirtyTiles` set, `writeCellByte(cellKey, byte)` mutates the buffer + marks dirty, `flushDirtyPaintTiles()` publishes changed tiles once per engine tick via `PaintTile.createOrReplace`. Also `zeroAllPaintTiles()` for `clearAll()`. Running `paintedCellCount()` for logs / serverStats replaces `paintCellEntityCount()`.
- `src/server/paintState.ts` — `writeCellComponent` now calls `writeCellByte(cellKey, packCellByte(index, stage))`; `clearAll()` uses `zeroAllPaintTiles()`.
- `src/server/server.ts` — added the per-tick `flushDirtyPaintTiles()` system; heartbeat + paintTick summary now log `cells=painted tiles=allocated`.
- `src/client/paint.ts` — `syncCellsFromCrdt()` rewritten to iterate `PaintTile` entities, diff `tile.cells[]` against a per-entity shadow `Uint8Array`, and dispatch the *same* per-cell visual updates (`applyPaintIndex` / `advanceSnowFillStage`) only for changed cells. Steady-state cost is proportional to *changed* cells per frame, not painted cells.

**Behaviour unchanged from a player's POV:**
- Melt drop-tween, snow-regrowth rise-tween, late-join hydrate at mid-stage, campfire ring refresh, and terminal `team → NONE` regrowth all still route through the same client visual paths. Purely a network-layer swap.

**Confirmed working:**
- Preview: clean client log, painting responsive, weather + brush + team assignment all healthy, no CRDT drops.
- Deploy: verified live on `snowdrift.dcl.eth`.

**Deploy blocker (separate from refactor):**
- `sdk-commands deploy` from CLI throws `Proxy error: Key Symbol(map) in undefined.headers is a symbol, which cannot be converted to a ByteString.` Chased through an SDK bump to `@next` (which removed `registerMessages` — blocking) and back. Root cause: **Node 24 + pinned `sdk-commands`** — the local deploy proxy tries to coerce a `Headers` object whose internals changed in Node 20+ `undici`.
- **Workaround:** deploy from the Creator Hub app UI, which uses its own Electron-embedded signing flow and bypasses the CLI proxy. Verified successful.
- Alternatives noted: downgrade Node to 20 LTS via nvm-windows; or bump only `sdk-commands` (risky — shares repo with `@dcl/sdk` `@next` that removed `registerMessages`).
- SDK pinned exactly in `package.json` (no `^`) so any future `npm install` during CH publish cannot drift the version.

**Deferred:**
- Server-side idempotency filter on `paintTick` — clients still re-send ids for already-melted cells; server correctly no-ops but the ~5/s summary shows `applied=0` chunks. Small follow-up, ~10 lines.
- Client-side paintTick throttling when the local cell is already melted.
- Byte layout is now a stability contract (6-bit index + 2-bit stage). If palette ever needs >64 entries or stages >4, bump with a version byte.

---

### 2026-08-18 session (atmosphere + torch + brush overhaul)

**Weather system (server-authoritative + universal):**
- `src/server/weather.ts` — owns the single source of truth for precipitation (0 CLEAR / 1 LIGHT / 2 MEDIUM / 3 HEAVY). Random cycle every 35–75 s, biased ±1 steps (75 % of the time) for smooth arcs with occasional full-random jumps. Broadcasts `weatherState` on every change and hydrates joiners via `sendCurrentWeatherTo()` inside the `joinRoster` reply. Accepts `weatherRequest` from any client so the HUD snowflake button can nudge global weather.
- `src/client/snowfall.ts` — four per-level profiles (rate, lifetime, gravity, initial speed, size, alpha) applied to a single Box-shaped `ParticleSystem` at scene centre. Uses `PBParticleSystem_BlendMode` / `PBParticleSystem_PlaybackState` (SDK 7.26 exports these as runtime enums; the older `ParticleSystemBlendMode` name is type-only in this build). CLEAR calls `PS_STOPPED` for a clean snap-off; other transitions reconfigure the emitter in place so prewarmed particles persist. HEAVY tuned for whiteout: 1200 rate, 5 s lifetime, 0.28 gravity, 2.4–3.6 m/s fall, 0.28–0.55 flake size.
- `src/client/snowfallAudio.ts` — camera-parented AudioSource looping `snowfall.mp3` at per-level volume (0 / 0.08 / 0.20 / 0.40); CLEAR sets `playing: false` to avoid dead-air.
- `src/client/paint.ts` accumulation cadence is precipitation-driven: LIGHT = 15 s per stage, MEDIUM = 10 s (baseline), HEAVY = 5 s, CLEAR freezes in-progress fills. Global heartbeat now reads the active weather each tick.
- HUD snowflake button (`layer.brushSize.tsx`) sends `weatherRequest` — no local `setPrecipitation` on click, so all players stay lockstep with server broadcasts.

**Campfire polish:**
- `src/client/campfireSmoke.ts` — narrow cone `ParticleSystem` at flame tip. Grey alpha-blend particles, negative gravity for buoyant rise, size 0.5 → 2.0 over 4.5 s life, matched wind vector to snowfall so the world feels like one weather system.
- `src/client/campfire.ts` now also spawns a looping `AudioSource` on the fire entity itself (`global: false`) so the crackle attenuates naturally with distance.

**Locomotion gate (`src/client/locomotion.ts`):**
- Polls player position every 150 ms, reads snow stage under-foot via `getSnowStageAtWorld` and applies `InputModifier` + `AvatarLocomotionSettings` accordingly. Stage 0 (melted) = normal walk, run **still disabled** (this is a snow world). Stage 1 = 3.0 m/s brisk walk. Stage 2 = 1.5 m/s + no jump. Stage 3 = 1.0 m/s trudge + no jump. 2-poll hysteresis prevents cell-edge flicker.

**Foot SFX (`src/client/snowFootsteps.ts`):**
- Fires the single-step clip `snowstepsingle.mp3` on a **distance cadence** (not looping). Per-stage stride: shallow 1.6 m, mid 1.2 m, deep 1.0 m — combined with the locomotion cap, cadence naturally slows in deep snow. ±8 % pitch jitter per step so repeated crunches don't sound identical. Silent on stage 0. Clip trimmed head/tail with ffmpeg to 293 ms (was 504 ms).
- `playClaimSfx` (paint sound) removed — will get a dedicated melt SFX later.

**Held torch (`src/client/torch.ts`):**
- Follows the flagtag two-layer AvatarAttach pattern: `AAPT_RIGHT_HAND` anchor → STATIC child. Never mutate the anchor's Transform after AvatarAttach is created (Bevy propagation race).
- Model: `assets/asset-packs/large_log/Log_Large_01/Log_Large_01.glb`, scale `(0.09, 0.18, 0.18)` (Y/Z stretched 2× for a longer torch shaft), rotation `(90, -30, 90)` — pitched off the forearm axis, then rotated −30° on Y to angle across the palm. Colliders off.
- Exports `getTorchTipEntity()` so future flame particles / LightSource can parent to the hand.

**Brush overhaul (`src/client/brush.ts` + `paint.ts`):**
- Tier count reduced to four: `0 (off) / 1 / 3 / 5`. `BRUSH_MAX_CELLS = 5`.
- Removed the ring-around-footprint scheme — all brushes now paint a **solid N×N** area. brush=3 = 9 cells (was 25 cells from the outer ring).
- Default `PAINT_BRUSH_SIZE_METERS = 3` → boot brush is 3×3.

**Spawn stability (`src/client/maze/rebuild.ts`):**
- New constant `INSTANT_SPAWN_ORDER_MAX = 8`: tiles with BFS order ≤ 8 (centre + immediate ring) spawn instantly at full scale, no grow-tween, no pop SFX. Fixes the "maze generation pushed me sideways" bug on first spawn.

**HUD polish:**
- Snowflake button added to top action bar; icon composed manually (React-ECS has no rotate); tint reflects current level (dim/white/ice-blue/deep-blue).
- `#` (server stats) and spectator buttons swapped; `#` glyph shrunk to 44 px on desktop with recentred nudge.
- ServerStats panel dropped into `TopCenter` zone below the action bar via `margin.top` (120 desktop / 48 mobile).
- Desktop drag-catcher (top-down pan mode) now leaves a 140 px top-strip unclickable so the action bar receives clicks in spectator mode.
- D-pad hidden on desktop (mobile-only — desktop uses click-drag).
- `landscapeTerrain: false` in `scene.json` to hide the surrounding Genesis City island in preview.
- `navmapThumbnail` updated to `assets/images/snowdrift.png`.

**Generic scatter system (`src/client/scatter.ts`):**
- Deterministic (mulberry32 seed) random prop placement. Weighted model pool, per-instance uniform scale + independent Y-squash + horizontal stretch + tilt jitter + Y offset, exclusion predicate, kind field (`static | pickup | powerup`) for future pickup/powerup wiring. Same seed → same layout on every client, no network sync needed.
- Rocks were built + tuned then removed on request; the utility remains for the next scattered-prop use case.

**Composite / assets:**
- `main.composite` updated to include the campfire + Log_Large_01 references.
- New sounds: `snowfall.mp3`, `campfire.mp3`, `snowfootsteps.mp3`, `snowstepsingle.mp3` (+ `.orig.mp3` untrimmed backup).
- New models: rocks (3), Log_Large_01, standing_torch, small_log — imported to `assets/asset-packs/`.
- Old thumbnail `scene-thumbnail.png` removed; new `snowdrift.png` used for deploy.

**Explored + dropped this session:**
- **Fog dome.** Tried 5-plane box, tried inverted sphere via negative-scale winding flip, tried transparent PBR sphere — DCL's Bevy renderer culls back faces even on alpha-blend PBR, so a real inward-facing sphere needs a custom GLB with inverted normals. Dropped entirely for now; a proper GLB generator (`gen-fog-dome.mjs`) was drafted then removed to keep scope tight.
- **Rock scatter.** Built + tuned then removed — didn't match the intended vibe.

**Deferred:**
- Real flame + light on the torch tip (parented to `getTorchTipEntity()`).
- Melt SFX (paint sound removed; needs a dedicated non-crunch clip).
- Torch scale currently non-uniform in Y/Z; may want a slightly stretched log GLB variant instead so scale can be uniform.
- Instant-spawn ring size (8) may need to grow if spawn-shove recurs at edge of ring.

---

### 2026-08-24 session (audio polish pass)

**New SFX clips:** `assets/sounds/surge.mp3` (fire ignition whoosh), `assets/sounds/torch.mp3` (torch ignition), `assets/sounds/frost.mp3` (chunk-crossing cold cue, 8 s source, first 3 s only).

**Audio module (`src/client/audio.ts`) hardening:**
- Dedicated `surgeSfxEnt` (camera-parented) so surge/torch never collide with the shared `muteClickEnt` (click / drop / pickup). Two `AudioSource.createOrReplace` calls on the same entity in one frame were producing audible glitches on nearby fire loops.
- Every one-shot SFX now includes `currentTime: 0` in its `createOrReplace` payload. Without it the CRDT diff-check drops a repeated identical component write and the second (and every subsequent) play is a silent no-op — this was the root cause of "torch relight only plays on first light". Fix pattern mirrors the SDK's own `AudioSource.playSound` helper (see `@dcl/ecs/dist/components/extended/AudioSource.js`).
- New helpers: `playSurgeSfxLocal()` (camera-parented global), `playSurgeSfxAt(position)` (3D positional, spawns throwaway entity + 5 s cleanup system for remote-player fire ignition audibility), `playTorchSfxLocal()` (volume 0.18), `playFrostChunkSfx()` (one-shot with auto-silencer system that cuts at `FROST_SFX_WINDOW_S = 3.0` so the trailing hiss of the 8 s clip never plays).

**Feed-fire audio wiring (`src/client/logsInventory.ts`):**
- `feedFire()` no longer stacks `playDropSfx()` before `playSurgeSfxLocal()` on the same shared entity — the drop write never played and the double-`createOrReplace` in one tick was the primary "fire loop breaks after feed" trigger.
- Surge is now the sole SFX on log placement (local-global, 0.7). `dropLogs()` still uses `playDropSfx()` for actual on-ground drops.

**Fire loop stability (`src/client/campfire.ts`):**
- Main hearth's per-frame `AudioSource.getMutable(root).volume = ...` now writes only when the new value differs from the last write by ≥ `0.005`. Before the guard, the fuel lerp after a feed produced a fresh CRDT AudioSource state every tick, and the current renderer treated each as a restart — audibly the crackle "sped up / glitched" for ~250 ms after every feed. Static-state ticks were already a no-op because the value didn't change.

**Hidden campfire ignition audio (`src/client/hiddenCampfire.ts`):**
- `applyLitVisuals()` now calls `playSurgeSfxAt(pitPos)` on the unlit→lit transition (idempotency guarded by the existing `litLocal[index]` early-out). Fires for every client on receipt of `hiddenCampfireState { lit: 1 }`, so remote players hear the whoosh spatially when someone lights a pit.

**Hidden campfire flame scaling (`src/client/hiddenCampfire.ts`):**
- New per-frame system inside `setupHiddenCampfire()` snaps each lit pit's flame GLB scale on tier change via `hearthFlameScaleFromFuel(getHiddenFireFuel(i))` — mirrors the main hearth's tier-snap pattern from `campfire.ts`. Per-pit `lastFlameTier` cache; only mutates the Transform when tier actually changes. Resets cached tier to `-1` when the flame entity is torn down so re-ignition triggers a fresh scale apply.

**Hidden campfire warmth radius fix (`src/client/hiddenCampfire.ts` + `src/client/frost/accumulation.ts`):**
- Bug: standing at the edge of a maxed hidden pit's visible melt disc still applied frost damage. Root cause: `getHiddenCampfireWarmthPositions()` returned only `{x,z}` and the frost accumulator compared against the static `CAMPFIRE_MELT_RADIUS_SQ_M` (historic tier-3 8 m radius). Pits fed above tier 3 (12 m / 17 m) melted snow past the warmth ring.
- Fix: `getHiddenCampfireWarmthPositions()` now returns `{x, z, radiusSq}` per lit pit using per-index `getHiddenFireMeltRadius(i)`; accumulator iterates `hp.radiusSq` instead of the constant. Warmth now grows/shrinks with fuel exactly like the main hearth, matching what's visible on the ground.

**Frost SFX trigger (`src/client/frost/accumulation.ts`):**
- Edge-triggered on **new-blue-chunk crossings**, not continuous damage. Tracks `lastChunkIndex = Math.floor((frost / FROST_MAX) * FROST_BAR_SEGMENTS)` (10 segments, matches `layer.frostBar.tsx`); fires `playFrostChunkSfx()` only when the index increases. Ambient wading through shallow snow that never fills a full segment stays silent. Thawing (index decreasing) is silent by design. Reset to `0` in `resetFrostLocal()` so death-wake doesn't fire a phantom chunk.

**Torch relight audio + cooldown (`src/client/torchInput.ts` + `src/client/ui/layers/layer.relightPrompt.tsx`):**
- SFX now fires directly from `tryRelightAtFire()` on every successful relight action (not on `isTorchLit()` state edge). Topping off a still-lit torch doesn't flip `lit` false→true, so the edge-based trigger silently skipped every relight except after a full burnout.
- `RELIGHT_COOLDOWN_MS = 5000` swallows follow-up E-presses (no SFX, no fuel top-off, no state change), preventing whoosh double-taps.
- `shouldShowPrompt()` in `layer.relightPrompt.tsx` returns `false` while `isTorchRelightOnCooldown()` is true, hiding the tooltip during the cooldown window. Applies only to the relight-torch path; hidden-pit ignition (`requestHiddenIgnite`) is unaffected.

**Deferred / follow-ups:**
- Hidden campfires use static `CAMPFIRE_VOLUME` (no per-frame writes) — no epsilon guard needed today, but the same pattern will be required if they gain a tier-scaled volume like the main hearth.
- Snowfall loop seam experiment (dual staggered AudioSources at half-volume) was tried and reverted — original single-source implementation kept.
