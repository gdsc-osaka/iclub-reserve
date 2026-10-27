--
-- 申請日時（INFO-001.requested_at）を足す。
--
-- SQLite で、行のある表に NOT NULL の列を足すには、定数の既定値が要る。
-- そこで既定値 0 を付けて足し、すぐに作成日時で埋める。既定値 0 は DB にだけ残り、
-- Drizzle のスキーマとスナップショットには無い。アプリは書き込むたびに値を渡す（渡し忘れは型エラーになる）。
--
-- 表を作り直す方式（新しい表を作って写し、古い表を DROP する）は使わない。
-- D1 では外部キーの確認を止められないので、DROP TABLE が行を消すときに ON DELETE CASCADE が働き、
-- 既読の記録（reservation_read）まで消える。
--
-- 既存の予約は、施設・日時を変えたことがあっても作成日時で埋める。本番はまだ動いておらず、
-- 操作履歴から過去の変更をたどって埋め直すほどのデータが無いため。
--
ALTER TABLE `reservation` ADD `requested_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `reservation` SET `requested_at` = `created_at`;
