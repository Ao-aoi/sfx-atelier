// 接触の出来事から音を作る（提案書 5.2、計画 M5b）。モーダル合成：物体の音を「減衰する正弦波の和」で近似する。
// - モード：材質ごとの周波数の比と強さ。周波数は大きさに反比例（同じ形なら半分の大きさで 2 倍）
// - 減衰：損失係数 η から T60 = ln(1000) ÷ (π f η) ≒ 2.2 ÷ (η f)。高いモードほど早く消える
// - 励起：ヘルツの接触。接触の時間 τ は速さの 1/5 乗に反比例（強く当たるほど短く＝硬く明るい音）。
//   力を長さ τ の半波の正弦とみなし、そのスペクトル |cos(π f τ)| ÷ |1 − (2 f τ)²| をモードの強さに掛ける
// - 強さ：モードの振幅は 力積 ÷ 質量（速度の変化）に比例
// - 当たりの雑音：中心 1/(2τ) の帯域雑音を短く
// 出力は、層の JSON（sfx-score。ランタイムで鳴らせる）と、サンプルの列（録音・分析用。5c で wav にする）の 2 つ。
import type { Instrument, Layer, Score, Track } from "@sfx-atelier/format/types";
import type { BodySpec, ContactEvent, Scene } from "./engine";
import { seeded } from "./engine";

/** 材質の音 */
export interface SoundMaterial {
  /** 大きさ REF_SIZE（3cm）のときの一番低いモードの周波数（Hz） */
  base: number;
  /** モード：[周波数の比, 強さ] */
  modes: [number, number][];
  /** 損失係数（大きいほど早く消える） */
  loss: number;
  /** 1 m/s で当たったときの接触の時間（秒）。柔らかいほど長い */
  contact: number;
  /** 当たりの雑音の強さ（モードの 1 番目に対する比）と、消えるまで（T60、秒） */
  noise: { gain: number; decay: number; q: number };
}

/** モードの周波数を決める基準の大きさ（m） */
export const REF_SIZE = 0.03;

/** 振幅が 1/1000（-60dB）になるまでの時間を出す係数：ln(1000) ÷ π */
const T60_K = Math.log(1000) / Math.PI;

/**
 * 材質の音の目安。周波数の比は、木・樹脂・石は板の曲げ、金属は自由な棒（1 : 2.76 : 5.40 : 8.93）、ガラスは厚い板に近い値。
 * 損失係数は文献の目安を丸めた値（金属 1e-4〜1e-3、ガラス 1e-3、木 1e-2 前後）。最後は耳で決める
 */
export const SOUND_MATERIALS: Record<string, SoundMaterial> = {
  wood: { base: 1200, modes: [[1, 1], [2.3, 0.6], [3.9, 0.35], [5.8, 0.2]], loss: 0.02, contact: 4e-4, noise: { gain: 0.5, decay: 0.02, q: 1.2 } },
  resin: { base: 2000, modes: [[1, 1], [2.4, 0.5], [4.1, 0.3], [6.2, 0.15]], loss: 0.01, contact: 2.5e-4, noise: { gain: 0.6, decay: 0.015, q: 1.4 } },
  metal: { base: 1500, modes: [[1, 1], [2.76, 0.7], [5.4, 0.45], [8.93, 0.3]], loss: 5e-4, contact: 1e-4, noise: { gain: 0.3, decay: 0.01, q: 2 } },
  glass: { base: 2500, modes: [[1, 1], [2.32, 0.6], [4.25, 0.4], [6.63, 0.25]], loss: 1e-3, contact: 1.2e-4, noise: { gain: 0.3, decay: 0.01, q: 2 } },
  stone: { base: 1800, modes: [[1, 1], [2.2, 0.6], [3.7, 0.4], [5.5, 0.25]], loss: 8e-3, contact: 1.5e-4, noise: { gain: 0.5, decay: 0.012, q: 1.5 } },
  felt: { base: 150, modes: [[1, 1], [1.8, 0.4]], loss: 0.3, contact: 3e-3, noise: { gain: 0.8, decay: 0.03, q: 0.8 } },
  rubber: { base: 300, modes: [[1, 1], [2.1, 0.3]], loss: 0.15, contact: 2e-3, noise: { gain: 0.4, decay: 0.02, q: 0.8 } },
};

/** 1 つのモード */
export interface Mode {
  freq: number;
  /** 振幅 */
  gain: number;
  /** T60（秒） */
  decay: number;
}

/** 1 回の当たりで 1 つの物体が鳴らす音 */
export interface Hit {
  /** 秒 */
  t: number;
  /** 鳴っている物体（体か平面）の id */
  source: string;
  modes: Mode[];
  noise: { freq: number; q: number; gain: number; decay: number } | null;
}

export interface SoundOptions {
  /** 材質の音の追加・上書き */
  materials?: Record<string, SoundMaterial>;
  /** 平面の大きさ（m、既定 1）。床・壁の低い音の高さを決める */
  planeSize?: number;
  /** 平面の質量の目安（kg、既定 5）。平面の鳴る強さ ＝ 力積 ÷ この値 */
  planeMass?: number;
  /** これより高いモードは捨てる（Hz、既定 20000） */
  maxFreq?: number;
}

/** T60 = ln(1000) ÷ (π f η) */
export function modeDecay(freq: number, loss: number): number {
  return T60_K / (freq * loss);
}

/** 接触の時間：τ = τ₁ × v^(−1/5)（ヘルツの接触。τ₁ は 1 m/s のとき） */
export function contactTime(contactAt1: number, speed: number): number {
  return contactAt1 * Math.pow(Math.max(speed, 1e-6), -0.2);
}

/** 長さ τ の半波の正弦の力のスペクトル（f = 0 で 1 に揃えた大きさ） */
export function pulseSpectrum(freq: number, tau: number): number {
  const x = 2 * freq * tau;
  // x = 1 は 0/0。極限は π/4
  if (Math.abs(1 - x * x) < 1e-9) return Math.PI / 4;
  return Math.abs(Math.cos(Math.PI * freq * tau) / (1 - x * x));
}

function soundMaterial(name: string, opts: SoundOptions): SoundMaterial {
  const m = opts.materials?.[name] ?? SOUND_MATERIALS[name];
  if (!m) throw new Error(`材質の音がありません: ${name}`);
  return m;
}

/** 物体の大きさ（球は直径、箱はいちばん長い辺） */
function sizeOf(b: BodySpec): number {
  return b.shape === "sphere" ? 2 * b.radius : Math.max(...b.size);
}

/** 物体が力積 J で叩かれたときの音（τ は接触の時間） */
export function hitOf(
  t: number,
  source: string,
  mat: SoundMaterial,
  size: number,
  mass: number,
  impulse: number,
  tau: number,
  maxFreq = 20000,
): Hit {
  const dv = impulse / mass;
  const f0 = (mat.base * REF_SIZE) / size;
  const modes: Mode[] = [];
  for (const [ratio, g] of mat.modes) {
    const freq = f0 * ratio;
    if (freq > maxFreq) continue;
    const gain = g * dv * pulseSpectrum(freq, tau);
    if (gain <= 0) continue;
    modes.push({ freq, gain, decay: modeDecay(freq, mat.loss) });
  }
  const nf = Math.min(maxFreq, 1 / (2 * tau));
  const noise = mat.noise.gain > 0 ? { freq: nf, q: mat.noise.q, gain: mat.noise.gain * dv, decay: mat.noise.decay } : null;
  return { t, source, modes, noise };
}

/** 接触の出来事の列 → 当たりの列（a と b の両方が鳴る） */
export function hitsOf(scene: Scene, events: ContactEvent[], opts: SoundOptions = {}): Hit[] {
  const bodies = new Map(scene.bodies.map((b) => [b.id, b]));
  const planes = new Map((scene.planes ?? []).map((p) => [p.id, p]));
  const planeSize = opts.planeSize ?? 1;
  const planeMass = opts.planeMass ?? 5;
  const maxFreq = opts.maxFreq ?? 20000;
  const hits: Hit[] = [];
  for (const e of events) {
    const ma = soundMaterial(e.materials[0], opts);
    const mb = soundMaterial(e.materials[1], opts);
    // 柔らかい方が接触の時間を決める
    const tau = contactTime(Math.max(ma.contact, mb.contact), e.speed);
    for (const [id, mat] of [[e.a, ma], [e.b, mb]] as const) {
      const body = bodies.get(id);
      if (body) {
        // 固定の物体は平面と同じく重いものとして扱う
        const mass = body.fixed ? planeMass : body.mass!;
        hits.push(hitOf(e.t, id, mat, sizeOf(body), mass, e.impulse, tau, maxFreq));
      } else if (planes.has(id)) {
        hits.push(hitOf(e.t, id, mat, planeSize, planeMass, e.impulse, tau, maxFreq));
      }
    }
  }
  return hits;
}

// ---- 層の JSON（sfx-score）へ ----

/** ランタイムの指数のエンベロープは、振幅 1/10000 で無音とみなす（runtime の FLOOR） */
export const ENV_FLOOR = 1e-4;
/** T60（-60dB まで）→ エンベロープの d（-80dB まで） */
const T60_TO_D = Math.log(1 / ENV_FLOOR) / Math.log(1000);

/** 1 つの当たりを楽器の層にする。強さは gain で割る（いちばん強い当たりを 1 に揃えるため） */
export function hitLayers(hit: Hit, scale = 1): Layer[] {
  const layers: Layer[] = hit.modes.map((m) => ({ osc: "sine", freq: m.freq, gain: m.gain * scale, env: { a: 0, d: m.decay * T60_TO_D } }));
  if (hit.noise)
    layers.push({
      noise: "white",
      filter: { type: "bandpass", freq: hit.noise.freq, q: hit.noise.q },
      gain: hit.noise.gain * scale,
      env: { a: 0, d: hit.noise.decay * T60_TO_D },
    });
  return layers;
}

const loudness = (h: Hit) => h.modes.reduce((s, m) => s + m.gain, 0) + (h.noise?.gain ?? 0);

/**
 * 当たりの列 → sfx-score。物体ごとに 1 つの楽器（いちばん強い当たりの音色）を作り、当たりを音符にする（vel は強さの比）。
 * 弱い当たりの音色（明るさ）の違いは落ちる。いちばん強い当たりの層の強さの合計を 1 に揃える
 */
export function toScore(hits: Hit[]): Score {
  const instruments: Record<string, Instrument> = {};
  const tracks: Track[] = [];
  const top = Math.max(0, ...hits.map(loudness));
  const scale = top > 0 ? 1 / top : 1;
  const sources = [...new Set(hits.map((h) => h.source))];
  for (const source of sources) {
    const mine = hits.filter((h) => h.source === source);
    const strongest = mine.reduce((p, q) => (loudness(q) > loudness(p) ? q : p));
    const peak = loudness(strongest);
    if (peak <= 0) continue;
    instruments[source] = { layers: hitLayers(strongest, scale) };
    tracks.push({ id: source, instrument: source, notes: mine.map((h) => ({ t: h.t, vel: loudness(h) / peak })) });
  }
  return { format: "sfx-score/1", instruments, tracks };
}

// ---- サンプルの列へ（録音・分析用） ----

export interface RenderOptions {
  sampleRate?: number;
  /** 長さ（秒）。既定は最後の当たりの後、いちばん長い T60 まで */
  seconds?: number;
  /** 雑音の種 */
  seed?: number;
}

/**
 * 当たりの列をモノラルのサンプルにする。モードは a·e^(−t/τ)·sin(2πft)（τ = T60 ÷ ln 1000）、
 * 雑音は種つきの白色雑音を 2 次の帯域フィルタ（RBJ の式）に通して同じように減衰させる。正規化はしない
 */
export function renderHits(hits: Hit[], opts: RenderOptions = {}): Float32Array {
  const sr = opts.sampleRate ?? 48000;
  const longest = Math.max(0, ...hits.map((h) => h.t + Math.max(0, ...h.modes.map((m) => m.decay), h.noise?.decay ?? 0)));
  const seconds = opts.seconds ?? longest;
  const n = Math.max(0, Math.ceil(seconds * sr));
  const out = new Float32Array(n);
  const acc = new Float64Array(n);
  const random = seeded(opts.seed ?? 1);
  const ln1000 = Math.log(1000);
  for (const h of hits) {
    const start = Math.round(h.t * sr);
    for (const m of h.modes) {
      const len = Math.min(n - start, Math.ceil(m.decay * sr));
      const k = ln1000 / (m.decay * sr);
      const w = (2 * Math.PI * m.freq) / sr;
      for (let i = 0; i < len; i++) acc[start + i]! += m.gain * Math.exp(-k * i) * Math.sin(w * i);
    }
    if (h.noise && h.noise.freq < sr / 2) {
      const { b0, b2, a1, a2 } = bandpass(h.noise.freq, h.noise.q, sr);
      const len = Math.min(n - start, Math.ceil(h.noise.decay * sr));
      const k = ln1000 / (h.noise.decay * sr);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < len; i++) {
        const x = random() * 2 - 1;
        const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        acc[start + i]! += h.noise.gain * Math.exp(-k * i) * y;
      }
    }
  }
  for (let i = 0; i < n; i++) out[i] = acc[i]!;
  return out;
}

/** RBJ の帯域フィルタ（ピークの利得 0dB）。b1 = 0 */
function bandpass(freq: number, q: number, sr: number) {
  const w = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b2: -alpha / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - alpha) / a0 };
}
