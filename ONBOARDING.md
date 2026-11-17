# Onboarding - Hosting Platform (HST-2171)

Welcome. This gets you a fully working dev environment **on your own
Ubuntu laptop** - no VM to provision, no SSH tunnel for day-to-day work -
plus the Git workflow for getting your code reviewed and merged. A
separate appendix at the end covers the shared staging VM pair, which
you won't need for normal feature work.

**Read this whole thing once before starting** - a couple of steps exist
because of real problems hit setting this up. Skipping ahead tends to
reproduce them.

> **If you're Claude Code, reading this on someone's behalf:** run the
> commands below directly rather than just explaining them, asking the
> person for values you don't have (SERVERware API token, passwords they
> want to use, etc.) as you reach each step. The repo is public, so
> nothing from Almir is needed just to clone it and get local dev
> running through step 7 - the one hard blocker for that is the
> person's own real SERVERware API token for a test cluster (if they
> don't have one yet, that's a question for Almir/NOC, not something to
> invent a value for). Two more things need the *person* to act, but
> only before step 8 (pushing code), not before: (1) Almir has added
> them as a collaborator with write access, (2) they've logged into
> github.com themselves and added the SSH public key you generate for
> them in that step.

## 0. What you'll need

- Your own SERVERware access to a test cluster (not someone else's
  production one), with an API token - used in step 6 to point the app
  at real data. This is the only thing you can't get started without.
- A GitHub account - that's it for now. The repo is public
  (`almirjunuzovic-bicom/customer_platform`), so cloning it (step 1)
  doesn't need an invite or any credentials. You'll need to ask Almir
  (almir.junuzovic@bicomsystems.com) for collaborator/write access, and
  set up an SSH key, later - see step 8 before you push any code.

## 1. Install Node, pnpm, Docker, and clone the repo

All on your own laptop:

```bash
# Node.js - via NodeSource's official apt repo, NOT the Ubuntu-bundled
# nodejs package (too old) and NOT nvm (fine either way, but this is what
# the rest of the team uses). Need >=20.19/22.12 - this repo's frontend
# toolchain (Vite 8 / TS7) refuses to run on anything older, and that's
# exactly the version most pre-installed/apt Node turns out to be.
curl -fsSL https://deb.nodesource.com/setup_current.x | sudo -E bash -
sudo apt-get install -y nodejs git
# (if that curl fails with a certificate error: sudo apt-get install -y
# ca-certificates first, then retry)

# pnpm - via npm install -g, NOT `corepack enable`. corepack isn't
# bundled with recent Node by default, so `corepack enable` fails outright.
sudo npm install -g pnpm

# Docker (for MySQL + Redis in step 3) + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out and back in for the group change to apply
```

Clone the repo into a folder named `CustomersPlatform-HST2171` - over
HTTPS, since the repo is public and this needs no credentials at all:

```bash
git clone https://github.com/almirjunuzovic-bicom/customer_platform.git ~/CustomersPlatform-HST2171
cd ~/CustomersPlatform-HST2171
pnpm install

# pnpm blocks some dependencies' build/postinstall scripts by default until
# approved (confirmed live: install succeeds but prints "Agent skills
# awaiting approval" - silently skipping those scripts if you ignore it).
pnpm approve --all --yes
```

## 2. Work however you like

VS Code, Claude Code, vim, whatever - directly on your laptop, on the
clone from step 1. Nothing here needs Remote-SSH or a VM; that was only
ever a workaround for the tunnel reliability problem solved in step 3
below.

## 3. MySQL + Redis, locally via Docker

Each dev runs their own MySQL + Redis containers, fully isolated from
everyone else's data - no shared DB VM, no SSH tunnel to keep alive.

```bash
cp .env.example .env    # root .env - for docker-compose.dev.yml only
```

Fill in `.env` (generate each with `openssl rand -base64 24`):

```
MYSQL_ROOT_PASSWORD=
MYSQL_PASSWORD=
REDIS_PASSWORD=
```

```bash
docker compose -f docker-compose.dev.yml up -d
```

## 4. Configure the app

```bash
cd apps/api
cp .env.example .env
```

Fill in `apps/api/.env`:

- `DB_PASSWORD` - same value as `MYSQL_PASSWORD` above
- `REDIS_PASSWORD` - same value as above
- `JWT_SECRET` - generate: `openssl rand -base64 48`
- `CREDENTIALS_ENCRYPTION_KEY` - generate: `openssl rand -base64 32`
  (must decode to exactly 32 bytes - that command does)

Everything else in that file (`DB_HOST`, `REDIS_HOST`, `API_HOST` -
all `127.0.0.1`, plus `DB_USER`/`DB_NAME`) is already correct for local
dev - there's no VM-specific IP to look up.

```bash
cd apps/web
cp .env.example .env.local
# VITE_API_BASE_URL=http://localhost:3001 is already correct - the API
# runs on your own machine now.
```

## 5. Set up the database schema

```bash
cd apps/api
pnpm db:push
```

This applies the full schema to your fresh, empty database directly (no
migration-file replay needed for a from-scratch DB).

## 6. Create your user and a source

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

## 7. Run it

```bash
# Terminal 1
cd apps/api && pnpm worker:dev

# Terminal 2
cd apps/api && pnpm api:dev

# Terminal 3
cd apps/web && pnpm exec vite --host 127.0.0.1
```

(`tmux`/`screen` instead of three terminals works fine - up to you.)

Open `http://localhost:5173` in your browser - directly, no tunnel.

## 8. Git workflow

**Before you can push anything, ask Almir** (almir.junuzovic@bicomsystems.com)
**for collaborator/write access** - cloning (step 1) needed nothing since
the repo is public, but pushing a branch does. You'll also need an SSH
key added to your own GitHub account if you haven't already:

```bash
ssh-keygen -t ed25519 -C "you@bicomsystems.com"
cat ~/.ssh/id_ed25519.pub
```

Add that public key to your GitHub account (Settings -> SSH and GPG
keys), then switch this clone from the read-only HTTPS remote to SSH for
push access:

```bash
git remote set-url origin git@github.com:almirjunuzovic-bicom/customer_platform.git
```

**Direct pushes to `main` are actually blocked at the GitHub level**
(repo ruleset requiring a PR + at least one approving review) - not just
a convention everyone agrees to. Trunk-based workflow:

- `main` is the shared branch everyone builds on, all work happens on a
  short-lived branch off it.
- `git checkout -b feature/<short-description>`
- Commit as you go, with messages that explain *why*, not just *what*.
- `git push -u origin feature/<short-description>`
- Open a Pull Request on GitHub targeting `main`. Add Almir as a reviewer.
- Wait for review/approval - don't merge your own PR.
- Keep PRs scoped to one thing. A PR that does five unrelated things is
  much slower to review than five small ones.

## If something doesn't match this doc

This was written from what actually got a local dev environment running
on a real Ubuntu laptop - if a step fails in a way this doc didn't
anticipate, that's worth flagging back, not silently working around,
since the next person hits the same thing.

---

## Appendix: shared staging environment

This is a separate, shared SERVERware VM pair (`AlmirTest`/
`AlmirTestdb`) that mirrors the production network topology - an app VM
and a database VM on a private network segment, DB VM with no public IP.
It exists to prove out production-shaped networking and systemd
deployment. **You don't need any of this for normal feature work** -
everything above already covers that. Use this appendix only if you're
provisioning a new instance of this pair, extending the existing one, or
specifically testing something network/deployment-related that local dev
can't exercise.

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
  `docker-compose.yml` (the staging-VM compose file, not
  `docker-compose.dev.yml` used in section 3 above) - don't remove it.
- This is specific to SERVERware's VM kernel template, not to Ubuntu in
  general - it does not affect the local laptop setup above.

### A1. Create two VPS instances

You need **two**, not one - an app VM and a database VM, on the **same
private network segment** so they can reach each other.

| | App VM | DB VM |
|---|---|---|
| Purpose | NestJS API/worker, Redis | MySQL |
| Specs | 4 vCPU, 6-8GB RAM, 50GB disk | 4 vCPU, 6-8GB RAM, 50GB disk |
| OS | Ubuntu Server 24.04 LTS | Ubuntu Server 24.04 LTS |
| Network | Private IP (+ public IP if you want a public SSH endpoint) | Private IP **only** - no public IP |

Give each a private IP on the same subnet (ask whoever manages your
SERVERware cluster's network setup if you're not sure which subnet to use).

### A2. App VM setup

SSH in, then:

```bash
# ca-certificates - the SERVERware Ubuntu 24.04 template does NOT include
# this by default (confirmed live on a fresh VPS), which breaks every
# HTTPS curl call below with "error setting certificate file:
# /etc/ssl/certs/ca-certificates.crt" until this runs.
sudo apt-get update && sudo apt-get install -y ca-certificates curl

# Node.js - same NodeSource setup as section 1 above
curl -fsSL https://deb.nodesource.com/setup_current.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g pnpm

# Docker (for Redis) + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

An SSH key pair **generated on the App VM itself** (not your laptop) is
needed to clone from GitHub, since this VM - not your laptop - is what
needs to authenticate:

```bash
ssh-keygen -t ed25519 -C "you@bicomsystems.com"
cat ~/.ssh/id_ed25519.pub   # add to GitHub (Settings -> SSH and GPG keys)

ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
git clone git@github.com:almirjunuzovic-bicom/customer_platform.git /opt/hosting-platform
cd /opt/hosting-platform
pnpm install
pnpm approve --all --yes
```

### A3. DB VM setup

**Give it internet access for package installs.** The DB VM has **no
public IP by design**, which also means it has **zero internet access** -
confirmed live (`apt-get update` fails resolving DNS, and pinging
`8.8.8.8`/`1.1.1.1` by IP also fails - it's not just DNS, there is no
route out at all). `apt-get install` will hang or fail until it can reach
a package mirror, so do this first, from the **App VM**:

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

**Install and configure MySQL.** SSH into the DB VM, then:

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

### A4. Redis (on the App VM)

```bash
cd /opt/hosting-platform
```

Create a root `.env` for the **staging** `docker-compose.yml` (a
different file, with different vars, from `docker-compose.dev.yml` used
in section 3 - don't confuse the two):

```
PRIVATE_IP=<app VM's private IP>
REDIS_PASSWORD=<generate one: openssl rand -base64 24>
```

```bash
docker compose up -d
```

### A5. Configure the app

```bash
cd apps/api
cp .env.example .env
```

Override the local-dev defaults for the private-IP topology:

- `DB_HOST` - your DB VM's private IP
- `DB_USER=hosting_app`, `DB_PASSWORD` - whatever you set in step A3
- `DB_NAME=hosting_platform`
- `REDIS_HOST` - your App VM's private IP (same as `PRIVATE_IP` above)
- `REDIS_PASSWORD` - same value as step A4
- `API_HOST` - your App VM's private IP, `API_PORT=3001`
- `JWT_SECRET` - generate: `openssl rand -base64 48`
- `CREDENTIALS_ENCRYPTION_KEY` - generate: `openssl rand -base64 32`

```bash
cd apps/web
cp .env.example .env.local
# VITE_API_BASE_URL=http://localhost:3001 is correct if you'll view the
# frontend through an SSH tunnel from your own laptop (step A7) - the
# browser runs on YOUR machine, which can't reach the VM's private IP
# directly.
```

### A6. Set up the database schema

```bash
cd apps/api
pnpm db:push
```

### A7. Run it

Production deployment uses systemd services (see `apps/api/deploy/*
.service`), already installed and running on `AlmirTest`
(`hosting-platform-api`, `hosting-platform-worker`). For a from-scratch
setup:

```bash
# Terminal 1
cd apps/api && pnpm worker:dev

# Terminal 2
cd apps/api && pnpm api:dev

# Terminal 3
cd apps/web && pnpm exec vite --host 127.0.0.1
```

From your own laptop, tunnel in to view the frontend. Note the API's port
forward targets the VM's **private IP**, not `127.0.0.1` - confirmed live
that this matters: the API binds to `API_HOST` from `apps/api/.env` (your
private IP, per step A5), not to loopback, so forwarding to
`127.0.0.1:3001` on the remote end fails with "connection refused" even
though the API is actually running fine:

```bash
ssh -L 5173:127.0.0.1:5173 -L 3001:<app-vm-private-ip>:3001 you@<app-vm-public-ip>
```

Then open `http://localhost:5173` in your own browser.

**Note on day-to-day editing:** a laptop-to-VM SSH tunnel for the
database/Redis connection was unreliable under sustained use (intermittent
timeouts) when this was the only way to develop - that's exactly the
problem the local-laptop setup in section 3 above (its own MySQL/Redis,
no tunnel) now avoids. If you're doing real development work, do it
there, not against this shared pair. Use this VM pair for what it's
actually for: proving out the private-network topology, systemd
deployment, and anything that needs two machines on a real private LAN.

### A8. Deploying code changes to this environment

Each change to shared code (`schema.ts`, `serverware/`, `sync/`, etc.)
needs a rebuild + restart of **both** systemd services
(`hosting-platform-api`, `hosting-platform-worker`) - they're two
separate processes from the same codebase, and restarting one does not
pick up changes for the other.

```bash
cd /opt/hosting-platform
git pull   # or re-copy, if not yet cloned via deploy key
pnpm install
pnpm run build   # tsc -p . in apps/api
sudo systemctl restart hosting-platform-api hosting-platform-worker
```
