import { describe, expect, it } from "vitest";
import { handleApi, LIMITS } from "../src";
import { makeEnv } from "./fakes";

const BASE = "http://localhost/api";

type E = ReturnType<typeof makeEnv>;

async function call(env: E, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body instanceof Uint8Array) init.body = body as BodyInit;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await handleApi(new Request(BASE + path, init), env);
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, data: type.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer()), res };
}

const score = (gain = 1) => ({
  format: "sfx-score/1",
  instruments: { 音: { layers: [{ osc: "sine", ratio: 1, gain }] } },
  tracks: [{ id: "t1", instrument: "音", notes: [{ id: "n1", t: 0, pitch: "A4" }] }],
});

/** 最小の wav（44 バイトのヘッダ＋ 16bit の無音 2 サンプル） */
function wav(extra = 4): Uint8Array {
  const b = new Uint8Array(44 + extra);
  const v = new DataView(b.buffer);
  const s = (at: number, t: string) => [...t].forEach((c, i) => (b[at + i] = c.charCodeAt(0)));
  s(0, "RIFF");
  v.setUint32(4, 36 + extra, true);
  s(8, "WAVE");
  s(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 48000, true);
  v.setUint32(28, 96000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s(36, "data");
  v.setUint32(40, extra, true);
  return b;
}

describe("作品と版", () => {
  it("作る → 読む（縮めた形で、既定値は落ち、id は残る）→ 一覧", async () => {
    const env = makeEnv();
    const c = await call(env, "POST", "/sounds", { name: "discard", body: score(), tags: ["麻雀", "打牌", "麻雀"] });
    expect(c.status).toBe(201);
    expect(c.data.version).toBe(1);
    const g = await call(env, "GET", `/sounds/${c.data.id}`);
    expect(g.status).toBe(200);
    expect(g.data).toMatchObject({ name: "discard", kind: "score", version: 1, latestVersion: 1, tags: ["打牌", "麻雀"], author: "editor", public: false, patch: null });
    expect(g.data.body).toEqual({
      format: "sfx-score/1",
      instruments: { 音: { layers: [{ osc: "sine", ratio: 1 }] } },
      tracks: [{ id: "t1", instrument: "音", notes: [{ id: "n1", t: 0, pitch: "A4" }] }],
    });
    // 名前でも引ける
    expect((await call(env, "GET", `/sounds/${encodeURIComponent("discard")}`)).data.id).toBe(c.data.id);
    const list = await call(env, "GET", "/sounds?tag=麻雀");
    expect(list.data.map((x: { name: string }) => x.name)).toEqual(["discard"]);
    expect((await call(env, "GET", "/sounds?tag=ない")).data).toEqual([]);
  });

  it("壊れた score・同じ名前・大きすぎる作品は断る", async () => {
    const env = makeEnv();
    expect((await call(env, "POST", "/sounds", { name: "x", body: { format: "sfx-score/1", tracks: [{ instrument: "無い", notes: [] }] } })).status).toBe(400);
    expect((await call(env, "POST", "/sounds", { name: "x", body: { format: "nope" } })).status).toBe(400);
    expect((await call(env, "POST", "/sounds", { name: "", body: score() })).status).toBe(400);
    expect((await call(env, "POST", "/sounds", { name: "x", body: score() })).status).toBe(201);
    const dup = await call(env, "POST", "/sounds", { name: "x", body: score() });
    expect(dup.status).toBe(409);
    expect(dup.data.code).toBe("name_taken");
    const big = score();
    big.tracks[0]!.notes = Array.from({ length: 12000 }, (_, i) => ({ id: `n${i}`, t: i * 0.01, pitch: "A4" }));
    expect((await call(env, "POST", "/sounds", { name: "big", body: big })).status).toBe(413);
  });

  it("新しい版は base_version が最新のときだけ。古い版も残る", async () => {
    const env = makeEnv();
    const { id } = (await call(env, "POST", "/sounds", { name: "kan", body: score() })).data;
    const v2 = await call(env, "PUT", `/sounds/${id}`, { body: score(0.5), base_version: 1, note: "小さく", analysis: "analysis-report/1\n..." });
    expect(v2.data.version).toBe(2);
    // 版 1 を読んだまま書くと 409
    const stale = await call(env, "PUT", `/sounds/${id}`, { body: score(0.2), base_version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.data.code).toBe("version_conflict");
    expect((await call(env, "PUT", `/sounds/${id}`, { body: score(0.2) })).status).toBe(400);
    // バンクでは上書きできない
    expect((await call(env, "PUT", `/sounds/${id}`, { body: { format: "sfx-bank/1", sounds: {} }, base_version: 2 })).status).toBe(400);

    expect((await call(env, "GET", `/sounds/${id}?version=1`)).data.body.instruments.音.layers[0].gain).toBeUndefined();
    expect((await call(env, "GET", `/sounds/${id}`)).data).toMatchObject({ version: 2, note: "小さく", hasAnalysis: true });
    expect((await call(env, "GET", `/sounds/${id}?version=9`)).status).toBe(404);
    const vs = await call(env, "GET", `/sounds/${id}/versions`);
    expect(vs.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect((await call(env, "GET", `/sounds/${id}/analysis`)).data).toEqual({ version: 2, analysis: "analysis-report/1\n..." });
    expect((await call(env, "GET", `/sounds/${id}/analysis?version=1`)).data).toEqual({ version: 1, analysis: null });
  });

  it("変更案を当てる：新しい版になり、patch が残り、inverse で戻せる", async () => {
    const env = makeEnv();
    const { id } = (await call(env, "POST", "/sounds", { name: "win", body: score() })).data;
    const patch = { format: "sfx-patch/1", note: "減衰を短く", ops: [{ op: "set", path: ["instruments", "音", "layers", 0, "env", "d"], value: 0.1 }] };
    const r = await call(env, "POST", `/sounds/${id}/patch`, { patch, base_version: 1 });
    expect(r.status).toBe(200);
    expect(r.data.version).toBe(2);
    const v2 = (await call(env, "GET", `/sounds/${id}`)).data;
    expect(v2.body.instruments.音.layers[0].env).toEqual({ d: 0.1 });
    expect(v2.patch).toEqual(patch);
    expect(v2.note).toBe("減衰を短く");
    // inverse を当てると版 1 と同じ中身
    await call(env, "POST", `/sounds/${id}/patch`, { patch: r.data.inverse, base_version: 2 });
    expect((await call(env, "GET", `/sounds/${id}`)).data.body).toEqual((await call(env, "GET", `/sounds/${id}?version=1`)).data.body);

    // 当てられない・古い版・形の違う変更案
    expect((await call(env, "POST", `/sounds/${id}/patch`, { patch: { format: "sfx-patch/1", ops: [{ op: "set", path: ["tracks", "無い", "gain"], value: 1 }] }, base_version: 3 })).status).toBe(400);
    expect((await call(env, "POST", `/sounds/${id}/patch`, { patch, base_version: 1 })).status).toBe(409);
    expect((await call(env, "POST", `/sounds/${id}/patch`, { patch: { ops: [] }, base_version: 3 })).status).toBe(400);
  });

  it("名前・タグ・公開を変え、消す", async () => {
    const env = makeEnv();
    const { id } = (await call(env, "POST", "/sounds", { name: "a", body: score(), tags: ["x"] })).data;
    await call(env, "POST", "/sounds", { name: "b", body: score() });
    expect((await call(env, "PATCH", `/sounds/${id}`, { name: "b" })).status).toBe(409);
    const m = await call(env, "PATCH", `/sounds/${id}`, { name: "c", tags: ["y", "z"], public: true });
    expect(m.data).toMatchObject({ name: "c", tags: ["y", "z"], public: true, version: 1 });
    expect((await call(env, "DELETE", `/sounds/${id}`)).data).toEqual({ id, deleted: true });
    expect((await call(env, "GET", `/sounds/${id}`)).status).toBe(404);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sound_versions WHERE sound_id = ?").get(id)).toEqual({ n: 0 });
  });

  it("ほかのユーザーの作品は見えない", async () => {
    const env = makeEnv();
    const { id } = (await call(env, "POST", "/sounds", { name: "mine", body: score() })).data;
    const other = makeEnv({ DEV_USER_EMAIL: "someone@example.com" });
    (other as { DB: unknown }).DB = env.DB;
    expect((await call(other, "GET", `/sounds/${id}`)).status).toBe(404);
    expect((await call(other, "GET", "/sounds")).data).toEqual([]);
    expect((await call(other, "PUT", `/sounds/${id}`, { body: score(), base_version: 1 })).status).toBe(404);
  });
});

describe("録音", () => {
  it("wav を置く → 一覧 → 取る → 消す。wav でないもの・大きすぎるものは断る", async () => {
    const env = makeEnv();
    const { id: soundId } = (await call(env, "POST", "/sounds", { name: "s", body: score() })).data;
    const w = wav();
    const put = await call(env, "POST", `/recordings?name=drop&sound_id=${soundId}`, w);
    expect(put.status).toBe(201);
    expect(put.data).toMatchObject({ name: "drop", soundId, bytes: 48 });
    expect((await call(env, "GET", `/recordings?sound_id=${soundId}`)).data).toHaveLength(1);
    const got = await call(env, "GET", `/recordings/${put.data.id}`);
    expect(got.res.headers.get("content-type")).toBe("audio/wav");
    expect([...(got.data as Uint8Array)]).toEqual([...w]);

    expect((await call(env, "POST", "/recordings?name=x", new TextEncoder().encode("not a wav file"))).status).toBe(400);
    expect((await call(env, "POST", "/recordings?name=x", wav(LIMITS.maxRecordingBytes))).status).toBe(413);

    expect((await call(env, "DELETE", `/recordings/${put.data.id}`)).status).toBe(200);
    expect(env.RECORDINGS.store.size).toBe(0);
    expect((await call(env, "GET", `/recordings/${put.data.id}`)).status).toBe(404);
  });

  it("公開の録音は認証なしで取れる。公開にしていない作品・作品のない録音は 404", async () => {
    // Access の設定があり、ヘッダの無いリクエスト（= 認証なし）
    const env = makeEnv();
    const { id: soundId } = (await call(env, "POST", "/sounds", { name: "s", body: score() })).data;
    const rec = (await call(env, "POST", `/recordings?name=r&sound_id=${soundId}`, wav())).data;
    const loose = (await call(env, "POST", "/recordings?name=r2", wav())).data;
    const anon = { ...env, DEV_USER_EMAIL: undefined, ACCESS_TEAM_DOMAIN: "https://t.cloudflareaccess.com", ACCESS_AUD: "x" } as E;
    expect((await call(anon, "GET", `/recordings/${rec.id}`)).status).toBe(401);
    expect((await call(anon, "GET", `/public/recordings/${rec.id}`)).status).toBe(404);
    await call(env, "PATCH", `/sounds/${soundId}`, { public: true });
    const pub = await call(anon, "GET", `/public/recordings/${rec.id}`);
    expect(pub.status).toBe(200);
    expect(pub.res.headers.get("content-type")).toBe("audio/wav");
    expect((await call(anon, "GET", `/public/recordings/${loose.id}`)).status).toBe(404);
  });
});

describe("用途と好みの記憶", () => {
  it("初めは版 0。base_version が合うときだけ書け、行数を超えると断る", async () => {
    const env = makeEnv();
    expect((await call(env, "GET", "/context")).data).toEqual({ markdown: "", version: 0, updatedAt: null });
    const a = await call(env, "PUT", "/context", { markdown: "- 用途：麻雀\n- 好み：乾いた音", base_version: 0 });
    expect(a.data.version).toBe(1);
    expect((await call(env, "PUT", "/context", { markdown: "x", base_version: 0 })).status).toBe(409);
    expect((await call(env, "PUT", "/context", { markdown: "x\n".repeat(LIMITS.maxContextLines + 1), base_version: 1 })).status).toBe(400);
    expect((await call(env, "PUT", "/context", { markdown: "- 用途：麻雀", base_version: 1 })).data.version).toBe(2);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM user_context_history").get()).toEqual({ n: 2 });
  });
});

it("知らない API は 404、壊れた JSON は 400", async () => {
  const env = makeEnv();
  expect((await call(env, "GET", "/nope")).status).toBe(404);
  const res = await handleApi(new Request(`${BASE}/sounds`, { method: "POST", body: "{" }), env);
  expect(res.status).toBe(400);
});
