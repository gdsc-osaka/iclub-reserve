CREATE TABLE `passkey_last_used` (
	`passkey_id` text PRIMARY KEY NOT NULL,
	`last_used_at` integer NOT NULL,
	FOREIGN KEY (`passkey_id`) REFERENCES `passkey`(`id`) ON UPDATE no action ON DELETE cascade
);
