import { normalizeScore, SCORE_FORMAT, validateScore, type Score } from "@sfx-atelier/format";
import { describe, expect, it } from "vitest";
import { midiToNoteName, midiToScore, programName, programOf, readSmf, scoreToMidi, writeSmf, type MidiEvent, type Smf } from "../src";

const one = (events: MidiEvent[], ppq = 480): Smf => ({ format: 0, ppq, tracks: [{ events }] });
const plain = (s: Score) => s.tracks.map((t) => ({ instrument: t.instrument, notes: t.notes.map(({ id: _i, ...n }) => n) }));

describe("midiToNoteName", () => {
  it("C4 = 60、A4 = 69、0 は C-1、127 は G9", () => {
    expect([60, 69, 61, 0, 127].map(midiToNoteName)).toEqual(["C4", "A4", "C#4", "C-1", "G9"]);
  });
});

describe("programName / programOf", () => {
  it("General MIDI の系統：0 はピアノ、40（バイオリン）は弦、41 は弦の 2 番目", () => {
    expect(programName(0)).toBe("ピアノ");
    expect(programName(40)).toBe("弦");
    expect(programName(41)).toBe("弦 42");
    for (const p of [0, 7, 40, 41, 127]) expect(programOf(programName(p))).toBe(p);
    expect(programOf("自作の楽器")).toBeNull();
    // 番号が系統と合わない
    expect(programOf("弦 1")).toBeNull();
  });
});

describe("midiToScore", () => {
  it("テンポが 1 つなら拍：120 BPM・3/4、分解能 96 で 96 tick = 1 拍", () => {
    const smf = one(
      [
        { tick: 0, type: "tempo", usPerBeat: 500000 },
        { tick: 0, type: "timeSig", num: 3, den: 4 },
        { tick: 0, type: "noteOn", ch: 0, key: 60, vel: 127 },
        { tick: 96, type: "noteOff", ch: 0, key: 60, vel: 0 },
        { tick: 96, type: "noteOn", ch: 0, key: 64, vel: 64 },
        { tick: 480, type: "noteOff", ch: 0, key: 64, vel: 0 },
      ],
      96,
    );
    const { score, warnings } = midiToScore(smf);
    expect(warnings).toEqual([]);
    expect(validateScore(score).ok).toBe(true);
    expect(score.time).toEqual({ unit: "beat", bpm: 120, sig: [3, 4] });
    expect(plain(score)).toEqual([
      {
        instrument: "ピアノ",
        notes: [
          { t: 0, dur: 1, pitch: "C4", vel: 1, tune: 0 },
          { t: 1, dur: 4, pitch: "E4", vel: 0.504, tune: 0 },
        ],
      },
    ]);
  });

  it("テンポが変わるなら秒：120 BPM の 2 拍（1 秒）の後に 60 BPM、tick 1440〜1920 は 2〜3 秒", () => {
    const smf: Smf = {
      format: 1,
      ppq: 480,
      tracks: [
        { events: [{ tick: 0, type: "tempo", usPerBeat: 500000 }, { tick: 960, type: "tempo", usPerBeat: 1000000 }] },
        { events: [{ tick: 1440, type: "noteOn", ch: 0, key: 69, vel: 100 }, { tick: 1920, type: "noteOff", ch: 0, key: 69, vel: 0 }] },
      ],
    };
    const { score, warnings } = midiToScore(smf);
    expect(score.time).toEqual({ unit: "sec" });
    expect(warnings).toHaveLength(1);
    expect(score.tracks[0]!.notes[0]).toMatchObject({ t: 2, dur: 1, pitch: "A4" });
  });

  it("チャンネル 10 はドラム：キーの種類ごとにトラックを分け、キーは音名で残す", () => {
    const smf = one([
      { tick: 0, type: "noteOn", ch: 9, key: 36, vel: 100 },
      { tick: 0, type: "noteOn", ch: 9, key: 42, vel: 100 },
      { tick: 60, type: "noteOff", ch: 9, key: 36, vel: 0 },
      { tick: 60, type: "noteOff", ch: 9, key: 42, vel: 0 },
      { tick: 240, type: "noteOn", ch: 9, key: 46, vel: 100 },
      { tick: 300, type: "noteOff", ch: 9, key: 46, vel: 0 },
    ]);
    const { score } = midiToScore(smf);
    expect(score.tracks.map((t) => [t.instrument, t.notes.map((n) => n.pitch)])).toEqual([
      ["バスドラム", ["C2"]],
      ["ハイハット", ["F#2", "A#2"]],
    ]);
  });

  it("トラック × チャンネル × プログラムで分け、最初の音量・パンを写す", () => {
    const smf: Smf = {
      format: 1,
      ppq: 480,
      tracks: [
        {
          events: [
            { tick: 0, type: "trackName", text: "メロディ" },
            { tick: 0, type: "program", ch: 0, program: 40 },
            { tick: 0, type: "control", ch: 0, cc: 7, value: 127 },
            { tick: 0, type: "control", ch: 0, cc: 10, value: 127 },
            { tick: 0, type: "control", ch: 0, cc: 64, value: 127 },
            { tick: 0, type: "noteOn", ch: 0, key: 72, vel: 100 },
            { tick: 480, type: "noteOff", ch: 0, key: 72, vel: 0 },
            { tick: 0, type: "noteOn", ch: 1, key: 48, vel: 100 },
            { tick: 960, type: "noteOff", ch: 1, key: 48, vel: 0 },
          ],
        },
      ],
    };
    const { score, warnings } = midiToScore(smf);
    expect(score.tracks.map((t) => [t.id, t.instrument, t.gain, t.pan])).toEqual([
      ["メロディ 弦", "弦", 1, 1],
      ["メロディ ピアノ", "ピアノ", 1, 0],
    ]);
    expect(warnings).toEqual(["コントロール（音量・パン以外） 1 個は読み込んでいません"]);
  });

  it("止められていない音はトラックの最後で止め、知らせる", () => {
    const { score, warnings } = midiToScore(one([{ tick: 0, type: "noteOn", ch: 0, key: 60, vel: 100 }, { tick: 960, type: "program", ch: 0, program: 0 }]));
    expect(score.tracks[0]!.notes[0]).toMatchObject({ t: 0, dur: 2 });
    expect(warnings[0]).toContain("1 個");
  });

  it("同じ音の連打：同じ tick の止める・出すの順がファイルで逆でも、0 秒の音符にしない", () => {
    const { score } = midiToScore(
      one([
        { tick: 0, type: "noteOn", ch: 0, key: 60, vel: 100 },
        { tick: 480, type: "noteOn", ch: 0, key: 60, vel: 100 },
        { tick: 480, type: "noteOff", ch: 0, key: 60, vel: 0 },
        { tick: 960, type: "noteOff", ch: 0, key: 60, vel: 0 },
      ]),
    );
    expect(score.tracks[0]!.notes.map((n) => [n.t, n.dur])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
});

describe("scoreToMidi", () => {
  const beatScore = (): Score =>
    normalizeScore({
      format: SCORE_FORMAT,
      time: { unit: "beat", bpm: 90, sig: [6, 8] },
      instruments: {
        ピアノ: { layers: [{ osc: "triangle", ratio: 1 }] },
        スネア: { layers: [{ noise: "white" }] },
      },
      tracks: [
        { instrument: "ピアノ", notes: [{ t: 0, dur: 0.5, pitch: "C4", vel: 1 }, { t: 0.5, dur: 1.5, pitch: "G4", vel: 0.504 }] },
        { instrument: "スネア", notes: [{ t: 1, dur: 0.25, pitch: "D2", vel: 1 }] },
      ],
    });

  it("拍の score：90 BPM は 666667 µs、0.5 拍は 240 tick、高さの効かない楽器はチャンネル 10", () => {
    const { smf } = scoreToMidi(beatScore());
    expect(smf.ppq).toBe(480);
    expect(smf.tracks[0]!.events).toEqual([
      { tick: 0, type: "tempo", usPerBeat: 666667 },
      { tick: 0, type: "timeSig", num: 6, den: 8 },
    ]);
    const notes = (i: number) => smf.tracks[i]!.events.filter((e) => e.type === "noteOn" || e.type === "noteOff");
    expect(notes(1)).toEqual([
      { tick: 0, type: "noteOn", ch: 0, key: 60, vel: 127 },
      { tick: 240, type: "noteOff", ch: 0, key: 60, vel: 0 },
      { tick: 240, type: "noteOn", ch: 0, key: 67, vel: 64 },
      { tick: 960, type: "noteOff", ch: 0, key: 67, vel: 0 },
    ]);
    expect(smf.tracks[1]!.events).toContainEqual({ tick: 0, type: "program", ch: 0, program: 0 });
    expect(notes(2)[0]).toEqual({ tick: 480, type: "noteOn", ch: 9, key: 38, vel: 127 });
  });

  it("書いて読み直すと音符・時間が戻る", () => {
    const src = beatScore();
    const back = midiToScore(readSmf(writeSmf(scoreToMidi(src).smf))).score;
    expect(back.time).toEqual(src.time);
    expect(plain(back).map((t) => t.notes)).toEqual(plain(src).map((t) => t.notes));
  });

  it("秒の score は 120 BPM で書く：0.5 秒 = 1 拍 = 480 tick。Hz と tune は半音に丸める", () => {
    const score = normalizeScore({
      format: SCORE_FORMAT,
      instruments: { 音: { layers: [{ osc: "sine", ratio: 1 }] } },
      tracks: [{ instrument: "音", notes: [{ t: 0.5, dur: 0.25, pitch: 440 }, { t: 1, dur: 0.25, pitch: "A4", tune: 100 }, { t: 2, dur: 0.25, pitch: 450 }] }],
    });
    const { smf, warnings } = scoreToMidi(score);
    expect(smf.tracks[0]!.events[0]).toEqual({ tick: 0, type: "tempo", usPerBeat: 500000 });
    const ons = smf.tracks[1]!.events.filter((e) => e.type === "noteOn");
    // 450 Hz は A4 から 12 × log2(450 / 440) ≒ 0.39 半音 → 69
    expect(ons.map((e) => [e.tick, (e as { key: number }).key])).toEqual([
      [480, 69],
      [960, 70],
      [1920, 69],
    ]);
    expect(warnings).toContain("半音に丸めた音符が 2 個あります");
  });

  it("dur の無い音符は、いちばん長い層の a + d + r の長さにする", () => {
    const score = normalizeScore({
      format: SCORE_FORMAT,
      instruments: { 音: { layers: [{ osc: "sine", ratio: 1, env: { a: 0.01, d: 0.2 } }, { osc: "sine", ratio: 2, env: { a: 0, d: 0.49, r: 0.01 } }] } },
      tracks: [{ instrument: "音", notes: [{ t: 0, pitch: "C5" }] }],
    });
    const off = scoreToMidi(score).smf.tracks[1]!.events.find((e) => e.type === "noteOff")!;
    // 0.5 秒 = 120 BPM の 1 拍
    expect(off.tick).toBe(480);
  });
});
