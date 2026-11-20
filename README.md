# sfx-atelier

web ゲーム向けの軽量な効果音・ジングルを作るツール。Web Audio の合成だけで鳴らし、データは小さな JSON、再生ライブラリは gzip 後 10KB 以下を目標にする。Claude が音を分析して改善案を出せるようにする。

最初の導入先は mahjong-sensei。

- 要件定義（初版）と技術構成の提案：[docs/tech-proposal.md](docs/tech-proposal.md)
- 状態：設計中。ブラウザ内で動く音響分析デモを `analysis-demo/` に追加


## 実験デモ

- [Audio Analysis Lab](./analysis-demo/README.md)：MP3 / WAVをブラウザ内で解析し、周波数帯域・スペクトログラム・音響特徴・エフェクトの兆候を確認する
