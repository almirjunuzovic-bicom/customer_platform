CREATE TABLE `vps_metrics_rollup` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`vps_inventory_id` int NOT NULL,
	`bucket_seconds` int NOT NULL,
	`bucket_start` timestamp NOT NULL,
	`cpu_usage_avg` float,
	`cpu_usage_max` float,
	`cpu_usage_min` float,
	`mem_usage_avg` float,
	`mem_usage_max` float,
	`mem_usage_min` float,
	`disk_usage_avg` float,
	`disk_usage_max` float,
	`disk_usage_min` float,
	`cc_count_avg` float,
	`uptime_seconds_max` bigint,
	CONSTRAINT `vps_metrics_rollup_id` PRIMARY KEY(`id`),
	CONSTRAINT `vps_metrics_rollup_vps_bucket_uq` UNIQUE(`vps_inventory_id`,`bucket_seconds`,`bucket_start`)
);
--> statement-breakpoint
ALTER TABLE `vps_metrics_rollup` ADD CONSTRAINT `vps_metrics_rollup_vps_inventory_id_vps_inventory_id_fk` FOREIGN KEY (`vps_inventory_id`) REFERENCES `vps_inventory`(`id`) ON DELETE no action ON UPDATE no action;