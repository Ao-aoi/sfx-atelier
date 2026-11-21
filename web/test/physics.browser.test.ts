// 物理から作る欄（M5c・M5d）：録音 → 変換 → 開く。完了条件の「変換後の JSON が 1 音 3KB 以下」を確かめ、
// 物理の録音・変換後・基準（M2 の discard）の差を表にする
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../src/style.css";
import { distance, toMono } from "@sfx-atelier/analysis";
import { convert, RATE, renderSignal } from "../src/model/analyze";
import { dryFromBank, PHYSICS_DEFAULT, recordDiscard } from "../src/model/physics";
import { PRESETS } from "../src/model/presets";
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

const out = (k: string) => root.querySelector<HTMLOutputElement>(`output[data-k="${k}"]`)?.textContent;
const button = (text: string) => [...root.querySelectorAll<HTMLButtonElement>('[data-k="physics"] button')].find((b) => b.textContent === text)!;

describe("物理から作る", () => {
  it("録音すると接触の回数と長さ、A と基準のボタンが出る", async () => {
    button("録音").click();
    expect(Number(out("contacts"))).toBeGreaterThan(0);
    expect(out("rec-length")).toMatch(/ms$/);
    expect(root.querySelector('[aria-label="物理の録音を鳴らす"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="基準の discard を鳴らす"]')).not.toBeNull();
  });

  it("変換すると 3KB 以下の JSON になり、変換後を開ける", async () => {
    button("録音").click();
    button("変換").click();
    await m.physics.pending;
    const bytes = Number(out("phys-bytes")!.replace("B", ""));
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(3072);
    expect(Number(out("phys-layers"))).toBeGreaterThan(0);
    expect(out("phys-spectral")).toMatch(/dB$/);
    button("変換後を開く").click();
    expect(m.app.label).toBe("discard-physics-fit.sfxscore.json");
    expect(m.app.score.tracks.length).toBeGreaterThan(0);
  });

  it("差の表（物理の録音・変換後・基準）", async () => {
    const rec = recordDiscard(PHYSICS_DEFAULT);
    const c = await convert(rec.signal);
    const fitted = toMono(await renderSignal(c.score));
    const ref = toMono(await renderSignal(dryFromBank(PRESETS[0]!.bank, "discard")!));
    const phys = toMono(rec.signal);
    const rows = [
      ["物理の録音 ↔ 変換後", distance(phys, fitted, RATE)],
      ["物理の録音 ↔ 基準", distance(phys, ref, RATE)],
      ["変換後 ↔ 基準", distance(fitted, ref, RATE)],
    ] as const;
    console.log(
      [
        `変換後：${c.layers} 層・${c.result.bytes}B`,
        "| 比べるもの | スペクトル差 dB | 山の差 dB | 立ち上がりの差 ms | 長さの差 ms |",
        "| --- | --- | --- | --- | --- |",
        ...rows.map(([k, d]) => `| ${k} | ${d.spectral.toFixed(1)} | ${d.peak.toFixed(1)} | ${(d.attack * 1000).toFixed(0)} | ${(d.length * 1000).toFixed(0)} |`),
      ].join("\n"),
    );
    for (const [, d] of rows) expect(Number.isFinite(d.spectral)).toBe(true);
    // 変換は、別の音（基準）より元（物理の録音）に近い
    expect(rows[0][1].spectral).toBeLessThan(rows[1][1].spectral);
  });
});
