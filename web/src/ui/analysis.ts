// 分析（M4）と変換（M4.5）の欄。
//   分析：いまの音の測定・要約（analysis-report/1）のコピー・変更案（sfx-patch/1）の適用と A/B
//   変換：音声ファイルかいまの音を層に変換し、元との A/B・差の数字・開く
import type { Score } from "@sfx-atelier/format";
import type { App } from "../app";
import type { Signal } from "@sfx-atelier/analysis";
import { applyPatchText, convert, convertScore, decodeFile, measure, summary, type Converted, type Measured } from "../model/analyze";
import { field, h, iconButton, numberInput } from "./dom";
import { ICON } from "./icons";

/** 編集が止まってから測るまでの間（ms） */
const DEBOUNCE = 250;

const ms = (s: number) => `${Math.round(s * 1000)}ms`;
const db = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}dB` : "—");

type Source = { kind: "score"; score: Score } | { kind: "buffer"; buffer: AudioBuffer };

export class AnalysisPanel {
  readonly el: HTMLElement;
  private measured: Measured | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private outputs = {
    length: h("output", { "data-k": "length" }, "—"),
    attack: h("output", { "data-k": "attack" }, "—"),
    tail: h("output", { "data-k": "tail" }, "—"),
    peak: h("output", { "data-k": "peak" }, "—"),
    centroid: h("output", { "data-k": "centroid" }, "—"),
    high: h("output", { "data-k": "high" }, "—"),
  };
  private patchText = h("textarea", { rows: 4, spellcheck: false, "aria-label": "変更案（sfx-patch/1）" });
  /** 差分を当てる前の score（A） */
  private before: Score | null = null;
  private abRow = h("div", { class: "row", hidden: true });

  private file = h("input", { type: "file", accept: "audio/*,.wav", hidden: true });
  private layers = 24;
  private source: Source | null = null;
  private converted: Converted | null = null;
  private convertOut = h("div", { class: "convert" });
  /** 測定・変換の終わりを待つ（テスト用） */
  pending: Promise<unknown> = Promise.resolve();

  constructor(
    private app: App,
    private say: (text: string, error?: boolean) => void,
  ) {
    this.file.addEventListener("change", () => void this.openFile());
    this.el = h(
      "div",
      { class: "analysis" },
      this.analysisSection(),
      this.convertSection(),
    );
    app.on((c) => {
      if (c === "doc" || c === "source") this.schedule();
      if (c === "source") {
        this.before = null;
        this.abRow.hidden = true;
      }
    });
    this.schedule();
  }

  private details(key: string, title: string, actions: Node[], ...body: Node[]) {
    return h(
      "details",
      { open: true, "data-k": key },
      h("summary", {}, h("span", { class: "title" }, title), h("span", { class: "actions" }, ...actions)),
      h("div", { class: "body" }, ...body),
    );
  }

  // ---- 分析 ----

  private analysisSection() {
    const o = this.outputs;
    return this.details(
      "analysis",
      "分析",
      [iconButton(ICON.copy, "要約をコピー", () => void this.copySummary())],
      h(
        "div",
        { class: "grid" },
        field("長さ", o.length),
        field("立ち上がり", o.attack),
        field("余韻", o.tail),
        field("音量の山", o.peak),
        field("重心", o.centroid),
        field("4kHz 以上", o.high),
      ),
      field("変更案", this.patchText),
      h(
        "div",
        { class: "row" },
        h("button", { type: "button", class: "add", onclick: () => this.applyPatch() }, "適用"),
        this.abRow,
      ),
    );
  }

  private schedule() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pending = this.refresh();
    }, DEBOUNCE);
  }

  /** いまの音を測る（測っている間に変わったら、古い結果は捨てる） */
  private async refresh() {
    const score = this.app.score;
    try {
      const m = await measure(score);
      if (this.app.score !== score) return;
      this.measured = m;
      const x = m.metrics, o = this.outputs;
      o.length.textContent = ms(x.length);
      o.attack.textContent = ms(x.attack);
      o.tail.textContent = ms(x.tail);
      o.peak.textContent = db(x.peakDb);
      o.centroid.textContent = `${Math.round(x.centroid)}Hz`;
      o.high.textContent = `${Math.round(x.highRatio * 100)}%`;
    } catch {
      this.measured = null;
      for (const el of Object.values(this.outputs)) el.textContent = "—";
    }
  }

  /** 要約の文字列（測っていなければ測る） */
  async summaryText(): Promise<string> {
    const score = this.app.score;
    const m = this.measured && this.timer === null ? this.measured : await measure(score);
    return summary(this.app.baseName, score, m);
  }

  private async copySummary() {
    try {
      await navigator.clipboard.writeText(await this.summaryText());
      this.say("コピーしました");
    } catch {
      this.say("コピーできませんでした", true);
    }
  }

  /** 貼られた変更案を当てる。当てる前を A、当てた後を B として聞き比べられるようにする */
  applyPatch(): boolean {
    const before = this.app.score;
    const r = applyPatchText(before, this.patchText.value);
    if (!r.ok) {
      this.say(r.errors.join("\n"), true);
      return false;
    }
    this.app.edit(r.score);
    this.before = before;
    this.abRow.replaceChildren(
      h("button", { type: "button", class: "ab", "aria-label": "変更前を鳴らす", onclick: () => this.before && this.app.player.preview(this.before) }, "A"),
      h("button", { type: "button", class: "ab", "aria-label": "変更後を鳴らす", onclick: () => this.app.player.preview(this.app.score) }, "B"),
    );
    this.abRow.hidden = false;
    this.say("適用しました");
    return true;
  }

  // ---- 変換 ----

  private convertSection() {
    return this.details(
      "convert",
      "変換",
      [iconButton(ICON.open, "音声を開く", () => this.file.click()), this.file],
      h(
        "div",
        { class: "grid" },
        field("層の上限", numberInput(this.layers, (v) => (this.layers = v ?? 24), { min: 1, max: 64, step: 1, label: "層の上限" })),
      ),
      h("div", { class: "row" }, h("button", { type: "button", class: "add", onclick: () => void this.convertCurrent() }, "いまの音を変換")),
      this.convertOut,
    );
  }

  private async openFile() {
    const f = this.file.files?.[0];
    this.file.value = "";
    if (!f) return;
    try {
      const { buffer, signal } = await decodeFile(await f.arrayBuffer());
      await this.run({ kind: "buffer", buffer }, signal);
    } catch {
      this.say("音声を読み込めませんでした", true);
    }
  }

  convertCurrent(): Promise<void> {
    const score = this.app.score;
    const p = convertScore(score, this.layers).then((c) => this.show({ kind: "score", score }, c));
    this.pending = p;
    return p;
  }

  private async run(source: Source, signal: Signal) {
    this.show(source, await convert(signal, this.layers));
  }

  private show(source: Source, c: Converted) {
    this.source = source;
    this.converted = c;
    const d = c.distance;
    this.convertOut.replaceChildren(
      h(
        "div",
        { class: "grid" },
        field("層", h("output", { "data-k": "layers" }, String(c.layers))),
        field("JSON", h("output", { "data-k": "bytes" }, `${c.result.bytes}B`)),
        field("スペクトル差", h("output", { "data-k": "spectral" }, db(d.spectral))),
        field("山の差", h("output", {}, db(d.peak))),
        field("長さの差", h("output", {}, ms(d.length))),
      ),
      h(
        "div",
        { class: "row" },
        h("button", { type: "button", class: "ab", "aria-label": "元を鳴らす", onclick: () => this.playSource() }, "A"),
        h("button", { type: "button", class: "ab", "aria-label": "変換後を鳴らす", onclick: () => this.converted && this.app.player.preview(this.converted.score) }, "B"),
        h("button", { type: "button", class: "add", onclick: () => this.openConverted() }, "変換後を開く"),
      ),
    );
  }

  private playSource() {
    const s = this.source;
    if (!s) return;
    if (s.kind === "buffer") this.app.player.previewBuffer(s.buffer);
    else this.app.player.preview(s.score);
  }

  openConverted() {
    if (!this.converted) return;
    this.app.openScore(this.converted.score, `${this.app.baseName}-fit.sfxscore.json`);
  }
}
