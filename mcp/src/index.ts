/**
 * リモート MCP サーバ（Cloudflare Workers）。claude.ai のカスタムコネクタ・Claude Code から同じものを使う。
 *
 *   /mcp         MCP 本体（OAuth のトークンが要る）
 *   /authorize   ログインと許可の画面。Cloudflare Access でこのパスだけを守り、本人を確かめる
 *   /token /register /.well-known/*  OAuth（workers-oauth-provider が答える）
 *
 * ユーザーは保存 API と同じ Access の JWT（provider = cf-access）で引くので、エディタで保存した作品がそのまま見える。
 * mahjong-sensei の mcp/src/index.ts から写したもの（重なりが見えたら共通部分を切り出す）。
 * 公開時は /authorize のログインを OAuth に差し替える（トークンの仕組みはそのまま）。
 * 手順：docs/setup-mcp.md
 */
import { AuthorizationError, CimdFetchError, OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { HttpError, identify, resolveUser } from '@sfx-atelier/store';
import type { McpEnv, McpProps } from './env';
import { handleMcp } from './protocol';

const SCOPE_READ = 'mcp:read';
/** 作品・変更案・好みの記憶の書き込み。この許可より前に接続したトークンは読み取りだけ（接続し直すと書ける） */
const SCOPE_WRITE = 'mcp:write';

const escape = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string, status = 200, headers = new Headers()): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;line-height:1.6}
button{font:inherit;padding:.5rem 1.2rem;margin-right:.5rem}.warn{color:#b00}</style>
${body}</html>`;
  return new Response(html, { status, headers });
}

/** /authorize：Access を通った本人に、接続を許可するかを聞く */
async function authorize(request: Request, env: McpEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER as OAuthHelpers;
  try {
    const user = await resolveUser(env.DB, await identify(request, env));
    if (request.method === 'GET') {
      const authReq = await oauth.parseAuthRequest(request);
      const d = await oauth.describeConsent(authReq);
      const consent = await oauth.beginConsent(authReq);
      const from = d.clientDomain ? escape(d.clientDomain) : `${escape(d.clientName)}（自己申告）`;
      return page(
        '接続の許可',
        `<h1>${escape(d.clientName)} に作品の読み取りと保存を許可しますか？</h1>
<p>接続元：${from}<br>送り先：<b>${escape(d.redirectHost)}</b><br>ユーザー：${escape(user.displayName)}</p>
${d.redirectIsLoopback ? '<p class="warn">送り先はこの端末のアプリです</p>' : ''}
<form method="post"><input type="hidden" name="handle" value="${escape(consent.handle)}">
<button name="decision" value="approve">許可</button><button name="decision" value="deny">拒否</button></form>`,
        200,
        consent.headers,
      );
    }
    if (request.method === 'POST') {
      const form = await request.formData();
      const handle = String(form.get('handle') ?? '');
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle, { scope: [SCOPE_READ, SCOPE_WRITE] });
      const client = await oauth.lookupClient(approved.request.clientId);
      const props: McpProps = { userId: user.id, canWrite: true, clientName: client?.clientName };
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: user.id,
        metadata: {},
        scope: approved.request.scope,
        props,
      });
      approved.headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return page('接続できません', `<p>${escape(e.description ?? '')}</p>`, 400);
    if (e instanceof CimdFetchError) return page('接続できません', '<p>接続元のアプリを確かめられませんでした</p>', 400);
    if (e instanceof HttpError) return page('接続できません', `<p>${escape(e.message)}</p>`, e.status);
    throw e;
  }
}

const defaultHandler = {
  async fetch(request: Request, env: McpEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/authorize') return authorize(request, env);
    return new Response('Not found', { status: 404 });
  },
};

const apiHandler = {
  async fetch(request: Request, env: McpEnv, ctx: { props: McpProps }): Promise<Response> {
    return handleMcp(request, env, ctx.props.userId, { canWrite: ctx.props.canWrite === true, clientName: ctx.props.clientName });
  },
};

/** 公開している URL（workers.dev かカスタムドメイン）ごとに1つ作る。resource はその URL の /mcp */
const providers = new Map<string, OAuthProvider<McpEnv>>();

function providerFor(origin: string): OAuthProvider<McpEnv> {
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider<McpEnv>({
      apiRoute: '/mcp',
      apiHandler: apiHandler as never,
      defaultHandler: defaultHandler as never,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/token',
      clientRegistrationEndpoint: '/register',
      scopesSupported: [SCOPE_READ, SCOPE_WRITE],
      requiredScopes: [SCOPE_READ],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
      clientIdMetadataDocumentEnabled: true,
    });
    providers.set(origin, p);
  }
  return p;
}

export default {
  fetch(request: Request, env: McpEnv, ctx: ExecutionContext): Promise<Response> {
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  },
};
