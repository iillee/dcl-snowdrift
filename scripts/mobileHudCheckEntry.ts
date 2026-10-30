/**
 * mobileHudCheck - the mobile (touch) HUD layout, desktop untouched:
 *  - native slots: E / F, slots 1-4 (desktop keys: 4 eye, 3 rotate, 2 zoom out, 1 zoom in) and the pointer hand (IA_POINTER) are hidden on touch; no mobile input dispatch is left;
 *    the hand's two users keep a mobile path (cinematic SKIP label / jump, VIEW MAP button at the summit table);
 *  - top row: mute, star (floating crystals), ? are on-screen ROUND buttons on mobile, in that order, left of the frost bar, the row starts
 *    right of DCL's avatar + chat icons; desktop (square buttons, centred, 160 px nudge) is unchanged;
 *  - right side: ONE column above jump, equally spaced round buttons: top to bottom zoom in (+), zoom out (-), rotate (overview only), then our own
 *    EYE (toggleTopDownCamera, yellow while the overview is on);
 *  - geometry on the 1600 x 720 mobile canvas: nothing overlaps the avatar / chat icons, the stack, the NEW EXPEDITION chip / button or the
 *    bottom hotbar (LIGHT TORCH bar), and the stack stays above the eye / jump column and on screen.
 * Bundled by scripts/mobileHudCheck.mjs.
 */
import { readFileSync } from 'node:fs'

import {
	MOBILE_EYE_MARGIN_BOTTOM, MOBILE_MAP_BTN_W, MOBILE_MAP_MARGIN_BOTTOM, MOBILE_MAP_MARGIN_RIGHT,
	MOBILE_ROUND_BTN, MOBILE_STACK_BTN, MOBILE_STACK_GAP, MOBILE_STACK_MARGIN_BOTTOM, MOBILE_STACK_MARGIN_RIGHT, MOBILE_TOP_ROW_INSET,
} from 'src/client/ui/mobileHud'

const g0 = globalThis as { __realLog?: typeof console.log }
g0.__realLog ??= console.log
const say = g0.__realLog
console.log = () => {}
let bad = 0
const fail = (m: string): void => { bad++; if (bad <= 40) say('FAIL ' + m) }
const code = (p: string): string => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// ---------- native slots ----------
{
	const t = code('src/client/touchControls.ts')
	const hidden = (a: string): boolean => new RegExp(`inputAction: InputAction\\.${a},\\s*hide: true`).test(t)
	for (const a of ['IA_PRIMARY', 'IA_SECONDARY', 'IA_ACTION_3', 'IA_ACTION_4', 'IA_ACTION_5', 'IA_ACTION_6', 'IA_POINTER']) if (!hidden(a)) fail(a + ' is not hidden on touch')
	if (/hide\s*:\s*false/.test(t)) fail('a native action button is still shown')
	if (/inputSystem|toggleMusic|toggleHelpPanel|toggleLeaderboardPanel|addSystem/.test(t)) fail('a mobile input dispatch for the hidden slots is left in touchControls.ts')
	// the hand's users still work on mobile
	const cin = code('src/client/obeliskCinematic.ts')
	if (!/IA_JUMP, PointerEventType\.PET_DOWN/.test(cin)) fail('the cinematic no longer skips on jump (mobile path)')
	const cl = code('src/client/ui/layers/layer.cinematic.tsx')
	if (!/value\s*=\s*"SKIP"/.test(cl) || !/onMouseDown = \{\(\) => \{ if \(isCinematicSkippable\(\)\) skipObeliskCinematic\(\) \}\}/.test(cl)) fail('the on-screen SKIP label of the cinematic is gone')
	const z = code('src/client/ui/layers/layer.topDownZoom.tsx')
	if (!/nearMapTable\(\) && <MapButton \/>/.test(z) || !/onMouseDown = \{\(\) => openSummitMap\(\)\}/.test(z) || !/isNearSummitTable\(p\.x, p\.y, p\.z\)/.test(z)) fail('no mobile VIEW MAP button for the summit map table')
	const st = code('src/client/summitMapTable.ts')
	if (!/export function isNearSummitTable/.test(st) || !/tableSpot = null/.test(st) || !/tableSpot = \{ x: seat\.x/.test(st)) fail('summitMapTable does not expose its reach for the VIEW MAP button')
	if (!/CLICK_MAX_DIST_M/.test(st.slice(st.indexOf('export function isNearSummitTable')))) fail('VIEW MAP reach differs from the pointer reach')
}

// ---------- top row ----------
{
	const f = code('src/client/ui/layers/layer.frostBar.tsx')
	if (/!mobile && <(MuteButton|LeaderboardButton|HelpButton)/.test(f) || /!mobile && isFloatingCrystals\(\) && <LeaderboardButton/.test(f)) fail('mute / star / ? are still desktop-only')
	const iM = f.indexOf('<MuteButton />'), iL = f.indexOf('<LeaderboardButton />'), iH = f.indexOf('<HelpButton />'), iB = f.indexOf('ui_FrostBar_border')
	if (!(iM > 0 && iM < iL && iL < iH && iH < iB)) fail('top row order is not mute, star, ?, frost bar')
	{
		const bb = code('src/client/ui/layers/layer.brushSize.tsx')
		for (const name of ['MuteButton', 'LeaderboardButton', 'HelpButton']) {
			const seg = bb.slice(bb.indexOf(`export function ${name}()`)).split('\n}\n')[0]
			if (!/borderWidth\s*:\s*hudBorderW\(\)/.test(seg) || !/borderColor\s*:\s*hudBorderColor\(\)/.test(seg) || !/color: hudBg\(\)/.test(seg)) fail(name + ' does not use the shared mobile / desktop look')
		}
	}
	if (!/isFloatingCrystals\(\) && <LeaderboardButton \/>/.test(f)) fail('the star must stay floating-crystals only')
	if (!/\{ width: '100%', padding: \{ left: MOBILE_TOP_ROW_INSET \}, margin: \{ top \} \}/.test(f) || !/justifyContent: mobile \? 'flex-start' : 'center'/.test(f)) fail('mobile top row does not start left of centre with the DCL-icon inset')
	if (!/\{ margin: \{ top, left: 160 \} \}/.test(f)) fail('desktop top row nudge changed')
	if (/!mobile && <SpectatorButton/.test(f) === false) fail('the desktop eye / zoom cluster is no longer desktop-only (mobile uses the native eye)')
	const b = code('src/client/ui/layers/layer.brushSize.tsx')
	for (const name of ['MuteButton', 'LeaderboardButton', 'HelpButton']) {
		const seg = b.slice(b.indexOf(`export function ${name}()`)).split('\n}\n')[0]
		if (!/borderRadius\s*:\s*hudRadius\(\)/.test(seg)) fail(name + ' is not round on mobile')
	}
	if (!/function hudRadius\(\)\s*: number\s*\{ return isMobile\(\) \? MOBILE_SQ_RADIUS : borderRadius\.md \}/.test(b)) fail('hudRadius is not mobile-only')
	// rounded-edge squares in the frost bar's frame style (same radius, border width / colour and fill as layer.frostBar), desktop look unchanged
	const fb = code('src/client/ui/layers/layer.frostBar.tsx')
	const num = (src: string, name: string): string => new RegExp(`const ${name}\\s*=\\s*([^\\n]+)`).exec(src)?.[1].trim() ?? '?'
	if (num(b, 'MOBILE_SQ_RADIUS') !== num(fb, 'RADIUS_OUTER_MB')) fail('mobile button radius differs from the frost bar frame')
	if (num(b, 'MOBILE_SQ_BORDER_W') !== num(fb, 'BORDER_WHITE_W')) fail('mobile button border width differs from the frost bar frame')
	if (num(b, 'MOBILE_SQ_BORDER') !== num(fb, 'COL_BORDER_WHITE')) fail('mobile button border colour differs from the frost bar frame')
	if (num(b, 'MOBILE_SQ_BG') !== num(fb, 'COL_BORDER_MB')) fail('mobile button fill differs from the frost bar frame')
	if (!/function hudBorderW\(\)\s*: number\s*\{ return isMobile\(\) \? MOBILE_SQ_BORDER_W : TORCH_BORDER_W \}/.test(b) || !/isMobile\(\) \? MOBILE_SQ_BORDER : TORCH_BORDER_OFF/.test(b) || !/isMobile\(\) \? MOBILE_SQ_BG : PANEL_BG/.test(b)) fail('desktop button border / fill changed')

}

// ---------- right column ----------
{
	const z = code('src/client/ui/layers/layer.topDownZoom.tsx')
	if (!/flexDirection: 'column'/.test(z)) fail('the right column is not vertical')
	const iI = z.indexOf('keyId = "zoom_in"'), iO = z.indexOf('keyId = "zoom_out"'), iR = z.indexOf('key = "rotate_view"'), iE = z.indexOf('<EyeButton active')
	if (!(iI > 0 && iI < iO && iO < iR && iR < iE)) fail('column order is not zoom in (+), zoom out (-), rotate, eye (top to bottom)')
	if ((z.match(/ZOOM_BTN \/ 2/g) ?? []).length < 3) fail('column buttons are not all round')
	if (!/if \(!isMobile\(\)\) return null/.test(z)) fail('the column is not mobile-only')
	const ov = (z.match(/props\.overview &&/g) ?? []).length
	if (ov < 6) fail('zoom / rotate are not limited to the overview')
	const eye = /function EyeButton[\s\S]*?\n}\n/.exec(z)?.[0] ?? ''
	if (!/toggleTopDownCamera\(\)/.test(eye) || !/props\.active \? GOLD : WHITE/.test(eye)) fail('the eye does not toggle the overview / turn yellow when active')
	if (!/<EyeButton active = \{props\.overview\} \/>/.test(z)) fail('the eye is not driven by the overview state')
	const gaps = (z.match(/height: ZOOM_GAP/g) ?? []).length
	if (gaps !== 3) fail(`${gaps} gaps in the column (want 3: equal spacing between 4 buttons)`)
	const tdc = code('src/client/topDownCamera.ts')
	// Desktop number keys (pixelwars layout): 4 = eye (always), 3 = rotate, 2 = zoom out, 1 = zoom in (only while the overview is on); desktop only.
	const keyAt = tdc.indexOf('if (!isMobile()) {', tdc.indexOf('engine.addSystem((dt: number)'))
	const keyBlock = keyAt < 0 ? '' : tdc.slice(keyAt, tdc.indexOf('if (active) updateCamera', keyAt))
	if (!keyBlock) fail('the desktop number-key block (if (!isMobile())) is missing in topDownCamera.ts')
	if (!/IA_ACTION_6, PointerEventType\.PET_DOWN\)\) \{[^}]*toggleTopDownCamera\(\)/.test(keyBlock)) fail('desktop key 4 no longer toggles the view')
	const gated = keyBlock.slice(keyBlock.indexOf('if (active) {') + 1)
	if (!keyBlock.includes('if (active) {')) fail('keys 1 / 2 / 3 are not limited to the overview')
	if (!/IA_ACTION_5, PointerEventType\.PET_DOWN\)\) \{[^}]*rotateView\(1\)/.test(gated)) fail('desktop key 3 does not rotate the overview (only while it is on)')
	if (!/IA_ACTION_4, PointerEventType\.PET_DOWN\) && canZoomOut\(\)\) \{[^}]*zoomOut\(\)/.test(gated)) fail('desktop key 2 does not zoom out (only while the overview is on)')
	if (!/IA_ACTION_3, PointerEventType\.PET_DOWN\) && canZoomIn\(\)\) \{[^}]*zoomIn\(\)/.test(gated)) fail('desktop key 1 does not zoom in (only while the overview is on)')
	// Mute, star and ? have no key; nothing else may listen to the number keys.
	for (const f of ['src/client/audio.ts', 'src/client/ui/layers/layer.leaderboard.tsx', 'src/client/ui/layers/layer.helpPanel.tsx', 'src/client/index.ts'])
		if (/IA_ACTION_|Hotkey/.test(code(f))) fail(`${f} still binds a number key (mute, star and ? are click only)`)
	// Key badges: the four overview buttons, desktop only (KeyHintBadge returns null on mobile; the mobile column has none).
	const bs = code('src/client/ui/layers/layer.brushSize.tsx')
	if (!/function KeyHintBadge[\s\S]*?if \(isMobile\(\)\) return null/.test(bs)) fail('the key badge is not desktop only')
	for (const k of ['4', '3']) if (!new RegExp(`<KeyHintBadge label="${k}" bold />`).test(bs)) fail(`no key badge "${k}" on the eye / rotate button`)
	if (!/<KeyHintBadge label=\{props\.kind === 'in' \? '1' : '2'\} bold \/>/.test(bs)) fail('no key badges 1 / 2 on the zoom buttons')
	if (/KeyHintBadge/.test(z)) fail('the mobile column must not show key badges')
	// Desktop top-row icons: one shared scale (0.85), mobile keeps the design size.
	if (!/DESKTOP_ICON_SCALE = 0\.85\b/.test(bs) || !/function hudIcon\(px: number\): number \{ return isMobile\(\) \? px : /.test(bs)) fail('desktop icon scale / mobile passthrough (hudIcon) is missing')
	if ((bs.match(/hudIcon\(/g) ?? []).length < 10) fail('not all seven top-row icons go through hudIcon')
}

// ---------- geometry (1600 x 720 mobile canvas; layer box = 90 % wide at 5 %) ----------
{
	const W = 1600, H = 720
	const layerLeft = W * 0.05
	const btnPitch = MOBILE_ROUND_BTN + 16 // 8 px margin each side
	const rowLeft = layerLeft + MOBILE_TOP_ROW_INSET
	const barW = 10 * 44 + 9 * 6 + 16 + 12 // frame + border
	const rowRight = rowLeft + 3 * btnPitch + 8 + barW + 8
	const barCentre = rowLeft + 3 * btnPitch + 8 + barW / 2
	const DCL_ICONS_RIGHT = 262 // avatar + chat icons end (markup: ~130 px of an 850 px wide phone frame, canvas scale 1.9)
	if (rowLeft + 8 < DCL_ICONS_RIGHT + 8) fail(`first button at ${rowLeft + 8} px touches DCL's avatar / chat icons (to ~${DCL_ICONS_RIGHT})`)
	if (rowRight > W - 400) fail(`top row ends at ${rowRight} px, too far right (overview stack / native cluster live at the right)`)
	if (Math.abs(barCentre - W / 2) > 60) fail(`frost bar centre ${barCentre} drifted from the screen centre ${W / 2} (the expedition chip / button are centred)`)
	// expedition chip / button: centred, widest ~ 360 px, below the row
	const expLeft = W / 2 - 180, expRight = W / 2 + 180
	const colLeft = W - MOBILE_STACK_MARGIN_RIGHT - MOBILE_STACK_BTN, colRight = W - MOBILE_STACK_MARGIN_RIGHT
	const pitch = MOBILE_STACK_BTN + MOBILE_STACK_GAP
	// y measured up from the screen bottom: eye, rotate, zoom out, zoom in
	const bottoms = [0, 1, 2, 3].map((i) => MOBILE_EYE_MARGIN_BOTTOM + i * pitch)
	if (MOBILE_STACK_MARGIN_BOTTOM !== bottoms[1]) fail('the stack does not start one gap above the eye')
	for (let i = 1; i < 4; i++) if (bottoms[i] - bottoms[i - 1] !== pitch) fail('the 4 column buttons are not equally spaced')
	const colTop = bottoms[3] + MOBILE_STACK_BTN
	if (colTop > H - 4) fail(`the column top (${colTop} px up) leaves the screen (${H} px)`)
	// jump button (native): ~ 154 px wide, centre ~ 198 px from the right, top ~ 202 px up (markup); the eye sits over it, clear of it
	const JUMP_CX = W - 198, JUMP_TOP = 202
	if (MOBILE_EYE_MARGIN_BOTTOM < JUMP_TOP + 20) fail('the eye touches the jump button')
	if (Math.abs((colLeft + colRight) / 2 - JUMP_CX) > 24) fail('the eye / column is not centred over the jump button')
	if (expRight > colLeft) fail('the expedition button / chip reaches the right column')
	if (colLeft < rowRight + 20) fail('the column overlaps the top row horizontally')
	// VIEW MAP pill: left of the column, above the jump button, right of the bottom hotbar
	const mapRight = W - MOBILE_MAP_MARGIN_RIGHT, mapLeft = mapRight - MOBILE_MAP_BTN_W
	if (mapRight > colLeft - 20) fail('VIEW MAP touches the eye column')
	if (MOBILE_MAP_MARGIN_BOTTOM < JUMP_TOP + 20) fail('VIEW MAP touches the jump button')
	if (mapLeft < W / 2 + 260) fail('VIEW MAP reaches the bottom hotbar (LIGHT TORCH bar)')
	if (W / 2 + 260 > colLeft) fail('the bottom hotbar reaches the right column')
	// touch size
	if (MOBILE_ROUND_BTN < 64 || MOBILE_STACK_BTN < 64) fail('buttons are smaller than the tap size of the existing mobile buttons')
}

// ---------- mobile zoom steps ----------
{
	const tdc = code('src/client/topDownCamera.ts')
	const mob = /MOBILE_ZOOM_SCALES\s*=\s*\[([^\]]*)\]/.exec(tdc)?.[1].split(',').map((x) => Number(x.trim())) ?? []
	if (mob.join(',') !== '5,11.67,18.33,25') fail(`mobile zoom steps are [${mob.join(', ')}], want [5, 11.67, 18.33, 25]`)
	if (mob[0] !== 5 || mob[mob.length - 1] !== 25) fail('the nearest (5) / farthest (25) mobile zoom changed')
	for (let k = 2; k < mob.length; k++) if (Math.abs((mob[k] - mob[k - 1]) - (mob[1] - mob[0])) > 0.02) fail('mobile zoom steps are not evenly spaced')
	if (!/DESKTOP_ZOOM_SCALES\s*=\s*\[7, 29, 60,/.test(tdc)) fail('desktop zoom steps changed')
	// the +/- logic walks whatever table is latched: simulate it on the real table
	let i = 0
	const out = (): boolean => i < mob.length - 1, inn = (): boolean => i > 0
	const seen = [mob[0]]
	while (out()) { i++; seen.push(mob[i]) }
	if (seen.join(',') !== '5,11.67,18.33,25' || out()) fail('zoom out does not walk all 4 steps')
	while (inn()) { i-- }
	if (i !== 0 || inn()) fail('zoom in does not walk back to the closest step')
	if (!/export function canZoomIn\(\): boolean \{ return active && zoomIndex > 0 \}/.test(tdc) || !/zoomIndex < zoomTable\(\)\.length - 1/.test(tdc)) fail('canZoomIn / canZoomOut are not table-length based')
	if (!/const next = zoomIndex \+ dir[\s\S]*?next < 0 \|\| next >= table\.length\) return/.test(tdc)) fail('stepZoom is not bounded by the table')
	if (!/const i = mobile \? 0 : table\.indexOf\(DESKTOP_ZOOM_DEFAULT\)/.test(tdc)) fail('mobile no longer opens at its closest step')
}

// ---------- leaderboard heading on mobile ----------
{
	const l = code('src/client/ui/layers/layer.leaderboard.tsx')
	if (!/const heading = mobile \? 'Leaderboard' : LEADERBOARD_HEADING/.test(l)) fail('mobile leaderboard heading is not just "Leaderboard" (desktop must keep LEADERBOARD_HEADING)')
	if (/value\s*=\s*\{LEADERBOARD_HEADING\}/.test(l) || /LEADERBOARD_HEADING \?/.test(l)) fail('the leaderboard panel still uses LEADERBOARD_HEADING directly')
	if (!/titleH = heading \? TITLE_H \+ GAP : 0/.test(l)) fail('panel height ignores the heading row')
}

say(bad === 0 ? 'mobileHudCheck: OK' : `mobileHudCheck: ${bad} FAILURES`)
if (bad) process.exitCode = 1