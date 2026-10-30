/**
 * torchHealth.ts - pure rules for "is the hand torch really there?" (no engine imports, so scripts/torchWatchdogCheck.mjs can drive them).
 *
 * The local torch (torch.ts) and every remote torch (remoteTorches.ts) are built once: an anchor entity riding the right-hand bone
 * (AvatarAttach) with a log GLB child. Nothing in the Explorer promises that survives the cold open: a GLB load can fail or stall
 * under asset contention (campfire.ts has the same retry), an AvatarAttach created before the avatar exists may never bind, and an
 * avatar rebuild (profile / wearables finishing late) can drop the attach. torch.ts reads a TorchProbe of the live entities every
 * TORCH_WATCHDOG_S and asks decideTorchHeal what to repair; the same rules run on remote torches (their avatarId must be the peer's).
 */

/** How often the watchdog looks at the torch (s). */
export const TORCH_WATCHDOG_S        = 1.5
/** A GLB still LOADING / UNKNOWN after this long is recreated (same as campfire.ts GLB_STUCK_MS). */
export const TORCH_GLB_STUCK_MS      = 8000
/** Minimum gap between two GLB recreations (ms). */
export const TORCH_GLB_RETRY_MS      = 2000
/** Attach to the local avatar without waiting for it after this long (s), so a missing avatar signal can never leave the hand empty. */
export const TORCH_ATTACH_MAX_WAIT_S = 5
/** One confirmation re-bind this long after the first attach (s): a bind made while the avatar was still loading may not stick. */
export const TORCH_CONFIRM_REBIND_S  = 2.5
/** One watchdog log line per this many ms (further repairs are counted and reported with the next line). */
export const TORCH_LOG_GAP_MS        = 10000

export type TorchGlbState = 'none' | 'loading' | 'finished' | 'failed'

/** What torch.ts / remoteTorches.ts can see of one torch rig right now. */
export interface TorchProbe {
	/** '' = the local player (AvatarAttach must OMIT avatarId); otherwise the lowercased wallet it must carry. */
	expectAvatarId  : string
	/** Anchor and tip entities still exist (Transform present). */
	anchorAlive     : boolean
	tipAlive        : boolean
	/** AvatarAttach on the anchor, or null when missing. */
	attach          : { anchorPoint: number; avatarId: string | undefined } | null
	expectAnchor    : number
	/** The tip's Transform.parent is the anchor. */
	tipParentIsAnchor: boolean
	/** GltfContainer on the tip: its src, or null when missing. */
	glbSrc          : string | null
	expectGlbSrc    : string
	glbState        : TorchGlbState
	/** ms since the GltfContainer was (re)created. */
	glbAgeMs        : number
	/** ms since the last watchdog recreation of it. */
	sinceGlbRetryMs : number
	/** VisibilityComponent on the tip is not false. */
	visible         : boolean
	/** The tip scale is still the authored non-zero scale. */
	scaleOk         : boolean
}

export type TorchHealAction = 'rebuild' | 'attach' | 'reparent' | 'glb' | 'show'

export interface TorchVerdict {
	actions: TorchHealAction[]
	/** Short, log-friendly reasons (same order as the repairs). */
	reasons: string[]
}


// MARK: shouldAttachNow
/**
 * The local AvatarAttach waits until the avatar is known (Transform + wallet + avatar profile on engine.PlayerEntity), but never
 * longer than TORCH_ATTACH_MAX_WAIT_S since the torch was built.
 */
export function shouldAttachNow(avatarReady: boolean, sinceBuildS: number): boolean {
	return avatarReady || sinceBuildS >= TORCH_ATTACH_MAX_WAIT_S
}


// MARK: decideTorchHeal
/** What to repair so the torch is on the hand (empty actions = healthy). */
export function decideTorchHeal(p: TorchProbe): TorchVerdict {
	const actions: TorchHealAction[] = []
	const reasons: string[] = []
	const add = (a: TorchHealAction, why: string): void => { if (!actions.includes(a)) actions.push(a); reasons.push(why) }

	// A removed entity cannot be patched: rebuild the whole rig (the caller tears down what is left).
	if (!p.anchorAlive || !p.tipAlive) {
		add('rebuild', !p.anchorAlive ? 'anchor entity gone' : 'model entity gone')
		return { actions, reasons }
	}

	if (p.attach === null) add('attach', 'AvatarAttach missing')
	else {
		if (p.attach.anchorPoint !== p.expectAnchor) add('attach', `AvatarAttach on anchor ${p.attach.anchorPoint}, want ${p.expectAnchor}`)
		const want = p.expectAvatarId === '' ? undefined : p.expectAvatarId
		if (p.attach.avatarId !== want) {
			// '' (empty) on the local avatar is the classic silent no-bind; a stale / foreign id on a remote one pins the torch to the wrong body.
			add('attach', `AvatarAttach avatarId ${p.attach.avatarId === undefined ? 'unset' : p.attach.avatarId === '' ? 'empty' : p.attach.avatarId}, want ${want === undefined ? 'unset' : want}`)
		}
	}

	if (!p.tipParentIsAnchor) add('reparent', 'model not parented to the anchor')

	if (p.glbSrc === null) add('glb', 'GltfContainer missing')
	else if (p.glbSrc !== p.expectGlbSrc) add('glb', `GltfContainer src ${p.glbSrc}`)
	else if (p.sinceGlbRetryMs >= TORCH_GLB_RETRY_MS) {
		if (p.glbState === 'failed') add('glb', 'GLB load failed')
		else if (p.glbState === 'loading' && p.glbAgeMs >= TORCH_GLB_STUCK_MS) add('glb', `GLB still loading after ${Math.round(p.glbAgeMs / 1000)} s`)
	}

	if (!p.visible) add('show', 'model hidden')
	else if (!p.scaleOk) add('show', 'model scale lost')

	return { actions, reasons }
}


// MARK: TorchLogGate
/** Rate limiter for the watchdog's log line: at most one per TORCH_LOG_GAP_MS; the repairs in between are counted. */
export class TorchLogGate {
	private lastMs = -Infinity
	private pending = 0
	total = 0

	/** Count one repair; returns the number of repairs this log line covers, or 0 when the line is suppressed. */
	note(nowMs: number): number {
		this.total++
		this.pending++
		if (nowMs - this.lastMs < TORCH_LOG_GAP_MS) return 0
		this.lastMs = nowMs
		const n = this.pending
		this.pending = 0
		return n
	}
}