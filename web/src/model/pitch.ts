// ピアノロールの縦軸。行は MIDI ノート番号（小数はセントのずれ）。
// 音符の高さが効くのは ratio の発振器の層だけ（freq 固定の層・雑音は tune だけで上下する）。
// そこで、ratio の層を持つ楽器は「音名 ＋ tune」、持たない楽器は「A4 ＋ tune」を行にする。
import { noteNameToMidi } from "@sfx-atelier/format/pitch";
import type { Instrument, Note } from "@sfx-atelier/format/types";

/** 高さの無い音符の行（ランタイムの既定の高さ A4 = 440Hz と同じ） */
export const A4 = 69;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToName(midi: number): string {
  const m = Math.max(0, Math.min(127, Math.round(midi)));
  return `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
}

export const hzToMidi = (hz: number) => A4 + 12 * Math.log2(hz / 440);

/** 音符の高さ（MIDI、小数あり）。無い・読めないときは A4 */
export function pitchMidi(pitch: Note["pitch"]): number {
  if (pitch === undefined) return A4;
  if (typeof pitch === "number") return hzToMidi(pitch);
  return noteNameToMidi(pitch) ?? A4;
}

/** 音符の高さに従う層（ratio の発振器）を持つか */
export function isPitched(ins: Instrument | undefined): boolean {
  return !!ins?.layers.some((l) => "osc" in l && l.freq === undefined);
}

/** ピアノロールの行 */
export function noteRow(note: Note, pitched: boolean): number {
  return (pitched ? pitchMidi(note.pitch) : A4) + (note.tune ?? 0) / 100;
}

/** 行を semis だけ動かす。高さに従う楽器は音名（Hz なら Hz）、従わない楽器は tune を 100 セントずつ */
export function shiftNote(note: Note, semis: number, pitched: boolean): Note {
  if (semis === 0) return note;
  if (!pitched) return { ...note, tune: (note.tune ?? 0) + semis * 100 };
  if (typeof note.pitch === "number") {
    return { ...note, pitch: Math.round(note.pitch * Math.pow(2, semis / 12) * 100) / 100 };
  }
  return { ...note, pitch: midiToName(Math.round(pitchMidi(note.pitch)) + semis) };
}

/** 行 → 置く音符の高さ（新しい音符用） */
export function noteAtRow(row: number, pitched: boolean): Pick<Note, "pitch" | "tune"> {
  const r = Math.round(row);
  return pitched ? { pitch: midiToName(r), tune: 0 } : { tune: (r - A4) * 100 };
}
