/**
 * 録音（wav）。中身は R2（RECORDINGS）、D1 には key と大きさだけ。
 * 作品に結びつけた録音は、その作品の public が 1 なら認証なしで取れる（/api/public/recordings/:id）。
 */
import type { Env } from "./env";
import { HttpError, nowIso } from "./http";
import { LIMITS } from "./limits";
import { checkName, findSound } from "./sounds";

export interface Recording {
  id: string;
  name: string;
  soundId: string | null;
  bytes: number;
  createdAt: string;
}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

/** RIFF / WAVE の頭があるか */
export function isWav(data: Uint8Array): boolean {
  return data.length >= 12 && ascii(data, 0) === "RIFF" && ascii(data, 8) === "WAVE";
}

export async function putRecording(env: Env, userId: string, input: { name: unknown; soundId?: string | null; data: Uint8Array }): Promise<Recording> {
  const name = checkName(input.name);
  if (!isWav(input.data)) throw new HttpError(400, "wav（RIFF / WAVE）ではありません", "not_wav");
  if (input.data.length > LIMITS.maxRecordingBytes) throw new HttpError(413, `録音は ${LIMITS.maxRecordingBytes / 1024 / 1024}MB までです`);
  const used = await env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS total FROM recordings WHERE user_id = ?").bind(userId).first<{ total: number }>();
  if ((used?.total ?? 0) + input.data.length > LIMITS.maxRecordingTotalBytes) {
    throw new HttpError(413, `録音の合計が ${LIMITS.maxRecordingTotalBytes / 1024 / 1024}MB を超えます。古い録音を消してください`, "recordings_full");
  }
  const soundId = input.soundId ? (await findSound(env, userId, input.soundId)).id : null;
  const id = crypto.randomUUID();
  const key = `recordings/${userId}/${id}.wav`;
  await env.RECORDINGS.put(key, input.data, { httpMetadata: { contentType: "audio/wav" } });
  const at = nowIso();
  await env.DB.prepare("INSERT INTO recordings (id, user_id, sound_id, name, r2_key, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, userId, soundId, name, key, input.data.length, at)
    .run();
  return { id, name, soundId, bytes: input.data.length, createdAt: at };
}

export async function listRecordings(env: Env, userId: string, opts: { soundId?: string; limit?: number } = {}): Promise<Recording[]> {
  const limit = Math.max(1, Math.min(LIMITS.maxList, opts.limit ?? 50));
  const soundId = opts.soundId ? (await findSound(env, userId, opts.soundId)).id : undefined;
  const r = await env.DB.prepare(
    `SELECT id, name, sound_id, bytes, created_at FROM recordings WHERE user_id = ?${soundId ? " AND sound_id = ?" : ""} ORDER BY created_at DESC, id LIMIT ?`,
  )
    .bind(...(soundId ? [userId, soundId, limit] : [userId, limit]))
    .all<{ id: string; name: string; sound_id: string | null; bytes: number; created_at: string }>();
  return r.results.map((x) => ({ id: x.id, name: x.name, soundId: x.sound_id, bytes: x.bytes, createdAt: x.created_at }));
}

async function readKey(env: Env, key: string): Promise<ArrayBuffer> {
  const obj = await env.RECORDINGS.get(key);
  if (!obj) throw new HttpError(404, "録音の中身がありません");
  return obj.arrayBuffer();
}

export async function getRecording(env: Env, userId: string, id: string): Promise<{ name: string; data: ArrayBuffer }> {
  const row = await env.DB.prepare("SELECT name, r2_key FROM recordings WHERE id = ? AND user_id = ?").bind(id, userId).first<{ name: string; r2_key: string }>();
  if (!row) throw new HttpError(404, "録音がありません");
  return { name: row.name, data: await readKey(env, row.r2_key) };
}

/** 認証なし：公開にした作品の録音だけ */
export async function getPublicRecording(env: Env, id: string): Promise<{ name: string; data: ArrayBuffer }> {
  const row = await env.DB.prepare(
    "SELECT r.name, r.r2_key FROM recordings r JOIN sounds s ON s.id = r.sound_id AND s.user_id = r.user_id WHERE r.id = ? AND s.public = 1",
  )
    .bind(id)
    .first<{ name: string; r2_key: string }>();
  if (!row) throw new HttpError(404, "録音がありません");
  return { name: row.name, data: await readKey(env, row.r2_key) };
}

export async function deleteRecording(env: Env, userId: string, id: string): Promise<{ id: string; deleted: true }> {
  const row = await env.DB.prepare("SELECT r2_key FROM recordings WHERE id = ? AND user_id = ?").bind(id, userId).first<{ r2_key: string }>();
  if (!row) throw new HttpError(404, "録音がありません");
  await env.RECORDINGS.delete(row.r2_key);
  await env.DB.prepare("DELETE FROM recordings WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return { id, deleted: true };
}
