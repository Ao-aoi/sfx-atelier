// Cloudflare Pages に出すものを dist/ に集める。
// ここに書いたものだけが公開される（recordings/ や録音の wav は写さない）。
// エディタ（web/）・A/B のページ（packages/compare）は先にビルドしておく（ルートの npm run build が順に行う）。
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");

// 公開するもの：[リポジトリ直下からの元の場所, dist の中の場所]
const PUBLISH = [
  ["index.html", "index.html"],
  ["analysis-demo", "analysis-demo"],
  // 先に npm run build -w @sfx-atelier/compare で作る
  ["packages/compare/dist", "ab"],
  // 先に npm run build -w @sfx-atelier/web で作る
  ["web/dist", "editor"],
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [from, to] of PUBLISH) {
  if (!existsSync(join(root, from))) {
    console.error(`${from} がありません（先に npm run build でビルドする）`);
    process.exit(1);
  }
  cpSync(join(root, from), join(out, to), {
    recursive: true,
    // 公開側に音声ファイルを置かない（check-dist.mjs でも確かめる）
    filter: (src) => !src.toLowerCase().endsWith(".wav"),
  });
}
console.log(`dist/ に ${PUBLISH.map(([, to]) => to).join(", ")} を書き出しました`);
