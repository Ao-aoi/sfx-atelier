import { describe, expect, it } from "vitest";
import { identify, normalizeTeamDomain, resolveUser, verifyAccessJwt } from "../src/auth";
import { HttpError } from "../src/http";
import { AUD, TEAM, claims, makeEnv, makeIssuer } from "./fakes";

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
}

describe("Access の JWT 検証", () => {
  it("正しいトークンなら sub と email が取れる", async () => {
    const iss = await makeIssuer("ok-1");
    const id = await verifyAccessJwt(await iss.sign(claims()), { teamDomain: TEAM, aud: AUD, fetch: iss.fetch });
    expect(id).toEqual({ provider: "cf-access", subject: "user-sub-1", email: "ao@example.com" });
  });

  it("aud 違い・発行元違い・期限切れ・sub なしは 401", async () => {
    const iss = await makeIssuer("ng-1");
    const opts = { teamDomain: TEAM, aud: AUD, fetch: iss.fetch };
    const past = Math.floor(Date.now() / 1000) - 10;
    expect(await status(verifyAccessJwt(await iss.sign(claims({ aud: ["other"] })), opts))).toBe(401);
    expect(await status(verifyAccessJwt(await iss.sign(claims({ iss: "https://evil.cloudflareaccess.com" })), opts))).toBe(401);
    expect(await status(verifyAccessJwt(await iss.sign(claims({ exp: past })), opts))).toBe(401);
    expect(await status(verifyAccessJwt(await iss.sign(claims({ sub: "" })), opts))).toBe(401);
  });

  it("別の鍵で署名されたトークン・書き換えたトークンは 401", async () => {
    const real = await makeIssuer("shared-kid");
    const fake = await makeIssuer("shared-kid");
    const opts = { teamDomain: TEAM, aud: AUD, fetch: real.fetch };
    expect(await status(verifyAccessJwt(await fake.sign(claims()), opts))).toBe(401);

    const [h, , s] = (await real.sign(claims())).split(".");
    const forged = btoa(JSON.stringify(claims({ sub: "someone-else" }))).replace(/=+$/, "");
    expect(await status(verifyAccessJwt(`${h}.${forged}.${s}`, opts))).toBe(401);
  });

  it("alg が RS256 以外（none など）は 401", async () => {
    const iss = await makeIssuer("alg-1");
    const t = await iss.sign(claims(), { alg: "none" });
    expect(await status(verifyAccessJwt(t, { teamDomain: TEAM, aud: AUD, fetch: iss.fetch }))).toBe(401);
  });

  it("公開鍵は一度取ったら使い回す（知らない kid のときだけ取り直す）", async () => {
    const iss = await makeIssuer("cache-1");
    const opts = { teamDomain: TEAM, aud: AUD, fetch: iss.fetch };
    expect(await status(verifyAccessJwt(await iss.sign(claims()), opts))).toBe(200);
    expect(await status(verifyAccessJwt(await iss.sign(claims()), opts))).toBe(200);
    expect(iss.fetchCount).toBe(1);
  });

  it("チームのドメインは https:// の有無・末尾の / を吸収する", () => {
    expect(normalizeTeamDomain("team.cloudflareaccess.com/")).toBe("https://team.cloudflareaccess.com");
    expect(normalizeTeamDomain("https://team.cloudflareaccess.com")).toBe("https://team.cloudflareaccess.com");
  });
});

describe("identify", () => {
  it("Access の設定があるのにヘッダが無ければ 401", async () => {
    const env = makeEnv({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });
    expect(await status(identify(new Request("https://x.pages.dev/api/me"), env))).toBe(401);
    // 画面が「開き直せば直る」と見分けられるように、設定ずれには code を付ける
    expect(await identify(new Request("https://x.pages.dev/api/me"), env).catch((e) => e.code)).toBe("no_token");
  });

  it("Access の設定が無いとき：localhost なら開発用ユーザー、それ以外は通さない", async () => {
    const env = makeEnv();
    expect((await identify(new Request("http://localhost:8788/api/me"), env)).provider).toBe("dev");
    expect(await status(identify(new Request("https://x.pages.dev/api/me"), env))).toBe(500);
    expect(await status(identify(new Request("http://localhost:8788/api/me"), makeEnv({ DEV_USER_EMAIL: undefined })))).toBe(500);
  });
});

describe("resolveUser", () => {
  it("初回はユーザーを作り、2回目は同じユーザーを返す", async () => {
    const env = makeEnv();
    const a = await resolveUser(env.DB, { provider: "cf-access", subject: "s1", email: "ao@example.com" });
    const b = await resolveUser(env.DB, { provider: "cf-access", subject: "s1", email: "ao@example.com" });
    expect(a).toEqual(b);
    expect(a.displayName).toBe("ao");
    const c = await resolveUser(env.DB, { provider: "cf-access", subject: "s2" });
    expect(c.id).not.toBe(a.id);
  });
});
