/**
 * MCP（Streamable HTTP）の最小の実装。セッションを持たず、POST の JSON-RPC に JSON で答えるだけ。
 * 使うのは initialize / tools/list / tools/call / ping。通知（id の無いもの）には 202 を返す。
 */
import type { McpEnv } from "./env";
import { callTool, TOOLS } from "./tools";

const SUPPORTED_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_VERSION = "2025-06-18";

const INSTRUCTIONS =
  "効果音・ジングルの作品（sfx-score/1 とバンク sfx-bank/1）の読み書き。最初に get_context で用途と好みを読み、list_sounds で作品を探す。get_sound は縮めた JSON（既定値は省略。トラックと音符の id 付き）、get_analysis はエディタが描画して測った要約。直すときは変更案 sfx-patch/1 を apply_patch で当てる（base_version は get_sound の版。新しい版になり、エディタで開くと差分が出る）。全体を書き直すときだけ save_sound。音は描画できないので、聞こえ方の数字は get_analysis だけを根拠にする。";

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type RpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

const err = (id: RpcRequest["id"], code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export interface McpAccess {
  /** 書き込むツールを使ってよいか */
  canWrite: boolean;
  /** 接続元アプリの名前（あれば） */
  clientName?: string;
}

async function handleOne(env: McpEnv, userId: string, access: McpAccess, req: RpcRequest): Promise<RpcResponse | null> {
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") return err(req?.id, -32600, "Invalid Request");
  const isNotification = req.id === undefined;
  const id = req.id ?? null;
  switch (req.method) {
    case "initialize": {
      const asked = typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : "";
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : DEFAULT_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "sfx-atelier", version: "0.1.0" },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return isNotification ? null : { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { readOnlyHint: t.readOnly !== false, ...(t.readOnly === false ? { destructiveHint: false, idempotentHint: false } : {}), openWorldHint: false },
          })),
        },
      };
    case "tools/call": {
      const name = req.params?.name;
      if (typeof name !== "string") return err(id, -32602, "name が必要です");
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      const r = await callTool(env, userId, name, args, access);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: r.text }], isError: r.isError } };
    }
    default:
      if (isNotification) return null;
      return err(id, -32601, `Method not found: ${req.method}`);
  }
}

/** /mcp への1リクエスト。認証（トークンの確認）は済んでいて、userId はトークンに結びついた本人 */
export async function handleMcp(request: Request, env: McpEnv, userId: string, access: McpAccess = { canWrite: false }): Promise<Response> {
  if (request.method !== "POST") {
    // サーバから送る通知は無いので、GET（SSE）とセッションの削除は受け付けない
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(err(null, -32700, "Parse error"), { status: 400 });
  }
  const batch = Array.isArray(body);
  const reqs = (batch ? body : [body]) as RpcRequest[];
  const out: RpcResponse[] = [];
  for (const r of reqs) {
    try {
      const res = await handleOne(env, userId, access, r);
      if (res) out.push(res);
    } catch (e) {
      console.error(e);
      out.push(err(r?.id, -32603, "サーバでエラーが起きました"));
    }
  }
  if (out.length === 0) return new Response(null, { status: 202 });
  return Response.json(batch ? out : out[0]);
}
