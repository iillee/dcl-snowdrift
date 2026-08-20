/**
 * catalog.ts — registry of decorative / structural props scattered
 * around the playfield independently of the maze tile grid.
 *
 * A "prop" is any world entity that isn't a maze tile or perimeter
 * cliff: trees, huts, penguins, snowmen, etc. Props are placed by
 * src/shared/props/scatter.ts using the shared maze seed, so every
 * client agrees on their positions without any network traffic.
 *
 * Adding a new prop type = add a PropDef entry here. The scatter and
 * spawn layers stay untouched (unless the new type needs a novel
 * placement rule or spawn hook, in which case extend those modules).
 *
 * No engine imports — this file is safe to load from the shared side
 * and from tests.
 */

// MARK: PropDef
/**
 * Static definition of a prop type. `count` is how many instances of
 * this prop the scatterer will try to place per maze seed; actual
 * placed count may be lower if the playfield can't satisfy the
 * placement rules (e.g. all candidate cells rejected by canPlaceAt).
 */
export interface PropDef {
	/** Stable id, used in logs and as the placement's `propId`. */
	id           : string
	/** GLB model path (relative to scene root). */
	model        : string
	/** Uniform scale applied to the entity. */
	scale        : number
	/** World-Y offset from ground (0). Useful for sinking roots below grade. */
	yOffset      : number
	/**
	 * If true, this prop's grid cell(s) are added to the maze
	 * generator's reserved set BEFORE generate() runs, so the maze
	 * flows around it. Use for structures (huts) that block walking.
	 * Trees and NPCs leave this false — the maze runs under them.
	 */
	reserves     : boolean
	/** How many to sprinkle per seed. */
	count        : number
	/**
	 * Minimum straight-line distance (in grid cells) from the campfire
	 * at scene centre. Prevents huts / trees from spawning on top of
	 * the spawn ring. Optional; defaults to 0.
	 */
	minCellsFromCampfire?: number
	/** Random Y rotation applied on spawn (degrees, uniform 0..360). Default true. */
	randomYaw?: boolean
	/**
	 * Optional per-instance scale jitter, expressed as +/- fraction of `scale`.
	 * e.g. 0.2 => each instance scales in [0.8*scale, 1.2*scale]. Default 0.
	 */
	scaleJitter?: number
}


// MARK: PROP_CATALOG
/**
 * The canonical list of prop types the scatterer will place. Order
 * matters only for determinism — the scatterer walks this array in
 * order and consumes RNG per prop, so re-ordering will shift where
 * previously-placed props land for a given seed.
 */
export const PROP_CATALOG: PropDef[] = [
	{
		id                   : 'tree_4',
		model                : 'assets/asset-packs/tree__4/HWN20_Tree_04.glb',
		// Scale randomised uniformly in [4, 8] => midpoint 6, +/- 33.3%.
		scale                : 6,
		yOffset              : 0,
		reserves             : false,
		count                : 3,
		minCellsFromCampfire : 3,
		randomYaw            : true,
		scaleJitter          : 1 / 3,
	},
]
