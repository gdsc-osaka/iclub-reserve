CREATE TABLE `reservation_message` (
	`id` text PRIMARY KEY NOT NULL,
	`reservation_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`sent_as_staff` integer NOT NULL,
	`body` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reservation_message_reservation_sent_at_idx` ON `reservation_message` (`reservation_id`,`sent_at`);