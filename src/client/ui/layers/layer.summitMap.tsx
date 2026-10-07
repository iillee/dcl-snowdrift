/**
 * layer.summitMap.tsx — full-screen engraved stone world map popup.
 *
 * Opened from the summit map table. North = world +Z (top of map),
 * east = world +X (right). Knowledge only — Close to dismiss.
 *
 * Station marks turn red once that monument is lit (read every render).
 * Flat black-and-white engraving: volcano ▲, spawn ○, stations ✕.
 * No world borders, groves, or color terrain.
 */

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { closeSummitMap, isSummitMapOpen } from 'src/client/summitMap'
import { isStationLit } from 'src/client/stationMarkers'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { alpha } from 'src/client/ui/utils/colors'
import { CAMPFIRE_WORLD_X, CAMPFIRE_WORLD_Z } from 'src/shared/campfire'
import { MAZE_PLAYFIELD_METERS } from 'src/shared/settings'
import { activeTerrain } from 'src/shared/terrain/terrainCache'
import {
	TERRAIN_ORIGIN_M,
	TerrainMap,
	cellCenterWorld,
} from 'src/shared/terrain/terrainMap'
import { volcanoLavaCentroid } from 'src/shared/terrain/volcanoCrown'


const { fontSizes, spacing } = UI_THEME

/** Ancient stone tablet palette — flat, no color. */
const PANEL_BG    = Color4.create(0.18, 0.17, 0.15, 0.96)
const MAP_BG      = Color4.create(0.62, 0.58, 0.52, 1)
const INK         = Color4.create(0.06, 0.05, 0.04, 1)
const INK_FAINT   = Color4.create(0.28, 0.26, 0.22, 1)
const STONE_LIGHT = Color4.create(0.78, 0.74, 0.68, 1)
/** Station X once that monument is lit. */
const INK_LIT     = Color4.create(0.85, 0.08, 0.05, 1)

const MAP_SIZE_PX = 520
const GLYPH_PX    = 28
const GLYPH_LG_PX = 34


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
		out.push({ key: 'spawn', ...p, glyph: '○', size: GLYPH_LG_PX })
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


function LegendItem(props: { glyph: string; label: string }) {
	return (
		<UiEntity
			uiTransform={{
				flexDirection: 'row',
				alignItems: 'center',
				margin: { right: spacing.md, bottom: spacing.xs },
			}}
		>
			<Label
				value={props.glyph}
				fontSize={fontSizes.md}
				color={STONE_LIGHT}
				textAlign="middle-center"
				uiTransform={{ width: 22, height: 20, margin: { right: 6 } }}
			/>
			<Label
				value={props.label}
				fontSize={fontSizes.sm}
				color={STONE_LIGHT}
				textAlign="middle-left"
			/>
		</UiEntity>
	)
}


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
						width: MAP_SIZE_PX + 48,
						height: 'auto',
						flexDirection: 'column',
						alignItems: 'center',
						padding: spacing.md,
					}}
					uiBackground={{ color: PANEL_BG }}
				>
					<UiEntity
						uiTransform={{
							width: '100%',
							flexDirection: 'row',
							justifyContent: 'space-between',
							alignItems: 'center',
							margin: { bottom: spacing.sm },
						}}
					>
						<Label
							value="WORLD MAP"
							fontSize={fontSizes.xl}
							color={STONE_LIGHT}
							font="sans-serif"
							textAlign="middle-left"
						/>
						<UiEntity
							uiTransform={{
								width: 96,
								height: 40,
								alignItems: 'center',
								justifyContent: 'center',
							}}
							uiBackground={{ color: Color4.create(0.32, 0.30, 0.26, 1) }}
							onMouseDown={() => closeSummitMap()}
						>
							<Label
								value="Close"
								fontSize={fontSizes.md}
								color={STONE_LIGHT}
								textAlign="middle-center"
							/>
						</UiEntity>
					</UiEntity>

					<Label
						value="+Z up (north)  ·  +X right (east)  ·  stone engraving"
						fontSize={fontSizes.xs}
						color={INK_FAINT}
						textAlign="middle-center"
						uiTransform={{ width: '100%', margin: { bottom: spacing.sm } }}
					/>

					<UiEntity
						key="ui_SummitMap_canvas"
						uiTransform={{
							width: MAP_SIZE_PX,
							height: MAP_SIZE_PX,
							positionType: 'relative',
						}}
						uiBackground={{ color: MAP_BG }}
					>
						{/* N indicator */}
						<Label
							value="N"
							fontSize={fontSizes.sm}
							color={INK}
							textAlign="middle-center"
							uiTransform={{
								positionType: 'absolute',
								position: { top: 4, left: MAP_SIZE_PX / 2 - 8 },
								width: 16,
								height: 18,
							}}
						/>
						{marks.map((m) => {
							const left = (m.leftPct / 100) * MAP_SIZE_PX - m.size / 2
							const top  = (m.topPct / 100) * MAP_SIZE_PX - m.size / 2
							return (
								<Label
									key={`ui_SummitMap_mark_${m.key}`}
									value={m.glyph}
									fontSize={m.size * 0.72}
									color={m.color ?? INK}
									textAlign="middle-center"
									uiTransform={{
										positionType: 'absolute',
										position: { left, top },
										width: m.size,
										height: m.size,
									}}
								/>
							)
						})}
					</UiEntity>

					<UiEntity
						uiTransform={{
							width: '100%',
							flexDirection: 'row',
							justifyContent: 'center',
							margin: { top: spacing.sm },
						}}
					>
						<LegendItem glyph="▲" label="Volcano" />
						<LegendItem glyph="○" label="Spawn" />
						<LegendItem glyph="✕" label="Stations" />
					</UiEntity>
				</UiEntity>
			</UiEntity>
		)
	}
}


export const summitMapLayer = new SummitMapLayer()
