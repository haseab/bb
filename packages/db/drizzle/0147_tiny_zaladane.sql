CREATE TABLE `native_session_links` (
	`host_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`provider_thread_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`active` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`host_id`, `provider_id`, `provider_thread_id`),
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_session_links_thread_idx` ON `native_session_links` (`thread_id`);--> statement-breakpoint
CREATE TABLE `native_session_turns` (
	`thread_id` text NOT NULL,
	`provider_turn_id` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`thread_id`, `provider_turn_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
