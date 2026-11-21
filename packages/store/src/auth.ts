/**
 * 認証。いまは Cloudflare Access の JWT（Cf-Access-Jwt-Assertion）を検証してユーザーを決める。
 * 公開時は OAuth の provider を足し、同じ resolveUser に通す（users は共通）。
 */
import type { Db, Env } from "./env";
import { HttpError, nowIso } from "./http";

export interface Identity {
  provider: string;
  subject: string;
  email?: string;
}

export interface User {
  id: string;
  displayName: string;
}

type Fetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface AuthDeps {
  fetch?: Fetch;
  now?: () => number;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map<string, { at: number; keys: Jwk[] }>();

export function normalizeTeamDomain(domain: string): string {
  const d = domain.trim().replace(/\/+$/, "");
  return d.startsWith("https://") ? d : `https://${d}`;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodePart(s: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as Record<string, unknown>;
  } catch {
    throw new HttpError(401, "トークンの形が正しくありません", "token_invalid");
  }
}

async function getKeys(team: string, fetchFn: Fetch, now: number, force = false): Promise<Jwk[]> {
  const cached = jwksCache.get(team);
  if (!force && cached && now - cached.at < JWKS_TTL_MS) return cached.keys;
  const res = await fetchFn(`${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(503, "Access の公開鍵を取得できませんでした");
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache.set(team, { at: now, keys });
  return keys;
}

/** Access の JWT を検証して、中身（sub・email）を返す。だめなら HttpError(401) */
export async function verifyAccessJwt(
  token: string,
  opts: { teamDomain: string; aud: string } & AuthDeps,
): Promise<Identity> {
  const team = normalizeTeamDomain(opts.teamDomain);
  const fetchFn = opts.fetch ?? ((url: string) => fetch(url));
  const now = (opts.now ?? Date.now)();
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "トークンの形が正しくありません", "token_invalid");
  const [h, p, sig] = parts as [string, string, string];
  const header = decodePart(h);
  const payload = decodePart(p);
  if (header.alg !== "RS256") throw new HttpError(401, "署名の方式が違います", "token_invalid");

  let keys = await getKeys(team, fetchFn, now);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // 鍵の入れ替え直後に備えて1回だけ取り直す
    keys = await getKeys(team, fetchFn, now, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new HttpError(401, "署名の鍵が見つかりません", "token_invalid");

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new HttpError(401, "署名が正しくありません", "token_invalid");

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(opts.aud)) throw new HttpError(401, "このアプリ宛てのトークンではありません", "token_invalid");
  if (payload.iss !== team) throw new HttpError(401, "発行元が違います", "token_invalid");
  const sec = now / 1000;
  if (typeof payload.exp !== "number" || payload.exp < sec) throw new HttpError(401, "トークンの期限が切れています", "token_expired");
  if (typeof payload.nbf === "number" && payload.nbf > sec + 60) throw new HttpError(401, "トークンがまだ有効ではありません", "token_invalid");
  if (typeof payload.sub !== "string" || payload.sub === "") throw new HttpError(401, "ユーザーが分かりません", "token_invalid");

  return {
    provider: "cf-access",
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}

function isLocalhost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

/** リクエストから本人を確かめる。設定が無いときは通さない（fail closed） */
export async function identify(request: Request, env: Env, deps: AuthDeps = {}): Promise<Identity> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = request.headers.get("cf-access-jwt-assertion");
    if (!token) throw new HttpError(401, "この URL は Access の対象外です", "no_token");
    return verifyAccessJwt(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, ...deps });
  }
  if (env.DEV_USER_EMAIL && isLocalhost(new URL(request.url))) {
    return { provider: "dev", subject: env.DEV_USER_EMAIL, email: env.DEV_USER_EMAIL };
  }
  throw new HttpError(500, "認証の設定がありません（ACCESS_TEAM_DOMAIN / ACCESS_AUD）");
}

/** ログイン手段からユーザーを引く。初めてなら作る */
export async function resolveUser(db: Db, identity: Identity): Promise<User> {
  const found = await db
    .prepare(
      `SELECT u.id AS id, u.display_name AS displayName
         FROM user_identities i JOIN users u ON u.id = i.user_id
        WHERE i.provider = ? AND i.subject = ?`,
    )
    .bind(identity.provider, identity.subject)
    .first<User>();
  if (found) return found;

  const id = crypto.randomUUID();
  const displayName = identity.email?.split("@")[0] || "player";
  const at = nowIso();
  await db.batch([
    db.prepare("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)").bind(id, displayName, at),
    db
      .prepare(
        // 同時に初回アクセスが来たときは先に入った方を使う
        "INSERT OR IGNORE INTO user_identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(identity.provider, identity.subject, id, identity.email ?? null, at),
  ]);
  const again = await db
    .prepare(
      `SELECT u.id AS id, u.display_name AS displayName
         FROM user_identities i JOIN users u ON u.id = i.user_id
        WHERE i.provider = ? AND i.subject = ?`,
    )
    .bind(identity.provider, identity.subject)
    .first<User>();
  if (!again) throw new HttpError(500, "ユーザーを作れませんでした");
  return again;
}
