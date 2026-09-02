ALTER TABLE `groups` RENAME TO `group`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reservation` (
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
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facility`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_reservation`("id", "group_id", "facility_id", "start_at", "end_at", "head_count", "note", "status", "status_reason", "created_by", "created_at", "updated_at") SELECT "id", "group_id", "facility_id", "start_at", "end_at", "head_count", "note", "status", "status_reason", "created_by", "created_at", "updated_at" FROM `reservation`;--> statement-breakpoint
DROP TABLE `reservation`;--> statement-breakpoint
ALTER TABLE `__new_reservation` RENAME TO `reservation`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_membership` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text(100) NOT NULL,
	`user_id` text NOT NULL,
	`group_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_membership`("id", "name", "user_id", "group_id", "role", "created_at", "updated_at") SELECT "id", "name", "user_id", "group_id", "role", "created_at", "updated_at" FROM `membership`;--> statement-breakpoint
DROP TABLE `membership`;--> statement-breakpoint
ALTER TABLE `__new_membership` RENAME TO `membership`;