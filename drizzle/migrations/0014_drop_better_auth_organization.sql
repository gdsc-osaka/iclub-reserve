-- Better Auth の組織プラグインをやめ、団体管理を自前のテーブルに戻す (ADR-003)。
--
-- 本番 D1 に団体のデータは無く、プレビューとローカルはシードのみのため、データ移行はしない。
-- SQLite の ALTER TABLE ... RENAME TO は、他のテーブルの外部キー参照
-- (reservation.group_id) も自動で書き換えるので、reservation 側を作り直す必要は無い。
DROP INDEX `organization_slug_unique`;--> statement-breakpoint
ALTER TABLE `organization` RENAME TO `group`;--> statement-breakpoint
ALTER TABLE `group` DROP COLUMN `slug`;--> statement-breakpoint
ALTER TABLE `group` DROP COLUMN `logo`;--> statement-breakpoint
ALTER TABLE `group` DROP COLUMN `metadata`;--> statement-breakpoint
-- 索引は改名できないため、いったん落としてから名前を付け直す。
-- (group_id, user_id) の UNIQUE 索引が group_id 単独の検索も兼ねるので、
-- もとの member_organizationId_idx に相当する索引は作らない。
DROP INDEX `member_organizationId_idx`;--> statement-breakpoint
DROP INDEX `member_userId_idx`;--> statement-breakpoint
ALTER TABLE `member` RENAME TO `group_member`;--> statement-breakpoint
ALTER TABLE `group_member` RENAME COLUMN `organization_id` TO `group_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `group_member_groupId_userId_unique` ON `group_member` (`group_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `group_member_userId_idx` ON `group_member` (`user_id`);--> statement-breakpoint
-- 招待は role を NOT NULL にするため作り直す (SQLite は列の NULL 可否を後から変えられない)。
-- 承諾待ちの招待は検証用の行しか無く、48 時間で期限切れになるため捨ててよい。
DROP TABLE `invitation`;--> statement-breakpoint
CREATE TABLE `group_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_invitation_groupId_idx` ON `group_invitation` (`group_id`);--> statement-breakpoint
CREATE INDEX `group_invitation_email_idx` ON `group_invitation` (`email`);--> statement-breakpoint
-- 「現在の団体」を持つ設計を採っていないため、組織プラグインと一緒に落とす。
ALTER TABLE `session` DROP COLUMN `active_organization_id`;
