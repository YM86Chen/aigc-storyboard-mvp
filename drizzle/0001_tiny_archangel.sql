CREATE TABLE `generation_limits` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`last_started_at` integer NOT NULL,
	`lease_expires_at` integer NOT NULL
);
