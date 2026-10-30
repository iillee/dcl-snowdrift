/**
 * layer.cinematic.tsx — letterbox bars for the obelisk cinematic.
 *
 * Two full-width black bars (CINE_BAR_FRAC of the screen height each)
 * slide in from the top / bottom edges over CINE_BAR_SLIDE_S when the
 * cinematic starts and back out when it releases. A plain SKIP label in
 * the bottom bar ends it early (tap on mobile; no <b> in clickable text).
 * Gameplay HUD layers are hidden meanwhile by hideDuringCinematic (ui/index).
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { getCinematicBarFrac, isCinematicSkippable, skipObeliskCinematic } from 'src/client/obeliskCinematic'
import { getIgnitionCaption } from 'src/client/obeliskAnnounce'

/** Caption font and the min bottom strip (px) kept while it lingers after the bars leave. */
const CAPTION_FONT    = 26
const CAPTION_STRIP_H = 72
/** Igniter name colour: the UI's warm gold (GOLD in layer.brushSize / COL_WARM in layer.frostBar, rgb 1.00 0.80 0.30). */
const CAPTION_NAME_HEX = 'FFCC4D'

/** Name in gold via a rich-text colour tag; alpha baked into the tag so the fade covers both parts. */
function captionRich(name: string, rest: string, alpha: number): string {
	if (!name) return rest
	const aa = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0').toUpperCase()
	return `<color=#${CAPTION_NAME_HEX}${aa}>${name}</color>${rest}`
}


// MARK: CinematicLayer
class CinematicLayer extends Layer {
	constructor() {
		super({
			id  : 'cinematic',
			zone: ZoneType.FullScreen,
		})
	}


	// MARK: body
	body() {
		const frac = getCinematicBarFrac()
		const pct  = `${(frac * 100).toFixed(2)}%` as `${number}%`
		const cap  = getIgnitionCaption()
		const capOn = cap.alpha > 0
		return (
			<UiEntity
				key         = "ui_Cinematic_root"
				uiTransform = {{
					width        : '100%',
					height       : '100%',
					display      : frac > 0 || capOn ? 'flex' : 'none',
					flexDirection: 'column',
					justifyContent: 'space-between',
					pointerFilter: 'none',
				}}
			>
				<UiEntity
					key          = "ui_Cinematic_top"
					uiTransform  = {{ width: '100%', height: pct, pointerFilter: 'none' }}
					uiBackground = {{ color: Color4.create(0, 0, 0, 1) }}
				/>
				<UiEntity
					key          = "ui_Cinematic_bottom"
					uiTransform  = {{
						width         : '100%',
						height        : frac > 0 ? pct : CAPTION_STRIP_H,
						flexDirection : 'row',
						justifyContent: 'flex-end',
						alignItems    : 'center',
						pointerFilter : 'none',
					}}
					uiBackground = {{ color: Color4.create(0, 0, 0, frac > 0 ? 1 : cap.alpha) }}
				>
					<Label
						key         = "ui_Cinematic_caption"
						value       = {captionRich(cap.name, cap.rest, cap.alpha)}
						fontSize    = {CAPTION_FONT}
						color       = {Color4.create(1, 1, 1, cap.alpha)}
						textAlign   = "middle-center"
						uiTransform = {{ positionType: 'absolute', width: '100%', height: '100%', pointerFilter: 'none' }}
					/>
					<Label
						key         = "ui_Cinematic_skip"
						value       = "SKIP"
						fontSize    = {22}
						color       = {Color4.create(1, 1, 1, isCinematicSkippable() ? 0.75 : 0)}
						uiTransform = {{
							margin       : { right: 32 },
							padding      : { left: 16, right: 16, top: 8, bottom: 8 },
							pointerFilter: isCinematicSkippable() ? 'block' : 'none',
						}}
						onMouseDown = {() => { if (isCinematicSkippable()) skipObeliskCinematic() }}
					/>
				</UiEntity>
			</UiEntity>
		)
	}
}


export const cinematicLayer = new CinematicLayer()
