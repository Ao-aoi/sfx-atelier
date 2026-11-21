// 聞き比べの基準：mahjong-sensei の web/src/audio/sfx.ts（e48ef53）の合成部分を、乱数を差し替えられる形に写したもの。
// 音を変えないこと（基準が動くと比べられなくなる）。変えたのは次の 3 点だけ：
// - Math.random を引数の random に置き換えた
// - AudioContext を外から渡す（OfflineAudioContext で描画するため）
// - 音量の保存・解錠・対局の出来事への対応は持たない（比べるのは音だけ）

export type ReferenceName =
  | "select" | "discard" | "draw" | "call" | "kan" | "riichi" | "win" | "win-other"
  | "ryukyoku" | "open" | "close" | "ui" | "rise" | "deal" | "sticks" | "pop";

export const REFERENCE_NAMES: ReferenceName[] = [
  "select", "discard", "draw", "call", "kan", "riichi", "win", "win-other",
  "ryukyoku", "open", "close", "ui", "rise", "deal", "sticks", "pop",
];

export interface ReferencePlayOptions {
  pan?: number;
  gain?: number;
  delay?: number;
}

type Random = () => number;

class Synth {
  private noise: AudioBuffer;
  readonly dry: GainNode;
  readonly wet: GainNode;

  constructor(
    private ctx: BaseAudioContext,
    out: AudioNode,
    private random: Random,
  ) {
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = this.random() * 2 - 1;

    this.dry = ctx.createGain();
    this.dry.connect(out);
    const verb = ctx.createConvolver();
    verb.buffer = this.roomImpulse(0.7);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.16;
    this.wet.connect(verb).connect(out);
  }

  private roomImpulse(seconds: number): AudioBuffer {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const b = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (this.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return b;
  }

  bus(gain: number, pan: number, wet = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node: AudioNode = g;
    if (pan !== 0) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      node = p;
    }
    node.connect(this.dry);
    if (wet > 0) {
      const w = this.ctx.createGain();
      w.gain.value = wet;
      node.connect(w).connect(this.wet);
    }
    return g;
  }

  noiseHit(out: AudioNode, t: number, o: { freq: number; q: number; gain: number; decay: number; type?: BiquadFilterType; attack?: number }): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = o.type ?? "bandpass";
    f.frequency.value = o.freq;
    f.Q.value = o.q;
    const g = this.ctx.createGain();
    const a = o.attack ?? 0.001;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, this.random() * 0.5, a + o.decay + 0.02);
  }

  tone(out: AudioNode, t: number, o: { freq: number; gain: number; decay: number; to?: number; attack?: number; type?: OscillatorType }): void {
    const osc = this.ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.decay);
    const g = this.ctx.createGain();
    const a = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.decay);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + a + o.decay + 0.02);
  }

  clack(out: AudioNode, t: number, p = 1, power = 1): void {
    this.noiseHit(out, t, { freq: 3400 * p, q: 1.4, gain: 0.55 * power, decay: 0.035 });
    this.noiseHit(out, t, { freq: 7800 * p, q: 2.5, gain: 0.12 * power, decay: 0.012 });
    this.tone(out, t, { freq: 1180 * p, gain: 0.22 * power, decay: 0.055 });
    this.tone(out, t, { freq: 2730 * p, gain: 0.1 * power, decay: 0.028 });
    this.tone(out, t, { freq: 190 * p, to: 95, gain: 0.5 * power, decay: 0.09 });
  }

  tick(out: AudioNode, t: number, p = 1): void {
    this.noiseHit(out, t, { freq: 4800 * p, q: 2, gain: 0.25, decay: 0.018 });
    this.tone(out, t, { freq: 1900 * p, gain: 0.16, decay: 0.035 });
  }

  bell(out: AudioNode, t: number, freq: number, gain: number, decay = 1.1): void {
    this.tone(out, t, { freq, gain, decay, attack: 0.004 });
    this.tone(out, t, { freq: freq * 2.76, gain: gain * 0.25, decay: decay * 0.4, attack: 0.002 });
    this.tone(out, t, { freq: freq * 5.4, gain: gain * 0.08, decay: decay * 0.15, attack: 0.001 });
  }
}

/** 基準の音を ctx に鳴らす準備をする。乱数は 白色雑音 → 残響 → 鳴らすたびの揺らぎ の順に引く */
export function createReference(ctx: BaseAudioContext, random: Random, out: AudioNode = ctx.destination) {
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.ratio.value = 4;
  comp.attack.value = 0.002;
  comp.release.value = 0.12;
  master.connect(comp).connect(out);
  const s = new Synth(ctx, master, random);
  const jitter = (amount = 0.04) => 1 + (random() * 2 - 1) * amount;

  return function play(name: ReferenceName, opts: ReferencePlayOptions = {}, at = ctx.currentTime): void {
    const t = at + 0.005 + (opts.delay ?? 0);
    const gain = opts.gain ?? 1;
    const pan = opts.pan ?? 0;
    switch (name) {
      case "select":
        s.tick(s.bus(0.8 * gain, pan, 0.4), t, jitter(0.03));
        break;
      case "discard":
        s.clack(s.bus(gain, pan), t, jitter());
        break;
      case "draw": {
        const o = s.bus(0.7 * gain, pan, 0.5);
        s.noiseHit(o, t, { freq: 2200, q: 0.8, gain: 0.12, decay: 0.07, attack: 0.03, type: "bandpass" });
        s.tick(o, t + 0.08, 0.8 * jitter(0.03));
        break;
      }
      case "call": {
        const o = s.bus(1.05 * gain, pan);
        s.clack(o, t, 0.95 * jitter(), 0.9);
        s.clack(o, t + 0.065, 1.02 * jitter(), 1);
        break;
      }
      case "kan": {
        const o = s.bus(1.05 * gain, pan);
        for (let i = 0; i < 4; i++) s.clack(o, t + i * 0.055, (0.92 + i * 0.03) * jitter(0.02), 0.75 + i * 0.08);
        break;
      }
      case "riichi": {
        const o = s.bus(gain, pan);
        s.noiseHit(o, t, { freq: 5200, q: 3, gain: 0.35, decay: 0.03 });
        s.tone(o, t, { freq: 2350, gain: 0.12, decay: 0.05 });
        s.bell(o, t + 0.06, 1568, 0.16, 0.9);
        s.bell(o, t + 0.14, 2093, 0.12, 1.0);
        break;
      }
      case "win": {
        const o = s.bus(gain, pan, 1.4);
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => s.bell(o, t + i * 0.085, f, 0.2 - i * 0.02, 1.5));
        break;
      }
      case "win-other": {
        const o = s.bus(0.8 * gain, pan, 1.2);
        s.bell(o, t, 784, 0.16, 1.0);
        s.bell(o, t + 0.12, 1046.5, 0.12, 1.1);
        break;
      }
      case "ryukyoku": {
        const o = s.bus(0.7 * gain, pan, 1.2);
        s.bell(o, t, 659, 0.13, 0.9);
        s.bell(o, t + 0.18, 523, 0.13, 1.1);
        break;
      }
      case "open": {
        const o = s.bus(0.6 * gain, pan, 0.6);
        s.tone(o, t, { freq: 520, to: 820, gain: 0.22, decay: 0.07, attack: 0.006 });
        s.noiseHit(o, t, { freq: 1800, q: 0.7, gain: 0.05, decay: 0.06, attack: 0.02 });
        break;
      }
      case "close": {
        const o = s.bus(0.6 * gain, pan, 0.6);
        s.tone(o, t, { freq: 760, to: 480, gain: 0.2, decay: 0.07, attack: 0.006 });
        break;
      }
      case "ui":
        s.tick(s.bus(0.55 * gain, pan, 0.3), t, 1.15 * jitter(0.02));
        break;
      case "rise": {
        const o = s.bus(0.9 * gain, pan, 0.8);
        s.noiseHit(o, t, { freq: 420, q: 0.6, gain: 0.14, decay: 0.32, attack: 0.25, type: "bandpass" });
        s.tone(o, t + 0.3, { freq: 120, to: 55, gain: 0.6, decay: 0.2 });
        s.noiseHit(o, t + 0.3, { freq: 900, q: 0.8, gain: 0.18, decay: 0.06 });
        break;
      }
      case "deal":
        s.clack(s.bus(0.32 * gain, pan, 0.5), t, 1.08 * jitter(0.05), 0.6);
        break;
      case "sticks": {
        const o = s.bus(0.55 * gain, pan, 0.6);
        s.noiseHit(o, t, { freq: 4600 * jitter(0.08), q: 2.5, gain: 0.3, decay: 0.025 });
        s.tone(o, t, { freq: 1650 * jitter(0.05), gain: 0.1, decay: 0.04 });
        s.noiseHit(o, t + 0.05, { freq: 5200 * jitter(0.08), q: 3, gain: 0.16, decay: 0.02 });
        break;
      }
      case "pop": {
        const o = s.bus(0.6 * gain, pan, 0.5);
        s.tone(o, t, { freq: 330, to: 700, gain: 0.2, decay: 0.08, attack: 0.004 });
        s.tone(o, t + 0.08, { freq: 620, to: 500, gain: 0.12, decay: 0.12, attack: 0.004 });
        break;
      }
    }
  };
}
