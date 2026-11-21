// 音名 → MIDI ノート番号。C4 = 60、A4 = 69（科学的音高表記）。
const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAME = /^([A-G])(#|b)?(-?\d)$/;

/** 音名を MIDI ノート番号にする。読めない名前・0〜127 の外は null */
export function noteNameToMidi(name: string): number | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const [, letter, accidental, octave] = m;
  const acc = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  const midi = (Number(octave) + 1) * 12 + STEP[letter!]! + acc;
  return midi >= 0 && midi <= 127 ? midi : null;
}
