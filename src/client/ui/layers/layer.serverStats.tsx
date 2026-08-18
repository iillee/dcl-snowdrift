/**
 * layer.serverStats.tsx \u2014 bottom-left debug panel from ServerStats CRDT.
 *
 * DUCK Layer wrapper. Uses canBeHidden + show()/hide() so the '#' HUD
 * button flips the panel via the kit's visibility plumbing.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { InfoRow, SectionHeader } from 'src/client/ui/components'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { formatServerStatsRows, readServerStats } from 'src/client/ui/utils/serverStats'


const { colors, borderRadius, spacing } = UI_THEME


// MARK: ServerStatsLayer
class ServerStatsLayer extends Layer {
	constructor() {
		super({
			id         : 'serverStats',
			zone       : ZoneType.TopCenter,
			canBeHidden: true,
			startHidden: true,
			showFrom   : 'top',
		})
	}

	body() {
		const rows = formatServerStatsRows(readServerStats())
		// Slot just below the top-center action bar. Action bar top edge
		// is 32 (desktop) or -40 (mobile) + 72 px button + a small gap.
		const topOffset = isMobile() ? 48 : 120
		return (
			<UiEntity
				uiTransform = {{
					width        : 300,
					margin       : { top: topOffset },
					padding      : spacing.lg,
					borderRadius : borderRadius.sm,
					flexDirection: 'column',
					alignItems   : 'stretch',
					pointerFilter: 'none',
				}}
				uiBackground = {{ color: colors.statsBg }}
			>
				<SectionHeader title = "SERVER STATS" />
				{rows.map((row) => (
					<InfoRow
						label = {row.label}
						value = {row.value}
					/>
				))}
			</UiEntity>
		)
	}
}


export const serverStatsLayer = new ServerStatsLayer()


// MARK: isServerStatsVisible
export function isServerStatsVisible(): boolean {
	return !serverStatsLayer.visibility.isHidden
}


// MARK: toggleServerStats
/** Flip visibility of the debug data menu (bound to the '#' HUD button). */
export function toggleServerStats(): void {
	serverStatsLayer.toggle()
}
