PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `topic_message_new` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `topic_message_new` (`id`, `topic_id`, `role`, `parts`, `created_at`)
SELECT
	`id`,
	`topic_id`,
	`role`,
	CASE
		WHEN `type` = 'text' THEN json_array(json_object('type', 'text', 'content', json_extract(`content`, '$.text')))
		WHEN `type` = 'options' THEN json_array(json_object('type', 'options', 'options', json_extract(`content`, '$.options')))
		ELSE json_array(json_object('type', 'text', 'content', json(`content`)))
	END,
	`created_at`
FROM `topic_message`;
--> statement-breakpoint
DROP TABLE `topic_message`;
--> statement-breakpoint
ALTER TABLE `topic_message_new` RENAME TO `topic_message`;
--> statement-breakpoint
CREATE INDEX `topic_message_topic_idx` ON `topic_message` (`topic_id`,`created_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
