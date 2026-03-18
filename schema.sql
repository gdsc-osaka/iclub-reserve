-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_staff INTEGER NOT NULL DEFAULT 0
);

-- Facilities Table
CREATE TABLE IF NOT EXISTS facilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  photo_url TEXT,
  google_calendar_id TEXT,
  calendar_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Groups Table
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Memberships Table
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner' or 'member'
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(group_id) REFERENCES groups(id)
);

-- Reservations Table
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  facility_id TEXT NOT NULL,
  start_at TEXT NOT NULL, -- ISO8601 string
  end_at TEXT NOT NULL, -- ISO8601 string
  headcount INTEGER NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'provisional',
  status_reason TEXT,
  created_by TEXT NOT NULL,
  FOREIGN KEY(group_id) REFERENCES groups(id),
  FOREIGN KEY(facility_id) REFERENCES facilities(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);

-- Messages Table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  FOREIGN KEY(reservation_id) REFERENCES reservations(id),
  FOREIGN KEY(sender_id) REFERENCES users(id)
);
