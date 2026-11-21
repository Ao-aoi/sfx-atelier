// npm に出す形（packages/runtime/npm/）を確かめる：
//   ・型定義だけで使う側のコードが型検査を通る（@sfx-atelier/format など公開しないものを参照していない）
//   ・npm pack に入るファイルが決めたものだけ
//   ・sfx-runtime.js を import すると createSfx などが出てくる
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmDir = join(root, "packages/runtime/npm");
const fail = (m) => {
  console.error(m);
  process.exit(1);
};

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
for (const f of walk(join(npmDir, "types"))) {
  if (readFileSync(f, "utf8").includes("@sfx-atelier/")) fail(`${f} が公開しないパッケージを参照しています`);
}

// 使う側のコード
const consumer = join(root, "packages/runtime/npm-check");
rmSync(consumer, { recursive: true, force: true });
mkdirSync(join(consumer, "node_modules/@sfx-atelier"), { recursive: true });
execFileSync("ln", ["-s", npmDir, join(consumer, "node_modules/@sfx-atelier/runtime")]);
writeFileSync(
  join(consumer, "main.ts"),
  `import { createSfx, type Sfx } from "@sfx-atelier/runtime";
const sfx: Sfx = createSfx({ format: "sfx-bank/1", sounds: { a: { tracks: [{ instrument: "x", notes: [{ t: 0, pitch: "A4" }] }] } }, instruments: { x: { layers: [{ osc: "sine", ratio: 1 }] } } });
sfx.installUnlock();
sfx.play("a", { pan: 0.2 });
// @ts-expect-error 型が効いている（gain は数）
sfx.play("a", { gain: "loud" });
`,
);
writeFileSync(
  join(consumer, "tsconfig.json"),
  JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", lib: ["ES2022", "DOM"], strict: true, noEmit: true, types: [] }, files: ["main.ts"] }),
);
try {
  execFileSync("npx", ["tsc", "-p", join(consumer, "tsconfig.json")], { cwd: root, stdio: "inherit" });
} catch {
  fail("型定義だけでは使う側のコードが型検査を通りません");
} finally {
  rmSync(consumer, { recursive: true, force: true });
}

const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: npmDir, encoding: "utf8" }))[0];
const names = packed.files.map((f) => f.path).sort();
const bad = names.filter((n) => !(n === "package.json" || n === "README.md" || n === "LICENSE" || n === "sfx-runtime.js" || n.startsWith("types/")));
if (bad.length) fail(`npm pack に余計なファイルがあります：${bad.join(", ")}`);

const mod = await import(pathToFileURL(join(npmDir, "sfx-runtime.js")).href);
for (const k of ["createSfx", "renderOffline", "compile"]) if (typeof mod[k] !== "function") fail(`${k} が出てきません`);

console.log(`npm に出す形：${names.length} ファイル、${packed.size} B（展開後 ${packed.unpackedSize} B）`);
