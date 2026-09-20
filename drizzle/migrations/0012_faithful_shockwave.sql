CREATE TABLE `mail_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`to_address` text NOT NULL,
	`to_name` text,
	`subject` text NOT NULL,
	`body_text` text NOT NULL,
	`body_html` text,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_outbox_idempotency_key_unique` ON `mail_outbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `mail_outbox_due_idx` ON `mail_outbox` (`status`,`next_attempt_at`);