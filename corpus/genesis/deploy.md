# Deploying the generated services yourself

**Genesis never deploys.** It writes the files a deploy needs into each service repository; the
deploy itself is run by the user, or by you on the user's behalf, with the user's own login on
the target. No deploy credential ever goes to Genesis, into the blueprint or into a project file.
This page lists, per target, what Genesis writes and the commands that deploy it.

> **Delivery first.** Builds are dry runs for now: nothing is pushed to the user's repositories.
> `genesis_deliverService` brings the service with its `deploy/<target>/` files to this machine,
> and the steps below work from that folder. Where delivery is turned off for the account
> (`GENESIS_DELIVERY_NOT_ENABLED`) there is nothing to deploy yet: say so, and do not write a target's files by hand as
> if Genesis had generated them.

## 1. Asking for the deploy files

Name the targets in the build: `genesis_buildService` with, for example,
`deployTargets: ["docker-compose", "fly"]`. Each target writes `deploy/<target>/` into the
service. These are generated files: they are in the manifest, counted in the build's added lines,
and rewritten by every build that names the target (do not edit them; keep your own deploy
files outside `deploy/<target>/`). The job's `deployArtifacts` lists per target
`{ target, status: "emitted" | "skipped", path, files, reason? }`; a part without a container
image (`document`, `frontend`) is `skipped`.

| Target | Status | Folder |
|---|---|---|
| `docker-compose` | available | `deploy/docker-compose/`: `docker-compose.yml`, `.env.example`, `.providers.secrets.env.example`, `README.md` |
| `railway` | available | `deploy/railway/`: `railway.json`, `variables.env`, `README.md` |
| `fly` | available | `deploy/fly/`: `fly.toml`, `secrets.env`, `README.md` |
| `render` | available | `deploy/render/`: `render.yaml`, `README.md` |

An unknown target answers `400 GENESIS_UNKNOWN_DEPLOY_TARGET` with `details.allowed`: that list,
not this page, is the truth for the API you call. There is no frontend target: the user places
the frontend themselves.

The generated `README.md` of each target is written for that service and that build (its service
names, ports and variables). Read it before you run anything; where it and this page differ,
it wins.

## 2. What every target needs

- **The secrets are references, never values.** Every password and key in the generated files is
  a `${VAR}` / `${VAR:?}` / `${{...}}` reference or a blank line. The user fills them on the
  target (or in a gitignored local file), never in a committed file.
- **A signing key per service.** Each service signs its tokens with its own Ed25519 key. Without
  one the service starts degraded (the login service cannot issue sessions). Per service:

  ```sh
  openssl genpkey -algorithm ed25519 -out <service>.pem   # PKCS#8 PEM
  uuidgen                                                  # its key id
  ```

  Set them as secret variables on the target (`SERVICE_PRIVATE_KEY_PEM` / `SERVICE_KID` per
  service on Railway, `<SERVICE>_SERVICE_PRIVATE_KEY_PEM` / `<SERVICE>_SERVICE_KID` in the
  compose `.env`). Never commit a key file.
- **Peer addresses.** In the test, stage and prod slot files the addresses of the other services
  (`AUTH_SERVICE_URL`, `SERVICE_<NAME>_URL`, ...) are blank on purpose: the deploy sets them.
  The compose file and the Railway variables already wire the services of the same build.
- **Provider credentials** (payment, mail, storage, AI): the keys each service reads are listed
  in its `.providers.secrets.env.example` (compose) or as shared variables (Railway). A key the
  blueprint gives as `$ENV:NAME` is listed as `NAME`: the slot file carries the reference and the
  service reads `NAME` at boot. Missing ones
  do not stop the service from starting; it answers errors where they are needed (see
  [pitfalls.md](pitfalls.md)).
  - **For a local file** (`.env`, `*.secrets.env`): ask for each key on the local key page
    (`genesis_requestKey`, then `genesis_writeKeyToEnvFile`), never in the chat.
  - **On a hosting target:** the user enters the key in the target's own secret settings.
- **The test transport.** Every generated nodejs service mounts super-admin-only test routes
  (`/<service>-api/admin/test-transport`, [testing.md](testing.md)) on any explicit non-production
  slot: the `dev`, `test` and `stage` images. The Railway, Fly.io and Render files run the PROD
  slot, where they are closed. On
  any other shared deploy that is not prod, set `MB_TEST_TRANSPORT=off` unless the user wants the
  surface reachable there.
- **Health:** every service answers `/health`. A deploy is done when `/health` reports ready,
  not when the container runs ([run-locally.md](run-locally.md)).

## 3. docker-compose: the whole stack on one machine

The compose file holds every deployable service of the build, each built from its own repository
with its DEV slot image, plus the infrastructure they read: PostgreSQL or MongoDB (by each
service's database type), Redis and Elasticsearch for the backend services, and Kafka. Every
service repository carries the same stack.

1. Check the service repositories out side by side (the generated README lists the folder names,
   `<codename>-<service>-service/`).
2. Then, in any one of them:

   ```sh
   cd deploy/docker-compose
   cp .env.example .env
   cp .providers.secrets.env.example .providers.secrets.env
   # fill in .env (passwords, signing keys) and the provider credentials you use
   docker compose up --build
   ```

3. `docker compose ps` shows the health of each container; `docker compose logs -f <service>`
   follows one service.

Notes:
- Docker Compose 2.24 or newer is needed (the provider file is an optional `env_file`).
- Neither `.env` nor `.providers.secrets.env` is committed: the generated `.gitignore` ignores
  both. Use URL-safe passwords (the MongoDB password goes into a connection URL). Put a PEM into
  `.env` in double quotes.
- The infrastructure is reachable only inside the compose network.
- **Mail and SMS:** the stack runs a `mail-sink` service (Mailpit). A mail the services cannot
  deliver (no complete email provider) and an SMS with no SMS provider, which travels to the sink
  as a mail, land there; read them at `http://localhost:8025`. The services reach it at their
  default `mail-sink:465`, so nothing is configured. Declare a real provider to send for real.

## 4. Railway

Per service, `deploy/railway/` holds the config-as-code file (the PROD slot Dockerfile, health
check `/health`, restart on failure), `variables.env` (the variables in Railway's Raw Editor
format, with Railway references for the databases and the other services) and a README naming
what the references expect.

The user logs in with their own Railway account; the login stays in the Railway CLI or their
browser, never in the project. In one Railway project:

1. Add the databases the README names: a PostgreSQL service named `Postgres` (for PostgreSQL
   services), a MongoDB service named `MongoDB` (for MongoDB services) and a Redis service named
   `Redis` (for backend services). The variable references use exactly these names.
2. For each service of the build, create a Railway service from its repository, named as its
   README says (the other services' references use those names).
3. In that service's settings, set the config-as-code path to `deploy/railway/railway.json`.
4. In its Variables, open the Raw Editor and paste `deploy/railway/variables.env`. Fill the
   shared variables the README lists (a missing one resolves to empty) and set
   `SERVICE_PRIVATE_KEY_PEM` / `SERVICE_KID` as sealed variables.
5. Generate a public domain for each service that serves the outside world.

With the Railway CLI the same steps are `railway login`, `railway link` (or `railway init` for a
new project) and, per service, `railway up` from the service repository; check
`railway --help` for the version the user has instead of guessing flags. In CI the token is a
secret of the CI system (`RAILWAY_TOKEN`), never a file of the repository.

## 5. Fly.io

One Fly app per service, named after its repository (`<codename>-<service>-service`).
`deploy/fly/` holds `fly.toml` (the PROD slot Dockerfile, `http_service` on the slot's port,
the `/health` check, an explicit VM size), `secrets.env` (every value the user gives, as blank
lines, in the form `fly secrets import` reads) and a README with the app names, the
infrastructure and the sizing.

- **Peers** talk over Fly's private network: `[env]` already holds each peer's
  `http://<app>.flycast` address. Every app needs a private IP for that (Flycast).
- **Machines:** a service with a Kafka consumer or an in-process cron job is always on
  (`auto_stop_machines = "off"`, `min_machines_running = 1`); only a service the tree proves
  request-only scales to zero. A service whose README says ONE Machine runs in-process cron jobs
  without a cross-Machine lock: deploy it with `--ha=false`.
- **Infrastructure:** PostgreSQL can be Fly Postgres and Redis Upstash for Redis; Kafka,
  Elasticsearch and MongoDB come from outside Fly (a hosted provider) or the user's own Machines
  with volumes. Their addresses and credentials go into `secrets.env`.
- No volume is mounted: the root filesystem is lost on every restart.

The user logs in with their own Fly account (`fly auth login`). Per service, from the service
repository root (the build context; `fly.toml` names the Dockerfile relative to itself):

```sh
fly apps create <app>                           # the app name from the README
fly ips allocate-v6 --private -a <app>          # the Flycast address the peers use
# fill deploy/fly/secrets.env locally (never commit the filled file), then:
fly secrets import -a <app> < deploy/fly/secrets.env
fly deploy --config deploy/fly/fly.toml         # add --ha=false where the README says ONE Machine
```

Check `fly --help` for the version the user has instead of guessing flags. In CI the token is a
secret of the CI system (`FLY_API_TOKEN`), never a file of the repository.

## 6. Render

`deploy/render/render.yaml` is a Render Blueprint: one Docker `web` service built from the PROD
slot Dockerfile, with `/health` and an explicit size. The ONE repository that owns the project's
shared infrastructure (the login service, or the first backend service) also declares a Render
Postgres instance (every PostgreSQL service creates its own database on it) and a Key Value
(Redis) instance every service shares. The README of each service says which repository that is.

1. Apply the owner repository's Blueprint first: in the Render dashboard, New Blueprint from that
   repository, Blueprint Path `deploy/render/render.yaml`.
2. Then the Blueprint of every other service repository, the same way.
3. When a Blueprint is first applied, Render asks for the `sync: false` values: the README lists
   them. Peer addresses are among them: Render publishes a peer's private address as `host:port`,
   so give it as `http://<host:port>`. Set `SERVICE_PRIVATE_KEY_PEM` / `SERVICE_KID` there too.
4. Kafka, Elasticsearch and MongoDB come from outside Render; give their addresses and
   credentials the same way.

A service that runs continuously (a Kafka consumer, in-process cron jobs) must stay off Render's
Free plan, whose instances spin down after 15 minutes without traffic. Keep ONE instance where
the README says so. The user signs in to Render with their own account; nothing about it goes to
Genesis or into the repository.

## 7. The frontend: you write its deploy config

Genesis generates no frontend code and no frontend deploy files. The frontend service is a
briefing package (prompt docs, architect docs, `project.json`); the app in that folder is the
user's, written with the genesis-frontend skill. So its deploy config is yours to write too, for
the target the user picks.

- **Pick the target with the user.** A built single-page app is static files: a static host
  (Netlify, Cloudflare Pages, Vercel, a Render or Railway static site) or a small web-server
  container next to the compose stack. Ask; do not choose for them.
- **Write the config in the app**, beside its own files, never inside the generated docs set
  (the next delivery replaces that set). On a static host, add the fallback that serves
  `index.html` for every unknown path, or deep links answer 404.
- **The API host is a build-time setting per environment** (for example `VITE_API_BASE_URL`), set
  on the target; the service paths come from `project.json` `info.baseUrl`. Never hard-code a host.
- **The frontend build holds no secrets.** Everything in it is public. Only publishable keys (a
  payment provider's publishable key) may appear; a secret key belongs to a backend service.
- **Point the backend at the frontend.** Set `FRONTEND_URL` on each backend service to the
  frontend's public address: the generated deploy files leave it for you ("your frontend"). The
  services read it for the session cookie's default domain and for the return addresses of
  connect flows. If the backend limits CORS (a nodejs service: `CORS_CONTROL_ACTIVE=true` with
  `ALLOWED_ORIGINS`), add the frontend's origin there; the service README names its variables.
- **Deploy with the user's own login** on that target, as for the backend.
- **Verify it in a browser:** the page loads on its public address, a sign-in works, and a screen's
  API call succeeds with no CORS error. Report the address and what you checked.

## 8. What you never do

- Ask the user for a deploy token to send to Genesis, or store one in the project, the blueprint
  or a commit.
- Report a deploy as done without the target's own evidence: the platform's deploy log and
  `/health` ready on the public address.
- Edit `deploy/<target>/` files to make a deploy work: the next build rewrites them. Fix the
  blueprint and compile again, or report the generated file as a compiler fault with the job id.
