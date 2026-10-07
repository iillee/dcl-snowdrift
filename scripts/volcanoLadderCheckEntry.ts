/**
 * volcanoLadderCheck entry - per seed: summit (lava-adjacent rim) reachable,
 * and which face of the notch High step the Mid->High ladder uses.
 * Bundled by scripts/volcanoLadderCheck.mjs.
 */
import { cycleMazeSeed } from 'src/shared/cycleMazeSeed'
import { getTerrain } from 'src/shared/terrain/terrainCache'
import { LANDFORM_VOLCANO, LANDFORM_LAVA } from 'src/shared/terrain/terrainMap'
const TERRAIN_LEVEL_MID = 1, TERRAIN_LEVEL_HIGH = 2
const g:any=globalThis; g.__real ??= console.log; const real = g.__real; console.log = () => {}
const P = (globalThis as any).__P, N = (globalThis as any).__N
const DX=[0,1,0,-1], DZ=[1,0,-1,0]
const tally: Record<string,number> = {}
let bad = 0
for (let s = 0; s < N; s++) {
  const m = getTerrain(cycleMazeSeed(s)); const W=m.w; const v=m.volcano
  if (!v) { bad++; real('  seed',s,'no volcano'); continue }
  // summit reachable: any lava-adjacent non-lava rim cell with routeDist >= 0
  let summit=false
  for (let i=0;i<W*m.h;i++){ if(m.landforms[i]!==LANDFORM_LAVA&&m.routeDist[i]>=0&&m.levels[i]===m.levels[v.cz*W+v.cx]){const x=i%W,z=(i-x)/W;for(let d=0;d<4;d++){const j=(z+DZ[d])*W+x+DX[d];if(m.landforms[j]===LANDFORM_LAVA)summit=true}}}
  if(!summit){bad++;real('  seed',s,'summit unreachable')}
  // notch Mid->High ladder: low Mid, high High, high cell is volcano landform and nearest to volcano
  const cands=m.ladders.filter(l=>l.lowLevel===TERRAIN_LEVEL_MID&&m.landforms[l.highCz*W+l.highCx]===LANDFORM_VOLCANO)
  const up=m.ladders.find(l=>l.lowLevel===TERRAIN_LEVEL_HIGH&&m.landforms[l.highCz*W+l.highCx]===LANDFORM_VOLCANO)
  if(!up||cands.length===0){tally['none']=(tally['none']??0)+1;continue}
  // front = ladder dir parallel to the upper ladder dir
  const l=cands.sort((a,b)=>Math.abs(a.highCx-up.lowCx)+Math.abs(a.highCz-up.lowCz)-(Math.abs(b.highCx-up.lowCx)+Math.abs(b.highCz-up.lowCz)))[0]
  let k='front'; if(l.dir!==up.dir){ const cross=DX[up.dir]*DZ[l.dir]-DZ[up.dir]*DX[l.dir]; k=cross>0?'sideA':'sideB'}
  tally[k]=(tally[k]??0)+1
}
real(P,'seeds',N,'bad',bad,JSON.stringify(tally))




