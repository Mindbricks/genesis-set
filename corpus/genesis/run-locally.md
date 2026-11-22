# Running and debugging the generated services locally

This page is for the moment after a build: the service repos are checked out and you want to start
them, reach one, read its health, reproduce a failure and decide who owns the fault. Everything runs
on your machine with your own tools. Genesis never runs or deploys anything for you. For shipping
to a real slot see [deploy.md](deploy.md); for the build answers see [compile-results.md](compile-results.md).

## 1. What you have

- One git repo per service, `<codename>-<service>-service`, in your own account. Check them out
  side by side in one parent folder; the compose stack of section 4 expects that layout.
- The repo is the compiler's output plus your own files. You never edit generated files: the next
  build overwrites them. Extension goes through custom code, see [custom-code.md](custom-code.md).
- Env files (nodejs): `.dev.env`, `.test.env`, `.stage.env`, `.prod.env` are committed with secret
  keys left blank; `.<slot>.secrets.env` is your gitignored keystore. There is no `.exp.*` file.
- `Dockerfile.dev` builds the local image; `Dockerfile.prod` is the production image.
- Treat the checkout as a build artifact: after any new build of that service, pull it before you
  debug. A checkout at an older commit cannot reproduce a failure of a newer one.

## 2. Env resolution (why a value is not what the file says)

Order, strongest first:

```
non-empty variable in the process environment (shell, compose, orchestrator)
  > .<slot>.secrets.env       (your local keystore)
  > .<slot>.env               (committed slot file)
```

- `SERVICE_CONFIG` selects the slot file at boot; the default is `test`. The nodejs scripts set it:
  `npm run dev` (ts-node) and `npm run start-dev` (built `dist/`) run the `dev` slot,
  `start-stage` / `start-prod` the others; plain `npm start` runs `test`.
- The env files load through dotenv, which does not override a variable that is already set. That
  is why one tree runs natively (file values) and in compose (container values) unchanged.
- A variable the process holds EMPTY is not filled from the slot file, but the keystore still
  fills it. A secret you put in the keystore therefore does not win over a non-empty injected one.
- If a key looks ignored, print what the process really holds before editing files: the shell
  value or the compose `environment:` entry is usually the one that won.
- Slots `test`, `stage` and `prod` carry EMPTY peer addresses (`SERVICE_URL`, `AUTH_SERVICE_URL`,
  `SERVICE_<NAME>_URL`, `SERVICE_MCPBFF_URL`); the deployer fills them. `dev` keeps local ones.
  The JWT public key URL is `AUTH_SERVICE_URL` + `/publickey`.
- Never copy a secrets file into a commit, an issue, a log or a bug report.

## 3. Ports and signing keys

Dev ports (every `.dev.env` sibling URL is built from them):

| Service | Port |
|---|---|
| `auth` | 3001 |
| `bff` | 3002 |
| `notification` | 3003 |
| `document` | 3004 |
| `agenthub` | 3006 |
| `mcpbff` | 3600 |
| business services | 3050, 3051, ... in blueprint order |

Check the real value in the service's `.dev.env` (`HTTP_PORT`) before you rely on the table.

Signing keys: each service signs its tokens with its own Ed25519 key, in `SERVICE_PRIVATE_KEY_PEM`
and `SERVICE_KID` (in compose: `<SVC>_SERVICE_PRIVATE_KEY_PEM` and `<SVC>_SERVICE_KID`).
Without one the service starts degraded and the login service cannot issue sessions.

```sh
openssl genpkey -algorithm ed25519 -out key.pem    # PKCS#8 PEM
uuidgen                                             # any UUID works as the key id
```

Put the PEM in double quotes when it goes into a `.env`. Keys are yours; the compiler never
holds them.

## 4. Start the stack

Two ways. Pick by what you need.

### 4a. The `docker-compose` deploy target (all services, one command)

Ask for it in the build request (`deployTargets`, see [compiler-api.md](compiler-api.md)). It lands
in every service repo under `deploy/docker-compose/`:

- `docker-compose.yml`, `.env.example`, `.providers.secrets.env.example`, `README.md`.
- Every deployable service of the build, each built from its own repo at `../../../<repo>`
  (the repo you stand in is `../..`), running its DEV slot image.
- Infrastructure by need: PostgreSQL (PostGIS 16) and/or MongoDB 7 by the service's `dbType`;
  Redis 7 and Elasticsearch for every backend service; Kafka 3.7 (KRaft) for all.
  They are reachable inside the compose network only; nothing but the services publishes a port.
- Every password is a `${VAR}` reference; no secret value is written into the files.

```sh
cd deploy/docker-compose
cp .env.example .env
cp .providers.secrets.env.example .providers.secrets.env
# fill .env: POSTGRES_PASSWORD (and MONGO_PASSWORD), the signing keys per service
docker compose up --build
```

- Needs Docker Compose 2.24 or later (optional `env_file`). `.env` and `.providers.secrets.env`
  are gitignored.
- The MongoDB password goes into a connection URL: use a URL-safe one.
- Container env wins over the baked slot file. The stack sets, per service: `DB_HOST`, `DB_PORT`,
  `DB_USER`, `DB_PASSWORD` (or `MONGO_URL`), `REDIS_URL`, `ELASTIC_HOST`, `KAFKA_BROKERS`,
  `KAFKA_ENABLED_IN_DEV=true` (the dev slot keeps Kafka off otherwise), `AUTH_SERVICE_URL` and
  `SERVICE_<NAME>_URL` as `http://<service>:<port>` for peers inside the stack.
- A peer the build does not include is `${KEY:-}`, an empty line you fill in `.env` if you run
  that peer somewhere else. A missing address shows up later as an inter-service error.
- Provider credentials (payment, mail, storage) are passed to every service from one file. Add the
  keys the other repos list in their own example file. A provider without a credential runs
  degraded; that is expected until you add one.
- Never ask the user to paste a credential into the chat. Ask for it on the local key page instead:
  1. `genesis_requestKey` with a name, a label and where the user gets the key.
  2. Give the user the link it answers.
  3. Check `genesis_listKeys` until the key is set.
  4. `genesis_writeKeyToEnvFile` puts it into the gitignored env file (`.env`,
     `.providers.secrets.env` or another `*.secrets.env`) without the value passing through you.
- The stack runs a `mail-sink` service (Mailpit): the mail the services cannot deliver, and every
  SMS with no SMS provider (sent to the sink as a mail), lands there with nothing to configure.
  Read it at `http://localhost:8025`.
- Compose project name is the codename. Use `docker compose ps` and `docker compose logs -f <service>`
  with the compose service names from `docker-compose.yml`.
- Stop with `docker compose down` (volumes kept); `down -v` wipes the data, which is your decision.

### Mail and SMS while you run locally

A service with no complete email provider sends its mail (verification codes, password resets,
notifications), and an SMS with no SMS provider, to the mail sink at `MAILSINK_HOST` /
`MAILSINK_PORT` (default `mail-sink:465`). Nothing listens there on your machine, so start one:

- `genesis board` in the project folder runs a sink on `127.0.0.1:10465` while the board is open,
  and the board's **Mail** tab lists every message with its text and the codes in it.
- Start the services with `MAILSINK_HOST=127.0.0.1 MAILSINK_PORT=10465`.

Never put a real email provider's key into a local env file just to read a code: the sink is
for that. See [pitfalls.md](pitfalls.md) section 3.

### 4b. One service as a native process (fastest loop)

Use it when you reproduce one service and its siblings run elsewhere.

1. Start the infrastructure the service's `.dev.env` names (`DB_HOST`, `REDIS_URL`, `ELASTIC_HOST`,
   `KAFKA_BROKERS`, or `MONGO_URL`). The simplest source is the same compose file: bring up only
   the infra services (`docker compose up -d postgres redis elasticsearch kafka`), then publish
   their ports yourself if the compose file does not (it does not by default).
2. `npm install` in the repo once, then `npm run dev` (or `npm run build` and `npm run start-dev`).
3. The service binds its own port. Every sibling the request path calls must also be running, on
   its own dev port or in compose, and its address must be in this service's env.
4. Kafka advertises the in-network name `kafka:9092`. A native process on the host cannot resolve
   it unless `kafka` maps to `127.0.0.1` in `/etc/hosts`. Say so when a Kafka-consuming service runs
   natively and does not get its events.

### 4c. No container runtime on the machine

Both ways above need a container runtime for the infrastructure. Check it first:
`docker info` (or `docker compose version`). When it is missing or the daemon is not running,
do not guess. Tell the user and offer the two ways below.

**1. Install a runtime (recommended).**

The user installs it; the installer asks for an administrator password and a licence acceptance,
which are the user's to give. You may name the download page or prepare the package-manager
command; run it only when the user says so, and never type their password.

| OS | Runtime | Notes |
|---|---|---|
| macOS | OrbStack (`brew install --cask orbstack`) or Docker Desktop | OrbStack is lighter; it is paid for commercial use. |
| Linux | Docker Engine from the distribution's or Docker's packages | The user then joins the `docker` group or uses `sudo`. |
| Windows | Docker Desktop with the WSL 2 backend | Run the stack inside WSL 2. |

- Docker Desktop is paid for larger companies (its subscription terms decide); say so, and
  let the user choose.
- After the install: start the runtime and run `docker info` again. Then continue with 4a or 4b.

**2. One service natively, with the database only.**

Only the database is critical at boot (section 6). Redis, Elasticsearch and Kafka are optional,
so one service can run with just a PostgreSQL (or MongoDB) and no container at all.

1. **A database.** Either one installed on the machine (for example `brew install postgresql@16`
   and `brew services start postgresql@16`) or a hosted one the user creates in their own
   account.
2. **Its address.** Put `DB_HOST`, `DB_PORT`, `DB_USER` and `DB_PASSWORD` (for MongoDB,
   `MONGO_URL`) in the gitignored `.dev.secrets.env` or in the shell environment. Both win over
   the committed `.dev.env` (section 2), which you never edit. The service creates its own
   database on the server.
3. **Start it.** `npm install`, then `npm run dev` (4b).

Say what is missing before you report anything:

- Without Redis there is no cache.
- Without Elasticsearch the reads that use it answer `503 ELASTIC_UNAVAILABLE`.
- Without Kafka no event is published or consumed, so event-driven flows and their tests cannot
  pass.

A test that needs a missing dependency is reported as skipped with the reason, never as passed.

## 5. Resource checklist (before `up`)

- RAM: the infrastructure alone takes about 3 GB (Elasticsearch heap is set to 512 MB); each node
  service needs 200-400 MB more. Give Docker 6 GB or more and run only the services the
  reproduction needs.
- Ports: each service publishes its own dev port; free them first (`lsof -i :<port>`). Two stacks
  of different projects on one machine collide on the same dev ports: run one at a time or change
  the published port in the compose file you own.
- One heavy job at a time on one machine: not a full stack, a test run and a build together.
- Report what is left running when you stop.

## 6. Health: alive is not ready

`GET http://localhost:<port>/health` answers 200 `{"status":"ok"}` as soon as the port is bound, and
in every boot state. That is liveness only. Read the whole body:

| Field | Meaning |
|---|---|
| `readiness.ready` | `false` until the boot chain finished |
| `readiness.schema` | the schema step outcome; `ready:false` with a failed schema means every request that touches a missing table fails |
| `boot.state` | `starting`, `ready` or `degraded` |
| `boot.bootErrors[]` | `step`, `code`, `critical`, `retryable`, `attempts`, `lastAttemptAt`, `nextRetryAt` |

- Nothing is "running" until `boot.state` is `ready` and `readiness.ready` is `true`.
- While starting, every other route answers `503 SERVICE_STARTING`. When a critical step fails,
  every other route answers `503 SERVICE_DEGRADED` with a `requestId` and `Retry-After`, and the
  body does not name the cause. The cause is in `/health` (`code`) and in the service log.
- The service never exits on a boot error. It logs and keeps answering. Do not wait for a crash.
- Public codes: `DB_UNREACHABLE`, `DB_AUTH_FAILED`, `SCHEMA_FAILED`, `CONFIG_ENV_INVALID`,
  `CONFIG_INVALID`, `IDENTITY_KEY_MISSING`, `PORT_IN_USE`, `BUILD_INCOMPLETE`,
  `DEPENDENCY_UNSUPPORTED`, `STEP_FAILED`.
- `SchemaBootstrapFailed` and `ModelSyncFailed` in the log mean the schema did not materialise
  (for example a permission or missing-table fault). Waiting or restarting does not fix it: fix the
  database or the design, then rebuild.
- A pending migration, an absent optional Elasticsearch or Kafka, never make `ready` false.
- Do not probe business endpoints to "verify" the boot. They need auth, bodies and fixtures, and
  answer 401/403/400/404 for reasons that teach nothing. Use the health body, then the test suite.

Boot verdicts by dependency (nodejs):

| Step | Failure | Verdict | Retried |
|---|---|---|---|
| `postgres`, `mongodb` | refused or timed out | critical `DB_UNREACHABLE` | yes, background |
| `postgres`, `mongodb` | credential refused | critical `DB_AUTH_FAILED` | yes |
| `mongodb` | malformed `MONGO_URL` | critical `CONFIG_INVALID` | no |
| `migrations` | lock or schema step failed | critical `SCHEMA_FAILED` | yes |
| `service-identity` | no `SERVICE_KID` / `SERVICE_PRIVATE_KEY_PEM` on a login-minting service | critical `IDENTITY_KEY_MISSING` | no |
| `models` | a model definition throws | critical `STEP_FAILED` | no (a generated-code defect: report it) |
| `redis` | unreachable after its attempts | optional; runs without cache | no |
| `elastic`, `kafka` | unreachable | optional; heals on its own | yes |
| `elastic` | endpoint is not Elasticsearch | optional `DEPENDENCY_UNSUPPORTED`; reads answer `503 ELASTIC_UNAVAILABLE` | no |

`/admin/health` carries the full, redacted detail but is gated; use the log if you cannot reach it.

## 7. Dependencies that start late

A cold start where the database is a second behind is normal; the service heals without a restart.

- Kafka, Elasticsearch: unbounded background retry, boot never blocked. Env: `KAFKA_RECONNECT_INTERVAL_MS`
  (5000) and `KAFKA_RECONNECT_MAX_INTERVAL_MS` (60000); `ELASTIC_RECONNECT_INTERVAL_MS` (5000) and
  `ELASTIC_RECONNECT_MAX_INTERVAL_MS` (60000). A literal `0` on a `*_MAX_INTERVAL_MS` opts out.
  `/health` echoes `{connected, reason?}` for each, so "still converging" differs from "misconfigured".
- Redis, Postgres: a short bounded retry inside boot (`REDIS_RECONNECT_*`, `DB_RECONNECT_*`; defaults
  3 attempts, 1s initial, 8s cap; `*_MAX_ATTEMPTS=1` tries once; the budget is capped at 20). When it is
  spent, Postgres runs degraded and the boot supervisor retries in the background
  (`BOOTSTRAP_RETRY_INTERVAL_MS` 5000 rising to `BOOTSTRAP_RETRY_MAX_INTERVAL_MS` 60000).
- Blank, negative or non-decimal values count as unset; intervals have a 1000 ms floor.
- Close budgets (`DB_CLOSE_TIMEOUT_MS`, `ELASTIC_CLOSE_TIMEOUT_MS`, `KAFKA_CLOSE_TIMEOUT_MS`,
  `REDIS_CLOSE_TIMEOUT_MS`, `MONGO_CLOSE_TIMEOUT_MS`, default 5000) only matter for slow shutdowns.
- Retry lines are `warn`, not `error`; the verdict lines to alert on are `redisStartFailed`,
  `postgresStartFailed` and `BootstrapDegraded`. A permanent Kafka/Elasticsearch outage logs one loud
  line about every tenth attempt once the backoff has settled.
- Shutdown on `SIGTERM` is graceful and exits 0; that is the only exit.

## 8. Reproduce a failure

1. Capture the failing call exactly: method, path, body, which actor, the response (`status`, the
   error code and message) and its `requestId`. Find the log line with the same `requestId`: it
   names the stage and the generated file that threw. Keep the excerpt as the comparison target.
2. Confirm the commit: the checkout you run is the commit of the build you are debugging.
3. Decide the running set: every sibling the request path calls must run too. An inter-service error
   that your original failure did not show is your setup, not the defect.
4. Bootstrap identity locally: the service seeds its bootstrap super admin from the env it booted
   with; the password is the one in your blueprint or `$ENV:` reference. Customer and staff actors
   come from your own register, verify, login and role-grant calls.
5. Replay the one failing case, ideally from your test suite ([testing.md](testing.md)), not by hand.
   Same error and same stack in the local log means reproduced. A different symptom means your local
   setup differs (env, data, a missing sibling); do not go on until they match.
6. Instrument on a throwaway copy: log the assembled `dataClause` / `whereClause` in the api manager
   the stack names, run `node --inspect`, rerun the one case. Narrow it to one of three owners
   (section 9).
7. Read logs the same way each time: native, the process stdout; compose, `docker compose logs -f`.
   Quote the original line and the local line together.
8. Inspect state directly when the log is not enough: query the service's database, its Redis keys,
   its Kafka topic or Elasticsearch index with your own client against the local infrastructure.
   Compose publishes no infra ports by default, so run the client inside the network
   (`docker compose exec <infra> ...`).

Payment and subscription runtime checks (webhook, mock provider, state ladder) have their own
ladders: follow the Genesis additions in the `genesis/procedures/` folder of this corpus (the
payment and subscription files, and its index) instead of repeating them here.

## 9. Whose fault is it, and where the fix goes

| You found | Owner | Action |
|---|---|---|
| An authored slot is wrong: an MScript expression, a where column, an action's parameters, a role or route | Blueprint | Fix the blueprint, validate, rebuild, pull, rerun. Discard the local experiment. |
| Your custom code (a library or edge function body in the blueprint) | Custom code | Fix it in the blueprint ([custom-code.md](custom-code.md)), validate, rebuild. |
| A file you added to the repo, or under `service-files/` | You | Fix it in place; it survives rebuilds. |
| A generated framework line mishandles a legal input, or a model/route fails to compile or load | Compiler | Report it with the evidence below. Do not patch the generated file. |
| Missing env, key, provider credential or peer address | Your deployment | Fix env or keys; nothing to rebuild. |

Report a compiler fault with: the request id or build job id of the build, the repo and commit, the
generated file and line, the input that reaches it, the local log line and the original `requestId`.
A local reproduction is the strongest report; file it before you ship any workaround.

Never:

- hand-edit a generated file as a durable fix (it is overwritten and counted at the next build);
- weaken a blueprint or test just to get green; classify the red first;
- copy an env or secrets file into a commit, a report or a chat;
- treat a local edit that confirmed the diagnosis as the fix. The fix lands in the blueprint or in
  your custom code, then a rebuild ships it.

## 10. Checklist

- [ ] Checkouts at the commit of the build being debugged; container runtime (`docker info`), RAM and ports checked, or the no-runtime way of 4c chosen with the user.
- [ ] `.env` filled: passwords and one Ed25519 key and key id per service.
- [ ] Every service `boot.state: ready` and `readiness.ready: true`, not just 200 OK.
- [ ] Failure reproduced with the same symptom, or reported as not reproduced.
- [ ] Owner decided: blueprint, custom code, compiler, deployment; fix routed there.
- [ ] Stack stopped, or the running state reported.
