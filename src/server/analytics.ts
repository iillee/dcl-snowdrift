/**
 * analytics.ts — server-side Discord notifications.
 *
 * Currently fires a single webhook on player join. The webhook URL is
 * loaded from the `DISCORD_PLAYER_JOIN_WEBHOOK` environment variable
 * via `@dcl/sdk/server`'s EnvVar API. Never hardcode the token:
 * deployed scene bundles are publicly downloadable, and a leaked
 * webhook can be spammed by anyone.
 *
 * Preview mode is auto-detected via `getRealm({}).realmInfo.isPreview`
 * and suppresses all notifications so local testing doesn't spam the
 * channel.
 *
 * Design cribbed from the Flag Tag scene's `server/analytics.ts`, but
 * trimmed: Snow Drift has no name-resolver / roster-name pipeline, so
 * we just post the abbreviated wallet address. If we later wire in a
 * name source (avatar-name resolver, roster metadata, etc.) we can
 * add the same deferred-flush pattern flagtag uses.
 */

import { EnvVar } from '@dcl/sdk/server'
import { getRealm } from '~system/Runtime'

import { rosterSize } from 'src/server/roster'


let DISCORD_WEBHOOK_URL = ''
let isPreview           = false


// MARK: loadDiscordWebhookUrl
/**
 * Detect preview realm + load the webhook URL from the environment.
 * Safe to call multiple times; second call is a no-op relative to the
 * cached state. Awaits both async calls before returning.
 */
export async function loadDiscordWebhookUrl(): Promise<void> {
	try {
		const realm = await getRealm({})
		isPreview   = realm.realmInfo?.isPreview ?? false
		if (isPreview) {
			console.log('[Analytics] loadDiscordWebhookUrl: preview mode — Discord notifications disabled')
		}
	} catch (err) {
		console.log('[Analytics] loadDiscordWebhookUrl: could not detect realm info:', err)
	}

	DISCORD_WEBHOOK_URL = (await EnvVar.get('DISCORD_PLAYER_JOIN_WEBHOOK')) || ''
	if (DISCORD_WEBHOOK_URL) {
		console.log('[Analytics] loadDiscordWebhookUrl: webhook loaded from env')
	} else {
		console.log('[Analytics] loadDiscordWebhookUrl: no DISCORD_PLAYER_JOIN_WEBHOOK set — join notifications disabled')
	}
}


// MARK: notifyPlayerJoin
/**
 * Post a "player joined" line to the configured Discord channel. No-op
 * when the webhook is not configured, when running in preview, or when
 * the address is empty. Fire-and-forget: fetch errors are swallowed so
 * a Discord outage never destabilises the server tick.
 */
export function notifyPlayerJoin(address: string): void {
	if (!address) {
		console.log('[Analytics] notifyPlayerJoin: skipped — empty address')
		return
	}
	if (isPreview) {
		console.log(`[Analytics] notifyPlayerJoin: skipped for ${address} — preview mode`)
		return
	}
	if (!DISCORD_WEBHOOK_URL) {
		console.log(`[Analytics] notifyPlayerJoin: skipped for ${address} — no webhook URL loaded (env var missing or loadDiscordWebhookUrl not yet resolved)`)
		return
	}

	const short   = `${address.slice(0, 6)}…${address.slice(-4)}`
	const online  = rosterSize()
	const content = `👋 **${short}** joined Snow Drift — **${online}** online`

	console.log(`[Analytics] notifyPlayerJoin: POSTing to Discord for ${short} (${online} online)`)
	fetch(DISCORD_WEBHOOK_URL, {
		method : 'POST',
		headers: { 'Content-Type': 'application/json' },
		// allowed_mentions: guard against any future name field containing
		// `@everyone` / `@here` — a player-supplied string must never ping
		// the whole Discord server.
		body   : JSON.stringify({ content, allowed_mentions: { parse: [] } }),
	}).then(
		(res) => {
			if (res.ok) {
				console.log(`[Analytics] notifyPlayerJoin: Discord accepted (HTTP ${res.status})`)
			} else {
				console.log(`[Analytics] notifyPlayerJoin: Discord rejected HTTP ${res.status} — webhook may be revoked, rate-limited, or payload invalid`)
			}
		},
		(err) => console.log('[Analytics] notifyPlayerJoin: webhook POST failed:', err),
	)
}
