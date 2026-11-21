/** MCP サーバ（Workers）の環境。D1・R2・Access の設定は保存 API（Pages）と同じものを結びつける */
import type { Env as StoreEnv } from "@sfx-atelier/store";

export interface McpEnv extends StoreEnv {
  /** OAuth のトークン置き場（workers-oauth-provider が使う） */
  OAUTH_KV: unknown;
  /** OAuthProvider が差し込む。/authorize で使う */
  OAUTH_PROVIDER?: unknown;
}

/** トークンに結びつけるもの（completeAuthorization の props） */
export interface McpProps {
  userId: string;
  /** 作品を書いてよいか（書き込みの許可を出した接続だけ true） */
  canWrite?: boolean;
  /** 接続元アプリの名前（OAuth のクライアント名。例：Claude）。版の書き手に使う */
  clientName?: string;
}
