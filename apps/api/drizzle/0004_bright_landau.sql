ALTER TABLE `vps_inventory` ADD `task` varchar(32);--> statement-breakpoint
ALTER TABLE `vps_inventory` ADD `pending_action` varchar(16);--> statement-breakpoint
ALTER TABLE `vps_inventory` ADD `pending_action_at` timestamp;