// Usage (repo root): node scripts/volcanoTerraceCheck.mjs [seedCount]
// Per profile: summit reachability, ladder per volcano step, terrace
// reachability, footprint, heights vs the DCL scene limit, gen time.
import { build } from 'esbuild'
import { readFileSync } from 'fs'
for (const profile of ['playtest_52','full_100']) {
await build({ entryPoints:['scripts/volcanoTerraceCheckEntry.ts'], bundle:true, platform:'node', format:'esm', outfile:`scripts/out/volcanoTerraceCheck.${profile}.bundle.mjs`, tsconfig:'tsconfig.json', logLevel:'warning',
 plugins:[{name:'p',setup(b){b.onLoad({filter:/src[\\/]shared[\\/]settings\.ts$/},a=>({contents:readFileSync(a.path,'utf8').replace(/export const WORLD_PROFILE: WorldProfile = '[a-z_0-9]+'/,`export const WORLD_PROFILE: WorldProfile = '${profile}'`),loader:'ts'}))}}] })
globalThis.__P=profile; globalThis.__N=Number(process.argv[2]??200); await import(`./out/volcanoTerraceCheck.${profile}.bundle.mjs`)
}
