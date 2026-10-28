/**
 * layer.topDownZoom.tsx — mobile zoom / rotate cluster, active only in top-down mode.
 *
 * The camera has no manual pan / drag any more (removed on desktop and mobile): the view follows the
 * player, so this layer only draws the mobile zoom + / - and rotate buttons. Desktop zoom / rotate
 * live beside the eye in the top HUD (layer.brushSize.tsx).
 */

import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { playUiClick } from 'src/client/audio'
import { canZoomIn, canZoomOut, isTopDownActive, rotateView, zoomIn, zoomOut } from 'src/client/topDownCamera'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, borderRadius } = UI_THEME

const PANEL_BG = colors.statsBg
const WHITE    = Color4.White()

// Zoom cluster, anchored right of centre above the native mobile help / eye / jump row (bottom 340).
const ZOOM_BTN           = 60
const ZOOM_GAP           = 24
const ZOOM_MARGIN_RIGHT  = 140
const ZOOM_MARGIN_BOTTOM = 340
const ZOOM_GLYPH_BAR     = 4
const ZOOM_GLYPH_LEN     = 24

// MARK: ZoomButton
/**
 * One overhead zoom step. Grayed at the altitude limit so the button
 * stays put and a dead tap does nothing.
 */
function ZoomButton(props: {
	kind   : 'in' | 'out'
	enabled: boolean
	keyId  : string
}) {
	const bg = props.enabled
		? PANEL_BG
		: Color4.create(PANEL_BG.r, PANEL_BG.g, PANEL_BG.b, PANEL_BG.a * 0.4)
	const tint = props.enabled ? WHITE : Color4.create(1, 1, 1, 0.4)
	return (
		<UiEntity
			key = {props.keyId}
			uiTransform = {{
				width         : ZOOM_BTN,
				height        : ZOOM_BTN,
				justifyContent: 'center',
				alignItems    : 'center',
				borderRadius  : borderRadius.md,
			}}
			uiBackground = {{ color: bg }}
			onMouseDown = {() => {
				if (!props.enabled) return
				playUiClick()
				if (props.kind === 'in') zoomIn()
				else                     zoomOut()
			}}
		>
			<ZoomGlyph kind = {props.kind} color = {tint} />
		</UiEntity>
	)
}


// MARK: ZoomGlyph
/** Chunky + or - built from two bars. */
function ZoomGlyph(props: { kind: 'in' | 'out'; color: Color4 }) {
	return (
		<UiEntity
			uiTransform = {{
				width         : ZOOM_GLYPH_LEN,
				height        : ZOOM_GLYPH_LEN,
				justifyContent: 'center',
				alignItems    : 'center',
			}}
		>
			<UiEntity
				uiTransform = {{
					positionType: 'absolute',
					width       : ZOOM_GLYPH_LEN,
					height      : ZOOM_GLYPH_BAR,
				}}
				uiBackground = {{ color: props.color }}
			/>
			{props.kind === 'in' && (
				<UiEntity
					uiTransform = {{
						positionType: 'absolute',
						width       : ZOOM_GLYPH_BAR,
						height      : ZOOM_GLYPH_LEN,
					}}
					uiBackground = {{ color: props.color }}
				/>
			)}
		</UiEntity>
	)
}


// MARK: ZoomCluster
/** + - and rotate in a row. */
function ZoomCluster() {
	return (
		<UiEntity
			uiTransform = {{
				positionType : 'absolute',
				position     : { right: ZOOM_MARGIN_RIGHT, bottom: ZOOM_MARGIN_BOTTOM },
				flexDirection: 'row',
				alignItems   : 'center',
			}}
		>
			<ZoomButton kind = "in"  enabled = {canZoomIn()}  keyId = "zoom_in" />
			<UiEntity uiTransform = {{ width: ZOOM_GAP }} />
			<ZoomButton kind = "out" enabled = {canZoomOut()} keyId = "zoom_out" />
			<UiEntity uiTransform = {{ width: ZOOM_GAP }} />
			<UiEntity
				key = "rotate_view"
				uiTransform = {{ width: ZOOM_BTN, height: ZOOM_BTN, justifyContent: 'center', alignItems: 'center', borderRadius: borderRadius.md }}
				uiBackground = {{ color: PANEL_BG }}
				onMouseDown = {() => { playUiClick(); rotateView(1) }}
			>
				{/* Rotate icon ported from dcl-pixelwars (overview_rotate.png). */}
				<UiEntity uiTransform = {{ width: ZOOM_GLYPH_LEN, height: ZOOM_GLYPH_LEN, pointerFilter: 'none' }} uiBackground = {{ textureMode: 'stretch', texture: { src: 'assets/images/overview_rotate.png' }, color: WHITE }} />
			</UiEntity>
		</UiEntity>
	)
}


// MARK: TopDownZoomLayer
/** Mobile-only zoom / rotate cluster. Renders nothing while the overview is off or on desktop. */
class TopDownZoomLayer extends Layer {
	constructor() {
		super({
			id  : 'topDownZoom',
			zone: ZoneType.FullScreen,
		})
	}

	body() {
		if (!isTopDownActive() || !isMobile()) return null
		return (
			<UiEntity
				key = "ui_TopDownZoom_root"
				uiTransform={{
					width        : '100%',
					height       : '100%',
					pointerFilter: 'none',
				}}
			>
				<ZoomCluster />
			</UiEntity>
		)
	}
}


export const topDownZoomLayer = new TopDownZoomLayer()
