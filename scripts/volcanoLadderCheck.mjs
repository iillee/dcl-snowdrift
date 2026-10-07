// Usage (repo root): node scripts/volcanoLadderCheck.mjs [seedCount]
import { build } from 'esbuild'
import { readFileSync } from 'fs'
for (const profile of ['playtest_52','full_100']) {
await build({ entryPoints:['scripts/volcanoLadderCheckEntry.ts'], bundle:true, platform:'node', format:'esm', outfile:`scripts/out/volcanoLadderCheck.${profile}.bundle.mjs`, tsconfig:'tsconfig.json', logLevel:'warning',
 plugins:[{name:'p',setup(b){b.onLoad({filter:/src[\\/]shared[\\/]settings\.ts$/},a=>({contents:readFileSync(a.path,'utf8').replace(/export const WORLD_PROFILE: WorldProfile = '[a-z_0-9]+'/,`export const WORLD_PROFILE: WorldProfile = '${profile}'`),loader:'ts'}))}}] })
globalThis.__P=profile; globalThis.__N=Number(process.argv[2]??60); await import(`./out/volcanoLadderCheck.${profile}.bundle.mjs`)
}

