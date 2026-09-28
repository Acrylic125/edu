CREATE TABLE `topic_document` (
  `topic_id` text PRIMARY KEY NOT NULL REFERENCES `topic`(`id`) ON DELETE CASCADE,
  `markdown` text NOT NULL DEFAULT '',
  `updated_at` integer NOT NULL
);
