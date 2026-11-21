/**
 * 用途と好みの記憶（提案書 C6）：どのゲームの音か・好きな音・避けたい音など。Markdown で 60 行以内。
 * 更新は base_version が最新のときだけ（古ければ 409）。古い版は user_context_history に残す。
 */
import type { Env } from "./env";
import { HttpError, nowIso } from "./http";
import { LIMITS } from "./limits";

export interface Context {
  markdown: string;
  /** まだ無ければ 0 */
  version: number;
  updatedAt: string | null;
}

export async function getContext(env: Env, userId: string): Promise<Context> {
  const row = await env.DB.prepare("SELECT body, version, updated_at FROM user_context WHERE user_id = ?").bind(userId).first<{ body: string; version: number; updated_at: string }>();
  return row ? { markdown: row.body, version: row.version, updatedAt: row.updated_at } : { markdown: "", version: 0, updatedAt: null };
}

export async function updateContext(env: Env, userId: string, input: { markdown: unknown; baseVersion: unknown }): Promise<Context> {
  const md = input.markdown;
  if (typeof md !== "string") throw new HttpError(400, "markdown が必要です");
  const lines = md.replace(/\n+$/, "").split("\n").length;
  if (lines > LIMITS.maxContextLines) throw new HttpError(400, `${LIMITS.maxContextLines} 行までです（${lines} 行）`);
  if (new TextEncoder().encode(md).length > LIMITS.maxContextBytes) throw new HttpError(413, "大きすぎます");
  const base = input.baseVersion;
  if (typeof base !== "number" || !Number.isInteger(base) || base < 0) throw new HttpError(400, "base_version（読んだときの版。まだ無ければ 0）が必要です");
  const cur = await getContext(env, userId);
  if (cur.version !== base) throw new HttpError(409, `版 ${cur.version} に更新されています（読んだのは版 ${base}）。読み直してから書いてください`, "version_conflict");
  const next = base + 1;
  const at = nowIso();
  const stmts = [
    env.DB.prepare("INSERT INTO user_context_history (user_id, version, body, updated_at) VALUES (?, ?, ?, ?)").bind(userId, next, md, at),
    base === 0
      ? env.DB.prepare("INSERT INTO user_context (user_id, body, version, updated_at) VALUES (?, ?, ?, ?)").bind(userId, md, next, at)
      : env.DB.prepare("UPDATE user_context SET body = ?, version = ?, updated_at = ? WHERE user_id = ? AND version = ?").bind(md, next, at, userId, base),
  ];
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String((e as Error).message))) throw new HttpError(409, "先に更新されました。読み直してから書いてください", "version_conflict");
    throw e;
  }
  return { markdown: md, version: next, updatedAt: at };
}
