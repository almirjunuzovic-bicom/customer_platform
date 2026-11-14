ALTER TABLE `partitions` ADD `crm_link` varchar(512);--> statement-breakpoint
ALTER TABLE `partitions` ADD `customer_id` varchar(32);--> statement-breakpoint
CREATE INDEX `partitions_customer_id_idx` ON `partitions` (`customer_id`);