/**
 * Workers / Pages Functions の環境。D1・R2 は使う機能だけを型にしておく
 * （テストでは node:sqlite と Map で同じ形の偽物を渡す）。mahjong-sensei の packages/store から写したもの。
 */

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface Db {
  prepare(sql: string): DbStatement;
  /** まとめて 1 トランザクションで実行する（D1 の batch） */
  batch(statements: DbStatement[]): Promise<unknown[]>;
}

export interface BucketObject {
  arrayBuffer(): Promise<ArrayBuffer>;
  size: number;
}

export interface Bucket {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<BucketObject | null>;
  delete(keys: string | string[]): Promise<unknown>;
}

export interface Env {
  DB: Db;
  /** 録音の wav */
  RECORDINGS: Bucket;
  /** Cloudflare Access のチーム（例：https://example.cloudflareaccess.com） */
  ACCESS_TEAM_DOMAIN?: string;
  /** Access アプリの Application Audience (AUD) タグ */
  ACCESS_AUD?: string;
  /** ローカル開発専用。localhost からのリクエストに限り、このメールのユーザーとして扱う */
  DEV_USER_EMAIL?: string;
}
