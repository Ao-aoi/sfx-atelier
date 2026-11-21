// 保存 API（/api/*、packages/store）を呼ぶ。エディタと同じ Pages にあるので同じ origin。
// 届かない・認証されていないときは ServerError（status 0 は届かない）。
import type { Bank, Patch, Score } from "@sfx-atelier/format";

export interface RemoteSummary {
  id: string;
  name: string;
  kind: "score" | "bank";
  version: number;
  tags: string[];
  author: string;
  updatedAt: string;
}

export interface RemoteVersion extends RemoteSummary {
  latestVersion: number;
  body: Score | Bank;
  note: string | null;
  patch: Patch | null;
  createdAt: string;
}

export class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class Server {
  constructor(
    private fetchFn: Fetch = (u, i) => fetch(u, i),
    private base = "/api",
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(this.base + path, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
      });
    } catch {
      throw new ServerError(0, "サーバに届きません");
    }
    const type = res.headers.get("content-type") ?? "";
    // Access のログイン画面（HTML）に飛ばされたとき
    if (!type.includes("json")) throw new ServerError(res.status === 200 ? 401 : res.status, "ログインしてください");
    const data = (await res.json()) as T & { error?: string; code?: string };
    if (!res.ok) throw new ServerError(res.status, data.error ?? `エラー ${res.status}`, data.code);
    return data;
  }

  list(): Promise<RemoteSummary[]> {
    return this.call("GET", "/sounds?limit=100");
  }

  get(id: string, version?: number): Promise<RemoteVersion> {
    return this.call("GET", `/sounds/${encodeURIComponent(id)}${version ? `?version=${version}` : ""}`);
  }

  create(name: string, body: Score | Bank, analysis?: string): Promise<{ id: string; version: number }> {
    return this.call("POST", "/sounds", { name, body, analysis });
  }

  save(id: string, body: Score | Bank, baseVersion: number, analysis?: string): Promise<{ id: string; version: number }> {
    return this.call("PUT", `/sounds/${encodeURIComponent(id)}`, { body, base_version: baseVersion, analysis });
  }
}
