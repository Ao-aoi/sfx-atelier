// 物理の録音を recordings/ に wav で書き出す。同じシーン・種からは同じファイルになる
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { encodeWav, normalize, removeSilence } from "../src";
import { record } from "../src/record";
import { DISCARD_SCENE, DISCARD_SOUND } from "../src/scenes";

const out = join(__dirname, "../../../recordings");

it("discard-physics.wav", () => {
  const r = record(DISCARD_SCENE, { ...DISCARD_SOUND, seed: 1 });
  const s = normalize(removeSilence(r.signal), -1);
  const bytes = encodeWav(s, 16);
  writeFileSync(join(out, "discard-physics.wav"), bytes);
  console.log(`discard-physics.wav: ${r.events.length} 回の接触、${(s.channels[0]!.length / s.sampleRate).toFixed(3)} 秒、${bytes.length} バイト`);
});
