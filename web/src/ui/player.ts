// 再生。ゲームと同じランタイム（createSfx / playScore）で鳴らす。
// ループは「鳴らし終わる少し前に次の回を予約する」を繰り返す。毎回そのときの score を読むので、編集がすぐ反映される。
import { BANK_FORMAT, type Bank, type Score } from "@sfx-atelier/format";
import { createSfx, type Playing, type Sfx } from "@sfx-atelier/runtime";

/** 次の回を予約する余裕（秒） */
const AHEAD = 0.12;

export class Player {
  ctx: AudioContext | null = null;
  private sfx: Sfx | null = null;
  private sfxKey = "";
  private current: Playing[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** いまの回が始まる時刻（ctx の時刻） */
  private startAt = 0;
  private endAt = 0;
  playing = false;
  onChange: () => void = () => {};

  /** 操作の中から呼ぶ（iOS は操作の中でないと鳴らせない） */
  unlock(): AudioContext | null {
    if (!this.ctx) {
      const AC = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC({ latencyHint: "interactive" });
    }
    if (this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** マスター・録音が変わったときだけ作り直す（残響は playScore が作り直す） */
  private sfxFor(score: Score): Sfx | null {
    const ctx = this.unlock();
    if (!ctx) return null;
    const key = JSON.stringify([score.master, score.samples]);
    if (!this.sfx || key !== this.sfxKey) {
      this.sfx?.stopAll();
      const bank: Bank = { format: BANK_FORMAT, master: score.master, samples: score.samples, reverb: score.reverb, sounds: {} };
      this.sfx = createSfx(bank, { context: ctx });
      this.sfxKey = key;
    }
    return this.sfx;
  }

  /** 1 回鳴らす。delay 秒後から。鳴らせなければ null */
  private once(score: Score, delay: number): Playing | null {
    const sfx = this.sfxFor(score);
    if (!sfx || !this.ctx || this.ctx.state !== "running") {
      // resume の途中：少し待ってから鳴らす
      return null;
    }
    const p = sfx.playScore(score, { delay });
    if (p) this.current.push(p);
    return p;
  }

  /** 試し聞き（再生中でも重ねて鳴らす） */
  preview(score: Score) {
    const ctx = this.unlock();
    if (!ctx) return;
    if (ctx.state === "running") this.once(score, 0);
    else void ctx.resume().then(() => this.once(score, 0));
  }

  /**
   * 再生する。loopSeconds があればその間隔で繰り返す。getScore は毎回呼ぶ（ループ中の編集を反映する）
   */
  play(getScore: () => Score, loopSeconds: () => number | null) {
    this.stop();
    const ctx = this.unlock();
    if (!ctx) return;
    this.playing = true;
    const start = () => {
      if (!this.playing) return;
      const p = this.once(getScore(), 0);
      if (!p) {
        this.playing = false;
        this.onChange();
        return;
      }
      // playScore は currentTime ＋ 5ms から鳴らす
      this.startAt = ctx.currentTime + 0.005;
      this.endAt = p.end;
      this.scheduleNext(getScore, loopSeconds, this.startAt);
      this.onChange();
    };
    if (ctx.state === "running") start();
    else void ctx.resume().then(start);
  }

  private scheduleNext(getScore: () => Score, loopSeconds: () => number | null, at: number) {
    const ctx = this.ctx!;
    const loop = loopSeconds();
    if (loop === null) {
      // 鳴り終わったら止める
      this.timer = setTimeout(() => this.finish(), Math.max(0, (this.endAt - ctx.currentTime) * 1000));
      return;
    }
    const next = at + loop;
    const wait = Math.max(0, (next - AHEAD - ctx.currentTime) * 1000);
    this.timer = setTimeout(() => {
      if (!this.playing) return;
      const delay = Math.max(0, next - ctx.currentTime - 0.005);
      const p = this.once(getScore(), delay);
      this.startAt = next;
      if (p) this.endAt = p.end;
      this.current = this.current.filter((c) => c.end > ctx.currentTime);
      this.scheduleNext(getScore, loopSeconds, next);
    }, wait);
  }

  private finish() {
    this.playing = false;
    this.timer = null;
    this.current = [];
    this.onChange();
  }

  stop() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const p of this.current.splice(0)) p.stop();
    if (this.playing) {
      this.playing = false;
      this.onChange();
    }
  }

  /** 再生位置（秒）。再生していなければ null */
  position(): number | null {
    if (!this.playing || !this.ctx) return null;
    const t = this.ctx.currentTime - this.startAt;
    return t < 0 ? null : t;
  }
}
