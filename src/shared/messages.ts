/**
 * messages.ts — shared WS message schema for the Cryocene auth server.
 *
 * Registered from both client and server (identical schema).
 *
 * Snow *state* syncs exclusively via CRDT components (PaintTile /
 * PaintCoverage); paintTick is the client → server command channel.
 */

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
	// Client → Server
	// Sent once on client boot after PlayerIdentityData is populated.
	// Server appends to roster if new, replies with teamAssigned to the sender.
	joinRoster: Schemas.Map({ userId: Schemas.String }),

	// Server → Client: joinRoster acknowledgement. `team` is vestigial
	// (always 2); clients only use the message's arrival.
	teamAssigned: Schemas.Map({ team: Schemas.Int }),

	// Client → Server: cells melted / stomped by the sender since the last
	// flush. Sent at PAINT_TICK_HZ; the server writes the result into the
	// PaintTile CRDT. Not a state-sync channel.
	//
	// targetStage semantics:
	//   0 = full melt (torch lit). Cell becomes stage 0 unconditionally.
	//   1 = stomp / trample (torch unlit). Cell becomes stage 1 ONLY if
	//       it is currently at stage 2 or pristine. Cells at stage 0 or 1
	//       are left as-is.
	//
	// `cells` are integer snow cell keys (src/shared/snowGrid.ts cellKey).
	// Server trusts them; position validation is deferred anti-cheat work.
	// Rate limit: server drops messages over PAINT_TICK_MAX_IDS cells.
	paintTick: Schemas.Map({
		cells      : Schemas.Array(Schemas.Int),
		targetStage: Schemas.Int,
	}),

	// Client → Server (DEV only): melt `count` random unprotected cells to
	// reproduce playtest-scale snow load with a single player.
	devMeltBulk: Schemas.Map({ count: Schemas.Int }),

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

	// Build Your Own Fire (src/shared/ruleset.ts).
	// Client -> Server: light the log the player is CARRYING, in FRONT of them:
	// (x, z) = the player's feet and yaw = their facing (rad); the server derives
	// the spot with builtFireFrontSpot and validates it. The client already
	// cleared its carry slot; on refusal builtFireRejected returns it
	// (`kind` > 0 / carried=1 tells the client to restore it).
	builtFireCarriedRequest: Schemas.Map({
		seed: Schemas.Int,
		x   : Schemas.Number,
		z   : Schemas.Number,
		yaw : Schemas.Number,
		kind: Schemas.Int,
	}),
	// Server -> Client: slot `index` now holds a player-built fire at
	// (x, z). Sent before its fuel + hiddenCampfireState so clients move
	// the pit first. Also sent on join for every built fire.
	builtFirePlaced: Schemas.Map({
		seed : Schemas.Int,
		index: Schemas.Int,
		x    : Schemas.Number,
		z    : Schemas.Number,
	}),
	// Server -> Client: built slot the next build at the cap would
	// recycle (oldest extinguished), or -1. Sent on change + join.
	builtFireRecycleNext: Schemas.Map({
		seed : Schemas.Int,
		index: Schemas.Int,
	}),
	// Spent fires (src/server/hiddenCampfire.ts): a fire that ran out of fuel is cold ash,
	// never relightable, and removed SPENT_FIRE_REMOVE_S after it went out.
	// Server -> Client: slot `index` is spent; ageMs = how long ago it went out (joiners).
	fireSpent: Schemas.Map({
		seed : Schemas.Int,
		index: Schemas.Int,
		ageMs: Schemas.Int,
	}),
	// Server -> Client: slot `index` no longer holds any fire (spent timeout, or ash cleared by a new build).
	fireRemoved: Schemas.Map({
		seed : Schemas.Int,
		index: Schemas.Int,
	}),
	// Server -> Client (sender only): lighting refused; carried=1 means
	// give the log back. `reason` is a ruleset BuildFireVerdict.
	builtFireRejected: Schemas.Map({
		kind   : Schemas.Int,
		reason : Schemas.String,
		carried: Schemas.Int,
	}),

	// Server → Client: authoritative cycle state.
	//   seed                 — current run id (Schemas.Int, so generators
	//                          clamp to 1..0x7FFFFFFF; compare with
	//                          cycleSeedsEqual so a wrapped live id still
	//                          matches). Clients should treat THIS as
	//                          canonical instead of computing from local
	//                          Date.now(), so a peer with a skewed system
	//                          clock never disagrees about which cycle is
	//                          active.
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
		// Server session id (src/server/session.ts): one value per server
		// process start. A change means the server restarted and every piece
		// of client state from the old session is stale.
		session           : Schemas.Int,
	}),

	// Server -> Client: liveness + session id, broadcast every few seconds.
	// Lets an idle client notice a server restart (new session) or silence
	// without having to send a paintTick and wait for pleaseRejoin.
	serverBeat: Schemas.Map({
		session: Schemas.Int,
	}),

	// Client → Server: broadcast the local player's torch lit state and
	// remaining fuel fraction (0..1). `lit` is 0/1 Int for the same
	// Schemas.Boolean-over-the-wire caveat noted on hiddenCampfireState.
	// Sent on light/extinguish and on fuel steps so remote torch lights
	// can dim with remaining burn time.
	torchLit: Schemas.Map({
		lit     : Schemas.Int,
		fuelFrac: Schemas.Number,
	}),

	// Client → Server: request to light another player's torch by
	// touching torches. Sender must currently have a lit torch (server
	// verifies against its torchLitByUser cache). No proximity check
	// server-side — trust the client's geometry test for v1; the harm
	// ceiling is "someone's torch lit for free", not exploit-worthy.
	// On success, server flips the target's cached lit state and
	// broadcasts the standard torchLitFrom relay so every client
	// (including the target) sees the flame come on through the
	// existing pipe.
	chainLightRequest: Schemas.Map({
		targetUserId: Schemas.String,
	}),

	// Server → Client: relay of another player's torch lit state. The
	// server rebroadcasts every torchLit message it receives, tagged with
	// the sender's authenticated userId (context.from), and re-sends the
	// full known set to joiners so latecomers see everyone's flames from
	// the first frame. The receiver renders a torch model on that remote
	// avatar's right hand and toggles the flame visibility to match.
	torchLitFrom: Schemas.Map({
		userId  : Schemas.String,
		lit     : Schemas.Int,
		fuelFrac: Schemas.Number,
	}),

	// Server → Client: a log pile has appeared in the world. Broadcast
	// on drop (someone dropped a log), on initial spawn (server boot,
	// cycle roll), and rebroadcast to joiners as hydration. `id` is a
	// server-owned autoincrementing int, unique for the server's lifetime.
	logPileAdded: Schemas.Map({
		id  : Schemas.Int,
		// Schemas.Number (not Float) — Float payloads were arriving empty on
		// the client in this SDK build; Number rounds-trips reliably (same
		// choice as cycleState.nextRebuildEpochMs).
		x   : Schemas.Number,
		z   : Schemas.Number,
		kind: Schemas.Int,
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
	logPickupRequest: Schemas.Map({ id: Schemas.Int, py: Schemas.Float }),

	// Client → Server: I dropped my carried wood at world position
	// (x, z). `kind` is WOOD_KIND_LOG (the only wood kind) so the pile
	// GLB and a later pickup keep the same burn time. Server
	// unconditionally spawns a new pile with a fresh id and broadcasts
	// logPileAdded. Server does NOT track who is carrying (yet).
	logDropRequest: Schemas.Map({
		x   : Schemas.Number,
		z   : Schemas.Number,
		kind: Schemas.Int,
	}),

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
	woodPickupRequest: Schemas.Map({ seed: Schemas.Int, idx: Schemas.Int, py: Schemas.Float }),

	// Client -> Server: player fed a carried piece to a fire. `target`
	// selects which fire: -1 == main hearth, 0..HIDDEN_CAMPFIRE_COUNT-1
	// == the respective hidden bonfire. `kind` is WOOD_KIND_LOG; fuel seconds come from fuelSecondsForKind. The
	// server refuses a piece that would pass FUEL_MAX.
	feedFireRequest: Schemas.Map({
		target: Schemas.Int,
		kind  : Schemas.Int,
	}),

	// Client -> Server: a lit torch is passing its flame to a dead main
	// hearth. The server restores the Ember spark and leaves the torch
	// burning. Ignored while the hearth still has fuel.
	hearthSparkRequest: Schemas.Map({}),

	// Server -> Client: that feed was refused because the piece would
	// pass the cap. The sender puts the wood back in the F slot.
	feedFireRejected: Schemas.Map({
		kind: Schemas.Int,
	}),

	// Server -> Client: a feed landed. Everyone plays the wood-into-fire
	// arc. `userId` is the feeder; `target` is -1 (main) or a hidden pit
	// index; `kind` is always WOOD_KIND_LOG.
	feedFireFx: Schemas.Map({
		userId: Schemas.String,
		target: Schemas.Int,
		kind  : Schemas.Int,
	}),

	// Server -> Client: current main-hearth fuel in seconds. Broadcast
	// on significant change (delta > threshold, or tier crossed, or on
	// feed) and on joinRoster hydration. `players` is the current
	// player count baked into the packet so the client can render the
	// "xN" drain multiplier without a separate roster subscription.
	// Schemas.Number (not Float) — same wire bug as logPileAdded: Float
	// fields arrive empty on room.send in this SDK build, which left
	// clients stuck at the boot fuel and made the flame never grow/shrink.
	hearthFuelUpdate: Schemas.Map({
		fuel   : Schemas.Number,
		players: Schemas.Int,
	}),

	// Server -> Client: fuel snapshot for a hidden fire. `index` is the
	// hidden bonfire slot (0..HIDDEN_CAMPFIRE_COUNT-1). Same throttling
	// rules as hearthFuelUpdate. On snuff (fuel -> 0) the server also
	// broadcasts hiddenCampfireState with lit=false; the fuel-zero
	// packet immediately preceding it is the definitive "you saw it
	// dying" event.
	hiddenHearthFuelUpdate: Schemas.Map({
		index  : Schemas.Int,
		fuel   : Schemas.Number,
		players: Schemas.Int,
	}),

	// Server -> Client: the main hearth just hit FUEL_MAX from below.
	// One-shot celebration hook (audio, billboard flash, camera zap) -
	// re-arms once fuel drops below Roaring tier entry (450 s), so it
	// won't fire again until players work back up to full.
	hearthMax: Schemas.Map({}),

	// Server → Client: server didn't recognise a paintTick's sender.
	// Sent (rate-limited) when the sender's userId is not in the roster,
	// which happens if the server restarted mid-session and lost the
	// in-memory roster. Client responds by re-issuing joinRoster so the
	// player is transparently re-registered and paint resumes syncing.
	pleaseRejoin: Schemas.Map({}),

	// Client → Server (DEV only): force an immediate cycle rollover for
	// smoke-testing the reset flow before real midnight UTC arrives.
	// Gated on the client by devFlags.ENABLE_DEV_ROLL_CYCLE + the
	// button that emits it; server accepts unconditionally (no anti-
	// cheat here — this is a dev affordance, remove or gate before a
	// production deploy that exposes it to random visitors).
	devRollCycle: Schemas.Map({}),

	// Server → Client: authoritative day/night phase. Server owns the
	// clock; clients rebuild a local start time from phaseAgeSec.
	// Do NOT send Date.now() — Schemas.Number is too coarse at epoch-ms
	// scale (≈2 min steps) and a 60 s phase looks already finished.
	//   phaseName         — DAWN / DAY / DUSK / NIGHT (solstice names later)
	//   phaseIndex        — index in the daily table
	//   phaseAgeSec       — seconds already elapsed in this phase
	//   phaseDurationSec  — real seconds this phase lasts
	//   cycleId           — increments each full DAY→NIGHT wrap
	// Sent on join, on every phase change, and on a ~15 s heartbeat.
	phaseState: Schemas.Map({
		phaseName       : Schemas.String,
		phaseIndex      : Schemas.Int,
		phaseAgeSec     : Schemas.Number,
		phaseDurationSec: Schemas.Number,
		cycleId         : Schemas.Int,
	}),

	// Client → Server (DEV only): jump to the next daily phase now.
	devAdvancePhase: Schemas.Map({}),

	// Client → Server: this player just froze at x,z. They stay in the
	// living set until frostThaw, a rescue, or their presence heartbeat
	// goes quiet. userId is the fallback when the transport omits the
	// authenticated sender, which the preview does on some messages.
	frostFreeze: Schemas.Map({
		userId: Schemas.String,
		// Number not Float — Float xy arrived empty on room.send (see logPileAdded).
		x     : Schemas.Number,
		z     : Schemas.Number,
	}),

	// Server → Client: draw or remove the ice cube on `userId`.
	// frozen is 1 while they are locked, 0 once they are up. Sent to
	// everyone, and again to a joiner so they see cubes already in the world.
	// cue is 1 only on a fresh freeze, so a joiner does not hear the crack
	// for cubes that were already there.
	frostFrozen: Schemas.Map({
		userId: Schemas.String,
		x     : Schemas.Number,
		z     : Schemas.Number,
		frozen: Schemas.Int,
		cue   : Schemas.Int,
	}),

	// Client → Server: CRDT sync just came up. Republish snow so the
	// joiner does not keep the empty tile snapshot from before they
	// were listening.
	snowResync: Schemas.Map({}),

	// Client → Server: this player is moving again (thawed in place, or
	// woke at a fire). Clears them from the frozen set. userId is the
	// fallback when the transport omits the authenticated sender.
	frostThaw: Schemas.Map({
		userId: Schemas.String,
	}),

	// Client → Server: still in the scene. The server drops anyone who
	// goes quiet, so a disconnect does not count as a living player.
	// userId is the same fallback as frostFreeze. mobile is 1 on the
	// phone/tablet client so peers can nudge AvatarAttach ice height.
	frostPresence: Schemas.Map({
		userId: Schemas.String,
		mobile: Schemas.Int,
	}),

	// Server → Client: peer platform hint. mobile 1 = that wallet's
	// Explorer is a mobile client. Used only for remote ice Y nudge.
	playerPlatform: Schemas.Map({
		userId: Schemas.String,
		mobile: Schemas.Int,
	}),

	// Client → Server: a lit torch is on `userId`. `step` is how many
	// thirds have melted (only ever raised). `live` 0 means the torch
	// left; the server grows the cube back a third per second.
	frostMeltRequest: Schemas.Map({
		userId: Schemas.String,
		step  : Schemas.Int,
		live  : Schemas.Int,
	}),

	// Server → Client: the cube everyone should draw. step 0 is full
	// height, each later step drops the top by a third. live 1 means a
	// torch is on them right now, so their respawn clock is paused.
	frostMelt: Schemas.Map({
		userId: Schemas.String,
		step  : Schemas.Int,
		live  : Schemas.Int,
	}),

	// Client → Server: a lit torch held against `userId` long enough to
	// thaw them. The server checks they are actually frozen.
	frostRescue: Schemas.Map({
		userId: Schemas.String,
	}),

	// Server → Client: `userId` was thawed by another player. The frozen
	// client stands back up where they fell.
	frostRescued: Schemas.Map({
		userId: Schemas.String,
	}),

	// Client -> Server: the frozen player pressed "Give up and respawn".
	// The server checks they are frozen (and that a fire burns, the same
	// condition the ice timeout needs) and answers with frostGiveUpResult.
	frostGiveUp: Schemas.Map({
		userId: Schemas.String,
	}),

	// Server -> Client (sender only): ok 1 = run the normal ice-timeout
	// respawn now. ok 0 = refused (not frozen on the server, no fire lit,
	// or the run is ending); reason is for logs.
	frostGiveUpResult: Schemas.Map({
		userId: Schemas.String,
		ok    : Schemas.Int,
		reason: Schemas.String,
	}),

	// Server → Client: the run is over. Clients fade to black and hold
	// a game-over title. The server then rollCycles with a fresh seed
	// so a new winter starts. Fired by the dev snuff, and when every
	// still-connected player is frozen with every fire dark.
	emberFail: Schemas.Map({
		days: Schemas.Int,
	}),

	// Client → Server (DEV only): snuff every fire so we can playtest
	// the ember-fail / game-over path without waiting out the tank.
	devSnuffFires: Schemas.Map({}),

	// Client -> Server: click-activate an ignition station stump. seed
	// is the cycle seed (same pattern as hiddenCampfireIgnite). First
	// valid request wins; no tablet / wood cost.
	// Client -> Server: TEMPORARY debug - light all stations + thaw.
	// Ignored unless DEBUG_THAW_BUTTON (src/client/devFlags.ts) is true.
	debugThaw: Schemas.Map({ seed: Schemas.Int }),
	// Client -> Server: TEMPORARY debug - light the next unlit monument
	// (volcano thaw stage +1). Same DEBUG_THAW_BUTTON gate.
	debugVolcanoStage: Schemas.Map({ seed: Schemas.Int }),
	// Client -> Server (floating crystals): fire the ending ("Level Thaws") without 6 activations: every unreleased
	// monument is released silently, the finale starts FINALE_DEBUG_DELAY_S later. Ignored unless DEBUG_FINALE_BUTTON.
	debugFinale: Schemas.Map({ seed: Schemas.Int }),

	// Server -> Client: fire-network link (src/server/fireNetwork.ts). Ids:
	// 0 = hearth, i + 1 = hidden fire i. Clients route the same path from
	// the positions. state 1 = linked (ageMs since formed), 0 = breaking
	// (ageMs since broke; deadA / deadB = which end went out).
	// Shared feed burst: fire `from` was fed, `ids` got a share (incl. from if it did).
	fireNetworkShare: Schemas.Map({
		from: Schemas.Int,
		ids : Schemas.Array(Schemas.Int),
	}),

	fireLinkState: Schemas.Map({
		a    : Schemas.Int,
		b    : Schemas.Int,
		ax   : Schemas.Number,
		az   : Schemas.Number,
		bx   : Schemas.Number,
		bz   : Schemas.Number,
		state: Schemas.Int,
		ageMs: Schemas.Int,
		deadA: Schemas.Int,
		deadB: Schemas.Int,
	}),

	stationActivate: Schemas.Map({
		seed : Schemas.Int,
		index: Schemas.Int,
	}),

	// Server -> Client: station active flag. active is 0/1 Int (Boolean
	// over the wire is unreliable - see hiddenCampfireState). Sent on
	// activate and to joiners for hydration. Clients play grow/spin +
	// beam locally when active flips to 1.
	stationState: Schemas.Map({
		seed  : Schemas.Int,
		index : Schemas.Int,
		active: Schemas.Int,
		/** 1 = just ignited (play ignition SFX), 0 = hydration / echo / reset. */
		fresh : Schemas.Int,
		/** userId of the igniter on a fresh activation, '' otherwise. */
		by    : Schemas.String,
		/** Floating crystals: ms since the server released this crystal (oasis melt + regrowth clock), -1 = unknown / not released. */
		ageMs : Schemas.Int,
	}),

	// Server -> Client (floating-crystals ruleset): monument charge 0..1.
	// Broadcast as it changes (~4 Hz while charging) and to joiners.
	// Number, not Float (Float payloads arrive empty).
	monumentCharge: Schemas.Map({
		seed  : Schemas.Int,
		index : Schemas.Int,
		charge: Schemas.Number,
	}),

	// Client -> Server: the sender's lit torch melted one ice chunk of a
	// monument pit (src/shared/monumentIce.ts). seed = cycle seed, index
	// = station, chunk = chunk index. Idempotent; the server sets the bit,
	// clears the snow over the chunk and broadcasts monumentIceState.
	monumentIceMelt: Schemas.Map({
		seed : Schemas.Int,
		index: Schemas.Int,
		chunk: Schemas.Int,
	}),

	// Server -> Client: melted-chunk bitmask for one monument (bit i =
	// chunk i melted). Broadcast on change and on cycle reset, sent to
	// joiners for hydration. stationActivate is refused until full.
	monumentIceState: Schemas.Map({
		seed : Schemas.Int,
		index: Schemas.Int,
		mask : Schemas.Int,
	}),

	// Server -> Client: world thaw after all 3 stations. thawed 0/1.
	// Fired once per cycle; joiners hydrate so they see cleared snow +
	// lava + victory state. Clients also get weatherState CLEAR.
	worldThawState: Schemas.Map({
		seed  : Schemas.Int,
		thawed: Schemas.Int,
		// Day number (cycleId+1) the thaw happened on; 0 when not thawed.
		// Winter returns at the sunrise of day thawDay + POST_THAW_DAYS + 1.
		thawDay: Schemas.Int,
		// Volcano thaw stage 0..3 (= active monuments when accepted).
		stage    : Schemas.Int,
		// Current melt-wave step (thawWave.ts ThawSegment): radius goes
		// fromM -> toM metres over waveDurMs. waveAgeMs = ms since the
		// step started (server clock) at send time; negative while it
		// waits for the volcano beam to land. Clients and late joiners
		// place the wave by age.
		fromM    : Schemas.Number,
		toM      : Schemas.Number,
		waveAgeMs: Schemas.Int,
		waveDurMs: Schemas.Int,
	}),

	// Server -> Client (floating crystals): the ending after the last monument is released (src/shared/finale.ts).
	// running 0 = not started (cycle reset). first = monument index the ring (and the first beam) starts at (the last
	// one released). ageMs = ms since the finale START (server clock at send time), NEGATIVE while it is still to
	// begin; clients place beams / title by age, late joiners land on the finished state. fresh 1 = live broadcast.
	// The ring topology is NOT sent: both sides derive it from the monument layout (finaleEdges).
	crystalFinaleState: Schemas.Map({
		seed   : Schemas.Int,
		running: Schemas.Int,
		first  : Schemas.Int,
		ageMs  : Schemas.Int,
		fresh  : Schemas.Int,
	}),

	// Client -> Server: the sender's display name, for the leaderboard's
	// contributor list. Cosmetic only (server sanitises + caps it); the
	// wallet always comes from the authenticated sender. Re-sent after a
	// server restart.
	playerName: Schemas.Map({ name: Schemas.String }),

	// Server -> Client (floating-crystals ruleset): the fastest-completion
	// leaderboard. `json` is a JSON array of rows
	// { days, ms, at, names[], total } (src/shared/leaderboard.ts), at most
	// LEADERBOARD_SHOW rows, ranked best-first. Sent to joiners and
	// broadcast whenever it changes. Only the server writes records.
	leaderboardState: Schemas.Map({ json: Schemas.String }),
}

export const room = registerMessages(Messages)
