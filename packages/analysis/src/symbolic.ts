// 記号の分析（音符から）：音域・密度・音階の候補・和音の候補。
// 短い効果音では音階・和音を出さない（音の高さのある音符が少ないため）。M6（MIDI）の後に拡張する。
import { noteNameToMidi } from "@sfx-atelier/format/pitch";
import type { Note, Sound } from "@sfx-atelier/format/types";

export const PITCH_CLASS_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

/** MIDI ノート番号 → 音名（C4 = 60） */
export function midiToName(midi: number): string {
  const m = Math.round(midi);
  return `${PITCH_CLASS_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** 音符の高さ（MIDI、小数あり）。高さの無い音符は null */
export function noteMidi(note: Note): number | null {
  if (note.pitch === undefined) return null;
  const base = typeof note.pitch === "number" ? 69 + 12 * Math.log2(note.pitch / 440) : noteNameToMidi(note.pitch);
  if (base === null || !Number.isFinite(base)) return null;
  return base + (note.tune ?? 0) / 100;
}

const SCALES: Record<string, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

const CHORDS: [string, number[]][] = [
  ["", [0, 4, 7]],
  ["m", [0, 3, 7]],
  ["dim", [0, 3, 6]],
  ["aug", [0, 4, 8]],
  ["sus4", [0, 5, 7]],
  ["7", [0, 4, 7, 10]],
  ["maj7", [0, 4, 7, 11]],
  ["m7", [0, 3, 7, 10]],
];

export interface ScaleCandidate {
  /** 例："C major" */
  name: string;
  /** 高さのある音符のうち、音階に入るものの割合 */
  fit: number;
}

export interface ChordCandidate {
  /** 区間の始まり（秒） */
  t: number;
  /** 例："C"、"Am7" */
  name: string;
  /** 区間の音の集合と和音の音の集合の重なり（共通 / 和集合） */
  fit: number;
}

export interface Symbolic {
  notes: number;
  pitchedNotes: number;
  /** 最初の音符の開始から最後の音符の開始まで（秒） */
  span: number;
  /** 1 秒あたりの音符の数（span が 0 なら null） */
  density: number | null;
  range: { low: string; high: string; semitones: number } | null;
  /** 高さのある音符が MIN_TONAL_NOTES 未満なら空 */
  scales: ScaleCandidate[];
  chords: ChordCandidate[];
}

/** 音階・和音を出すのに要る、高さのある音符の数 */
export const MIN_TONAL_NOTES = 3;

/** 拍 → 秒の倍率 */
const secondsPerUnit = (sound: Sound) => (sound.time?.unit === "beat" ? 60 / sound.time.bpm : 1);

const pcOf = (midi: number) => ((Math.round(midi) % 12) + 12) % 12;

function bestChord(pcs: Set<number>): { name: string; fit: number } | null {
  let best: { name: string; fit: number; size: number } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const [suffix, shape] of CHORDS) {
      const chord = new Set(shape.map((s) => (root + s) % 12));
      let common = 0;
      for (const pc of pcs) if (chord.has(pc)) common++;
      const fit = common / (pcs.size + chord.size - common);
      // 同じ重なりなら、根音が鳴っているもの・音の少ない和音を選ぶ
      const better =
        !best || fit > best.fit + 1e-9 || (Math.abs(fit - best.fit) < 1e-9 && pcs.has(root) && chord.size < best.size);
      if (better) best = { name: PITCH_CLASS_NAMES[root] + suffix, fit, size: chord.size };
    }
  }
  return best && best.fit >= 0.5 ? { name: best.name, fit: best.fit } : null;
}

/**
 * 和音の区間：拍の score は 1 小節（sig が無ければ 4 拍）ごと、秒の score は 1 秒ごと。
 * 区間に高さのある音符が MIN_TONAL_NOTES 未満なら出さない。
 */
export function symbolic(sound: Sound): Symbolic {
  const unit = secondsPerUnit(sound);
  const all = sound.tracks.flatMap((tr) => tr.notes.map((n) => ({ t: n.t * unit, midi: noteMidi(n) })));
  const pitched = all.filter((n): n is { t: number; midi: number } => n.midi !== null);
  const times = all.map((n) => n.t);
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0;

  let range: Symbolic["range"] = null;
  if (pitched.length) {
    const lo = Math.min(...pitched.map((n) => n.midi));
    const hi = Math.max(...pitched.map((n) => n.midi));
    range = { low: midiToName(lo), high: midiToName(hi), semitones: Math.round(hi - lo) };
  }

  const scales: ScaleCandidate[] = [];
  if (pitched.length >= MIN_TONAL_NOTES) {
    const counts = new Array<number>(12).fill(0);
    for (const n of pitched) counts[pcOf(n.midi)]!++;
    const ranked: (ScaleCandidate & { tonic: number })[] = [];
    for (let root = 0; root < 12; root++) {
      for (const [kind, steps] of Object.entries(SCALES)) {
        const inScale = steps.reduce((s, st) => s + counts[(root + st) % 12]!, 0);
        ranked.push({ name: `${PITCH_CLASS_NAMES[root]} ${kind}`, fit: inScale / pitched.length, tonic: counts[root]! });
      }
    }
    // 当てはまりが同じなら、主音がよく鳴っている方
    ranked.sort((a, b) => b.fit - a.fit || b.tonic - a.tonic);
    for (const { name, fit } of ranked.slice(0, 3)) scales.push({ name, fit });
  }

  const chords: ChordCandidate[] = [];
  const segment = sound.time?.unit === "beat" ? (sound.time.sig?.[0] ?? 4) * unit : 1;
  if (pitched.length >= MIN_TONAL_NOTES) {
    const start = Math.min(...pitched.map((n) => n.t));
    const groups = new Map<number, Set<number>>();
    const sizes = new Map<number, number>();
    for (const n of pitched) {
      const k = Math.floor((n.t - start) / segment + 1e-9);
      if (!groups.has(k)) groups.set(k, new Set());
      groups.get(k)!.add(pcOf(n.midi));
      sizes.set(k, (sizes.get(k) ?? 0) + 1);
    }
    for (const k of [...groups.keys()].sort((a, b) => a - b)) {
      if (sizes.get(k)! < MIN_TONAL_NOTES) continue;
      const c = bestChord(groups.get(k)!);
      if (c) chords.push({ t: start + k * segment, ...c });
    }
  }

  return {
    notes: all.length,
    pitchedNotes: pitched.length,
    span,
    density: span > 0 ? all.length / span : null,
    range,
    scales,
    chords,
  };
}
