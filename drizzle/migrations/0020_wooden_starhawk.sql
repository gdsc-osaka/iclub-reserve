CREATE TABLE `calendar_sync_task` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reservation_id` text NOT NULL,
	`previous_facility_id` text,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `calendar_sync_task_due_idx` ON `calendar_sync_task` (`status`,`next_attempt_at`);