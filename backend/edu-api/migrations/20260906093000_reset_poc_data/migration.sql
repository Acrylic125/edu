-- The POC has no data compatibility requirement. Clear all application data
-- after adding the structured-plan columns so existing local/remote databases
-- start from the same empty state.
DELETE FROM model_usage;
--> statement-breakpoint
DELETE FROM agent_step;
--> statement-breakpoint
DELETE FROM agent_run;
--> statement-breakpoint
DELETE FROM conversation_memory;
--> statement-breakpoint
DELETE FROM asset;
--> statement-breakpoint
DELETE FROM topic_message;
--> statement-breakpoint
DELETE FROM user_current_topic;
--> statement-breakpoint
DELETE FROM topic;
--> statement-breakpoint
DELETE FROM account;
--> statement-breakpoint
DELETE FROM session;
--> statement-breakpoint
DELETE FROM verification;
--> statement-breakpoint
DELETE FROM user;
