/**
 * titleFit.ts - pure layout of a one-line title card onto a canvas: stays on ONE line when it fits, else breaks at the space nearest the
 * middle (two lines) and shrinks the font until the longest line fits. Used by the thaw splash ("THE WORLD BEGINS TO THAW" must fit a
 * mobile portrait screen); tested in finaleCheck.
 */

/** Average glyph advance of the bold uppercase sans-serif title, in em (conservative). */
export const TITLE_EM_PER_CHAR = 0.7
/** Fraction of the canvas width a title line may use. */
export const TITLE_MAX_WIDTH_FRAC = 0.9
/** Never shrink the title below this font size (px). */
export const TITLE_MIN_FONT_PX = 28

export interface TitleFit { lines: string[]; fontPx: number; heightPx: number }

export function titleFit(text: string, canvasW: number, maxFontPx: number): TitleFit {
	const avail = Math.max(1, canvasW) * TITLE_MAX_WIDTH_FRAC
	const widthOf = (s: string, fs: number): number => s.length * TITLE_EM_PER_CHAR * fs
	let lines = [text]
	if (widthOf(text, maxFontPx) > avail) {
		// two lines, broken at the space nearest the middle
		const mid = text.length / 2
		let best = -1
		for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i
		if (best > 0) lines = [text.slice(0, best), text.slice(best + 1)]
	}
	const longest = Math.max(...lines.map((l) => l.length))
	const fontPx = Math.max(TITLE_MIN_FONT_PX, Math.min(maxFontPx, avail / (longest * TITLE_EM_PER_CHAR)))
	return { lines, fontPx, heightPx: Math.ceil(lines.length * fontPx * 1.25) }
}