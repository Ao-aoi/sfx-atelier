// 2 つの版の差分（エディタで開いたときに出す）。
// 配列の要素は id があれば id で、無ければ番号で対応させる（保存した作品はトラック・音符の id を持つ）。
import { shrinkBank, shrinkScore, type Bank, type PathSegment, type Score } from "@sfx-atelier/format";

export interface Change {
  path: PathSegment[];
  kind: "add" | "remove" | "set";
  before?: unknown;
  after?: unknown;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const idOf = (v: unknown) => (isObj(v) && typeof v.id === "string" ? v.id : undefined);

function walk(a: unknown, b: unknown, path: PathSegment[], out: Change[]) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    const byId = a.every((x) => idOf(x)) && b.every((x) => idOf(x));
    if (byId) {
      const am = new Map(a.map((x) => [idOf(x)!, x]));
      const bm = new Map(b.map((x) => [idOf(x)!, x]));
      for (const [id, x] of am) if (!bm.has(id)) out.push({ path: [...path, id], kind: "remove", before: x });
      for (const [id, y] of bm) {
        if (!am.has(id)) out.push({ path: [...path, id], kind: "add", after: y });
        else walk(am.get(id), y, [...path, id], out);
      }
      return;
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length) out.push({ path: [...path, i], kind: "add", after: b[i] });
      else if (i >= b.length) out.push({ path: [...path, i], kind: "remove", before: a[i] });
      else walk(a[i], b[i], [...path, i], out);
    }
    return;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in b)) out.push({ path: [...path, k], kind: "remove", before: a[k] });
      else if (!(k in a)) out.push({ path: [...path, k], kind: "add", after: b[k] });
      else walk(a[k], b[k], [...path, k], out);
    }
    return;
  }
  out.push({ path, kind: "set", before: a, after: b });
}

/** a → b の差分。比べる前に縮める（既定値の書き方の違いは差分にしない） */
export function diffDocs(a: Score | Bank, b: Score | Bank): Change[] {
  const shrink = (x: Score | Bank) => (x.format === "sfx-bank/1" ? shrinkBank(x as Bank, { keepIds: true }) : shrinkScore(x as Score, { keepIds: true }));
  const out: Change[] = [];
  walk(shrink(a), shrink(b), [], out);
  return out;
}

const short = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

/** 1 行の文字列：「tracks.t1.notes.n2.pitch "E5" → "D5"」「+ tracks.t1.notes.n4 {...}」 */
export function changeText(c: Change): string {
  const p = c.path.join(".") || "(全体)";
  if (c.kind === "add") return `+ ${p} ${short(c.after)}`;
  if (c.kind === "remove") return `− ${p}`;
  return `${p} ${short(c.before)} → ${short(c.after)}`;
}
