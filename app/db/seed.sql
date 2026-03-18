-- 初期施設データ（PRD 3-5. 施設管理 初期施設・設備より）
INSERT INTO facilities (id, name, description, is_active, created_at, updated_at) VALUES
  ('fac01', '吹田：C棟2階占有 イベント予約', 'C棟2階の占有スペース。イベント利用向け。', 1, datetime('now'), datetime('now')),
  ('fac02', '吹田：3Dプリンター 積層タイプ', 'FDM方式 3Dプリンター', 1, datetime('now'), datetime('now')),
  ('fac03', '吹田：3Dプリンター 積層タイプ2', 'FDM方式 3Dプリンター（2号機）', 1, datetime('now'), datetime('now')),
  ('fac04', '吹田：3Dプリンター 光造形機', 'SLA方式 3Dプリンター', 1, datetime('now'), datetime('now')),
  ('fac05', '吹田：レーザーカッター', 'レーザーカッター', 1, datetime('now'), datetime('now')),
  ('fac06', '吹田：CAD用パソコン', 'CAD専用パソコン', 1, datetime('now'), datetime('now')),
  ('fac07', '豊中試作室', '豊中キャンパス 試作室', 1, datetime('now'), datetime('now')),
  ('fac08', '豊中試作室：3Dプリンター', '豊中試作室の3Dプリンター', 1, datetime('now'), datetime('now'));
