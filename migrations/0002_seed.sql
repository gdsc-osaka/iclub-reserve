-- Demo seed data
-- All passwords are stored as "plain:<password>" for demo purposes only.
-- Demo password for all accounts: demo1234

-- Users
INSERT OR IGNORE INTO users (id, email, name, password_hash, is_staff, created_at, updated_at) VALUES
  ('u-staff',        'staff@osaka-u.ac.jp',          '事務局 管理者',      'plain:demo1234', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('u-alpha-owner',  'alpha-owner@osaka-u.ac.jp',    '山田 太郎',          'plain:demo1234', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('u-alpha-member', 'alpha-member@osaka-u.ac.jp',   '鈴木 花子',          'plain:demo1234', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('u-beta-owner',   'beta-owner@osaka-u.ac.jp',     '田中 次郎',          'plain:demo1234', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

-- Groups
INSERT OR IGNORE INTO groups (id, name, is_active, created_at, updated_at) VALUES
  ('g-alpha', 'Innovators Team Alpha', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('g-beta',  'Robotics Lab Beta',     1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

-- Memberships
INSERT OR IGNORE INTO memberships (id, user_id, group_id, role, joined_at) VALUES
  ('m-1', 'u-alpha-owner',  'g-alpha', 'owner',  '2026-01-01T00:00:00Z'),
  ('m-2', 'u-alpha-member', 'g-alpha', 'member', '2026-01-01T00:00:00Z'),
  ('m-3', 'u-beta-owner',   'g-beta',  'owner',  '2026-01-01T00:00:00Z');

-- Facilities (from PRD section 3-5)
INSERT OR IGNORE INTO facilities (id, name, description, is_active, created_at, updated_at) VALUES
  ('f-01', '吹田：C棟2階占有 イベント予約',   'C棟2階の共用スペースを占有してのイベント利用',      1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('f-02', '吹田：3Dプリンター 積層タイプ',   'FDM方式3Dプリンター（1号機）',                     1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('f-03', '吹田：3Dプリンター 積層タイプ2',  'FDM方式3Dプリンター（2号機）',                     1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('f-04', '吹田：3Dプリンター 光造形機',     '光造形（SLA）方式3Dプリンター',                     1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('f-05', '吹田：レーザーカッター',          'CO2レーザーカッター',                               1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('f-06', '吹田：CAD用パソコン',             'CADソフトウェアインストール済みPC',                  1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('f-07', '豊中試作室',                      '豊中キャンパス試作室（部屋全体の予約）',              1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('f-08', '豊中試作室：3Dプリンター',        '豊中試作室内FDM方式3Dプリンター',                    1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

-- Sample reservations (dates relative to 2026-03-18)
INSERT OR IGNORE INTO reservations (id, group_id, facility_id, start_at, end_at, headcount, note, status, created_by, created_at, updated_at) VALUES
  ('r-01', 'g-alpha', 'f-01',
   '2026-03-20T10:00:00Z', '2026-03-20T12:00:00Z',
   15, '新入生向け説明会の開催', 'approved',
   'u-alpha-owner', '2026-03-10T09:00:00Z', '2026-03-11T10:00:00Z'),

  ('r-02', 'g-alpha', 'f-07',
   '2026-03-18T14:00:00Z', '2026-03-18T17:00:00Z',
   5, 'プロトタイプ制作', 'provisional',
   'u-alpha-owner', '2026-03-17T09:00:00Z', '2026-03-17T09:00:00Z'),

  ('r-03', 'g-beta', 'f-05',
   '2026-03-19T10:00:00Z', '2026-03-19T12:00:00Z',
   3, 'ロボットアーム部品の切削', 'approved',
   'u-beta-owner', '2026-03-15T09:00:00Z', '2026-03-16T10:00:00Z'),

  ('r-04', 'g-alpha', 'f-02',
   '2026-03-25T13:00:00Z', '2026-03-25T16:00:00Z',
   2, '試作品の3Dプリント', 'provisional',
   'u-alpha-member', '2026-03-18T08:00:00Z', '2026-03-18T08:00:00Z'),

  ('r-05', 'g-beta', 'f-07',
   '2026-03-21T09:00:00Z', '2026-03-21T18:00:00Z',
   8, '合宿・集中開発', 'rejected',
   'u-beta-owner', '2026-03-12T09:00:00Z', '2026-03-13T10:00:00Z');

-- Update rejected reservation with reason
UPDATE reservations SET status_reason = '他団体との日程が重複するため', updated_at = '2026-03-13T10:00:00Z' WHERE id = 'r-05';

-- Sample messages
INSERT OR IGNORE INTO messages (id, reservation_id, sender_id, body, sent_at) VALUES
  ('msg-01', 'r-02', 'u-alpha-owner', '解錠コードを教えていただけますか？', '2026-03-17T10:00:00Z'),
  ('msg-02', 'r-02', 'u-staff', '承認後にメールにてお送りします。なお、当日は9時から開錠していますのでご安心ください。', '2026-03-17T11:00:00Z'),
  ('msg-03', 'r-01', 'u-staff', '承認しました。当日はスムーズな進行をお願いします。', '2026-03-11T10:00:00Z');
