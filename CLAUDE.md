# CLAUDE.md — sfx-atelier

web ゲーム向けの軽量な効果音・ジングルを作るツール。Web Audio の合成で鳴らし、データは小さな JSON、再生ライブラリは gzip 後 10KB 以下。最初の導入先は mahjong-sensei。

ユーザーとのやりとり・コミットメッセージの本文・ドキュメントは日本語で書く。

- 要件と技術構成：`docs/tech-proposal.md`
- 実装計画（M0〜M7）：`docs/implementation-plan.md`

## ディレクトリ

```
packages/
  format/      sfx-bank / sfx-score の型・検証・正規化・版の移行。エディタとツールだけが使う
  runtime/     再生だけ（npm 名 @sfx-atelier/runtime）。依存なし。format からは型と既定値（defaults.ts）だけ import する
  compare/     聞き比べ：mahjong-sensei の sfx.ts（基準）と sfx-bank を同じ種で描画して数字で比べる。A/B のページ（Pages の /ab/）
  analysis/    分析（FFT・特徴量・効果音向けの指標）。エディタとツールだけが使い、ランタイムには入れない
  (fit/ midi/ physics/  計画の M4.5 以降で足す)
web/           エディタ（Vite、フレームワークなし）。model/ は純粋な編集の操作・履歴・時間軸・読み書き（Node のテスト）、ui/ は画面（ブラウザのテスト）。Pages では /editor/
analysis-demo/ 音響分析デモ（素の JavaScript。M4 で packages/analysis を使う側に置き換える）
bank/          ゲームに配るバンク（mahjong.sfxbank.json）
recordings/    録音の wav。リポジトリには置くが公開しない
scripts/       Pages 用のビルドと CI の検査
```

## 公開（Cloudflare Pages）

- ビルド `npm run build`、出力 `dist`。公開するものは `scripts/build-site.mjs` の `PUBLISH` に書いたものだけ
- `recordings/` と `.wav` は `dist` に入れない。CI の `npm run check:dist` で確かめる。ゲームに配る wav はゲーム側のリポジトリに書き出す
- 配布は JSON（合成）と wav（`sample` 層）の両方に対応する

## ランタイムの決まり

- 依存パッケージを持たない。Tone.js などは使わない
- gzip 後 10KB 以下。CI の `npm run size` が超えたら落ちる
- エディタの再生にもランタイムを使う（エディタとゲームで同じ音にする）

## 開発

- Node 20.12 以上（CI は `.nvmrc` の 22）、npm workspaces。ルートで `npm install`
- テスト：`npm test`（runtime の描画テストは Playwright の Chromium で動く。初回は `npx playwright install chromium`）。型チェック：`npm run typecheck`。容量：`npm run size`。公開物：`npm run build && npm run check:dist`
- TypeScript 7、Vitest 5、Vite 8（mahjong-sensei と同じ版）
- **計算にはユニットテストを書く。期待値は手計算・物理の式・既知の信号など独立した根拠から書き、実装の出力をそのまま写さない**（例：`tune: 1200` で周波数 2 倍、`bpm: 120` で 1 拍 0.5 秒、440Hz の正弦波の重心は 440Hz 付近）
- Web Audio の描画は Node とブラウザで差が出る。完全一致を求めるのは純粋な計算（compile）だけにし、描画の検査は許容差つきで書く
- コミット接頭辞：`feat:`（機能）/ `fix:` / `refactor:` / `docs:` / `test:` / `ci:` / `chore:`

## UI の文言（画面に出す文字）

mahjong-sensei と同じ：飾りの文・操作の説明文を置かない。コピー・閉じる・戻るなど定番の操作はアイコン（`aria-label` を付ける）。未実装のところは「準備中」だけ。
