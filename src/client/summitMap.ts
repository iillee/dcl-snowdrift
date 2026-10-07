/**
 * summitMap.ts — open/close state for the summit map UI popup.
 *
 * Knowledge-only: no station gating. Opened by clicking the world map
 * table; closed via the UI Close button (or toggle).
 */

import { playUiClick } from 'src/client/audio'


let open = false


export function isSummitMapOpen(): boolean {
	return open
}


export function openSummitMap(): void {
	if (open) return
	open = true
	playUiClick()
	console.log('summitMap: open')
}


export function closeSummitMap(): void {
	if (!open) return
	open = false
	playUiClick()
	console.log('summitMap: close')
}


export function toggleSummitMap(): void {
	if (open) closeSummitMap()
	else openSummitMap()
}
