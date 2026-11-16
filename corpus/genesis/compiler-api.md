# The Genesis Compiler API (pre-release)

> **Pre-release: the Genesis Compiler API is not reachable yet.** This page describes the
> surface that is built and switched off until the API opens. Do not tell a user a build ran,
> and do not invent an answer: when a call cannot be made, say so and stop.

The Genesis Compiler API compiles an OpenAPPL blueprint into the source code of its services.
You write and validate the blueprint locally with mind-set; Genesis turns it into code. No
project is created or managed anywhere: everything the compiler needs comes from the
blueprint and the request.

## 1. Identity comes from the blueprint

- The **codename** is `projectSettings.basicSettings.name` (one lowercase word; it prefixes
  repository names, index names and event topics). The display name is `fullname`.
- A **project id** in the blueprint is an opaque label the generated services may use. It
  selects nothing on the compiler side, so the same blueprint compiles the same way for any
  account.
- There is no binding file in the project folder, and genesis-set never writes one.

## 2. Credentials

- Requests carry your Genesis API key: `Authorization: Bearer <key>`.
- Keep the key in the environment variable `GENESIS_API_KEY`. Never write it into the
  blueprint, a project file, a commit, a test fixture or a log. `genesis-set doctor` reports
  only whether the variable is set.
- Provider secrets in the blueprint follow mind-set: `$ENV:NAME` references, or the
  `ENTER_CREDENTIAL` placeholder with `secret: true` while a value is not provided yet.
- The blueprint is sent to the compiler and usually committed: never put a real super-admin
  password in it. Use an `$ENV:` reference, or change the password at the first login.

## 3. The surface available at opening

Every path is relative to the API root `/genesis/compiler/v1`. Every answer, success or
failure, is JSON; an error is always:

```json
{ "error": { "code": "GENESIS_...", "message": "...", "details": {} } }
```

| Call | What it does |
|---|---|
| `POST /validate` | Validates a whole blueprint. Free, rate limited (`429 GENESIS_RATE_LIMITED`). |
| `POST /builds` | Starts a build (asynchronous). Needs the `Idempotency-Key` header. |
| `GET /builds/:id` | The build: status and, per service, the added / deleted lines and files. |
| `POST /builds/:id/cancel` | Stops a running build; services that have not started are cancelled. |

### 3.1 `POST /validate`

Body: `{ "blueprint": { "inline": { ...the whole blueprint... } }, "language": "nodejs", "services": ["auth", "order"] }`
(`language` and `services` are optional).

- `200 { "valid": true, "codename", "language", "blueprintHash", "services": [...] }`.
- `422 { "valid": false, "error": { "code": "GENESIS_BLUEPRINT_INVALID", "details": { errors, warnings } } }`:
  fix the blueprint, re-run `mind-set validate`, then call again.
- Other refusals: `GENESIS_BLUEPRINT_REQUIRED`, `GENESIS_BLUEPRINT_TOO_LARGE`,
  `GENESIS_BAD_LANGUAGE`, `GENESIS_LANGUAGE_NOT_ALLOWED`, `GENESIS_BAD_SERVICES`,
  `GENESIS_SERVICE_UNKNOWN`.

Validate before every build. A warning is a decision: fix it, or record why it stays.

### 3.2 `POST /builds`

Header `Idempotency-Key: <a fresh UUID per intended build>`. Body: the blueprint source as
above, `services` (the services to compile, in order; all when omitted), `language`, and,
at opening, `"dryRun": true`.

- `202 { "build": { "id", "status": "queued", "dryRun", "codename", "language", "services": [...] } }`.
  The same key with the same request answers the same build (`200`); the same key with a
  different request is `409 GENESIS_IDEMPOTENCY_CONFLICT`. A retry after a network error
  reuses the key, so it never starts a second build.
- At opening every build is a dry run: the code is generated and measured, nothing is
  written anywhere. Without `"dryRun": true` the answer is `GENESIS_DRY_RUN_REQUIRED`;
  `push`, `target` and `deployTargets` answer `GENESIS_OPTION_NOT_AVAILABLE`.
- Language: `nodejs` unless the API lists more. `mcpbff` is always `nodejs`. The admin panel
  service and the platform SDK repository are not generated
  (`GENESIS_SERVICE_NOT_AVAILABLE`).

### 3.3 `GET /builds/:id` and following a build

`{ "build": { "id", "status", "services": [{ "serviceName", "status", "addedLines", "deletedLines", "files", "error" }], "totals": { "addedLines", "deletedLines" }, "error", "createdAt", "finishedAt" } }`

- Build `status`: `queued`, `running`, then `succeeded`, `partial` (some services failed;
  the others are complete), `failed` or `cancelled`. Service `status`: `pending`, `running`,
  `succeeded`, `failed`, `cancelled`.
- Poll with a growing interval (5 s, then 10 s, then 30 s), and stop on a final status. A
  build whose worker stopped is `failed` with `GENESIS_BUILD_INTERRUPTED`: start a new
  build with a new key.
- `404 GENESIS_BUILD_NOT_FOUND`: the id is wrong or the build is another account's.
- `addedLines` is what a build will be charged when charging opens: every added line of the
  generated diff counts, including lines that overwrite your own edits of generated files.

### 3.4 `POST /builds/:id/cancel`

`202` with the build. A finished build answers `409 GENESIS_BUILD_FINISHED`.

## 4. How to compile a project

1. Author the blueprint with mind-set and validate it with `mind-set validate blueprint.json`.
2. `POST /validate` with the whole blueprint; repair until it is valid.
3. Compile `auth` first when the domain services read its shape, then every other service
   once, after the whole blueprint validates (each build is charged by the lines it adds).
4. Follow each build to its final status; report per service what was generated, the added
   and deleted lines, and every failure with its code. Never report a build you did not see
   finish.

## 5. Not available yet

These are announced and will arrive after the opening; do not call them, and say so when a
user asks:

- `POST /validate/service`: validate one service, from the whole blueprint or from that
  service's JSON alone.
- Per-service build jobs: a `jobId` per service of a build and `GET /jobs/:jobId` with the
  service's log tail.
- `GET /builds`: your builds, newest first, with filters and paging.
- Reading the blueprint from a git repository (`"blueprint": { "git": ... }` answers
  `GENESIS_BLUEPRINT_SOURCE_NOT_AVAILABLE`); send it inline.
- Pushing the generated code to your own git repositories (`push`: direct or pull request,
  one repository per service), with your edits to non-generated files kept.
- Deploy artifacts (`deployTargets`: docker-compose and others), credit and usage.
- A local MCP server in genesis-set with the tools `genesis_validateApplication`,
  `genesis_validateService`, `genesis_buildService`, `genesis_getBuilds` and
  `genesis_getServiceBuild`. Until it ships, call the REST API directly.
