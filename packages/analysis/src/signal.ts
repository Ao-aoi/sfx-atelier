// 分析の入力。AudioBuffer に依存しない形にして、Node のテストでも使えるようにする。

export interface Signal {
  sampleRate: number;
  /** チャンネルごとの波形（同じ長さ） */
  channels: Float32Array[];
}

/** AudioBuffer（か同じ形のもの）から Signal を作る */
export function fromAudioBuffer(buffer: { sampleRate: number; numberOfChannels: number; getChannelData(i: number): Float32Array }): Signal {
  return {
    sampleRate: buffer.sampleRate,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)),
  };
}

/** チャンネルの平均（モノラル） */
export function toMono(signal: Signal): Float32Array {
  const { channels } = signal;
  if (channels.length === 1) return channels[0]!;
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i] ?? 0;
    mono[i] = sum / channels.length;
  }
  return mono;
}
