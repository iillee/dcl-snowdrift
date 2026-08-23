/**
 * torch.ts — authoritative relay for held-torch visuals.
 *
 * Clients broadcast their local torch lit-state via the `torchLit`
 * message whenever it changes (light, extinguish). The server caches
 * the latest value per authenticated userId (context.from) and
 * re-broadcasts as `torchLitFrom` to every OTHER client — the sender
 * already knows its own state and renders it locally via src/client/torch.ts.
 *
 * On joinRoster, server.ts calls sendTorchStatesTo(joiner) so the new
 * client immediately learns every existing player's current torch
 * state instead of waiting for the next change event.
 *
 * No validation, no persistence — this is a pure cosmetic channel.
 * The frost / campfire mechanics are all still driven by the local
 * torch state on each client's own machine.
 */

import { room } from 'src/shared/messages'


// MARK: State
// userId (lowercased) -> lit (0 | 1). Lowercased so the joiner-hydration
// path is address-case insensitive; context.from casing varies across
// hammurabi builds and we don't want stale duplicate entries.
const torchLitByUser = new Map<string, number>()


// MARK: sendTorchStatesTo
/**
 * Push the full cached torch-lit table to a specific client. Called
 * from the joinRoster handler in server.ts so a new joiner sees every
 * existing player's held torch (lit or unlit) from the first frame.
 */
export function sendTorchStatesTo(userId: string): void {
	torchLitByUser.forEach((lit, id) => {
		if (id === userId.toLowerCase()) return
		room.send('torchLitFrom', { userId: id, lit }, { to: [userId] })
	})
}


// MARK: setupTorchServer
/**
 * Register the `torchLit` inbound handler + broadcast relay.
 * Idempotent — call once from setupServer().
 */
export function setupTorchServer(): void {
	room.onMessage('torchLit', ({ lit }, context) => {
		const from = context?.from
		if (!from) return
		const id     = from.toLowerCase()
		const litInt = lit === 1 ? 1 : 0
		if (torchLitByUser.get(id) === litInt) return
		torchLitByUser.set(id, litInt)
		// Broadcast to everyone; the sender ignores its own echo in the
		// client handler (see src/client/remoteTorches.ts) so we don't
		// need a per-message `to:` allowlist here.
		room.send('torchLitFrom', { userId: id, lit: litInt })
	})
}
