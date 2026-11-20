# 効果音・曲作成ツール 技術構成の提案

作成日：2026-11-20
前提：要件定義（初版）と mahjong-sensei の現状（`web/src/audio/sfx.ts`・CLAUDE.md・Cloudflare 構成・ビルドとテスト）を読んで書いた。分かれ道の最終決定は Ao がする。

---

## 0. 調べて分かったこと（提案の前提）

- mahjong-sensei は npm workspaces のモノレポ。TypeScript 7・Vite 8・Vitest 5・Node 20 以上。web は Cloudflare Pages、保存は Pages Functions → `packages/store` → D1 / R2、認証は Cloudflare Access
- **MCP サーバ（読み取り）は 2026-11-20 に mahjong-sensei の main に入った**（`mcp/`：Workers、`@cloudflare/workers-oauth-provider`、D1・R2・OAuth 用 KV、Cloudflare Access で本人確認、claude.ai のカスタムコネクタ対応）。書き込み系のツール（講評・先生ファイルの保存）はまだ無い。初版ではここを「MCP は未実装」と書いたが、訂正する
- `sfx.ts` の音は、要件のたたき台の形式では**そのまま書けない**部分がある（下の 3 章）
  - エンベロープは「指数カーブで 0.0001 まで減衰」の AD 型。線形の ADSR では同じ音にならない
  - ピッチの変化は「減衰時間をかけて `to` Hz まで指数で下げる」。たたき台の `bend: -200` には時間とカーブが無い
  - 1 つの部品（`clack` = ノイズ 2 本＋正弦波 3 本）を倍率 `p` で丸ごと上げ下げして使い回す。`kan` は `clack` を 4 回、高さと強さを少しずつ変えて鳴らす
  - 残響は全体で 1 つ（畳み込み 1 個）を共有し、音ごとに「残響へ送る量」（0.3〜1.4）だけ変える
  - 揺らぎは音全体だけでなく部品ごと（`sticks` は雑音の中心周波数ごとに別の揺らぎ）。雑音の読み出し位置も毎回ランダム
  - 最終段にコンプレッサー（-10dB, 4:1）
- 呼び出し側（`main.ts`）は `play(name, { pan, gain, delay })` を 1 フレームに何回も呼ぶ（`pop` を 5 回、`deal` を左右に流して連打）。同時発音数への配慮が要る

---

## 1. 技術スタック案

mahjong-sensei と同じ道具を使い、知識と設定を使い回す。

| 層 | 選ぶもの | 理由 |
| --- | --- | --- |
| 言語・構成 | TypeScript 7、npm workspaces、ESM | mahjong-sensei と同じ |
| ビルド | Vite 8（エディタ）、ランタイムは Vite のライブラリモード（ESM 1 本） | 同上。ランタイムは依存なしの 1 ファイルにする |
| テスト | Vitest 5（Node）＋ Vitest のブラウザモード（Playwright の Chromium） | Web Audio は Node に無い。純粋な計算は Node、実際の音は OfflineAudioContext で描画して数値で確かめる |
| 音 | Web Audio API だけ（Tone.js などは使わない） | 10KB の制限と、エディタとゲームで同じ音を保証するため |
| MIDI | 自前の SMF 読み書き（数百行）か `@tonejs/midi`（MIT） | 読み込みはエディタ側だけなのでランタイムの容量に響かない |
| 配信 | エディタは Cloudflare Pages | mahjong-sensei と同じ |
| 保存・Claude 連携（後で） | Pages Functions ＋ D1、MCP は Workers | mahjong-sensei で先に MCP を作り、その形を写す |

### リポジトリの中身（案）

```
packages/
  format/     型・検証・正規化・版の移行（sfx-score/1 → /2）。エディタとツールだけが使う
  runtime/    再生だけ。依存なし。npm 公開の候補。format の型だけ import（型は消えるので容量ゼロ）
  analysis/   分析（記号の分析：音符から／音響の分析：描画した波形から）。ブラウザでも Workers でも動く純粋な TS
  midi/       SMF の読み書き
web/          エディタ（ピアノロール・音色・再生・A/B）
mcp/          後で（分かれ道 C で C1 を選んだら）
```

**エディタの再生にもランタイムを使う**。エディタで鳴った音とゲームで鳴る音が必ず同じになり、ランタイムのテストがそのままエディタの品質になる。

---

## 2. 分かれ道 A〜F の推奨

| | 推奨 | 理由 |
| --- | --- | --- |
| A 音の作り方 | **A1（合成だけ）で始め、形式にはサンプル用の枠だけ予約** | 軽さとライセンスの心配の無さが mahjong-sensei でうまくいっている。楽器の種類に `"sample"` を足せる形にしておけば、録音したくなった日に形式を壊さず A3 にできる |
| B 音声ファイルの分析 | **B1 で始め、後で「効果音向けの指標だけ」の B2 を足す** | 音色の明るさ・立ち上がり・余韻の長さは、自作の音でも「描画した波形」から測る必要がある（C1 の分析に必須）。この計算は wav にもそのまま使えるので、B2 の効果音向け部分はほぼ追加費用なしで手に入る。音声からの調・テンポ・和音の推定は精度と手間が一段上がるので後回し |
| C Claude とのつなぎ方 | **C1（MCP）。ただし段階を踏む：1〜3 段目は C3（貼り付け）、4 段目で C1** | mahjong-sensei の MCP が動いたので流用元ができた（読み取りは完成、書き込みは未実装）。新ツールには作品を書き戻すツールが要るので、読み取り＋書き込みを新しく作る。ただし最初のエディタが無い間は貼り付けで十分。分析結果と変更案（差分）の JSON 形式を「貼る」と「MCP」で同じにしておく。C2 は API キーと費用の管理が増えるので外す |
| D 作品の置き場所 | **完成した音は D3（ゲームのリポジトリに JSON）、作業中は D1（ブラウザ内）。C1 にするとき D2 を足す** | 効果音はゲームのコードと一緒に版管理されるのが自然で、Vite で JSON を import するだけで組み込める。mahjong-sensei の「GitHub にはコードだけ」とも矛盾しない（音の JSON はアセット＝コードの一部） |
| E 対象範囲 | **E2（効果音＋ジングル 15 秒まで）。ただし作る順は E1 → E2** | mahjong-sensei は既に `win`・`riichi`・`ryukyoku` で短いジングルを使っている。形式は拍（BPM）も持てるようにしておき、エディタのループ・和音機能は E2 の段で足す。BGM（E3）は機能が重くなるので外す |
| F 他の人にも使わせるか | **F3（ランタイムだけ npm 公開、MIT）。サーバを足すとき（D2）に user_id を最初から入れる** | D1・D3 の間はサーバが無いので user_id の出番が無い。D2 を足す時点で mahjong-sensei の規則（全テーブルに user_id、Access → OAuth）を写す |

---

## 3. 要件の抜け・矛盾・懸念

### 形式（3 章のたたき台）について

1. **エンベロープのカーブ**が無い。いまの音は指数カーブの AD 型。`env.curve: "exp" | "lin"` を足し、既定は `exp` にする
2. **ピッチの時間変化**に時間とカーブが無い。`bend: -200` では「どこまで・何秒で」が決まらない。`pitchEnv: { to, time, curve }` のような形にする
3. **部品の使い回し**が書けない。`clack` を `discard`・`call`・`kan`・`deal` で使い回すには、1 つの楽器が「複数の層（ノイズ＋正弦波数本）」を持ち、音符の高さで全体が上下する仕組みが要る。これが無いと 16 音の JSON が数倍に膨らむ
4. **音ごと・トラックごとの残響の送り量**が無い。たたき台の `fx` は音全体に 1 つ。残響は全体で共有し、トラックごとに `send` を持つ方が軽くて今の音も再現できる
5. **揺らぎの単位**：音全体（`variation`）だけでなく層ごとにも欲しい（`sticks`）。雑音の読み出し位置のランダムも明記する
6. **時間の単位の混在**：`tempo` と `"unit": "sec"` が並んでいる。1 つの作品の中では秒か拍のどちらか一方にし、拍のときだけ BPM・拍子を使う、と決める
7. **複数の音をまとめる単位（バンク）**が無い。ゲームは 16 音を 1 つのファイルで読み込みたいし、共有の楽器・残響もそこに置きたい
8. **差分（C5）のための ID**：音符とトラックに安定した `id` が無いと、Claude の変更案を「どの音符か」で正確に当てられない。公開用の書き出しでは `id` を落として軽くする

### ランタイムについて

9. **乱数の種（seed）**が要る。揺らぎ・雑音・残響がすべて `Math.random` なので、テストも聞き比べ（A/B）も毎回違う音になる。ランタイムは乱数を差し替えられるようにする
10. **遅延 20ms**：Web Audio の出力遅延（`outputLatency`）は iPhone で 10〜40ms 程度あり、ツール側では保証できない。「ランタイム内の処理（呼び出し→発音予約）を 2ms 以内、初回の作り込み（雑音・残響の生成、JSON の変換）は読み込み時に済ませる」を目標にし、端末の遅延は測って表示するだけにする
11. **同時発音数の上限**：`kan` は 1 回で 20 ノード。連打で重くならないよう、上限と古い音から止める規則を決める
12. **マスターの範囲**：音量の保存（localStorage）・消音はゲーム側に残し、ランタイムはマスター音量・解錠・コンプレッサーだけ持つ（いまの `sfx.ts` の `Sfx` クラスの半分）

### 書き出し・分析について

13. **ogg の書き出し（X4）**はブラウザでは難しい（MediaRecorder は Chrome で webm/opus、Safari で m4a）。wav だけにするか、ogg はコマンドライン（ffmpeg）に任せる
14. **分析の項目（C1）の分け方**：「調・和音進行」は 30ms の「カチッ」には意味が無い。分析を「記号の分析（音符から：調・音域・密度・和音）」と「音響の分析（描画した波形から：立ち上がり・余韻・明るさ・硬さ・音量の山）」に分け、短い効果音では音響だけ出す
15. **MIDI 読み込みの範囲**：ドラム（10ch）・テンポ変更・コントロールチェンジをどこまで扱うか決める
16. **公開時のライセンス**：MIDI ライブラリを使うなら MIT のものに限り、記録する

---

## 4. 1 段目（データ形式＋ランタイム）の設計案

### 4.1 データ形式

ゲームが読むのは「バンク」1 ファイル。エディタは 1 音ずつ（score）も扱える。

```jsonc
{
  "format": "sfx-bank/1",
  "master": { "compressor": { "threshold": -10, "ratio": 4 } },
  "reverb": { "room": { "seconds": 0.7, "decay": 3.2, "wet": 0.16 } },
  "instruments": {
    "clack": {
      "layers": [
        { "noise": "white", "filter": { "type": "bandpass", "freq": 3400, "q": 1.4 }, "gain": 0.55, "env": { "a": 0.001, "d": 0.035 } },
        { "noise": "white", "filter": { "type": "bandpass", "freq": 7800, "q": 2.5 }, "gain": 0.12, "env": { "a": 0.001, "d": 0.012 } },
        { "osc": "sine", "freq": 1180, "gain": 0.22, "env": { "a": 0.002, "d": 0.055 } },
        { "osc": "sine", "freq": 2730, "gain": 0.10, "env": { "a": 0.002, "d": 0.028 } },
        { "osc": "sine", "freq": 190, "gain": 0.5, "env": { "a": 0.002, "d": 0.09 }, "pitchEnv": { "toHz": 95, "time": "decay" } }
      ]
    },
    "bell": {
      "layers": [
        { "osc": "sine", "ratio": 1,    "gain": 1,    "env": { "a": 0.004, "d": 1 } },
        { "osc": "sine", "ratio": 2.76, "gain": 0.25, "env": { "a": 0.002, "d": 0.4 } },
        { "osc": "sine", "ratio": 5.4,  "gain": 0.08, "env": { "a": 0.001, "d": 0.15 } }
      ]
    }
  },
  "sounds": {
    "discard": {
      "time": { "unit": "sec" },
      "tracks": [
        { "id": "t1", "instrument": "clack", "send": { "room": 1 },
          "notes": [{ "id": "n1", "t": 0, "vel": 1 }] }
      ],
      "variation": { "tune": 68 }
    },
    "kan": {
      "time": { "unit": "sec" },
      "gain": 1.05,
      "tracks": [
        { "id": "t1", "instrument": "clack", "send": { "room": 1 },
          "notes": [
            { "id": "n1", "t": 0,     "tune": -144, "vel": 0.75 },
            { "id": "n2", "t": 0.055, "tune": -88,  "vel": 0.83 },
            { "id": "n3", "t": 0.11,  "tune": -35,  "vel": 0.91 },
            { "id": "n4", "t": 0.165, "tune": 17,   "vel": 0.99 }
          ] }
      ],
      "variation": { "tune": 34 }
    },
    "win": {
      "time": { "unit": "sec" },
      "tracks": [
        { "id": "t1", "instrument": "bell", "send": { "room": 1.4 },
          "notes": [
            { "id": "n1", "t": 0,     "pitch": "C6", "vel": 0.20, "dur": 1.5 },
            { "id": "n2", "t": 0.085, "pitch": "E6", "vel": 0.18, "dur": 1.5 },
            { "id": "n3", "t": 0.17,  "pitch": "G6", "vel": 0.16, "dur": 1.5 },
            { "id": "n4", "t": 0.255, "pitch": "C7", "vel": 0.14, "dur": 1.5 }
          ] }
      ]
    }
  }
}
```

決めごと：

- **層の高さ**：`freq`（Hz の固定値。音符の `tune` セントで全体が上下する）か `ratio`（音符の `pitch` に対する倍率）のどちらか。効果音は `freq`、楽器らしい音は `ratio` を使う
- **音符**：`t`（開始）、`dur`（長さ。無ければ楽器の減衰で決まる）、`pitch`（音名 `"A4"` か Hz の数値）、`tune`（セント）、`vel`（0〜1）
- **エンベロープ**：`a`・`d`・`s`（既定 0）・`r`・`curve`（既定 `exp`）。`s` が 0 なら AD 型、`dur` は無視
- **時間**：`time.unit` が `"sec"` か `"beat"`。`"beat"` のときだけ `bpm`・`sig` を持つ。ランタイムは読み込み時に秒へ変換
- **揺らぎ**：`variation` は音全体（`tune` セント・`gain` 割合・`time` 秒）。層ごとに `jitter` も書ける
- **省略**：既定値は書かない（容量と読みやすさのため）。`format` パッケージに「正規化（既定値を埋める）」と「縮める（既定値と id を落とす）」を持つ
- **版**：`format` の数字を上げるときは移行関数を必ず書く

### 4.2 ランタイムの API

```ts
import { createSfx } from 'sfx-runtime';        // 名前は仮
import bank from './sounds.sfxbank.json';

const sfx = createSfx(bank, { latencyHint: 'interactive', maxVoices: 48 });
sfx.installUnlock(window);                      // 最初のタップで AudioContext を作って resume
sfx.play('discard', { pan: 0.55, gain: 0.7, delay: 0.12 });
sfx.setMasterGain(0.36);                        // 音量の保存・消音はゲーム側
sfx.ready;                                      // 雑音・残響の生成が済んだら解決する Promise

// エディタと聞き比べ用
sfx.playScore(score, opts);                     // バンクに無い音を直接鳴らす
createSfx(bank, { random: seeded(42) });        // 乱数の差し替え
```

mahjong-sensei の `Sfx.play(name, opts)` とは同じ形なので、移行は `sfx.ts` の合成部分（約 300 行）を JSON に置き換え、`soundForEvent`・音量の保存・`gameEvent` はそのまま残す。

### 4.3 ランタイムの中身（2 段に分ける）

1. **compile（純粋な関数）**：score ＋ 呼び出しの opts ＋ 乱数 → 「何秒にどのノードをどの値で動かすか」の平らな予定表。Web Audio を触らないので Node でテストできる
2. **render（薄い層）**：予定表を Web Audio のノードに変える。共有するもの（1 秒の白色雑音、残響の畳み込み、マスター、コンプレッサー）は最初に 1 回だけ作る

### 4.4 テスト

| 何を | どうやって |
| --- | --- |
| 形式の検証・正規化・版の移行 | Vitest（Node）。壊れた JSON・範囲外の値を拒否するか |
| compile | Vitest（Node）。期待値は手計算から書く（例：`tune: 1200` で周波数が 2 倍、`unit: beat`・`bpm: 120` で 1 拍 = 0.5 秒、`curve: exp` の最終値が 0.0001）。ライブラリの出力を写さない（mahjong-sensei の CLAUDE.md と同じ考え） |
| render | Vitest のブラウザモード（Chromium）で OfflineAudioContext に描画し、長さ・最大音量・無音でない・NaN が無い・割れていないを確かめる |
| 容量 | ビルドした ESM を gzip して 10KB 以下を確かめるテストを置く（超えたら落ちる） |
| 2 段目の聞き比べ（準備） | いまの `sfx.ts` と新しい JSON を同じ乱数の種で描画し、5ms ごとの音量の推移と明るさ（スペクトル重心）の差を数字で出す。最後は耳で A/B |

### 4.5 1 段目でやらないこと

エディタの画面、MIDI、分析、Claude 連携、サンプル、wav の書き出し。

---

## 5. 決めてほしいこと

- 分かれ道 A〜F（上の推奨でよいか）
- ツールの名前（ランタイムの npm 名にもなる）
- ogg の書き出しを要件から外して wav だけにするか
