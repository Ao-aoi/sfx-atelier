import type { Bank } from "@sfx-atelier/format/types";
import { createSfx, type Sfx } from "@sfx-atelier/runtime";
import mahjong from "../../../bank/mahjong.sfxbank.json";
import { createReference, REFERENCE_NAMES, type ReferenceName } from "../src/reference";

let ctx: AudioContext | null = null;
let ref: ReturnType<typeof createReference> | null = null;
let sfx: Sfx | null = null;

/** 操作の中で AudioContext を作って resume する（iOS） */
async function ready() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "interactive" });
    ref = createReference(ctx, Math.random);
    sfx = createSfx(mahjong as Bank, { context: ctx });
  }
  if (ctx.state !== "running") await ctx.resume();
}

async function playA(name: ReferenceName) {
  await ready();
  ref!(name);
}

async function playB(name: ReferenceName) {
  await ready();
  sfx!.play(name);
}

const list = document.getElementById("list")!;
for (const name of REFERENCE_NAMES) {
  const li = document.createElement("li");
  const label = document.createElement("span");
  label.className = "name";
  label.textContent = name;
  const a = document.createElement("button");
  a.textContent = "A";
  a.onclick = () => void playA(name);
  const b = document.createElement("button");
  b.textContent = "B";
  b.className = "b";
  b.onclick = () => void playB(name);
  const ab = document.createElement("button");
  ab.textContent = "A→B";
  ab.className = "ab";
  ab.setAttribute("aria-label", `${name} を A、B の順に鳴らす`);
  ab.onclick = async () => {
    await playA(name);
    setTimeout(() => void playB(name), 900 + (name.startsWith("win") || name === "riichi" || name === "ryukyoku" ? 1200 : 0));
  };
  li.append(label, a, b, ab);
  list.append(li);
}
