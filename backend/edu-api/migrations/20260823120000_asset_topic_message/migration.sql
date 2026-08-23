ALTER TABLE `asset` ADD `topic_message_id` text REFERENCES `topic_message`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `asset` ADD `order_index` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `asset_topic_message_idx` ON `asset` (`topic_message_id`,`order_index`);
