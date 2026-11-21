// プリセット：mahjong-sensei の音を書いたバンク。M2 で 16 音のバンクができたら、そちらに差し替える。
import type { Bank } from "@sfx-atelier/format/types";
import mahjong from "../../../packages/runtime/test/fixtures/mahjong-5.sfxbank.json";

export interface PresetBank {
  name: string;
  bank: Bank;
}

export const PRESETS: PresetBank[] = [{ name: "mahjong", bank: mahjong as Bank }];
