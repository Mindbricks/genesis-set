# Extending the generated code: custom code

This page is for the moment a blueprint needs behaviour that its patterns cannot express. It says
where custom code lives, how the compiler turns it into the generated service, what it can call at
run time, and what survives a rebuild. How to design the library and edge patterns themselves is
in mind-set (`procedures/blueprint-authoring.md`, section "Library functions"); this page covers
what the compiler does with them. Related pages: [compiler-api.md](compiler-api.md),
[compile-results.md](compile-results.md), [testing.md](testing.md), [pitfalls.md](pitfalls.md).

## The central rules

1. **Custom code is part of the blueprint.** Library function bodies and edge function bodies are
   fields of the blueprint (`moduleBody`). The compiler re-injects them into the service at every
   build. To change them, change the blueprint and compile again.
2. **Never edit a generated file to change behaviour.** The next compile overwrites it, and the
   overwrite is counted in that build's `addedLines`.
3. **Files you add survive.** A file you add to a service repo outside the generated paths stays
   through every rebuild. Service files under `service-files/` are always yours.
4. **Where service-file bytes live.** The bytes stay in your service repo. The blueprint
   holds only the manifest (`path`, `visibility`, `contentType`, `size`, `sha256`); the compiler
   reads the bytes from your repo once builds compile onto your repositories. Until then (dry runs)
   a build skips the declared service files and its log says so (`service files skipped
   in Genesis builds`).
5. **Custom code runs with the service's full privileges.** There is no sandbox for MScript, arrow
   functions, library functions or edge functions. Review them like any code you ship.

## The four escape hatches

Pick the lowest layer that carries the requirement.

| Hatch | Scope | Language |
|---|---|---|
| MScript | one pattern field (condition, where clause, default, response value) | JavaScript, transpiled to the service language |
| `ArrowFunctionAction` | one step inside one Business API | JavaScript body, spliced into the service |
| `ServiceLibrary` function | reused across the service, callable as `LIB.<moduleName>(...)` | the service's own language |
| `EdgeController` + edge function | a whole route (REST, Kafka) outside the action workflow | the service's own language |

Choice rules:

- A predicate, derived value or payload field: MScript.
- A transform of 1 to 10 lines used in one API that MScript cannot express: `ArrowFunctionAction`.
- Logic used in three places, or longer than about 10 to 30 lines: a library function.
- A route that must own the whole request (provider webhook with its own signature, binary
  download, a bespoke report, a Kafka consumer): an edge controller. If the operation reads and
  writes data objects in the request, validate, act, respond shape, declare a Business API instead.
- If it is persisted, declare it on the data object. Custom code is behaviour, not data. Tables
  that a library reaches into outside the blueprint are invisible to migrations and will drift. For a
  derived counter, declare the column and keep it up to date with an update action on a cron API.

Only MScript is portable. Library and edge bodies are never transpiled and never bridged: they are
written in the service's language.

## `LIB` and `API`: the ambient containers

In nodejs every hatch reaches the same two globals. No import is needed.

| Container | Holds | Call |
|---|---|---|
| `LIB` | this service's `library.functions[]` modules (plus native kernels) | `LIB.<moduleName>(...)` |
| `API` | this service's Business APIs that set `controllers.internalCallSettings.hasInternalCallController: true` | `await API.<apiName>({ ...params })` |

They are installed on `globalThis` at boot (`src/index.ts`) and typed by `src/lib/index.ts` and
`src/global.d.ts`. Rules:

- Call them inside the exported function, never at module load time. A top-level `API.x()` runs
  before the install.
- `API` names are exact and case-sensitive. An unknown name is `INTERNAL_API_NOT_FOUND` and an API
  without the controller is `INTERNAL_API_NO_CONTROLLER`, both at design time. Computed access
  (`API[expr]`) cannot be checked and draws a warning.
- An internal call runs as the system with a null session. On nodejs and rust the second argument
  carries a session: `await API.getOrder(params, { session: this.session })`. Even then role and
  ownership gates stay bypassed, so the calling code must enforce access. A `session` key inside
  `params` is plain input data.
- An internal call bypasses object moderation: a get or list of an `onPlace` object returns every
  row, unapproved ones too. The same holds for direct `dbLayer` reads. Filter before relaying to a
  user.
- Nested internal calls fail with `INTERNAL_CALL_DEPTH_EXCEEDED`.

## Library functions

`services.library` holds one library per service, with these partitions:

| Partition | Holds | Body key |
|---|---|---|
| `functions[]` | reusable functions | `ts` (preferred) or `js` on nodejs; the language key elsewhere |
| `edgeFunctions[]` | request handlers | same |
| `templates[]` | render templates | `ejs` |
| `assets[]` | server-side static text | `json`, `svg`, `txt`, `html` |
| `public[]` | files served at a public URL | same |
| `pdfTemplates[]` | PDF templates (page setup, header, footer, metadata) | EJS body plus layout fields |
| `hooks[]` | binds a `functions[]` module to service startup or shutdown | none |

### How the compiler picks a body

`moduleBody` is an object keyed by language, not file extension: `ts`, `js`, `python`, `java`,
`csharp`, `go`, `rust`. The compiler takes the key of the service's language (nodejs: `ts`, then
`js`). A module with no body for that language does not fail the build. It is emitted as a stub that
throws at runtime (for example "lib 'computeShipping' has no nodejs (js/ts) body") and the build
prints a warning. So read every build warning, and give each language you generate its own body.
A `php` key is kept but no service reads it.

Name rules: `moduleName` is camelCase, unique in its partition, and is the name MScript uses and
the file base name.

### A nodejs function

A module must export one function. `module.exports = { a, b }` and `exports.a = ...` are refused
(`NO_EXPORT`), because the runtime binds the module itself as `LIB.<moduleName>`.

```ts
module.exports = function shippingFee(order: { weightKg: number; zone: string; subtotal: number }): number {
  if (!order || order.weightKg <= 0) throw new Error('order weight required');
  if (order.subtotal >= 250) return 0;
  return Math.round(order.weightKg * 12 * 100) / 100;
}
```

Call it from a `FunctionCallAction` with `callScript: { "js": "LIB.shippingFee({ ... })" }`. The
result lands on the workflow context as `this.<contextPropertyName>` (the action `name` when no
property name is set). Schedule that action before the step that reads it. For example, a data
clause item that reads it needs the action at `afterCheckBasicAuth`, because the data clause is
built after that step.

Several helpers in one module: declare the function, attach members, export it.

```js
function textTools() {}
textTools.slug = (s) => String(s).toLowerCase().replace(/\s+/g, '-');
module.exports = textTools;
```

Then `LIB.textTools.slug(this.title)` works. Write `await` yourself where an attached member is
async; the validator does not check it. The validator trusts attached members only for this plain
shape (no `this`, `arguments`, `eval`, prototype tricks or reads of `process`). Anything else is
valid JavaScript, but the members are then not counted and `LIB_BARE_FUNCTION_MEMBER_ACCESS`
fires.

Undeclared names fail the build before anything is committed. The failed build names the function,
the identifier and the line. Allowed without declaration: `LIB`, `API`, the CommonJS names, Node
globals and JavaScript built-ins. Reach a runtime-specific name through `globalThis.Deno?.exit()`,
not `Deno.exit()`. The same check runs in the repo as the `correctness/noUndeclaredVariables` lint rule on
`src/lib/functions/**` and `src/lib/edge/**`: `npm run lint` shows it.

To give a function the whole workflow context (API params, the session, earlier action results),
pass `this`: `LIB.quoteOrder(this)`. Pass plain fields instead for a pure helper that is easy to
test. A function that writes rows forwards `{ session, requestId }` to the `dbLayer` helper.

### Publishing Kafka events from a function

A function that publishes with `ServicePublisher` lists every topic in `publishes` on the library
module, named as it goes on the wire (`<codename>-<service>-service-<event>`). The compiler cannot see
inside a body. Without the declaration, a listener on that topic is reported producerless at boot
(`KafkaSubscriptionsWithoutProducer`, ERROR) and at design time (`KAFKA_TOPIC_NO_PRODUCER`). Code that
is not a library module declares on `serviceSettings.serviceOptions.publishes`. A lifecycle hook that must
announce a fact calls a library function that publishes. An `API.*` call from a hook that already
runs inside an internal call fails with `INTERNAL_CALL_DEPTH_EXCEEDED`.

### Startup and shutdown hooks

`hooks[]` entries (`name`, `trigger` of `startup` or `shutdown`, `moduleName`) run a `functions[]`
module automatically. Only `functions[]` modules are valid (`HOOK_MODULE_NOT_FOUND`).

- Startup hooks run on every boot, so the function must be idempotent (upserts, existence checks,
  version stamps; never blind inserts).
- They run after the database, migrations, seed data and Kafka wiring, and before the HTTP listener binds.
- A hook that throws never blocks `/health` and never crashes boot. It is logged as
  `StartupHookFailed` and the service comes up degraded. Success is `StartupHookCompleted`.
- A startup hook is awaited for at most `LIBRARY_STARTUP_HOOK_BUDGET_MS` (default 30000). After
  that boot proceeds (`StartupHookStillRunning`) while the hook keeps running.
- Shutdown hooks run best effort on SIGTERM and SIGINT, bounded by
  `LIBRARY_SHUTDOWN_HOOK_BUDGET_MS` (default 10000). A killed process runs nothing, so never
  depend on one for correctness.

### Service files in code

On a nodejs service that has at least one service file, `LIB.serviceFiles` exists:
`text(path)`, `json(path)`, `bytes(path)`, `info(path)`, `has(path)`. All are synchronous (no
`await`). An unlisted path throws `ServiceFileNotFoundError`; a missing or altered file throws
`ServiceFileIntegrityError`. Do not name a library module `serviceFiles`. A private file is not secret:
it sits in the repo and in every image built from it. The manifest design is in mind-set.

## Edge controllers

Two blueprint pieces that reference each other by name: an entry in `services.edgeControllers[]`
and an `edgeFunctions[]` module. `edgeControllerOptions.functionName` must equal the module's
`moduleName`. The compiler emits an adapter that authenticates, builds the context and calls your
function.

### Triggers

| Block | Fields | Generated |
|---|---|---|
| `edgeRestSettings` | `restEnabled`, `method`, `path` | a REST route |
| `edgeKafkaSettings` | `kafkaEnabled`, `requestTopic`, `responseTopic?` | a Kafka consumer; the return value goes to `responseTopic` |
| `edgeCronSettings` | `cronEnabled`, `cronExpression` | nothing: no generator schedules it |

`cronEnabled: true` draws the warning `EDGE_CRON_NOT_SCHEDULED` and the function is never called by
a clock. For scheduled work use a service cron job (`Service.cronJobs[]`), a cron-triggered
Business API, or an external scheduler that calls the REST route.

### Where the route lives

`edgeRestSettings.path` is relative to the edge sub-router. The mount prefix is `/edge`, so
`/generate-invoice` is served at `/edge/generate-invoice`. Never write the prefix into `path`
(`/edge/x` would be served at `/edge/edge/x`). A deployment can change the prefix with the env var
`EDGE_MOUNT_PATH` (unset or blank is `/edge`; `/` mounts at the root). The declared paths never
change. Edge routes stay out of the `/v1` business API routes.

### Kafka consumer group

A Kafka edge controller consumes in the group `<SERVICE_CODENAME>-edge-<functionName>`: keyed by
the function, not the topic. Two functions on the same `requestTopic` both receive every message
and each publishes its own response. If you want one handler, use one edge controller and branch
inside it. `requestTopic` defaults to `<functionName>-requests`. Replicas of the same function share
the partitions.

### The handler context

One async export that receives one normalized context, not an Express request:

| Field | Meaning |
|---|---|
| `body` | REST: `{ ...req.body, ...req.query }`; Kafka: the payload |
| `headers` | request headers (REST); `{}` on Kafka |
| `session` | REST: the user session, or `null` on a public or service-token-only route; Kafka: the identity the event arrived with, or `null` |
| `isM2M`, `m2mIssuer` | true only for a verified, admitted service token, and the issuing service name from the token; always false on Kafka |
| `requestId` | the correlation id, never empty (a fresh UUID when none came in) |
| `service`, `function` | for logging |

### Return contract

- A plain value is sent as JSON with HTTP 200, even an object that has a `status` member (it is
  just a JSON field).
- A response envelope `{ status, headers?, body? }` is honoured when a numeric `status` comes with a
  `body` and/or an object `headers`. A `Buffer` or string `body` is sent raw (images, CSV, PDF);
  anything else is JSON. A bare `{ status: 200, ... }` stays a JSON body.
- To refuse, throw an error with a numeric `.status`; the adapter answers `application/problem+json`
  with that code (500 by default).
- On a Kafka controller with a `responseTopic`, a plain return is published as is and an envelope
  publishes its `body`. An envelope with `status >= 400` is a refusal: it is logged as
  `EdgeKafkaMessageRejected` and never published, and the offset commits. Without a `responseTopic`
  the return value is ignored.

### Auth

The adapter enforces auth before your function runs:

| `loginRequired` | `M2MAllowed` | Mode | Needs | Refusal |
|---|---|---|---|---|
| true | false | session | a user session | 401 `SESSION_REQUIRED` |
| false | true | m2m | a verified, admitted service token | 401 `M2M_TOKEN_REQUIRED`, 403 `M2M_CLIENT_NOT_ALLOWED` |
| true | true | both | a session or a service token | 401 `SESSION_REQUIRED`, 403 `M2M_CLIENT_NOT_ALLOWED` |
| false | false | public | nothing | none |

The credential is the `x-m2m-token` header (an `Authorization: Bearer` token is tried only when
`x-m2m-token` is absent, and only if it verifies as a service token). Verified means an EdDSA
service JWT from a service of this project, signed by that service's key and addressed to this
service. Admitted means it passes `serviceOptions.allowedM2MClients` / `blockedM2MClients`. Kafka
has no per-message check. A webhook with a provider signature is a public (or M2M) route that
verifies `ctx.headers[...]` itself and throws a `.status = 401` error on a bad signature.

### Other languages

- Library and edge bodies are never bridged. Without a native body there is a warning and a stub
  that fails at runtime.
- .NET: `moduleBody.csharp`, a global static PascalCase class with
  `Task<Dictionary<string, object?>> Invoke(IDictionary<string, object?> ctx)`. For typed `LIB`
  forwarders a leading comment `// @mindbricks-lib-invoke {"returnType":...,"parameters":[...]}` declares each
  `Invoke` overload (bad metadata is `DOTNET_LIB_INVOKE_METADATA_INVALID`; missing metadata is the warning
  `DOTNET_LIB_INVOKE_METADATA_MISSING`). Call `global::LIB.echo(...)`; `API.getOrder(input)` returns a
  `Task`.
- Java: `moduleBody.java`; static `API` and `LIB` in the service's `lib` package;
  `API.<name>(params)`. An API name outside the membership is `JAVA_NATIVE_API_UNBOUND`.
- Rust: `moduleBody.rust`. A function is `src/lib_layer/<snake_name>.rs`; an edge function is
  `src/edge_functions/<snake_name>.rs` with
  `pub async fn handle(ctx: Value, pool: Arc<PgPool>) -> Result<Value, EdgeError>`. There is no
  `LIB` or `API` identifier: use `crate::lib_layer::<snake_name>(...)` and
  `crate::api::<snake_name>(params, session).await` (`crate::api::blocking::...` in a synchronous
  body). Errors `RUST_INTERNAL_API_UNBOUND`, `RUST_INTERNAL_API_VALUE_UNSUPPORTED`,
  `RUST_NATIVE_API_UNBOUND`. Rust edge routes exist for PostgreSQL only. A binary body is a base64 string
  with `"bodyEncoding": "base64"` (`EDGE_BODY_ENCODING_INVALID`, `EDGE_BODY_BASE64_INVALID`).
- Python: `moduleBody.python`. A function is `src/<package>/lib/functions/<moduleName>.py` and must define a
  top-level function named `<moduleName>`; an edge function is `src/<package>/lib/edge/<moduleName>.py`
  with `handler(ctx)`. `API` and `LIB` are bare names. `await API.<apiName>(params)`; there is no
  session argument. A wrong name raises an error naming `INTERNAL_API_NOT_REGISTERED`.
- Go: the edge REST route is mounted with auth and answers `501 EDGE_FN_UNSUPPORTED`; its Kafka edge
  transport is absent.
- Payment lifecycle hooks are not lowered on Rust or Python (`PAYMENT_LIFECYCLE_HOOK_NOT_LOWERED`),
  so an `API` call in a hook does not run there.
- When converting an existing nodejs blueprint, keep the original `ts`/`js` bodies, add the native
  body, check each missing-body warning, and test the real route. A build that succeeds is not proof
  of behaviour.

## Native MScript expression slots

Use the portable `js` expression for a blueprint that targets several languages. A
nonempty native expression is inserted into its target's generated evaluator.
Expression slots and library module bodies have different contracts.

| Target | Native expression contract |
| --- | --- |
| Java | The generated manager evaluates the expression in a synchronous `Supplier`. `this` is the manager. Use a map lookup or `MScriptRuntime.prop(this.order, "status")` for nested values. `prop` returns null for a null receiver. |
| .NET | The manager evaluates the expression in a synchronous `Func`. Read custom context from `Context["order"]` or `Ms.Get(this, "order")`. The lambda has no top-level `await`. The wrapper completes a returned `Task` or `ValueTask` before using its value. |
| Rust | In API managers, `this` is the JSON snapshot from `self.this_view()`. Read members with JSON indexing or the MScript `member` helper. The synchronous closure returns the value directly. Value-model slots require a `serde_json::Value`, such as `serde_json::json!(true)`. Other slots can wrap the result in JSON themselves. |

For .NET expressions, the first non-nullish key wins in this order
`csharp`, `cs`, `dotnet`. An empty winning key falls back to translating `js`
(or `value`) and shadows subsequent aliases. For example, in
`{ "js": "40 + 2", "csharp": "", "cs": "6 * 7" }`, .NET translates
`40 + 2`. Remove the empty alias to use `cs`. A .NET library module body
uses only `moduleBody.csharp`.

Design validation, native syntax checking and translation during generation
each report their own findings. A valid design can still encounter a per-slot
translation refusal. For example, fiscal lifecycle conditions and scripts
refuse translator warnings and unsupported waits, while JobStream reports
translator warnings. Use the failed build's `buildErrors` entry to locate the
service, slot and source expression. Read [the compile result guide](compile-results.md)
for diagnosis and repair the exact expression that failed.

## What custom code can call (nodejs)

Import aliases, resolved at compile time, at run time and under test:

| Alias | Is |
|---|---|
| `common` | the framework runtime barrel |
| `dbLayer` | per-data-object CRUD helpers generated from this service's `dataObjects[]` |
| `models` | raw Sequelize or Mongoose models (advanced; skips indexing, events, soft delete) |
| `apiLayer`, `controllers`, `agentLayer` | internal runtime; rarely imported by hand |
| `bucketLayer` | bucket layer; `bucketLayer/bucket-router` exports `readBucketObject`, `writeBucketObject`, `deleteBucketObject` |

There is no `serviceCommon` package and no such alias. `ServicePublisher` and `ElasticIndexer`
ship from `common`. Code that imports `serviceCommon` must import from `common`.

Useful `common` exports: `ServicePublisher` (Kafka event with the caller's session:
`new ServicePublisher(eventName, data, session, requestId).publish()`), `KafkaListener`,
`dbEventTopic`, `ServiceIndexer`, `fetchRemote*`, `getRedisClient`, `EntityCache`,
`QueryCache` and `QueryCacheInvalidator`, `getLogger`, `newUUID`, `runMScript`, and the
Ed25519 helpers `signServiceToken` / `verifyServiceToken`. There is no OpenAI or Stripe client
export: AI and payments go through their blueprint settings. The authoritative export list is the
generated `src/common/index.ts` in the service repo; check there before relying on a name.

Two helpers live on the API manager, so MScript and arrow functions reach them as `this.*`:
`this.hashPassword(plain)` (bcrypt, cost 10) and `this.hashCompare(plain, hashed)`. Both return
Promises; inside a larger expression write `await` yourself, or the design is refused with
`MSCRIPT_ASYNC_HELPER_NOT_AWAITED`.

### `dbLayer` helpers

Always prefer `dbLayer` to `models`. For an object `order` the names are `<operation><Order>`:

- writes: `createOrder(data, context?)`, `createBulkOrder(rows, context?)`,
  `updateOrderById(id, data, context?)`, `updateOrderByIdList(ids, data, context?)`,
  `updateOrderByMQuery(data, mQuery, context?, includeArchived?)` (data clause FIRST),
  `deleteOrderById(id, context?)`, `deleteOrderByMQuery(mQuery, context?, includeArchived?)`;
- reads: `getOrderById`, `getOrderByMQuery`, `getOrderAggById`, `listOrder`, `listOrderByMQuery`
  (alias `getOrderListByMQuery`), `countOrder`, `getOrderStatsByMQuery`, `getIdListOfOrderByField`,
  `getIdPageOfOrder`, plus `getOrderBy<Field>` for each indexed non-key field.

Rules worth knowing:

- Two families, one suffix apart. `listOrder`, `countOrder`, `getOrderByQuery` and
  `deleteOrderByQuery` take a raw driver `where`; MQuery `$` operators fail there on a SQL service.
  Only the `*ByMQuery` family lowers MQuery. Validation refuses the raw form in library and edge code
  with `LIB_DBLAYER_RAW_WHERE_USES_MQUERY`. `getOrderListByMQuery` takes a bare MQuery and returns an
  array, not `{ rows, count }`. The `*ByQuery` helpers are deprecated.
- Return shapes: `createOrder` gives `{ success, data?, error?, existing? }`. `updateOrderById`
  gives `{ success, affectedRows, data }` and answers `success: false` (it does not throw) when no live row
  matches. `deleteOrderById` gives the deleted row, or `null`; there is no `success` flag.
- Stats: `getOrderStatsByMQuery(mQuery, stats?, bucketBy?)`. `stats` is an ARRAY (`'count'`,
  `'sum(f)'`, `'avg(f)'`, `'min(f)'`, `'max(f)'`). Without `bucketBy` the result is a flat object
  keyed `op-field` (`{ count, 'sum-total' }`, an object even for one stat). With `bucketBy` it is an
  array of buckets, each with `count`.
- `context` is `{ session?, requestId? }`. Pass the caller's so the Kafka events carry the session.
  Omit it for cron and system work.
- A bulk or by-query update or delete with no selector besides `isActive` (after the soft-delete gate is
  waived) is refused.
- All delete helpers honour `onDeleteAction` relations; a live `restrict` child refuses the delete
  with 409 `RELATION_RESTRICTED`.
- Soft delete: with it on, a delete flips `isActive` to false and stamps `_archivedAt`; reads hide
  those rows unless `includeArchived` is true. Without it, a delete removes the row.
- `dbLayer` skips the Business API permission and validation chain. Use it only on paths that have
  made their own checks (an edge function with explicit authorization, a cron library call). In a
  Business API use the CRUD actions.

Every write is followed by, in order: the Elasticsearch index write (awaited for at most
`ELASTIC_PROJECTION_WAIT_MS`, default 3000; a timeout is logged `ElasticProjectionWaitExpired` and is
not fatal), the `elastic-index-<codename>_<object>-<verb>` event, and the
`<SERVICE_CODENAME>-dbevent-<objectname>-<verb>` event (always emitted). A failed index or publish
never rolls back the database write. Because the db event is published after the index attempt, a
consumer that re-reads the projection normally sees the new row.

Example (library function for a cron API):

```js
const { listOrder, updateOrderByIdList } = require('dbLayer');
const { Op } = require('sequelize');

module.exports = async function closeStaleOrders(cutoffDate, context) {
  const { rows } = await listOrder({
    where: { status: 'awaiting_payment', createdAt: { [Op.lt]: cutoffDate } },
    limit: 1000,
  });
  if (rows.length === 0) return { closed: 0 };
  const result = await updateOrderByIdList(rows.map(r => r.id), { status: 'canceled' }, context);
  return { closed: result.count };
};
```

## Reading another service's data

Never read another service's database. Read its Elasticsearch projection instead; every
`dbLayer` write keeps it current. Pick by call site:

| Where | Use |
|---|---|
| Inside a Business API | `InterserviceCallAction` for one typed call, or a static join that copies the field at write time |
| Inside a BFF data view | the view's `joins[]` |
| Library, edge or cron code | `ServiceIndexer` or `fetchRemote*` from `common` |

Rules for code you write:

- `new ServiceIndexer('User', session, requestId)` takes the bare object name; it adds the project
  codename (`<codename>_user`). `session` and `requestId` are only diagnostic context. They do not
  filter the read.
- Read methods: `getById`, `getOne`, `getByPage(from, size, query?, sort?, cached?)`, `getCount`
  (each takes `{ onError: 'throw' }`), `getAggregations` (degrades to `null`), `rawSearch` (always
  throws), `checkIndexState()` (`present`, `absent`, `unknown`). By default a failure degrades to
  `null`, `[]` or `0`, which is indistinguishable from "nothing there". Pass `onError: 'throw'`, use
  the `*WithStatus` helpers (`{ data, failure }`), or check `checkIndexState()` whenever the degraded
  value is an answer you act on. An unconfigured Elasticsearch client still returns the empty value
  even with `onError: 'throw'`.
- `fetchRemoteObjectByMQuery(object, query, ctx?)` and the list, stats and `*ByElasticQuery` variants
  take an optional trailing `{ session, requestId }`. The plain helpers collapse "absent" and "not
  answered" into `null` or `[]`.
- Not tenant-scoped. The index is namespaced by the project codename only and the session is never
  consulted on a read. Add the tenant column to your query yourself, failing closed:
  `convertMQueryToElasticQuery({ companyId: ctx.session?.tenantId ?? null, status: 'active' })`.
- Not access-scoped. Every data object is projected, whatever its `dataObjectAccess`, and the
  owner's Business API gates (such as `ownershipCheck`) do not run. For a read that must honour the
  owner's rules, or must see the database, use an `InterserviceCallAction` to the owner's API.
  Custom reads also add no moderation gate: filter on `moderationStatus` yourself.
- Rows from `fetchRemote*` never carry a property the project marks `hashed` or `isSecret`.
- Paginate every list read. Prefer one `getByPage` or aggregation to a loop of `getById`.
- Cross-service reads are async. Wrap them in a library function and call it through a
  `FunctionCallAction`; do not inline them in MScript.
- The `projection-index-missing` reason: the owning service never indexed that object, or its
  Elasticsearch bootstrap or startup sync failed. Read the owner's boot log for `[SMART-SYNC]` lines, fix the
  cause, restart the owner (its startup sync rebuilds an absent or empty index). A row inserted
  straight into the database by a script is not projected until the next rebuild. Other reasons:
  `elastic-not-configured`, `invalid-arguments`, `query-conversion-failed`, `result-window`,
  `partial-timeout`, `transport-error`.
- A cross-service `FetchObjectAction` that cannot be answered logs `RemoteFetchNotAnswered` and
  answers 503 when required (it is fail-closed: a gate behind it does not run).

## Packages

Third-party dependencies are `serviceSettings.serviceBasics.packages[]` entries: `manager`,
`name`, `version` (`"*"` is latest), optional `importAs`, optional `options`.

| `manager` | Written into |
|---|---|
| `npm` | `package.json` dependencies |
| `pip` | `pyproject.toml` |
| `maven` (`name` is `groupId:artifactId`) | `pom.xml` |
| `nuget` | `.csproj` |
| `gomod` (`name` is the module path) | `go.mod` |
| `cargo` | `Cargo.toml` (`options` carry crate features) |
| `composer` | nowhere (no service language generates it) |
| `vcpkg`, `conan`, `apt` | the build image, for native libraries a kernel links |

Each target takes only the entries whose manager matches its language. An npm package used only by
a `ts` body is not loaded by a non-nodejs service: declare the target language's equivalent and use
it from the native body. `importAs` also binds the package into MScript, so an expression can say
`dayjs(this.createdAt)`; without it the package is only installed and the function imports it itself.
The nodejs compiler also merges `import` and `require` references in your library modules into
`package.json`. Older `nodejsPackages[]` items are migrated into `packages[]` (`defaultImportConst`
becomes `importAs`). For `apt`, `name` matches `^[a-z0-9][a-z0-9+.-]+$` and `version` is `"*"` or
matches `^[0-9][A-Za-z0-9.+:~-]*$`.

A native C or C++ library is a `NativeKernel` on `library.nativeKernels[]`, called as
`LIB.<name>(...)` and linked into the service binary through FFI. Use it only when a specific
native library must be linked: it adds a native build dependency, a crash takes the process down, and it
has no database or session access. Keep calls coarse. Its design is in the kernel pattern of mind-set.

## Names a custom-code author needs

The compiler's naming rules (the generated repo itself holds the per-generator detail; read the
generated files for the exact names before you call them):

- Data object: model name is PascalCase of the object name (`userGroup` becomes `UserGroup`).
  Cross-service reference is `<service>:<object>`. Postgres table is the English plural of the object
  name with its camel case kept (`order` becomes `orders`, `person` becomes `people`). MongoDB
  collection is the object name verbatim. Objects generated by higher-order patterns (payment, agent hub)
  start with `sys_`.
- `dbLayer`: `<operation><ModelName>`, imported from `dbLayer`.
- REST routes sit behind `/<serviceName>-api/v<version>/`. Standard action with its own resource:
  `/<pluralObject>` and `/<pluralObject>/:<object>Id`. Non-standard action: `/<action><Resource>`.
  An explicit `restSettings.routePath` overrides. Standard actions are get, list, create, update,
  delete; there is no automatic CRUD, only declared APIs.
- Kafka: DB events `<serviceCodename>-dbevent-<objectname>-<verb>` with
  `serviceCodename = <projectCodename>-<serviceName>-service` and verb `created`, `updated` or
  `deleted`; API events `<projectCodename>-<serviceName>-service-<raisedEvent>`, lowercase, raised
  only when `apiOptions.raiseApiEvent` is true; index events `elastic-index-<codename>_<object>-<verb>`.
- Elasticsearch index: `<codename>_<objectname>` lowercased.
- Every service that lets users log in also serves `GET /publickey` (its Ed25519 public key) and
  `POST /rawsearch/:index`. The latter needs a login, and stays off (403) until the operator sets
  `RAWSEARCH_INDEXES`; it accepts only a small query subset (no scripts, aggregations or wildcards).

## Testing custom code

A generated service collects `**/__tests__/**/*.test.ts` and `**/*.spec.ts`, and nothing else.
`__tests__/mytest.ts` and `my.test.js` are silently never run. Keep helper modules out of
`__tests__/` (the convention is a sibling `__testutils__/`), because jest would collect them as
empty suites and fail the run. Test an edge function by passing a mocked context
(`{ body, headers, session }`) and asserting the return value; mock `dbLayer` so unit tests never
touch a database, and mock `ServiceIndexer` for cross-service reads. The aliases `common`,
`dbLayer` and `models` resolve under jest. More in [testing.md](testing.md).
