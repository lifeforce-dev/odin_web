ALTER TABLE `session` ADD `outcome` text CONSTRAINT "session_outcome_check" CHECK("outcome" IN ('completed', 'abandoned'));--> statement-breakpoint
UPDATE `session` SET `outcome` = 'completed' WHERE `ended_at` IS NOT NULL;
