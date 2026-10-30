// assetRefCheck: every 'assets/...' path written as a string literal in src/ must exist on disk (a cleanup that deletes a model, image
// or sound the code still loads shows up here, not as an invisible missing prop in game). Template strings with ${...} are skipped.
// Usage: node scripts/assetRefCheck.mjs
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Known and already missing before the 2026-10-29 cleanup (ee078cd), only in an unused theme path. Do not add anything else.
const ALLOWED_MISSING = new Set(['assets/images/ui/atlas-btn-close.png'])
function walk(d, out = []) {
	for (const e of readdirSync(d, { withFileTypes: true })) {
		const p = join(d, e.name)
		if (e.isDirectory()) walk(p, out)
		else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
	}
	return out
}
let bad = 0, seen = 0
for (const f of walk(join(root, 'src'))) {
	const t = readFileSync(f, 'utf8')
	for (const m of t.matchAll(/(['"`])(assets\/[^'"`\n]*)\1/g)) {
		if (m[2].includes('${')) continue
		seen++
		if (!existsSync(join(root, m[2])) && !ALLOWED_MISSING.has(m[2])) { bad++; console.log('FAIL missing asset ' + m[2] + '  <- ' + f.slice(root.length + 1)) }
	}
}
console.log(bad ? `assetRefCheck: ${bad} MISSING of ${seen} asset references` : `assetRefCheck: OK (${seen} asset references exist)`)
if (bad) process.exit(1)