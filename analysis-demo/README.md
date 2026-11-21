# Audio Analysis Lab

ブラウザ内でMP3 / WAVを読み込み、基本的な音響特徴と周波数帯域を確認する実験用デモです。音声データをサーバーへ送信せず、Web Audio APIでデコード・解析します。

## 起動方法

リポジトリのルートでローカルHTTPサーバーを起動します。

```bash
python -m http.server 8000
```

ブラウザで `http://localhost:8000/analysis-demo/` を開いてください。

## Cloudflare Pages

### リポジトリ全体を1つのPagesプロジェクトとして公開する

Cloudflare PagesのGit連携で次のように設定します。

| 設定 | 値 |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 空欄（リポジトリのルート） |

デプロイ後のURLは `https://<プロジェクト名>.pages.dev/analysis-demo/` です。ルートの `index.html` からもデモへ移動できます。

### デモだけを独立したPagesプロジェクトとして公開する

Root directoryを `analysis-demo`、Build commandを `exit 0`、Build output directoryを `.` に設定します。デプロイ後は `https://<プロジェクト名>.pages.dev/` で開けます。

## 現在できること

- ブラウザ内での音声デコード・再生（ファイルはアップロードしない）
- RMS、スペクトル重心、スペクトルロールオフ、ゼロ交差率、スペクトル変化の計算
- 簡易テンポ推定
- 低域・中域・高域のエネルギー比率と、帯域別の試聴
- スペクトログラム表示
- 余韻・反復・ステレオ幅などの兆候をヒューリスティックに表示
- 分析結果と聴感メモのJSON出力

## 重要な制約

このデモの「帯域分解」は楽器ごとの音源分離ではありません。低域・中域・高域には複数の楽器が混ざります。Demucsなどの音源分離モデルによるステム分離は、現状では実装していません。

また、余韻・反復・ステレオ幅の表示は確定判定ではなく音響的な兆候です。楽器名や感情の自動推定、元のMIDIデータの復元も行いません。

## 次の分析段階

1. Demucs等によるステム分離
2. 分離したステムごとのBasic Pitch / librosa / Essentia分析
3. CLAP等による音声と言語記述の対応付け
4. LLMが測定値・聴感メモ・パート間の関係をまとめて説明
5. 分析結果をsfx-atelierのレイヤー／シーケンスへ変換
