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

	// Client → Server (DEV only): force an immediate cycle rollover for
	// smoke-testing the reset flow before real midnight UTC arrives.
	// Gated on the client by devFlags.ENABLE_DEV_ROLL_CYCLE + the
	// button that emits it; server accepts unconditionally (no anti-
	// cheat here — this is a dev affordance, remove or gate before a
	// production deploy that exposes it to random visitors).
	devRollCycle: Schemas.Map({}),
}

export const room = registerMessages(Messages)
