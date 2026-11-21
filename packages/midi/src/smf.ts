// 標準 MIDI ファイル（SMF）の読み書き。形式 0・1・2、四分音符あたりの分解能（PPQ）と SMPTE の分解能。
// 時刻はトラックの先頭からの絶対 tick で持つ（差分は読み書きのときだけ）。
// 音符・プログラム・コントロール・テンポ・拍子・トラック名だけを形にし、ほかは種類だけ残す（数えて知らせるため）。

export type MidiEvent =
  | { tick: number; type: "noteOn"; ch: number; key: number; vel: number }
  | { tick: number; type: "noteOff"; ch: number; key: number; vel: number }
  | { tick: number; type: "program"; ch: number; program: number }
  | { tick: number; type: "control"; ch: number; cc: number; value: number }
  /** 四分音符 1 つのマイクロ秒 */
  | { tick: number; type: "tempo"; usPerBeat: number }
  /** den は音価（4 なら四分音符） */
  | { tick: number; type: "timeSig"; num: number; den: number }
  | { tick: number; type: "trackName"; text: string }
  /** 形にしていないもの（ピッチベンド・アフタータッチ・SysEx・ほかのメタ）。kind は数えるときの名前 */
  | { tick: number; type: "other"; kind: OtherKind };

export type OtherKind = "pitchBend" | "aftertouch" | "sysex" | "meta";

export interface MidiTrack {
  events: MidiEvent[];
}

export interface Smf {
  format: 0 | 1 | 2;
  /** 四分音符あたりの tick。SMPTE のときは null */
  ppq: number | null;
  /** SMPTE の分解能（1 秒のフレーム数 × 1 フレームの tick）。ppq が null のときだけ */
  smpte?: { fps: number; ticksPerFrame: number };
  tracks: MidiTrack[];
}

export class MidiError extends Error {}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

class Reader {
  pos: number;
  constructor(
    private b: Uint8Array,
    start: number,
    readonly end: number,
  ) {
    this.pos = start;
  }
  get done() {
    return this.pos >= this.end;
  }
  u8() {
    if (this.pos >= this.end) throw new MidiError("トラックの途中でデータが終わっています");
    return this.b[this.pos++]!;
  }
  /** 可変長の数（7 ビットずつ、最大 4 バイト） */
  vlq() {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.u8();
      v = v * 128 + (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    throw new MidiError("可変長の数が 4 バイトを超えています");
  }
  bytes(n: number) {
    if (this.pos + n > this.end) throw new MidiError("トラックの途中でデータが終わっています");
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

const u16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;

/** SMF のバイト列を読む。壊れていれば MidiError */
export function readSmf(bytes: Uint8Array): Smf {
  if (bytes.length < 14 || ascii(bytes, 0) !== "MThd") throw new MidiError("MIDI ファイルではありません（先頭が MThd ではありません）");
  const hlen = u32(bytes, 4);
  if (hlen < 6 || 8 + hlen > bytes.length) throw new MidiError("ヘッダの長さが不正です");
  const format = u16(bytes, 8);
  if (format > 2) throw new MidiError(`形式 ${format} には対応していません（0・1・2 のみ）`);
  const ntrks = u16(bytes, 10);
  const div = u16(bytes, 12);
  let ppq: number | null = null;
  let smpte: Smf["smpte"];
  if (div & 0x8000) {
    // 上位バイトは -fps（2 の補数）、下位バイトはフレームあたりの tick
    const fps = 256 - (div >> 8);
    const tpf = div & 0xff;
    if (![24, 25, 29, 30].includes(fps) || tpf === 0) throw new MidiError("SMPTE の分解能が不正です");
    smpte = { fps: fps === 29 ? 29.97 : fps, ticksPerFrame: tpf };
  } else {
    if (div === 0) throw new MidiError("分解能が 0 です");
    ppq = div;
  }

  const tracks: MidiTrack[] = [];
  let at = 8 + hlen;
  while (at + 8 <= bytes.length && tracks.length < ntrks) {
    const id = ascii(bytes, at);
    const len = u32(bytes, at + 4);
    const start = at + 8;
    if (start + len > bytes.length) throw new MidiError(`トラック ${tracks.length + 1} の長さがファイルを超えています`);
    // 知らない塊は読み飛ばす（仕様どおり）
    if (id === "MTrk") tracks.push(readTrack(new Reader(bytes, start, start + len)));
    at = start + len;
  }
  if (tracks.length < ntrks) throw new MidiError(`トラックが ${ntrks} 個のはずが ${tracks.length} 個しかありません`);
  const out: Smf = { format: format as 0 | 1 | 2, ppq, tracks };
  if (smpte) out.smpte = smpte;
  return out;
}

const DATA_BYTES: Record<number, number> = { 0x8: 2, 0x9: 2, 0xa: 2, 0xb: 2, 0xc: 1, 0xd: 1, 0xe: 2 };

function readTrack(r: Reader): MidiTrack {
  const events: MidiEvent[] = [];
  let tick = 0;
  let running = 0;
  const decoder = new TextDecoder();
  while (!r.done) {
    tick += r.vlq();
    let status = r.u8();
    let first: number | undefined;
    if (status < 0x80) {
      // ランニングステータス：前のチャンネルメッセージの続き
      if (!running) throw new MidiError("ステータスバイトがありません");
      first = status;
      status = running;
    }
    if (status === 0xff) {
      running = 0;
      const type = r.u8();
      const data = r.bytes(r.vlq());
      if (type === 0x2f) break; // トラックの終わり
      if (type === 0x51 && data.length === 3) events.push({ tick, type: "tempo", usPerBeat: (data[0]! << 16) | (data[1]! << 8) | data[2]! });
      else if (type === 0x58 && data.length >= 2) events.push({ tick, type: "timeSig", num: data[0]!, den: 2 ** data[1]! });
      else if (type === 0x03) events.push({ tick, type: "trackName", text: decoder.decode(data) });
      else events.push({ tick, type: "other", kind: "meta" });
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      running = 0;
      r.bytes(r.vlq());
      events.push({ tick, type: "other", kind: "sysex" });
      continue;
    }
    const hi = status >> 4;
    const n = DATA_BYTES[hi];
    if (n === undefined) throw new MidiError(`読めないステータス 0x${status.toString(16)}`);
    running = status;
    const ch = status & 0x0f;
    const d1 = first ?? r.u8();
    const d2 = n === 2 ? r.u8() : 0;
    if (hi === 0x9 && d2 > 0) events.push({ tick, type: "noteOn", ch, key: d1, vel: d2 });
    else if (hi === 0x8 || hi === 0x9) events.push({ tick, type: "noteOff", ch, key: d1, vel: d2 });
    else if (hi === 0xc) events.push({ tick, type: "program", ch, program: d1 });
    else if (hi === 0xb) events.push({ tick, type: "control", ch, cc: d1, value: d2 });
    else events.push({ tick, type: "other", kind: hi === 0xe ? "pitchBend" : "aftertouch" });
  }
  return { events };
}

// ---- 書き出し ----

function vlqBytes(v: number): number[] {
  const out = [v & 0x7f];
  v = Math.floor(v / 128);
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  return out;
}

/** 同じ tick の並び順：メタ → プログラム・コントロール → 音を止める → 音を出す */
const ORDER: Record<MidiEvent["type"], number> = { trackName: 0, tempo: 0, timeSig: 0, other: 0, program: 1, control: 1, noteOff: 2, noteOn: 3 };

function eventBytes(e: MidiEvent, encoder: TextEncoder): number[] | null {
  const c7 = (v: number) => Math.max(0, Math.min(127, Math.round(v)));
  switch (e.type) {
    case "noteOn":
      return [0x90 | e.ch, c7(e.key), Math.max(1, c7(e.vel))];
    case "noteOff":
      return [0x80 | e.ch, c7(e.key), c7(e.vel)];
    case "program":
      return [0xc0 | e.ch, c7(e.program)];
    case "control":
      return [0xb0 | e.ch, c7(e.cc), c7(e.value)];
    case "tempo": {
      const us = Math.max(1, Math.min(0xffffff, Math.round(e.usPerBeat)));
      return [0xff, 0x51, 3, us >> 16, (us >> 8) & 0xff, us & 0xff];
    }
    case "timeSig":
      return [0xff, 0x58, 4, e.num, Math.round(Math.log2(e.den)), 24, 8];
    case "trackName": {
      const t = [...encoder.encode(e.text)];
      return [0xff, 0x03, ...vlqBytes(t.length), ...t];
    }
    case "other":
      return null;
  }
}

/** SMF を書く。ランニングステータスは使わない。各トラックの最後にトラックの終わりを足す */
export function writeSmf(smf: Smf): Uint8Array {
  const encoder = new TextEncoder();
  const out: number[] = [];
  const push32 = (v: number) => out.push((v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  let div: number;
  if (smf.ppq !== null) {
    if (!(smf.ppq > 0 && smf.ppq < 0x8000)) throw new MidiError("分解能は 1〜32767 にしてください");
    div = smf.ppq;
  } else {
    const s = smf.smpte;
    if (!s) throw new MidiError("ppq か smpte のどちらかが要ります");
    div = ((256 - Math.round(s.fps)) << 8) | s.ticksPerFrame;
  }
  out.push(0x4d, 0x54, 0x68, 0x64);
  push32(6);
  out.push(0, smf.format, smf.tracks.length >> 8, smf.tracks.length & 0xff, div >> 8, div & 0xff);
  for (const t of smf.tracks) {
    const events = t.events
      .map((e, i) => ({ e, i }))
      .sort((a, b) => a.e.tick - b.e.tick || ORDER[a.e.type] - ORDER[b.e.type] || a.i - b.i);
    const body: number[] = [];
    let last = 0;
    for (const { e } of events) {
      const bytes = eventBytes(e, encoder);
      if (!bytes) continue;
      const tick = Math.max(last, Math.round(e.tick));
      body.push(...vlqBytes(tick - last), ...bytes);
      last = tick;
    }
    body.push(0, 0xff, 0x2f, 0);
    out.push(0x4d, 0x54, 0x72, 0x6b);
    push32(body.length);
    for (const b of body) out.push(b);
  }
  return new Uint8Array(out);
}

// ---- 時刻 ----

/** tick → 秒。テンポは全トラックのテンポの出来事から作る（形式 1 では普通 1 本目にある） */
export function tickClock(smf: Smf): (tick: number) => number {
  if (smf.ppq === null) {
    const s = smf.smpte!;
    return (tick) => tick / (s.fps * s.ticksPerFrame);
  }
  const ppq = smf.ppq;
  const changes = tempoChanges(smf);
  // 区切りごとの開始 tick・開始秒・1 tick の秒
  const segs: { tick: number; sec: number; spt: number }[] = [];
  let sec = 0;
  let prev = { tick: 0, spt: 0.5 / ppq };
  for (const c of changes) {
    sec += (c.tick - prev.tick) * prev.spt;
    prev = { tick: c.tick, spt: c.usPerBeat / 1e6 / ppq };
    segs.push({ tick: c.tick, sec, spt: prev.spt });
  }
  if (!segs.length || segs[0]!.tick > 0) segs.unshift({ tick: 0, sec: 0, spt: 0.5 / ppq });
  return (tick) => {
    let s = segs[0]!;
    for (const x of segs) {
      if (x.tick > tick) break;
      s = x;
    }
    return s.sec + (tick - s.tick) * s.spt;
  };
}

/** テンポの変わり目（tick の順。同じ tick は後のものが勝つ）。テンポが無ければ空（= 120 BPM） */
export function tempoChanges(smf: Smf): { tick: number; usPerBeat: number }[] {
  const all = smf.tracks.flatMap((t) => t.events.flatMap((e) => (e.type === "tempo" ? [{ tick: e.tick, usPerBeat: e.usPerBeat }] : [])));
  all.sort((a, b) => a.tick - b.tick);
  const out: { tick: number; usPerBeat: number }[] = [];
  for (const c of all) {
    if (out.length && out[out.length - 1]!.tick === c.tick) out[out.length - 1] = c;
    else out.push(c);
  }
  return out;
}
