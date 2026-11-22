# Genesis pitfalls: compiler facts

Behaviours of the code Genesis generates that surprise people who run it themselves. Each
entry: symptom, cause, what to do. Entries marked **nodejs** are verified for the nodejs
runtime only; other languages follow in their own time. Facts about HTTP shapes, seeding and
stale reads are in `procedures/pitfalls.md` (mind-set); this page adds what changes because
you run the service on your own machine or servers. Run steps are in
[run-locally.md](run-locally.md), failed builds in [compile-results.md](compile-results.md).

## 1. The slot decides everything: `CONFIG_ENV`

The generated service learns which environment it is in from `CONFIG_ENV`, written into each
slot file (`.dev.env` has `dev`, `.test.env` `test`, `.stage.env` `stage`, `.prod.env`
`prod`). Several behaviours below depend on it.

- **Unset or empty `CONFIG_ENV` resolves to `prod`**, with a loud console error. The service
  keeps running, with the strictest behaviour (no verification codes in answers, no SMS sink).
  A local run must load `.dev.env` or set `CONFIG_ENV=dev`.
- **A value it does not know throws** at start (a typo such as `prd`). Fix the deployment;
  the service does not guess. Accepted: `dev`, `test`, `stage`, `prod` and the older
  aliases `development`, `local`, `staging`, `production`.
- The slot is the only input. No header, body field or blueprint setting changes it, and the
  blueprint's `verificationMode` is retired (a value other than the default only draws the
  warning `VERIFICATION_MODE_INERT`).

## 2. Verification codes in the start answer (nodejs)

**Symptom:** a flow answers `emailVerificationNeeded` and no code reaches you, or the
`secretCode` is missing from the start answer.

**Cause:** the code is echoed in the `start` answer (with the `userId`, for an existing
account) only when the slot is `dev` or `test`. In `stage` and `prod` it is never in the
answer, whatever the blueprint says: it travels only through the real mail or SMS provider,
or lands in a sink (sections 3 and 4).

**Do:**

- Locally (`dev`), chain the two calls as `procedures/pitfalls.md` shows: `start`, then
  `complete` with the returned `secretCode` as a string.
- On a `stage` or `prod` slot, read the code from the real inbox or handset when the
  provider has credentials, otherwise from the mail sink. Do not set the slot to `dev` on a
  reachable deployment to get codes: that is the one switch that turns the echo on.
- A missing `secretCode` on a `dev` or `test` slot for an existing account is worth
  checking against `CONFIG_ENV` first (section 1), then reporting with the request and answer.
- A `start` answered 403 "too frequent" means a recent code exists. Wait or use another
  account.

## 3. Mail falls to a sink, and a green send is not delivery (nodejs)

**Symptom:** verification and notification mails "send" and nobody receives them; or every
send fails with an SMTP connect error to `mail-sink`.

**Cause, in four parts:**

1. An email provider declared only under `mailAccounts` is NOT a send channel. A project with
   no complete email provider (declared with all credential keys) has no real channel at all.
   Validation warns once with `MAIL_FLOWS_GO_TO_SINK`.
2. With no complete email provider the framework routes every notification and every
   verification mail to its built-in mock SMTP sink (the delivery rows name the provider
   `__mailsink__`). It does so in every slot, `prod` included.
3. The sink is an SMTP host the environment must provide. The default address is
   `mail-sink` port `465`; `MAILSINK_HOST` and `MAILSINK_PORT` point the service at another
   one, `MAILSINK_REJECT_UNAUTHORIZED` is for a sink with a certificate the service does not
   trust.
4. The generated `deploy/docker-compose/` stack runs a `mail-sink` service (Mailpit) and sets
   `MAILSINK_HOST=mail-sink` / `MAILSINK_PORT=465` for its services, the way it sets
   `DB_HOST=postgres`; read the mail at `http://localhost:8025`. The dev slot (`.dev.env`) of a
   current build names the local sink `localhost:10465` for a service run natively. A stack
   from an older build lists no mail-sink service: there the send fails after retries, one
   `failed` delivery row per message. It looks like an outage; it is the same missing channel
   seen from the other side. Rebuild with the `docker-compose` target, or start a sink yourself.

**Do:**

- For development, the mail sink is infrastructure like the database: never edit the generated
  env to reach one.
  - **The docker-compose stack:** it runs its own (`docker compose up`).
  - **A service run natively:** its `.dev.env` already names `localhost:10465`. Start the same
    Mailpit there (run-locally.md, "Mail and SMS while you run locally").

  The project board's Mail tab (`genesis board`) reads the sink, with the codes picked out.
- Judge mail by the channel, never by the send status: success against the sink means
  "stored in the sink", not "reached a recipient".
- For stage and production, declare a real email provider in the blueprint and give it its
  credentials (`$ENV:` references in the blueprint, values in the service's secrets file).
- Reserved demo recipients can force the sink even with complete credentials. If a real
  address gets nothing, check the recipient.

## 4. SMS: sink rules differ from mail (nodejs)

- An SMS provider that is declared but has incomplete credentials sends to the **SMS sink**
  when `CONFIG_ENV` is set and is not `prod`. In `prod` it never falls back: the send fails at
  the provider and the boot report names it.
- The SMS sink stores each message in the same mail sink as section 3: one mail per SMS to
  `sms-<digits>@sms-sink.invalid` (digits of the number only), subject `SMS to <number>`,
  provider name `__smssink__`. Search the inbox by the number. It needs the same sink host.
- A project with **no SMS provider declared at all** still builds the mobile flows, and every
  SMS goes to the sink in every slot, `prod` included (validation warns once with
  `SMS_FLOWS_GO_TO_SINK`). Name the real SMS provider before production.
- A sunk SMS was not delivered to a handset.

## 5. Credential fallbacks, and what each one proves (nodejs)

Missing credentials never stop the service. The runtime falls back, per family:

| Family | With credentials missing or incomplete |
|---|---|
| mail | the mail sink (section 3), every slot |
| SMS | the SMS sink on non-prod slots (section 4) |
| bucket | the service's own native store |
| payment | the provider's mock, for `stripe`, `iyzico` and `adyen`; other brands have no mock and REFUSE at payment start |
| AI | no fallback: the call fails |

Use the four evidence outcomes when you report a provider. Never put key values in the
report.

| Outcome | Evidence | What it proves |
|---|---|---|
| Configured test provider | a declared test brand or transport and an observed operation | only that test path |
| Selected fallback | the runtime's own status names the sink / native / mock mode and the reason | the fallback, not vendor delivery |
| Placeholder-only | a required secret is still `ENTER_CREDENTIAL` or absent | the provider is bound; the real operation is unverified |
| Measured delivery | the real operation plus a receipt or captured artifact | that operation in that slot; a sink capture is not a recipient's delivery |

Rules:

- `ENTER_CREDENTIAL` is the placeholder for a secret that is not provided. It passes
  authoring and counts as "not configured" at runtime; it is no proof of anything. A
  realistic fake value is worse than the placeholder: it looks configured.
- A required key that is NOT a secret (a sender address on your own domain) takes the real
  value, never the placeholder: a placeholder there reads as a value and the provider fails at
  send time with nothing warning first.
- `<PREFIX>_CREDENTIAL_MODE` in a slot's environment (`auto`, `sandbox`, `live`, `mock`) is
  read BEFORE the credential check: `mock` engages the mock or sink whatever credentials are
  present; `live` lifts the payment live-key guard on a non-prod slot. Unrecognised or blank
  means `auto`.
- A payment live key in a non-prod slot is refused by a guard unless the mode is `live`.
  Keep live keys in the `prod` slot's secrets file only.
- Check what the service decided, not what you configured: `GET /health` carries a
  `providerCredentials` block (`status` `ok` / `incomplete` / `error`, `deploymentEnv`,
  `providerCount`, `findings`), and the payment service serves
  `GET /<order-service>-api/v1/payments/mock-status` (one row per provider with `mock`,
  `reason`, `transport`, `blocking`; plus `anyMock`, `blocking`, `health`). Read your
  provider's row. `transport: "absent"` means the brand has no mock and payment start
  refuses.
- Never call a live provider from a test. The runtime ladders for payments and
  subscriptions are in `procedures/howto-payment-flow.md`, with the Genesis additions in
  `genesis/procedures/howto-payment-flow.md` of this corpus.

## 6. Payment tables need auth compiled after the provider is bound

**Symptom:** starting a payment answers 500 through a missing `/auth-api/paymentcustomers`.

**Cause:** the auth service's payment tables (`sys_paymentCustomer`, `sys_paymentMethod`) and
their routes are generated only when a payment provider is bound in the blueprint. An auth
service compiled before the provider was bound does not have them.

**Do:** bind the provider, validate, compile `auth` again, re-run the service from the new
code (and rebuild its image if you deploy images). Then retry the payment start.

## 7. `column "x" does not exist` is schema drift

**Symptom:** a 500 whose message says `column "x" does not exist` or `relation "x" does not
exist`.

**Cause:** the database schema is behind the generated models: the code was regenerated and
the running service or its database was not brought forward.

**Do:** run the newly generated code and let it start: boot re-syncs the schema. Check
`GET /health` `readiness` afterwards (see [compile-results.md](compile-results.md) section 9).
Never hand-write `ALTER`, `DROP` or `TRUNCATE` to fix drift. If a restart on fresh code does
not clear it, report the exact message. A 500 with `Cannot read properties of undefined` or an
MScript error is NOT drift: the cause is in the code path.

## 8. Each service needs its own signing key

**Symptom:** the login service starts but issues no session; other services reject tokens.

**Cause:** every service signs its tokens with its own Ed25519 key. Without
`SERVICE_PRIVATE_KEY_PEM` and `SERVICE_KID` (in compose: `<SVC>_SERVICE_PRIVATE_KEY_PEM`,
`<SVC>_SERVICE_KID`) the service starts degraded.

**Do:** generate one per service (`openssl genpkey -algorithm ed25519`), pick any UUID as the
key id, keep both in the service's gitignored secrets file or the deployer's secret store.
Every other service reads the public key from the auth service at `AUTH_SERVICE_URL` +
`/publickey`.

## 9. Empty peer addresses in test, stage and prod

**Symptom:** a service starts and `/health` is fine, but calls to another service, token
checks or links fail; documents show `<codename>-stage.example`.

**Cause:** in the `test`, `stage` and `prod` slot files, `SERVICE_URL`, `AUTH_SERVICE_URL`,
`SERVICE_<NAME>_URL` and `SERVICE_MCPBFF_URL` are empty lines on purpose. The `dev` slot keeps
local addresses. Document hosts use the reserved `.example` names.

**Do:** pass the real addresses as container environment variables (they override the file).
`GEOIP_SERVICE_URL` stays empty (lookup off) until you provide one. Buckets with a virus scan
get `CLAMAV_ENABLED=false` unless the blueprint gave its own host or url: turn it on only
with a scanner you run.

## 10. The service never exits at boot

**Symptom:** the process is up, the port answers, every request returns a generic error.

**Cause:** a missing dependency or credential does not stop a generated service. A "critical"
problem makes every request fail with a generic error. Silence at boot is not health.

**Do:** read the service log first, then `GET /health` (liveness, `readiness`, the dependency
checks for the database, Redis and Elasticsearch where the service uses them, and
`providerCredentials`). Fix the named cause, restart.

## 11. Scheduled work (nodejs unless noted)

- A cron controller or service cron job runs on **one replica per tick** by default: each tick
  is claimed in the `sys_cronJobRun` table. With `"singleReplica": false`, and for every
  non-nodejs language, the job runs on EVERY replica. Three replicas then run three times
  per tick. One local container hides this.
- An edge controller's `edgeCronSettings` schedules nothing (warning `EDGE_CRON_NOT_SCHEDULED`).
  Use a cron job.
- A `onceEver` job that has succeeded never runs again, even after a redeploy: its manual
  run route answers 409, and `{ "force": true }` works only for a superAdmin session.
  Renaming the job starts a new history and runs it again.
- A run-once data move must be safe to repeat: a failed or timed out run leaves part of the
  data moved and the next tick retries, nothing is rolled back. Back up first and check
  `GET /cron-jobs/<name>/runs`.
- `timeoutSeconds` does not kill the function: the run is recorded `timed_out` and
  `ctx.signal` fires. A function that ignores the signal keeps running; check
  `ctx.signal.aborted` between batches.
- Edge REST paths are served below `/edge` (or `EDGE_MOUNT_PATH` when the deployment sets it):
  do not repeat `/edge` in the declared path.

## 12. Build-side facts that look like runtime faults

- Files you add to a generated repo survive every rebuild; edits to generated files do not
  (the build counts them in `manifest.editedFilesOverwritten`). A "fix" in generated code
  that vanishes after the next build is this, not a regression.
- A rebuilt service needs a restart of the running copy; a blueprint edit is not live until
  it was compiled, pulled into the repo, and the service restarted on it.
- Compiling `auth` first matters when other services read its user, tenant and role shapes;
  after a change to those, compile the dependants again.
