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

## 14. Change log

- **2026-08-15 v1** — First draft. Cozy survival, 14-day plan.
- **2026-08-15 v2** — Rewritten as pitch-and-competition entry. Added Pillars A/B/C, torch-XOR-wood, contagious warmth, persistent world, perf strategy, deliverables, judging scorecard.
- **2026-08-15 v2.1** — Tone locked to safe cozy realism. Audio collaborator confirmed, starts ~day 6.
- **2026-08-15 v2.2** — Wood source locked to buried-under-snow. Axe/trees removed from v1. Hand slot is torch-XOR-wood, two states.
- **2026-08-15 v2.3** — Added B1 reinforcement candidates (torch-can't-drop, heavy wood, regenerating pair warmth, fire tending, two-torch cells) as playtest-gated hypotheses — not commitments.
- **2026-08-17 v2.4** — Day 1 complete + partial Day 2. See status snapshot below.
- **2026-08-17 v2.5** — Scene reshaped 4×7 (28 parcels, portrait) → 8×8 (64 parcels, square) to test scalability toward the eventual 10– 20× world. Overhead camera reworked into a hybrid follow + pan (desktop drag + mobile d-pad). Skills bumped to the official `decentraland/sdk-skills` repo (adds `TouchScreenControls` + slider drag docs); confirmed mobile has no touch-drag delta — pan on mobile is button-driven by design.
- **2026-08-18 v2.6** — Atmosphere day. Server-authoritative random weather (4 precipitation levels), snowfall particles + audio, campfire smoke + spatial crackle, snow-crunch footstep SFX with per-stage cadence, locomotion drag gated by snow depth, held torch attached to right hand, brush overhaul (solid footprint, 4 tiers 0/1/3/5), spawn-stability fix (center + ring spawn instantly), landscape terrain hidden. See status snapshot below.

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
