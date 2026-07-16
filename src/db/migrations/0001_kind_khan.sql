ALTER TABLE `exercise` ADD `sets` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `exercise` ADD `rest_seconds` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
UPDATE `exercise` SET
  `sets` = (SELECT `ci`.`sets` FROM `circuit_item` `ci` WHERE `ci`.`exercise_id` = `exercise`.`id`),
  `rest_seconds` = (SELECT `ci`.`rest_seconds` FROM `circuit_item` `ci` WHERE `ci`.`exercise_id` = `exercise`.`id`)
WHERE `id` IN (SELECT `exercise_id` FROM `circuit_item`);--> statement-breakpoint
ALTER TABLE `circuit_item` DROP COLUMN `sets`;--> statement-breakpoint
ALTER TABLE `circuit_item` DROP COLUMN `rest_seconds`;
