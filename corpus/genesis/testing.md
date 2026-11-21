# Testing the generated services and seeding sample data

How to prove that the services Genesis generated do what the blueprint says, and how to fill
a running stack with a small, believable dataset. Genesis runs nothing for you: the suite and
the seed are code in your own repo, run against your own stack (see [run-locally.md](run-locally.md)),
and they read your own logs and database when a case goes red.

For the plan and the report documents that mind-set writes, see
`procedures/design/writers/test-plan.md` and `procedures/design/writers/test-report.md`
(schema: `procedures/design/schemas/test-report.v1.json`). This page does not repeat them; it
covers the suite itself.

## 1. What the suite is

- Plain Node (>= 20) ES modules under `tests/` in a repo you own (for example
  `<codename>-tests`). No test framework, no dependencies.
- It drives the public HTTP surface the way a client does: real registration and login, real
  fixtures built through the APIs, one observable assertion per designer API.
- It is not a unit test of generated code, and it never writes rows straight into the database.
  A row the API could not have created proves nothing and pollutes later cases.
- It proves: every designer API has a case that passed, or a skip with a stated reason, and the
  number of APIs with neither is zero. Completeness comes from a script, never from your own claim.

Layout:

```
tests/
  helpers/config.mjs     base URLs per service, User-Agent, random suffix, credential resolution
  helpers/http.mjs       JSON in/out, bearer token, brief() for evidence
  helpers/asserts.mjs    status checks, envelope unwrap, list/get envelope checks
  helpers/runner.mjs     Suite(service).case(api, title, fn) / .skip(api, reason)
  helpers/session.mjs    identity bootstrap (section 5), SkipError
  helpers/fixtures.mjs   cross-service fixtures, built once per process (section 6)
  <service>.flow.mjs     ONE per service, runnable alone
  run-all.mjs            every flow in one process, in dependency order -> report.json
  coverage-gate.mjs      API list vs report.json; exit 0 only at 0 MISSING
  inventory/<service>.json   the committed route lists the gate reads
  seed/seed-sample-data.mjs  the sample-data seed (section 10)
```

Commit `inventory/` so a revision's gate can be reproduced. Git-ignore `report.json`.

## 2. Conventions that make the gate computable

- **Case key = `(service, apiName)`**, with `apiName` copied verbatim from the blueprint (and the
  service spec's Business APIs section). One case per API is the minimum; extra cases are fine
  and count as "extra".
- **The population** is every designer-authored API of every service, including APIs authored on
  `auth`. A framework built-in of a system service (auth's `login`, `register`, `currentUser`,
  `mintSessionForUser`, the api-key and machine-session routes, the notification, agent-hub and
  bff surfaces) counts only when the test plan lists that flow; a listed built-in the product
  does not use gets a `BUILT-IN-UNUSED` skip (section 8). An unlisted built-in is out of scope,
  never MISSING.
- **Copy routes, never compose them.** The method and path of a case come from the route list the
  generated service ships, not from the API name or a guess:
  - `_api.json` at the root of the service repo: one JSON file listing every HTTP, socket and SSE
    endpoint (`operationId`, `method`, `path`, auth, path/query parameters, request and response
    shapes, the tenant header where the API reads the session tenant). Read it without booting the
    service.
  - `GET /openapi.json` (and `/swagger` for a browser) on the running service: the same surface
    as OpenAPI 3.
  Framework auth routes have their own shapes (`/login`, `/register`, ...); custom business APIs
  mount under `/v1/`. `serviceBase(service)` in `config.mjs` is the only place that knows how a
  service is addressed on your stack (local ports, a gateway, or the container URLs your deployer
  set).
- **Send a `User-Agent` header on every request.** Many front doors refuse the default
  `curl` / `python` / `node` agents (Cloudflare error 1010); without one the suite fails before
  the first assertion and looks like an outage.
- **Anchor dates to the real today** (`procedures/pitfalls.md`). Put a random per-process suffix in
  every id, SKU, slug and email so re-runs never hit a unique index.
- **Accept the 200 family** where the API answers 201 (register, login, most creates):
  `expectStatus(res, [200, 201])`. The session and list envelopes are in `procedures/pitfalls.md`.
- **No secret in a tracked file.** `brief()` truncates bodies and never prints headers. No token,
  password or provider key is logged, reported or committed. Fake tokens in negative auth cases
  are fine.

## 3. Scaffold, then fill

Never author the whole suite in one output. The order follows what each piece reads:

1. **Route list.** For every service (system services too), copy the route rows from `_api.json`
   into `inventory/<service>.json` next to the blueprint's API names. The dump is stale after any
   rebuild of that service: refresh it before you gate again.
2. **Helpers once, then `auth.flow.mjs`.** Every other flow gets its sessions from it. Run it
   alone (`node tests/auth.flow.mjs`) until the identity bootstrap of section 5 is green.
3. **One flow per service in dependency order** (catalog before order before review; bff and
   notification last). Per API: read the route row, write the case (fixtures, one call, one
   observable assertion), run that flow, fix, next API. Kafka-only, cron-only, internal-only and
   machine-only rows are driven through the test transport of section 7, not skipped.
4. **`node tests/run-all.mjs`**, then **`node tests/coverage-gate.mjs`**. The gate's MISSING list
   is the fill queue; the loop ends at `GATE: PASS`.

Every case has one shape: get a session (`ctx.customer()`, `ctx.staff()`, `ctx.superAdmin()`),
get the fixture it needs, make ONE call, assert the status and the one thing the API promises
(an `id` in the list rows, a transition's resulting state, a 403 for the wrong role on a
role-gated API).

### A 2xx is not the whole verdict on a write

A create, update or delete whose row committed but whose post-write actions did not all
complete answers `200` / `201` WITH an `actionFailures: [{ action, error, retryable?, errorCode?, outbox? }]`
member. So:

- Every write case asserts `body.actionFailures === undefined` next to the status; do it once in
  the helper that reads a single-item body.
- When it is present, **the row exists. Never re-run a create to "retry" it**: that makes a second
  row (one pilot stranded 17 that way). The case fails, naming each `action` and `error`; triage
  reads the named action, not the status.
- `outbox: "queued"` (a dropped event the service republishes itself) is the one entry a case may
  tolerate, and only when it asserts nothing downstream of that event.
- `errorCode: "ACTION_NOT_RUN"` entries are consequences: fix the first entry and they go away.

### An approval-gated API answers `403 APPROVAL_REQUIRED` first

An API whose blueprint sets `authOptions.requireApproval` answers its first call with `403` and
`errorCode: "APPROVAL_REQUIRED"`, sends a one-time code to the caller's verified email or mobile,
and runs only when the SAME request (same parameters, same user) is repeated with the headers
`api-approval-id` and `api-approval-code`. That is a step, never a red.

The challenge is in the problem body's `errors` member: `{ approvalId, channel, codeIndex,
expireTime, expiresAt, actionName, actionDescription }`, plus `secretCode` only where the service
runs in a dev-like environment (the dev slot). On stage and prod the code is never echoed.

Keep one helper, `approvedCall(method, url, body, token)`:

1. Make the call. Anything other than `403` + `APPROVAL_REQUIRED` is returned as is.
2. On the challenge, read `errors.approvalId` and `errors.secretCode`. With no `secretCode`, assert
   the challenge shape and throw `SkipError('ENVIRONMENT: approval code not echoed on <env> - the challenge is the evidence')`.
   Never guess a code.
3. Repeat the identical call with the two headers and return that response, plus the challenge
   facts for the case to assert on.

A case on such an API asserts both legs: the first answer was the challenge, and the retry is the
API's normal success. Never widen a status set to `[200, 403]`; never retry with changed
parameters (that is `403 APPROVAL_INVALID` by design, worth one negative case). The other answers:

| Answer | Meaning |
|---|---|
| `403 APPROVAL_INVALID` | wrong, used or expired code, or changed input; the approval is gone after 5 attempts |
| `429 APPROVAL_RESEND_WINDOW` | a code for a different input went out under a minute ago: wait, or finish the first approval |
| `403 APPROVAL_NOT_AVAILABLE` | the actor has no verified email or mobile: an identity finding, like `BLOCKED-IDENTITY` |

Send an idempotency key unchanged on both legs.

## 4. Running and reporting

- `node tests/<service>.flow.mjs` runs one flow: the authoring unit.
- `node tests/run-all.mjs` runs all flows in ONE process, so sessions and fixtures are shared,
  and writes `tests/report.json`. Exit code 1 on any fail.
- `node tests/coverage-gate.mjs` takes the best verdict per `(service, api)` (pass > fail > skip),
  prints per service covered / failing / skipped (with reasons) / MISSING / extra, and exits 0 only
  at 0 MISSING. A gate PASS with fails is still a red suite: the gate measures coverage, the run
  measures health. Report both numbers.
- Run one suite at a time. Two concurrent runs race each other's fixtures (unique slugs, cart
  state, order transitions). Do not run the suite while a rebuild or a redeploy is in flight, and
  make sure the stack runs the build you think it runs (check `/health` after a restart): a run
  against the previous build "proves" a fix that is not live.

If you want the run recorded as a test report, make `report.json` match the schema of
`procedures/design/schemas/test-report.v1.json`. The shape the schema expects:

```json
{ "project": "<codename>", "env": "dev", "base": "<base url>",
  "ranAt": "<iso>", "durationMs": 86498,
  "summary": { "pass": 84, "fail": 0, "skip": 40 },
  "services": { "auth": { "pass": 44, "fail": 0, "skip": 4 } },
  "results": [ { "service": "auth", "api": "login", "title": "fresh user can log in",
                 "status": "pass", "ms": 1287 },
               { "service": "order", "api": "shipOrder", "title": "...",
                 "status": "skip", "reason": "KNOWN-DEFECT <ref>: ..." } ] }
```

`summary` and every `services.<service>` must equal the counts of `results[]`; `api` is the API
name verbatim; `reason` carries the class prefix of section 8. Keep headers, bodies and tokens out
of it.

## 5. Identity bootstrap (`session.mjs`)

Three actors, all through the PUBLIC auth surface:

- **customer.** `POST /register` (the user shape from the auth spec: custom user properties are
  required when the blueprint says so). On `emailVerificationNeeded`, run the two-call verify chain
  (`POST /api/auth/verify/email-verification/start`, then `complete` with `secretCode` as a
  STRING; `procedures/pitfalls.md`). On the dev slot the start call echoes `secretCode`; on stage
  and prod it never does (a real mailbox, or a sink you read yourself). Then `POST /login`.
  Register and login answer 201 with the flat session envelope: `accessToken` at the top level,
  `userId` beside it. Read the token from the body first, `set-cookie` only as a fallback.
- **staff** (any custom role). A customer, then the super-admin grants the role with
  `PATCH /userrole/:userId { roleId: "<role>" }`, then a FRESH login: a session minted before the
  grant does not carry it. Under `usersHaveMultipleRoles` the stored `roleId` is an array: send and
  assert the array form. A role-gated API answers 403 to the wrong actor; that 403 is a valid
  assertion, not a reason to add the role to `absoluteRoles`.
- **super-admin.** The blueprint's bootstrap credential
  (`authentication` -> `loginDefinition.userSettings.superAdminIdentifier` / `superAdminPassword`),
  inserted once when absent. In a Genesis project that value should be an `$ENV:` reference
  (`compiler-api.md`). The suite resolves it at runtime from environment variables you name (the
  same variables the blueprint references) and nowhere else: not a literal in `config.mjs`, not
  a line in a report, not a committed file. Never print it, `cat` it or paste it into a prompt.

Sessions are memoised per process, and a bootstrap failure degrades instead of aborting:
`superAdmin()` that cannot log in throws `SkipError('BLOCKED-IDENTITY: ...')`, `staff()` inherits
it, and every case that needs either actor records a reasoned skip. A blocked identity is a
FINDING to report with the exact 403 body, never a reason to reset a password in the database.

`registerUser(tag, extra)` is the one-call composite (register, verify if needed, login)
every fixture uses for a throwaway actor. Give it a `tag` so the data is traceable to the case.

## 6. Fixtures across services

Fixtures are built THROUGH the APIs, once per process, as a chain that mirrors the product's own
flow, for example: staff creates a category and a published product with stock, then the customer
checks out and pays, then staff ships and delivers, then the customer writes the review.

- **`once()` memoises the rejection too, classified.** A memo helper that caches only success
  re-runs a permanently blocked fixture for every case that asks for it (one pilot lane burned
  16 cases x 2 throwaway users x ~15 s on one blocked checkout, another left 17 stranded
  rows). Cache the ERROR OBJECT of a permanent failure, so the second caller sees the same
  evidence; never cache a transient one.

  | Class | Tell | Memo |
  |---|---|---|
  | permanent | a `SkipError`; a 4xx about the request or the actor (401, 403, 404 on an advertised route, a validation 422); a precondition the suite cannot create | cache the rejection |
  | transient | a 5xx, a network error, a 429, a not-ready state the fixture polls for | do not memoise; the next caller retries |

- **A fixture failure is a real failure.** It throws with `brief(res)` and the cases that need it
  fail; only a classified skip (section 8) turns it into a skip.
- **Keep parents open until the children exist** (`procedures/pitfalls.md`). Destructive cases
  (cancel, refund, reject) get a fresh fixture, never the shared one. A state-shaped 422 means
  "pick another open parent", not "reopen".
- **Fixtures carry their evidence** (for a paid order, each payment call's status and body), so a
  red downstream can be read without re-running.
- **Restate the precondition before reusing a fixture** in another service: the same-shape failure
  in review (no delivered fact for THIS user and product) has a different root than in order.

### Mock payment discipline

The suite never sends card data, not a real card, not a "test card number": the mock adapter needs
none, and a payment-method API that stores or echoes such fields is a security finding.
The payment ladders are in `genesis/procedures/howto-payment-flow.md` and
`genesis/procedures/howto-subscription.md`; the test
discipline on top of them:

1. **Probe first, once per run:** `GET /<order-service>-api/v1/payments/mock-status` (or the same
   path on your service address). For your provider's row, `mock: true` with `transport: "present"`
   is the expected answer when the provider keys are blank. **`mock: false` means the service is
   bound to live credentials: stop and do not run the paid chain.** `transport: "absent"` (the row
   is also in the top-level `blocking[]`) is the one case where the paid chain is unrunnable.
2. **Path A** (the customer's product path): `PATCH /v1/startorderpayment/:orderId`, then
   `POST /v1/ordermockauthenticate/:orderId` (no body). Copy both routes from your own route list;
   the names here belong to one pilot's blueprint.
3. **Path B** (operator fallback): `POST /v1/payments/admin/simulate-capture/order/:orderId` as
   super-admin. A staff session answers `403 OPERATOR_REQUIRED`; do not grant the capability to
   the test role to make it pass. It needs the payment ticket Path A creates (else 404 "no payment
   ticket").
4. **Poll the order** (a handful of 1.5 s reads) until its status leaves the pending family, and
   assert on the ORDER's state, not on the payment call's 200.
5. **Read `transport`, not the brand.** `mock: true` says the credentials are blank; `transport`
   says whether the mock path answers. Only a brand whose row says `absent` makes the fixture
   throw a `SkipError` at the payment step, so every dependent case records the same reason.

## 7. The test transport: driving what HTTP cannot reach

Four API kinds have no public caller: **kafka-only** (runs when a message lands on a topic),
**cron-only** (runs on a schedule; `0 4 1 * *` is a month), **internal-only**
(`controllers: ["internal"]`, reachable only from inside the service) and **machine-only**
(`requiredCallerKind: "machine"` answers `403 M2M_CALLER_REQUIRED` to every session, super-admin
included). Every generated nodejs service mounts a drive surface for them under its own prefix,
for example `/<service>-api/admin/test-transport`.

**When it is open.** Only on an explicit non-production slot: `CONFIG_ENV` and `SERVICE_CONFIG`
both set, both non-production and agreeing (every generated `Dockerfile.<slot>` sets both), and
`MB_TEST_TRANSPORT` unset. Anything else answers `TEST_TRANSPORT_DISABLED`: production, or a plain
`npm start` with no `SERVICE_CONFIG` (the loader then falls back to `.test.env`), so set it yourself
for a local run. A non-empty `MB_TEST_TRANSPORT` switches the surface off outright.
That means a stage deployment is open too: set `MB_TEST_TRANSPORT=off` there if the surface must
not be reachable. Every caller that is not super-admin gets `TEST_TRANSPORT_FORBIDDEN`, so the
suite calls it with `ctx.superAdmin()`.

| Route | What it does |
|---|---|
| `GET /admin/test-transport` | census: declared and subscribed kafka topics, every cron job (with `registrationFailed`), the internal-call API names. Read it instead of guessing a name |
| `POST /admin/test-transport/kafka/publish` `{ topic, data, type?, old?, tenantCodename?, tenantId? }` | publishes through the service's own publisher (topic scope, envelope, scrub), so the consumer sees what production hands it. Call it on the service that OWNS the consumer: a topic outside its census is `400 TEST_TRANSPORT_TOPIC_NOT_CONSUMED`; a dropped publish is `503 TEST_TRANSPORT_PUBLISH_DROPPED`. `subscribed: false` means delivered but nobody listens. On a multi-tenant project the event goes out in the root tenant unless you name the tenant; unknown codename is `404 TEST_TRANSPORT_TENANT_NOT_FOUND` |
| `POST /admin/test-transport/crons/:name/run-now` `{ inputData? }` | runs the job once and waits. `ran: true` is the transport's verdict; assert on `outcome.httpStatus` / `outcome.output`, because a sweep that refused (400) also "ran". A handler that threw reports `outcome.httpStatus: 500` |
| `POST /admin/test-transport/internal/:apiName` `{ params? }` | invokes the internal-call API through the same registry a designer script uses. `invoked: true` is the transport's verdict; the API's own is `outcome.failed` / `outcome.httpStatus` / `outcome.errorCode` |
| `POST /admin/test-transport/machine-token` `{ targetService?, ttlSeconds? }` | mints a service-signed token (default 120 s, ceiling 300 s; a longer one is refused with `TEST_TRANSPORT_TTL_TOO_LONG`, never clamped). Send it as `x-m2m-token` to the machine-only API. It verifies only on the slot that minted it, so mint and call on the same deployment. A target in a language whose verifier does not check that binding answers `422 TEST_TRANSPORT_TARGET_UNVERIFIED` |

Other refusals: `TEST_TRANSPORT_LOGIN_REQUIRED` (no session), `TEST_TRANSPORT_CRON_UNKNOWN`,
`TEST_TRANSPORT_NO_SCHEDULER`, `TEST_TRANSPORT_API_UNKNOWN`. The minting service is the issuer, so
minting on a service the callee's `allowedM2MClients` does not list is how `M2M_CLIENT_NOT_ALLOWED`
is produced.

A kafka- or cron-driven case asserts on the EFFECT (the row the consumer wrote, the state the sweep
moved), polled a handful of times like the order in section 6. The publish or run-now answer only
says the drive happened.

**Auth's `mintSessionForUser`.** It is a trusted proxy-login route: it answers `403
errMsg_UntrustedProxyLoginCaller` to every user session, super-admin included, because it wants a
verified `x-m2m-token`. That is not a reason to skip it: mint a token on auth itself
(`POST <auth base>/admin/test-transport/machine-token` as super-admin, body `{}`), then call
`POST <auth base>/mintsessionforuser` with `x-m2m-token` and `{ userId, reason }`. Cases to write:
the `200` whose `body.userId` is the requested user, plus a `/currentuser` read on the returned
`accessToken` naming the same user; a `404` for an unknown `userId`; the `403` for a plain user
session (that negative is the contract); a `401` with no credential. If the deployment sets
`PROXY_SESSION_TRUSTED_SERVICES` to a list without `auth`, or auth is built in a language the mint
refuses, throw `SkipError('ENVIRONMENT: ...')` from the live response.

**Steering the decision mock.** A decision provider with no key (or the `mock` brand) answers from
a hash; `GET /<service>-api/v1/decisions/mock-status` says which providers are on it. To drive every
branch of an `objectModeration` flow (one `choice` question named `verdict` over `accept`, `reject`,
`review`), put a directive in any text field of the content the decision reads:

    [[mock-decision verdict=reject]]
    [[mock-decision verdict=accept@0.6]]   (low confidence, below the threshold: routes to review)
    [[mock-decision *=no]]                  (every question; other decision kinds)

Question names and legal values come from the blueprint's decision questions. A value the question
cannot take is refused with `MOCK_DECISION_DIRECTIVE_INVALID`, never silently replaced. Directives
are inert on production and on the real providers.

**A failed fiscal document.** The fiscal `mock` provider takes `configuration.behavior` in the
blueprint (a suite cannot pick it per document): `accept` (default), `reject`, `pending`, `fail`
(the first submit the service process serves throws, every later one accepts; a restart re-arms
it) and `failAlways`. A `failed` document is reachable no other way.

## 8. Reasoned skips: the taxonomy

A skip is a covered-with-reason verdict. The reason is a string with a class prefix, so the gate
counts it as covered and a human can audit every one. Two mechanics:

- **static** `suite.skip(api, reason)`: decided from the route row before any call;
- **thrown** `throw new SkipError(reason)` inside a case or fixture: decided from live evidence, so
  when the cause disappears the case PASSES with no code change.

| Class (prefix) | When | Mechanic | Must carry |
|---|---|---|---|
| `STATIC-TRANSPORT` / `cron-only` / `internal-call-only` | no external transport AND the test transport cannot reach it either (a service built before the transport existed: the census route answers 404) | static | the transport the row declares, and why section 7 does not reach it |
| `KNOWN-DEFECT <ref>: <symptom>` | a filed product defect blocks the case | thrown | the issue ref AND `brief(res)` evidence (status, body head, requestId) |
| `ENVIRONMENT: <what>` | your stack cannot support it (a capacity cap, an unbound provider, no echoed approval code) | static or thrown | the evidence and what would unblock it |
| `BLOCKED-IDENTITY: <why>` | a section 5 actor could not be bootstrapped | thrown by `session.mjs`, cascades | the login failure `brief` |
| `BUILT-IN-UNUSED: <what the product does instead>` | a built-in row the plan looked at and the product does not use. Never on a designer API: an unused designer API is a design question, not a skip | static | the one-line product reason |
| precondition (`no rows yet`, `provider boundary: ...`) | the case's data precondition did not hold on this run | thrown | the response that showed it |

Watch the precondition class. It is legitimate when the product allows the empty state, and a
hidden fail when the precondition SHOULD have held (a fixture that silently did not create the
row). A precondition skip on a fixture-backed case is re-triaged as a fail.

**A gate carries its true root's class, never a bare `precondition`.** The fixture holds the
response that caused its failure; no downstream case does. So at the point a fixture gives up it
classifies its own first failure (section 9 ladder) and throws that class with evidence. Every
dependent case inherits the same string, so the skip ledger counts one classified family, not N
unexplained preconditions. A `precondition` skip on a case whose fixture ran and failed is a
mislabelled gate: fix the gate's class, do not re-triage the case.

**Never:** weaken an assertion, widen a status set to turn a red green, delete a case, mark a fail
as a skip without a class and evidence, or change the product to fit the test. 95 % passing with
real defects accurately flagged beats 100 % with failures skipped.

## 9. Triage: the ladder and the fix policy

After every run, classify EVERY fail before touching anything. In the pilot, 27 of 32 first-round
reds were one root (a `whereClause` that named `userId` where the pattern's column is `ownerId`),
and the second round's 27 were one root again (an inter-service 404 on an unmounted route family).

1. **Group by first-failing fixture.** A red fixture takes every dependent case with it. Read the
   first failure's `brief`, fix that, re-run, then look at the survivors. Never fix a cascade case
   by case.
2. **Read the evidence you have:** `brief(res)` (status, body, `requestId`, `errMsg_*`), the
   fixture's trace, then the service's own log around the request time. The log line with the same
   `requestId` names the stage that threw. If the log does not show it, reproduce the request
   against your local stack with the same case. Query the database read-only to compare a row with
   the API's answer; never write to it.
3. **Classify.** The class decides the remedy:

| Class | Tell | Remedy |
|---|---|---|
| Test fault | wrong parameter name, wrong envelope key, a precondition the case never set up, a validator message that contradicts the doc (the live error outranks the doc) | fix the test; the generated service's source or `_api.json` settles a shape question in one read |
| Design fault (blueprint) | an authored slot is wrong: a `whereClause` column, an MScript expression, a missing role, a validation the spec never asked for | fix the BLUEPRINT, validate, rebuild, redeploy, refresh the route list, re-run. Cap 3 attempts per failure class, each changing something; then surface |
| Codegen fault | generated framework code fails: a 500 with a stack in generated code, a route the list advertises but the app does not mount, a sibling call that 404s on a generated path | collect the evidence (route, `brief`, `requestId`, log excerpt, route row, blueprint path), report it to the Genesis team, and make the case a `KNOWN-DEFECT <ref>` skip thrown from the live response |
| Environment | your stack cannot do it (capacity, an unbound provider, a missing external surface) | `ENVIRONMENT` skip with evidence and the unblock condition |
| Partial write | a `200` / `201` carrying `actionFailures` | classify by the FIRST entry's `action` + `error` like a red of that action; never by the status, never by re-sending a create |

Restate a fix's precondition before applying it to a second case: same-shape reds have different
roots.

**Fix policy, non-negotiable.**

- A failing test is not license to change the product. A design fault is fixed in the blueprint
  and rebuilt (`procedures/blueprint-authoring.md`); the suite re-runs against the new build.
  Never hand-edit generated files to pass a test (they are overwritten on the next build; see
  [custom-code.md](custom-code.md) for where your own code lives), and never write rows into the
  database to set up state the API could not create.
- A workaround you ship (a fixture that routes around a broken generated path, a widened status
  set "because the service answers 500 sometimes") is a defect report's trigger: report first,
  then decide whether it stays as a tripwire skip.
- Cap and surface: three attempts per failure class, then the user decides, with the reds quoted,
  the classification and the evidence trail, never summarised away.

## 10. Sample data: the committed seed

After testing, a stack is full of `test1`, `aaa` and half-finished flows. The seed is a written,
committed script that produces the opposite, a small image-carrying dataset that makes the product
legible. When tests dirty the data again, the cycle is "reset, seed", not a person doing it by
hand. It doubles as the cheapest end-to-end smoke test.

The seed is NOT the blueprint's `SeedData` pattern. `SeedData` upserts declared rows at service
startup, at database level, per data object, for reference and config rows. The sample-data seed is
post-test, cosmetic, cross-service, and goes through the public API so that validation, ownership,
derived fields, events and the search index all really turn.

### The five rules

1. **Public API only.** Every record is created with `fetch` against the service's API, never
   through the database. A database-level seed leaves search empty and events unfired.
2. **Idempotent and deterministic.** Every record carries a stable key in a natural field (slug,
   sku, email, name), and the script looks the record up before creating it (`ensure(kind, key,
   { find, create })`). A second run reports `created: 0`. Note the contrast with the suite, whose
   ids carry random suffixes so re-runs never collide: the seed uses stable keys so re-runs
   converge. If an object has no natural field for the key, put a recognisably stable value in a
   unique field and match on it; "create blindly" is how a seed stops being re-runnable.
3. **Seeded stock images, never drawn or generated.**
   - An image URL field gets `https://picsum.photos/seed/<stable-key>/<w>/<h>`: the seeded path
     keeps the same picture per record on every run. Never the unseeded `picsum.photos/<w>/<h>`.
   - An image stored as a bucket key (the create call takes a storage key, not a URL) gets the same
     seeded photo downloaded once, cached under `seed/images/` (commit the cache: a re-run needs no
     network), and uploaded through the product's own bucket upload route inside the record's
     `create()`.
   - Never draw images with code and never generate them with an image model: both cost more than
     a download and look worse.
   - For topical photos use a stock library whose licence allows commercial use without
     attribution (Unsplash, Pexels, Pixabay). Their search APIs need a free key: keep it in the
     environment only, never in the seed, and cache the downloads the same way. Avoid Wikimedia
     Commons unless every file's attribution travels with the picture.
4. **A real login.** The seed authenticates through the same public login the frontend uses,
   registers its demo users through the real register, verify, login chain and creates the tenant(s)
   it needs. On a multi-tenant project it sends the tenant codename header; copy the header name
   from the route list (`_api.json` carries it per endpoint) and the auth spec, never guess.
5. **Fail loud.** Any non-2xx stops the seed and names the API, the call and the payload. Nothing
   is swallowed or blind-retried. A red seed is a FINDING: triage it with the ladder of section 9
   before touching the seed.

### Where it lives, and what it reads first

- It is ONE self-contained script, `seed/seed-sample-data.mjs` in the same tests repo (`npm run
  seed`), with one README line on what it seeds, how to run it and the idempotence check.
- Self-contained: Node >= 18, built-ins only, no imports from `helpers/`, base URL from an
  environment variable, because it runs alone, in its own phase, long after the suite.
- Before filling it, read: the route lists of every service (routes are copied, never composed),
  the auth spec (roles, required register fields, tenant shape), the data model (which objects have
  states, which fields are images) and `procedures/pitfalls.md` (the verify chain with `secretCode`
  as a string, real-today dates, keep-parents-open).

### Filling the story

The data is cosmetic: a small story the UI can walk through, not a fixture dump.

- **Per service, per state.** Every meaningful state of every object the UI shows gets at least one
  record (a draft AND a published product; an open, a shipped AND a delivered order). Reach states
  through the PUBLIC transitions in a second pass: create everything open first, seed children
  while parents are open, then transition a few parents.
- **Plausible and coherent.** Real-looking names, sensible relations (the review is written by the
  customer whose order was delivered), prices and dates that could be true, anchored to the real
  today.
- **Enough volume:** roughly 5 to 15 records per primary object, at least one page where the
  frontend paginates, at least two distinct values for every field the UI filters on.
- **Images everywhere the UI shows one**, sized for the slot (card, hero, avatar).
- **A small, reusable cast:** one owner or staff actor and one or two customers, with stable
  seed-key emails and a deterministic demo password from the environment, so the second run logs in
  instead of registering and a person can log in AS a demo user. The super-admin credential is
  resolved at runtime only (section 5) and never appears in the committed file.
- Use reserved non-deliverable addresses for demo users (`.invalid`, `.test`, `.example`,
  `example.com`) so no real provider ever receives a demo message.

### Running and verifying

```
cd tests
BASE=<your stack url> node seed/seed-sample-data.mjs                     # seed (idempotent)
BASE=<your stack url> node seed/seed-sample-data.mjs --expect-existing   # the twice-run check
```

(Name the base-URL variable whatever your `config.mjs` uses; keep it the same in both files.)

- The stack must be up and healthy first (`/health`; [run-locally.md](run-locally.md)).
- First run: expect `created: N, existing: 0` and a dataset a person can navigate.
- Second run straight after: `--expect-existing` exits non-zero if ANYTHING was created. That is
  the acceptance check for idempotence; run it every time the seed changes.
- Seeding never deletes. To start clean, drop your local stack's data volumes and bring the stack
  up again (the generated services re-seed the bootstrap super-admin and every blueprint `seedData`
  row at boot), check you can log in as super-admin, then seed. A seed on top of test data without
  a reset is allowed but said out loud in the run report: the dataset is additive.
- Never delete rows by hand to "help": the database and the search index must keep agreeing. To
  remove one row, use the product's own delete or archive API; if the object has none, that is a
  blueprint gap to fix there.
- After a payment-bearing seed step, provision plans and webhooks first as described in
  `genesis/procedures/howto-subscription.md`.
- Verify by read-back, not by the exit code: count rows per service in the database and compare
  with what the API lists, and check the search index moved with the database (database up and
  index flat means the seed wrote past the search layer: a finding, never something to seed over).
  Put the counts in the report as numbers.

### Seeding a shared stage

Only when the owner asks, after a stage deploy, and never as an automatic step:

- Confirm the base URL with the owner before the first call. No reset, ever; the seed stays
  additive and idempotent.
- Catalog only: definition data (categories, products, brands, settings). Anything bound to a user
  (orders, carts, reviews, profiles) is skipped and named in the report; no demo end users are
  registered, because stage runs live verification and codes never ride the answer.
- A multi-tenant catalog lives inside a tenant, so write it as an owner of ONE example tenant,
  reusing it when it exists. Payment steps run only when the stage payment provider holds
  test-mode keys; otherwise skip them with the reason.
- Read back every created record through the public API and fail loud on one that is missing.

## 11. Checklist

- [ ] Test plan written (`procedures/design/writers/test-plan.md`) before the first script.
- [ ] `inventory/<service>.json` fresh for every service (re-copied after each rebuild).
- [ ] Helpers and `auth.flow.mjs` green; three actors bootstrap, or a `BLOCKED-IDENTITY` finding
      is reported with the 403 body.
- [ ] One flow per service; every designer API has a case or a class-prefixed skip; built-ins only
      where the plan lists them.
- [ ] Routes copied from `_api.json` / `/openapi.json`, a `User-Agent` on every call.
- [ ] Every write case asserts no `actionFailures`; every approval-gated API goes through
      `approvedCall` and asserts both legs.
- [ ] `mock-status` probed (`mock: true`, `transport: "present"`); no card data anywhere.
- [ ] Kafka, cron, internal and machine-only rows driven through the test transport.
- [ ] `run-all` then `coverage-gate`: `GATE: PASS`, and fails are 0 or each classified and capped.
- [ ] Every skip carries its class and evidence; fixture gates throw their true root's class.
- [ ] Design faults fixed in the blueprint and rebuilt; codegen faults reported with evidence.
- [ ] Seed: public API only, stable keys, seeded stock images, real login, fail loud, run twice
      with `created: 0` on the second run, counts verified by read-back.
