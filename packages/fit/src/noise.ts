// 残差（音程のある成分を除いたスペクトル）の帯域包絡 → 減衰する帯域雑音の成分（提案書 6.2 の D）。
import type { Stft } from "@sfx-atelier/analysis";
import { energyOf, FLOOR, lineFit, windowGain, type NoiseComponent } from "./components";
import type { Track } from "./tracks";

/** 帯域の境目（Hz）。12 帯域、バーク尺度に近い間隔 */
export const BAND_EDGES = [60, 150, 300, 500, 800, 1200, 1800, 2700, 4000, 5800, 8500, 12000, 16000] as const;
/** 音程のある成分の周りで除くビンの幅（±）。ハン窓の主葉は ±2 ビン */
const MASK = 4;
/** 除いた残りがこれより少ない帯域・フレームは測らない */
const MIN_BINS = 3;
/** ランタイムの白色雑音（-1〜1 の一様乱数）の RMS */
export const WHITE_RMS = 1 / Math.sqrt(3);

/**
 * 帯域ごと・フレームごとの残差のパワー（片側の振幅² の和）。
 * 除いたビンの分は、帯域のビン数との比で補う。
 */
export function bandPower(s: Stft, tracks: Track[]): Float64Array[] {
  // 成分が見え始めた 1 フレーム前から最後まで、直近のピークの周りを除く。
  // 見えなくなった後も小さく鳴り続けているので、最後まで除く（除かないと、残差に尾が残り、帯域雑音として大きく戻ってしまう）
  const masked = s.frames.map(() => new Set<number>());
  for (const t of tracks) {
    const first = t.peaks[0]!.frame;
    let i = 0;
    for (let f = Math.max(0, first - 1); f < s.frames.length; f++) {
      while (i + 1 < t.peaks.length && t.peaks[i + 1]!.frame <= f) i++;
      const k = Math.round(t.peaks[i]!.bin);
      for (let j = k - MASK; j <= k + MASK; j++) masked[f]!.add(j);
    }
  }
  const binHz = s.sampleRate / s.size;
  const nyq = s.sampleRate / 2;
  return BAND_EDGES.slice(0, -1).map((lo, b) => {
    const hi = Math.min(BAND_EDGES[b + 1]!, nyq);
    const k0 = Math.max(1, Math.ceil(lo / binHz)), k1 = Math.floor(hi / binHz);
    return Float64Array.from(s.frames, (mag, f) => {
      let e = 0, n = 0;
      for (let k = k0; k < k1 && k < mag.length; k++) {
        if (masked[f]!.has(k)) continue;
        e += mag[k]! * mag[k]!;
        n++;
      }
      // 帯域のほとんどを除いたときは、漏れを大きく見積もらないように測らない
      return n >= MIN_BINS ? (e * (k1 - k0)) / n : 0;
    });
  });
}

/**
 * 帯域ごとに、始まりから次の始まりまでの区間で減衰を当てはめる。
 * 帯域の RMS r(s)² ≈ 2E / (N Σ w² e^(-2αn))、帯域通過フィルタを通した白色雑音の RMS は
 * σ √(ENBW / (sr/2))、ENBW = π/2 × 中心 / Q（RBJ の bandpass、山は 0dB）。
 */
export function fitNoise(s: Stft, tracks: Track[], onsets: number[], attacks: number[], end: number): NoiseComponent[] {
  const power = bandPower(s, tracks);
  const startOf = (f: number) => (f * s.hop) / s.sampleRate;
  const nyq = s.sampleRate / 2;
  const out: NoiseComponent[] = [];
  power.forEach((pw, b) => {
    const lo = BAND_EDGES[b]!, hi = Math.min(BAND_EDGES[b + 1]!, nyq * 0.95);
    if (hi <= lo) return;
    const hz = Math.sqrt(lo * hi), q = hz / (hi - lo);
    const unit = WHITE_RMS * Math.sqrt(((Math.PI / 2) * (hi - lo)) / nyq);
    onsets.forEach((t0, i) => {
      const t1 = onsets[i + 1] ?? end;
      const attack = attacks[i] ?? 0.001;
      const frames: number[] = [];
      for (let f = 0; f < pw.length; f++) {
        const st = startOf(f);
        // 次の始まりに窓がかからないフレームだけ。足りなければ窓の中心が次の始まりより前まで
        if (st >= t0 + attack - 1e-9 && st + s.size / s.sampleRate <= t1 && pw[f]! > 0) frames.push(f);
      }
      if (frames.length < 2) {
        frames.length = 0;
        for (let f = 0; f < pw.length; f++) {
          const st = startOf(f);
          if (st >= t0 + attack - 1e-9 && st + s.size / s.sampleRate / 2 <= t1 && pw[f]! > 0) frames.push(f);
        }
      }
      // 始まりの直後から見えていない帯域は当てはめない（尾だけから戻すと大きく外れる）
      if (frames.length < 2 || startOf(frames[0]!) > t0 + attack + 3 * s.hop / s.sampleRate) return;
      let peak = 0;
      for (const f of frames) peak = Math.max(peak, pw[f]!);
      const use = frames.filter((f) => pw[f]! >= peak * 1e-5);
      // 振幅 ∝ √パワー なので log(振幅) = log(パワー) / 2
      const fit = lineFit(use.map(startOf), use.map((f) => Math.log(pw[f]!) / 2), use.map((f) => pw[f]!));
      if (!fit) return;
      const span = startOf(use.at(-1)!) - startOf(use[0]!) + s.size / s.sampleRate;
      const alpha = Math.max(-fit.b, Math.log(10) / Math.max(span, 1e-3));
      const e0 = Math.exp(2 * (fit.a + fit.b * t0));
      const r0 = Math.sqrt((2 * e0) / (s.size * windowGain(s.size, s.sampleRate, alpha, 2)));
      const top = (r0 / unit) * Math.exp(-alpha * attack);
      if (top <= FLOOR * 2) return;
      out.push({ kind: "noise", onset: i, a: attack, top, alpha, energy: energyOf(r0, alpha, "noise"), hz, q });
    });
  });
  return out;
}
