/**
 * movementLock.ts - a tiny flag other systems set to stop the local player walking / running / jumping for a while
 * (the campfire emote). locomotion.ts folds it into its InputModifier profile (and re-applies it on stage changes), so the
 * lock survives the snow-stage re-apply and never fights it. Camera look is unaffected (no disableAll).
 */
let locked = false

export function isMovementLocked(): boolean { return locked }
export function setMovementLocked(on: boolean): void { locked = on }