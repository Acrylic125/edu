CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`filename` text,
	`mime_type` text NOT NULL,
	`size` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_assets_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_conversations_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`vector_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_memories_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `message_assets` (
	`message_id` text NOT NULL,
	`asset_id` text NOT NULL,
	CONSTRAINT `fk_message_assets_message_id_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`),
	CONSTRAINT `fk_message_assets_asset_id_assets_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_messages_conversation_id_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `run_steps` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`type` text NOT NULL,
	`sequence` integer NOT NULL,
	`tool_name` text,
	`input` text,
	`output` text,
	`error` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_run_steps_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY,
	`conversation_id` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`started_at` integer,
	`completed_at` integer,
	`error` text,
	`metadata` text,
	CONSTRAINT `fk_runs_conversation_id_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	CONSTRAINT `fk_session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `asset_user_idx` ON `assets` (`user_id`);--> statement-breakpoint
CREATE INDEX `conversation_user_idx` ON `conversations` (`user_id`);--> statement-breakpoint
CREATE INDEX `memory_user_idx` ON `memories` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_asset_unique` ON `message_assets` (`message_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `message_conversation_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `run_step_run_idx` ON `run_steps` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `run_conversation_idx` ON `runs` (`conversation_id`);