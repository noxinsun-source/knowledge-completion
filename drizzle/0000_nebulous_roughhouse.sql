CREATE TABLE `atlas_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`captured_at` text NOT NULL,
	`confidence` real DEFAULT 0.8 NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_atlas_notes_content_hash` ON `atlas_notes` (`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_atlas_notes_captured_at` ON `atlas_notes` (`captured_at`);