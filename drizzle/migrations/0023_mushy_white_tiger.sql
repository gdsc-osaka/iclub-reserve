CREATE TABLE `group_calendar_feed` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `group_member`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_calendar_feed_membership_id_unique` ON `group_calendar_feed` (`membership_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `group_calendar_feed_token_unique` ON `group_calendar_feed` (`token`);