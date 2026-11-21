/**
 * /api/* をすべて保存 API に渡す。中身は packages/store（MCP からも同じ関数を使う）。
 * D1 は DB、R2 は RECORDINGS という名前で Pages の設定から結びつける（docs/setup-cloudflare.md）。
 */
import { handleApi, type Env } from "@sfx-atelier/store";

export const onRequest = (context: { request: Request; env: Env }): Promise<Response> => handleApi(context.request, context.env);
