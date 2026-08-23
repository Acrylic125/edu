ALTER TABLE `account` ADD `issuer` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_account_id_uidx` ON `account` (`issuer`, `account_id`);
