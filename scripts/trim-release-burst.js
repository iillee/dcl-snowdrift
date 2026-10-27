// Trim a WAV to its first N seconds with a short linear fade-out (PCM WAV only;
// keeps rate/channels/bit depth). Source is never modified.
// Usage: node scripts/trim-release-burst.js [src dst keepS fadeS]
//   (paths relative to assets/sounds). Defaults: release.wav release_burst.wav 1.0 0.07
//   charge:  node scripts/trim-release-burst.js charge.wav charge_start.wav 1.5 0.07 -1
//   Optional 5th arg: normalise the trimmed clip's peak to that many dBFS (e.g. -1); omitted = unchanged level.
const fs = require('fs')
const path = require('path')
const argv = process.argv.slice(2)
const SND = path.join(__dirname, '..', 'assets', 'sounds')
const SRC = path.join(SND, argv[0] || 'release.wav')
const DST = path.join(SND, argv[1] || 'release_burst.wav')
const KEEP_S = argv[2] ? Number(argv[2]) : 1.0
const FADE_S = argv[3] ? Number(argv[3]) : 0.07
const NORM_DB = argv[4] !== undefined ? Number(argv[4]) : null
if (SRC === DST) throw new Error('refusing to overwrite the source')

const buf = fs.readFileSync(SRC)
if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file')
let fmt = null, dataOff = -1, dataLen = 0
for (let p = 12; p + 8 <= buf.length;) {
	const id = buf.toString('ascii', p, p + 4)
	let len = buf.readUInt32LE(p + 4)
	if (id === 'fmt ') {
		fmt = { tag: buf.readUInt16LE(p + 8), ch: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) }
	} else if (id === 'data') {
		dataOff = p + 8
		dataLen = Math.min(len, buf.length - dataOff)
		break
	}
	p += 8 + len + (len & 1)
}
if (!fmt || dataOff < 0) throw new Error('fmt/data chunk missing')
if (fmt.tag !== 1 && fmt.tag !== 0xfffe) throw new Error('not PCM, tag ' + fmt.tag)
const bps = fmt.bits / 8
const frameBytes = bps * fmt.ch
const totalFrames = Math.floor(dataLen / frameBytes)
const keep = Math.min(totalFrames, Math.round(KEEP_S * fmt.rate))
const fade = Math.min(keep, Math.round(FADE_S * fmt.rate))
const out = Buffer.from(buf.subarray(dataOff, dataOff + keep * frameBytes))

const rd = (o) => bps === 3 ? out.readIntLE(o, 3) : bps === 2 ? out.readInt16LE(o) : (() => { throw new Error('unsupported bit depth ' + fmt.bits) })()
const wr = (o, v) => bps === 3 ? out.writeIntLE(v, o, 3) : out.writeInt16LE(v, o)
const lim = Math.pow(2, fmt.bits - 1)
let peak = 0
for (let f = 0; f < keep; f++) {
	const g = f >= keep - fade ? (keep - 1 - f) / fade : 1 // linear to 0 on the last frame
	for (let c = 0; c < fmt.ch; c++) {
		const o = (f * fmt.ch + c) * bps
		const v = Math.round(rd(o) * g)
		peak = Math.max(peak, Math.abs(v))
		wr(o, Math.max(-lim, Math.min(lim - 1, v)))
	}
}
let gain = 1
if (NORM_DB !== null && peak > 0) {
	gain = (Math.pow(10, NORM_DB / 20) * lim) / peak
	peak = 0
	for (let f = 0; f < keep; f++) for (let c = 0; c < fmt.ch; c++) {
		const o = (f * fmt.ch + c) * bps
		const v = Math.max(-lim, Math.min(lim - 1, Math.round(rd(o) * gain)))
		peak = Math.max(peak, Math.abs(v)); wr(o, v)
	}
}
const hdr = Buffer.alloc(44)
hdr.write('RIFF', 0, 'ascii'); hdr.writeUInt32LE(36 + out.length, 4); hdr.write('WAVE', 8, 'ascii')
hdr.write('fmt ', 12, 'ascii'); hdr.writeUInt32LE(16, 16)
hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(fmt.ch, 22); hdr.writeUInt32LE(fmt.rate, 24)
hdr.writeUInt32LE(fmt.rate * frameBytes, 28); hdr.writeUInt16LE(frameBytes, 32); hdr.writeUInt16LE(fmt.bits, 34)
hdr.write('data', 36, 'ascii'); hdr.writeUInt32LE(out.length, 40)
fs.writeFileSync(DST, Buffer.concat([hdr, out]))
console.log(`wrote ${DST}: ${fmt.rate} Hz, ${fmt.ch} ch, ${fmt.bits}-bit, ${keep} frames (${(keep / fmt.rate).toFixed(3)} s), fade ${fade} frames (${(fade / fmt.rate * 1000).toFixed(0)} ms), peak ${(peak / lim).toFixed(3)} (gain x${gain.toFixed(2)}), ${hdr.length + out.length} bytes (source ${totalFrames / fmt.rate} s)`)