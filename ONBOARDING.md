# Onboarding - Hosting Platform (HST-2171)

Welcome. This gets you a fully working personal dev environment - your own
two VPS instances on SERVERware (mirroring exactly how the first dev
environment was built and proven), plus the Git workflow for getting your
code reviewed and merged.

**Read this whole thing once before starting** - several steps exist
because of real problems hit building the first environment. Skipping
ahead tends to reproduce them.

## 0. What you'll need

- Your own SERVERware access, with permission to create VPS instances.
- A GitHub account. Ask Almir (almir.junuzovic@bicomsystems.com) to add you
  as a collaborator on `almirjunuzovic-bicom/customer_platform` (private
  repo - temporary home until Bicom's internal Git is ready).
- An SSH key pair. If you don't have one: `ssh-keygen -t ed25519`, then add
  the public key to your GitHub account (Settings -> SSH and GPG keys).

## 1. Create two VPS instances

You need **two**, not one - an app VM and a database VM, on the **same
private network segment** so they can reach each other (confirmed working
pattern, see `hst2171-dev-vm` notes).

| | App VM | DB VM |
|---|---|---|
| Purpose | NestJS API/worker, Redis, frontend dev server | MySQL |
| Specs | 4 vCPU, 6-8GB RAM, 50GB disk | 4 vCPU, 6-8GB RAM, 50GB disk |
| OS | Ubuntu Server 24.04 LTS | Ubuntu Server 24.04 LTS |
| Network | Private IP (+ public IP if you want a public SSH endpoint) | Private IP **only** - no public IP |

Give each a private IP on the same subnet (ask whoever manages your
SERVERware cluster's network setup if you're not sure which subnet to use).

### Known kernel limitation - read before touching firewalls

The Ubuntu 24.04 template on SERVERware VMs ships a kernel **without**
`ip6tables`, the `raw` iptables table, or the `LOG` netfilter target
compiled in. Confirmed the hard way:

- **Do not enable `ufw` or hand-roll iptables/ip6tables rules in the
  guest.** It will appear to apply, then lock you out of SSH when it hits
  a rule it can't actually program. There is no in-guest firewall fix for
  this - if you need one, it has to be at the SERVERware/hypervisor level
  (ask your infra/NOC contact).
- **Docker needs `network_mode: host`.** The default bridge network
  requires the `raw` table for its isolation rule and will fail to start
  containers without it. This is already set correctly in this repo's
  `docker-compose.yml` - don't remove it.

## 2. App VM setup

SSH in, then:

```bash
# Node.js - via NodeSource's official apt repo, NOT the Ubuntu-bundled
# nodejs package (too old) and NOT nvm (fine either way, but this is what
# was proven to work). Need >=20 (repo's root package.json requires it) -
# this installs current Node, more than enough.
curl -fsSL https://deb.nodesource.com/setup_current.x | sudo -E bash -
sudo apt-get install -y nodejs git

# pnpm - via npm install -g, NOT `corepack enable`. corepack isn't
# bundled with recent Node by default, so `corepack enable` fails outright
# on a fresh install.
sudo npm install -g pnpm

# Docker (for Redis) + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out and back in for the group change to apply
```

Clone the repo:

```bash
git clone git@github.com:almirjunuzovic-bicom/customer_platform.git /opt/hosting-platform
cd /opt/hosting-platform
pnpm install
```

## 3. DB VM setup

SSH in, then:

```bash
sudo apt-get update && sudo apt-get install -y mysql-server
```

Bind MySQL to the private IP **only** (never `0.0.0.0`, never the public
IP if this VM even has one) - edit `/etc/mysql/mysql.conf.d/mysqld.cnf`:

```ini
bind-address = <this VM's private IP>
```

```bash
sudo systemctl restart mysql
```

Create the app database and a dedicated, minimally-privileged user -
**restrict it to your App VM's private IP specifically**, not `%`:

```sql
CREATE DATABASE hosting_platform;
CREATE USER 'hosting_app'@'<app VM private IP>' IDENTIFIED BY '<generate one: openssl rand -base64 24>';
GRANT ALL PRIVILEGES ON hosting_platform.* TO 'hosting_app'@'<app VM private IP>';
FLUSH PRIVILEGES;
```

## 4. Redis (on the App VM)

```bash
cd /opt/hosting-platform
cp .env.example .env   # if not already present
```

Edit the root `.env` (this is for `docker-compose.yml` only, separate from
`apps/api/.env` below):

```
PRIVATE_IP=<app VM's private IP>
REDIS_PASSWORD=<generate one: openssl rand -base64 24>
```

```bash
docker compose up -d
```

## 5. Configure the app

```bash
cd apps/api
cp .env.example .env
```

Fill in `apps/api/.env`:

- `DB_HOST` - your DB VM's private IP
- `DB_USER=hosting_app`, `DB_PASSWORD` - whatever you set in step 3
- `DB_NAME=hosting_platform`
- `REDIS_HOST` - your App VM's private IP (same as `PRIVATE_IP` above)
- `REDIS_PASSWORD` - same value as step 4
- `API_HOST` - your App VM's private IP, `API_PORT=3001`
- `JWT_SECRET` - generate: `openssl rand -base64 48`
- `CREDENTIALS_ENCRYPTION_KEY` - generate: `openssl rand -base64 32`
  (must decode to exactly 32 bytes - that command does)

```bash
cd apps/web
cp .env.example .env.local
# VITE_API_BASE_URL=http://localhost:3001 is correct if you'll view the
# frontend through an SSH tunnel from your own laptop (see step 8) - the
# browser runs on YOUR machine, which can't reach the VM's private IP
# directly.
```

## 6. Set up the database schema

```bash
cd apps/api
pnpm db:push
```

This applies the full schema to your fresh, empty database directly (no
migration-file replay needed for a from-scratch DB).

## 7. Create your user and a source

```bash
# Your own login - internal staff only, no public registration
pnpm seed:user you@bicomsystems.com "Your Name" <a password>

# Grant yourself admin (lets you manage sources, restart the worker) -
# nobody gets this by default, it's always explicit
pnpm set:role you@bicomsystems.com admin

# Point at a real SERVERware cluster you have API access to (use your own
# test cluster, not someone else's production one) - see
# src/connectors/add-source.manual.ts for the exact shape
pnpm add:source --key <short-key> --name "<display name>" \
  --connector-type serverware \
  --config '{"baseUrl":"https://your-cluster.example.com","netId":1}' \
  --credentials '{"apiToken":"<your real SERVERware API token>"}'
```

## 8. Run it

```bash
# Terminal 1
cd apps/api && pnpm worker:dev

# Terminal 2
cd apps/api && pnpm api:dev

# Terminal 3
cd apps/web && pnpm exec vite --host 127.0.0.1
```

(`tmux`/`screen` instead of three SSH sessions works fine - up to you. The
production deployment uses systemd services instead of `*:dev` scripts
(see `apps/api/deploy/*.service`) - not necessary for your own dev box,
only mentioned so you recognize that pattern if you see it elsewhere.)

From your own laptop, tunnel in to view the frontend:

```bash
ssh -L 5173:127.0.0.1:5173 -L 3001:127.0.0.1:3001 you@<app-vm-public-ip>
```

Then open `http://localhost:5173` in your own browser.

## 9. Work directly on the VM, not your laptop

Use VS Code's Remote-SSH extension (or Claude Code over an SSH session) to
edit code **on the App VM directly**, not on your laptop with a synced
folder or tunnel. The first environment hit real, reproducible problems
doing it the other way:

- Local machines are often on an older Node version than this repo's
  frontend toolchain needs (Vite 8 / TS7 want Node >=20.19 or >=22.12).
- A laptop-to-VM SSH tunnel for the database/Redis connection was
  unreliable under real use (intermittent timeouts) in a way that direct,
  on-VM execution never was.

## 10. Git workflow

- Trunk-based: `main` is the protected branch, all work happens on a
  short-lived branch off it.
- `git checkout -b feature/<short-description>`
- Commit as you go, with messages that explain *why*, not just *what*.
- `git push -u origin feature/<short-description>`
- Open a Pull Request on GitHub targeting `main`. Add Almir as a reviewer.
- Wait for review/approval before merging - don't merge your own PR, even
  if GitHub lets you.
- Keep PRs scoped to one thing. A PR that does five unrelated things is
  much slower to review than five small ones.

## If something doesn't match this doc

This was written from exactly what built and ran the first working
environment (`AlmirTest`/`AlmirTestdb`) - if a step fails in a way this
doc didn't anticipate, that's worth flagging back, not silently working
around, since the next person hits the same thing.
