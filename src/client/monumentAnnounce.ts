/**
 * monumentAnnounce.ts — shared monument-ignition announcement.
 *
 * - Caption "<name> ignites an ancient monument" in the bottom letterbox bar
 *   while the cinematic runs, lingering CAPTION_LINGER_S after it closes
 *   (finish or skip), so skippers still read it.
 * - When the cinematic has fully closed (bars gone), the help panel opens for
 *   HELP_AUTO_CLOSE_S, then closes unless the player interacted with it.
 * - Players who did not get the cinematic (frozen, dying, covered) still get
 *   the help panel once the world is visible, but no caption.
 */

import { engine } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'

import { isMonumentCinematicActive, setCinematicCloseListener } from 'src/client/monumentCinematic'
import { isWorldCovered } from 'src/client/ui/layers/layer.loadingSplash'
import { autoOpenHelpPanel } from 'src/client/ui/layers/layer.helpPanel'


// MARK: Tuning
/** Seconds the caption stays after the cinematic ends or is skipped. */
export const CAPTION_LINGER_S   = 4
/** Caption fade-out at the end of the linger (s). */
export const CAPTION_FADE_S     = 0.8
/** Seconds the auto-opened help panel stays before closing itself. */
export const HELP_AUTO_CLOSE_S  = 6
/** Fallback name when the igniter has no display name. */
const FALLBACK_NAME = 'A survivor'


// MARK: State
let caption        = ''
let captionName    = ''
let inCine         = false
let lingerUntilMs  = 0
let helpPending    = false
let installed      = false


// MARK: igniterName
/** Display name for `userId` (empty = local player). Short address or fallback. */
export function igniterName(userId: string): string {
	const p = userId ? getPlayer({ userId }) : getPlayer()
	const name = (p?.name ?? '').trim()
	if (name) return name
	const id = (userId || p?.userId || '').trim()
	if (id.startsWith('0x') && id.length > 10) return `${id.slice(0, 6)}…${id.slice(-4)}`
	return FALLBACK_NAME
}


// MARK: announceIgnition
/** Call when the cinematic starts for this viewer. */
export function announceCinematic(name: string): void {
	install()
	captionName = name.replace(/[<>]/g, '') // no stray rich-text tags from names
	caption = `${captionName} ignites an ancient monument`
	inCine  = true
	lingerUntilMs = 0
	helpPending = false
}

/** No cinematic for this viewer (frozen / covered): just queue the help panel. */
export function announceWithoutCinematic(): void {
	install()
	helpPending = true
}


// MARK: getCaption
/** Caption text + alpha (0 = hidden). */
export function getIgnitionCaption(): { text: string; name: string; rest: string; alpha: number } {
	const rest = ' ignites an ancient monument'
	if (!caption) return { text: '', name: '', rest: '', alpha: 0 }
	if (inCine) return { text: caption, name: captionName, rest, alpha: 1 }
	const left = (lingerUntilMs - Date.now()) / 1000
	if (left <= 0) return { text: '', name: '', rest: '', alpha: 0 }
	return { text: caption, name: captionName, rest, alpha: Math.min(1, left / CAPTION_FADE_S) }
}


function install(): void {
	if (installed) return
	installed = true
	setCinematicCloseListener((aborted) => {
		if (!inCine) return
		inCine = false
		if (aborted) { caption = ''; helpPending = false; return }
		lingerUntilMs = Date.now() + CAPTION_LINGER_S * 1000
		helpPending = true
	})
	engine.addSystem(() => {
		if (!helpPending) return
		if (inCine || isMonumentCinematicActive() || isWorldCovered()) return
		helpPending = false
		autoOpenHelpPanel(HELP_AUTO_CLOSE_S)
	})
}
