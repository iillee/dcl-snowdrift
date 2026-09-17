/**
 * roster.ts — authoritative team assignment.
 *
 * The roster is an ordered list of userIds in join order. A player's team
 * is `roster.indexOf(userId) % 2` (1 = Red, 2 = Blue, matching the client
 * Team enum). Consequences:
 *
 *   - Guaranteed alternation. First joiner is Red, second Blue, third Red...
 *     Fixes the Phase-3 client-hash approach that could put 2 blue players
 *     in a row by coincidence.
 *   - Stable across rejoin. A returning userId gets its original team.
 *   - No compaction on leave. If player #3 leaves, the roster keeps their
 *     slot; the next new joiner becomes player #5. Compacting would flip
 *     everyone's team when someone leaves \u2014 disastrous mid-round.
 *
 * The roster lives in RAM. Rounds don't persist it, and a server restart
 * resets it. That's fine for Phase 4; leaderboard persistence lands later.
 *
 * Presence vs. roster:
 *   - `roster`       = ordered list of userIds EVER seen (never shrinks).
 *                      Correct for stable team-slot assignment.
 *   - `activeUsers`  = set of userIds CURRENTLY in the scene. Shrinks
 *                      when a player leaves. Correct for anything that
 *                      scales with the live crowd (fuel drain multiplier,
 *                      "online" analytics, spawner intensity).
 * Historically only `roster` existed, and `rosterSize()` was used as the
 * "current player count" for the hearth drain multiplier. That caused a
 * lingering "x2.0 drain solo" bug on servers that had seen more than one
 * player during their uptime — the roster never compacts. `activeUsers`
 * fixes it.
 */

const roster: string[] = []
const activeUsers = new Set<string>()

/**
 * Assign or look up the team for a userId. Every player is Blue for now
 * — the campfire ring is red, so player paint reads as "melt / trail"
 * against the fire's warm circle. Roster order is still tracked so
 * per-player state (name, stats) has a stable slot.
 */
export function assignTeam(userId: string): number {
  if (roster.indexOf(userId) === -1) roster.push(userId)
  return 2 // Team.Blue
}

/** Total number of DISTINCT userIds seen since server start.
 *  Never decreases while the server is up. Use for diagnostics and
 *  logging — NOT for gameplay that scales with live player count. */
export function rosterSize(): number {
  return roster.length
}

/** Number of players CURRENTLY in the scene (as observed via
 *  onEnterScene / onLeaveScene from @dcl/sdk/players). This is the
 *  correct signal for hearth drain multiplier, spawner intensity,
 *  "online" analytics, and anything else that should react to the
 *  live crowd size. */
export function activePlayerCount(): number {
  return activeUsers.size
}

/** Called from server.ts on onEnterScene. Idempotent — duplicate
 *  enters (join, then reconnect without a leave) don’t inflate. */
export function markActive(userId: string): void {
  activeUsers.add(userId)
}

/** Called from server.ts on onLeaveScene. Idempotent — leaves for
 *  users we never saw (or double-fires) are no-ops. */
export function markInactive(userId: string): void {
  activeUsers.delete(userId)
}

/**
 * Look up a userId's team without side effects. Returns 1 (Red), 2 (Blue),
 * or null if the user has never called joinRoster. Used by the paintTick
 * handler to attribute paint to a team.
 */
export function getTeam(userId: string): number | null {
  if (roster.indexOf(userId) === -1) return null
  return 2 // Team.Blue
}
