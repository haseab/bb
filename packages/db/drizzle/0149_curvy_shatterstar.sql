ALTER TABLE `threads` ADD `creation_source` text DEFAULT 'bb' NOT NULL;
--> statement-breakpoint
UPDATE threads SET creation_source = 'native'
WHERE id IN (SELECT thread_id FROM native_session_links)
  AND (SELECT type FROM events WHERE thread_id = threads.id ORDER BY sequence LIMIT 1) = 'thread/identity';
