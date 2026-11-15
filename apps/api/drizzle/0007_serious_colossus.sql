ALTER TABLE `clusters` ADD `connector_type` varchar(32) DEFAULT 'serverware' NOT NULL;--> statement-breakpoint
ALTER TABLE `clusters` ADD `enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `clusters` ADD `config` json;--> statement-breakpoint
ALTER TABLE `clusters` ADD `credentials_encrypted` text;--> statement-breakpoint
ALTER TABLE `clusters` ADD `created_at` timestamp DEFAULT (now()) NOT NULL;