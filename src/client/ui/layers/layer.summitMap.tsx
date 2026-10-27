/**
 * layer.summitMap.tsx — full-screen engraved stone world map popup.
 *
 * No text at all (reads as an ancient artifact): no title, legend or
 * north marker; a bare X closes it.
 *
 * Opened from the summit map table. North = world +Z (top of map),
 * east = world +X (right). Knowledge only — Close to dismiss.
 *
 * Station marks turn red once that monument is lit (read every render).
 * Flat black-and-white engraving: volcano ▲, spawn ○, stations ✕.
 * No world borders, groves, or color terrain.
 */

import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { closeSummitMap, isSummitMapOpen } from 'src/client/summitMap'
import { isStationLit } from 'src/client/stationMarkers'
import { alpha } from 'src/client/ui/utils/colors'
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { isBuildYourOwnFire } from 'src/shared/ruleset'
import { MAZE_PLAYFIELD_METERS } from 'src/shared/settings'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import {
	TERRAIN_ORIGIN_M,
	TerrainMap,
	cellCenterWorld,
} from 'src/shared/terrain/terrainMap'
import { volcanoLavaCentroid } from 'src/shared/terrain/volcanoCrown'



/** Ancient stone tablet palette — flat, no color. */
const PANEL_BG    = Color4.create(0.18, 0.17, 0.15, 0.96)
const MAP_BG      = Color4.create(0.62, 0.58, 0.52, 1)
const INK         = Color4.create(0.06, 0.05, 0.04, 1)
const STONE_LIGHT = Color4.create(0.78, 0.74, 0.68, 1)
/** Station X once that monument is lit. */
const INK_LIT     = Color4.create(0.85, 0.08, 0.05, 1)

const MAP_SIZE_PX    = 520
/** Portrait phones: keep the square map inside the viewport. */
const MAP_SIZE_MB_PX = 340
const GLYPH_PX    = 40
const GLYPH_LG_PX = 48


type MapMark = {
	key: string
	leftPct: number
	topPct: number
	glyph: string
	size: number
	color?: Color4
}


function worldToMapPct(worldX: number, worldZ: number): { leftPct: number; topPct: number } {
	const extent = MAZE_PLAYFIELD_METERS
	const nx = (worldX - TERRAIN_ORIGIN_M) / extent
	const nz = (worldZ - TERRAIN_ORIGIN_M) / extent
	// +Z → top of UI (north-up if +Z is north); +X → right
	return {
		leftPct: Math.max(0.02, Math.min(0.98, nx)) * 100,
		topPct:  Math.max(0.02, Math.min(0.98, 1 - nz)) * 100,
	}
}


function collectMarks(map: TerrainMap): MapMark[] {
	const out: MapMark[] = []

	const lava = volcanoLavaCentroid(map)
	if (lava) {
		const { x, z } = cellCenterWorld(Math.floor(lava.fx), Math.floor(lava.fz))
		const p = worldToMapPct(x, z)
		out.push({ key: 'volcano', ...p, glyph: '▲', size: GLYPH_LG_PX })
	} else if (map.volcano) {
		const { x, z } = cellCenterWorld(map.volcano.cx, map.volcano.cz)
		const p = worldToMapPct(x, z)
		out.push({ key: 'volcano', ...p, glyph: '▲', size: GLYPH_LG_PX })
	}

	{
		const p = worldToMapPct(CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z)
		if (!isBuildYourOwnFire()) out.push({ key: 'spawn', ...p, glyph: '○', size: GLYPH_LG_PX })
	}

	map.stations.forEach((st, i) => {
		const { x, z } = cellCenterWorld(st.cx, st.cz)
		const p = worldToMapPct(x, z)
		out.push({
			key: `station-${i}`,
			...p,
			glyph: '✕',
			size: GLYPH_PX,
			color: isStationLit(i) ? INK_LIT : INK,
		})
	})

	return out
}


/** Faux-bold: the glyph stamped at small offsets so strokes read thicker. */
const BOLD_OFFSETS: Array<[number, number]> = [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]


class SummitMapLayer extends Layer {
	constructor() {
		super({
			id: 'summitMap',
			zone: ZoneType.FullScreen,
		})
	}

	body() {
		if (!isSummitMapOpen()) {
			return <UiEntity key="ui_SummitMap_hidden" uiTransform={{ display: 'none' }} />
		}

		const mobile  = isMobile()
		const mapPx   = mobile ? MAP_SIZE_MB_PX : MAP_SIZE_PX
		const scale   = mapPx / MAP_SIZE_PX
		const pad     = mobile ? 10 : 14
		const closePx = mobile ? 40 : 44
		const map = activeTerrain()
		const marks = map ? collectMarks(map) : []

		return (
			<UiEntity
				key="ui_SummitMap_root"
				uiTransform={{
					width: '100%',
					height: '100%',
					alignItems: 'center',
					justifyContent: 'center',
					flexDirection: 'column',
				}}
				uiBackground={{ color: alpha(Color4.Black(), 0.55) }}
			>
				<UiEntity
					key="ui_SummitMap_panel"
					uiTransform={{
						width: mapPx + pad * 2,
						height: mapPx + pad * 2,
						alignItems: 'center',
						justifyContent: 'center',
						positionType: 'relative',
					}}
					uiBackground={{ color: PANEL_BG }}
				>
					<UiEntity
						key="ui_SummitMap_canvas"
						uiTransform={{
							width: mapPx,
							height: mapPx,
							positionType: 'relative',
						}}
						uiBackground={{ color: MAP_BG }}
					>
						{marks.flatMap((m) => {
							const size = m.size * scale
							const left = (m.leftPct / 100) * mapPx - size / 2
							const top  = (m.topPct / 100) * mapPx - size / 2
							return BOLD_OFFSETS.map(([ox, oy], k) => (
								<Label
									key={`ui_SummitMap_mark_${m.key}_${k}`}
									value={m.glyph}
									fontSize={size * 0.8}
									color={m.color ?? INK}
									textAlign="middle-center"
									uiTransform={{
										positionType: 'absolute',
										position: { left: left + ox, top: top + oy },
										width: size,
										height: size,
									}}
								/>
							))
						})}
					</UiEntity>

					{/* Close: plain X glyph, upper-right corner, stone-styled. */}
					<UiEntity
						key="ui_SummitMap_close"
						uiTransform={{
							positionType: 'absolute',
							position: { top: pad + 6, right: pad + 6 },
							width: closePx,
							height: closePx,
							alignItems: 'center',
							justifyContent: 'center',
						}}
						uiBackground={{ color: Color4.create(0.32, 0.30, 0.26, 0.92) }}
						onMouseDown={() => closeSummitMap()}
					>
						<Label
							value="✕"
							fontSize={closePx * 0.6}
							color={STONE_LIGHT}
							textAlign="middle-center"
							uiTransform={{ width: closePx, height: closePx }}
						/>
					</UiEntity>
				</UiEntity>
			</UiEntity>
		)
	}
}


export const summitMapLayer = new SummitMapLayer()
