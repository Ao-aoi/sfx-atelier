// 正規化：既定値を埋め、id の無いトラック・音符に id を振る（エディタが扱いやすい形）。
// 縮小：既定値・空のオブジェクト・id を落とす（ゲームに配る形）。
// どちらも検証済みの入力を前提にし、入力は書き換えない。
import {
  COMPRESSOR_DEFAULT,
  ENV_DEFAULT,
  FILTER_DEFAULT,
  JITTER_DEFAULT,
  LAYER_DEFAULT,
  MASTER_DEFAULT,
  NOTE_DEFAULT,
  PITCH_ENV_DEFAULT,
  REVERB_DEFAULT,
  SAMPLE_DEFAULT,
  SOUND_DEFAULT,
  TRACK_DEFAULT,
} from "./defaults";
import type { Bank, Instrument, Layer, Master, Note, Score, Sound, Track } from "./types";

type Obj = Record<string, unknown>;

const mapValues = <T, U>(o: Record<string, T> | undefined, f: (v: T) => U): Record<string, U> =>
  Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, f(v)]));

// ---- 正規化 ----

function normLayer(l: Layer): Layer {
  const out: Obj = {
    ...LAYER_DEFAULT,
    ...("sample" in l ? SAMPLE_DEFAULT : {}),
    ...l,
    env: { ...ENV_DEFAULT, ...l.env },
    jitter: { ...JITTER_DEFAULT, ...l.jitter },
  };
  if (l.filter) out.filter = { ...FILTER_DEFAULT, ...l.filter };
  if (l.pitchEnv) out.pitchEnv = { ...PITCH_ENV_DEFAULT, ...l.pitchEnv };
  return out as unknown as Layer;
}

const normInstrument = (i: Instrument): Instrument => ({ layers: i.layers.map(normLayer) });

function normMaster(m: Master | undefined): Master {
  const out: Master = { ...MASTER_DEFAULT, ...m };
  if (m?.compressor) out.compressor = { ...COMPRESSOR_DEFAULT, ...m.compressor };
  return out;
}

/** 使われていない id を、prefix ＋ 1 から順に探す */
function freshIds(used: Set<string>, prefix: string) {
  let n = 0;
  return () => {
    let id: string;
    do id = `${prefix}${++n}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
}

function normSound(s: Sound): Sound {
  const trackIds = new Set(s.tracks.flatMap((t) => (t.id ? [t.id] : [])));
  const noteIds = new Set(s.tracks.flatMap((t) => t.notes.flatMap((n) => (n.id ? [n.id] : []))));
  const nextTrack = freshIds(trackIds, "t");
  const nextNote = freshIds(noteIds, "n");
  const tracks: Track[] = s.tracks.map((t) => ({
    ...TRACK_DEFAULT,
    send: {},
    ...t,
    id: t.id ?? nextTrack(),
    notes: t.notes.map((n): Note => ({ ...NOTE_DEFAULT, ...n, id: n.id ?? nextNote() })),
  }));
  return {
    time: { unit: "sec" },
    ...SOUND_DEFAULT,
    ...s,
    variation: { ...JITTER_DEFAULT, ...s.variation },
    tracks,
  };
}

function normShared(x: Bank | Score) {
  return {
    master: normMaster(x.master),
    reverb: mapValues(x.reverb, (r) => ({ ...REVERB_DEFAULT, ...r })),
    instruments: mapValues(x.instruments, normInstrument),
    samples: { ...x.samples },
  };
}

export function normalizeBank(b: Bank): Bank {
  return { format: b.format, ...normShared(b), sounds: mapValues(b.sounds, normSound) };
}

export function normalizeScore(s: Score): Score {
  const { format, master: _m, reverb: _r, instruments: _i, samples: _s, ...sound } = s;
  return { format, ...normShared(s), ...normSound(sound) };
}

// ---- 縮小 ----

/** defaults と同じ値のキーを落とす */
function drop(o: object, defaults: object): Obj {
  const d = defaults as Obj;
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && d[k] !== v) out[k] = v;
  return out;
}

/** 中身が空なら undefined（キーごと消すため） */
const orNone = (o: Obj): Obj | undefined => (Object.keys(o).length === 0 ? undefined : o);

/** undefined のキーを消す */
const clean = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function shrinkLayer(l: Layer): Layer {
  const base = drop(l, "sample" in l ? { ...LAYER_DEFAULT, ...SAMPLE_DEFAULT } : LAYER_DEFAULT);
  return clean({
    ...base,
    env: l.env && orNone(drop(l.env, ENV_DEFAULT)),
    jitter: l.jitter && orNone(drop(l.jitter, JITTER_DEFAULT)),
    filter: l.filter && drop(l.filter, FILTER_DEFAULT),
    pitchEnv: l.pitchEnv && drop(l.pitchEnv, PITCH_ENV_DEFAULT),
  }) as unknown as Layer;
}

function shrinkMaster(m: Master | undefined): Master | undefined {
  if (!m) return undefined;
  return orNone(
    clean({
      ...drop(m, MASTER_DEFAULT),
      compressor: m.compressor && drop(m.compressor, COMPRESSOR_DEFAULT),
    }),
  ) as Master | undefined;
}

function shrinkSound(s: Sound): Sound {
  const tracks = s.tracks.map((t) => {
    const { id: _id, ...rest } = t;
    return clean({
      ...drop(rest, TRACK_DEFAULT),
      send: t.send && orNone(drop(t.send, {})),
      notes: t.notes.map((n) => {
        const { id: _nid, ...nr } = n;
        return drop(nr, NOTE_DEFAULT);
      }),
    });
  });
  return clean({
    ...drop(s, SOUND_DEFAULT),
    // 秒の単位は既定なので書かない
    time: s.time?.unit === "sec" ? undefined : s.time,
    variation: s.variation && orNone(drop(s.variation, JITTER_DEFAULT)),
    tracks,
  }) as unknown as Sound;
}

function shrinkShared(x: Bank | Score): Obj {
  return clean({
    master: shrinkMaster(x.master),
    reverb: x.reverb && orNone(mapValues(x.reverb, (r) => drop(r, REVERB_DEFAULT))),
    instruments:
      x.instruments && orNone(mapValues(x.instruments, (i) => ({ layers: i.layers.map(shrinkLayer) }))),
    samples: x.samples && orNone({ ...x.samples }),
  });
}

export function shrinkBank(b: Bank): Bank {
  return { format: b.format, ...shrinkShared(b), sounds: mapValues(b.sounds, shrinkSound) } as Bank;
}

export function shrinkScore(s: Score): Score {
  const { format, master: _m, reverb: _r, instruments: _i, samples: _s, ...sound } = s;
  return { format, ...shrinkShared(s), ...shrinkSound(sound) } as Score;
}
