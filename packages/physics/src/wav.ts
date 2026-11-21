// wav（RIFF / WAVE）の読み書き。書くのは 16bit 整数か 32bit 浮動小数の PCM、読むのは 16・24・32bit 整数と 32bit 浮動小数。
import type { Signal } from "@sfx-atelier/analysis";

export type WavBits = 16 | 32;

/** Signal → wav のバイト列。16bit は 32768 倍して丸め、-32768〜32767 に切る（読むときは 32768 で割るので往復で戻る）。32 は浮動小数（format 3） */
export function encodeWav(signal: Signal, bits: WavBits = 16): Uint8Array {
  const ch = signal.channels.length;
  if (ch === 0) throw new Error("チャンネルがありません");
  const n = signal.channels[0]!.length;
  const bytesPer = bits / 8;
  const dataBytes = n * ch * bytesPer;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, bits === 32 ? 3 : 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, signal.sampleRate, true);
  v.setUint32(28, signal.sampleRate * ch * bytesPer, true);
  v.setUint16(32, ch * bytesPer, true);
  v.setUint16(34, bits, true);
  text(36, "data");
  v.setUint32(40, dataBytes, true);
  let at = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const x = signal.channels[c]![i]!;
      if (bits === 32) v.setFloat32(at, x, true);
      else v.setInt16(at, Math.max(-32768, Math.min(32767, Math.round(x * 32768))), true);
      at += bytesPer;
    }
  return new Uint8Array(buf);
}

/** wav のバイト列 → Signal。fmt と data 以外の塊は読み飛ばす */
export function decodeWav(bytes: Uint8Array): Signal {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
  if (bytes.byteLength < 12 || text(0) !== "RIFF" || text(8) !== "WAVE") throw new Error("wav ではありません");
  let fmt: { format: number; ch: number; rate: number; bits: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = text(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      let format = v.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE：本当の形式は SubFormat の先頭 2 バイト
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true);
      fmt = { format, ch: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (!fmt) throw new Error("fmt の前に data があります");
      const { format, ch, rate, bits } = fmt;
      const per = bits / 8;
      const len = Math.min(size, bytes.byteLength - body);
      const n = Math.floor(len / (per * ch));
      const channels = Array.from({ length: ch }, () => new Float32Array(n));
      const read =
        format === 3 && bits === 32 ? (p: number) => v.getFloat32(p, true)
        : format === 1 && bits === 16 ? (p: number) => v.getInt16(p, true) / 32768
        : format === 1 && bits === 24 ? (p: number) => ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 8388608)
        : format === 1 && bits === 32 ? (p: number) => v.getInt32(p, true) / 2147483648
        : null;
      if (!read) throw new Error(`読めない形式です（format ${format}, ${bits}bit）`);
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) channels[c]![i] = read(body + (i * ch + c) * per);
      return { sampleRate: rate, channels };
    }
    at = body + size + (size & 1);
  }
  throw new Error("data がありません");
}
