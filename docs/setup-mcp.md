# MCP サーバの設定（Claude から作品を読み、変更案を保存する）

コードは `mcp/`。Cloudflare Workers で動き、claude.ai のカスタムコネクタ・Claude Code から同じものを使う。
先に [setup-cloudflare.md](setup-cloudflare.md)（D1・R2・Access）を済ませておく。ダッシュボードの作業は 1 回だけ。mahjong-sensei の `docs/setup-mcp.md` と同じ流れ。

## 仕組み

- `/mcp`：MCP 本体。OAuth のトークンが無いと 401（claude.ai が自動でログインを始める）
- `/authorize`：ログインと許可の画面。**Cloudflare Access でこのパスだけを守る**。保存 API と同じ Access アプリに入れるので、エディタで保存した作品と同じユーザーになる
- `/token` `/register` `/.well-known/*`：OAuth（`@cloudflare/workers-oauth-provider`）。トークンは KV（`OAUTH_KV`）に置く
- ツール：`get_context`・`update_context`（用途と好み）、`list_sounds`、`get_sound`、`list_versions`、`get_analysis`、`apply_patch`（変更案）、`save_sound`。書き込みは OAuth の `mcp:write`
- 書き込みは `base_version`（`get_sound` の見出しに出る版）が最新でなければ断る。古い版はすべて残る
- 音の描画は Workers ではできないので、聞こえ方の数字はエディタが保存のときに付けた分析の要約（`get_analysis`）だけ

## 1. KV を作り、ID を控える

Storage & Databases → **Workers KV** → **Create instance** → 名前 `sfx-atelier-oauth` → 作ったものの **ID** を控える。

あわせて Storage & Databases → **D1 SQL database** → `sfx-atelier` の **Database ID** も控える。

2 つの ID（秘密情報ではない）を Claude に渡す → `mcp/wrangler.toml` と `db/wrangler.toml` に書いて commit する。

## 2. Worker を作る（GitHub から自動でデプロイ）

Workers & Pages → **Create** → **Workers** → **Import a repository** → `sfx-atelier`

| 項目 | 値 |
| --- | --- |
| Project name | `sfx-atelier-mcp`（`mcp/wrangler.toml` の name と同じ） |
| Build command | （空） |
| Deploy command | `npx wrangler deploy -c mcp/wrangler.toml` |
| Root directory | `/` |

1 の ID が入る前にデプロイすると失敗する。ID を commit した後に **Retry build**。

## 3. 環境変数

Workers & Pages → `sfx-atelier-mcp` → **Settings → Variables and Secrets** に、Pages と同じ値を入れる（Type は Text）。

| 変数名 | 値 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Pages と同じ（`https://<チーム名>.cloudflareaccess.com`） |
| `ACCESS_AUD` | Pages と同じ AUD タグ |

## 4. URL を控える

`sfx-atelier-mcp` → **Settings → Domains & Routes** の workers.dev の URL。MCP の URL はその末尾に `/mcp` を付けたもの。

## 5. Access で /authorize だけを守る

Zero Trust → **Access → Applications** → 保存 API で使っているアプリ → **Configure** → **Public hostnames** → **Add public hostname**

| 項目 | 値 |
| --- | --- |
| Subdomain / Domain | 4 の workers.dev のホスト名 |
| Path | `authorize` |

- アプリは保存 API と同じものにする（AUD が同じになり、同じユーザーとして扱われる）
- `/mcp` などは守らない（claude.ai のサーバが直接呼ぶため。こちらは OAuth のトークンで守る）
- workers.dev の「Cloudflare Access」スイッチは使わない（Worker 全体が守られて claude.ai から呼べなくなる）

## 6. claude.ai につなぐ

claude.ai → **Settings → Connectors** → **Add custom connector**

- Name：`sfx-atelier`
- URL：4 の URL ＋ `/mcp`

**Connect** → Access のログイン → 「作品の読み取りと保存を許可しますか？」で **許可**。

Claude Code からは：

```sh
claude mcp add --transport http sfx-atelier https://sfx-atelier-mcp.<サブドメイン>.workers.dev/mcp
```

## 確かめる

エディタで作品をサーバに保存してから、新しいチャットで「discard をもう少し乾いた音にして」。`get_context`・`get_sound`・`get_analysis` を読み、`apply_patch` で新しい版が保存され、エディタで開くと差分が出れば完了。

## うまくいかないとき

| 症状 | 原因 | 直し方 |
| --- | --- | --- |
| 許可の画面に「この URL は Access の対象外です」 | 5 の Public hostname（パス `authorize`）が入っていない・ホスト名が違う | 5 をやり直す |
| 「このアプリ宛てのトークンではありません」 | `ACCESS_AUD` が 5 のアプリの AUD と違う | 3 を直す |
| 「認証の設定がありません」 | 3 の変数が無い | 3 を入れる |
| つながるが「作品はまだありません」 | 別のユーザーになっている（5 で別の Access アプリに入れた） | 保存 API と同じアプリに入れ直し、claude.ai で接続し直す |
| デプロイが失敗する | 1 の ID がまだ `wrangler.toml` に無い | ID を commit してから Retry build |

## ローカルで動かす

```sh
npx wrangler d1 execute sfx-atelier --local -c mcp/wrangler.toml --file db/migrations/0001_init.sql
npx wrangler dev -c mcp/wrangler.toml --var DEV_USER_EMAIL:you@example.com
```

localhost では `DEV_USER_EMAIL` のユーザーとして /authorize を通る（Access なし）。
