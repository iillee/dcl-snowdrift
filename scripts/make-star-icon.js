// MARK: make-star-icon
// Generates assets/images/leaderboard_star.png (HUD leaderboard button) and
// assets/images/leaderboard_star_padded.png (mobile native action slot, transparent
// border like help-v3 / muted_padded): a white five-point star on a
// transparent background. Pure Node (zlib + fs). Run: node scripts/make-star-icon.js

const fs   = require('fs')
const path = require('path')
const zlib = require('zlib')

const OUT_DIR = path.join(__dirname, '..', 'assets', 'images')
const SS = 4 // supersampling per axis

function starPolygon(cx, cy, rOuter, rInner) {
	const pts = []
	for (let i = 0; i < 10; i++) {
		const r = i % 2 === 0 ? rOuter : rInner
		const a = -Math.PI / 2 + (i * Math.PI) / 5
		pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
	}
	return pts
}

function inPoly(x, y, pts) {
	let inside = false
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const [xi, yi] = pts[i], [xj, yj] = pts[j]
		if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
	}
	return inside
}

function crc32(buf) {
	let c, crc = 0xffffffff
	for (let n = 0; n < buf.length; n++) {
		c = (crc ^ buf[n]) & 0xff
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		crc = (crc >>> 8) ^ c
	}
	return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
	const td = Buffer.concat([Buffer.from(type), data])
	const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
	return Buffer.concat([len, td, crc])
}

function writeStar(file, size, rOuterFrac) {
	const rOuter = (size / 2) * rOuterFrac
	// Slight downward shift so the optical centre of the star sits mid-box.
	const cx = size / 2, cy = size / 2 + rOuter * 0.06
	const pts = starPolygon(cx, cy, rOuter, rOuter * 0.46)
	const raw = Buffer.alloc((size * 4 + 1) * size)
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0
		for (let x = 0; x < size; x++) {
			let hit = 0
			for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
				if (inPoly(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, pts)) hit++
			}
			const o = y * (size * 4 + 1) + 1 + x * 4
			raw[o] = 255; raw[o + 1] = 255; raw[o + 2] = 255
			raw[o + 3] = Math.round((hit / (SS * SS)) * 255)
		}
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
	ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
	const png = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	])
	fs.writeFileSync(file, png)
	console.log(`wrote ${file} (${size}x${size}, ${png.length} bytes)`)
}

writeStar(path.join(OUT_DIR, 'leaderboard_star.png'), 256, 0.94)
writeStar(path.join(OUT_DIR, 'leaderboard_star_padded.png'), 700, 0.62)
