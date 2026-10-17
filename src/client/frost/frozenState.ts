/**
 * frozenState.ts - tiny dependency-free flags the frost death FSM
 * publishes each frame, so input handlers and HUD layers can react to
 * a freeze without importing death.ts (which imports them; a cycle).
 */

let itemsBlocked   = false
let giveUpVisible  = false
let giveUpHandler: (() => void) | null = null


// MARK: isItemInputBlocked
/**
 * True while the player is in the ice cube (or the respawn fade that
 * follows). E and F item actions and the item buttons are off.
 */
export function isItemInputBlocked(): boolean {
	return itemsBlocked
}


// MARK: isGiveUpVisible
/** True while the "Give up and respawn" button should be on screen. */
export function isGiveUpVisible(): boolean {
	return giveUpVisible
}


// MARK: requestGiveUp
/** Button tap / F press. No-op unless the button is showing. */
export function requestGiveUp(): void {
	if (!giveUpVisible || !giveUpHandler) return
	giveUpHandler()
}


// MARK: setFrozenFlags
/** Written by frost/death.ts only. */
export function setFrozenFlags(blocked: boolean, giveUp: boolean): void {
	itemsBlocked  = blocked
	giveUpVisible = giveUp
}


// MARK: setGiveUpHandler
/** Written by frost/death.ts only. */
export function setGiveUpHandler(fn: () => void): void {
	giveUpHandler = fn
}
