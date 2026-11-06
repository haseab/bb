DROP INDEX `project_sources_project_host_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `project_sources_project_host_path_idx` ON `project_sources` (`project_id`,`host_id`,`path`);