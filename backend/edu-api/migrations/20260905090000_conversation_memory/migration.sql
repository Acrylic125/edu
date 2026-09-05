CREATE TABLE `conversation_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`topic_id` text,
	`user_message_id` text NOT NULL,
	`agent_message_id` text NOT NULL,
	`intent` text,
	`summary` text NOT NULL,
	`keywords` text NOT NULL,
	`image_asset_ids` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_memory_user_message_uidx` ON `conversation_memory` (`user_message_id`);
--> statement-breakpoint
CREATE INDEX `conversation_memory_user_created_idx` ON `conversation_memory` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `conversation_memory_user_topic_created_idx` ON `conversation_memory` (`user_id`,`topic_id`,`created_at`);
