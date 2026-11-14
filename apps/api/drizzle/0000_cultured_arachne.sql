CREATE TABLE `clusters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`base_url` varchar(256) NOT NULL,
	`serverware_net_id` int NOT NULL DEFAULT 1,
	`last_sync_at` timestamp,
	`last_sync_ok` boolean,
	`last_sync_error` text,
	CONSTRAINT `clusters_id` PRIMARY KEY(`id`),
	CONSTRAINT `clusters_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `hosts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cluster_id` int NOT NULL,
	`serverware_host_id` int NOT NULL,
	`uuid` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`purpose` varchar(32),
	`state` varchar(32),
	`online` boolean,
	`connected` boolean,
	`cpu_usage` float,
	`mem_usage` float,
	`mem_total` bigint,
	`vps_count` int,
	`vps_running` int,
	`last_synced_at` timestamp NOT NULL,
	CONSTRAINT `hosts_id` PRIMARY KEY(`id`),
	CONSTRAINT `hosts_cluster_serverware_id_uq` UNIQUE(`cluster_id`,`serverware_host_id`)
);
--> statement-breakpoint
CREATE TABLE `partitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cluster_id` int NOT NULL,
	`serverware_partition_id` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`company` varchar(256),
	`vps_quota` int,
	`vps_usage` int,
	`last_synced_at` timestamp NOT NULL,
	CONSTRAINT `partitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `partitions_cluster_serverware_id_uq` UNIQUE(`cluster_id`,`serverware_partition_id`)
);
--> statement-breakpoint
CREATE TABLE `vps_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`vps_inventory_id` int NOT NULL,
	`event_type` enum('state_changed','host_changed','partition_changed','resource_changed','created','removed','action_requested') NOT NULL,
	`previous_value` varchar(256),
	`new_value` varchar(256),
	`detected_at` timestamp NOT NULL,
	`source` enum('poll_detected','platform_action') NOT NULL,
	`actor_user_id` int,
	`metadata` json,
	CONSTRAINT `vps_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vps_inventory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cluster_id` int NOT NULL,
	`serverware_vps_id` int NOT NULL,
	`uuid` varchar(64) NOT NULL,
	`host_id` int,
	`partition_id` int,
	`name` varchar(128) NOT NULL,
	`engine` varchar(16),
	`last_known_state` varchar(32),
	`pbxware_version` varchar(32),
	`mem_limit` int,
	`cpu_limit` int,
	`cpu_share` int,
	`io_limit` bigint,
	`disk_state` varchar(16),
	`ip_addresses` json,
	`collect_metrics` boolean NOT NULL DEFAULT false,
	`is_removed` boolean NOT NULL DEFAULT false,
	`last_synced_at` timestamp NOT NULL,
	CONSTRAINT `vps_inventory_id` PRIMARY KEY(`id`),
	CONSTRAINT `vps_inventory_uuid_unique` UNIQUE(`uuid`),
	CONSTRAINT `vps_inventory_cluster_serverware_id_uq` UNIQUE(`cluster_id`,`serverware_vps_id`)
);
--> statement-breakpoint
CREATE TABLE `vps_metrics_history` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`vps_inventory_id` int NOT NULL,
	`captured_at` timestamp NOT NULL,
	`state` varchar(32) NOT NULL,
	`cpu_usage` float,
	`mem_usage` float,
	`disk_usage` float,
	`cc_count` int,
	`uptime_seconds` bigint,
	CONSTRAINT `vps_metrics_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `hosts` ADD CONSTRAINT `hosts_cluster_id_clusters_id_fk` FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `partitions` ADD CONSTRAINT `partitions_cluster_id_clusters_id_fk` FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vps_events` ADD CONSTRAINT `vps_events_vps_inventory_id_vps_inventory_id_fk` FOREIGN KEY (`vps_inventory_id`) REFERENCES `vps_inventory`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vps_inventory` ADD CONSTRAINT `vps_inventory_cluster_id_clusters_id_fk` FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vps_inventory` ADD CONSTRAINT `vps_inventory_host_id_hosts_id_fk` FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vps_inventory` ADD CONSTRAINT `vps_inventory_partition_id_partitions_id_fk` FOREIGN KEY (`partition_id`) REFERENCES `partitions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vps_metrics_history` ADD CONSTRAINT `vps_metrics_history_vps_inventory_id_vps_inventory_id_fk` FOREIGN KEY (`vps_inventory_id`) REFERENCES `vps_inventory`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `vps_events_vps_detected_idx` ON `vps_events` (`vps_inventory_id`,`detected_at`);--> statement-breakpoint
CREATE INDEX `vps_inventory_partition_idx` ON `vps_inventory` (`partition_id`);--> statement-breakpoint
CREATE INDEX `vps_metrics_history_vps_captured_idx` ON `vps_metrics_history` (`vps_inventory_id`,`captured_at`);