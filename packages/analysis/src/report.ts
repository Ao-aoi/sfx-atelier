// 要約の形式 analysis-report/1：Claude に貼る文章。80 行以内、指摘は MAX_FINDINGS 個まで。
// mahjong-sensei の summary と同じく、生のデータ（波形・スペクトル）は入れない。
import type { Filter, Instrument, Layer, Score } from "@sfx-atelier/format/types";
import type { Features } from "./features";
import type { SfxMetrics } from "./sfx";
import { symbolic } from "./symbolic";

export const REPORT_FORMAT = "analysis-report/1";
export const MAX_LINES = 80;
export const MAX_FINDINGS = 5;
/** 構成の欄に書く層の数の上限（超えた分は数だけ書く） */
export const MAX_LAYER_LINES = 24;

export interface ReportInput {
  name: string;
  score: Score;
  /** 描画した音の指標（無ければ測定の欄を省く） */
  metrics?: SfxMetrics;
  /** 帯域の比などに使う（無ければ省く） */
  features?: Pick<Features, "bandRatios">;
}

export interface Finding {
  /** 大きいほど先に出す */
  weight: number;
  text: string;
}

const ms = (s: number) => `${Math.round(s * 1000)}ms`;
const sec = (s: number) => (s < 1 ? ms(s) : `${s.toFixed(2)}秒`);
const db = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}dB` : "無音");
const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => String(Math.round(v * 1000) / 1000);

function filterText(f: Filter): string {
  return `${f.type} ${num(f.freq)}Hz` + (f.q !== undefined ? ` q${num(f.q)}` : "") + (f.gain ? ` ${num(f.gain)}dB` : "");
}

export function layerText(l: Layer): string {
  const parts: string[] = [];
  if ("osc" in l) parts.push(`osc ${l.osc}`, l.ratio !== undefined ? `×${num(l.ratio)}` : l.freq !== undefined ? `${num(l.freq)}Hz` : "");
  else if ("noise" in l) parts.push(`noise ${l.noise}`);
  else parts.push(`sample ${l.sample}`, l.ratio !== undefined ? `×${num(l.ratio)}` : "");
  if (l.filter) parts.push(filterText(l.filter));
  if (l.gain !== undefined) parts.push(`gain ${num(l.gain)}`);
  if (l.pan) parts.push(`pan ${num(l.pan)}`);
  const e = l.env;
  if (e) {
    const env = (["a", "d", "s", "r"] as const).filter((k) => e[k] !== undefined).map((k) => `${k}${num(e[k]!)}`);
    if (e.curve) env.push(e.curve);
    if (env.length) parts.push(`env ${env.join(" ")}`);
  }
  if (l.pitchEnv) {
    const p = l.pitchEnv;
    parts.push(`pitchEnv ${p.toHz !== undefined ? `→${num(p.toHz)}Hz` : `${num(p.cents ?? 0)}c`} ${p.time === "decay" ? "decay" : num(p.time)}`);
  }
  if (l.jitter) parts.push(`jitter ${JSON.stringify(l.jitter)}`);
  return parts.filter(Boolean).join(" · ");
}

/** 1 回鳴らしたときの「音符 × 層」の数（ランタイムの声の数の目安） */
export function voiceCount(score: Score): number {
  return score.tracks.reduce((s, tr) => s + tr.notes.length * (score.instruments?.[tr.instrument]?.layers.length ?? 0), 0);
}

/** 気づいたことを重みの順に返す（多くても MAX_FINDINGS 個） */
export function findings(input: ReportInput): Finding[] {
  const out: Finding[] = [];
  const m = input.metrics;
  const { score } = input;
  if (m) {
    if (m.peakDb > -0.3) out.push({ weight: 100, text: `割れの恐れ：山が ${db(m.peakDb)}FS（-1dB 以下に下げる）` });
    if (!Number.isFinite(m.peakRmsDb)) out.push({ weight: 90, text: "無音（層・音量・音符を確かめる）" });
    else if (m.peakRmsDb < -36) out.push({ weight: 60, text: `小さい：音量の山が ${db(m.peakRmsDb)}` });
    if (m.start > 0.01) out.push({ weight: 70, text: `頭に無音が ${ms(m.start)}（遅れて聞こえる）` });
    if (m.length > 3) out.push({ weight: 40, text: `長い：${sec(m.length)}（効果音なら 1〜2 秒に収めると重ならない）` });
  }
  const voices = voiceCount(score);
  if (voices > 24) out.push({ weight: 50, text: `重い：1 回で ${voices} 声（音符 × 層）` });
  const used = new Set(score.tracks.map((t) => t.instrument));
  for (const name of Object.keys(score.instruments ?? {})) {
    if (!used.has(name)) out.push({ weight: 20, text: `使われていない楽器：${name}` });
  }
  for (const t of score.tracks) {
    if (!score.instruments?.[t.instrument]) out.push({ weight: 95, text: `楽器が無い：トラック ${t.id ?? "?"} の ${t.instrument}` });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, MAX_FINDINGS);
}

/** analysis-report/1 の本文（MAX_LINES 行以内） */
export function report(input: ReportInput): string {
  const { name, score, metrics: m, features } = input;
  const lines: string[] = [REPORT_FORMAT, `音: ${name}`];

  if (m) {
    lines.push(
      "## 測定",
      `長さ ${sec(m.length)} · 開始 ${ms(m.start)} · 立ち上がり ${ms(m.attack)} · 余韻(-40dB) ${sec(m.tail)}`,
      `音量の山 ${db(m.peakDb)}FS · RMS の山 ${db(m.peakRmsDb)}（${ms(m.peakTime)}）`,
      `硬さ: 重心 ${Math.round(m.centroid)}Hz · 4kHz 以上 ${pct(m.highRatio)}`,
    );
  }
  if (features) {
    const [lo, mid, hi] = features.bandRatios;
    lines.push(`帯域: 低(<250Hz) ${pct(lo)} · 中 ${pct(mid)} · 高(≥4kHz) ${pct(hi)}`);
  }

  const s = symbolic(score);
  lines.push("## 音符", `音符 ${s.notes}（高さあり ${s.pitchedNotes}） · 範囲 ${sec(s.span)}` + (s.density ? ` · 密度 ${s.density.toFixed(1)}/秒` : ""));
  if (s.range) lines.push(`音域 ${s.range.low}〜${s.range.high}（${s.range.semitones} 半音）`);
  if (s.scales.length) lines.push(`音階の候補 ${s.scales.map((c) => `${c.name} ${pct(c.fit)}`).join(" / ")}`);
  if (s.chords.length) lines.push(`和音の候補 ${s.chords.map((c) => `${c.t.toFixed(2)}秒 ${c.name}`).join(" / ")}`);

  lines.push("## 構成", `声の数 ${voiceCount(score)}（音符 × 層）` + (score.gain !== undefined ? ` · gain ${num(score.gain)}` : ""));
  for (const t of score.tracks) {
    const extra = [t.gain !== undefined ? `gain ${num(t.gain)}` : "", t.send ? `send ${JSON.stringify(t.send)}` : "", t.jitter ? `jitter ${JSON.stringify(t.jitter)}` : ""];
    lines.push(`トラック ${t.id ?? "?"}: ${t.instrument} · 音符 ${t.notes.length}` + extra.filter(Boolean).map((x) => ` · ${x}`).join(""));
  }
  let layerLines = 0, hidden = 0;
  for (const [iname, inst] of Object.entries(score.instruments ?? {}) as [string, Instrument][]) {
    lines.push(`楽器 ${iname}（${inst.layers.length} 層）`);
    inst.layers.forEach((l, i) => {
      if (layerLines < MAX_LAYER_LINES) { lines.push(`  ${i}: ${layerText(l)}`); layerLines++; }
      else hidden++;
    });
  }
  if (hidden) lines.push(`（ほか ${hidden} 層は省略）`);
  if (score.variation) lines.push(`variation ${JSON.stringify(score.variation)}`);

  const f = findings(input);
  if (f.length) lines.push("## 指摘", ...f.map((x) => `- ${x.text}`));

  lines.push(
    "## 変更案の返し方",
    'sfx-patch/1 の JSON で返す：{"format":"sfx-patch/1","note":"…","ops":[…]}',
    'ops は {"op":"set","path":[…],"value":…} / {"op":"add","path":[…],"value":…,"at"?:番号} / {"op":"remove","path":[…]}',
    'path は区切りの配列。トラック・音符は id、層は番号（例 ["instruments","clack","layers",2,"env","d"]）',
  );
  // 行数を超えたら構成の層から削る（測定・指摘・返し方は残す）
  while (lines.length > MAX_LINES) {
    let i = lines.length - 1;
    while (i >= 0 && !lines[i]!.startsWith("  ")) i--;
    if (i < 0) break;
    lines.splice(i, 1);
  }
  return lines.slice(0, MAX_LINES).join("\n");
}
