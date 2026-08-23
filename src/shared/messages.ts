/**
 * messages.ts — shared WS message schema for the Snow Drift auth server.
 *
 * Registered from both client and server (identical schema).
 *
 * Message set: joinRoster/teamAssigned, paintTick (command only).
 * Paint *state* syncs exclusively via CRDT components (PaintCell /
 * PaletteEntry / PaintCoverage) — not room messages.
 */

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
	// Client → Server
	// Sent once on client boot after PlayerIdentityData is populated.
	// Server appends to roster if new, replies with teamAssigned to the sender.
	joinRoster: Schemas.Map({ userId: Schemas.String }),

	// Server → Client
	// team values match the Team enum in src/shared/team.ts: 1 = Red, 2 = Blue.
	// Assignment is `roster.indexOf(userId) % 2` — stable across rejoin,
	// and guaranteed to alternate (fixes the "two blue players in a row"
	// issue the Phase 3 client hash could produce).
	teamAssigned: Schemas.Map({ team: Schemas.Int }),

	// Client → Server: cells painted by the sender since the last flush.
	// Sent at PAINT_TICK_HZ. Server looks up sender's team from roster,
	// interns the team Color4 into the palette, and writes the palette
	// index into a per-cell PaintCell CRDT component. Not a state-sync channel.
	//
	// targetStage semantics:
	//   0 = full melt (torch lit, or campfire ring). Cell becomes
	//       {index=team, stage=0} unconditionally.
	//   1 = stomp / trample (torch unlit walk). Cell becomes
	//       {index=team, stage=1} ONLY if it is currently at stage 2 or
	//       PALETTE_NONE (pristine). Cells already at stage 0 or 1 are
	//       left as-is — a torchless walker never overwrites a blue
	//       melted path or an existing low crust.
	//
	// WHY ids and not positions: server doesn't have the maze generator (it's
	// client-only for now), so it can't resolve position -> cell. Client
	// authors ids via worldToCellId locally; server trusts them for Phase 4.
	// Anti-cheat (position validation) is deferred to Phase 5 per the plan.
	// Rate limit: server caps ids per message from PAINT_BRUSH_SIZE_CELLS
	// (+ headroom); anything larger is dropped as suspicious.
	paintTick: Schemas.Map({
		ids        : Schemas.Array(Schemas.String),
		targetStage: Schemas.Int,
	}),

	// Server → Client: current precipitation level (0=CLEAR..3=HEAVY).
	// Sent to the joining client on joinRoster, and broadcast to everyone
	// whenever the server picks a new weather state. Universal + persistent
	// so every player sees the same snowfall + accumulation cadence.
	weatherState: Schemas.Map({ level: Schemas.Int }),

	// Client → Server: request a specific precipitation level (0..3).
	// Server accepts unconditionally and broadcasts weatherState. Any
	// player pressing the HUD snowflake button drives this.
	weatherRequest: Schemas.Map({ level: Schemas.Int }),

	// Server → Client: current cycle seed + whether the hidden
	// campfire for that cycle has been ignited. Sent to a joining
	// client on joinRoster, and broadcast to everyone when a client's
	// hiddenCampfireIgnite is accepted. Latecomers hydrate to the
	// already-lit state so they see smoke + hear the crackle from the
	// first frame.
	// lit encoded as 0/1 (int) rather than Schemas.Boolean. In practice a
	// Schemas.Boolean payload never reached the client through room.send,
	// while every Int-based message on the same wire (teamAssigned,
	// weatherState) rounds-tripped fine — so we sidestep it.
	hiddenCampfireState: Schemas.Map({
		seed : Schemas.Int,
		index: Schemas.Int,
		lit  : Schemas.Int,
	}),

	// Client → Server: request to ignite the current cycle's hidden
	// campfire. `seed` is echoed back so the server can drop stale
	// ignitions if the cycle has rolled since the client noticed the
	// trigger condition. Server does not currently validate position
	// (Phase-5 anti-cheat concern) — first valid seed wins.
	hiddenCampfireIgnite: Schemas.Map({
		seed : Schemas.Int,
		index: Schemas.Int,
	}),

	// Server → Client: authoritative cycle state.
	//   seed                 — current 24 h bucket id (same value as
	//                          hiddenCampfireState.seed). Clients should
	//                          treat THIS as canonical instead of computing
	//                          from local Date.now(), so a peer with a
	//                          skewed system clock never disagrees about
	//                          which cycle is active.
	//   nextRebuildEpochMs   — wall-clock ms (server's Date.now()) of the
	//                          next midnight-UTC rollover. Clients render
	//                          the countdown as `nextRebuildEpochMs -
	//                          Date.now()`; small NTP skew (<1 s) is fine
	//                          for a visible timer. Matches flagtag's
	//                          CountdownTimer.roundEndTimeMs pattern.
	// Sent to the joining client on joinRoster and broadcast to everyone
	// on cycle rollover.
	cycleState: Schemas.Map({
		seed              : Schemas.Int,
		nextRebuildEpochMs: Schemas.Number,
	}),

	// Client → Server: broadcast the local player's torch lit state whenever
	// it changes (relight, burn-out). Encoded 0/1 as Int for the same
	// Schemas.Boolean-over-the-wire caveat noted on hiddenCampfireState.
	torchLit: Schemas.Map({ lit: Schemas.Int }),

	// Server → Client: relay of another player's torch lit state. The
	// server rebroadcasts every torchLit message it receives, tagged with
	// the sender's authenticated userId (context.from), and re-sends the
	// full known set to joiners so latecomers see everyone's flames from
	// the first frame. The receiver renders a torch model on that remote
	// avatar's right hand and toggles the flame visibility to match.
	torchLitFrom: Schemas.Map({
		userId: Schemas.String,
		lit   : Schemas.Int,
	}),

	// Server → Client: a log pile has appeared in the world. Broadcast
	// on drop (someone dropped a log), on initial spawn (server boot,
	// cycle roll), and rebroadcast to joiners as hydration. `id` is a
	// server-owned autoincrementing int, unique for the server's lifetime.
	logPileAdded: Schemas.Map({
		id: Schemas.Int,
		// Schemas.Number (not Float) — Float payloads were arriving empty on
		// the client in this SDK build; Number rounds-trips reliably (same
		// choice as cycleState.nextRebuildEpochMs).
		x : Schemas.Number,
		z : Schemas.Number,
	}),

	// Server → Client: a log pile is gone (someone picked it up, or the
	// cycle rolled and cleared the world). Clients that don't know the
	// id (missed the add) should silently ignore.
	logPileRemoved: Schemas.Map({ id: Schemas.Int }),

	// Client → Server: I walked onto pile `id` and want to pick it up.
	// Server first-come-first-serve: only the first request for a given
	// id succeeds; subsequent requests are silently dropped. In a race
	// two clients can both believe they picked up the pile — acceptable
	// for the cozy tone; anti-cheat / strict serialisation is deferred.
	logPickupRequest: Schemas.Map({ id: Schemas.Int }),

	// Client → Server: I dropped my carried log at world position (x, z).
	// Server unconditionally spawns a new pile at that position with a
	// fresh id and broadcasts logPileAdded. Server does NOT track who is
	// carrying (yet) — that state stays local; a client that lies about
	// carrying could spawn free piles, tolerated for now.
	logDropRequest: Schemas.Map({ x: Schemas.Number, z: Schemas.Number }),

	// Server -> Client: full active-set snapshot for the current cycle.
	// Sent on join hydration and on cycle roll. `indices` are the chunk
	// idx values (from computeWoodScatter(seed)) that are currently
	// alive; everything else is inactive/picked-up.
	woodActiveSet: Schemas.Map({
		seed   : Schemas.Int,
		indices: Schemas.Array(Schemas.Int),
	}),

	// Server -> Client: a chunk came back online (trickle respawn). Client
	// looks up the position via its own computeWoodScatter(seed) and
	// spawns the GLB.
	woodChunkActive: Schemas.Map({ seed: Schemas.Int, idx: Schemas.Int }),

	// Server -> Client: a chunk was picked up and is gone. Client removes
	// its GLB. `pickerId` is the lowercased wallet address of the player
	// who grabbed it, so remote clients can play the head-bounce FX over
	// the correct avatar.
	woodChunkRemoved: Schemas.Map({
		seed    : Schemas.Int,
		idx     : Schemas.Int,
		pickerId: Schemas.String,
	}),

	// Client -> Server: I walked onto chunk `idx` and want to pick it up.
	// `seed` is echoed so the server can reject a stale pickup that arrived
	// after a cycle roll invalidated the client's scatter.
	woodPickupRequest: Schemas.Map({ seed: Schemas.Int, idx: Schemas.Int }),

	// Client -> Server: player fed a log to the main hearth. Server
	// validates (has-carried-log guard is client-side only for now;
	// server trusts the request and bumps fuel by LOG_FUEL_SECONDS).
	feedFireRequest: Schemas.Map({}),

	// Server -> Client: current main-hearth fuel in seconds. Broadcast
	// on significant change (delta > threshold, or tier crossed, or on
	// feed) and on joinRoster hydration. `players` is the current
	// player count baked into the packet so the client can render the
	// "xN" drain multiplier without a separate roster subscription.
	hearthFuelUpdate: Schemas.Map({
		fuel   : Schemas.Float,
		players: Schemas.Int,
	}),

	// Server -> Client: the main hearth just hit FUEL_MAX from below.
	// One-shot celebration hook (audio, billboard flash, camera zap) -
	// re-arms once fuel drops below Roaring tier entry (450 s), so it
	// won't fire again until players work back up to full.
	hearthMax: Schemas.Map({}),

	// Client → Server (DEV only): force an immediate cycle rollover for
	// smoke-testing the reset flow before real midnight UTC arrives.
	// Gated on the client by devFlags.ENABLE_DEV_ROLL_CYCLE + the
	// button that emits it; server accepts unconditionally (no anti-
	// cheat here — this is a dev affordance, remove or gate before a
	// production deploy that exposes it to random visitors).
	devRollCycle: Schemas.Map({}),
}

export const room = registerMessages(Messages)
