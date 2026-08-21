// MARK: make-help-icon
// Generates assets/images/help.png — a 700x700 white "?" glyph on
// transparent background, matching the visual weight of eye.png and
// the padded mute icons so all mobile action buttons read as one family.
//
// Pure-Node (uses only `zlib` + `fs`), no native deps. Run with:
//   node scripts/make-help-icon.js

const fs   = require('fs')
const path = require('path')
const zlib = require('zlib')

// Canvas is 700x700 to match the eye/mute footprint. The glyph itself
// is drawn inside a smaller inner box (GLYPH_SIZE) centered on the
// canvas — the surrounding transparent border makes the `?` render
// smaller on the native mobile button (which stretches the texture to
// fill the circular button).
const W = 700
const H = 700
const GLYPH_SIZE = 500  // inner drawing area (was implicitly 700 = full canvas)
const OFFSET_X = (W - GLYPH_SIZE) / 2
const OFFSET_Y = (H - GLYPH_SIZE) / 2
const OUT = path.join(__dirname, '..', 'assets', 'images', 'help.png')


// MARK: inQuestionMark
// Signed-distance-ish test: returns true if pixel (x,y) is inside the
// filled "?" glyph. The glyph is composed of three primitives:
//   1. An annular arc forming the hook (top ring, open at bottom-left).
//   2. A short vertical stem descending from the arc's inside tip.
//   3. A rounded-square dot near the baseline.
function inQuestionMark(xIn, yIn) {
	// Remap the pixel coordinate into the inner GLYPH_SIZE box so the
	// same geometry constants below still describe a 700x700 glyph — the
	// scaling just shrinks the whole thing uniformly.
	const x = (xIn - OFFSET_X) * (700 / GLYPH_SIZE)
	const y = (yIn - OFFSET_Y) * (700 / GLYPH_SIZE)

	const cx    = 350           // horizontal center of the arc + stem + dot
	const arcCy = 250           // vertical center of the top arc
	const rOut  = 155           // arc outer radius
	const rIn   = 85            // arc inner radius (thickness = 70 px)

	// Arc: annulus, but only the top ~270° (open toward bottom-left).
	const dx = x - cx
	const dy = y - arcCy
	const d2 = dx * dx + dy * dy
	if (d2 <= rOut * rOut && d2 >= rIn * rIn) {
		// atan2: 0 = +x (right), pi/2 = +y (down), -pi/2 = up.
		// Keep the arc from ~200° sweeping clockwise around the top down
		// to ~80° on the right side (i.e. hide the wedge from 80°→200°
		// on the bottom-left, which is where the stem exits).
		const ang = Math.atan2(dy, dx) * 180 / Math.PI  // -180..180
		// Keep pixels whose angle is NOT in [80, 200] (the missing wedge).
		if (!(ang > 80 && ang < 200)) return true
	}

	// Stem: rounded rectangle connecting the arc's inside-bottom tip to
	// the dot. Positioned so it visually flows out of the arc.
	const stemX0 = cx - 35
	const stemX1 = cx + 35
	const stemY0 = 335
	const stemY1 = 475
	if (x >= stemX0 && x <= stemX1 && y >= stemY0 && y <= stemY1) return true

	// Dot: filled rounded square near the baseline.
	const dotCx = cx
	const dotCy = 575
	const dotR  = 42
	const ddx   = x - dotCx
	const ddy   = y - dotCy
	if (ddx * ddx + ddy * ddy <= dotR * dotR) return true

	return false
}


// MARK: buildRaster
// Rasterizes the glyph into an RGBA buffer with 2x supersampling for
// smoother edges. Each output pixel averages a 2x2 block of samples.
function buildRaster() {
	const SS   = 3                       // supersample factor
	const out  = Buffer.alloc(W * H * 4) // RGBA, initially all 0 (transparent)

	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			let hits = 0
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const px = x + (sx + 0.5) / SS
					const py = y + (sy + 0.5) / SS
					if (inQuestionMark(px, py)) hits++
				}
			}
			if (hits === 0) continue
			const a  = Math.round((hits / (SS * SS)) * 255)
			const i  = (y * W + x) * 4
			out[i]   = 255
			out[i+1] = 255
			out[i+2] = 255
			out[i+3] = a
		}
	}
	return out
}


// MARK: crc32
const CRC_TABLE = (() => {
	const t = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
		t[n] = c >>> 0
	}
	return t
})()

function crc32(buf) {
	let c = 0xffffffff
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}


// MARK: makeChunk
function makeChunk(type, data) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length, 0)
	const typeBuf = Buffer.from(type, 'ascii')
	const crcBuf  = Buffer.alloc(4)
	crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
	return Buffer.concat([len, typeBuf, data, crcBuf])
}


// MARK: encodePng
function encodePng(rgba) {
	// PNG signature
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

	// IHDR
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(W, 0)
	ihdr.writeUInt32BE(H, 4)
	ihdr[8]  = 8   // bit depth
	ihdr[9]  = 6   // color type: RGBA
	ihdr[10] = 0   // compression
	ihdr[11] = 0   // filter
	ihdr[12] = 0   // interlace

	// IDAT: prepend a filter byte (0 = None) per scanline, then zlib deflate.
	const stride = W * 4
	const raw = Buffer.alloc((stride + 1) * H)
	for (let y = 0; y < H; y++) {
		raw[y * (stride + 1)] = 0
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
	}
	const idat = zlib.deflateSync(raw, { level: 9 })

	return Buffer.concat([
		sig,
		makeChunk('IHDR', ihdr),
		makeChunk('IDAT', idat),
		makeChunk('IEND', Buffer.alloc(0)),
	])
}


// MARK: main
function main() {
	console.log('make-help-icon: main: rasterizing glyph ' + W + 'x' + H + '...')
	const rgba = buildRaster()
	console.log('make-help-icon: main: encoding PNG...')
	const png = encodePng(rgba)
	fs.writeFileSync(OUT, png)
	console.log('make-help-icon: main: wrote ' + OUT + ' (' + png.length + ' bytes)')
}

main()
