DROP TABLE IF EXISTS `message_assets`;
--> statement-breakpoint
DROP TABLE IF EXISTS `run_steps`;
--> statement-breakpoint
DROP TABLE IF EXISTS `runs`;
--> statement-breakpoint
DROP TABLE IF EXISTS `messages`;
--> statement-breakpoint
DROP TABLE IF EXISTS `conversations`;
--> statement-breakpoint
DROP TABLE IF EXISTS `memories`;
--> statement-breakpoint
DROP TABLE IF EXISTS `assets`;
--> statement-breakpoint
CREATE TABLE `topic` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_current_topic` (
	`user_id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`part` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `topic_message` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`role` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_run` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`user_message_id` text NOT NULL,
	`intent` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_message_id`) REFERENCES `topic_message`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_step` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`input` text,
	`output` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `model_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`input_price_micros` integer,
	`output_price_micros` integer,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `agent_step`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`filename` text,
	`mime_type` text NOT NULL,
	`size` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topic_user_idx` ON `topic` (`user_id`);
--> statement-breakpoint
CREATE INDEX `topic_message_topic_idx` ON `topic_message` (`topic_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `agent_run_topic_idx` ON `agent_run` (`topic_id`);
--> statement-breakpoint
CREATE INDEX `agent_step_run_idx` ON `agent_step` (`run_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `model_usage_run_idx` ON `model_usage` (`run_id`);
--> statement-breakpoint
CREATE INDEX `asset_user_idx` ON `asset` (`user_id`);
