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
- An SSH key pair **generated on the App VM itself, after step 1** - not on
  your laptop. Since you work directly on the App VM (see step 9), that's
  the machine that needs to authenticate to GitHub, not your laptop:
  ```bash
  ssh-keygen -t ed25519 -C "you@bicomsystems.com"
  cat ~/.ssh/id_ed25519.pub
  ```
  Add that public key to your GitHub account (Settings -> SSH and GPG
  keys), then confirm the clone step in section 2 works.

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
# ca-certificates - the SERVERware Ubuntu 24.04 template does NOT include
# this by default (confirmed live on a fresh VPS), which breaks every
# HTTPS curl call below with "error setting certificate file:
# /etc/ssl/certs/ca-certificates.crt" until this runs.
sudo apt-get update && sudo apt-get install -y ca-certificates curl

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

Clone the repo. A fresh VM has never talked to GitHub before, so trust its
host key first (confirmed real live - without this, `git clone` fails with
"Host key verification failed" before it even gets to checking your key):

```bash
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts

git clone git@github.com:almirjunuzovic-bicom/customer_platform.git /opt/hosting-platform
cd /opt/hosting-platform
pnpm install

# pnpm blocks some dependencies' build/postinstall scripts by default until
# approved (confirmed live: install succeeds but prints "Agent skills
# awaiting approval" - silently skipping those scripts if you ignore it).
pnpm approve --all --yes
```

## 3. DB VM setup

### Give it internet access for package installs

The DB VM has **no public IP by design**, which also means it has **zero
internet access** - confirmed live (`apt-get update` fails resolving DNS,
and pinging `8.8.8.8`/`1.1.1.1` by IP also fails - it's not just DNS, there
is no route out at all). `apt-get install` will hang or fail until it can
reach a package mirror, so do this first, from the **App VM**:

```bash
sudo apt-get install -y apt-cacher-ng
# bind it to the private network only, not every interface (same
# principle as MySQL's bind-address below - don't expose it publicly)
echo "BindAddress: <App VM's private IP>" | sudo tee -a /etc/apt-cacher-ng/acng.conf
sudo systemctl restart apt-cacher-ng
```

Then on the **DB VM**, point apt at it through the private network:

```bash
echo 'Acquire::http::Proxy "http://<App VM's private IP>:3142";' | sudo tee /etc/apt/apt.conf.d/01proxy
```

This keeps the DB VM's "private IP only, no public IP" isolation intact for
its entire lifetime - no need to ever give it a public IP, even
temporarily, just to run `apt-get`.

### Install and configure MySQL

SSH into the DB VM, then:

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

From your own laptop, tunnel in to view the frontend. Note the API's port
forward targets the VM's **private IP**, not `127.0.0.1` - confirmed live
that this matters: the API binds to `API_HOST` from `apps/api/.env` (your
private IP, per step 5), not to loopback, so forwarding to `127.0.0.1:3001`
on the remote end fails with "connection refused" even though the API is
actually running fine:

```bash
ssh -L 5173:127.0.0.1:5173 -L 3001:<app-vm-private-ip>:3001 you@<app-vm-public-ip>
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

**This is enforced by agreement, not by GitHub.** GitHub only enforces
branch protection / rulesets on private repos for paid (Pro/Team/
Enterprise) plans - this repo is on a free personal account, so nothing
technically stops a direct push to `main`. Decided to rely on everyone
actually following this instead of paying for a plan upgrade on a repo
that's a temporary stand-in anyway (until Bicom's internal Git is ready).
That makes it more important you actually follow it, not less:

- Trunk-based: `main` is the shared branch everyone builds on, all work
  happens on a short-lived branch off it.
- `git checkout -b feature/<short-description>`
- Commit as you go, with messages that explain *why*, not just *what*.
- `git push -u origin feature/<short-description>`
- Open a Pull Request on GitHub targeting `main`. Add Almir as a reviewer.
- **Never push or merge directly to `main`**, even though GitHub will
  technically let you - wait for review/approval, and don't merge your
  own PR.
- Keep PRs scoped to one thing. A PR that does five unrelated things is
  much slower to review than five small ones.

## If something doesn't match this doc

This was written from exactly what built and ran the first working
environment (`AlmirTest`/`AlmirTestdb`) - if a step fails in a way this
doc didn't anticipate, that's worth flagging back, not silently working
around, since the next person hits the same thing.
