// score（縮めた形でもよい）＋ 呼び出しの opts ＋ 乱数 → 予定表。Web Audio を触らない純粋な関数。
// 既定値は format/defaults と同じものを使う。乱数を引く順番は下に書いた順で固定する
// （同じ種なら同じ音になる。順番を変えると聞き比べの基準が変わるので注意）。
import {
  ENV_DEFAULT,
  FILTER_DEFAULT,
  LAYER_DEFAULT,
  NOTE_DEFAULT,
  SAMPLE_DEFAULT,
  SAMPLE_ENV_DEFAULT,
  SOUND_DEFAULT,
  TRACK_DEFAULT,
} from "@sfx-atelier/format/defaults";
import { noteNameToMidi } from "@sfx-atelier/format/pitch";
import type { Envelope, Instrument, Jitter, Layer, Note, Reverb, Sound } from "@sfx-atelier/format/types";
import type { Automation, Bus, Plan, Voice } from "./plan";

/** 指数カーブの端（0 には指数で近づけないので、ここを無音とみなす）。-80dB */
export const FLOOR = 0.0001;
/** 止める時刻の余裕（減衰の最後が切れて「プツッ」と鳴らないように） */
export const STOP_MARGIN = 0.02;
/** s > 0 で r = 0 のとき、離した瞬間に切らないための最短の余韻 */
export const MIN_RELEASE = 0.005;
/** 雑音バッファの読み出し位置の幅（秒） */
export const NOISE_OFFSET = 0.5;
/** 音の高さが無い音符で ratio の層が基準にする高さ（A4） */
export const DEFAULT_PITCH_HZ = 440;

export type Random = () => number;

export interface CompileOptions {
  gain?: number;
  pan?: number;
}

export interface Parts {
  instruments?: Record<string, Instrument>;
  reverb?: Record<string, Reverb>;
  /** 録音の長さ（秒）。dur の無い音符で、録音の層をどこまで鳴らすかに使う */
  sampleSeconds?: Record<string, number>;
}

const cents = (c: number) => Math.pow(2, c / 1200);
/** -1〜1 の一様乱数 × 幅 */
const spread = (random: Random, amount: number) => (amount ? (random() * 2 - 1) * amount : 0);
const clampPan = (p: number) => Math.max(-1, Math.min(1, p));

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function pitchHz(p: Note["pitch"]): number {
  if (p === undefined) return DEFAULT_PITCH_HZ;
  if (typeof p === "number") return p;
  const m = noteNameToMidi(p);
  return m === null ? DEFAULT_PITCH_HZ : midiToHz(m);
}

/**
 * エンベロープ → 音量の予定と、無音になる時刻。
 * s = 0（AD 型）は dur を無視し、a で peak へ、d で無音へ。
 * s > 0 は a で peak、d で peak × s、離す時刻（start + dur。dur が無ければ a + d の後）から r で無音へ。
 */
export function envelope(
  env: Envelope | undefined,
  start: number,
  peak: number,
  dur: number | undefined,
  defaults: Required<Envelope> = ENV_DEFAULT,
) {
  const a = env?.a ?? defaults.a;
  const d = env?.d ?? defaults.d;
  const s = env?.s ?? defaults.s;
  const r = env?.r ?? defaults.r;
  const exp = (env?.curve ?? defaults.curve) === "exp";
  const ramp = exp ? "exp" : "lin";
  const floor = exp ? FLOOR : 0;
  const top = Math.max(peak, FLOOR);
  const events: ["set" | "lin" | "exp", number, number][] = [];

  if (a > 0) events.push(["set", start, floor], [ramp, start + a, top]);
  else events.push(["set", start, top]);

  if (s === 0) {
    const end = start + a + d;
    if (d > 0) events.push([ramp, end, floor]);
    else events.push(["set", end, floor]);
    return { gain: events as Automation, end };
  }

  const sustain = Math.max(top * s, FLOOR);
  if (d > 0) events.push([ramp, start + a + d, sustain]);
  else events.push(["set", start + a, sustain]);
  const release = start + Math.max(dur ?? 0, a + d);
  const end = release + Math.max(r, MIN_RELEASE);
  events.push(["set", release, sustain], [ramp, end, floor]);
  return { gain: events as Automation, end };
}

/** 1 つの音符の、層に共通する値 */
interface NoteCtx {
  pitch: Note["pitch"];
  start: number;
  dur: number | undefined;
  /** 音符の tune ＋ 音全体・トラックの揺らぎ（セント） */
  cents: number;
  /** vel × トラックの揺らぎ */
  gain: number;
  /** 減衰だけの層の d に掛ける倍率（dur から決まる） */
  adScale: number;
  bus: number;
}

const envDefaultsOf = (layer: Layer): Required<Envelope> => ("sample" in layer ? SAMPLE_ENV_DEFAULT : ENV_DEFAULT);
const isAD = (layer: Layer) => (layer.env?.s ?? envDefaultsOf(layer).s) === 0;

/** 1 つの層を 1 つの声にする。乱数は層の jitter の tune → gain → time の順に引く（0 の項目は引かない） */
function voiceOf(layer: Layer, n: NoteCtx, random: Random, sampleSeconds: Record<string, number> | undefined): Voice {
  const j: Jitter = layer.jitter ?? {};
  const c = n.cents + spread(random, j.tune ?? 0);
  const g = 1 + spread(random, j.gain ?? 0);
  const start = Math.max(0, n.start + spread(random, j.time ?? 0));
  const shift = cents(c);

  const peak = (layer.gain ?? LAYER_DEFAULT.gain) * n.gain * g;
  const isSample = "sample" in layer;
  const envDefaults = envDefaultsOf(layer);
  const d = (layer.env?.d ?? envDefaults.d) * (isAD(layer) ? n.adScale : 1);
  // 録音は、dur が無ければ録音の長さ ÷ 再生速度だけ鳴らす
  const len = isSample ? sampleSeconds?.[layer.sample] : undefined;
  const dur = n.dur ?? (isSample && len !== undefined ? len / ((layer.ratio ?? SAMPLE_DEFAULT.ratio) * shift) : undefined);
  const env = envelope({ ...layer.env, d }, start, peak, dur, envDefaults);

  /** 周波数の予定（ピッチ変化つき）。from は開始の周波数 */
  const freqAuto = (from: number): Automation => {
    const pe = layer.pitchEnv;
    if (!pe) return [["set", start, from]];
    const to = pe.toHz !== undefined ? pe.toHz * shift : from * cents(pe.cents ?? 0);
    const time = pe.time === "decay" ? d : pe.time;
    const ramp = (pe.curve ?? "exp") === "exp" ? "exp" : "lin";
    return [
      ["set", start, from],
      [ramp, start + time, to],
    ];
  };

  let source: Voice["source"];
  if ("osc" in layer) {
    const base = layer.freq !== undefined ? layer.freq : pitchHz(n.pitch) * (layer.ratio ?? 1);
    source = { kind: "osc", type: layer.osc, freq: freqAuto(base * shift) };
  } else if ("noise" in layer) {
    source = { kind: "noise", type: layer.noise, offset: random() * NOISE_OFFSET };
  } else {
    const rate = (layer.ratio ?? SAMPLE_DEFAULT.ratio) * shift;
    // 録音のピッチ変化は再生速度の倍率で表す（toHz は使えないので cents だけ効く）
    const pe = layer.pitchEnv;
    const rateAuto: Automation =
      pe && pe.cents !== undefined
        ? [
            ["set", start, rate],
            [(pe.curve ?? "exp") === "exp" ? "exp" : "lin", start + (pe.time === "decay" ? d : pe.time), rate * cents(pe.cents)],
          ]
        : [["set", start, rate]];
    source = { kind: "sample", sample: layer.sample, rate: rateAuto };
  }

  const voice: Voice = {
    bus: n.bus,
    start,
    stop: env.end + STOP_MARGIN,
    source,
    gain: env.gain,
    pan: layer.pan ?? LAYER_DEFAULT.pan,
  };
  if (layer.filter) {
    voice.filter = {
      type: layer.filter.type,
      // 音符の tune・揺らぎで、フィルタも一緒に上下する（「カチッ」の高さが全体で変わるように）
      freq: layer.filter.freq * shift,
      q: layer.filter.q ?? FILTER_DEFAULT.q,
      gain: layer.filter.gain ?? FILTER_DEFAULT.gain,
    };
  }
  return voice;
}

/**
 * 乱数を引く順番（0 の項目は引かない）：
 * 1. 音全体の variation の tune → gain → time
 * 2. トラック順・音符順に、トラックの jitter（tune → gain → time）、
 *    続けてその音符の層ごとに、層の jitter（tune → gain → time）と雑音の読み出し位置
 */
export function compile(sound: Sound, parts: Parts, random: Random, opts: CompileOptions = {}): Plan {
  const time = sound.time ?? { unit: "sec" };
  const beat = time.unit === "beat" ? 60 / time.bpm : 1;
  const v = sound.variation ?? {};
  const soundCents = spread(random, v.tune ?? 0);
  const soundGain = 1 + spread(random, v.gain ?? 0);
  // 音全体の遅れは 0〜time 秒（前にずらすと delay より早く鳴ってしまうので、遅らせる方だけ）
  const soundDelay = v.time ? random() * v.time : 0;

  const buses: Bus[] = [];
  const voices: Voice[] = [];
  const usedReverbs = new Set<string>();

  for (const track of sound.tracks) {
    const ins = parts.instruments?.[track.instrument];
    if (!ins) continue;
    const bus = buses.length;
    const sends = Object.entries(track.send ?? {}).filter(([name, amt]) => amt > 0 && parts.reverb?.[name]);
    for (const [name] of sends) usedReverbs.add(name);
    buses.push({
      gain: track.gain ?? TRACK_DEFAULT.gain,
      pan: clampPan((track.pan ?? TRACK_DEFAULT.pan) + (opts.pan ?? 0)),
      sends,
    });
    // 減衰だけの層で、いちばん長い d（dur で伸び縮みさせる基準）
    const longestD = Math.max(0, ...ins.layers.filter(isAD).map((l) => l.env?.d ?? envDefaultsOf(l).d));
    const tj: Jitter = track.jitter ?? {};
    for (const note of track.notes) {
      const tc = spread(random, tj.tune ?? 0);
      const tg = 1 + spread(random, tj.gain ?? 0);
      const tt = spread(random, tj.time ?? 0);
      const dur = note.dur === undefined ? undefined : note.dur * beat;
      const n: NoteCtx = {
        pitch: note.pitch,
        start: Math.max(0, note.t * beat + soundDelay + tt),
        dur,
        cents: (note.tune ?? NOTE_DEFAULT.tune) + soundCents + tc,
        gain: (note.vel ?? NOTE_DEFAULT.vel) * tg,
        adScale: dur !== undefined && longestD > 0 ? dur / longestD : 1,
        bus,
      };
      for (const layer of ins.layers) voices.push(voiceOf(layer, n, random, parts.sampleSeconds));
    }
  }

  const end = voices.reduce((m, x) => Math.max(m, x.stop), 0);
  const reverbTail = Math.max(0, ...[...usedReverbs].map((n) => parts.reverb![n]!.seconds));
  return {
    gain: (sound.gain ?? SOUND_DEFAULT.gain) * (opts.gain ?? 1) * soundGain,
    buses,
    voices,
    end,
    tail: end + reverbTail,
  };
}

/** 種つきの乱数（mulberry32）。0 以上 1 未満 */
export function seeded(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
