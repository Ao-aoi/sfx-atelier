// 物理から作る欄（M5c・M5d）：高さ・揺らぎ → 録音 → wav の保存・変換。
// A：物理の録音、B：変換後、基準：M2 のバンクの discard
import type { Score } from "@sfx-atelier/format";
import type { App } from "../app";
import { convert, type Converted } from "../model/analyze";
import { dryFromBank, PHYSICS_DEFAULT, recordDiscard, wavBytes, type PhysicsParams, type PhysicsRecording } from "../model/physics";
import { PRESETS } from "../model/presets";
import { field, h, iconButton, numberInput } from "./dom";
import { ICON } from "./icons";

const ms = (s: number) => `${Math.round(s * 1000)}ms`;
const db = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}dB` : "—");

export class PhysicsPanel {
  readonly el: HTMLElement;
  private params: PhysicsParams = { ...PHYSICS_DEFAULT };
  private recording: PhysicsRecording | null = null;
  private buffer: AudioBuffer | null = null;
  private converted: Converted | null = null;
  private recOut = h("div", { class: "convert" });
  private convOut = h("div", { class: "convert" });
  private reference: Score | null;
  /** 変換の終わりを待つ（テスト用） */
  pending: Promise<unknown> = Promise.resolve();

  constructor(
    private app: App,
    private say: (text: string, error?: boolean) => void,
  ) {
    const bank = PRESETS[0]?.bank;
    this.reference = bank ? dryFromBank(bank, "discard") : null;
    this.el = h(
      "details",
      { open: true, "data-k": "physics" },
      h(
        "summary",
        {},
        h("span", { class: "title" }, "物理から作る"),
        h("span", { class: "actions" }, iconButton(ICON.download, "wav を保存", () => this.saveWav())),
      ),
      h(
        "div",
        { class: "body" },
        h(
          "div",
          { class: "grid" },
          field("高さ（cm）", numberInput(this.params.height * 100, (v) => (this.params.height = (v ?? 6) / 100), { min: 0.5, max: 50, step: 0.5, label: "高さ（cm）" })),
          field("揺らぎ", numberInput(this.params.variant, (v) => (this.params.variant = Math.round(v ?? 0)), { min: 0, max: 9999, step: 1, label: "揺らぎ" })),
        ),
        h(
          "div",
          { class: "row" },
          h("button", { type: "button", class: "add", onclick: () => this.record() }, "録音"),
          h("button", { type: "button", class: "add", onclick: () => void this.convert() }, "変換"),
        ),
        this.recOut,
        this.convOut,
      ),
    );
  }

  record(): PhysicsRecording {
    const r = recordDiscard(this.params);
    this.recording = r;
    this.converted = null;
    this.convOut.replaceChildren();
    const ch = r.signal.channels[0]!;
    const buf = new AudioBuffer({ length: Math.max(1, ch.length), sampleRate: r.signal.sampleRate, numberOfChannels: 1 });
    buf.copyToChannel(Float32Array.from(ch), 0);
    this.buffer = buf;
    this.recOut.replaceChildren(
      h(
        "div",
        { class: "grid" },
        field("接触", h("output", { "data-k": "contacts" }, String(r.contacts))),
        field("長さ", h("output", { "data-k": "rec-length" }, ms(ch.length / r.signal.sampleRate))),
      ),
      h(
        "div",
        { class: "row" },
        h("button", { type: "button", class: "ab", "aria-label": "物理の録音を鳴らす", onclick: () => this.buffer && this.app.player.previewBuffer(this.buffer) }, "A"),
        this.reference && h("button", { type: "button", class: "ab", "aria-label": "基準の discard を鳴らす", onclick: () => this.reference && this.app.player.preview(this.reference) }, "基準"),
      ),
    );
    return r;
  }

  convert(): Promise<void> {
    const r = this.recording ?? this.record();
    const p = convert(r.signal).then((c) => this.show(c));
    this.pending = p;
    return p;
  }

  private show(c: Converted) {
    this.converted = c;
    const d = c.distance;
    this.convOut.replaceChildren(
      h(
        "div",
        { class: "grid" },
        field("層", h("output", { "data-k": "phys-layers" }, String(c.layers))),
        field("JSON", h("output", { "data-k": "phys-bytes" }, `${c.result.bytes}B`)),
        field("スペクトル差", h("output", { "data-k": "phys-spectral" }, db(d.spectral))),
        field("山の差", h("output", {}, db(d.peak))),
        field("長さの差", h("output", {}, ms(d.length))),
      ),
      h(
        "div",
        { class: "row" },
        h("button", { type: "button", class: "ab", "aria-label": "変換後を鳴らす", onclick: () => this.converted && this.app.player.preview(this.converted.score) }, "B"),
        h("button", { type: "button", class: "add", onclick: () => this.openConverted() }, "変換後を開く"),
      ),
    );
  }

  openConverted() {
    if (!this.converted) return;
    this.app.openScore(this.converted.score, "discard-physics-fit.sfxscore.json");
  }

  private saveWav() {
    const r = this.recording ?? this.record();
    const url = URL.createObjectURL(new Blob([wavBytes(r.signal) as BlobPart], { type: "audio/wav" }));
    const a = h("a", { href: url, download: "discard-physics.wav" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.say("保存しました");
  }
}
