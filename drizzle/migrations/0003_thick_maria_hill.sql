CREATE TABLE `facility` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`photo_url` text,
	`google_calendar_id` text,
	`calendar_url` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reservation` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`head_count` integer NOT NULL,
	`note` text,
	`status` text NOT NULL,
	`status_reason` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facility`(`id`) ON UPDATE no action ON DELETE no action
);
