// 分析・変換の欄（M4 の 6 番、M4.5 の 7 番）。Chromium で画面を組み立てて操作する
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../src/style.css";
import { decodeFile, convert } from "../src/model/analyze";
import { mount, type Mounted } from "../src/mount";

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let m: Mounted;
let root: HTMLElement;

beforeEach(async () => {
  root = document.createElement("div");
  root.style.cssText = "position:fixed;inset:0;width:1200px;height:760px";
  document.body.append(root);
  m = mount(root);
  await frame();
});

afterEach(() => {
  m.app.player.stop();
  root.remove();
});

function pickSound(name: string) {
  const sel = root.querySelector<HTMLSelectElement>('select[aria-label="音"]')!;
  sel.value = `src:${name}`;
  sel.dispatchEvent(new Event("change"));
}

/** 測定が終わるまで待つ（編集の後の待ち時間 ＋ 描画） */
async function settle() {
  await wait(300);
  await m.analysis.pending;
}

const out = (k: string) => root.querySelector<HTMLOutputElement>(`output[data-k="${k}"]`)!.textContent;

/** 16 ビット PCM・モノラルの wav を作る（RIFF の決まりどおり） */
function wav(samples: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true));
  return buf;
}

describe("分析", () => {
  it("いまの音を測って数字を出し、要約は analysis-report/1 で始まる", async () => {
    pickSound("win");
    await settle();
    expect(out("length")).toMatch(/ms$/);
    expect(out("centroid")).toMatch(/Hz$/);
    const text = await m.analysis.summaryText();
    expect(text.split("\n")[0]).toBe("analysis-report/1");
    expect(text).toContain("音: win");
    expect(text.split("\n").length).toBeLessThanOrEqual(80);
  });

  it("貼った変更案（前後の文章・コードブロックつき）を当て、A/B が出て、元に戻せる", async () => {
    pickSound("win");
    await settle();
    const before = m.app.score;
    const ta = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="変更案（sfx-patch/1）"]')!;
    ta.value = '音符を弱くします。\n```json\n{"format":"sfx-patch/1","ops":[{"op":"set","path":["tracks","t1","notes","n1","vel"],"value":0.1}]}\n```';
    expect(m.analysis.applyPatch()).toBe(true);
    expect(m.app.score.tracks[0]!.notes[0]!.vel).toBe(0.1);
    expect(root.querySelector('button[aria-label="変更前を鳴らす"]')).not.toBeNull();
    expect(root.querySelector('button[aria-label="変更後を鳴らす"]')).not.toBeNull();
    m.app.undo();
    expect(m.app.score).toEqual(before);
  });

  it("壊れた変更案は当てない", async () => {
    pickSound("win");
    const before = m.app.score;
    const ta = root.querySelector<HTMLTextAreaElement>("textarea")!;
    ta.value = '{"format":"sfx-patch/1","ops":[{"op":"set","path":["tracks","t9","gain"],"value":1}]}';
    expect(m.analysis.applyPatch()).toBe(false);
    expect(m.app.score).toBe(before);
    expect(m.toolbar.status.classList.contains("error")).toBe(true);
  });
});

describe("変換", () => {
  it("いまの音を変換して数字と A/B を出し、変換後を開ける", async () => {
    pickSound("win");
    await settle();
    await m.analysis.convertCurrent();
    expect(Number(out("layers"))).toBeGreaterThan(0);
    expect(out("bytes")).toMatch(/B$/);
    expect(root.querySelector('button[aria-label="元を鳴らす"]')).not.toBeNull();
    m.analysis.openConverted();
    // 変換後は始まりごとの楽器（p1, p2, …）になり、元の残響への送りが付く
    expect(Object.keys(m.app.score.instruments ?? {})).toContain("p1");
    expect(m.app.score.tracks.every((t) => t.send?.room !== undefined)).toBe(true);
    expect(m.app.score.reverb?.room).toBeDefined();
    expect(m.app.source).toBeNull();
  });

  it("wav を読み込んで変換すると、元の高さ（880Hz）が ±1% で戻る", async () => {
    const rate = 44100;
    const x = Float32Array.from({ length: rate * 0.6 }, (_, i) => 0.5 * Math.exp(-i / rate / 0.08) * Math.sin((2 * Math.PI * 880 * i) / rate));
    const { signal } = await decodeFile(wav(x, rate));
    // 48kHz に変換して読む
    expect(signal.sampleRate).toBe(48000);
    const c = await convert(signal);
    const freqs = Object.values(c.score.instruments!).flatMap((i) => i.layers).flatMap((l) => ("osc" in l ? [l.freq!] : []));
    expect(freqs.some((f) => Math.abs(f / 880 - 1) < 0.01)).toBe(true);
  });
});
