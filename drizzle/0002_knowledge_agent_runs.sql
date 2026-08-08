CREATE TABLE `knowledge_agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_run_id` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`goal` text NOT NULL,
	`audience` text,
	`granularity` integer,
	`note_count` integer NOT NULL,
	`input_json` text NOT NULL,
	`result_json` text,
	`error_code` text,
	`error_message` text,
	`error_retryable` integer,
	`concept_count` integer,
	`relation_count` integer,
	`evidence_count` integer,
	`duration_ms` integer,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_agent_runs_created_at` ON `knowledge_agent_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_agent_runs_status_created_at` ON `knowledge_agent_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_agent_runs_parent` ON `knowledge_agent_runs` (`parent_run_id`);
