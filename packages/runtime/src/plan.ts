// compile の出力：Web Audio を触らない「予定表」。時刻は鳴らし始めからの秒。
// render はこれをそのままノードの予定に写す。

/** AudioParam への予定。set は setValueAtTime、lin・exp はその時刻に向かう ramp */
export type Automation = readonly (readonly ["set" | "lin" | "exp", number, number])[];

/** トラックごとの出口（音量 → 左右 → 原音と残響への送り） */
export interface Bus {
  gain: number;
  pan: number;
  /** [残響の名前, 送り量] */
  sends: [string, number][];
}

export type VoiceSource =
  | { kind: "osc"; type: OscillatorType; freq: Automation }
  | { kind: "noise"; type: "white" | "pink" | "brown"; /** 雑音バッファの読み出し位置（秒） */ offset: number }
  | { kind: "sample"; sample: string; rate: Automation };

export interface Voice {
  /** buses の番号 */
  bus: number;
  start: number;
  stop: number;
  source: VoiceSource;
  gain: Automation;
  pan: number;
  filter?: { type: BiquadFilterType; freq: number; q: number; gain: number };
}

export interface Plan {
  /** 音全体の音量（音の gain × 呼び出しの gain × 揺らぎ） */
  gain: number;
  buses: Bus[];
  voices: Voice[];
  /** 最後の発音が止まる時刻（残響の尾を含まない） */
  end: number;
  /** 残響の尾まで含めた長さ */
  tail: number;
}
