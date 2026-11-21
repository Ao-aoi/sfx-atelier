// 持続するピーク → 減衰する正弦波の成分（周波数・ピッチ変化・減衰・強さ）。
import type { Stft } from "@sfx-atelier/analysis";
import { energyOf, FLOOR, lineFit, windowGain, type OscComponent } from "./components";
import type { Track } from "./tracks";

/** ピッチ変化を付ける境目（d の間の変化がこの比を超えたら pitchEnv を付ける） */
const GLIDE = 1.03;

/** 成分の始まり：振幅が山の半分に達したフレームの中心（窓の中心が始まりを通る頃に半分になる） */
export function trackStart(s: Stft, t: Track): number {
  let top = 0;
  for (const p of t.peaks) top = Math.max(top, p.mag);
  const p = t.peaks.find((q) => q.mag >= top / 2)!;
  return (p.frame * s.hop + s.size / 2) / s.sampleRate;
}

/** 新しい始まりの手がかりにする成分の大きさ（全体の最大から -30dB 以上） */
const ONSET_LEVEL = 10 ** (-30 / 20);

/** 音程のある成分の始まり（大きい成分だけ）。音量では分からない、重なった音の始まりを拾う */
export function tonalOnsets(s: Stft, tracks: Track[]): number[] {
  let max = 0;
  for (const t of tracks) for (const p of t.peaks) max = Math.max(max, p.mag);
  return tracks.filter((t) => t.peaks.some((p) => p.mag >= max * ONSET_LEVEL)).map((t) => trackStart(s, t));
}

/** 始まりの番号を選ぶ：成分の始まり以前で最も近いもの（少し後ろにずれていても許す） */
export function assignOnset(onsets: number[], start: number): number {
  let best = 0;
  for (let i = 0; i < onsets.length; i++) if (onsets[i]! <= start + 0.01) best = i;
  return best;
}

/**
 * 1 本の成分を当てはめる。窓が始まり（＋立ち上がり）より後ろだけを見るフレームで、
 * log(振幅) を時刻の直線で当てはめて減衰を、log(周波数) で当てはめてピッチ変化を出す。
 */
export function fitTrack(s: Stft, t: Track, onsets: number[], attacks: number[]): OscComponent | null {
  const onset = assignOnset(onsets, trackStart(s, t));
  const t0 = onsets[onset] ?? 0;
  const attack = attacks[onset] ?? 0.001;
  const startOf = (f: number) => (f * s.hop) / s.sampleRate;
  let use = t.peaks.filter((p) => startOf(p.frame) >= t0 + attack - 1e-9);
  if (use.length < 2) {
    // 短すぎるときは山から後ろを使う
    let top = 0, at = 0;
    t.peaks.forEach((p, i) => { if (p.mag > top) { top = p.mag; at = i; } });
    use = t.peaks.slice(at);
  }
  if (use.length < 2) return null;
  const xs = use.map((p) => startOf(p.frame));
  const ws = use.map((p) => p.mag * p.mag);
  const amp = lineFit(xs, use.map((p) => Math.log(p.mag)), ws);
  if (!amp) return null;
  const span = xs.at(-1)! - xs[0]! + s.size / s.sampleRate;
  // 減衰しない（持続する）成分は、見えている長さで少なくとも 20dB 下がるとみなす
  const alpha = Math.max(-amp.b, Math.log(10) / Math.max(span, 1e-3));
  const magAtOnset = Math.exp(amp.a + amp.b * t0);
  const a0 = (2 * magAtOnset) / windowGain(s.size, s.sampleRate, alpha, 1);
  const top = a0 * Math.exp(-alpha * attack);
  if (top <= FLOOR * 2) return null;

  // 周波数：窓の中心の時刻で当てはめ、始まりの値と d 秒後の値を出す
  const centers = use.map((p) => startOf(p.frame) + s.size / 2 / s.sampleRate);
  const fr = lineFit(centers, use.map((p) => Math.log(p.hz)), ws)!;
  const hz = Math.exp(fr.a + fr.b * t0);
  const d = Math.log(top / FLOOR) / alpha;
  const end = Math.exp(fr.a + fr.b * (t0 + d));
  const c: OscComponent = { kind: "osc", onset, a: attack, top, alpha, energy: energyOf(top, alpha, "osc"), hz };
  if (end / hz > GLIDE || hz / end > GLIDE) c.toHz = end;
  return c;
}
