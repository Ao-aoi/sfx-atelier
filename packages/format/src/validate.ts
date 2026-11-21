// sfx-bank/1・sfx-score/1 の検証。
// 型・範囲・参照（楽器・残響・録音の名前）・id の重複を確かめ、知らないキーも拒否する
// （書き間違いと、Claude の変更案が存在しない項目を指すのを早く見つけるため）。
import { noteNameToMidi } from "./pitch";
import { BANK_FORMAT, SCORE_FORMAT, type Bank, type Score } from "./types";

export interface ValidationError {
  /** 例：sounds.kan.tracks[0].notes[2].vel */
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: ValidationError[] };

const OSC = ["sine", "square", "sawtooth", "triangle"];
const NOISE = ["white", "pink", "brown"];
const FILTER = ["lowpass", "highpass", "bandpass", "notch", "peaking", "lowshelf", "highshelf"];
const CURVE = ["exp", "lin"];
/** 聞こえる範囲より少し広く取る。ナイキスト周波数は端末で違うので、ここでは上限だけ決める */
const MAX_HZ = 24000;

type Obj = Record<string, unknown>;

class Checker {
  errors: ValidationError[] = [];
  reverbs = new Set<string>();
  instruments = new Set<string>();
  samples = new Set<string>();

  err(path: string, message: string) {
    this.errors.push({ path, message });
  }

  obj(v: unknown, path: string, allowed: readonly string[]): v is Obj {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      this.err(path, "オブジェクトではありません");
      return false;
    }
    for (const k of Object.keys(v)) if (!allowed.includes(k)) this.err(join(path, k), "知らないキーです");
    return true;
  }

  record(v: unknown, path: string): v is Obj {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      this.err(path, "オブジェクトではありません");
      return false;
    }
    return true;
  }

  /** 数値。min・max は両端を含む。gt は「より大きい」 */
  num(o: Obj, key: string, path: string, opt: { required?: boolean; min?: number; max?: number; gt?: number } = {}) {
    const v = o[key];
    const p = join(path, key);
    if (v === undefined) {
      if (opt.required) this.err(p, "必須です");
      return;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) return this.err(p, "有限の数ではありません");
    if (opt.min !== undefined && v < opt.min) this.err(p, `${opt.min} 以上にしてください`);
    if (opt.max !== undefined && v > opt.max) this.err(p, `${opt.max} 以下にしてください`);
    if (opt.gt !== undefined && v <= opt.gt) this.err(p, `${opt.gt} より大きくしてください`);
  }

  oneOf(o: Obj, key: string, path: string, values: readonly string[], required = false) {
    const v = o[key];
    const p = join(path, key);
    if (v === undefined) {
      if (required) this.err(p, "必須です");
      return;
    }
    if (typeof v !== "string" || !values.includes(v)) this.err(p, `${values.join(" / ")} のどれかにしてください`);
  }

  str(o: Obj, key: string, path: string, required = false) {
    const v = o[key];
    const p = join(path, key);
    if (v === undefined) {
      if (required) this.err(p, "必須です");
      return;
    }
    if (typeof v !== "string" || v.length === 0) this.err(p, "空でない文字列にしてください");
  }

  // ---- 共有の部品 ----

  shared(o: Obj, path: string) {
    if (o.reverb !== undefined && this.record(o.reverb, join(path, "reverb"))) {
      for (const [name, r] of Object.entries(o.reverb)) {
        this.reverbs.add(name);
        this.reverb(r, join(path, "reverb", name));
      }
    }
    if (o.samples !== undefined && this.record(o.samples, join(path, "samples"))) {
      for (const [name, s] of Object.entries(o.samples)) {
        this.samples.add(name);
        const p = join(path, "samples", name);
        if (this.obj(s, p, ["url"])) this.str(s, "url", p, true);
      }
    }
    // 楽器は録音の名前を参照するので、録音の後に見る
    if (o.instruments !== undefined && this.record(o.instruments, join(path, "instruments"))) {
      for (const [name, ins] of Object.entries(o.instruments)) {
        this.instruments.add(name);
        this.instrument(ins, join(path, "instruments", name));
      }
    }
    if (o.master !== undefined) this.master(o.master, join(path, "master"));
  }

  master(v: unknown, path: string) {
    if (!this.obj(v, path, ["gain", "compressor"])) return;
    this.num(v, "gain", path, { min: 0 });
    const c = v.compressor;
    const cp = join(path, "compressor");
    if (c !== undefined && this.obj(c, cp, ["threshold", "knee", "ratio", "attack", "release"])) {
      // Web Audio の DynamicsCompressorNode の範囲
      this.num(c, "threshold", cp, { min: -100, max: 0 });
      this.num(c, "knee", cp, { min: 0, max: 40 });
      this.num(c, "ratio", cp, { min: 1, max: 20 });
      this.num(c, "attack", cp, { min: 0, max: 1 });
      this.num(c, "release", cp, { min: 0, max: 1 });
    }
  }

  reverb(v: unknown, path: string) {
    if (!this.obj(v, path, ["seconds", "decay", "wet"])) return;
    this.num(v, "seconds", path, { required: true, gt: 0, max: 10 });
    this.num(v, "decay", path, { required: true, gt: 0 });
    this.num(v, "wet", path, { min: 0, max: 1 });
  }

  instrument(v: unknown, path: string) {
    if (!this.obj(v, path, ["layers"])) return;
    const layers = v.layers;
    const lp = join(path, "layers");
    if (!Array.isArray(layers)) return this.err(lp, "配列ではありません");
    if (layers.length === 0) this.err(lp, "層が 1 つもありません");
    layers.forEach((l, i) => this.layer(l, `${lp}[${i}]`));
  }

  layer(v: unknown, path: string) {
    const base = ["gain", "pan", "env", "filter", "pitchEnv", "jitter"];
    if (!this.record(v, path)) return;
    const sources = ["osc", "noise", "sample"].filter((k) => v[k] !== undefined);
    if (sources.length !== 1) return this.err(path, "osc・noise・sample のどれか 1 つだけを書いてください");
    const src = sources[0];

    if (src === "osc") {
      if (!this.obj(v, path, [...base, "osc", "freq", "ratio"])) return;
      this.oneOf(v, "osc", path, OSC, true);
      if ((v.freq === undefined) === (v.ratio === undefined)) {
        this.err(path, "freq と ratio のどちらか一方だけを書いてください");
      }
      this.num(v, "freq", path, { gt: 0, max: MAX_HZ });
      this.num(v, "ratio", path, { gt: 0 });
    } else if (src === "noise") {
      if (!this.obj(v, path, [...base, "noise"])) return;
      this.oneOf(v, "noise", path, NOISE, true);
    } else {
      if (!this.obj(v, path, [...base, "sample", "ratio"])) return;
      this.str(v, "sample", path, true);
      if (typeof v.sample === "string" && v.sample !== "" && !this.samples.has(v.sample)) {
        this.err(join(path, "sample"), `録音「${v.sample}」が samples にありません`);
      }
      this.num(v, "ratio", path, { gt: 0 });
    }

    this.num(v, "gain", path, { min: 0 });
    this.num(v, "pan", path, { min: -1, max: 1 });
    if (v.env !== undefined) this.envelope(v.env, join(path, "env"));
    if (v.filter !== undefined) this.filter(v.filter, join(path, "filter"));
    if (v.pitchEnv !== undefined) this.pitchEnv(v.pitchEnv, join(path, "pitchEnv"));
    if (v.jitter !== undefined) this.variation(v.jitter, join(path, "jitter"));
  }

  envelope(v: unknown, path: string) {
    if (!this.obj(v, path, ["a", "d", "s", "r", "curve"])) return;
    for (const k of ["a", "d", "r"]) this.num(v, k, path, { min: 0 });
    this.num(v, "s", path, { min: 0, max: 1 });
    this.oneOf(v, "curve", path, CURVE);
  }

  filter(v: unknown, path: string) {
    if (!this.obj(v, path, ["type", "freq", "q", "gain"])) return;
    this.oneOf(v, "type", path, FILTER, true);
    this.num(v, "freq", path, { required: true, gt: 0, max: MAX_HZ });
    this.num(v, "q", path, { gt: 0 });
    this.num(v, "gain", path, { min: -40, max: 40 });
  }

  pitchEnv(v: unknown, path: string) {
    if (!this.obj(v, path, ["toHz", "cents", "time", "curve"])) return;
    if ((v.toHz === undefined) === (v.cents === undefined)) {
      this.err(path, "toHz と cents のどちらか一方だけを書いてください");
    }
    this.num(v, "toHz", path, { gt: 0, max: MAX_HZ });
    this.num(v, "cents", path);
    if (v.time === undefined) this.err(join(path, "time"), "必須です");
    else if (v.time !== "decay") this.num(v, "time", path, { min: 0 });
    this.oneOf(v, "curve", path, CURVE);
  }

  variation(v: unknown, path: string) {
    if (!this.obj(v, path, ["tune", "gain", "time"])) return;
    this.num(v, "tune", path, { min: 0 });
    this.num(v, "gain", path, { min: 0, max: 1 });
    this.num(v, "time", path, { min: 0 });
  }

  // ---- 音 ----

  /** keys は Sound のキーに足すもの（Score の format・共有の部品） */
  sound(v: unknown, path: string, extraKeys: readonly string[] = []) {
    if (!this.obj(v, path, ["time", "gain", "tracks", "variation", ...extraKeys])) return;
    if (v.time !== undefined) this.time(v.time, join(path, "time"));
    this.num(v, "gain", path, { min: 0 });
    if (v.variation !== undefined) this.variation(v.variation, join(path, "variation"));

    const tp = join(path, "tracks");
    if (!Array.isArray(v.tracks)) return this.err(tp, "配列ではありません");
    const trackIds = new Set<string>();
    const noteIds = new Set<string>();
    v.tracks.forEach((t, i) => this.track(t, `${tp}[${i}]`, trackIds, noteIds));
  }

  time(v: unknown, path: string) {
    if (!this.record(v, path)) return;
    if (v.unit === "sec") {
      this.obj(v, path, ["unit"]);
    } else if (v.unit === "beat") {
      if (!this.obj(v, path, ["unit", "bpm", "sig"])) return;
      this.num(v, "bpm", path, { required: true, gt: 0, max: 1000 });
      if (v.sig !== undefined) {
        const s = v.sig;
        const ok =
          Array.isArray(s) &&
          s.length === 2 &&
          Number.isInteger(s[0]) &&
          s[0] > 0 &&
          [1, 2, 4, 8, 16, 32].includes(s[1] as number);
        if (!ok) this.err(join(path, "sig"), "[拍数, 2 の累乗の音価] にしてください（例：[4, 4]）");
      }
    } else {
      this.err(join(path, "unit"), "sec / beat のどれかにしてください");
    }
  }

  track(v: unknown, path: string, trackIds: Set<string>, noteIds: Set<string>) {
    if (!this.obj(v, path, ["id", "instrument", "gain", "pan", "send", "notes"])) return;
    this.id(v, path, trackIds);
    this.str(v, "instrument", path, true);
    if (typeof v.instrument === "string" && v.instrument !== "" && !this.instruments.has(v.instrument)) {
      this.err(join(path, "instrument"), `楽器「${v.instrument}」が instruments にありません`);
    }
    this.num(v, "gain", path, { min: 0 });
    this.num(v, "pan", path, { min: -1, max: 1 });
    if (v.send !== undefined && this.record(v.send, join(path, "send"))) {
      for (const name of Object.keys(v.send)) {
        const sp = join(path, "send", name);
        if (!this.reverbs.has(name)) this.err(sp, `残響「${name}」が reverb にありません`);
        this.num(v.send, name, join(path, "send"), { min: 0 });
      }
    }
    const np = join(path, "notes");
    if (!Array.isArray(v.notes)) return this.err(np, "配列ではありません");
    v.notes.forEach((n, i) => this.note(n, `${np}[${i}]`, noteIds));
  }

  note(v: unknown, path: string, noteIds: Set<string>) {
    if (!this.obj(v, path, ["id", "t", "dur", "pitch", "tune", "vel"])) return;
    this.id(v, path, noteIds);
    this.num(v, "t", path, { required: true, min: 0 });
    this.num(v, "dur", path, { gt: 0 });
    this.num(v, "tune", path);
    this.num(v, "vel", path, { min: 0, max: 1 });
    const p = v.pitch;
    if (typeof p === "string") {
      if (noteNameToMidi(p) === null) this.err(join(path, "pitch"), `音名「${p}」が読めません（例：A4、C#5、Eb3）`);
    } else if (p !== undefined) {
      this.num(v, "pitch", path, { gt: 0, max: MAX_HZ });
    }
  }

  /** id は 1 つの音の中で、トラックどうし・音符どうしで重複させない（差分が 1 つに定まるように） */
  id(v: Obj, path: string, seen: Set<string>) {
    if (v.id === undefined) return;
    this.str(v, "id", path);
    if (typeof v.id !== "string") return;
    if (seen.has(v.id)) this.err(join(path, "id"), `id「${v.id}」が重複しています`);
    seen.add(v.id);
  }
}

function join(path: string, ...keys: string[]): string {
  return [path, ...keys].filter((s) => s !== "").join(".");
}

const SHARED_KEYS = ["master", "reverb", "instruments", "samples"];

export function validateBank(input: unknown): ValidationResult<Bank> {
  const c = new Checker();
  if (c.obj(input, "", ["format", "sounds", ...SHARED_KEYS])) {
    if (input.format !== BANK_FORMAT) c.err("format", `"${BANK_FORMAT}" ではありません`);
    c.shared(input, "");
    if (input.sounds === undefined) c.err("sounds", "必須です");
    else if (c.record(input.sounds, "sounds")) {
      for (const [name, s] of Object.entries(input.sounds)) c.sound(s, join("sounds", name));
    }
  }
  return c.errors.length === 0 ? { ok: true, value: input as Bank } : { ok: false, errors: c.errors };
}

export function validateScore(input: unknown): ValidationResult<Score> {
  const c = new Checker();
  if (c.record(input, "")) {
    if (input.format !== SCORE_FORMAT) c.err("format", `"${SCORE_FORMAT}" ではありません`);
    c.shared(input, "");
    c.sound(input, "", ["format", ...SHARED_KEYS]);
  }
  return c.errors.length === 0 ? { ok: true, value: input as Score } : { ok: false, errors: c.errors };
}
