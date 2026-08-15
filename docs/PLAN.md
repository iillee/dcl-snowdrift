# Snow Drift — Build Plan

**Deadline:** 2026-09-03 20:00 (Friendzone Gamejam submission)
**Start:** 2026-08-15
**Working window:** ~19 days, 4–8 h/day, solo dev
**Base:** fork of `dcl-canvas` @ digger WIP → this repo
**Deploy target:** `snowdrift.dcl.eth` (World)
**Platform priority:** mobile-first (portrait), desktop secondary

---

## 1. Design pillars

1. **Cozy, not punishing.** Freeze is a slow squeeze, never a jump-scare. Death should feel like the fire going out at the end of a long night.
2. **The canvas *is* the world.** The digger paint mechanic reads as snow melting. No new terrain system.
3. **Co-op by presence.** v1 co-op = we're in the same World, feeding the same fire, watching the same canvas melt. No shared inventory, no revive — just shared stakes.
4. **Ship v1 lean.** Every feature must earn its place before Sep 3. Stretch goals live in §7 and only get built if week 2 finishes early.

---

## 2. Core loop (v1)

```
spawn near campfire
  → pick up wood from starting pile
  → feed fire (radius grows, flames grow)
  → wood pile empties
  → light a torch OR just brave the cold
  → venture into snow, melt cubes, find wood
  → return to fire before freeze meter hits 0
  → feed, repeat, push further out each time
  → snow slowly regrows outside melt radius
  → fire eventually dies → run ends, show time survived
```

**Session goal:** keep the fire alive as long as possible. Shared session timer displayed on HUD.

---

## 3. What carries over from `dcl-canvas`

| System | Reuse | Notes |
|---|---|---|
| 4×7 parcel tile maze | ✅ as-is | Maze walls become natural terrain variance under snow |
| Digger cube field (WIP paint.ts) | ✅ core mechanic | Grey cube = snow. Painted-and-flat = melted ground. |
| Ring-outside-footprint paint | ✅ reframe | Becomes "torch/campfire melt radius" |
| 10 s decay back to grey | ✅ retune | Becomes snowfall regrowth. Slow it down (~30–60 s) and gate it to outside melt radius. |
| Server-authoritative CRDT paint state | ✅ as-is | Perfect for shared melt map |
| Top-down spectator cam | ✅ as-is | Great for co-op overview / marketing shots |
| HUD stack (React-ECS) | 🔧 rework | Replace paint tools with fuel/freeze/interact |
| Snapshot PNG export | ✅ keep | Free marketing tool — "share your final melt map" |
| Team.Red/Blue swatch | ❌ cut | No teams. Single palette. |
| Leaderboard, Discord webhook, roundReset | ❌ cut | Not needed for v1 |
| Brush size +/- controls | ❌ cut | Melt radius is driven by fire state, not player choice |

**Cut list (delete on day 1):** `layer.leaderboard.tsx`, `server/discord.ts`, `server/leaderboard.ts`, `shared/roundTiming.ts`, `switchTeam` message handling, brush size HUD.

---

## 4. New systems to build

| # | System | Complexity | Files (planned) |
|---|---|---|---|
| N1 | Campfire entity (state, flame scale, melt radius) | M | `shared/campfire.ts`, `server/campfireState.ts`, `client/campfire.ts` |
| N2 | Fuel/wood pickup + inventory | M | `shared/inventory.ts`, `client/pickup.ts`, `server/spawner.ts` |
| N3 | "Feed fire" interaction | S | extend `client/campfire.ts` |
| N4 | Freeze meter (per-player warmth) | M | `shared/warmth.ts`, `client/warmth.ts`, HUD |
| N5 | Torch (equip, personal melt radius, burn timer) | M | `client/torch.ts`, extend paint apply |
| N6 | Snowfall regrowth tuning | S | retune existing decay in `paint.ts` |
| N7 | Wood spawning in the world | S | `server/spawner.ts` |
| N8 | Mobile HUD (freeze bar, fuel count, interact button, timer) | M | rewrite `client/ui/` |
| N9 | Snow visual pass (skybox, palette, particles, audio) | M | `client/environment.ts`, assets |
| N10 | Death/end-of-run + restart flow | S | server state machine |

Difficulty: S = ½–1 day, M = 1–2 days.

---

## 5. Two-week calendar

Numbered by working day, not calendar day — take weekends off as needed, the buffer absorbs it.

### Week 1 — Reskin + solo playable core loop

**Day 1 (Sat 08/15) — Foundations**
- Rename scene.json title + worldConfiguration → `snowdrift.dcl.eth`.
- Update `package.json` name, `README.md`, `DESIGN.md` header.
- Execute cut list (§3). Verify preview still boots.
- Commit digger WIP as its own commit so the diff is legible.

**Day 2 — Reframe the canvas as snow**
- Recolour grey cube → soft off-white (`#F0F4F8`) with slight blue tint.
- Change melted/painted colour → wet dark ground brown (`#3A2E24`).
- Tune decay: 30 s (not 10), and *only decay if outside campfire melt radius* (needs campfire stub — hardcode centre for today).
- Skybox → night / dusk. Fog tint → cool blue.

**Day 3 — Campfire N1 (server-authoritative)**
- `CampfireState` CRDT component: `{ fuel: number, radiusMeters: number, alive: boolean }`.
- Server tick: fuel decays over time, radius = f(fuel), alive = fuel > 0.
- Server continuously paints cubes within radius each tick (drives the melt).
- Client: spawn a campfire GLB at scene centre, scale flame with fuel.
- No interaction yet — fire just burns down.

**Day 4 — Wood pickup + feed interaction (N2 + N3)**
- Spawn a starting wood pile GLB near campfire, N logs as separate entities.
- `pointerEventsSystem.onPointerDown` on a log → server message `pickupWood` → adds to player inventory.
- Walk up to campfire → prompt "Feed fire (E)" → server message `feedFire` → +fuel, remove one from inventory.
- Simple HUD text: "Wood: 3".

**Day 5 — Freeze meter (N4)**
- Per-player warmth 0–100, drains at 1/s outside melt radius, 3/s in "deep snow" (>10 m from any melted cell), refills fast inside radius.
- HUD bar (mobile-friendly, portrait-safe position).
- At 0 → force emote (shiver) + slow movement via `InputModifier`. No death yet.
- Playtest solo for 15 min. Does the loop feel like anything?

**Day 6 — Torch (N5)**
- Equip torch (server message `equipTorch`, consumes 1 wood).
- While equipped: `AvatarAttach` a torch GLB to the player's right hand, and paint a small ring around the player each tick (client-authoritative, same code path as digger).
- Burn timer 60 s → auto-drop.
- This is the moment the game becomes *playable* — you can venture out.

**Day 7 — Wood spawning + regrowth polish (N6 + N7)**
- Server spawns wood entities at random walkable cells outside melt radius, replenishes on a slow timer.
- Wood revealed under snow: only interactable once its cell is melted.
- Retune snowfall regrowth so tracks fade in ~45 s but melted radius stays clear.
- **End of week 1: solo game is fully playable start-to-finish.**

### Week 2 — Multiplayer, mobile, polish, ship

**Day 8 — End-of-run + difficulty (N10)**
- When `fuel = 0` for 5 s: fire dies, all players see "The fire went out — 12:34 survived", short freeze-frame, then respawn.
- Difficulty scaling v1: wood spawn density decreases with elapsed session time; fuel decay rate increases. Log the curve so you can tune later.

**Day 9 — Mobile HUD pass (N8)**
- Redesign for portrait. Bottom-left: freeze bar + wood count + timer. Bottom-right: single big interact button (context-sensitive: pickup / feed / equip torch).
- Test on actual phone via Creator Hub QR / port-forward.
- Kill any HUD element that doesn't fit or isn't tappable.

**Day 10 — Multiplayer verification**
- Two clients into the same World preview. Verify: shared fire state, shared melt map, independent inventories + warmth, both can pick up + feed.
- Fix desync bugs (there will be some — this is the day for them).

**Day 11 — Visual + audio pass (N9)**
- Snow particles falling.
- Fire crackle audio (positional), wind ambient, footstep-in-snow SFX, pickup ding, freeze-warning heartbeat when warmth < 20.
- Placeholder soundtrack from free source; hand off to your friend if that's happening.
- Model pass: source better campfire/torch/log GLBs from `add-3d-models` catalog if the placeholders look weak.

**Day 12 — First deploy + playtest**
- Deploy to `snowdrift.dcl.eth`.
- Get 2–3 friends into a session. Record. Note every "huh?" moment.
- Prioritise fixes into a shortlist for days 13–14.

**Day 13 — Fix + tune from playtest**
- Address the top 3–5 issues only. Resist scope creep.
- Tune numbers: fuel decay, warmth drain, wood spawn rate, torch burn time. This is the day the game *feels* right or doesn't.

**Day 14 — Polish, thumbnail, submission**
- Scene thumbnail + preview image.
- Update `README.md` and `DESIGN.md` to reflect Snow Drift (not Canvas).
- Record a 30–60 s gameplay clip for the Dorahacks submission.
- Final deploy. Submit before Sep 3, 20:00.

### Buffer (Sep 1–3, ~3 days)
Reserved for: onboarding hint UX, a stretch goal from §7, or just breathing room. Do not plan features into this window.

---

## 6. Milestones (go/no-go checkpoints)

| Date | Milestone | If missed, cut |
|---|---|---|
| End Day 2 | Canvas reads as snow | Skip visual polish, ship grey aesthetic |
| End Day 4 | Fire can be fed, fuel drains | This is the critical path — do not miss |
| End Day 6 | Torch works, cold has consequences | Cut torch, keep just campfire radius |
| End Day 7 | Solo loop complete | Cut co-op polish, ship solo-only |
| End Day 10 | Multiplayer verified | Deploy solo-only fallback |
| End Day 12 | Public deploy | This is the real deadline. |

---

## 7. Stretch goals (only if ahead of schedule)

Ordered by ROI:
1. **Jackets** — pickup, halves warmth drain rate. ½ day.
2. **Hot cocoa** — instant warmth refill pickup. ½ day.
3. **Secondary campfires** — light one with a torch to expand territory. 1 day.
4. **Axe + tree entities** — can't carry torch + axe simultaneously (the teamwork mechanic you mentioned). 1–2 days.
5. **Persistent high score** across sessions via server Storage. ½ day.
6. **Onboarding hint** — first-time text overlay explaining the loop. ½ day.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Cube count perf on mobile (7,168 cubes vs planes in digger WIP) | Day 2: run mobile perf test. If bad, only spawn cubes within N tiles of nearest player. |
| Server-driven continuous melt = high CRDT churn | Batch cell updates per tick; publish at 5 Hz not per-frame. |
| CRDT decay/regrowth conflicting with player-driven paint | Server owns regrowth; client never regrows locally. |
| Freeze meter feels annoying not cozy | Day 5 playtest gate — if it's not fun, halve the drain and test again. |
| Mobile HUD invisible / untappable | Day 9 dedicated day + real-device test. |
| Scope creep from stretch goals | §7 is a hard bucket — nothing moves out of it into the calendar without explicit swap. |

---

## 9. Deploy checklist (Day 14)

- [ ] `scene.json` → `worldConfiguration.name = "snowdrift.dcl.eth"`
- [ ] `authoritativeMultiplayer: true`
- [ ] Spawn points near campfire, not at world origin
- [ ] Thumbnail + display.title + description
- [ ] README updated
- [ ] 30 s gameplay clip recorded
- [ ] Dorahacks submission form filled
- [ ] Deployed and reachable via jump URL from a fresh browser

---

## 10. Change log

- **2026-08-15** — Plan drafted. Repo forked from dcl-canvas (digger WIP) with `Snowdrift Brief.pdf` preserved.
