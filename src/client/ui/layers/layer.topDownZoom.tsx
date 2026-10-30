/**
 * layer.topDownZoom.tsx - mobile right-side column above the jump button (numbers: ui/mobileHud.ts).
 *
 * Bottom to top: the EYE (our own round UI button; the native view slot is hidden) which toggles the overhead view exactly like key 1 on desktop
 * and is YELLOW while the view is on; then, only while the view is on, rotate, zoom out (-), zoom in (+). All round, equally spaced, one column.
 * Also the small VIEW MAP button next to it while the player stands at the summit map table (mobile has no native pointer button any more).
 * The camera has no manual pan / drag. Desktop keeps its zoom / rotate beside the eye in the top HUD (layer.brushSize.tsx).
 */

import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { playUiClick } from 'src/client/audio'
import { Transform, engine } from '@dcl/sdk/ecs'
import { Label } from '@dcl/sdk/react-ecs'
import { isSummitMapOpen, openSummitMap } from 'src/client/summitMap'
import { isNearSummitTable } from 'src/client/summitMapTable'
import { canZoomIn, canZoomOut, isTopDownActive, rotateView, toggleTopDownCamera, zoomIn, zoomOut } from 'src/client/topDownCamera'
import { UI_THEME } from 'src/client/ui/theme/settings'
import {
	MOBILE_EYE_MARGIN_BOTTOM, MOBILE_MAP_BTN_H, MOBILE_MAP_BTN_W, MOBILE_MAP_MARGIN_BOTTOM, MOBILE_MAP_MARGIN_RIGHT,
	MOBILE_STACK_BTN, MOBILE_STACK_GAP, MOBILE_STACK_MARGIN_RIGHT,
} from 'src/client/ui/mobileHud'


const { colors } = UI_THEME

const PANEL_BG = colors.statsBg
const WHITE    = Color4.White()

// Zoom stack, right side, directly above the native view (eye) button which sits above the jump button (mobileHud.ts).
const ZOOM_BTN           = MOBILE_STACK_BTN
const ZOOM_GAP           = MOBILE_STACK_GAP
const ZOOM_MARGIN_RIGHT  = MOBILE_STACK_MARGIN_RIGHT
const ZOOM_MARGIN_BOTTOM = MOBILE_EYE_MARGIN_BOTTOM // the column is anchored by its bottom (the eye), so the stack opens upward without moving it
const GOLD               = Color4.create(1.00, 0.80, 0.30, 1)
const EYE_ICON_SRC       = 'assets/images/eye.png'
const EYE_ICON_W         = 48
const EYE_ICON_H         = 32
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
				borderRadius  : ZOOM_BTN / 2,
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


// MARK: EyeButton
/** View change: toggles the overhead view (same call as key 1); the icon is yellow while the view is on. */
function EyeButton(props: { active: boolean }) {
	return (
		<UiEntity
			key = "mobile_eye"
			uiTransform = {{ width: ZOOM_BTN, height: ZOOM_BTN, justifyContent: 'center', alignItems: 'center', borderRadius: ZOOM_BTN / 2 }}
			uiBackground = {{ color: PANEL_BG }}
			onMouseDown = {() => { playUiClick(); toggleTopDownCamera() }}
		>
			<UiEntity
				uiTransform = {{ width: EYE_ICON_W, height: EYE_ICON_H, pointerFilter: 'none' }}
				uiBackground = {{ textureMode: 'stretch', texture: { src: EYE_ICON_SRC }, color: props.active ? GOLD : WHITE }}
			/>
		</UiEntity>
	)
}


// MARK: ZoomColumn
/** One column, top to bottom: zoom in (+), zoom out (-), rotate (overview only), then the eye. */
function ZoomColumn(props: { overview: boolean }) {
	return (
		<UiEntity
			uiTransform = {{
				positionType : 'absolute',
				position     : { right: ZOOM_MARGIN_RIGHT, bottom: ZOOM_MARGIN_BOTTOM },
				flexDirection: 'column',
				alignItems   : 'center',
			}}
		>
			{props.overview && <ZoomButton kind = "in"  enabled = {canZoomIn()}  keyId = "zoom_in" />}
			{props.overview && <UiEntity key = "gap_in"  uiTransform = {{ height: ZOOM_GAP }} />}
			{props.overview && <ZoomButton kind = "out" enabled = {canZoomOut()} keyId = "zoom_out" />}
			{props.overview && <UiEntity key = "gap_out" uiTransform = {{ height: ZOOM_GAP }} />}
			{props.overview && (
				<UiEntity
					key = "rotate_view"
					uiTransform = {{ width: ZOOM_BTN, height: ZOOM_BTN, justifyContent: 'center', alignItems: 'center', borderRadius: ZOOM_BTN / 2 }}
					uiBackground = {{ color: PANEL_BG }}
					onMouseDown = {() => { playUiClick(); rotateView(1) }}
				>
					{/* Rotate icon ported from dcl-pixelwars (overview_rotate.png). */}
					<UiEntity uiTransform = {{ width: ZOOM_GLYPH_LEN, height: ZOOM_GLYPH_LEN, pointerFilter: 'none' }} uiBackground = {{ textureMode: 'stretch', texture: { src: 'assets/images/overview_rotate.png' }, color: WHITE }} />
				</UiEntity>
			)}
			{props.overview && <UiEntity key = "gap_rot" uiTransform = {{ height: ZOOM_GAP }} />}
			<EyeButton active = {props.overview} />
		</UiEntity>
	)
}


// MARK: MapButton
/** Mobile stand-in for the native hand at the summit map table: opens the same map popup as the pointer click. */
function MapButton() {
	return (
		<UiEntity
			key = "mobile_viewMap"
			uiTransform = {{
				positionType  : 'absolute',
				position      : { right: MOBILE_MAP_MARGIN_RIGHT, bottom: MOBILE_MAP_MARGIN_BOTTOM },
				width         : MOBILE_MAP_BTN_W,
				height        : MOBILE_MAP_BTN_H,
				justifyContent: 'center',
				alignItems    : 'center',
				borderRadius  : MOBILE_MAP_BTN_H / 2,
			}}
			uiBackground = {{ color: GOLD }}
			onMouseDown = {() => openSummitMap()}
		>
			<Label value = "VIEW MAP" fontSize = {22} color = {Color4.Black()} font = "sans-serif" textAlign = "middle-center" uiTransform = {{ width: '100%', height: MOBILE_MAP_BTN_H }} />
		</UiEntity>
	)
}


/** Player standing within reach of the summit map table and the popup closed. */
function nearMapTable(): boolean {
	const p = Transform.getOrNull(engine.PlayerEntity)?.position
	return p !== undefined && !isSummitMapOpen() && isNearSummitTable(p.x, p.y, p.z)
}


// MARK: TopDownZoomLayer
/** Mobile-only: eye (always), zoom / rotate stack (overview on), VIEW MAP (at the table). Renders nothing on desktop. */
class TopDownZoomLayer extends Layer {
	constructor() {
		super({
			id  : 'topDownZoom',
			zone: ZoneType.FullScreen,
		})
	}

	body() {
		if (!isMobile()) return null
		return (
			<UiEntity
				key = "ui_TopDownZoom_root"
				uiTransform={{
					width        : '100%',
					height       : '100%',
					pointerFilter: 'none',
				}}
			>
				<ZoomColumn overview = {isTopDownActive()} />
				{nearMapTable() && <MapButton />}
			</UiEntity>
		)
	}
}


export const topDownZoomLayer = new TopDownZoomLayer()
