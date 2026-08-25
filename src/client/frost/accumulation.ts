/**
 * accumulation.ts — per-player frost accumulation + warmth recovery.
 *
 * Samples the local player's position at FROST_SAMPLE_INTERVAL_S,
 * reads the snow depth beneath them via src/client/paint's
 * getSnowStageAtWorld(), and pushes FrostLevel up or down accordingly.
 * Campfire proximity thaws; snow depth freezes; a lit torch (see
 * src/client/torch.ts::isTorchProtecting) halts accumulation without
 * granting recovery.
 *
 * Writes are debounced by FROST_WRITE_EPSILON so the CRDT doesn't
 * chatter every frame with sub-percent changes.
 *
 * No death handling here — this module only owns the number. The FSM
 * that plays the emote / fade / teleport lives in src/client/frost/death.ts.
 */

import { engine, Transform } from '@dcl/sdk/ecs'

import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z, CAMPFIRE_MELT_RADIUS_SQ_M } from 'src/shared/campfire'
import { getHiddenCampfireWarmthPositions, isHiddenCampfireLit } from 'src/client/hiddenCampfire'
import { getMainFireMeltRadiusSq } from 'src/client/hearthFuel'
import { FrostLevel } from 'src/shared/frost/components'
import {
	FROST_MAX,
	FROST_SAMPLE_INTERVAL_S,
	FROST_TIME_BASELINE_S,
	FROST_TIME_SNOW_STAGE_S,
	FROST_TIME_TO_THAW_S,
} from 'src/shared/frost/tuning'
import { playFrostChunkSfx } from 'src/client/audio'
import { getSnowStageAtWorld } from 'src/client/paint'
import { isTorchProtecting } from 'src/client/torch'


// MARK: Module state
// Local accumulator (float). We mirror it into the synced FrostLevel
// component whenever it drifts past FROST_WRITE_EPSILON to keep CRDT
// traffic quiet.
let sampleAccum      = 0
let frost            = 0
let lastWrittenFrost = 0
// Matches SEGMENT_COUNT in layer.frostBar.tsx. Kept as a local literal
// (instead of importing from a UI layer) so the accumulator has no
// downward dependency on the UI. Update both if the bar changes.
const FROST_BAR_SEGMENTS = 10
let lastChunkIndex = 0

// Any change bigger than this triggers a CRDT write. 0.5% chosen so a
// full 0->100 sweep produces ~200 writes over minutes, not thousands.
const FROST_WRITE_EPSILON = 0.5


// MARK: initFrostAccumulation
/**
 * Register the per-player frost accumulation system. Idempotent — call
 * once during client bootstrap. Creates the FrostLevel component on the
 * local player entity if missing.
 */
export function initFrostAccumulation(): void {
	if (!FrostLevel.has(engine.PlayerEntity)) {
		FrostLevel.create(engine.PlayerEntity, { value: 0 })
	}
	frost = 0
	lastWrittenFrost = 0
	sampleAccum = 0

	engine.addSystem((dt: number) => {
		sampleAccum += dt
		if (sampleAccum < FROST_SAMPLE_INTERVAL_S) return
		const step = sampleAccum
		sampleAccum = 0

		const t = Transform.getOrNull(engine.PlayerEntity)
		if (t === null) return
		const { x, y, z } = t.position

		// ── Warmth first: fire trumps snow every time ─────────────
		const dx = x - CAMPFIRE_WORLD_X
		const dz = z - CAMPFIRE_WORLD_Z
		// Main hearth's warm ring now grows/shrinks with fuel (see
		// hearthFuel.ts). getMainFireMeltRadiusSq() returns the current
		// squared radius; it's clamped so the main fire never drops below
		// tier 3 (8 m == the historic CAMPFIRE_MELT_RADIUS_M). Fed above
		// tier 3 it can reach ~17 m at Roaring.
		const mainMeltRSq = getMainFireMeltRadiusSq()
		let insideFire = dx * dx + dz * dz <= mainMeltRSq
		// Hidden second campfire also thaws once it's been lit. Same
		// melt radius as the central bonfire so both fires feel like
		// equivalent survival anchors.
		if (!insideFire && isHiddenCampfireLit()) {
			// Iterate every lit hidden bonfire — the player is warmed if
			// they're inside ANY warm ring. Loop is cheap (<= 3 entries)
			// and short-circuits on the first hit.
			// Per-pit dynamic warmth radius (grows with fuel tier), matching
			// the main hearth's behaviour. Was previously a static
			// CAMPFIRE_MELT_RADIUS_SQ_M, which under-served maxed-out hidden
			// pits (visible melt ring > warmth ring).
			const hps = getHiddenCampfireWarmthPositions()
			for (const hp of hps) {
				const hdx = x - hp.x
				const hdz = z - hp.z
				if (hdx * hdx + hdz * hdz <= hp.radiusSq) {
					insideFire = true
					break
				}
			}
		}
		if (insideFire) {
			// Inside the fire's warm ring: linear thaw. Fire trumps torch
			// AND snow — nothing accumulates while you're being actively
			// warmed by the campfire.
			frost -= (FROST_MAX / FROST_TIME_TO_THAW_S) * step
			if (frost < 0) frost = 0
		} else {
			// Two independent contributions summed. Torch cancels the
			// baseline term only; snow still chills even a torch-carrier
			// wading through deep drifts.
			let ratePerSec = 0

			if (!isTorchProtecting()) {
				ratePerSec += FROST_MAX / FROST_TIME_BASELINE_S
			}

			const stage    = getSnowStageAtWorld(x, y, z) as 0 | 1 | 2 | 3
			const stageTtf = FROST_TIME_SNOW_STAGE_S[stage]
			if (stageTtf !== Number.POSITIVE_INFINITY) {
				ratePerSec += FROST_MAX / stageTtf
			}

			if (ratePerSec > 0) {
				frost += ratePerSec * step
				if (frost > FROST_MAX) frost = FROST_MAX
			}
		}
		// Play the frost SFX only when a new blue chunk fills on the bar
		// (edge trigger on the visible segment index). Ambient wading
		// through shallow snow that never fills a full segment stays
		// silent — the cue is reserved for perceptible progress toward
		// freezing. Chunks can also DECREASE (thaw); we only fire on
		// the upward edge.
		const chunkIndex = Math.floor((frost / FROST_MAX) * FROST_BAR_SEGMENTS)
		if (chunkIndex > lastChunkIndex) playFrostChunkSfx()
		lastChunkIndex = chunkIndex

		// Debounced CRDT write.
		if (Math.abs(frost - lastWrittenFrost) >= FROST_WRITE_EPSILON) {
			FrostLevel.createOrReplace(engine.PlayerEntity, { value: frost })
			lastWrittenFrost = frost
		}
	})
}


// MARK: resetFrostLocal
/**
 * Zero the local accumulator AND the synced component. Called by the
 * death FSM on wake so the player doesn't immediately re-freeze from
 * the same 100% value the accumulator still holds internally.
 */
export function resetFrostLocal(): void {
	frost            = 0
	lastWrittenFrost = 0
	lastChunkIndex   = 0
	FrostLevel.createOrReplace(engine.PlayerEntity, { value: 0 })
}


// MARK: getFrostLocal
/**
 * Read the local accumulator directly. Faster than a CRDT round-trip
 * and useful for the HUD, which repaints every frame.
 */
export function getFrostLocal(): number {
	return frost
}
