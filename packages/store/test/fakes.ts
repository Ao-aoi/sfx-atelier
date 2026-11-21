/** テスト用の D1 / R2 の偽物。D1 は node:sqlite（本物の SQLite）に migration を流して作る */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Bucket, Db, DbStatement, Env } from "../src/env";

const MIGRATIONS = join(import.meta.dirname, "../../../db/migrations");

class Stmt implements DbStatement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly values: unknown[] = [],
  ) {}
  bind(...values: unknown[]): DbStatement {
    return new Stmt(this.db, this.sql, values);
  }
  private args() {
    return this.values.map((v) => (v === undefined ? null : v)) as (string | number | null)[];
  }
  async first<T>(): Promise<T | null> {
    return ((this.db.prepare(this.sql).get(...this.args()) as T | undefined) ?? null) as T | null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.args()) as T[] };
  }
  async run(): Promise<unknown> {
    return this.db.prepare(this.sql).run(...this.args());
  }
  runSync(): void {
    this.db.prepare(this.sql).run(...this.args());
  }
}

export function makeDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  return {
    raw,
    prepare: (sql) => new Stmt(raw, sql),
    async batch(stmts) {
      // D1 の batch と同じく、全部成功するか全部取り消すか
      raw.exec("BEGIN");
      try {
        for (const s of stmts) (s as Stmt).runSync();
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
      return [];
    },
  };
}

export function makeBucket(): Bucket & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    async put(key, value) {
      store.set(key, new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value)));
    },
    async get(key) {
      const v = store.get(key);
      return v === undefined ? null : { size: v.length, arrayBuffer: async () => v.slice().buffer };
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
}

export function makeEnv(extra: Partial<Env> = {}): Env & { DB: ReturnType<typeof makeDb>; RECORDINGS: ReturnType<typeof makeBucket> } {
  return { DB: makeDb(), RECORDINGS: makeBucket(), DEV_USER_EMAIL: "ao@example.com", ...extra } as never;
}

// ---------- Access の JWT を自前で作る ----------

export const TEAM = "https://test-team.cloudflareaccess.com";
export const AUD = "aud-tag-123";

function b64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function makeIssuer(kid = "key-1") {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid };
  let fetchCount = 0;
  return {
    get fetchCount() {
      return fetchCount;
    },
    fetch: async (url: string) => {
      fetchCount++;
      if (url !== `${TEAM}/cdn-cgi/access/certs`) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ keys: [jwk] }) };
    },
    async sign(payload: Record<string, unknown>, header: Record<string, unknown> = {}) {
      const h = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT", ...header }));
      const p = b64url(JSON.stringify(payload));
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
      return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
    },
  };
}

export function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { aud: [AUD], iss: TEAM, sub: "user-sub-1", email: "ao@example.com", iat: now, exp: now + 3600, ...overrides };
}
