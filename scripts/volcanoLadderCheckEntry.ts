/**
 * volcanoLadderCheck entry - per seed: summit (lava-adjacent rim) reachable,
 * and how the volcano climb is laid out: ladders per step and how many
 * distinct faces (ladder directions) the climb uses.
 * Bundled by scripts/volcanoLadderCheck.mjs.
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { LANDFORM_VOLCANO, LANDFORM_LAVA } from 'src/shared/terrain/terrainMap'
import { TERRAIN_LEVEL_MID, TERRAIN_LEVEL_VOLCANO_RIM } from 'src/shared/settings'
const g:any=globalThis; g.__real ??= console.log; const real = g.__real; console.log = () => {}
const P = (globalThis as any).__P, N = (globalThis as any).__N
const DX=[0,1,0,-1], DZ=[1,0,-1,0]
const faces: Record<string,number> = {}
const perStep: Record<string,number> = {}
let bad = 0
for (let s = 0; s < N; s++) {
  const m = getTerrain(cycleMazeSeed(s)); const W=m.w; const v=m.volcano
  if (!v) { bad++; real('  seed',s,'no volcano'); continue }
  let summit=false
  for (let i=0;i<W*m.h;i++){ if(m.landforms[i]!==LANDFORM_LAVA&&m.routeDist[i]>=0&&m.levels[i]===TERRAIN_LEVEL_VOLCANO_RIM){const x=i%W,z=(i-x)/W;for(let d=0;d<4;d++){const j=(z+DZ[d])*W+x+DX[d];if(m.landforms[j]===LANDFORM_LAVA)summit=true}}}
  if(!summit){bad++;real('  seed',s,'summit unreachable')}
  const vl=m.ladders.filter(l=>l.lowLevel>=TERRAIN_LEVEL_MID&&m.landforms[l.highCz*W+l.highCx]===LANDFORM_VOLCANO)
  for (let low=TERRAIN_LEVEL_MID; low<TERRAIN_LEVEL_VOLCANO_RIM; low++){ const k=String(vl.filter(l=>l.lowLevel===low).length); perStep[k]=(perStep[k]??0)+1 }
  const f=String(new Set(vl.map(l=>l.dir)).size); faces[f]=(faces[f]??0)+1
}
real(P,'seeds',N,'bad',bad,'ladders-per-step hist',JSON.stringify(perStep),'distinct climb faces hist',JSON.stringify(faces))
