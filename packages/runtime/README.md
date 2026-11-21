# @sfx-atelier/runtime

web ゲーム向けの効果音・ジングルを Web Audio の合成で鳴らす再生ライブラリ。依存パッケージなし、gzip 後 10KB 以下。
音のデータは小さな JSON（`sfx-bank/1`）。[sfx-atelier](https://github.com/Ao-aoi/sfx-atelier) のエディタで作って書き出す。

## 使い方

```ts
import { createSfx } from "@sfx-atelier/runtime";
import bank from "./mahjong.sfxbank.json";

const sfx = createSfx(bank);
sfx.installUnlock(); // 最初のタップ・キー入力で AudioContext を作る（iOS など）

sfx.play("discard");
sfx.play("win", { pan: -0.3, gain: 0.8, delay: 0.1 });
sfx.setMasterGain(0.5);
```

| API | 中身 |
| --- | --- |
| `createSfx(bank, opts?)` | `opts`：`maxVoices`（同時発音数、既定 48）・`random`（乱数の差し替え）・`baseUrl`（録音の url の基準）・`context`（使う AudioContext） |
| `play(name, { pan, gain, delay })` | バンクの音を鳴らす。解錠の前は鳴らさず `null` |
| `installUnlock(target?)` / `unlock()` | AudioContext を作って resume する |
| `ready` | 雑音・残響の生成と録音（wav）の読み込みが済んだら解決する |
| `setMasterGain(gain)` / `stopAll()` | マスター音量・全部止める |
| `playScore(score)` | バンクに無い音（`sfx-score/1`）を直接鳴らす |
| `renderOffline(sound, parts, { seed })` | OfflineAudioContext に描画して AudioBuffer を返す（テスト・書き出し用） |

録音の層（`sample`）を使うバンクは、`samples` の url（バンクの JSON からの相対か絶対）から wav を読み込む。

## ライセンス

MIT
