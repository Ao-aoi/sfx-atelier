// score を編集する操作。入力は正規化済み（id と既定値が埋まっている）の score で、書き換えずに新しい score を返す。
import { ENV_DEFAULT, JITTER_DEFAULT, LAYER_DEFAULT, SAMPLE_ENV_DEFAULT } from "@sfx-atelier/format/defaults";
import type { Instrument, Layer, Note, Reverb, Score, Sound, Time, Track } from "@sfx-atelier/format/types";
import { isPitched, shiftNote } from "./pitch";
import { tidy, unitSeconds } from "./timeline";

export interface NoteRef {
  track: string;
  note: string;
}

/** 使われていない id（prefix ＋ 番号） */
export function freshId(used: Iterable<string | undefined>, prefix: string): string {
  const set = new Set(used);
  let n = 1;
  while (set.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const noteIds = (s: Score) => s.tracks.flatMap((t) => t.notes.map((n) => n.id));

/** 新しい名前（name、name 2、name 3 …） */
export function freshName(used: Iterable<string>, name: string): string {
  const set = new Set(used);
  if (!set.has(name)) return name;
  let n = 2;
  while (set.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

// ---- 音符 ----

export function findNote(s: Score, ref: NoteRef): Note | undefined {
  return s.tracks.find((t) => t.id === ref.track)?.notes.find((n) => n.id === ref.note);
}

export function updateTrack(s: Score, trackId: string, f: (t: Track) => Track): Score {
  return { ...s, tracks: s.tracks.map((t) => (t.id === trackId ? f(t) : t)) };
}

export function updateNote(s: Score, ref: NoteRef, f: (n: Note) => Note): Score {
  return updateTrack(s, ref.track, (t) => ({ ...t, notes: t.notes.map((n) => (n.id === ref.note ? f(n) : n)) }));
}

/** 音符を足す。音符は t の順に並べる */
export function addNote(s: Score, trackId: string, note: Omit<Note, "id">): { score: Score; ref: NoteRef } {
  const id = freshId(noteIds(s), "n");
  const n: Note = { tune: 0, vel: 1, ...note, id, t: Math.max(0, tidy(note.t)) };
  const score = updateTrack(s, trackId, (t) => ({ ...t, notes: sortNotes([...t.notes, n]) }));
  return { score, ref: { track: trackId, note: id } };
}

const sortNotes = (notes: Note[]) => [...notes].sort((a, b) => a.t - b.t);

export function deleteNotes(s: Score, refs: NoteRef[]): Score {
  const del = new Set(refs.map((r) => `${r.track}/${r.note}`));
  return { ...s, tracks: s.tracks.map((t) => ({ ...t, notes: t.notes.filter((n) => !del.has(`${t.id}/${n.id}`)) })) };
}

/** 音符を動かす。dt は単位、semis は行の数。t は 0 より前に出ない */
export function moveNotes(s: Score, refs: NoteRef[], dt: number, semis: number): Score {
  const byTrack = new Map<string, Set<string>>();
  for (const r of refs) (byTrack.get(r.track) ?? byTrack.set(r.track, new Set()).get(r.track)!).add(r.note);
  // 選んだ音符のうち一番早いものが 0 で止まるように、全体の dt を揃える
  const earliest = Math.min(...refs.map((r) => findNote(s, r)?.t ?? Infinity));
  const d = Number.isFinite(earliest) ? Math.max(dt, -earliest) : dt;
  return {
    ...s,
    tracks: s.tracks.map((t) => {
      const ids = byTrack.get(t.id!);
      if (!ids) return t;
      const pitched = isPitched(s.instruments?.[t.instrument]);
      const notes = t.notes.map((n) => (ids.has(n.id!) ? shiftNote({ ...n, t: tidy(Math.max(0, n.t + d)) }, semis, pitched) : n));
      return { ...t, notes: sortNotes(notes) };
    }),
  };
}

/** 長さを変える（単位）。min より短くしない。undefined で楽器の減衰に任せる */
export function setNoteDur(s: Score, ref: NoteRef, dur: number | undefined, min = 0.001): Score {
  return updateNote(s, ref, (n) => {
    if (dur === undefined) {
      const { dur: _d, ...rest } = n;
      return rest;
    }
    return { ...n, dur: tidy(Math.max(min, dur)) };
  });
}

// ---- 長さ ----

/** dur の無い音符が鳴る長さ（秒）：層のうちいちばん長いもの（AD は a + d、それ以外は a + d + r） */
export function naturalSeconds(ins: Instrument | undefined): number {
  if (!ins || ins.layers.length === 0) return 0.1;
  return Math.max(
    ...ins.layers.map((l) => {
      const def = "sample" in l ? SAMPLE_ENV_DEFAULT : ENV_DEFAULT;
      const a = l.env?.a ?? def.a;
      const d = l.env?.d ?? def.d;
      const s = l.env?.s ?? def.s;
      const r = l.env?.r ?? def.r;
      return s === 0 ? a + d : a + d + r;
    }),
  );
}

/** 音符の画面上の長さ（単位） */
export function noteLength(note: Note, ins: Instrument | undefined, time: Time | undefined): number {
  return note.dur ?? naturalSeconds(ins) / unitSeconds(time);
}

/** 最後の音符の終わり（秒） */
export function contentSeconds(s: Score): number {
  const u = unitSeconds(s.time);
  let end = 0;
  for (const t of s.tracks) {
    const ins = s.instruments?.[t.instrument];
    for (const n of t.notes) end = Math.max(end, (n.t + noteLength(n, ins, s.time)) * u);
  }
  return end;
}

// ---- 時間の単位 ----

/** 単位を変える。鳴る時刻（秒）が変わらないように t・dur を換算する */
export function setTime(s: Score, time: Time): Score {
  const k = unitSeconds(s.time) / unitSeconds(time);
  const conv = (x: number) => tidy(x * k);
  return {
    ...s,
    time,
    tracks: s.tracks.map((t) => ({
      ...t,
      notes: t.notes.map((n) => (n.dur === undefined ? { ...n, t: conv(n.t) } : { ...n, t: conv(n.t), dur: conv(n.dur) })),
    })),
  };
}

// ---- トラック ----

export const newLayer = (): Layer => ({
  osc: "sine",
  ratio: 1,
  ...LAYER_DEFAULT,
  env: { ...ENV_DEFAULT },
  jitter: { ...JITTER_DEFAULT },
});

/** トラックを足す。instrument が無ければ新しい楽器（正弦波 1 層）を作る */
export function addTrack(s: Score, instrument?: string): { score: Score; id: string } {
  let instruments = s.instruments ?? {};
  let name = instrument;
  if (!name || !instruments[name]) {
    name = freshName(Object.keys(instruments), "楽器");
    instruments = { ...instruments, [name]: { layers: [newLayer()] } };
  }
  const id = freshId(s.tracks.map((t) => t.id), "t");
  const track: Track = { id, instrument: name, gain: 1, pan: 0, send: {}, jitter: { ...JITTER_DEFAULT }, notes: [] };
  return { score: { ...s, instruments, tracks: [...s.tracks, track] }, id };
}

export function removeTrack(s: Score, id: string): Score {
  return { ...s, tracks: s.tracks.filter((t) => t.id !== id) };
}

export function setTrack(s: Score, id: string, patch: Partial<Omit<Track, "id" | "notes">>): Score {
  return updateTrack(s, id, (t) => ({ ...t, ...patch }));
}

// ---- 楽器・層 ----

export function updateInstrument(s: Score, name: string, f: (i: Instrument) => Instrument): Score {
  const ins = s.instruments?.[name];
  if (!ins) return s;
  return { ...s, instruments: { ...s.instruments, [name]: f(ins) } };
}

export function setLayer(s: Score, name: string, index: number, layer: Layer): Score {
  return updateInstrument(s, name, (i) => ({ layers: i.layers.map((l, k) => (k === index ? layer : l)) }));
}

export function addLayer(s: Score, name: string, layer: Layer = newLayer()): Score {
  return updateInstrument(s, name, (i) => ({ layers: [...i.layers, layer] }));
}

export function removeLayer(s: Score, name: string, index: number): Score {
  return updateInstrument(s, name, (i) => ({ layers: i.layers.filter((_, k) => k !== index) }));
}

/** 層を複製して直後に置く */
export function duplicateLayer(s: Score, name: string, index: number): Score {
  return updateInstrument(s, name, (i) => {
    const l = i.layers[index];
    return l ? { layers: [...i.layers.slice(0, index + 1), structuredClone(l), ...i.layers.slice(index + 1)] } : i;
  });
}

/** 楽器を複製し、トラック trackId をそちらに付け替える（ほかの音と共有している楽器を、この音だけ変えたいとき） */
export function forkInstrument(s: Score, trackId: string): Score {
  const t = s.tracks.find((x) => x.id === trackId);
  const ins = t && s.instruments?.[t.instrument];
  if (!t || !ins) return s;
  const name = freshName(Object.keys(s.instruments ?? {}), t.instrument);
  return setTrack({ ...s, instruments: { ...s.instruments, [name]: structuredClone(ins) } }, trackId, { instrument: name });
}

/** 楽器の名前を変える（トラックの参照も変える）。空・既にある名前なら何もしない */
export function renameInstrument(s: Score, from: string, to: string): Score {
  const name = to.trim();
  const ins = s.instruments?.[from];
  if (!ins || !name || name === from || s.instruments?.[name]) return s;
  const instruments = Object.fromEntries(Object.entries(s.instruments!).map(([k, v]) => [k === from ? name : k, v]));
  return { ...s, instruments, tracks: s.tracks.map((t) => (t.instrument === from ? { ...t, instrument: name } : t)) };
}

/** どのトラックからも使われていない楽器を消す（書き出しの前に） */
export function pruneInstruments(s: Score): Score {
  const used = new Set(s.tracks.map((t) => t.instrument));
  return { ...s, instruments: Object.fromEntries(Object.entries(s.instruments ?? {}).filter(([k]) => used.has(k))) };
}

// ---- 音全体・残響 ----

export function setSound(s: Score, patch: Partial<Pick<Sound, "gain" | "variation">>): Score {
  return { ...s, ...patch };
}

export function setReverb(s: Score, name: string, r: Reverb): Score {
  return { ...s, reverb: { ...s.reverb, [name]: r } };
}

export function removeReverb(s: Score, name: string): Score {
  const { [name]: _r, ...rest } = s.reverb ?? {};
  return {
    ...s,
    reverb: rest,
    tracks: s.tracks.map((t) => {
      if (!t.send || !(name in t.send)) return t;
      const { [name]: _s, ...send } = t.send;
      return { ...t, send };
    }),
  };
}
