-- Demo Users
INSERT OR IGNORE INTO users (id, email, name, is_staff) VALUES 
('usr_admin', 'admin@osaka-u.ac.jp', '事務局 太郎', 1),
('usr_student1', 'student1@osaka-u.ac.jp', '代表 学生A', 0),
('usr_student2', 'student2@osaka-u.ac.jp', 'メンバー 学生B', 0);

-- Demo Facilities
INSERT OR IGNORE INTO facilities (id, name, description, is_active) VALUES 
('fac_01', '吹田：C棟2階占有 イベント予約', 'イベント用の占有スペース', 1),
('fac_02', '吹田：3Dプリンター 積層タイプ', '高性能な3Dプリンター', 1),
('fac_03', '豊中試作室', '開発のための試作スペース', 1);

-- Demo Groups
INSERT OR IGNORE INTO groups (id, name, is_active) VALUES 
('grp_01', 'i-Squad 開発チーム', 1),
('grp_02', 'ロボットサークル', 1);

-- Demo Memberships
INSERT OR IGNORE INTO memberships (id, user_id, group_id, role) VALUES 
('mem_01', 'usr_student1', 'grp_01', 'owner'),
('mem_02', 'usr_student2', 'grp_01', 'member');

-- Demo Reservations
INSERT OR IGNORE INTO reservations (id, group_id, facility_id, start_at, end_at, headcount, note, status, created_by) VALUES
('res_01', 'grp_01', 'fac_01', '2026-03-20T10:00:00Z', '2026-03-20T12:00:00Z', 5, '全体ミーティング', 'approved', 'usr_student1'),
('res_02', 'grp_01', 'fac_02', '2026-03-21T14:00:00Z', '2026-03-21T16:00:00Z', 2, '外装パーツ出力', 'provisional', 'usr_student1');
