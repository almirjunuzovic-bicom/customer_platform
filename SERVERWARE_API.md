# ServerWare API — Integration Reference

This document exists to help an AI coding agent (or a human developer) work on this
platform's integration with **ServerWare** (the hosting/VPS management system that is
the actual source of truth for infrastructure state) without re-deriving or guessing
how that API behaves.

It was compiled from: (1) prior hands-on testing against live ServerWare clusters
(see "Confidence levels" below), and (2) a direct read of the `sw-wcp` Go source
(ServerWare's own API server implementation). It is **not** official ServerWare
vendor documentation. Where this document and the official docs disagree, the
official docs win — and several sections below explicitly say "verify live" for
exactly that reason.

## 0. Ground rules for this project

These come from this project's own definition docs and apply regardless of what the
API technically allows:

- **ServerWare is the source of truth.** This platform is a read-oriented overview/
  control layer on top of it, never a replacement. Never assume a VPS's state
  changed just because this platform sent an API call — confirm it by reading
  state back.
- **Do not invent endpoints, payloads, or status values.** Everything in this doc
  that isn't explicitly marked "confirmed live" should be treated as "believed
  correct from source code, not yet re-verified against this project's actual
  clusters" — check against a real request before depending on it in production
  code.
- **Read-only until separately approved.** Any VPS/partition/user *write* operation
  (start/stop/restart, create/delete, etc.) requires explicit sign-off beyond the
  initial integration scope. Build and test against read endpoints first.
- **One cluster ≠ all clusters.** There is no central ServerWare management API.
  Each cluster (e.g. London, Cork, Chicago, Las Vegas) is a separate deployment with
  its own base URL, its own issued credentials, and potentially a different
  ServerWare version — meaning subtly different endpoint behavior (see §7,
  I/O-limit units). Build per-cluster adapters that fail independently; one
  cluster's outage must not block syncing the others.
- **Failed API call → "Unknown/stale", never silently "Stopped".** Map ServerWare's
  actual returned state values explicitly; do not infer state from the absence of a
  response.
- **Partner ↔ VPS mapping is explicit, never inferred.** Which VPS belongs to which
  partner/customer is a mapping table this platform owns — never derived from VPS
  name, email domain, or other heuristics.
- **Secrets never touch code, prompts, CLAUDE.md, git, logs, or the frontend
  bundle.** API tokens live only in an approved secrets manager, encrypted at rest,
  masked in any UI. The frontend never calls ServerWare directly — only this
  platform's own backend does, and backend permission checks are the only real
  security boundary (never rely on frontend hiding).
- **Mock first.** Until real per-cluster credentials and the read-only integration
  are approved, build and test against mock adapters that mimic the shapes
  documented below.

## 1. Two separate services — target `sw-wcp`, not `sw-mgr`

The ServerWare codebase actually runs two HTTP API surfaces:

- **`sw-wcp`** — the public-facing REST API. **This is what this platform should
  integrate with.** All endpoints in §5 below are `sw-wcp` endpoints.
- **`sw-mgr`** — an internal service for geo-replication/takeover/backup/bulk
  operations between ServerWare cluster nodes. It has its own `SW-API-Token`
  middleware, but that token type authenticates **cluster host UUIDs** (node-to-node
  trust), not user API keys — it is not reachable or usable the way a user API key
  is. However, a useful subset of `sw-mgr` functionality (geo-replication, takeover
  templates, backups, bulk ops, DNS zones, maintenance) is **reverse-proxied through
  `sw-wcp`** under specific path prefixes: `/api/grs`, `/api/takeover-templates`,
  `/api/site-monitor`, `/api/backups`, `/api/maintenance`, `/api/bulk`,
  `/api/vps-volumes*`, and DNS-zone paths. Those proxied routes *do* accept a normal
  user API key, subject to the same permission model as everything else.

## 2. Authentication

Header: **`SW-API-Token: <token>`**

- The HTTP layer is case-insensitive on header names, so `SW-API-Token`,
  `SW-API-TOKEN`, etc. are equivalent. Do **not** use `Bearer <token>` or a header
  literally named `SW-Auth-Token` for an API key — `SW-Auth-Token` is the *session
  login* token used by the web UI, a different credential type. (A
  `www-authenticate` response header may mention `SW-Auth-Token realm=sw-wcp`; this
  refers to the session mechanism, not the API key mechanism — this has caused
  confusion before.)
- Exactly one of `SW-Auth-Token` or `SW-API-Token` must be present per request
  (sending both, or neither, is rejected with 401).
- **Important behavioral detail:** an API key is not a stateless bypass. On first
  use, the server hashes it (SHA-256), looks it up, and transparently creates a
  real logged-in session for the token's owning user if one doesn't already exist.
  **This means an API token inherits the full permission set of whatever user
  generated it** — role (`ADMIN` / `PARTITION_ADMIN` / `PARTITION_MEMBER`) and
  partition membership included.

### Practical consequence for this platform

If this platform needs to read across **all** partitions/hosts/clusters (which the
project's stated scope implies — internal "Hosting Team" visibility spans
everything), **the API token must be generated by a user holding the system
`ADMIN` role** on each cluster. A token generated by a `PARTITION_ADMIN` or
`PARTITION_MEMBER` user will only see that partition's data and will get `403` on
everything else. This is a per-cluster decision since each cluster has its own user
database — confirm the admin-role user exists on each cluster before provisioning
tokens.

### Token lifecycle (for anyone who needs to generate/manage tokens, not for this
platform to call programmatically against itself)

- Routes (require being logged in as the token's own user — `OWNER` permission,
  cannot be done via another API key): `GET/POST/DELETE /api/users/:userid/api-tokens`,
  `GET/DELETE /api/users/:userid/api-tokens/:tokenid`.
- Format: prefix `srw_`, 128 characters total.
- Max 10 tokens per user.
- Stored hashed server-side; the raw token value is returned **only once**, in the
  `POST` creation response — it cannot be retrieved again, only revoked
  (`DELETE`) and re-created.
- No scopes and no expiry field exist on the token model — access control is
  entirely inherited from the owning user's role/permissions, and the only
  lifecycle control is deletion.

## 3. Response conventions

- **Success envelope:** `{"status": "success", "data": <payload>}` — consistent
  across the API.
- **Error shape:** believed to be `{"Error": "<message>"}` with a non-2xx HTTP
  status code (this comes from the underlying `go-json-rest` library's default
  error helper, not independently confirmed against a live failing request in this
  codebase scan) — **verify this against one real 4xx/5xx response before writing
  error-handling code that parses a specific field name.**
- **No universal pagination.** Most list endpoints return the full result set.
  Some have ad-hoc filter/limit query params instead of offset/limit paging, e.g.:
  - `triggered-alarms` / `audit-logs`: `?start=&end=` (time range), plus entity
    filters like `?severityFilter`, `?hostFilter`, `?vpsFilter`,
    `?partitionFilter`, `?user=`, `?action=`, `?entity=`, `?unackedonly=true`
  - `vpses` list: `?state=removed`, `?download=csv`
  - `audit-logs`: `?limit=`
  - There is no guarantee every resource behaves this way — check per-endpoint.
  - **Before relying on any list endpoint for bulk sync, test its behavior/response
    size on a cluster with thousands of rows** (VPS lists, audit logs, syslogs can
    be large) — this was not verified against production data volumes.
- **Naming note:** the database and Go code call the tenant/customer entity
  "Domain", but every HTTP route and every JSON field uses **"partition"**
  instead (`/api/networks/:netid/partitions`, `partition_id`, etc.). If you ever
  read ServerWare source code directly, "Domain" and "partition" are the same
  thing.

## 4. Permission model

- Role tiers (assigned per user, system-wide): `ADMIN`, `PARTITION_ADMIN`,
  `PARTITION_MEMBER`.
- Pseudo-permissions used by specific routes: `LOGGED_IN_USER` (any authenticated
  caller), `OWNER` (caller's user ID must equal the `:userid` in the path), and an
  empty-string requirement meaning system-admin-only.
- Granular, per-partition-evaluated grants exist beyond the coarse role, e.g.:
  `GENERAL:MNG_MEMBERS`, `GENERAL:VIEW_DASHBOARD`, `GENERAL:VIEW_STATS`,
  `VPS:VIEW`, `VPS:CREATE`, `VPS:EDIT`, `VPS:DELETE`, `VPS:START`, `VPS:STOP`,
  `VPS:FREEZE`, `VPS:COPY`, `VPS:MNG_OTHERS`.
- A user with the system `ADMIN` role bypasses all of the above checks entirely —
  this is what a cross-cluster read-everything integration token should use (see
  §2).

## 5. Endpoint inventory

All paths are relative to the cluster's `sw-wcp` base URL, under `/api`. `:netid`
is `1` in every single-network deployment seen so far, but don't hardcode that
assumption — read `GET /networks` first if a cluster might have more than one.

Endpoints marked **(proxied)** are physically served by `sw-mgr` but reachable
through `sw-wcp` with a normal API key, per §1.

### Networks
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/networks` | list / create |
| GET, PUT, DELETE | `/networks/:netid` | |

### Hosts
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/networks/:netid/hosts` | list / create |
| GET, PUT, DELETE | `/networks/:netid/hosts/:hostid` | |
| GET | `/networks/:netid/hosts/:hostid/evacuated-vpss` | |
| POST | `/networks/:netid/hosts/:hostid/enable`, `/disable`, `/swupdate` | |
| GET | `/discovered-hosts` | |
| GET | `/networks/:netid/hosts-non-dynamic/:hostid` | |
| GET, PUT | `/networks/:netid/hosts/:hostid/interfaces[/:ifid]` | NIC config |
| GET | `/networks/:netid/hosts/:hostid/*-stats` | time series: `cpu`, `iowait`, `load`, `mem`, `swap`, `ccc`, `netrx`, `nettx`, `pool_usage`, plus `rtm` |

**Host model fields** (`HostEx`): `id, uuid, net_id, name, purpose, storage_location,
mirror_id, pool_id, hostname, ip_address, port, repl_api_port, state, enabled,
skip_updates, use_central_syslog, use_local_dns, bw_limit,
unlimited_iops_minutes, description` + dynamic: `online, connected,
man_established, storage_available, storage_health, sw_outdated, uptime,
cpu_usage, io_wait, mem_usage, disk_usage, cc_count, cpu_temp` + `mem_total,
vps_count, vps_running, platform_details`.

### VPS instances
Available both under `/networks/:netid/vpses...` and
`/partitions/:partitionid/vpses...`.

| Method | Path | Notes |
|---|---|---|
| GET, POST | `.../vpses` | list (`?state=removed`, `?download=csv`) / create |
| HEAD | `/networks/:netid/vpses` | existence check |
| GET, PUT, DELETE | `.../vpses/:vpsid` | |
| GET | `.../vpses/:vpsid/backups` | |
| GET | `.../vpses/:vpsid/available-os-updates` | |
| GET | `.../vpses/:vpsid/licence` | |
| POST | `.../vpses/:vpsid/backup-enable`, `/backup-disable`, `/update-os`, `/migrate`, `/start`, `/stop`, `/restart`, `/freeze`, `/unfreeze`, `/extend`, `/shrink`, `/fstrim`, `/cancelfstrim`, `/chghost`, `/chgdomain`, `/chgowner`, `/chgstorproto` | **write ops — gated by project policy, not yet approved for use** |
| GET, PUT | `.../vpses/:vpsid/interfaces[/:ifid]` | + `HEAD .../check-ipv6`, `/check-mac` |
| GET | `.../vpses/:vpsid/<metric>_stats` | **exact suffix uses underscore, not hyphen**: `cpu_stats, iowait_stats, mem_stats, shmem_stats, swap_stats, ccc_stats, netrx_stats, nettx_stats, diskread_stats, diskwrite_stats, diskreadiops_stats, diskwriteiops_stats, disk_usage_stats, volume_stats` — each needs `?start=<unix sec>&end=<unix sec>` (max span 3 months, else 400) |
| GET | `.../vpses/:vpsid/rtm` | latest snapshot (cpu/mem/swap/cc_count) — **no query params** |
| GET | `.../vpses/:vpsid/top_cpu_proc`, `/top_mem_proc` | `?time=<unix MILLISECONDS>` — must match one exact stored sample timestamp, not a range |
| GET/POST | `.../vpses/:vpsid/dns` (A/CNAME) and `/dns-srv` (SRV) | |
| GET | `/networks\|partitions/.../vps-backups` | list only |
| — | `/vps-volumes*`, `/vps-volume-snapshots*` | **(proxied)** |

**VPS model fields** (`VPSEx`): `id, uuid, host_id, partition_id, user_id,
service_type_id, flavor_id, engine, name, description, state, task, autostart,
highly_available, backup, protected, mem_limit, cpu_share, cpu_limit, io_limit,
read_iops_limit, write_iops_limit, astdb_ram_mb, callrec_ram_mb, created_at,
removed_at, volume_size, tmp_size, run_size, root_password, registry_id,
collect_metrics, template_data, pbxware_version` + dynamic: `curr_state,
previous_state, cpu_usage, mem_usage, disk_usage, disk_state, cc_count,
last_repl_state, licence_no` + `domain_name, host_name, host_ip, up_down_time,
ip_addresses[]`.

Note: `mem_limit`/`disk_usage`/etc. here are the **allocated spec**, separate from
the dynamic `*_usage` fields which are **actual current usage** — the project docs
explicitly require these be shown as distinct values, never conflated.

### Partitions (= "Domain" in the Go/DB layer, see §3)
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/networks/:netid/partitions` | list / create |
| GET, PUT, DELETE | `/networks/:netid/partitions/:partitionid` | |
| GET | `/users/:userid/partitions[/:partitionid]` | partitions a user belongs to |
| GET | `/partitions/:partitionid/dashboard[/ccc_stats]` | |

**Partition model fields** (`DomainEx`): `id, uuid, net_id, name, storage_pool_id,
dataset, company, crm_link, vps_quota, stor_quota, mem_quota, user_quota` +
`vps_usage, stor_usage, mem_usage, cc_count`.

### Network-wide dashboard
`GET /networks/:netid/dashboard` plus sub-metrics: `rtm, cpu_stats, iowait_stats,
mem_stats, swap_stats, netrx_stats, nettx_stats, ccc_stats, top_cpu_vpses,
top_diskio_vpses, top_ccc_vpses, vps-call-stats`.

### Users
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/users` | + `HEAD /users?email=` |
| GET, PUT, DELETE | `/users/:userid` | |
| POST | `/users/:userid/upgrade-role`, `/downgrade-role`, `/change-password` | |
| GET | `/users/:userid/get-qr`, `/backup-codes` | TFA |
| PUT | `/users/:userid/enable-tfa`, `/disable-tfa`, `/new-backup-codes` | |
| GET, POST | `/partitions/:partitionid/users` | **confirmed correct path for listing a partition's users** — not `/members` (see §7) |
| GET, PUT | `/partitions/:partitionid/users/:userid` | |
| PUT, DELETE | `/partitions/:partitionid/members/:userid` | add/remove membership |

**User model fields**: `id, role_id, name, surname, phone, fax, email, jabber,
password, suspended, notification, notification_settings, tfa_enabled,
tfa_secret, tfa_backup_codes`.

### Roles / permissions
`GET/POST /roles`, `GET/PUT/DELETE /roles/:roleid`, `GET/POST
/permissions`, `GET/PUT/DELETE /permissions/:permissionid`,
`GET/POST/DELETE /roles/:roleid/permissions`.

### Flavors (VPS sizing presets)
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/flavors` | |
| GET, PUT, DELETE | `/flavors/:flavorid` | |
| GET | `/partitions/:partitionid/flavors`, `/enabled-flavors` | |
| POST | `/partitions/:partitionid/flavors/:flavorid/enable`, `/disable` | **confirmed: enabling/disabling a flavor per partition is these POST sub-routes, not a PUT with `{"enabled": bool}`** |

**Flavor model fields** (`FlavorEx`): `id, name, cpu_share, cpu_limit, mem_limit,
storage, io_limit, iops_limit` + `vps_count, enabled`.

### Alarms
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/alarms` | |
| GET, PUT, DELETE | `/alarms/:alarmid` | + `POST .../apply` |
| — | `alarm-triggers`, `alarm-trigger-templates`, `alarm-notification-rules` | supporting config resources |
| GET | `/networks/:netid/triggered-alarms` | `?statsonly=true`, `?unackedonly=true`, plus filters listed in §3 |
| POST | `/networks/:netid/triggered-alarms/:talarmid/acknowledge`, `/clear` | |
| GET | `/networks/:netid/triggered-alarms-archive` | |

**Alarm model**: `id, name, description, target, enabled, trigger_condition,
notify_freq, notify_net_admins, notify_domain_admins, first_notice,
repeat_notice`.
**TriggeredAlarm model**: `id, alarm_id, net_id, host_id, domain_id, vps_uuid,
grs_uuid, mon_uuid, iface_id, old_state, current_state, trigger_time, ack_time,
ack_user_id, description, notice_number, last_notice_time` + denormalized
`alarm_name, host_name, domain_name, vps_name, grs_name, mon_name, iface_name,
user_name, trigger_values`.

### Networking / storage config
`subnets`, `subnet-types`, `subnet-ip-addresses`, `network-settings`,
`storage-pools` (+ `/hosts/:hostid/storage-pools...`), `storage-types`,
`controller-interfaces`.

### Templates / OS images
`official-templates`, `community-templates`, `oci-templates`,
`template-registry`, `oci-registry-provider`, `packages` (system package updates,
async — poll via `job_uuid`).

### System / platform
`system-settings`, `ssl`, `syslogs`, `GET /user-sessions` + `POST
/user-sessions/.../terminate`, `audit-logs`, `ip-access-rules`, `purpose-types`,
`service-types`, `service-pools`, `actions` (action/task log).

### Backups
`backup-configs`, `GET /networks/:netid/backup-jobs`, `POST
/backup-jobs/:bjid/start`, `/terminate`.

### Geo-replication / takeover / restore **(proxied from sw-mgr)**
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/takeover-templates` | |
| GET, PUT, DELETE | `/takeover-templates/:tuuid` | full-replace on `vpses_metadata`, must send the whole array on PUT |
| GET | `/geo-servers-configured` | |
| GET, POST | `/geo-servers` | GET/PUT/DELETE `/geo-servers/:gsuuid` — route exists in source, but prior external testing saw 404; **may be licence-gated rather than absent — re-test with an ADMIN-role token specifically before concluding it's unavailable** |
| — | `replication-config`, `replication-config-domain`, `replication-config-vps`, `replication-cycles`, `replication-tasks`, `replicated-vpss`, `site-monitoring`, `restore-tasks`, `takeover-tasks`, `takeover-tasks-bulk`, `bulk` | geo-redundancy workflow resources |
| GET | `/backups/:hostid/backup-sets[/:backupuuid/vps-backups[/:vpsuuid[/restore]]]` | DELETE on `.../vps-backups/:vpsuuid` |
| — | `dns-zone`, `maintenance`, `licence` (`PUT /licence/reload`), `platform-info`, `status` | |

**TakeoverTemplate model**: `id, uuid, name, gs_uuid, site_uuid, time_created,
time_updated, vpses_metadata: [{uuid, dest_name, dest_domain_id, dest_host_id}]`.
`gs_uuid`/`site_uuid` are not obtainable from any other endpoint — if this
platform ever needs to create a *new* template from scratch, it must get these
from an existing template first (create one manually in the ServerWare UI as a
bootstrap step).

## 6. Known quirks / things that will bite you

- **`io_limit` units are inconsistent across ServerWare versions.** `GET` returns
  it in bytes/sec. `POST`/create on at least one older deployment seen in practice
  expected **MB/s from the fixed set `[0, 1, 5, 10, 20, 30, 40, 50, 75]`**, with a
  400 error if you send bytes. Since this project talks to multiple clusters that
  may run different ServerWare versions, **do not hardcode one unit convention —
  read the value back after writing it, and handle the retry-with-MB fallback per
  cluster if needed.**
- **`iops_limit` on create only accepts `[0, 100, 200, 300, 500, 1000]`.** Existing
  flavors may have other values (e.g. 150) that came from direct DB edits or an
  older version — snap down to the nearest accepted value when creating/copying a
  flavor.
- **Flavor enable/disable is a dedicated sub-route, not a field update.** `POST
  .../flavors/:flavorid/enable` / `/disable` — a `PUT` with `{"enabled": bool}`
  does not work.
- **Partition membership read endpoint is `/users`, not `/members`.** `GET
  /partitions/:partitionid/members` 404s; use `GET
  /partitions/:partitionid/users`. (`PUT`/`DELETE` on `/members/:userid` is
  correct for *changing* membership — only the list-read path differs.)
- **The `:vpsid` path param means different things on different VPS sub-routes.**
  On the VPS stats endpoints (`.../vpses/:vpsid/cpu_stats`, `/rtm`,
  `/top_cpu_proc`, etc.) it must be the VPS's **UUID string** — every underlying
  query is `WHERE uuid=?`. Some other VPS sub-resources parse the same
  `:vpsid` segment as a numeric ID instead. Don't assume one format works
  everywhere — get the UUID from the `uuid` field of a VPS list/detail response
  and use that specifically for stats calls.
- **A "no data for this VPS/time" condition on stats endpoints often comes back as
  HTTP 500, not 404 or an empty 200.** The handlers for `rtm`, `top_cpu_proc`,
  `top_mem_proc` (and the same pattern likely applies to the `*_stats` siblings)
  do a single-row DB scan and only special-case a cancelled request — a plain "no
  matching row" falls through to a generic 500. In practice, a 500 from `rtm`
  (which takes no query params) almost always means the `:vpsid` value didn't
  match any row — usually because a numeric ID was passed instead of the UUID (see
  above). For `top_cpu_proc`/`top_mem_proc`, a 500 can also mean the `?time=`
  value doesn't match an exact stored sample — pull a real timestamp from a
  `cpu_stats`/`mem_stats` response first rather than passing an arbitrary "now".
- **No central multi-cluster API.** Each cluster is a fully separate deployment:
  separate base URL, separate token, possibly separate ServerWare version/feature
  set. The `Integration Manager` concept in this project's design (per-cluster
  adapter config: base URL, version, credentials, status) exists specifically to
  handle this — don't build anything that assumes one global ServerWare instance.

## 7. Open items to verify against a real cluster before depending on them

1. Exact error-response JSON shape (`{"Error": "..."}` assumed, not confirmed).
2. Whether `/geo-servers` is a true 404 externally or a licence/permission-gated
   response that looks like one — re-test with an `ADMIN`-role token.
3. Behavior/response size of large list endpoints (`vpses`, `audit-logs`,
   `syslogs`) with realistic (thousands-of-rows) data volumes, before relying on
   them for bulk sync — no pagination convention exists to fall back on if a
   response turns out to be huge.
4. Whether a storage-usage breakdown by category (recordings, voicemail, backups,
   DB, CDR, logs, etc. — a feature this platform's spec calls for) is obtainable
   from ServerWare at all; current endpoints only expose aggregate disk usage.
   This likely needs a separate, explicitly-approved, metadata-only collection
   mechanism outside the ServerWare API — do not attempt to get there via shell
   access or file content reads.

## 8. Polling frequency / load considerations

If this platform polls `sw-wcp` on a fixed interval (e.g. every 10s) instead of
reacting to webhooks (ServerWare has none), here's what's actually safe, based on
reading the handler code directly rather than guessing:

- **List/dashboard endpoints are cheap.** `GetAllHosts` (and the equivalent VPS
  list handler) do a plain SQL `SELECT` against the local `sw_hosts`/`sw_vpses`
  tables (`internal/app/sw-wcp/handler/hosts-ctrl.go:157`) — they do **not** call
  out to the hypervisor or the controller daemon live. The dynamic fields
  (cpu_usage, mem_usage, state, etc.) are pre-collected by a separate daemon (see
  §7/polling-interval discussion) and just read back from the DB. Polling a list
  endpoint every 10s is comparable to leaving a ServerWare UI dashboard open with
  auto-refresh — negligible load on its own.
- **No rate limiting exists in `sw-wcp`.** A full source search (`ratelimit`,
  `limiter`, `throttle`, `x/time/rate`) found nothing — ServerWare will not reject
  or throttle frequent requests itself. That means there is no safety net; staying
  within reasonable limits is entirely this platform's own responsibility.
- **What actually scales badly:** per-entity polling loops. Calling a per-VPS
  endpoint (e.g. `.../vpses/:vpsid/cpu-stats`) individually for every VPS, every
  10s, scales linearly with VPS count × cluster count and can add up fast across
  dozens/hundreds of VPSes. Prefer the list/dashboard endpoints (one call returns
  everything) over looping per-ID wherever possible.
- **Watch unpaginated large endpoints.** `audit-logs`, `syslogs`, and similar
  endpoints have no standard pagination (§3) — don't poll these at a high
  frequency without first checking their response size/cost on a real cluster with
  production-scale data.
- **Suggested starting point:** 10s is fine for a small number of targeted, list-
  style calls (e.g. refreshing a dashboard a user has open). For full fleet-wide
  sync across many clusters/partitions, start more conservatively (30–60s) and
  tighten only after confirming actual DB/response load on a live cluster.
- This conclusion comes from reading `sw-wcp`'s own code, not from official
  ServerWare vendor documentation or a load test — if there's a contact on the
  ServerWare side, it's worth confirming there isn't an undocumented
  recommendation or infra-level limit (reverse proxy, firewall, etc.) before
  relying on this for production traffic.

## 9. Minimal example

```bash
curl -s \
  -H "SW-API-Token: srw_<your-token>" \
  "https://<cluster-host>/api/networks/1/hosts"
```

Expected shape:

```json
{
  "status": "success",
  "data": [
    { "id": 1, "name": "...", "state": "...", "cpu_usage": 0, "mem_usage": 0, "...": "..." }
  ]
}
```
