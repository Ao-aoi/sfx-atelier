// 公開 API。ゲームはバンクを 1 つ読み込み、名前で鳴らす。
// 音量の保存・消音はゲーム側の仕事。ここはマスター音量・解錠・同時発音数だけ持つ。
import type { Bank, Score } from "@sfx-atelier/format/types";
import { compile, seeded, type Random } from "./compile";
import { createShared, ensureReverbs, render, type Playing, type Shared } from "./render";

export interface SfxOptions {
  latencyHint?: AudioContextLatencyCategory | number;
  /** 同時に鳴らす声の上限。超えたら古い音から止める。既定 48 */
  maxVoices?: number;
  /** 乱数の差し替え（テスト・聞き比べ用）。既定は Math.random */
  random?: Random;
  /** 録音の url の基準。既定は document.baseURI */
  baseUrl?: string;
  /** 使う AudioContext を渡す（OfflineAudioContext も可）。渡すと解錠は要らない */
  context?: BaseAudioContext;
}

export interface PlayOptions {
  /** -1（左）〜1（右） */
  pan?: number;
  /** 音量の倍率 */
  gain?: number;
  /** 何秒後に鳴らすか */
  delay?: number;
}

export interface Sfx {
  /** 雑音・残響の生成と録音の読み込みが済んだら解決する（解錠の後） */
  readonly ready: Promise<void>;
  readonly context: BaseAudioContext | null;
  /** いま鳴っている声の数 */
  readonly voices: number;
  /** 最初のタップ・キー入力で AudioContext を作って resume する。ページを開いたときに 1 回呼ぶ */
  installUnlock(target?: EventTarget): void;
  /** 操作の中から直接呼んでもよい */
  unlock(): void;
  play(name: string, opts?: PlayOptions): Playing | null;
  /** バンクに無い音を直接鳴らす（エディタ・聞き比べ用）。楽器・残響は score のものを優先する */
  playScore(score: Score, opts?: PlayOptions): Playing | null;
  /** 0 以上。ゲームの音量設定から呼ぶ */
  setMasterGain(gain: number): void;
  stopAll(): void;
}

/** 呼び出しから発音までの最小の余裕（秒）。予定が過去にならないように */
const LEAD = 0.005;

export function createSfx(bank: Bank, opts: SfxOptions = {}): Sfx {
  const maxVoices = opts.maxVoices ?? 48;
  const random = opts.random ?? Math.random;
  let ctx: BaseAudioContext | null = null;
  let shared: Shared | null = null;
  let userGain = 1;
  const bankGain = bank.master?.gain ?? 1;
  const playing: Playing[] = [];

  // 録音は先に取りに行き、AudioContext ができてから復号する
  const base = opts.baseUrl ?? (typeof document !== "undefined" ? document.baseURI : undefined);
  const fetched = Object.entries(bank.samples ?? {}).map(
    ([name, ref]) => [name, fetch(new URL(ref.url, base)).then((r) => {
      if (!r.ok) throw new Error(`録音「${name}」を読み込めません（${r.status}）`);
      return r.arrayBuffer();
    })] as const,
  );
  let resolveReady!: () => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  function setup(c: BaseAudioContext) {
    ctx = c;
    shared = createShared(c, bank, random);
    shared.master.gain.value = bankGain * userGain;
    const s = shared;
    Promise.all(
      fetched.map(async ([name, data]) => {
        s.samples[name] = await c.decodeAudioData(await data);
      }),
    ).then(() => resolveReady(), rejectReady);
  }

  if (opts.context) setup(opts.context);

  function unlock() {
    if (!ctx) {
      const AC = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const c = new AC({ latencyHint: opts.latencyHint ?? "interactive" });
      setup(c);
      // 無音を 1 つ鳴らして iOS の再生を許可させる
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, c.sampleRate);
      src.connect(c.destination);
      src.start();
    }
    if (ctx instanceof AudioContext && ctx.state !== "running") void ctx.resume().catch(() => {});
  }

  function voiceCount() {
    const now = ctx?.currentTime ?? 0;
    for (let i = playing.length - 1; i >= 0; i--) if (playing[i]!.end <= now) playing.splice(i, 1);
    return playing.reduce((n, p) => n + p.voices, 0);
  }

  function start(sound: Score | Bank["sounds"][string], parts: Bank | Score, o: PlayOptions): Playing | null {
    const c = ctx;
    const s = shared;
    // 止まっている AudioContext に予定を積むと、再開した瞬間にまとめて鳴るので積まない
    if (!c || !s || (c instanceof AudioContext && c.state !== "running")) return null;
    const sampleSeconds = Object.fromEntries(Object.entries(s.samples).map(([k, b]) => [k, b.duration]));
    const plan = compile(sound, { instruments: parts.instruments, reverb: parts.reverb, sampleSeconds }, random, o);
    let total = voiceCount();
    while (playing.length > 0 && total + plan.voices.length > maxVoices) {
      const old = playing.shift()!;
      old.stop();
      total -= old.voices;
    }
    const p = render(s, plan, c.currentTime + LEAD + Math.max(0, o.delay ?? 0));
    playing.push(p);
    return p;
  }

  return {
    ready,
    get context() {
      return ctx;
    },
    get voices() {
      return voiceCount();
    },
    installUnlock(target: EventTarget = globalThis as unknown as EventTarget) {
      for (const type of ["pointerdown", "touchend", "keydown"]) target.addEventListener(type, unlock, { capture: true, passive: true });
      // 別のアプリから戻ったとき、iOS は止めたままのことがある
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible" && ctx instanceof AudioContext && ctx.state !== "running") void ctx.resume().catch(() => {});
        });
      }
    },
    unlock,
    play(name, o = {}) {
      const sound = bank.sounds[name];
      return sound ? start(sound, bank, o) : null;
    },
    playScore(score, o = {}) {
      if (shared && score.reverb) ensureReverbs(shared, score.reverb);
      const parts = { ...bank, instruments: { ...bank.instruments, ...score.instruments }, reverb: { ...bank.reverb, ...score.reverb } } as Bank;
      return start(score, parts, o);
    },
    setMasterGain(gain) {
      userGain = Math.max(0, gain);
      if (ctx && shared) shared.master.gain.setTargetAtTime(bankGain * userGain, ctx.currentTime, 0.015);
    },
    stopAll() {
      for (const p of playing.splice(0)) p.stop();
    },
  };
}

