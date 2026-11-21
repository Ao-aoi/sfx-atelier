/**
 * 保存 API（/api/*）。Pages Functions の functions/api/[[path]].ts から呼ぶ。
 *
 *   GET    /api/me                          自分のユーザー情報
 *   GET    /api/sounds?tag=&limit=          作品の一覧
 *   POST   /api/sounds                      作品を作る { name, body, tags?, analysis?, note? } → { id, version }
 *   GET    /api/sounds/:id?version=         作品の 1 つの版（:id は id か名前）
 *   PUT    /api/sounds/:id                  新しい版 { body, base_version, analysis?, note? }
 *   PATCH  /api/sounds/:id                  名前・タグ・録音の公開 { name?, tags?, public? }
 *   DELETE /api/sounds/:id                  作品を消す
 *   GET    /api/sounds/:id/versions         版の一覧
 *   GET    /api/sounds/:id/analysis?version= 分析の要約
 *   POST   /api/sounds/:id/patch            変更案を当てる { patch, base_version, note? } → { version, inverse }
 *   GET    /api/recordings?sound_id=        録音の一覧
 *   POST   /api/recordings?name=&sound_id=  録音を置く（本文は wav）
 *   GET    /api/recordings/:id              録音の wav
 *   DELETE /api/recordings/:id              録音を消す
 *   GET    /api/context                     用途と好みの記憶
 *   PUT    /api/context                     { markdown, base_version }
 *   GET    /api/public/recordings/:id       公開にした作品の録音（認証なし。Access でこのパスだけ通す）
 */
import { identify, resolveUser, type AuthDeps } from "./auth";
import { getContext, updateContext } from "./context";
import type { Env } from "./env";
import { HttpError, json } from "./http";
import { LIMITS } from "./limits";
import { deleteRecording, getPublicRecording, getRecording, listRecordings, putRecording } from "./recordings";
import { applyPatchToSound, createSound, deleteSound, getAnalysis, getSound, listSounds, listVersions, saveVersion, updateMeta } from "./sounds";

/** エディタから保存したときの書き手 */
export const EDITOR_AUTHOR = "editor";

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const max = LIMITS.maxBodyBytes + LIMITS.maxAnalysisBytes + 4096;
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > max) throw new HttpError(413, "送るデータが大きすぎます");
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "送るデータが大きすぎます");
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON として読めません");
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new HttpError(400, "JSON のオブジェクトを送ってください");
  return v as Record<string, unknown>;
}

async function readBytes(request: Request): Promise<Uint8Array> {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > LIMITS.maxRecordingBytes) throw new HttpError(413, `録音は ${LIMITS.maxRecordingBytes / 1024 / 1024}MB までです`);
  return new Uint8Array(await request.arrayBuffer());
}

const intParam = (v: string | null) => {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "数は 1 以上の整数です");
  return n;
};

function wav(name: string, data: ArrayBuffer, cache: string): Response {
  return new Response(data, {
    headers: {
      "content-type": "audio/wav",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}.wav`,
      "cache-control": cache,
    },
  });
}

export async function handleApi(request: Request, env: Env, deps: AuthDeps = {}): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "").split("/").slice(2).map(decodeURIComponent); // ['', 'api', ...]
    const method = request.method;

    // 認証なし
    if (path[0] === "public" && path[1] === "recordings" && path[2] && path.length === 3 && method === "GET") {
      const r = await getPublicRecording(env, path[2]);
      return wav(r.name, r.data, "public, max-age=3600");
    }

    const user = await resolveUser(env.DB, await identify(request, env, deps));
    const q = url.searchParams;

    if (path.length === 1 && path[0] === "me" && method === "GET") return json(user);

    if (path[0] === "sounds") {
      if (path.length === 1 && method === "GET") return json(await listSounds(env, user.id, { tag: q.get("tag") || undefined, limit: intParam(q.get("limit")) }));
      if (path.length === 1 && method === "POST") {
        const b = await readJson(request);
        return json(await createSound(env, user.id, { name: b.name, body: b.body, tags: b.tags, analysis: b.analysis, note: b.note, author: EDITOR_AUTHOR }), 201);
      }
      const id = path[1];
      if (id && path.length === 2) {
        if (method === "GET") return json(await getSound(env, user.id, id, intParam(q.get("version"))));
        if (method === "PUT") {
          const b = await readJson(request);
          return json(await saveVersion(env, user.id, id, { body: b.body, baseVersion: b.base_version, analysis: b.analysis, note: b.note, author: EDITOR_AUTHOR }));
        }
        if (method === "PATCH") {
          const b = await readJson(request);
          return json(await updateMeta(env, user.id, id, { name: b.name, tags: b.tags, public: b.public }));
        }
        if (method === "DELETE") return json(await deleteSound(env, user.id, id));
      }
      if (id && path.length === 3 && path[2] === "versions" && method === "GET") return json(await listVersions(env, user.id, id, intParam(q.get("limit"))));
      if (id && path.length === 3 && path[2] === "analysis" && method === "GET") return json(await getAnalysis(env, user.id, id, intParam(q.get("version"))));
      if (id && path.length === 3 && path[2] === "patch" && method === "POST") {
        const b = await readJson(request);
        return json(await applyPatchToSound(env, user.id, id, { patch: b.patch, baseVersion: b.base_version, note: b.note, author: EDITOR_AUTHOR }));
      }
    }

    if (path[0] === "recordings") {
      if (path.length === 1 && method === "GET") return json(await listRecordings(env, user.id, { soundId: q.get("sound_id") || undefined, limit: intParam(q.get("limit")) }));
      if (path.length === 1 && method === "POST") {
        return json(await putRecording(env, user.id, { name: q.get("name"), soundId: q.get("sound_id"), data: await readBytes(request) }), 201);
      }
      const id = path[1];
      if (id && path.length === 2 && method === "GET") {
        const r = await getRecording(env, user.id, id);
        return wav(r.name, r.data, "private, no-store");
      }
      if (id && path.length === 2 && method === "DELETE") return json(await deleteRecording(env, user.id, id));
    }

    if (path.length === 1 && path[0] === "context") {
      if (method === "GET") return json(await getContext(env, user.id));
      if (method === "PUT") {
        const b = await readJson(request);
        return json(await updateContext(env, user.id, { markdown: b.markdown, baseVersion: b.base_version }));
      }
    }
    throw new HttpError(404, "その API はありません");
  } catch (e) {
    if (e instanceof HttpError) return json(e.code ? { error: e.message, code: e.code } : { error: e.message }, e.status);
    console.error(e);
    return json({ error: "サーバでエラーが起きました" }, 500);
  }
}
