/**
 * 作品（score かバンク）と版。保存のたびに版を 1 つ増やし、古い版も残す。
 * 書き込みは base_version（読んだときの版）が最新でなければ 409 で断る（エディタと Claude が同時に書いても消し合わない）。
 * 中身は検証して縮めた形で持つ。
 */
import {
  applyPatch,
  BANK_FORMAT,
  normalizeBank,
  normalizeScore,
  SCORE_FORMAT,
  shrinkBank,
  shrinkScore,
  validateBank,
  validatePatch,
  validateScore,
  type Bank,
  type Patch,
  type Score,
} from "@sfx-atelier/format";
import type { Env } from "./env";
import { HttpError, nowIso } from "./http";
import { LIMITS } from "./limits";

export type SoundKind = "score" | "bank";

export interface SoundSummary {
  id: string;
  name: string;
  kind: SoundKind;
  version: number;
  tags: string[];
  public: boolean;
  author: string;
  updatedAt: string;
}

export interface SoundVersion {
  id: string;
  name: string;
  kind: SoundKind;
  version: number;
  latestVersion: number;
  tags: string[];
  public: boolean;
  body: Score | Bank;
  note: string | null;
  author: string;
  /** この版が変更案から作られたときの sfx-patch/1 */
  patch: Patch | null;
  hasAnalysis: boolean;
  createdAt: string;
}

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s).length;

/** score かバンクを検証して、縮めた JSON にする。トラック・音符の id は残す（版をまたいで同じ音符を指せるように） */
export function checkBody(body: unknown): { kind: SoundKind; json: string } {
  const format = (body as { format?: unknown } | null)?.format;
  let json: string;
  let kind: SoundKind;
  if (format === SCORE_FORMAT) {
    const r = validateScore(body);
    if (!r.ok) throw new HttpError(400, `score が正しくありません：${errorsText(r.errors)}`, "invalid_body");
    json = JSON.stringify(shrinkScore(normalizeScore(r.value), { keepIds: true }));
    kind = "score";
  } else if (format === BANK_FORMAT) {
    const r = validateBank(body);
    if (!r.ok) throw new HttpError(400, `バンクが正しくありません：${errorsText(r.errors)}`, "invalid_body");
    json = JSON.stringify(shrinkBank(normalizeBank(r.value), { keepIds: true }));
    kind = "bank";
  } else {
    throw new HttpError(400, `format が ${SCORE_FORMAT} でも ${BANK_FORMAT} でもありません`, "invalid_body");
  }
  if (bytes(json) > LIMITS.maxBodyBytes) throw new HttpError(413, `作品が大きすぎます（${LIMITS.maxBodyBytes / 1024}KB まで）`);
  return { kind, json };
}

const errorsText = (errs: { path: string; message: string }[]) =>
  errs
    .slice(0, 5)
    .map((e) => `${e.path}: ${e.message}`)
    .join(" / ");

export function checkName(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) throw new HttpError(400, "name が必要です");
  const n = name.trim();
  if ([...n].length > LIMITS.maxNameChars) throw new HttpError(400, `name は ${LIMITS.maxNameChars} 文字までです`);
  return n;
}

export function checkTags(tags: unknown): string[] {
  if (tags === undefined) return [];
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) throw new HttpError(400, "tags は文字列の配列です");
  const out = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  if (out.length > LIMITS.maxTags) throw new HttpError(400, `tags は ${LIMITS.maxTags} 個までです`);
  if (out.some((t) => [...t].length > LIMITS.maxTagChars)) throw new HttpError(400, `タグは ${LIMITS.maxTagChars} 文字までです`);
  return out;
}

function checkNote(note: unknown): string | null {
  if (note === undefined || note === null || note === "") return null;
  if (typeof note !== "string") throw new HttpError(400, "note は文字列です");
  if ([...note].length > LIMITS.maxNoteChars) throw new HttpError(400, `note は ${LIMITS.maxNoteChars} 文字までです`);
  return note;
}

function checkAnalysis(a: unknown): string | null {
  if (a === undefined || a === null || a === "") return null;
  if (typeof a !== "string") throw new HttpError(400, "analysis は文字列です");
  if (bytes(a) > LIMITS.maxAnalysisBytes) throw new HttpError(413, "analysis が大きすぎます");
  return a;
}

function checkBase(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new HttpError(400, "base_version（読んだときの版、1 以上の整数）が必要です");
  return v;
}

interface SoundRow {
  id: string;
  name: string;
  kind: SoundKind;
  latest_version: number;
  public: number;
  updated_at: string;
}

async function soundRow(env: Env, userId: string, idOrName: string): Promise<SoundRow> {
  const row = await env.DB.prepare(
    "SELECT id, name, kind, latest_version, public, updated_at FROM sounds WHERE user_id = ? AND (id = ? OR name = ?) ORDER BY id = ? DESC LIMIT 1",
  )
    .bind(userId, idOrName, idOrName, idOrName)
    .first<SoundRow>();
  if (!row) throw new HttpError(404, `作品「${idOrName}」がありません`);
  return row;
}

async function tagsOf(env: Env, soundId: string): Promise<string[]> {
  const r = await env.DB.prepare("SELECT tag FROM sound_tags WHERE sound_id = ? ORDER BY tag").bind(soundId).all<{ tag: string }>();
  return r.results.map((x) => x.tag);
}

/** 作品の一覧（新しく更新した順）。tag で絞れる */
export async function listSounds(env: Env, userId: string, opts: { tag?: string; limit?: number } = {}): Promise<SoundSummary[]> {
  const limit = Math.max(1, Math.min(LIMITS.maxList, opts.limit ?? 30));
  const sql = `SELECT s.id, s.name, s.kind, s.latest_version, s.public, s.updated_at, v.author
                 FROM sounds s JOIN sound_versions v ON v.sound_id = s.id AND v.version = s.latest_version
                WHERE s.user_id = ?${opts.tag ? " AND EXISTS (SELECT 1 FROM sound_tags t WHERE t.sound_id = s.id AND t.tag = ?)" : ""}
                ORDER BY s.updated_at DESC, s.id LIMIT ?`;
  const args: unknown[] = opts.tag ? [userId, opts.tag, limit] : [userId, limit];
  const rows = (await env.DB.prepare(sql).bind(...args).all<SoundRow & { author: string }>()).results;
  const tags = new Map<string, string[]>();
  if (rows.length) {
    const t = await env.DB.prepare(`SELECT sound_id, tag FROM sound_tags WHERE user_id = ? AND sound_id IN (${rows.map(() => "?").join(",")}) ORDER BY tag`)
      .bind(userId, ...rows.map((r) => r.id))
      .all<{ sound_id: string; tag: string }>();
    for (const x of t.results) tags.set(x.sound_id, [...(tags.get(x.sound_id) ?? []), x.tag]);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    version: r.latest_version,
    tags: tags.get(r.id) ?? [],
    public: r.public === 1,
    author: r.author,
    updatedAt: r.updated_at,
  }));
}

/** 作品の 1 つの版（省略すると最新）。id か名前で引く */
export async function getSound(env: Env, userId: string, idOrName: string, version?: number): Promise<SoundVersion> {
  const s = await soundRow(env, userId, idOrName);
  const v = version ?? s.latest_version;
  const row = await env.DB.prepare("SELECT body, note, author, patch, analysis IS NOT NULL AS has_analysis, created_at FROM sound_versions WHERE sound_id = ? AND version = ?")
    .bind(s.id, v)
    .first<{ body: string; note: string | null; author: string; patch: string | null; has_analysis: number; created_at: string }>();
  if (!row) throw new HttpError(404, `「${s.name}」に版 ${v} はありません（最新は ${s.latest_version}）`);
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    version: v,
    latestVersion: s.latest_version,
    tags: await tagsOf(env, s.id),
    public: s.public === 1,
    body: JSON.parse(row.body),
    note: row.note,
    author: row.author,
    patch: row.patch ? JSON.parse(row.patch) : null,
    hasAnalysis: row.has_analysis === 1,
    createdAt: row.created_at,
  };
}

/** 版の一覧（新しい順） */
export async function listVersions(env: Env, userId: string, idOrName: string, limit = 30) {
  const s = await soundRow(env, userId, idOrName);
  const r = await env.DB.prepare(
    "SELECT version, author, note, patch IS NOT NULL AS from_patch, created_at FROM sound_versions WHERE sound_id = ? ORDER BY version DESC LIMIT ?",
  )
    .bind(s.id, Math.max(1, Math.min(LIMITS.maxList, limit)))
    .all<{ version: number; author: string; note: string | null; from_patch: number; created_at: string }>();
  return r.results.map((x) => ({ version: x.version, author: x.author, note: x.note, fromPatch: x.from_patch === 1, createdAt: x.created_at }));
}

/** 分析の要約（エディタが付けたもの）。無ければ null */
export async function getAnalysis(env: Env, userId: string, idOrName: string, version?: number): Promise<{ version: number; analysis: string | null }> {
  const s = await soundRow(env, userId, idOrName);
  const v = version ?? s.latest_version;
  const row = await env.DB.prepare("SELECT analysis FROM sound_versions WHERE sound_id = ? AND version = ?").bind(s.id, v).first<{ analysis: string | null }>();
  if (!row) throw new HttpError(404, `「${s.name}」に版 ${v} はありません`);
  return { version: v, analysis: row.analysis };
}

export interface SaveInput {
  name?: unknown;
  body: unknown;
  tags?: unknown;
  analysis?: unknown;
  note?: unknown;
  author: string;
}

/** 新しい作品を作る（版 1） */
export async function createSound(env: Env, userId: string, input: SaveInput): Promise<{ id: string; version: number }> {
  const name = checkName(input.name);
  const { kind, json } = checkBody(input.body);
  const tags = checkTags(input.tags);
  const taken = await env.DB.prepare("SELECT id FROM sounds WHERE user_id = ? AND name = ?").bind(userId, name).first();
  if (taken) throw new HttpError(409, `「${name}」という作品は既にあります`, "name_taken");
  const id = crypto.randomUUID();
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sounds (id, user_id, name, kind, latest_version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)").bind(id, userId, name, kind, at, at),
    versionInsert(env, { id, userId, version: 1, json, analysis: checkAnalysis(input.analysis), patch: null, note: checkNote(input.note), author: input.author, at }),
    ...tags.map((t) => env.DB.prepare("INSERT INTO sound_tags (sound_id, user_id, tag) VALUES (?, ?, ?)").bind(id, userId, t)),
  ]);
  return { id, version: 1 };
}

function versionInsert(
  env: Env,
  v: { id: string; userId: string; version: number; json: string; analysis: string | null; patch: string | null; note: string | null; author: string; at: string },
) {
  return env.DB.prepare(
    "INSERT INTO sound_versions (sound_id, user_id, version, body, analysis, patch, note, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(v.id, v.userId, v.version, v.json, v.analysis, v.patch, v.note, v.author, v.at);
}

/**
 * 新しい版を足す。latest_version を base から base + 1 に上げる UPDATE が 1 行も変えなければ、
 * 先に誰かが書いたということなので、版の INSERT ごと取り消して 409 にする
 */
async function appendVersion(
  env: Env,
  userId: string,
  s: SoundRow,
  base: number,
  v: { json: string; analysis: string | null; patch: string | null; note: string | null; author: string },
): Promise<number> {
  if (base !== s.latest_version) throw new HttpError(409, `「${s.name}」は版 ${s.latest_version} に更新されています（読んだのは版 ${base}）。読み直してから書いてください`, "version_conflict");
  const next = base + 1;
  const at = nowIso();
  try {
    await env.DB.batch([
      // 版の主キー（sound_id, version）が重なれば、同時に書いた方が失敗する
      versionInsert(env, { id: s.id, userId, version: next, ...v, at }),
      env.DB.prepare("UPDATE sounds SET latest_version = ?, updated_at = ? WHERE id = ? AND user_id = ? AND latest_version = ?").bind(next, at, s.id, userId, base),
    ]);
  } catch (e) {
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String((e as Error).message))) {
      throw new HttpError(409, `「${s.name}」は先に更新されました。読み直してから書いてください`, "version_conflict");
    }
    throw e;
  }
  return next;
}

/** 作品の中身を置き換える（新しい版）。kind は変えられない */
export async function saveVersion(
  env: Env,
  userId: string,
  idOrName: string,
  input: SaveInput & { baseVersion: unknown },
): Promise<{ id: string; version: number }> {
  const s = await soundRow(env, userId, idOrName);
  const base = checkBase(input.baseVersion);
  const { kind, json } = checkBody(input.body);
  if (kind !== s.kind) throw new HttpError(400, `「${s.name}」は ${s.kind} です。${kind} では上書きできません`);
  const version = await appendVersion(env, userId, s, base, { json, analysis: checkAnalysis(input.analysis), patch: null, note: checkNote(input.note), author: input.author });
  return { id: s.id, version };
}

/**
 * 変更案（sfx-patch/1）を最新の版に当てて、新しい版にする。
 * 返り値の inverse を当てると元に戻る。分析の要約は中身が変わるので引き継がない
 */
export async function applyPatchToSound(
  env: Env,
  userId: string,
  idOrName: string,
  input: { patch: unknown; baseVersion: unknown; note?: unknown; author: string },
): Promise<{ id: string; version: number; inverse: Patch }> {
  const s = await soundRow(env, userId, idOrName);
  const base = checkBase(input.baseVersion);
  const p = validatePatch(input.patch);
  if (!p.ok) throw new HttpError(400, `変更案が正しくありません：${errorsText(p.errors)}`, "invalid_patch");
  const current = await getSound(env, userId, s.id, s.latest_version);
  const body = current.kind === "score" ? normalizeScore(current.body as Score) : normalizeBank(current.body as Bank);
  const r = applyPatch(body, p.value);
  if (!r.ok) throw new HttpError(400, `変更案を当てられません：${errorsText(r.errors)}`, "patch_failed");
  const { json } = checkBody(r.value);
  const note = checkNote(input.note ?? p.value.note);
  const version = await appendVersion(env, userId, s, base, { json, analysis: null, patch: JSON.stringify(p.value), note, author: input.author });
  return { id: s.id, version, inverse: r.inverse };
}

/** 名前・タグ・録音の公開を変える（版は増えない） */
export async function updateMeta(env: Env, userId: string, idOrName: string, input: { name?: unknown; tags?: unknown; public?: unknown }): Promise<SoundSummary> {
  const s = await soundRow(env, userId, idOrName);
  const stmts = [];
  const at = nowIso();
  if (input.name !== undefined) {
    const name = checkName(input.name);
    const taken = await env.DB.prepare("SELECT id FROM sounds WHERE user_id = ? AND name = ? AND id <> ?").bind(userId, name, s.id).first();
    if (taken) throw new HttpError(409, `「${name}」という作品は既にあります`, "name_taken");
    stmts.push(env.DB.prepare("UPDATE sounds SET name = ?, updated_at = ? WHERE id = ?").bind(name, at, s.id));
  }
  if (input.public !== undefined) {
    if (typeof input.public !== "boolean") throw new HttpError(400, "public は true か false です");
    stmts.push(env.DB.prepare("UPDATE sounds SET public = ?, updated_at = ? WHERE id = ?").bind(input.public ? 1 : 0, at, s.id));
  }
  if (input.tags !== undefined) {
    const tags = checkTags(input.tags);
    stmts.push(env.DB.prepare("DELETE FROM sound_tags WHERE sound_id = ?").bind(s.id));
    for (const t of tags) stmts.push(env.DB.prepare("INSERT INTO sound_tags (sound_id, user_id, tag) VALUES (?, ?, ?)").bind(s.id, userId, t));
  }
  if (stmts.length) await env.DB.batch(stmts);
  const list = await listSounds(env, userId, { limit: LIMITS.maxList });
  return list.find((x) => x.id === s.id) ?? (await summaryOf(env, userId, s.id));
}

async function summaryOf(env: Env, userId: string, id: string): Promise<SoundSummary> {
  const v = await getSound(env, userId, id);
  return { id: v.id, name: v.name, kind: v.kind, version: v.version, tags: v.tags, public: v.public, author: v.author, updatedAt: v.createdAt };
}

/** 作品を消す。版・タグは一緒に消え、録音は作品から外れる（録音そのものは残す） */
export async function deleteSound(env: Env, userId: string, idOrName: string): Promise<{ id: string; deleted: true }> {
  const s = await soundRow(env, userId, idOrName);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sound_tags WHERE sound_id = ?").bind(s.id),
    env.DB.prepare("DELETE FROM sound_versions WHERE sound_id = ?").bind(s.id),
    env.DB.prepare("UPDATE recordings SET sound_id = NULL WHERE sound_id = ?").bind(s.id),
    env.DB.prepare("DELETE FROM sounds WHERE id = ? AND user_id = ?").bind(s.id, userId),
  ]);
  return { id: s.id, deleted: true };
}

export { soundRow as findSound };
