// SMF ⇄ sfx-score。
// 読み込み：トラック × チャンネルごとに sfx のトラックを 1 つ作る。チャンネル 10（0 始まりで 9）はドラムとして、
//   キーの種類（バスドラ・スネア・ハイハット・タム・シンバル・ほか）ごとにトラックを分ける。
//   テンポが 1 つなら時間の単位は拍（bpm と拍子を写す）、テンポが変わる・SMPTE なら秒。
//   音色は General MIDI の 16 の系統ごとの簡単な楽器で置き換える。音量（CC7）とパン（CC10）は最初の値だけトラックに写す。
//   ピッチベンド・ほかのコントロール・アフタータッチ・SysEx は落とし、数を warnings で知らせる。
// 書き出し：形式 1、PPQ 480。音色（層）・雑音・フィルタ・残響・揺らぎは MIDI に入らない。
//   音符の高さが音に効かない楽器（ratio の発振器の層が無い楽器）のトラックはチャンネル 10 に書く。
import { SCORE_FORMAT, normalizeScore, type Instrument, type Layer, type Note, type Score, type Track } from "@sfx-atelier/format";
import { noteNameToMidi } from "@sfx-atelier/format/pitch";
import { ENV_DEFAULT } from "@sfx-atelier/format/defaults";
import { tempoChanges, tickClock, type MidiEvent, type Smf } from "./smf";

const DRUM_CH = 9;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** MIDI ノート番号 → 音名（C4 = 60） */
export function midiToNoteName(key: number): string {
  return `${NAMES[key % 12]}${Math.floor(key / 12) - 1}`;
}

const round = (v: number, digits = 6) => Math.round(v * 10 ** digits) / 10 ** digits;

// ---- 楽器 ----

interface Family {
  name: string;
  layers: Layer[];
}

const SUSTAIN = { a: 0.01, d: 0.15, s: 0.7, r: 0.1 };
const PLUCK = { a: 0.002, d: 0.8 };

/** General MIDI の 16 系統（プログラム番号 ÷ 8） */
const FAMILIES: Family[] = [
  { name: "ピアノ", layers: [{ osc: "triangle", ratio: 1, gain: 0.3, env: { a: 0.002, d: 1.2 } }, { osc: "sine", ratio: 2, gain: 0.15, env: { a: 0.002, d: 0.6 } }] },
  { name: "色彩打楽器", layers: [{ osc: "sine", ratio: 1, gain: 0.4, env: { a: 0.001, d: 0.9 } }, { osc: "sine", ratio: 4, gain: 0.1, env: { a: 0.001, d: 0.2 } }] },
  { name: "オルガン", layers: [{ osc: "square", ratio: 1, gain: 0.15, env: { a: 0.005, d: 0.05, s: 0.9, r: 0.05 } }, { osc: "sine", ratio: 2, gain: 0.15, env: { a: 0.005, d: 0.05, s: 0.9, r: 0.05 } }] },
  { name: "ギター", layers: [{ osc: "sawtooth", ratio: 1, gain: 0.25, env: PLUCK, filter: { type: "lowpass", freq: 2500 } }] },
  { name: "ベース", layers: [{ osc: "triangle", ratio: 1, gain: 0.5, env: { a: 0.003, d: 0.7 } }] },
  { name: "弦", layers: [{ osc: "sawtooth", ratio: 1, gain: 0.2, env: { a: 0.08, d: 0.2, s: 0.8, r: 0.25 }, filter: { type: "lowpass", freq: 2200 } }] },
  { name: "アンサンブル", layers: [{ osc: "sawtooth", ratio: 1, gain: 0.15, env: { a: 0.1, d: 0.2, s: 0.8, r: 0.3 }, filter: { type: "lowpass", freq: 1800 } }, { osc: "sawtooth", ratio: 1.003, gain: 0.15, env: { a: 0.1, d: 0.2, s: 0.8, r: 0.3 }, filter: { type: "lowpass", freq: 1800 } }] },
  { name: "金管", layers: [{ osc: "sawtooth", ratio: 1, gain: 0.25, env: { a: 0.03, d: 0.15, s: 0.75, r: 0.1 }, filter: { type: "lowpass", freq: 3000 } }] },
  { name: "リード", layers: [{ osc: "square", ratio: 1, gain: 0.2, env: SUSTAIN, filter: { type: "lowpass", freq: 2500 } }] },
  { name: "笛", layers: [{ osc: "sine", ratio: 1, gain: 0.4, env: { a: 0.04, d: 0.1, s: 0.8, r: 0.1 } }, { noise: "white", gain: 0.03, env: { a: 0.02, d: 0.1, s: 0.5, r: 0.1 }, filter: { type: "highpass", freq: 3000 } }] },
  { name: "シンセリード", layers: [{ osc: "square", ratio: 1, gain: 0.2, env: SUSTAIN }] },
  { name: "シンセパッド", layers: [{ osc: "sawtooth", ratio: 1, gain: 0.15, env: { a: 0.3, d: 0.3, s: 0.8, r: 0.5 }, filter: { type: "lowpass", freq: 1200 } }] },
  { name: "シンセ効果", layers: [{ osc: "sine", ratio: 1, gain: 0.3, env: { a: 0.05, d: 0.3, s: 0.6, r: 0.4 } }, { osc: "triangle", ratio: 1.5, gain: 0.1, env: { a: 0.05, d: 0.3, s: 0.6, r: 0.4 } }] },
  { name: "民族楽器", layers: [{ osc: "triangle", ratio: 1, gain: 0.35, env: PLUCK }, { osc: "sine", ratio: 3, gain: 0.1, env: { a: 0.002, d: 0.3 } }] },
  { name: "打楽器", layers: [{ osc: "sine", ratio: 1, gain: 0.45, env: { a: 0.001, d: 0.35 }, pitchEnv: { cents: -300, time: "decay" } }] },
  { name: "効果音", layers: [{ noise: "white", gain: 0.3, env: { a: 0.01, d: 0.4 }, filter: { type: "bandpass", freq: 1500, q: 1 } }] },
];

/** プログラム番号 → 楽器の名前。系統の最初の番号なら系統名だけ、ほかは番号（1 始まり）を付ける */
export function programName(program: number): string {
  const f = FAMILIES[program >> 3]!;
  return program % 8 === 0 ? f.name : `${f.name} ${program + 1}`;
}

/** 楽器の名前 → プログラム番号（programName の逆。読めなければ null） */
export function programOf(name: string): number | null {
  const m = /^(.+?)(?: (\d+))?$/.exec(name);
  if (!m) return null;
  const fi = FAMILIES.findIndex((f) => f.name === m[1]);
  if (fi < 0) return null;
  const p = m[2] === undefined ? fi * 8 : Number(m[2]) - 1;
  return p >> 3 === fi ? p : null;
}

interface Kit {
  name: string;
  keys: number[];
  layers: Layer[];
}

/** ドラムのキーの種類（General MIDI のドラムの割り当て） */
const KITS: Kit[] = [
  { name: "バスドラム", keys: [35, 36], layers: [{ osc: "sine", freq: 150, gain: 0.5, env: { a: 0.001, d: 0.3 }, pitchEnv: { toHz: 45, time: 0.12 } }] },
  { name: "スネア", keys: [37, 38, 39, 40], layers: [{ noise: "white", gain: 0.45, env: { a: 0.001, d: 0.18 }, filter: { type: "bandpass", freq: 2500, q: 0.7 } }, { osc: "triangle", freq: 190, gain: 0.3, env: { a: 0.001, d: 0.08 } }] },
  { name: "ハイハット", keys: [42, 44, 46], layers: [{ noise: "white", gain: 0.25, env: { a: 0.001, d: 0.06 }, filter: { type: "highpass", freq: 7000 } }] },
  { name: "タム", keys: [41, 43, 45, 47, 48, 50], layers: [{ osc: "sine", freq: 130, gain: 0.6, env: { a: 0.001, d: 0.35 }, pitchEnv: { cents: -500, time: "decay" } }] },
  { name: "シンバル", keys: [49, 51, 52, 53, 55, 57, 59], layers: [{ noise: "white", gain: 0.2, env: { a: 0.002, d: 1.2 }, filter: { type: "highpass", freq: 5000 } }] },
  { name: "ドラム", keys: [], layers: [{ noise: "pink", gain: 0.3, env: { a: 0.001, d: 0.15 }, filter: { type: "bandpass", freq: 1200, q: 1 } }] },
];

const kitOf = (key: number) => KITS.find((k) => k.keys.includes(key)) ?? KITS[KITS.length - 1]!;

// ---- 読み込み ----

export interface MidiToScoreResult {
  score: Score;
  warnings: string[];
}

interface Group {
  /** 並べる順：MIDI のトラック → チャンネル → ドラムの種類 */
  order: number;
  name: string;
  instrument: string;
  layers: Layer[];
  notes: Note[];
  gain?: number;
  pan?: number;
}

const OTHER_NAMES: Record<string, string> = {
  pitchBend: "ピッチベンド",
  aftertouch: "アフタータッチ",
  sysex: "SysEx",
  control: "コントロール（音量・パン以外）",
};

/** SMF を sfx-score（正規化済み）にする */
export function midiToScore(smf: Smf): MidiToScoreResult {
  const warnings: string[] = [];
  const dropped: Record<string, number> = {};
  const drop = (k: string) => (dropped[k] = (dropped[k] ?? 0) + 1);

  const tempos = tempoChanges(smf);
  const useBeat = smf.ppq !== null && tempos.filter((t) => t.tick > 0).length === 0;
  const clock = tickClock(smf);
  const bpm = round(60e6 / (tempos[0]?.usPerBeat ?? 500000), 3);
  const at = (tick: number) => round(useBeat ? tick / smf.ppq! : clock(tick));
  if (smf.ppq !== null && !useBeat) warnings.push(`テンポが ${tempos.length} 回変わるので、時間の単位を秒にしました`);
  if (smf.ppq === null) warnings.push("SMPTE の時刻なので、時間の単位を秒にしました");

  const groups = new Map<string, Group>();
  const instruments = new Map<string, Layer[]>();
  let open = 0;

  smf.tracks.forEach((track, ti) => {
    const trackName = track.events.find((e): e is Extract<MidiEvent, { type: "trackName" }> => e.type === "trackName")?.text.trim();
    const program = new Map<number, number>();
    const volume = new Map<number, number>();
    const pan = new Map<number, number>();
    const pending = new Map<string, { tick: number; vel: number; g: Group }[]>();

    const groupFor = (ch: number, key: number): Group => {
      const drum = ch === DRUM_CH;
      const kit = drum ? kitOf(key) : null;
      const prog = program.get(ch) ?? 0;
      const id = drum ? `${ti}:d:${kit!.name}` : `${ti}:${ch}:${prog}`;
      let g = groups.get(id);
      if (!g) {
        const instrument = drum ? kit!.name : programName(prog);
        const layers = drum ? kit!.layers : FAMILIES[prog >> 3]!.layers;
        instruments.set(instrument, layers);
        const parts = [trackName, instrument].filter((x): x is string => !!x);
        g = {
          order: ti * 10000 + (drum ? 16 * 100 + KITS.indexOf(kit!) : ch * 100 + prog / 128),
          name: [...new Set(parts)].join(" "),
          instrument,
          layers,
          notes: [],
        };
        const v = volume.get(ch);
        const p = pan.get(ch);
        if (v !== undefined) g.gain = round(v / 127, 3);
        if (p !== undefined) g.pan = round(Math.max(-1, Math.min(1, (p - 64) / 63)), 3);
        groups.set(id, g);
      }
      return g;
    };

    const close = (ch: number, key: number, tick: number) => {
      const stack = pending.get(`${ch}:${key}`);
      const on = stack?.shift();
      if (!on) return;
      on.g.notes.push({ t: at(on.tick), dur: round(at(tick) - at(on.tick)), pitch: midiToNoteName(key), vel: round(on.vel / 127, 3) });
    };

    // 同じ tick では、止める → 出すの順に処理する（ファイルの並びに関わらず、同じ音の連打を 0 秒の音符にしない）
    const events = track.events.map((e, i) => ({ e, i })).sort((a, b) => a.e.tick - b.e.tick || rank(a.e) - rank(b.e) || a.i - b.i);
    for (const { e } of events) {
      switch (e.type) {
        case "program":
          program.set(e.ch, e.program);
          break;
        case "control":
          if (e.cc === 7) volume.set(e.ch, e.value);
          else if (e.cc === 10) pan.set(e.ch, e.value);
          else drop("control");
          break;
        case "noteOn": {
          const k = `${e.ch}:${e.key}`;
          const stack = pending.get(k) ?? [];
          stack.push({ tick: e.tick, vel: e.vel, g: groupFor(e.ch, e.key) });
          pending.set(k, stack);
          break;
        }
        case "noteOff":
          close(e.ch, e.key, e.tick);
          break;
        case "other":
          if (e.kind !== "meta") drop(e.kind);
          break;
      }
    }
    // 止められていない音は、トラックの最後の出来事で止める
    const end = track.events.reduce((m, e) => Math.max(m, e.tick), 0);
    for (const [k, stack] of pending) {
      const [ch, key] = k.split(":").map(Number) as [number, number];
      while (stack.length) {
        open++;
        close(ch, key, Math.max(end, stack[0]!.tick));
      }
    }
  });

  if (open) warnings.push(`止められていない音 ${open} 個を、トラックの終わりで止めました`);
  for (const [k, n] of Object.entries(dropped)) warnings.push(`${OTHER_NAMES[k] ?? k} ${n} 個は読み込んでいません`);

  const ids = new Set<string>();
  const uniqueId = (name: string) => {
    const base = name || "トラック";
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base} ${n}`;
    ids.add(id);
    return id;
  };
  const sorted = [...groups.values()].sort((a, b) => a.order - b.order);
  const tracks: Track[] = sorted.map((g) => {
    const t: Track = { id: uniqueId(g.name), instrument: g.instrument, notes: g.notes.sort((a, b) => a.t - b.t) };
    if (g.gain !== undefined) t.gain = g.gain;
    if (g.pan !== undefined) t.pan = g.pan;
    return t;
  });
  if (!tracks.length) {
    warnings.push("音符がありません");
    tracks.push({ instrument: "ピアノ", notes: [] });
    instruments.set("ピアノ", FAMILIES[0]!.layers);
  }

  const score: Score = {
    format: SCORE_FORMAT,
    time: useBeat ? beatTime(smf, bpm) : { unit: "sec" },
    instruments: Object.fromEntries([...instruments].map(([k, layers]) => [k, { layers: structuredClone(layers) }])),
    tracks,
  };
  return { score: normalizeScore(score), warnings };
}

const rank = (e: MidiEvent) => (e.type === "noteOff" ? 1 : e.type === "noteOn" ? 2 : 0);

function beatTime(smf: Smf, bpm: number): Score["time"] {
  const sig = smf.tracks.flatMap((t) => t.events).find((e): e is Extract<MidiEvent, { type: "timeSig" }> => e.type === "timeSig" && e.tick === 0);
  const ok = sig && sig.num >= 1 && sig.num <= 32 && [1, 2, 4, 8, 16, 32].includes(sig.den);
  return ok ? { unit: "beat", bpm, sig: [sig.num, sig.den] } : { unit: "beat", bpm };
}

// ---- 書き出し ----

export interface ScoreToMidiResult {
  smf: Smf;
  warnings: string[];
}

const PPQ = 480;

/** 音符の高さが音に効く楽器か（ratio を持つ層＝音符の pitch に対する倍率の発振器か録音の層がある） */
const pitched = (inst: Instrument | undefined) => !!inst?.layers.some((l) => "ratio" in l && l.ratio !== undefined);

/** dur の無い音符の長さ（秒）：いちばん長い層の a + d + r */
function naturalSeconds(inst: Instrument | undefined) {
  let m = 0;
  for (const l of inst?.layers ?? []) {
    const e = { ...ENV_DEFAULT, ...l.env };
    m = Math.max(m, e.a + e.d + e.r);
  }
  return m || ENV_DEFAULT.d;
}

/** 音符の MIDI ノート番号（音名・Hz と tune から。いちばん近い半音に丸める） */
function keyOf(n: Note, fallback: number) {
  let k: number;
  if (typeof n.pitch === "string") k = noteNameToMidi(n.pitch) ?? fallback;
  else if (typeof n.pitch === "number") k = 69 + 12 * Math.log2(n.pitch / 440);
  else k = fallback;
  return Math.max(0, Math.min(127, Math.round(k + (n.tune ?? 0) / 100)));
}

/** sfx-score を SMF（形式 1、PPQ 480）にする */
export function scoreToMidi(score: Score): ScoreToMidiResult {
  const warnings = ["音色（楽器の層）・雑音・フィルタ・残響・揺らぎは MIDI に入りません"];
  const time = score.time ?? { unit: "sec" as const };
  // 秒の score は 120 BPM（1 秒 = 2 拍）で書く
  const bpm = time.unit === "beat" ? time.bpm : 120;
  const beatsPer = time.unit === "beat" ? 1 : bpm / 60;
  const tick = (t: number) => Math.round(t * beatsPer * PPQ);

  const head: MidiEvent[] = [{ tick: 0, type: "tempo", usPerBeat: Math.round(60e6 / bpm) }];
  if (time.unit === "beat" && time.sig) head.push({ tick: 0, type: "timeSig", num: time.sig[0], den: time.sig[1] });

  const tracks = [{ events: head }];
  let nextCh = 0;
  let wrapped = false;
  let rounded = 0;
  for (const t of score.tracks) {
    const inst = score.instruments?.[t.instrument];
    const drum = !pitched(inst);
    let ch = DRUM_CH;
    if (!drum) {
      if (nextCh === DRUM_CH) nextCh++;
      if (nextCh > 15) {
        nextCh = 0;
        wrapped = true;
      }
      ch = nextCh++;
    }
    const events: MidiEvent[] = [{ tick: 0, type: "trackName", text: t.id ?? t.instrument }];
    const prog = programOf(t.instrument);
    if (!drum && prog !== null) events.push({ tick: 0, type: "program", ch, program: prog });
    if (t.gain !== undefined && t.gain !== 1) events.push({ tick: 0, type: "control", ch, cc: 7, value: Math.min(1, t.gain) * 127 });
    if (t.pan !== undefined && t.pan !== 0) events.push({ tick: 0, type: "control", ch, cc: 10, value: 64 + t.pan * 63 });
    const fallback = drum ? (KITS.find((k) => k.name === t.instrument)?.keys[0] ?? 38) : 69;
    const natural = naturalSeconds(inst) / (time.unit === "beat" ? 60 / bpm : 1);
    for (const n of t.notes) {
      const key = keyOf(n, fallback);
      if (typeof n.pitch === "number" || (n.tune ?? 0) % 100 !== 0) rounded++;
      const on = tick(n.t);
      const off = Math.max(on + 1, tick(n.t + (n.dur ?? natural)));
      const vel = Math.max(1, Math.round((n.vel ?? 1) * 127));
      events.push({ tick: on, type: "noteOn", ch, key, vel }, { tick: off, type: "noteOff", ch, key, vel: 0 });
    }
    tracks.push({ events });
  }
  if (rounded) warnings.push(`半音に丸めた音符が ${rounded} 個あります`);
  if (wrapped) warnings.push("トラックが 15 を超えたので、チャンネルを使い回しています");
  return { smf: { format: 1, ppq: PPQ, tracks }, warnings };
}
