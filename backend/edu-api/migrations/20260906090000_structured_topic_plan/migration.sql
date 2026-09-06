ALTER TABLE `topic` ADD COLUMN `plan` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `user_current_topic` ADD COLUMN `current_step_id` text;
