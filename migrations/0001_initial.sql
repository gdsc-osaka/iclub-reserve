-- iclub-reserve schema

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_staff    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK(role IN ('owner', 'member')),
  joined_at   TEXT NOT NULL,
  UNIQUE(user_id, group_id)
);

CREATE TABLE IF NOT EXISTS facilities (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  photo_url   TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES groups(id),
  facility_id   TEXT NOT NULL REFERENCES facilities(id),
  start_at      TEXT NOT NULL,
  end_at        TEXT NOT NULL,
  headcount     INTEGER,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'provisional'
                  CHECK(status IN ('provisional','approved','withdrawn','rejected','cancelled','cancelled_by_staff')),
  status_reason TEXT,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservations_facility ON reservations(facility_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_reservations_group    ON reservations(group_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_expires      ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  sender_id      TEXT NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  sent_at        TEXT NOT NULL
);
