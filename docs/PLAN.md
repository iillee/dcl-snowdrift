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
- Hands are a single inventory slot.
- Torch lights the way and melts snow around you but you can't chop wood while holding it.
- Wood/axe (whichever we pick) is required to gather more fuel but leaves you dark and unable to melt on the walk back.
- Solo: painful, slow ping-pong between the two states. *Possible* but the fire dies faster than you can feed it.
- Two players: one carries torch (guide + melt), one carries axe (harvest). Range doubles, warmth stays high.
- Three+: someone tends fire while pair ventures further.

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
| N5 | Axe + choppable wood entities (or wood-under-snow reveal) | M | `client/axe.ts`, `server/spawner.ts` |
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

**Day 6 — Torch + Axe (N4, N5)**
- Equip torch from campfire (costs 0 wood, torch is a persistent item near fire).
- Torch in hand: personal melt ring + light source + 90 s burn timer.
- Axe in hand: can chop `Tree` or `Log` entities scattered in the snow → produces wood → auto-swaps hand slot from axe to wood.
- Trees only visible/interactable once their cell is melted (rewards venturing with torch).
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
- [ ] **Axe vs wood-under-snow** for N5 — do you *chop trees* or *dig up wood* buried in the snowfield? Chopping is more legible; digging reuses the melt mechanic more elegantly. Recommendation: **dig up wood** — fewer models, one core verb. Decide by day 4.

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
