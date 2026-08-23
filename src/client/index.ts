/**
 * client.ts — client runtime orchestrator.
 *
 * Wires the client-side modules together in a controlled boot order and
 * registers the two top-level systems (seed watcher, first-joiner init)
 * that don't belong to any single feature module.
 *
 * All heavy lifting lives in its natural home:
 *   - client/maze/*                  — maze data, generation, visuals
 *   - client/paint                   — grid painting + coverage
 *   - client/clientHandler           — network boundary (room.on/send)
 *   - client/audio                   — music + UI SFX
 *   - client/ui/*                    — HUD layers + theme (React-ECS)
 *
 * Kept in this file (for now):
 *   - Composite lever-entity scrubber (removes a decorative composite entity)
 *   - Seed watcher (SeedHolder → rebuildMaze)
 *   - First-joiner init (roll seed if none is synced after grace period)
 *
 * These will move to client/index.ts in a future commit alongside a
 * proper waitForLoad gate (sky-chaser pattern).
 */

import { engine } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import {
	SeedHolder,
	seedHolder,
} from 'src/shared/components'
import { SEED_NETWORK_ID } from 'src/shared/paintGrid'

import { initAudio } from 'src/client/audio'
import { initHelpPanelHotkey } from 'src/client/ui/layers/layer.helpPanel'
import { initClientHandler } from 'src/client/clientHandler'
import { CELL, STEP, lookupTile } from 'src/shared/maze/generator'
import { initFrostAccumulation } from 'src/client/frost/accumulation'
import { initFrostFlash }        from 'src/client/frost/frostFlash'
import { setupFrostDeath }       from 'src/client/frost/death'
import { initLocomotionGate } from 'src/client/locomotion'
import { initMazeNet, rebuildMaze } from 'src/client/maze/rebuild'
import { initPaintNet, initPaintingSystem } from 'src/client/paint'
import { initPlayerNet } from 'src/client/player'
import { runStress } from 'src/client/stress'
import { setupCampfire } from 'src/client/campfire'
import { setupCycleClient } from 'src/client/cycle'
import { setupCampfireSmoke } from 'src/client/campfireSmoke'
import { setupLogsClient } from 'src/client/logs'
import { setupLogsInput } from 'src/client/logsInput'
import { setupWoodClient } from 'src/client/wood'
import { setupHiddenCampfire } from 'src/client/hiddenCampfire'
import { setupSnowFootsteps } from 'src/client/snowFootsteps'
import { setupSnowfall } from 'src/client/snowfall'
import {
	clearPerimeter,
	getReservedPlayfieldCells,
	hasPerimeterSpawned,
	setPerimeterSeed,
	setupPerimeter,
} from 'src/client/perimeter'
import { setupProps } from 'src/client/props/spawn'
// Skybox forced cycle is intentionally not imported — see the disabled
// setupSkybox() call in setupClient() for the rationale.
// import { setupSkybox } from 'src/client/skybox'
import { setupSnowfallAudio } from 'src/client/snowfallAudio'
import { setupRemoteTorches } from 'src/client/remoteTorches'
import { setupTorch } from 'src/client/torch'
import { setupTorchInput } from 'src/client/torchInput'
import { setupTouchControls } from 'src/client/touchControls'
import { setupUi } from 'src/client/ui'
import { setupTopDownCamera } from 'src/client/topDownCamera'
import { dragPollSystem } from 'src/client/ui/layers/layer.topDownPan'

// ─── Stress-test toggle (Squareoff design §8.1) ─────────────────────
// Set to 0 for normal maze. Non-zero = spawn N planes at spawn, skip maze.
// Try: 5000, 15000, 30000. Read fps from the floating text at spawn.
const STRESS_COUNT = 0

// ─── Seed watcher ───────────────────────────────────────────────────
// Reacts to any change in the synced seed (set by first-joiner init or by
// the server's roundReset message) and rebuilds the maze.
let currentSeed = 0
engine.addSystem(() => {
  const s = SeedHolder.get(seedHolder).seed
  if (s !== 0 && s !== currentSeed) {
    currentSeed = s
    // Perimeter cliffs share the seed too, so every reroll produces a
    // fresh skyline. Set the seed FIRST — both rebuildMaze() (via
    // getReservedPlayfieldCells) and setupPerimeter() read it. On the
    // very first seed we skip the respawn: setupPerimeter is fired by
    // the deferred bootstrap below (asset-load priority hack).
    setPerimeterSeed(s)
    if (hasPerimeterSpawned()) {
      clearPerimeter()
      setupPerimeter()
    }
    rebuildMaze(s)
    // Props scatter uses the same reserved-cell set as the maze so
    // trees / huts / etc never land on perimeter cliffs. clearProps
    // is a no-op on the first seed; on rerolls the reroll button has
    // already cleared them, but calling here too keeps the flow
    // idempotent for any future non-UI seed change (server-driven,
    // scheduled rotation, etc.).
    const reserved = new Set<string>(
      getReservedPlayfieldCells().map(c => `${c.tx},${c.tz},0`)
    )
    setupProps(s, reserved)
  }
})

// ─── First-joiner initialization ────────────────────────────────────
// If we've been in-scene for a grace period and the synced seed is still 0,
// nobody has ever set it — we're the first player. Roll a seed from the
// UTC round index so the scene isn't empty forever. Subsequent joiners
// will receive the current seed via CRDT sync before their grace elapses
// and skip this path.
let initTimer = 0
let initDone = false
const INIT_GRACE = 1.5 // seconds
engine.addSystem((dt: number) => {
  if (initDone) return
  initTimer += dt
  if (initTimer < INIT_GRACE) return
  initDone = true
  if (SeedHolder.get(seedHolder).seed === 0) {
    // No rounds anymore — pick any deterministic non-zero seed. Server
    // may still push its own seed via CRDT; whichever arrives wins.
    const s = 1
    console.log(`No existing maze seed after ${INIT_GRACE}s — initializing with round index ${s}`)
    SeedHolder.createOrReplace(seedHolder, { seed: s })
  }
})

// ─── setupClient — boot sequence ────────────────────────────────────
export async function setupClient(): Promise<void> {
	if (STRESS_COUNT > 0) { runStress(STRESS_COUNT); return }
	initAudio()
	initHelpPanelHotkey()

	// Composite-lever scrubber. The scene's main.composite still contains a
	// decorative lever entity from an earlier iteration where pulling it
	// regenerated the maze. UTC-boundary rounds + server roundReset replaced
	// that flow entirely, but removing the entity from the composite would
	// disturb interdependent asset-packs data — so we remove it at runtime.
	// Every entity carrying an asset-packs::States component (only the lever,
	// in practice) is deleted on boot along with its descendants.
	engine.addSystem(() => {
	const statesComp = engine.getComponentOrNull('asset-packs::States')
	if (!statesComp) return
		for (const [entity] of engine.getEntitiesWith(statesComp)) {
			engine.removeEntity(entity)
		}
	})

	// Painting system needs a callback to resolve player world position →
	// the tile they're standing on. lookupTile lives in the generator
	// module (private grid access).
	initPaintingSystem(CELL, STEP, lookupTile)

	// Wire event subscribers + CRDT paint observers. PaintCoverage /
	// PaletteEntry / PaintCell / LeaderboardState are server-owned
	// (syncEntity only on the server); clients observe replicas.
	// Server-authoritative 24 h cycle clock. Register the listener BEFORE
	// initClientHandler so we don't miss the hydration `cycleState` that
	// arrives immediately after joinRoster.
	setupCycleClient()

	initPaintNet()
	initMazeNet()
	initPlayerNet()
	initLocomotionGate()
	initFrostAccumulation()
	initFrostFlash()
	setupFrostDeath()

	// Wood-log network handlers must register BEFORE initClientHandler
	// so the initial logPileAdded broadcast (sent by the server as part
	// of joinRoster hydration) is caught. Same rule as setupCycleClient
	// above.
	setupLogsClient()
	setupWoodClient()

	// Register the network boundary LAST so `room.onMessage` subscribers
	// above are all in place before the first message can arrive.
	initClientHandler()

	// TRANSITIONAL (Phase 4 Step 6): SeedHolder is still client-authored.
	// Auth-server skill wants server-only syncEntity for singletons — move
	// seed ownership to the server, then remove this client syncEntity.
	syncEntity(seedHolder, [SeedHolder.componentId], SEED_NETWORK_ID)
	// Maze construction is fully event-driven from here: the seed watcher
	// above builds the maze the moment a non-zero seed arrives.

	// Finally, setup the UI
	// Create the top-down VirtualCamera entity (inactive until the HUD
	// button toggles it on). Safe to call before setupUi — the button just
	// needs the camera entity to exist when it's first clicked.
	setupTopDownCamera()
	// Desktop drag pan poll — reads PrimaryPointerInfo.screenDelta each
	// frame while a drag is live and forwards to the camera. Cheap no-op
	// when top-down is inactive.
	engine.addSystem(dragPollSystem)

	// Skybox forced cycle is disabled — the dusk→night sweep felt too fast
	// even at 30 min per round trip, so we let DCL's default sky run. The
	// `setupSkybox()` module (and its `releaseSkyboxLock()` unwind) is
	// preserved in `src/client/skybox.ts` behind this call site; re-enable
	// by uncommenting once we have a much slower cadence or a parked-at-
	// dusk fixed value.
	// setupSkybox()

	// Campfire + its VFX/audio come FIRST so they claim the initial
	// asset-load bandwidth. The player spawns next to the fire and needs
	// it visible on the first frame; perimeter cliffs are large 4x-scale
	// GLBs at scene edges that the player won't see for several seconds
	// of walking.
	setupCampfire()
	setupCampfireSmoke()
	setupLogsInput()
	// Second, buried campfire the player has to find + light with a
	// torch. Deterministic position per 24 h cycle; no server sync yet.
	setupHiddenCampfire()
	setupSnowfall()
	// Audio requires initAudio() to have already run (camera entity is
	// used as the parent). initAudio is called upstream in setupClient.
	setupSnowfallAudio()
	setupSnowFootsteps()
	setupTorch()
	setupTorchInput()
	setupRemoteTorches()

	// Hide the native mobile `E` / `F` on-screen buttons before UI mounts —
	// the mobile action layer renders scene-branded replacements.
	setupTouchControls()
	setupUi()

	// Perimeter cliffs — scaled maze tile GLBs wrapping the interior
	// playfield. Deferred by PERIMETER_SPAWN_DELAY_S so campfire, maze
	// centre ring, and player-spawn assets get first crack at the asset
	// loader. The player will not see the cliffs until they walk far
	// enough that the maze centre is comfortably resolved anyway.
	const PERIMETER_SPAWN_DELAY_S = 3
	let perimAccum = 0
	let perimDone  = false
	engine.addSystem((dt: number) => {
		if (perimDone) return
		perimAccum += dt
		if (perimAccum < PERIMETER_SPAWN_DELAY_S) return
		perimDone = true
		setupPerimeter()
	})
}
