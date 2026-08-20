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

}

export const room = registerMessages(Messages)
