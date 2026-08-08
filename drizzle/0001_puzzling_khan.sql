CREATE TABLE `concept_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`map_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`action` text NOT NULL,
	`proposed_value` text,
	`reason` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_concept_corrections_map_status` ON `concept_corrections` (`map_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_concept_corrections_concept` ON `concept_corrections` (`concept_id`);--> statement-breakpoint
CREATE TABLE `discovery_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`response_json` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_discovery_cache_expires_at` ON `discovery_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `knowledge_maps` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_map_id` text,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`goal` text NOT NULL,
	`audience` text NOT NULL,
	`granularity` integer NOT NULL,
	`expansion_radius` integer NOT NULL,
	`max_nodes` integer NOT NULL,
	`confidence_threshold` real NOT NULL,
	`seed_note_id` text,
	`revision_reason` text,
	`snapshot_json` text NOT NULL,
	`scope_version` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`frozen_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_maps_created_at` ON `knowledge_maps` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_maps_parent_version` ON `knowledge_maps` (`parent_map_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_maps_status` ON `knowledge_maps` (`status`);--> statement-breakpoint
CREATE TABLE `mastery_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`map_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`evidence_type` text NOT NULL,
	`score` real NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mastery_evidence_map_concept` ON `mastery_evidence` (`map_id`,`concept_id`);--> statement-breakpoint
CREATE INDEX `idx_mastery_evidence_created_at` ON `mastery_evidence` (`created_at`);--> statement-breakpoint
CREATE TABLE `note_analysis_cache` (
	`note_id` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`analyzer_version` text NOT NULL,
	`evidence_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_note_analysis_cache_hash_version` ON `note_analysis_cache` (`content_hash`,`analyzer_version`);