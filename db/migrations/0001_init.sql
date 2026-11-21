-- 作品の置き場所（M7、分かれ道 D の D2）。
-- 方針（mahjong-sensei と同じ）：全テーブルに user_id を持つ（公開サービスを見据えて、1 人前提にしない）。
--       日時は ISO 8601 の文字列（UTC）。JSON は TEXT に入れる。録音の wav は R2 に置き、ここには key だけ持つ。

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

-- ログインの手段とユーザーの対応。いまは Cloudflare Access（provider = 'cf-access'）、公開時は OAuth の provider を足す
CREATE TABLE user_identities (
  provider   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  email      TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX idx_user_identities_user ON user_identities(user_id);

-- 作品：1 つの score（sfx-score/1）かバンク（sfx-bank/1）。中身は版（sound_versions）に持つ
CREATE TABLE sounds (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('score', 'bank')),
  latest_version INTEGER NOT NULL,
  -- 録音（wav）を誰でも取れるようにするか（0 / 1）
  public         INTEGER NOT NULL DEFAULT 0 CHECK (public IN (0, 1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_sounds_user_name ON sounds(user_id, name);
CREATE INDEX idx_sounds_user_updated ON sounds(user_id, updated_at DESC);

-- 版。保存・変更案の適用のたびに 1 つ増え、古い版も残す（書き換えの事故から戻せるように）
CREATE TABLE sound_versions (
  sound_id   TEXT NOT NULL REFERENCES sounds(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  version    INTEGER NOT NULL,
  body       TEXT NOT NULL,                -- 縮めた JSON
  analysis   TEXT,                         -- analysis-report/1（エディタが描画して測った要約）
  patch      TEXT,                         -- この版を作った sfx-patch/1（変更案を適用したときだけ）
  note       TEXT,                         -- 変更の説明
  author     TEXT NOT NULL,                -- editor / claude など（書いた側）
  created_at TEXT NOT NULL,
  PRIMARY KEY (sound_id, version)
);

CREATE TABLE sound_tags (
  sound_id TEXT NOT NULL REFERENCES sounds(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id),
  tag      TEXT NOT NULL,
  PRIMARY KEY (sound_id, tag)
);
CREATE INDEX idx_sound_tags_user_tag ON sound_tags(user_id, tag);

-- 録音（wav）。中身は R2 の r2_key。作品に結びつけない録音もある
CREATE TABLE recordings (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  sound_id   TEXT REFERENCES sounds(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  r2_key     TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_recordings_user ON recordings(user_id, created_at DESC);
CREATE INDEX idx_recordings_sound ON recordings(sound_id);

-- 用途と好みの記憶（提案書 C6）。Claude が読んで、作る音の方向を合わせる。更新のたびに version を上げる
CREATE TABLE user_context (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  body       TEXT NOT NULL,
  version    INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE user_context_history (
  user_id    TEXT NOT NULL REFERENCES users(id),
  version    INTEGER NOT NULL,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, version)
);
