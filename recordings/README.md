# recordings

物理エンジンなどで作った録音（wav）の置き場所。リポジトリには置くが、Cloudflare Pages の公開対象（`dist/`）には入れない。CI の `npm run check:dist` で確かめる。

ゲームに配る wav は、ゲーム側のリポジトリに書き出して置く。

1 ファイル 1MB まで。足すときは下の表に出どころとライセンスを書く。物理の録音は `npm run record -w @sfx-atelier/physics` で作り直せる（同じシーン・種から同じファイル）。

| ファイル | 出どころ | ライセンス | メモ |
| --- | --- | --- | --- |
| `discard-physics.wav` | `packages/physics` の `DISCARD_SCENE`・`DISCARD_SOUND`、種 1（前後の無音を除き、山 -1dB に正規化、16bit・48kHz・モノラル） | このリポジトリで作ったもの | M5c の最初の題材。いまの `discard` との聞き比べ用 |
