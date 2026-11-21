// 予定表 → Web Audio のノード。共有するもの（雑音・残響・マスター）は最初に 1 回だけ作る。
import { COMPRESSOR_DEFAULT, MASTER_DEFAULT, REVERB_DEFAULT } from "@sfx-atelier/format/defaults";
import type { Master, NoiseType, Reverb } from "@sfx-atelier/format/types";
import type { Random } from "./compile";
import type { Automation, Plan } from "./plan";

/** 雑音バッファの長さ（秒）。声はこれを繰り返し読む */
export const NOISE_SECONDS = 1;

export interface Shared {
  ctx: BaseAudioContext;
  /** マスターの入口（音量 → コンプレッサー → 出力） */
  input: GainNode;
  master: GainNode;
  noise: Partial<Record<NoiseType, AudioBuffer>>;
  reverbs: Record<string, GainNode>;
  samples: Record<string, AudioBuffer>;
  random: Random;
}

export interface SharedSetup {
  master?: Master;
  reverb?: Record<string, Reverb>;
}

/** 雑音を作る。pink は Paul Kellet の近似、brown は白色雑音の積分 */
export function makeNoise(ctx: BaseAudioContext, type: NoiseType, random: Random): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = random() * 2 - 1;
    if (type === "white") d[i] = w;
    else if (type === "pink") {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

/** 部屋の残響のインパルス応答：減衰する雑音（ステレオ）。(1 - i/n)^decay で消える */
export function makeImpulse(ctx: BaseAudioContext, r: Reverb, random: Random): AudioBuffer {
  const n = Math.max(1, Math.floor(ctx.sampleRate * r.seconds));
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (random() * 2 - 1) * Math.pow(1 - i / n, r.decay);
  }
  return buf;
}

/** 共有の部品を作る。乱数は 白色雑音 → 残響（名前の順）の順に引く。ほかの雑音は使うときに作る */
export function createShared(ctx: BaseAudioContext, setup: SharedSetup, random: Random, out: AudioNode = ctx.destination): Shared {
  const master = ctx.createGain();
  master.gain.value = setup.master?.gain ?? MASTER_DEFAULT.gain;
  const c = setup.master?.compressor;
  if (c) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = c.threshold ?? COMPRESSOR_DEFAULT.threshold;
    comp.knee.value = c.knee ?? COMPRESSOR_DEFAULT.knee;
    comp.ratio.value = c.ratio ?? COMPRESSOR_DEFAULT.ratio;
    comp.attack.value = c.attack ?? COMPRESSOR_DEFAULT.attack;
    comp.release.value = c.release ?? COMPRESSOR_DEFAULT.release;
    master.connect(comp).connect(out);
  } else master.connect(out);

  const shared: Shared = { ctx, input: master, master, noise: {}, reverbs: {}, samples: {}, random };
  shared.noise.white = makeNoise(ctx, "white", random);
  for (const name of Object.keys(setup.reverb ?? {}).sort()) {
    const r = setup.reverb![name]!;
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, r, random);
    const wet = ctx.createGain();
    wet.gain.value = r.wet ?? REVERB_DEFAULT.wet;
    // 送り（GainNode）→ 残響 → wet → マスター
    const send = ctx.createGain();
    send.connect(conv).connect(wet).connect(master);
    shared.reverbs[name] = send;
  }
  return shared;
}

function apply(param: AudioParam, auto: Automation, when: number) {
  for (const [kind, t, v] of auto) {
    const at = when + t;
    if (kind === "set") param.setValueAtTime(v, at);
    else if (kind === "lin") param.linearRampToValueAtTime(v, at);
    // 指数カーブは 0 以下に向かえない
    else param.exponentialRampToValueAtTime(Math.max(v, 1e-4), at);
  }
}

export interface Playing {
  /** 残響の尾まで含めて鳴り終わる時刻（ctx の時刻） */
  end: number;
  /** 声の数（同時発音数の数え方に使う） */
  voices: number;
  /** すぐに止める */
  stop(): void;
}

/** 予定表を when（ctx の時刻）から鳴らす */
export function render(shared: Shared, plan: Plan, when: number): Playing {
  const { ctx } = shared;
  const sources: AudioScheduledSourceNode[] = [];
  const outs: AudioNode[] = [];

  const buses = plan.buses.map((b) => {
    const g = ctx.createGain();
    g.gain.value = b.gain * plan.gain;
    let node: AudioNode = g;
    if (b.pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = b.pan;
      node = g.connect(p);
    }
    node.connect(shared.input);
    for (const [name, amount] of b.sends) {
      const s = ctx.createGain();
      s.gain.value = amount;
      node.connect(s).connect(shared.reverbs[name]!);
      outs.push(s);
    }
    outs.push(node);
    return g;
  });

  for (const v of plan.voices) {
    let src: AudioScheduledSourceNode;
    const s = v.source;
    if (s.kind === "osc") {
      const o = ctx.createOscillator();
      o.type = s.type;
      apply(o.frequency, s.freq, when);
      src = o;
    } else if (s.kind === "noise") {
      const b = ctx.createBufferSource();
      b.buffer = shared.noise[s.type] ??= makeNoise(ctx, s.type, shared.random);
      b.loop = true;
      src = b;
    } else {
      const buffer = shared.samples[s.sample];
      // 読み込みが済んでいない録音は鳴らさない（ready を待てば必ずある）
      if (!buffer) continue;
      const b = ctx.createBufferSource();
      b.buffer = buffer;
      apply(b.playbackRate, s.rate, when);
      src = b;
    }

    let node: AudioNode = src;
    if (v.filter) {
      const f = ctx.createBiquadFilter();
      f.type = v.filter.type;
      f.frequency.value = Math.min(v.filter.freq, ctx.sampleRate / 2);
      f.Q.value = v.filter.q;
      f.gain.value = v.filter.gain;
      node = node.connect(f);
    }
    const g = ctx.createGain();
    g.gain.value = 0;
    apply(g.gain, v.gain, when);
    node = node.connect(g);
    if (v.pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = v.pan;
      node = node.connect(p);
    }
    node.connect(buses[v.bus]!);

    if (s.kind === "noise") (src as AudioBufferSourceNode).start(when + v.start, s.offset);
    else src.start(when + v.start);
    src.stop(when + v.stop);
    sources.push(src);
  }

  // 最後の声が止まったら、出口のノードを外す（残響の尾は共有の残響に残る）
  let ended = sources.length;
  for (const src of sources) {
    src.onended = () => {
      if (--ended === 0) for (const n of [...buses, ...outs]) n.disconnect();
    };
  }

  return {
    end: when + plan.tail,
    voices: sources.length,
    stop() {
      const now = ctx.currentTime;
      for (const src of sources) {
        try {
          src.stop(now);
        } catch {
          // まだ start していない・もう止まっている
        }
      }
    },
  };
}
