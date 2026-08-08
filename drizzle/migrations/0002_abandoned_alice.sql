CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text(100) NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
