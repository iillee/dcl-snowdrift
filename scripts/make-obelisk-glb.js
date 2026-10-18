// MARK: make-obelisk-glb
// Generates the two low-poly obelisk parts used by src/client/stationMarkers.ts:
//   assets/models/obelisk_pyramid.glb - unit square pyramid, base 1x1 at
//     y=0 (x,z in -0.5..0.5), apex at (0,1,0). 4 sides + 2-tri base.
//   assets/models/obelisk_shaft.glb   - unit cube centred on the origin
//     (-0.5..0.5 on every axis).
// Both are flat-shaded (one normal per face, unshared vertices) and share
// the same dark slate PBR material so the parts read as one stone. Scale
// them in-scene (Transform.scale) to get the real dimensions, which keeps
// every size tunable from stationMarkers.ts without regenerating.
//
// Pure Node (fs + path only). Run with:
//   node scripts/make-obelisk-glb.js

const fs   = require('fs')
const path = require('path')

// Dark slate, linear (glTF baseColorFactor is linear).
const SLATE    = [0.030, 0.034, 0.045, 1]
const METALLIC = 0.2
const ROUGH    = 0.6

const OUT_DIR = path.join(__dirname, '..', 'assets', 'models')

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/**
 * Build flat-shaded triangle soup. `faces` is a list of convex polygons
 * (vertex arrays). Winding is fixed so each normal points away from
 * `centre` (glTF front faces are counter-clockwise from outside).
 */
function buildMesh(faces, centre) {
	const pos = [], nrm = [], idx = []
	for (const f of faces) {
		let poly = f.slice()
		let n = norm(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])))
		const fc = poly.reduce((acc, p) => [acc[0] + p[0] / poly.length, acc[1] + p[1] / poly.length, acc[2] + p[2] / poly.length], [0, 0, 0])
		if (dot(n, sub(fc, centre)) < 0) { poly.reverse(); n = [-n[0], -n[1], -n[2]] }
		const base = pos.length / 3
		for (const p of poly) { pos.push(...p); nrm.push(...n) }
		for (let k = 1; k < poly.length - 1; k++) idx.push(base, base + k, base + k + 1)
	}
	return { pos, nrm, idx }
}

function writeGlb(file, mesh, name) {
	const posBuf = Buffer.from(new Float32Array(mesh.pos).buffer)
	const nrmBuf = Buffer.from(new Float32Array(mesh.nrm).buffer)
	const idxBuf = Buffer.from(new Uint16Array(mesh.idx).buffer)
	const pad4 = (b) => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b
	const bin = Buffer.concat([pad4(posBuf), pad4(nrmBuf), pad4(idxBuf)])
	const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
	for (let i = 0; i < mesh.pos.length; i += 3) for (let a = 0; a < 3; a++) {
		min[a] = Math.min(min[a], mesh.pos[i + a]); max[a] = Math.max(max[a], mesh.pos[i + a])
	}
	const vcount = mesh.pos.length / 3
	const posLen = pad4(posBuf).length, nrmLen = pad4(nrmBuf).length
	const gltf = {
		asset: { version: '2.0', generator: 'cryocene make-obelisk-glb' },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0, name }],
		meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }] }],
		materials: [{
			name: 'ObeliskSlate',
			pbrMetallicRoughness: { baseColorFactor: SLATE, metallicFactor: METALLIC, roughnessFactor: ROUGH },
		}],
		buffers: [{ byteLength: bin.length }],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
			{ buffer: 0, byteOffset: posLen, byteLength: nrmBuf.length, target: 34962 },
			{ buffer: 0, byteOffset: posLen + nrmLen, byteLength: idxBuf.length, target: 34963 },
		],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: vcount, type: 'VEC3', min, max },
			{ bufferView: 1, componentType: 5126, count: vcount, type: 'VEC3' },
			{ bufferView: 2, componentType: 5123, count: mesh.idx.length, type: 'SCALAR' },
		],
	}
	let json = Buffer.from(JSON.stringify(gltf), 'utf8')
	if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)])
	const total = 12 + 8 + json.length + 8 + bin.length
	const header = Buffer.alloc(12)
	header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8)
	const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4)
	const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4)
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, Buffer.concat([header, jh, json, bh, bin]))
	console.log(`wrote ${path.relative(process.cwd(), file)} (${total} bytes, ${mesh.idx.length / 3} tris)`)
}

// Pyramid: base corners at y=0, apex at y=1.
const h = 0.5
const b = [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]]
const apex = [0, 1, 0]
const pyramidFaces = [
	[b[0], b[1], apex], [b[1], b[2], apex], [b[2], b[3], apex], [b[3], b[0], apex],
	[b[0], b[1], b[2], b[3]],
]
writeGlb(path.join(OUT_DIR, 'obelisk_pyramid.glb'), buildMesh(pyramidFaces, [0, 0.25, 0]), 'ObeliskPyramid')

// Shaft: unit cube.
const c = (x, y, z) => [x * h, y * h, z * h]
const cubeFaces = [
	[c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)],
	[c(-1, -1, -1), c(-1, 1, -1), c(-1, 1, 1), c(-1, -1, 1)],
	[c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1)],
	[c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)],
	[c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)],
	[c(-1, -1, -1), c(1, -1, -1), c(1, 1, -1), c(-1, 1, -1)],
]
writeGlb(path.join(OUT_DIR, 'obelisk_shaft.glb'), buildMesh(cubeFaces, [0, 0, 0]), 'ObeliskShaft')
