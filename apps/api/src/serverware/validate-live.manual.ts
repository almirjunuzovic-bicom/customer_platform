/**
 * Manual smoke test against a REAL ServerWare cluster (not an automated
 * test - needs real credentials in .env, hits live infrastructure). Run
 * with: pnpm --filter @hosting-platform/api validate:serverware
 */
import "reflect-metadata";
import "dotenv/config";
import { ServerwareService } from "./serverware.service";

async function main() {
  const clusterKey = process.argv[2] ?? "lon1";
  const svc = new ServerwareService();
  console.log("clusters configured:", svc.listClusterKeys());

  const hosts = await svc.listHosts(clusterKey);
  console.log(`hosts: ${hosts.length}`, hosts.slice(0, 2));

  const vpses = await svc.listVpses(clusterKey);
  console.log(`vpses: ${vpses.length}`, vpses.slice(0, 2));

  const partitions = await svc.listPartitions(clusterKey);
  console.log(`partitions: ${partitions.length}`, partitions);

  const leaksRootPassword = Object.keys(vpses[0] ?? {}).some((k) =>
    k.toLowerCase().includes("password"),
  );
  console.log("vps type leaks a password field:", leaksRootPassword);
}

main().catch((err) => {
  console.error("VALIDATION FAILED:", err);
  process.exit(1);
});
