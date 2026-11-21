// プリセット：mahjong-sensei の 16 音（M2 で移したバンク）。
import type { Bank } from "@sfx-atelier/format/types";
import mahjong from "../../../bank/mahjong.sfxbank.json";

export interface PresetBank {
  name: string;
  bank: Bank;
}

export const PRESETS: PresetBank[] = [{ name: "mahjong", bank: mahjong as Bank }];
