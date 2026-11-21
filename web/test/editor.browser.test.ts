// 画面を組み立てて、ピアノロール・編集欄・書き出しを操作する（Chromium）
import { validateScore, validateBank } from "@sfx-atelier/format";
import { renderOffline } from "@sfx-atelier/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../src/style.css";
import { bankJson, parseJson, scoreJson } from "../src/model/io";
import { findNote, noteLength } from "../src/model/ops";
import { isPitched, noteRow } from "../src/model/pitch";
import { unitSeconds } from "../src/model/timeline";
import { mount, type Mounted } from "../src/mount";

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

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

function pointer(type: string, x: number, y: number, id = 1) {
  const r = m.roll.canvas.getBoundingClientRect();
  m.roll.canvas.dispatchEvent(
    new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, pointerId: id, pointerType: "mouse", bubbles: true, isPrimary: id === 1 }),
  );
}

/** 音符の真ん中の位置（canvas の中の px） */
function noteCenter(track: string, note: string) {
  const s = m.app.score;
  const t = s.tracks.find((x) => x.id === track)!;
  const n = findNote(s, { track, note })!;
  const ins = s.instruments![t.instrument];
  const u = unitSeconds(s.time);
  const x0 = m.roll.secToX(n.t * u);
  const x1 = m.roll.secToX((n.t + noteLength(n, ins, s.time)) * u);
  return { x: (x0 + Math.min(x1, x0 + 40)) / 2, y: m.roll.rowToY(noteRow(n, isPitched(ins))) + m.app.view.row / 2 };
}

function pickSound(name: string) {
  const sel = root.querySelector<HTMLSelectElement>('select[aria-label="音"]')!;
  sel.value = `src:${name}`;
  sel.dispatchEvent(new Event("change"));
}

describe("ピアノロール", () => {
  it("空いた所を押すと音符が置かれ、元に戻す・やり直しができる", async () => {
    expect(m.app.source?.name).toBe("discard");
    const before = m.app.score.tracks[0]!.notes.length;
    const p = noteCenter("t1", "n1");
    pointer("pointerdown", 600, p.y - 5 * m.app.view.row);
    pointer("pointerup", 600, p.y - 5 * m.app.view.row);
    expect(m.app.score.tracks[0]!.notes.length).toBe(before + 1);
    // 雑音の楽器（高さに従わない）は、5 行上なら tune +500
    expect(m.app.score.tracks[0]!.notes.at(-1)!.tune).toBe(500);
    m.app.undo();
    expect(m.app.score.tracks[0]!.notes.length).toBe(before);
    m.app.redo();
    expect(m.app.score.tracks[0]!.notes.length).toBe(before + 1);
  });

  it("音符をドラッグで動かすと 1 手で戻せる", async () => {
    pickSound("win");
    await frame();
    const p = noteCenter("t1", "n2");
    const t0 = findNote(m.app.score, { track: "t1", note: "n2" })!.t;
    pointer("pointerdown", p.x, p.y);
    for (let k = 1; k <= 5; k++) pointer("pointermove", p.x + k * 20, p.y - k * m.app.view.row * 0.4);
    pointer("pointerup", p.x + 100, p.y - 2 * m.app.view.row);
    const n = findNote(m.app.score, { track: "t1", note: "n2" })!;
    expect(n.t).toBeGreaterThan(t0);
    expect(n.pitch).toBe("F#6");
    m.app.undo();
    expect(findNote(m.app.score, { track: "t1", note: "n2" })).toMatchObject({ t: t0, pitch: "E6" });
  });

  it("右端をつかんで長さを変える", async () => {
    pickSound("win");
    await frame();
    const s = m.app.score;
    const n = findNote(s, { track: "t1", note: "n1" })!;
    const right = m.roll.secToX(n.t + n.dur!);
    if (right > m.roll.canvas.clientWidth) m.roll.zoom(0.5);
    await frame();
    const r = m.roll.secToX(n.t + n.dur!) - 2;
    const y = noteCenter("t1", "n1").y;
    pointer("pointerdown", r, y);
    pointer("pointermove", r - 200, y);
    pointer("pointerup", r - 200, y);
    expect(findNote(m.app.score, { track: "t1", note: "n1" })!.dur).toBeLessThan(n.dur!);
  });

  it("同じ音符を 2 回続けて押すと消える", async () => {
    const p = noteCenter("t1", "n1");
    pointer("pointerdown", p.x, p.y);
    pointer("pointerup", p.x, p.y);
    pointer("pointerdown", p.x, p.y);
    pointer("pointerup", p.x, p.y);
    expect(m.app.score.tracks[0]!.notes).toHaveLength(0);
  });
});

describe("編集欄", () => {
  it("層の減衰を変えると score が変わり、元に戻せる", () => {
    const input = root.querySelector<HTMLInputElement>('input[aria-label="減衰（秒）"]')!;
    const before = m.app.score.instruments!.clack!.layers[0]!.env!.d;
    input.value = "0.08";
    input.dispatchEvent(new Event("change"));
    expect(m.app.score.instruments!.clack!.layers[0]!.env!.d).toBe(0.08);
    m.app.undo();
    expect(m.app.score.instruments!.clack!.layers[0]!.env!.d).toBe(before);
  });

  it("秒 → 拍に変えても鳴る時刻は同じ（bpm 120 で 2 倍の数）", () => {
    pickSound("kan");
    const unit = root.querySelector<HTMLSelectElement>('select[aria-label="時間の単位"]')!;
    unit.value = "beat";
    unit.dispatchEvent(new Event("change"));
    expect(m.app.score.time).toEqual({ unit: "beat", bpm: 120 });
    expect(findNote(m.app.score, { track: "t1", note: "n2" })!.t).toBeCloseTo(0.11, 9);
    expect(root.querySelector('input[aria-label="BPM"]')).not.toBeNull();
  });
});

describe("M3 の完了条件：discard・win・riichi を開いて直し、鳴らして JSON に書き出す", () => {
  for (const name of ["discard", "win", "riichi"]) {
    it(name, async () => {
      pickSound(name);
      expect(m.app.source?.name).toBe(name);
      // 1 つ目の層の音量を下げる
      const ins = m.app.score.tracks[0]!.instrument;
      const g = root.querySelector<HTMLInputElement>('input[aria-label="層の音量"]')!;
      g.value = "0.3";
      g.dispatchEvent(new Event("input"));
      expect(m.app.score.instruments![ins]!.layers[0]!.gain).toBe(0.3);

      const text = scoreJson(m.app.score);
      const v = validateScore(JSON.parse(text));
      expect(v.ok).toBe(true);
      const again = parseJson(text);
      expect(again.kind).toBe("score");

      // バンクに戻しても検証を通る
      const bank = JSON.parse(bankJson(m.app.currentBank()!));
      expect(validateBank(bank).ok).toBe(true);
      expect(bank.instruments[ins].layers[0].gain).toBe(0.3);

      // ランタイムで描画して、音が出ていて割れていない
      const s = m.app.score;
      const buf = await renderOffline(s, { instruments: s.instruments, reverb: s.reverb, master: s.master }, { seed: 7 });
      let peak = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        for (const x of buf.getChannelData(c)) {
          expect(Number.isFinite(x)).toBe(true);
          peak = Math.max(peak, Math.abs(x));
        }
      }
      expect(peak).toBeGreaterThan(0.005);
      expect(peak).toBeLessThanOrEqual(1);
    });
  }
});
