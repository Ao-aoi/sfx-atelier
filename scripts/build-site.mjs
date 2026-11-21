// Cloudflare Pages に出すものを dist/ に集める。
// ここに書いたものだけが公開される（recordings/ や録音の wav は写さない）。
// M3 でエディタのビルド結果をここに足す。
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");

// 公開するもの（リポジトリ直下からの相対パス）
const PUBLISH = ["index.html", "analysis-demo"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const path of PUBLISH) {
  cpSync(join(root, path), join(out, path), {
    recursive: true,
    // 公開側に音声ファイルを置かない（check-dist.mjs でも確かめる）
    filter: (src) => !src.toLowerCase().endsWith(".wav"),
  });
}
console.log(`dist/ に ${PUBLISH.join(", ")} を書き出しました`);
