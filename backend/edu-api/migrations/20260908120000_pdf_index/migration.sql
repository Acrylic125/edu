CREATE TABLE `pdf_document` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`page_count` integer,
	`indexed_pages` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pdf_document_user_idx` ON `pdf_document` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `pdf_page` (
	`asset_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`storage_key` text NOT NULL,
	`preview` text NOT NULL,
	`search_text` text NOT NULL,
	`char_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pdf_page_asset_page_uidx` ON `pdf_page` (`asset_id`,`page_number`);
--> statement-breakpoint
CREATE INDEX `pdf_page_asset_idx` ON `pdf_page` (`asset_id`,`page_number`);
