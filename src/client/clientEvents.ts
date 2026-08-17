/**
 * clientEvents.ts — client-runtime event names.
 *
 * Prefer importing via the bus barrel:
 * `import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'`
 *
 * Server code must not use these — use ServerEvents instead.
 */

export enum ClientEvents {
	/** Team assignment reply for our joinRoster. Fires once per session. */
	TeamAssigned = 'team:assigned',
}
