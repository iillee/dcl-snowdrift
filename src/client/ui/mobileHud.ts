/**
 * mobileHud.ts - layout numbers of the mobile (touch) HUD, shared by the top row (layer.frostBar), the round top buttons
 * (layer.brushSize) and the overview zoom stack (layer.topDownZoom). Desktop never reads them.
 *
 * Reference canvas: mobile landscape 1600 x 720 (ui/utils/sizing.ts).
 */

/**
 * Left padding (px) of the top HUD row on mobile: clears DCL's own avatar + chat icons in the top-left corner (~260 px from the screen
 * edge, the row's layer starts at 5 % = 80 px) so mute / star / ? / frost bar start right of them. With 3 round buttons the frost bar
 * ends up centred near the screen centre, which is where the expedition chip / button sit (layer.expeditionCountdown).
 */
export const MOBILE_TOP_ROW_INSET = 190

/** Round top buttons (mute, star, ?): same 72 px footprint as the desktop squares, fully round. */
export const MOBILE_ROUND_BTN = 72

/**
 * Right-side column, one vertical line of equally spaced round buttons above the native jump button. Bottom to top: the EYE (view change; our
 * own UI button, the native view slot is hidden, so it can sit exactly above jump), then, while the overview is on, rotate, zoom out (-),
 * zoom in (+). Every button is MOBILE_STACK_BTN with MOBILE_STACK_GAP between, so all 4 are equally spaced.
 */
export const MOBILE_STACK_BTN           = 72
export const MOBILE_STACK_GAP           = 24
/** Right edge distance of the column: its centre sits over the jump button's centre. */
export const MOBILE_STACK_MARGIN_RIGHT  = 152
/** Eye bottom edge above the screen bottom: clears the native jump button (top ~ 200 px up) with a ~ 36 px gap. */
export const MOBILE_EYE_MARGIN_BOTTOM   = 238
/** Stack bottom edge = eye top + one gap. */
export const MOBILE_STACK_MARGIN_BOTTOM = MOBILE_EYE_MARGIN_BOTTOM + MOBILE_STACK_BTN + MOBILE_STACK_GAP

/** "VIEW MAP" pill (mobile replacement for the native hand on the summit map table): left of the eye column, level with the eye. */
export const MOBILE_MAP_BTN_H            = 56
export const MOBILE_MAP_MARGIN_RIGHT     = 270
export const MOBILE_MAP_MARGIN_BOTTOM    = MOBILE_EYE_MARGIN_BOTTOM
export const MOBILE_MAP_BTN_W            = 190
