CREATE TABLE `notebooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `notes` ADD `notebookId` integer REFERENCES notebooks(id);