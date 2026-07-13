CREATE TABLE `circuit` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`rotation_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	CONSTRAINT "circuit_kind_check" CHECK("circuit"."kind" IN ('workout', 'stretch'))
);
--> statement-breakpoint
CREATE INDEX `circuit_kind_rotation_idx` ON `circuit` (`kind`,`rotation_order`);--> statement-breakpoint
CREATE TABLE `circuit_item` (
	`id` text PRIMARY KEY NOT NULL,
	`circuit_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`sets` integer NOT NULL,
	`rest_seconds` integer NOT NULL,
	FOREIGN KEY (`circuit_id`) REFERENCES `circuit`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `circuit_item_exercise_unique` ON `circuit_item` (`exercise_id`);--> statement-breakpoint
CREATE INDEX `circuit_item_circuit_position_idx` ON `circuit_item` (`circuit_id`,`position`);--> statement-breakpoint
CREATE TABLE `exercise` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	CONSTRAINT "exercise_kind_check" CHECK("exercise"."kind" IN ('workout', 'stretch')),
	CONSTRAINT "exercise_name_not_blank_check" CHECK(length(trim("exercise"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_active_name_unique` ON `exercise` (lower("name")) WHERE "exercise"."archived_at" IS NULL;--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`circuit_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`circuit_id`) REFERENCES `circuit`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `session_started_idx` ON `session` (`started_at`);--> statement-breakpoint
CREATE TABLE `set_log` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`set_index` integer NOT NULL,
	`reps` integer NOT NULL,
	`weight` real NOT NULL,
	`weight_unit` text NOT NULL,
	`logged_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "set_log_weight_unit_check" CHECK("set_log"."weight_unit" IN ('lb', 'kg'))
);
--> statement-breakpoint
CREATE INDEX `set_log_exercise_logged_idx` ON `set_log` (`exercise_id`,`logged_at`);--> statement-breakpoint
CREATE INDEX `set_log_session_idx` ON `set_log` (`session_id`);