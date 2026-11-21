/** 保存の上限。D1 の 1 行・R2 の無料枠（10GB）に余裕を持たせる */
export const LIMITS = {
  /** 作品の JSON（縮めた形）の大きさ */
  maxBodyBytes: 256 * 1024,
  /** 分析の要約（analysis-report/1 は 80 行以内） */
  maxAnalysisBytes: 16 * 1024,
  /** 変更の説明 */
  maxNoteChars: 500,
  /** 名前・タグ */
  maxNameChars: 80,
  maxTagChars: 30,
  maxTags: 20,
  /** 録音 1 つ */
  maxRecordingBytes: 8 * 1024 * 1024,
  /** 1 人の録音の合計 */
  maxRecordingTotalBytes: 500 * 1024 * 1024,
  /** 用途と好みの記憶（行） */
  maxContextLines: 60,
  maxContextBytes: 8 * 1024,
  /** 一覧の件数 */
  maxList: 100,
} as const;
