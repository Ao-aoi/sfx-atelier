# Cloudflare の設定（作品の保存・認証）

コードだけでは済まない、ダッシュボードでの設定。1 回だけやればよい。mahjong-sensei の `docs/setup-cloudflare.md` と同じ流れ。

## 1. D1 と R2 を作る

```sh
npx wrangler login
npx wrangler d1 create sfx-atelier                # 出てきた database_id を db/wrangler.toml に書く
npx wrangler r2 bucket create sfx-atelier-recordings
npx wrangler d1 migrations apply sfx-atelier --remote -c db/wrangler.toml
```

## 2. Pages に結びつける

Pages → sfx-atelier → 設定 → バインディング（Production と Preview の両方）

| 種類 | 変数名 | 中身 |
| --- | --- | --- |
| D1 | `DB` | sfx-atelier |
| R2 | `RECORDINGS` | sfx-atelier-recordings |

## 3. Cloudflare Access で自分だけ通す

Zero Trust → Access → アプリケーション → 追加 → セルフホスト

- ドメイン：`sfx-atelier.pages.dev` と `*.sfx-atelier.pages.dev`、パスは `api`（エディタとデモは今までどおり誰でも開ける）
- ポリシー：Allow、Include → Emails → 自分のメールアドレス
- 公開にした作品の録音（`/api/public/recordings/*`）は誰でも取れるようにする：同じドメインで、パス `api/public` のアプリをもう 1 つ作り、ポリシーを **Bypass**、Include → Everyone にする
- 1 つ目のアプリの「Application Audience (AUD) タグ」を控える

## 4. Pages の環境変数（Production と Preview の両方）

| 変数名 | 例 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | `https://<チーム名>.cloudflareaccess.com` |
| `ACCESS_AUD` | 3 で控えた AUD タグ |

設定したら再デプロイする。`/api/me` を開いて自分の表示名が返れば完了。

## 上限

`packages/store/src/limits.ts`。作品の JSON は 256KB、録音は 1 つ 8MB・1 人の合計 500MB（R2 の無料枠 10GB に余裕を持たせる）。

## 仕組み

- 作品（score かバンク）は `sounds`、中身は版ごとに `sound_versions`。保存・変更案の適用のたびに版が 1 つ増え、古い版も残る
- 書き込みは `base_version`（読んだときの版）が最新のときだけ通る。エディタと Claude が同時に書いても、後から書いた方が 409 になって消し合わない
- 録音の wav は R2（`recordings/<user_id>/<id>.wav`）、D1 には key と大きさだけ
- 全テーブルに `user_id` を持つ（公開サービスを見据えて、1 人前提にしない）
