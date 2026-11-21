# sfx-atelier

web ゲーム向けの軽量な効果音・ジングルを作るツール。Web Audio の合成だけで鳴らし、データは小さな JSON、再生ライブラリは gzip 後 10KB 以下を目標にする。Claude が音を分析して改善案を出せるようにする。

最初の導入先は mahjong-sensei。

- 要件定義（初版）と技術構成の提案：[docs/tech-proposal.md](docs/tech-proposal.md)
- 実装計画：[docs/implementation-plan.md](docs/implementation-plan.md)（PR #4）
- 状態：M0〜M7 を実装（M2 の mahjong-sensei への移行は聞き比べ待ち）。エディタは `/editor/`、聞き比べは `/ab/`、音響分析デモは `/analysis-demo/`
- 保存と MCP の設定：[docs/setup-cloudflare.md](docs/setup-cloudflare.md)・[docs/setup-mcp.md](docs/setup-mcp.md)

## 実験デモ

- [Audio Analysis Lab](./analysis-demo/README.md)：MP3 / WAVをブラウザ内で解析し、周波数帯域・スペクトログラム・音響特徴・エフェクトの兆候を確認する
- ブラウザで直接開く場合：`/analysis-demo/`

## 開発

```bash
npm install
npm run typecheck
npm test
npm run size        # ランタイムが gzip 後 10KB 以下か
npm run build       # Pages に出すものを dist/ に集める
npm run check:dist  # dist/ に recordings/ と .wav が無いか
npm run pack:runtime && npm run check:pack  # ランタイムの npm 公開用の形を packages/runtime/npm/ に作って確かめる
```

## ランタイムの npm 公開

```bash
npm run pack:runtime && npm run check:pack
npm login
npm publish packages/runtime/npm --access public
```

版は `packages/runtime/package.json` の `version` を上げてから出す。

## Cloudflare Pages へのデプロイ

Cloudflare Pages の Git 連携で次のように設定します。

| 設定 | 値 |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 空欄（リポジトリのルート） |

公開されるのは `scripts/build-site.mjs` に書いたもの（いまは `index.html` と `analysis-demo/`）だけです。トップページは `/`、分析デモは `/analysis-demo/` で開けます。録音の置き場所 `recordings/` は公開されません。PRブランチはPreview deploymentとして確認できます。

分析デモだけを独立したPagesプロジェクトとして公開する場合は、Root directoryを `analysis-demo`、Build commandを `exit 0`、Build output directoryを `.` にします。その場合はデモがプロジェクトのトップ（`/`）で開きます。

音声ファイルはブラウザ内で処理し、Pagesやサーバーへアップロードしません。
