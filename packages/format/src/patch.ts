// 変更案の形式 sfx-patch/1：score（かバンク）への差分。Claude が返し、エディタが適用・取り消しする。
//
// path は区切りの並び。オブジェクトはキー、配列は「文字列なら id が一致する要素・数なら番号」。
//   ["tracks", "t1", "notes", "n2", "vel"]           … トラック t1 の音符 n2 の vel
//   ["instruments", "clack", "layers", 2, "env", "d"] … clack の 3 番目の層の減衰
// 操作は 3 つ。
//   set    path の値を置き換える（オブジェクトなら無いキーを足してもよい。配列の要素は既にあるものだけ）
//   add    path の配列に value を足す（at があればその番号に、無ければ末尾に）
//   remove path の値を消す（オブジェクトのキーか配列の要素）
// 適用は全部か無しか。途中で失敗したら元のまま返す。結果は検証を通す。
import type { Bank, Score } from "./types";
import { validateBank, validateScore, type ValidationError } from "./validate";

export const PATCH_FORMAT = "sfx-patch/1";

export type PathSegment = string | number;

export type PatchOp =
  | { op: "set"; path: PathSegment[]; value: unknown }
  | { op: "add"; path: PathSegment[]; value: unknown; at?: number }
  | { op: "remove"; path: PathSegment[] };

export interface Patch {
  format: typeof PATCH_FORMAT;
  /** 何を変えるか（人と Claude 向けの説明。適用には使わない） */
  note?: string;
  ops: PatchOp[];
}

export type PatchResult<T> =
  | { ok: true; value: T; inverse: Patch }
  | { ok: false; errors: ValidationError[] };

type Container = Record<string, unknown> | unknown[];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isContainer = (v: unknown): v is Container => typeof v === "object" && v !== null;

class PatchError extends Error {
  constructor(public path: string, message: string) {
    super(message);
  }
}

const showPath = (p: PathSegment[]) => (p.length ? p.map(String).join(".") : "(根)");

/** 配列の中の位置。文字列は id、数は番号 */
function indexIn(arr: unknown[], seg: PathSegment): number {
  if (typeof seg === "number") return Number.isInteger(seg) && seg >= 0 && seg < arr.length ? seg : -1;
  return arr.findIndex((e) => isObject(e) && e.id === seg);
}

function child(parent: Container, seg: PathSegment): unknown {
  if (Array.isArray(parent)) {
    const i = indexIn(parent, seg);
    return i < 0 ? undefined : parent[i];
  }
  return typeof seg === "string" && Object.hasOwn(parent, seg) ? parent[seg] : undefined;
}

/** path の最後の 1 つ手前まで辿る */
function walk(root: unknown, path: PathSegment[], upTo: number): Container {
  let cur = root;
  for (let i = 0; i < upTo; i++) {
    if (!isContainer(cur)) throw new PatchError(showPath(path), `${showPath(path.slice(0, i))} の先を辿れない`);
    const next = child(cur, path[i]!);
    if (next === undefined) throw new PatchError(showPath(path), `${showPath(path.slice(0, i + 1))} が無い`);
    cur = next;
  }
  if (!isContainer(cur)) throw new PatchError(showPath(path), `${showPath(path.slice(0, upTo))} はオブジェクトでも配列でもない`);
  return cur;
}

/** 1 つの操作を適用し、取り消しの操作を返す */
function applyOp(root: unknown, op: PatchOp): PatchOp {
  const where = showPath(op.path);
  if (op.op === "add") {
    const arr = walk(root, op.path, op.path.length);
    if (!Array.isArray(arr)) throw new PatchError(where, "add の行き先が配列でない");
    const at = op.at ?? arr.length;
    if (!Number.isInteger(at) || at < 0 || at > arr.length) throw new PatchError(where, `at が範囲外: ${at}`);
    const id = isObject(op.value) ? op.value.id : undefined;
    if (typeof id === "string" && indexIn(arr, id) >= 0) throw new PatchError(where, `id が重複: ${id}`);
    arr.splice(at, 0, structuredClone(op.value));
    return { op: "remove", path: [...op.path, at] };
  }
  if (op.path.length === 0) throw new PatchError(where, "根は置き換え・削除できない");
  const parent = walk(root, op.path, op.path.length - 1);
  const last = op.path[op.path.length - 1]!;
  const parentPath = op.path.slice(0, -1);
  if (Array.isArray(parent)) {
    const i = indexIn(parent, last);
    if (i < 0) throw new PatchError(where, "配列の要素が無い");
    const old = parent[i];
    if (op.op === "set") {
      parent[i] = structuredClone(op.value);
      return { op: "set", path: [...parentPath, i], value: old };
    }
    parent.splice(i, 1);
    return { op: "add", path: parentPath, value: old, at: i };
  }
  if (typeof last !== "string") throw new PatchError(where, "オブジェクトのキーは文字列");
  const had = Object.hasOwn(parent, last);
  const old = parent[last];
  if (op.op === "set") {
    parent[last] = structuredClone(op.value);
    return had ? { op: "set", path: op.path, value: old } : { op: "remove", path: op.path };
  }
  if (!had) throw new PatchError(where, "消すキーが無い");
  delete parent[last];
  return { op: "set", path: op.path, value: old };
}

/** 形の検査（JSON から読んだものを想定） */
export function validatePatch(input: unknown): { ok: true; value: Patch } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  if (!isObject(input)) return { ok: false, errors: [{ path: "", message: "オブジェクトでない" }] };
  if (input.format !== PATCH_FORMAT) err("format", `${PATCH_FORMAT} でない`);
  if (!Array.isArray(input.ops)) err("ops", "配列でない");
  else
    input.ops.forEach((op, i) => {
      const at = `ops.${i}`;
      if (!isObject(op)) return err(at, "オブジェクトでない");
      if (op.op !== "set" && op.op !== "add" && op.op !== "remove") err(`${at}.op`, "set・add・remove のどれでもない");
      if (!Array.isArray(op.path) || !op.path.every((s) => typeof s === "string" || typeof s === "number"))
        err(`${at}.path`, "文字列か数の配列でない");
      if ((op.op === "set" || op.op === "add") && !("value" in op)) err(`${at}.value`, "無い");
      if (op.at !== undefined && op.op !== "add") err(`${at}.at`, "add のときだけ書ける");
    });
  return errors.length ? { ok: false, errors } : { ok: true, value: input as unknown as Patch };
}

/**
 * 差分を適用する。入力は書き換えない。
 * 成功すると、結果と取り消し用の差分（inverse。結果に適用すると元に戻る）を返す。
 * 結果は format に合わせて validateScore か validateBank を通す。
 */
export function applyPatch<T extends Score | Bank>(target: T, patch: Patch): PatchResult<T> {
  const checked = validatePatch(patch);
  if (!checked.ok) return checked;
  const draft = structuredClone(target);
  const inverse: PatchOp[] = [];
  try {
    for (const op of patch.ops) inverse.unshift(applyOp(draft, op));
  } catch (e) {
    if (e instanceof PatchError) return { ok: false, errors: [{ path: e.path, message: e.message }] };
    throw e;
  }
  const result = draft.format === "sfx-bank/1" ? validateBank(draft) : validateScore(draft);
  if (!result.ok) return result;
  return { ok: true, value: draft, inverse: { format: PATCH_FORMAT, ops: inverse } };
}
