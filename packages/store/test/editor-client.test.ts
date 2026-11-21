// エディタ（web/src/model/server.ts）の保存の呼び出しを、本物の保存 API（偽の D1）に当てる
import { applyPatch, normalizeScore, SCORE_FORMAT, type Score } from "@sfx-atelier/format";
import { handleApi } from "../src";
import { describe, expect, it } from "vitest";
import { makeEnv } from "./fakes";
import { changeText, diffDocs } from "../../../web/src/model/diff";
import { Server, ServerError } from "../../../web/src/model/server";

function server() {
  const env = makeEnv();
  return new Server((url, init) => handleApi(new Request(`http://localhost${url}`, init), env));
}

const score = (): Score =>
  normalizeScore({
    format: SCORE_FORMAT,
    instruments: { a: { layers: [{ osc: "sine", ratio: 1 }] } },
    tracks: [{ instrument: "a", notes: [{ t: 0, pitch: "A4" }, { t: 0.1, pitch: "E5" }] }],
  });

describe("Server", () => {
  it("作る → 一覧 → 読む → 新しい版。古い版で書くと 409", async () => {
    const s = server();
    const c = await s.create("chime", score(), "analysis-report/1 chime");
    expect(c.version).toBe(1);
    expect((await s.list()).map((x) => [x.name, x.version])).toEqual([["chime", 1]]);
    const v1 = await s.get(c.id);
    expect(v1.body.format).toBe(SCORE_FORMAT);
    expect((await s.save(c.id, score(), 1)).version).toBe(2);
    const err = await s.save(c.id, score(), 1).catch((e) => e);
    expect(err).toBeInstanceOf(ServerError);
    expect((err as ServerError).status).toBe(409);
    expect((err as ServerError).code).toBe("version_conflict");
  });

  it("Claude が当てた変更案は、開くと前の版との差分として出る", async () => {
    const env = makeEnv();
    const s = new Server((url, init) => handleApi(new Request(`http://localhost${url}`, init), env));
    const { id } = await s.create("chime", score());
    // MCP の apply_patch と同じ関数（保存 API の /patch）
    await handleApi(
      new Request(`http://localhost/api/sounds/${id}/patch`, {
        method: "POST",
        body: JSON.stringify({ base_version: 1, patch: { format: "sfx-patch/1", note: "下げる", ops: [{ op: "set", path: ["tracks", "t1", "notes", "n2", "pitch"], value: "D5" }] } }),
      }),
      env,
    );
    const v2 = await s.get(id);
    const v1 = await s.get(id, 1);
    expect(v2.patch?.note).toBe("下げる");
    expect(diffDocs(v1.body, v2.body).map(changeText)).toEqual(['tracks.t1.notes.n2.pitch "E5" → "D5"']);
    // エディタで同じ変更案を当てたものと同じ中身
    const local = applyPatch(normalizeScore(v1.body as Score), v2.patch!);
    expect(local.ok && diffDocs(local.value, v2.body)).toEqual([]);
  });

  it("届かない・JSON でない（Access のログイン画面）は ServerError", async () => {
    const down = new Server(() => Promise.reject(new TypeError("fetch failed")));
    expect(((await down.list().catch((e) => e)) as ServerError).status).toBe(0);
    const html = new Server(async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
    expect(((await html.list().catch((e) => e)) as ServerError).message).toBe("ログインしてください");
  });
});
