// JSON の読み書き。読み込んだものは正規化して編集し、書き出すときに縮める。
import {
  BANK_FORMAT,
  SCORE_FORMAT,
  normalizeBank,
  normalizeScore,
  shrinkBank,
  shrinkScore,
  validateBank,
  validateScore,
  type Bank,
  type Score,
} from "@sfx-atelier/format";

export type Loaded = { kind: "score"; score: Score } | { kind: "bank"; bank: Bank } | { kind: "error"; errors: string[] };

/** JSON の文字列を読む。format で score かバンクかを見分け、検証して正規化する */
export function parseJson(text: string): Loaded {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { kind: "error", errors: [`JSON として読めません：${(e as Error).message}`] };
  }
  const format = (data as { format?: unknown } | null)?.format;
  if (format === BANK_FORMAT) {
    const r = validateBank(data);
    return r.ok ? { kind: "bank", bank: normalizeBank(r.value) } : { kind: "error", errors: r.errors.map(errorText) };
  }
  if (format === SCORE_FORMAT) {
    const r = validateScore(data);
    return r.ok ? { kind: "score", score: normalizeScore(r.value) } : { kind: "error", errors: r.errors.map(errorText) };
  }
  return { kind: "error", errors: [`format が ${SCORE_FORMAT} でも ${BANK_FORMAT} でもありません`] };
}

const errorText = (e: { path: string; message: string }) => `${e.path}: ${e.message}`;

/** バンクの 1 音を score にする。その音が使う楽器・残響・録音だけを持たせる */
export function scoreFromBank(bank: Bank, name: string): Score {
  const sound = bank.sounds[name];
  if (!sound) throw new Error(`バンクに「${name}」がありません`);
  const used = new Set(sound.tracks.map((t) => t.instrument));
  const instruments = Object.fromEntries(Object.entries(bank.instruments ?? {}).filter(([k]) => used.has(k)));
  const sends = new Set(sound.tracks.flatMap((t) => Object.keys(t.send ?? {})));
  const reverb = Object.fromEntries(Object.entries(bank.reverb ?? {}).filter(([k]) => sends.has(k)));
  const samples = new Set(Object.values(instruments).flatMap((i) => i.layers.flatMap((l) => ("sample" in l ? [l.sample] : []))));
  const sampleRefs = Object.fromEntries(Object.entries(bank.samples ?? {}).filter(([k]) => samples.has(k)));
  return normalizeScore(
    structuredClone({ format: SCORE_FORMAT, master: bank.master, reverb, instruments, samples: sampleRefs, ...sound }) as Score,
  );
}

/** score の音の部分（楽器などを除いたもの） */
function soundOf(score: Score) {
  const { format: _f, master: _m, reverb: _r, instruments: _i, samples: _s, ...sound } = score;
  return sound;
}

/**
 * バンクの name を score で置き換える。楽器・残響・録音は score のもので上書きする
 * （同じ名前の楽器を使うほかの音も変わる。変えたくなければ、エディタで楽器を複製してから直す）
 */
export function mergeIntoBank(bank: Bank, name: string, score: Score): Bank {
  return {
    ...bank,
    reverb: { ...bank.reverb, ...score.reverb },
    instruments: { ...bank.instruments, ...score.instruments },
    samples: { ...bank.samples, ...score.samples },
    sounds: { ...bank.sounds, [name]: soundOf(score) },
  };
}

/** 書き出す JSON（縮めた形。使っていない楽器は落とす） */
export function scoreJson(score: Score): string {
  const used = new Set(score.tracks.map((t) => t.instrument));
  const instruments = Object.fromEntries(Object.entries(score.instruments ?? {}).filter(([k]) => used.has(k)));
  return JSON.stringify(shrinkScore({ ...score, instruments }), null, 2) + "\n";
}

export function bankJson(bank: Bank): string {
  return JSON.stringify(shrinkBank(bank), null, 2) + "\n";
}

/** 新しい空の score（正弦波の楽器 1 つ、トラック 1 つ、音符なし） */
export function emptyScore(): Score {
  return normalizeScore({
    format: SCORE_FORMAT,
    instruments: { 楽器: { layers: [{ osc: "sine", ratio: 1 }] } },
    tracks: [{ instrument: "楽器", notes: [] }],
  });
}
