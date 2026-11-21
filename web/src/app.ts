// エディタの状態。score（元に戻す・やり直しつき）・選択・表示の範囲・再生。
// 変更は emit で知らせ、画面の各部分は自分に関係するものだけ描き直す。
import type { Bank, Score } from "@sfx-atelier/format";
import { History } from "./model/history";
import { emptyScore, mergeIntoBank, scoreFromBank } from "./model/io";
import { contentSeconds, findNote, type NoteRef } from "./model/ops";
import { unitSeconds } from "./model/timeline";
import { Player } from "./ui/player";

export type Change = "doc" | "select" | "view" | "play" | "source";

/** バンクから開いたとき：どのバンクのどの音か。ほかの音の編集もここに貯める */
export interface Source {
  label: string;
  bank: Bank;
  name: string;
}

export interface View {
  /** 1 秒の幅（px） */
  pps: number;
  /** 1 行の高さ（px） */
  row: number;
  /** 左端の時刻（秒） */
  x: number;
  /** 上端からのずれ（px） */
  y: number;
  snap: boolean;
}

export class App {
  readonly history = new History<Score>(emptyScore());
  source: Source | null = null;
  /** score を単体で開いたときのファイル名 */
  label = "";
  selTrack = "t1";
  sel: NoteRef[] = [];
  /** 再生しないトラック（表示だけの状態。書き出しには入らない） */
  muted = new Set<string>();
  loop = false;
  view: View = { pps: 800, row: 14, x: 0, y: 0, snap: true };
  readonly player = new Player();
  private listeners: ((c: Change, from: unknown) => void)[] = [];

  constructor() {
    this.player.onChange = () => this.emit("play");
  }

  get score(): Score {
    return this.history.present;
  }

  on(f: (c: Change, from: unknown) => void) {
    this.listeners.push(f);
  }

  emit(c: Change, from?: unknown) {
    for (const f of this.listeners) f(c, from);
  }

  /** score を変える。preview はドラッグの途中（履歴に積まない）。key が同じ変更は 1 手にまとめる */
  edit(next: Score, opts: { key?: string; from?: unknown; preview?: boolean } = {}) {
    if (opts.preview) this.history.preview(next);
    else this.history.push(next, opts.key);
    this.fixSelection();
    this.emit("doc", opts.from);
  }

  commit() {
    this.history.commit();
    this.emit("doc");
  }

  cancel() {
    this.history.cancel();
    this.fixSelection();
    this.emit("doc");
  }

  undo() {
    if (this.history.undo()) {
      this.fixSelection();
      this.emit("doc");
    }
  }

  redo() {
    if (this.history.redo()) {
      this.fixSelection();
      this.emit("doc");
    }
  }

  select(track: string, notes: NoteRef[]) {
    this.selTrack = track;
    this.sel = notes;
    this.emit("select");
  }

  /** 消えた音符・トラックを選択から外す */
  private fixSelection() {
    const s = this.score;
    if (!s.tracks.some((t) => t.id === this.selTrack)) this.selTrack = s.tracks[0]?.id ?? "";
    this.sel = this.sel.filter((r) => findNote(s, r));
  }

  // ---- 開く ----

  private load(score: Score) {
    this.player.stop();
    this.history.reset(score);
    this.selTrack = score.tracks[0]?.id ?? "";
    this.sel = [];
    this.muted.clear();
    this.view.x = 0;
    this.emit("source");
    this.emit("doc");
  }

  openScore(score: Score, label: string) {
    this.source = null;
    this.label = label;
    this.load(score);
  }

  openBank(bank: Bank, label: string, name?: string) {
    const first = name ?? Object.keys(bank.sounds)[0];
    if (!first) return;
    this.source = { label, bank, name: first };
    this.label = "";
    this.load(scoreFromBank(bank, first));
  }

  /** 開いているバンクの別の音に移る。いまの音の編集はバンクに残す */
  switchSound(name: string) {
    if (!this.source || name === this.source.name) return;
    this.source = { ...this.source, bank: this.currentBank()!, name };
    this.load(scoreFromBank(this.source.bank, name));
  }

  /** いまの編集を入れたバンク（バンクから開いていなければ null） */
  currentBank(): Bank | null {
    return this.source ? mergeIntoBank(this.source.bank, this.source.name, this.score) : null;
  }

  /** 書き出すファイルの名前（拡張子なし） */
  get baseName(): string {
    return this.source?.name ?? (this.label.replace(/\.(sfxscore\.)?json$/i, "") || "sound");
  }

  // ---- 再生 ----

  /** 鳴らす score（消音のトラックを除く） */
  audible(): Score {
    const s = this.score;
    return this.muted.size === 0 ? s : { ...s, tracks: s.tracks.filter((t) => !this.muted.has(t.id!)) };
  }

  /** ループの長さ（秒）：拍なら小節に切り上げ、秒なら 0.1 秒に切り上げて 0.1 秒の間を空ける */
  loopSeconds(): number {
    const s = this.score;
    const end = contentSeconds(s);
    if (s.time?.unit === "beat") {
      const bar = (s.time.sig?.[0] ?? 4) * unitSeconds(s.time);
      return Math.max(1, Math.ceil(end / bar - 1e-9)) * bar;
    }
    return Math.max(0.2, Math.ceil(end * 10 - 1e-9) / 10 + 0.1);
  }

  togglePlay() {
    if (this.player.playing) this.player.stop();
    else this.player.play(() => this.audible(), () => (this.loop ? this.loopSeconds() : null));
  }
}
