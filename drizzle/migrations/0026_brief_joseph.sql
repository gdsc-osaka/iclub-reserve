CREATE INDEX `reservation_message_sent_at_idx` ON `reservation_message` (`sent_at`);--> statement-breakpoint
CREATE INDEX `reservation_facility_status_end_at_idx` ON `reservation` (`facility_id`,`status`,`end_at`);--> statement-breakpoint
CREATE INDEX `reservation_status_end_at_idx` ON `reservation` (`status`,`end_at`);--> statement-breakpoint
CREATE INDEX `reservation_group_end_at_idx` ON `reservation` (`group_id`,`end_at`);--> statement-breakpoint
-- 索引を作ったら統計を取り直す（Cloudflare D1 の勧め）。統計が無いと、SQLite が絞り込みの効かない索引を選ぶことがある。
PRAGMA optimize;