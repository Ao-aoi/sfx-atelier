import { createSound, resolveUser } from "@sfx-atelier/store";
import { describe, expect, it } from "vitest";
import { makeDb, makeEnv } from "../../packages/store/test/fakes";
import type { McpEnv } from "../src/env";
import { handleMcp } from "../src/protocol";
import { authorOf } from "../src/tools";

let rpcId = 0;
async function rpc(env: McpEnv, userId: string, method: string, params?: unknown, canWrite = true, clientName?: string) {
  const res = await handleMcp(
    new Request("https://mcp.example/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) }),
    env,
    userId,
    { canWrite, clientName },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await res.json()) as { result?: any; error?: { code: number; message: string } };
}

async function tool(env: McpEnv, userId: string, name: string, args: Record<string, unknown>, canWrite = true, clientName = "Claude") {
  const r = await rpc(env, userId, "tools/call", { name, arguments: args }, canWrite, clientName);
  return { text: r.result.content[0].text as string, isError: r.result.isError as boolean };
}

async function setup() {
  const env = makeEnv() as unknown as McpEnv & { DB: ReturnType<typeof makeDb> };
  const user = await resolveUser(env.DB, { provider: "cf-access", subject: "sub-ao", email: "ao@example.com" });
  return { env, userId: user.id };
}

const score = {
  format: "sfx-score/1",
  instruments: { 音: { layers: [{ osc: "sine", ratio: 1 }] } },
  tracks: [
    { instrument: "音", notes: [{ t: 0, pitch: "A4" }, { t: 0.1, pitch: "E5" }] },
    { instrument: "音", notes: [{ t: 0.2, pitch: "C5" }] },
  ],
};

const bank = {
  format: "sfx-bank/1",
  instruments: { a: { layers: [{ osc: "sine", ratio: 1 }] }, b: { layers: [{ noise: "white" }] } },
  reverb: { room: { seconds: 0.5, decay: 3 } },
  sounds: {
    tap: { tracks: [{ instrument: "a", notes: [{ t: 0, pitch: "C5" }] }] },
    hiss: { tracks: [{ instrument: "b", send: { room: 0.3 }, notes: [{ t: 0 }] }] },
  },
};

describe("MCP の取り決め", () => {
  it("initialize：求められた版に合わせ、名前は sfx-atelier", async () => {
    const { env, userId } = await setup();
    const r = await rpc(env, userId, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(r.result.protocolVersion).toBe("2025-06-18");
    expect(r.result.serverInfo.name).toBe("sfx-atelier");
    expect(r.result.capabilities.tools).toBeDefined();
  });

  it("通知には 202、GET は 405、知らないメソッドは -32601", async () => {
    const { env, userId } = await setup();
    const n = await handleMcp(
      new Request("https://mcp.example/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }),
      env,
      userId,
    );
    expect(n.status).toBe(202);
    expect((await handleMcp(new Request("https://mcp.example/mcp"), env, userId)).status).toBe(405);
    expect((await rpc(env, userId, "nope")).error?.code).toBe(-32601);
  });

  it("tools/list：計画のツールがあり、書き込むのは作品・変更案・好みの記憶だけ", async () => {
    const { env, userId } = await setup();
    const tools = (await rpc(env, userId, "tools/list")).result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["list_sounds", "get_sound", "get_analysis", "save_sound", "apply_patch", "get_context"]));
    expect(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name).sort()).toEqual(["apply_patch", "save_sound", "update_context"]);
  });
});

describe("ツール", () => {
  it("save_sound → list_sounds → get_sound：縮めた JSON に id が付き、書き手は接続元アプリ", async () => {
    const { env, userId } = await setup();
    const c = await tool(env, userId, "save_sound", { name: "chime", body: score, tags: ["UI"] });
    expect(c.isError).toBe(false);
    const list = await tool(env, userId, "list_sounds", {});
    expect(list.text).toMatch(/\| chime \| score \| 版 1 \| UI \| claude \|/);
    const g = await tool(env, userId, "get_sound", { sound: "chime" });
    const [head, json] = g.text.split("\n");
    expect(head).toContain("版 1（最新、base_version 1）");
    expect(JSON.parse(json!)).toEqual({
      format: "sfx-score/1",
      instruments: { 音: { layers: [{ osc: "sine", ratio: 1 }] } },
      tracks: [
        { id: "t1", instrument: "音", notes: [{ id: "n1", t: 0, pitch: "A4" }, { id: "n2", t: 0.1, pitch: "E5" }] },
        { id: "t2", instrument: "音", notes: [{ id: "n3", t: 0.2, pitch: "C5" }] },
      ],
    });
  });

  it("apply_patch：get_sound の id で指した変更が新しい版になる。古い base_version は断る", async () => {
    const { env, userId } = await setup();
    await tool(env, userId, "save_sound", { name: "chime", body: score });
    const patch = { format: "sfx-patch/1", note: "2 音目を下げる", ops: [{ op: "set", path: ["tracks", "t1", "notes", "n2", "pitch"], value: "D5" }] };
    const r = await tool(env, userId, "apply_patch", { sound: "chime", patch, base_version: 1 });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("版 2");
    const g = await tool(env, userId, "get_sound", { sound: "chime" });
    expect(JSON.parse(g.text.split("\n").at(-1)!).tracks[0].notes[1].pitch).toBe("D5");
    expect(g.text).toContain("説明：2 音目を下げる");
    // patch を JSON の文字列で渡してもよい
    const stale = await tool(env, userId, "apply_patch", { sound: "chime", patch: JSON.stringify(patch), base_version: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("版 2 に更新されています");
    const vs = await tool(env, userId, "list_versions", { sound: "chime" });
    expect(vs.text.split("\n")[0]).toMatch(/^版 2 \| claude（変更案）/);
  });

  it("save_sound に base_version を付けると新しい版、付けずに同じ名前なら断る", async () => {
    const { env, userId } = await setup();
    await tool(env, userId, "save_sound", { name: "chime", body: score });
    expect((await tool(env, userId, "save_sound", { name: "chime", body: score })).isError).toBe(true);
    const r = await tool(env, userId, "save_sound", { name: "chime", body: score, base_version: 1, note: "同じ" });
    expect(r.text).toContain("版 2");
  });

  it("get_sound の part：バンクの 1 音と、その音が使う楽器・残響だけ", async () => {
    const { env, userId } = await setup();
    await createSound(env, userId, { name: "mahjong", body: bank, author: "editor" });
    const g = await tool(env, userId, "get_sound", { sound: "mahjong", part: "hiss" });
    expect(JSON.parse(g.text.split("\n").at(-1)!)).toEqual({
      format: "sfx-bank/1",
      instruments: { b: { layers: [{ noise: "white" }] } },
      reverb: { room: { seconds: 0.5, decay: 3 } },
      sounds: { hiss: { tracks: [{ id: "t1", instrument: "b", send: { room: 0.3 }, notes: [{ id: "n1", t: 0 }] }] } },
    });
    expect((await tool(env, userId, "get_sound", { sound: "mahjong", part: "無い" })).isError).toBe(true);
  });

  it("get_analysis：無ければその旨、エディタが付けたらその要約", async () => {
    const { env, userId } = await setup();
    await tool(env, userId, "save_sound", { name: "chime", body: score });
    expect((await tool(env, userId, "get_analysis", { sound: "chime" })).text).toContain("分析の要約がありません");
    await createSound(env, userId, { name: "b", body: score, analysis: "analysis-report/1 b\n長さ 0.3 秒", author: "editor" });
    expect((await tool(env, userId, "get_analysis", { sound: "b" })).text).toBe("analysis-report/1 b\n長さ 0.3 秒");
  });

  it("get_context / update_context：初めは版 0", async () => {
    const { env, userId } = await setup();
    expect((await tool(env, userId, "get_context", {})).text).toContain("base_version 0");
    expect((await tool(env, userId, "update_context", { markdown: "- 麻雀の効果音\n- 乾いた音が好き", base_version: 0 })).text).toContain("base_version 1");
    expect((await tool(env, userId, "get_context", {})).text).toContain("乾いた音が好き");
  });

  it("書き込みの許可が無い接続では書けない。読むのはよい", async () => {
    const { env, userId } = await setup();
    const w = await tool(env, userId, "save_sound", { name: "x", body: score }, false);
    expect(w.isError).toBe(true);
    expect(w.text).toContain("書き込みの許可");
    expect((await tool(env, userId, "list_sounds", {}, false)).isError).toBe(false);
  });

  it("ほかのユーザーの作品は見えない", async () => {
    const { env, userId } = await setup();
    await tool(env, userId, "save_sound", { name: "mine", body: score });
    const other = await resolveUser(env.DB, { provider: "cf-access", subject: "sub-other" });
    expect((await tool(env, other.id, "list_sounds", {})).text).toBe("作品はまだありません");
    expect((await tool(env, other.id, "get_sound", { sound: "mine" })).isError).toBe(true);
  });
});

it("authorOf：接続元の名前を小文字に、無ければ mcp", () => {
  expect(authorOf("Claude")).toBe("claude");
  expect(authorOf(undefined)).toBe("mcp");
  expect(authorOf("  ")).toBe("mcp");
});
