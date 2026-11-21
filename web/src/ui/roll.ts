// ピアノロール（canvas）。横は秒、縦は行（pitch.ts）。
// 押す：空いた所に音符を置く（そのままドラッグで動かす）／音符を選んで動かす／右端をつかんで長さを変える。
// 2 回続けて押すと消す。2 本指・ホイールで動かす、ピンチ・Ctrl＋ホイールで横に拡大。
import type { Instrument, Note, Score } from "@sfx-atelier/format";
import type { App } from "../app";
import { addNote, contentSeconds, deleteNotes, findNote, moveNotes, noteLength, setNoteDur, type NoteRef } from "../model/ops";
import { isPitched, midiToName, noteAtRow, noteRow } from "../model/pitch";
import { gridStep, rulerTicks, snap, tidy, unitSeconds } from "../model/timeline";

/** 鍵盤の幅・目盛りの高さ（px） */
export const KEYS = 44;
export const RULER = 22;
const TOP_ROW = 127;
/** 右端をつかむ幅（px）。指なら広め */
const EDGE_MOUSE = 6;
const EDGE_TOUCH = 14;
/** 押して離すまでに動いたとみなす距離（px） */
const SLOP = 4;
const DOUBLE_MS = 320;

export const TRACK_COLORS = ["#a8e6cf", "#ffd3a5", "#a5c8ff", "#f5a5c8", "#d7c3ff", "#fff3a5"];

const BLACK = new Set([1, 3, 6, 8, 10]);

type Drag =
  | { kind: "move"; base: Score; refs: NoteRef[]; anchor: Note; x0: number; y0: number; moved: boolean }
  | { kind: "resize"; base: Score; ref: NoteRef; t: number }
  | { kind: "pan"; x0: number; y0: number; vx: number; vy: number; axis: "x" | "y" | "xy"; moved: boolean; row?: number }
  | { kind: "pinch"; d0: number; pps0: number; cx: number; cy: number; vx: number; vy: number; sec0: number };

export class Roll {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dirty = true;
  private drag: Drag | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastTap: { note: string; at: number } | null = null;
  private centered = false;

  constructor(
    private app: App,
    private host: HTMLElement,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "roll";
    this.canvas.setAttribute("role", "application");
    this.canvas.setAttribute("aria-label", "ピアノロール");
    this.canvas.tabIndex = 0;
    host.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", (e) => this.up(e));
    this.canvas.addEventListener("pointercancel", (e) => this.up(e, true));
    this.canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    app.on((c) => {
      if (c === "source") this.centered = false;
      this.dirty = true;
    });
    const loop = () => {
      if (this.dirty || this.app.player.playing) this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---- 座標 ----

  private get u() {
    return unitSeconds(this.app.score.time);
  }
  secToX = (s: number) => KEYS + (s - this.app.view.x) * this.app.view.pps;
  xToSec = (x: number) => (x - KEYS) / this.app.view.pps + this.app.view.x;
  /** 行（小数可）の上端 */
  rowToY = (r: number) => RULER + (TOP_ROW - r) * this.app.view.row - this.app.view.y;
  /** y の位置にある行（整数） */
  yToRow = (y: number) => TOP_ROW - Math.floor((y - RULER + this.app.view.y) / this.app.view.row);

  private resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.clampView();
    this.dirty = true;
  }

  private clampView() {
    const v = this.app.view;
    const maxY = (TOP_ROW + 1) * v.row - (this.h - RULER);
    v.y = Math.max(0, Math.min(Math.max(0, maxY), v.y));
    v.x = Math.max(0, v.x);
  }

  /** 開いた音の全体が横に収まり、音符が縦の真ん中に来るようにする */
  private center() {
    const s = this.app.score;
    const v = this.app.view;
    v.pps = Math.max(40, Math.min(20000, (this.w - KEYS) / Math.max(0.2, contentSeconds(s) * 1.15)));
    v.x = 0;
    const rows: number[] = [];
    for (const t of s.tracks) {
      const p = isPitched(s.instruments?.[t.instrument]);
      for (const n of t.notes) rows.push(noteRow(n, p));
    }
    const mid = rows.length ? (Math.min(...rows) + Math.max(...rows)) / 2 : 69;
    this.app.view.y = (TOP_ROW - mid) * this.app.view.row - (this.h - RULER) / 2;
    this.clampView();
    this.centered = true;
  }

  /** 横の拡大（中心の x を保つ） */
  zoom(factor: number, atX = KEYS + (this.w - KEYS) / 2) {
    const v = this.app.view;
    const sec = this.xToSec(atX);
    v.pps = Math.max(40, Math.min(20000, v.pps * factor));
    v.x = sec - (atX - KEYS) / v.pps;
    this.clampView();
    this.app.emit("view");
  }

  // ---- 描画 ----

  private draw() {
    this.dirty = false;
    if (!this.centered && this.h > RULER + 10) this.center();
    const { ctx, w, h } = this;
    const app = this.app;
    const s = app.score;
    const v = app.view;
    const u = this.u;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#151a24";
    ctx.fillRect(0, 0, w, h);

    // 行
    const top = this.yToRow(RULER);
    const bottom = this.yToRow(h);
    for (let r = top; r >= Math.max(0, bottom); r--) {
      const y = this.rowToY(r);
      ctx.fillStyle = BLACK.has(r % 12) ? "#121620" : "#181e2a";
      ctx.fillRect(KEYS, y, w - KEYS, v.row);
      if (r % 12 === 0) {
        ctx.fillStyle = "#2a3242";
        ctx.fillRect(KEYS, y + v.row - 1, w - KEYS, 1);
      }
    }

    // 縦の格子
    const step = gridStep(v.pps, s.time, 10) * u;
    const from = Math.floor(v.x / step) * step;
    const toSec = this.xToSec(w);
    ctx.fillStyle = "#222a38";
    for (let t = from; t <= toSec; t += step) {
      const x = Math.round(this.secToX(t));
      if (x >= KEYS) ctx.fillRect(x, RULER, 1, h - RULER);
    }
    const ticks = rulerTicks(v.x / u, toSec / u, v.pps * u, s.time, 56);
    ctx.fillStyle = "#33405a";
    for (const tk of ticks) ctx.fillRect(Math.round(this.secToX(tk.t * u)), RULER, 1, h - RULER);

    // 音符（選んでいないトラックを先に、薄く）
    const sel = new Set(app.sel.map((r) => `${r.track}/${r.note}`));
    const order = [...s.tracks.keys()].sort((a, b) => Number(s.tracks[a]!.id === app.selTrack) - Number(s.tracks[b]!.id === app.selTrack));
    for (const i of order) {
      const t = s.tracks[i]!;
      const ins = s.instruments?.[t.instrument];
      const pitched = isPitched(ins);
      const active = t.id === app.selTrack;
      const color = TRACK_COLORS[i % TRACK_COLORS.length]!;
      for (const n of t.notes) {
        const r = this.noteRect(n, ins, pitched);
        if (r.x > w || r.x + r.w < KEYS || r.y > h || r.y + r.h < RULER) continue;
        const isSel = sel.has(`${t.id}/${n.id}`);
        ctx.globalAlpha = (active ? 0.45 + 0.55 * (n.vel ?? 1) : 0.28) * (app.muted.has(t.id!) ? 0.4 : 1);
        ctx.fillStyle = color;
        ctx.fillRect(r.x, r.y + 1, r.w, r.h - 2);
        ctx.globalAlpha = 1;
        // dur の無い音符（楽器の減衰で決まる長さ）は右端をぼかす
        if (n.dur === undefined && active) {
          ctx.fillStyle = "rgba(21,26,36,0.5)";
          ctx.fillRect(r.x + r.w - Math.min(8, r.w / 3), r.y + 1, Math.min(8, r.w / 3), r.h - 2);
        }
        if (isSel) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.strokeRect(r.x + 1, r.y + 2, r.w - 2, r.h - 4);
        }
        if (active && pitched && typeof n.pitch === "string" && r.w > 28 && v.row >= 11) {
          ctx.fillStyle = "#10131b";
          ctx.font = "10px system-ui, sans-serif";
          ctx.textBaseline = "middle";
          ctx.fillText(n.pitch, r.x + 3, r.y + r.h / 2);
        }
      }
    }

    // 再生位置
    const pos = app.player.position();
    if (pos !== null) {
      const x = this.secToX(pos);
      ctx.fillStyle = "#ff8a8a";
      ctx.fillRect(Math.round(x), RULER, 2, h - RULER);
    }

    // 鍵盤
    ctx.fillStyle = "#10131b";
    ctx.fillRect(0, RULER, KEYS, h - RULER);
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let r = top; r >= Math.max(0, bottom); r--) {
      const y = this.rowToY(r);
      ctx.fillStyle = BLACK.has(r % 12) ? "#2b3140" : "#cfd6e2";
      ctx.fillRect(0, y, KEYS - 4, v.row - 1);
      if (r % 12 === 0 && v.row >= 9) {
        ctx.fillStyle = "#10131b";
        ctx.fillText(midiToName(r), 4, y + v.row / 2);
      }
    }

    // 目盛り
    ctx.fillStyle = "#10131b";
    ctx.fillRect(0, 0, w, RULER);
    ctx.fillStyle = "#9ca8ba";
    ctx.textBaseline = "middle";
    for (const tk of ticks) {
      const x = this.secToX(tk.t * u);
      if (x < KEYS - 1) continue;
      ctx.fillRect(Math.round(x), RULER - 6, 1, 6);
      ctx.fillText(tk.label, x + 3, RULER / 2);
    }
    if (pos !== null) {
      ctx.fillStyle = "#ff8a8a";
      ctx.fillRect(Math.round(this.secToX(pos)) - 3, RULER - 6, 8, 6);
    }
  }

  private noteRect(n: Note, ins: Instrument | undefined, pitched: boolean) {
    const u = this.u;
    const x = this.secToX(n.t * u);
    const w = Math.max(4, noteLength(n, ins, this.app.score.time) * u * this.app.view.pps);
    const y = this.rowToY(noteRow(n, pitched));
    return { x, y, w, h: this.app.view.row };
  }

  /** 位置にある音符。選んでいるトラックを優先する */
  private hit(x: number, y: number): { ref: NoteRef; edge: boolean } | null {
    const s = this.app.score;
    const tracks = [...s.tracks].sort((a, b) => Number(b.id === this.app.selTrack) - Number(a.id === this.app.selTrack));
    for (const t of tracks) {
      if (this.app.muted.has(t.id!) && t.id !== this.app.selTrack) continue;
      const ins = s.instruments?.[t.instrument];
      const pitched = isPitched(ins);
      for (let i = t.notes.length - 1; i >= 0; i--) {
        const n = t.notes[i]!;
        const r = this.noteRect(n, ins, pitched);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y < r.y + r.h) {
          const edge = Math.min(this.edgePx, r.w / 3);
          return { ref: { track: t.id!, note: n.id! }, edge: x >= r.x + r.w - edge };
        }
      }
    }
    return null;
  }

  private edgePx = EDGE_MOUSE;

  // ---- 操作 ----

  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private stepUnits() {
    return gridStep(this.app.view.pps, this.app.score.time, 10);
  }

  private snapT(t: number) {
    return this.app.view.snap ? snap(t, this.stepUnits()) : tidy(t);
  }

  /** 1 音符だけ鳴らす（置いたとき・鍵盤を押したとき） */
  private audition(track: string, note: Omit<Note, "id" | "t">) {
    const s = this.app.score;
    const t = s.tracks.find((x) => x.id === track);
    if (!t) return;
    this.app.player.preview({ ...s, variation: undefined, tracks: [{ ...t, notes: [{ ...note, t: 0 }] }] });
  }

  private down(e: PointerEvent) {
    this.canvas.focus({ preventScroll: true });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // 合成したイベント（テスト）では捕まえられないことがある
    }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.edgePx = e.pointerType === "touch" ? EDGE_TOUCH : EDGE_MOUSE;
    const app = this.app;

    if (this.pointers.size === 2) {
      // 2 本目の指：いまの操作をやめて、移動・拡大に切り替える
      if (this.drag && (this.drag.kind === "move" || this.drag.kind === "resize")) app.cancel();
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const cx = (a.x + b.x) / 2;
      this.drag = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, pps0: app.view.pps, cx, cy: (a.y + b.y) / 2, vx: app.view.x, vy: app.view.y, sec0: this.xToSec(cx) };
      return;
    }
    if (this.pointers.size > 2) return;

    // 目盛り・鍵盤：動かす（鍵盤は押すと鳴らす）
    if (p.y < RULER || p.x < KEYS) {
      const row = p.x < KEYS && p.y >= RULER ? this.yToRow(p.y) : undefined;
      this.drag = { kind: "pan", x0: p.x, y0: p.y, vx: app.view.x, vy: app.view.y, axis: p.y < RULER ? "x" : "y", moved: false, row };
      return;
    }

    const hit = this.hit(p.x, p.y);
    if (hit) {
      const now = performance.now();
      if (this.lastTap && this.lastTap.note === `${hit.ref.track}/${hit.ref.note}` && now - this.lastTap.at < DOUBLE_MS) {
        this.lastTap = null;
        app.edit(deleteNotes(app.score, [hit.ref]));
        this.drag = null;
        return;
      }
      this.lastTap = { note: `${hit.ref.track}/${hit.ref.note}`, at: now };
      const inSel = app.sel.some((r) => r.track === hit.ref.track && r.note === hit.ref.note);
      let refs = app.sel;
      if (e.shiftKey || e.metaKey || e.ctrlKey) refs = inSel ? app.sel.filter((r) => r.note !== hit.ref.note || r.track !== hit.ref.track) : [...app.sel, hit.ref];
      else if (!inSel) refs = [hit.ref];
      app.select(hit.ref.track, refs);
      const note = findNote(app.score, hit.ref)!;
      this.drag = hit.edge
        ? { kind: "resize", base: app.score, ref: hit.ref, t: note.t }
        : { kind: "move", base: app.score, refs: refs.length ? refs : [hit.ref], anchor: note, x0: p.x, y0: p.y, moved: false };
      return;
    }

    // 空いた所：選んでいるトラックに置く
    this.lastTap = null;
    const s = app.score;
    const track = s.tracks.find((t) => t.id === app.selTrack);
    if (!track) {
      app.select(app.selTrack, []);
      return;
    }
    const pitched = isPitched(s.instruments?.[track.instrument]);
    const t = Math.max(0, this.app.view.snap ? Math.floor(this.xToSec(p.x) / this.u / this.stepUnits()) * this.stepUnits() : this.xToSec(p.x) / this.u);
    const { score, ref } = addNote(s, track.id!, { t: tidy(t), ...noteAtRow(this.yToRow(p.y), pitched) });
    app.edit(score, { preview: true });
    app.select(track.id!, [ref]);
    const note = findNote(score, ref)!;
    this.audition(track.id!, note);
    this.drag = { kind: "move", base: score, refs: [ref], anchor: note, x0: p.x, y0: p.y, moved: true };
  }

  private move(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const d = this.drag;
    const app = this.app;
    if (!d) return;
    const v = app.view;
    if (d.kind === "pinch") {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      v.pps = Math.max(40, Math.min(20000, (d.pps0 * dist) / d.d0));
      v.x = d.sec0 - (cx - KEYS) / v.pps;
      v.y = d.vy - (cy - d.cy);
      this.clampView();
      app.emit("view");
      return;
    }
    if (d.kind === "pan") {
      if (Math.hypot(p.x - d.x0, p.y - d.y0) > SLOP) d.moved = true;
      if (d.axis !== "y") v.x = d.vx - (p.x - d.x0) / v.pps;
      if (d.axis !== "x") v.y = d.vy - (p.y - d.y0);
      this.clampView();
      app.emit("view");
      return;
    }
    const u = this.u;
    if (d.kind === "resize") {
      const end = this.snapT(this.xToSec(p.x) / u);
      const min = app.view.snap ? this.stepUnits() : 0.001 / u;
      app.edit(setNoteDur(d.base, d.ref, end - d.t, min), { preview: true });
      return;
    }
    // move
    if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) < SLOP) return;
    d.moved = true;
    const rawT = d.anchor.t + (p.x - d.x0) / v.pps / u;
    const dt = this.snapT(rawT) - d.anchor.t;
    const semis = Math.round((d.y0 - p.y) / v.row);
    app.edit(moveNotes(d.base, d.refs, dt, semis), { preview: true });
  }

  private up(e: PointerEvent, cancelled = false) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (this.pointers.size > 0) {
      // ピンチの片方の指が離れた：残りの指では何もしない
      if (d?.kind === "pinch") this.drag = null;
      return;
    }
    this.drag = null;
    if (!d) return;
    if (d.kind === "move" || d.kind === "resize") {
      if (cancelled) this.app.cancel();
      else this.app.commit();
      if (d.kind === "move" && d.moved && d.refs.length === 1) {
        const n = findNote(this.app.score, d.refs[0]!);
        const a = d.anchor;
        if (n && (n.pitch !== a.pitch || n.tune !== a.tune)) this.audition(d.refs[0]!.track, n);
      }
    } else if (d.kind === "pan" && !d.moved && d.row !== undefined) {
      const s = this.app.score;
      const t = s.tracks.find((x) => x.id === this.app.selTrack);
      if (t) this.audition(t.id!, noteAtRow(d.row, isPitched(s.instruments?.[t.instrument])));
    }
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const v = this.app.view;
    if (e.ctrlKey || e.metaKey) {
      this.zoom(Math.exp(-e.deltaY * 0.002), this.local(e).x);
      return;
    }
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const dy = e.shiftKey ? 0 : e.deltaY;
    v.x += dx / v.pps;
    v.y += dy;
    this.clampView();
    this.app.emit("view");
  }
}
