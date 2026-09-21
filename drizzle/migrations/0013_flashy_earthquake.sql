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
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facility`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_reservation`("id", "group_id", "facility_id", "start_at", "end_at", "head_count", "note", "status", "status_reason", "created_by", "created_at", "updated_at") SELECT "id", "group_id", "facility_id", "start_at", "end_at", "head_count", "note", "status", "status_reason", "created_by", "created_at", "updated_at" FROM `reservation`;--> statement-breakpoint
DROP TABLE `reservation`;--> statement-breakpoint
ALTER TABLE `__new_reservation` RENAME TO `reservation`;--> statement-breakpoint
PRAGMA foreign_keys=ON;