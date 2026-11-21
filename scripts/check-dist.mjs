// dist/（Pages の公開対象）に録音が混ざっていないことを確かめる。
// - recordings/ という名前のディレクトリが無い
// - .wav ファイルが無い
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, process.argv[2] ?? "dist");

if (!existsSync(dist)) {
  console.error(`${relative(root, dist)}/ がありません。先に npm run build を実行してください`);
  process.exit(1);
}

const problems = [];
for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  const rel = relative(dist, join(entry.parentPath, entry.name));
  if (entry.isDirectory() && entry.name === "recordings") problems.push(`${rel}/（録音の置き場所）`);
  if (entry.isFile() && entry.name.toLowerCase().endsWith(".wav")) problems.push(rel);
}

if (problems.length > 0) {
  console.error("公開対象に録音が含まれています：");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("dist/ に recordings/ と .wav はありません");
