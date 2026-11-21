// 上の帯：開く・保存・音の切り替え・元に戻す・再生・時間の単位・表示。
import type { App } from "../app";
import { bankJson, emptyScore, parseJson, scoreJson } from "../model/io";
import { deleteNotes, setTime } from "../model/ops";
import { PRESETS } from "../model/presets";
import { h, iconButton, numberInput, select } from "./dom";
import { ICON } from "./icons";
import type { Roll } from "./roll";

const NEW = "\u0000new";

export class Toolbar {
  readonly el: HTMLElement;
  private soundSel = h("select", { "aria-label": "音" });
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private playBtn: HTMLButtonElement;
  private loopBtn: HTMLButtonElement;
  private snapBtn: HTMLButtonElement;
  private bankBtn: HTMLButtonElement;
  private timeBox = h("span", { class: "group" });
  private file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  readonly status = h("div", { class: "status", role: "status", "aria-live": "polite" });

  constructor(
    private app: App,
    private roll: () => Roll,
  ) {
    this.file.addEventListener("change", () => void this.openFile());
    this.soundSel.addEventListener("change", () => this.pick(this.soundSel.value));
    this.undoBtn = iconButton(ICON.undo, "元に戻す", () => app.undo());
    this.redoBtn = iconButton(ICON.redo, "やり直す", () => app.redo());
    this.playBtn = iconButton(ICON.play, "再生", () => app.togglePlay(), { class: "icon primary" });
    this.loopBtn = iconButton(ICON.loop, "ループ", () => {
      app.loop = !app.loop;
      this.sync();
    });
    this.snapBtn = iconButton(ICON.snap, "格子に合わせる", () => {
      app.view.snap = !app.view.snap;
      this.sync();
    });
    this.bankBtn = iconButton(ICON.bank, "バンクを保存", () => this.saveBank());
    this.el = h(
      "header",
      { class: "toolbar" },
      h(
        "span",
        { class: "group" },
        iconButton(ICON.open, "開く", () => this.file.click()),
        iconButton(ICON.download, "保存", () => this.saveScore()),
        this.bankBtn,
        iconButton(ICON.copy, "JSON をコピー", () => void this.copy()),
        this.file,
      ),
      h("span", { class: "group grow" }, this.soundSel),
      h("span", { class: "group" }, this.undoBtn, this.redoBtn),
      h("span", { class: "group" }, this.playBtn, this.loopBtn),
      this.timeBox,
      h(
        "span",
        { class: "group" },
        this.snapBtn,
        iconButton(ICON.zoomOut, "縮小", () => this.roll().zoom(1 / 1.5)),
        iconButton(ICON.zoomIn, "拡大", () => this.roll().zoom(1.5)),
      ),
    );
    app.on((c) => {
      if (c === "source") this.fillSounds();
      if (c === "doc" || c === "play" || c === "source") this.sync();
    });
    window.addEventListener("keydown", (e) => this.key(e));
    this.fillSounds();
    this.sync();
  }

  /** 音の一覧：開いているバンク・プリセット・新規 */
  private fillSounds() {
    const app = this.app;
    const groups: HTMLElement[] = [];
    if (app.source && !PRESETS.some((p) => `preset:${p.name}` === app.source!.label)) {
      groups.push(h("optgroup", { label: app.source.label }, ...Object.keys(app.source.bank.sounds).map((k) => h("option", { value: `src:${k}` }, k))));
    }
    if (!app.source && app.label) groups.push(h("optgroup", { label: "ファイル" }, h("option", { value: "file" }, app.label)));
    for (const p of PRESETS) {
      const isOpen = app.source?.label === `preset:${p.name}`;
      const names = Object.keys((isOpen ? app.source!.bank : p.bank).sounds);
      groups.push(h("optgroup", { label: p.name }, ...names.map((k) => h("option", { value: isOpen ? `src:${k}` : `preset:${p.name}:${k}` }, k))));
    }
    groups.push(h("option", { value: NEW }, "新規"));
    this.soundSel.replaceChildren(...groups);
    this.soundSel.value = app.source ? `src:${app.source.name}` : app.label ? "file" : NEW;
  }

  private pick(v: string) {
    const app = this.app;
    if (v === NEW) app.openScore(emptyScore(), "");
    else if (v.startsWith("src:")) app.switchSound(v.slice(4));
    else if (v.startsWith("preset:")) {
      const [, preset, name] = v.split(":");
      const p = PRESETS.find((x) => x.name === preset);
      const r = p && parseJson(JSON.stringify(p.bank));
      if (r?.kind === "bank") app.openBank(r.bank, `preset:${p!.name}`, name);
    }
  }

  private sync() {
    const app = this.app;
    this.undoBtn.disabled = !app.history.canUndo;
    this.redoBtn.disabled = !app.history.canRedo;
    this.playBtn.innerHTML = app.player.playing ? ICON.stop : ICON.play;
    this.playBtn.setAttribute("aria-label", app.player.playing ? "停止" : "再生");
    this.playBtn.title = app.player.playing ? "停止" : "再生";
    this.loopBtn.setAttribute("aria-pressed", String(app.loop));
    this.snapBtn.setAttribute("aria-pressed", String(app.view.snap));
    this.bankBtn.hidden = !app.source;
    this.renderTime();
  }

  private renderTime() {
    const app = this.app;
    const time = app.score.time ?? { unit: "sec" };
    const unit = select(time.unit, [["sec", "秒"], ["beat", "拍"]], (u) => {
      app.edit(setTime(app.score, u === "beat" ? { unit: "beat", bpm: 120 } : { unit: "sec" }));
    }, "時間の単位");
    const parts: Node[] = [unit];
    if (time.unit === "beat") {
      parts.push(
        h(
          "label",
          { class: "bpm" },
          numberInput(time.bpm, (v) => app.edit(setTime(app.score, { ...time, bpm: v ?? 120 })), { min: 20, max: 400, step: 1, label: "BPM" }),
          h("span", {}, "BPM"),
        ),
      );
    }
    // 入力中の BPM を消さない
    if (this.timeBox.contains(document.activeElement)) return;
    this.timeBox.replaceChildren(...parts);
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("input, select, textarea")) return;
    const mod = e.metaKey || e.ctrlKey;
    const app = this.app;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) app.redo();
      else app.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      app.redo();
    } else if (e.key === " ") {
      e.preventDefault();
      app.togglePlay();
    } else if ((e.key === "Delete" || e.key === "Backspace") && app.sel.length) {
      e.preventDefault();
      app.edit(deleteNotes(app.score, app.sel));
    }
  }

  // ---- 読み書き ----

  private async openFile() {
    const f = this.file.files?.[0];
    this.file.value = "";
    if (!f) return;
    const r = parseJson(await f.text());
    if (r.kind === "error") return this.say(r.errors.slice(0, 5).join("\n"), true);
    if (r.kind === "bank") this.app.openBank(r.bank, f.name);
    else this.app.openScore(r.score, f.name);
  }

  private saveScore() {
    download(`${this.app.baseName}.sfxscore.json`, scoreJson(this.app.score));
  }

  private saveBank() {
    const bank = this.app.currentBank();
    if (!bank || !this.app.source) return;
    const label = this.app.source.label.replace(/^preset:/, "").replace(/\.(sfxbank\.)?json$/i, "");
    download(`${label}.sfxbank.json`, bankJson(bank));
  }

  private async copy() {
    try {
      await navigator.clipboard.writeText(scoreJson(this.app.score));
      this.say("コピーしました");
    } catch {
      this.say("コピーできませんでした", true);
    }
  }

  say(text: string, error = false) {
    this.status.textContent = text;
    this.status.classList.toggle("error", error);
    this.status.classList.add("show");
    clearTimeout((this.status as unknown as { _t?: number })._t);
    (this.status as unknown as { _t?: number })._t = window.setTimeout(() => this.status.classList.remove("show"), error ? 6000 : 1800);
  }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
