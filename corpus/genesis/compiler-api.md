# The Genesis Compiler API

> **Builds are dry runs for now** (section 6): the code is generated and measured, nothing is
> pushed. Do not tell a user a validation or a build ran when you did not see its answer, and
> do not invent one: when a call answers `GENESIS_UNREACHABLE`, say the API could not be
> reached and stop.

The Genesis Compiler API compiles an OpenAPPL blueprint into the source code of its services.
You write and validate the blueprint locally with mind-set; Genesis turns it into code; you run,
test and deploy that code yourself. No project is created or managed anywhere: everything the
compiler needs comes from the blueprint and the request.

You call it through five MCP tools that genesis-set installs (section 3). For CI or a script
without an agent, the same endpoints are plain REST (section 9).

## 1. What Genesis generates

- Every service of the blueprint: `auth`, `bff`, `notification`, the agent hub when it is
  declared, and each business service, in the language of the request (`nodejs` unless the API
  enables more).
- The derived services: `mcpbff` (always nodejs), `document` (the project's documentation
  service) and `frontend` (the per-service frontend prompt documents). They are part of the
  service list `genesis_validateApplication` answers.
- Not generated: the admin panel (`panel`) and a platform SDK repository (`sdk`). Asking for them
  answers `422 GENESIS_SERVICE_NOT_AVAILABLE`.
- Optionally, per build, deploy artifacts for your own deploy (section 7 and [deploy.md](deploy.md)).

Genesis never deploys anything and never runs your services.

## 2. Identity comes from the blueprint

- The **codename** is `projectSettings.basicSettings.name`: one lowercase word. It prefixes the
  repository names (`<codename>-<service>-service`), index names and event topics, and it is the
  `codename` filter of `genesis_getBuilds`. Choose it once: renaming it later renames everything
  generated from it.
- The display name is `projectSettings.basicSettings.fullname`.
- The generated services may use a **project id**. When you create a new blueprint, write a
  stable id into it once (a fresh UUID) and never change it. To Genesis that id is an opaque
  label: it selects nothing, so the same blueprint compiles the same way for any account.
- There is no binding file in the project folder, and genesis-set never writes one.

## 3. Setup

1. `genesis install` registers the MCP server `genesis` for Claude Code and Codex. Restart
   the agent afterwards so it loads the tools.
2. The API key.
   - **Getting it:** the user creates it on the Genesis portal's API keys page,
     `https://portal.genesiscompiler.com/keys` (for the stage API `sapi.genesiscompiler.com`,
     `https://stage.genesiscompiler.com/keys`). It is shown once. Give the user that link.
   - **Setting it:** the environment variable `GENESIS_API_KEY`, or `genesis config set-key`
     run by the user in their own terminal. That command reads the key from stdin and stores it
     in `~/.genesis-set/config.json`, readable only by the user. `genesis install` offers the
     same prompt at its end when it runs on a terminal.
   - **Easiest with an agent:** `genesis_requestKey` with `name: "genesis-api-key"` answers the
     local key page link; the user pastes the key there, and the genesis_* tools use it at once.
   - **Never** ask the user to paste the key into the chat, a project file or the blueprint, and
     never print it.
   - A call without a key answers `GENESIS_API_KEY_MISSING`. Its message names the portal page
     and how to set the key: pass it on as it is.
3. The API base is `https://api.genesiscompiler.com`. Change it only when the user names
   another one (`GENESIS_API_BASE`, or `genesis config set-base <url>`).
4. `genesis doctor` says where the key comes from and which key it is (type prefix and last four
   characters, never the whole key), the API base and
   whether each agent has the MCP server.

## 4. The tools

| Tool | Endpoint | Use it to |
|---|---|---|
| `genesis_validateApplication` | `POST /validate` | Validate the whole blueprint; learn the codename and the services Genesis would build. |
| `genesis_validateService` | `POST /validate/service` | Validate one service, from the whole blueprint or from that service's JSON alone. |
| `genesis_buildService` | `POST /builds` (one service) | Compile one service; answers its `jobId`. |
| `genesis_getServiceBuild` | `GET /jobs/:jobId` | Follow one service build to its end and read its result. |
| `genesis_getBuilds` | `GET /builds` | List your builds, newest first. |

Every answer is JSON: the API's body with `httpStatus` added. A failure is always
`{ "error": { "code": "GENESIS_...", "message": "...", "details": {} } }` and the tool marks
it as an error. Report the code and the message; do not paraphrase a failure into a success.

### 4.1 The blueprint source

- `blueprintPath`: the blueprint JSON file on this machine. The tool reads it, checks the size
  (10 MiB of compact JSON, the API's limit) and sends the object inline. The path itself is never
  sent. A file over the limit answers `GENESIS_BLUEPRINT_TOO_LARGE` with
  `details.checkedLocally: true` before anything is sent; a missing file
  `GENESIS_BLUEPRINT_FILE_NOT_FOUND`; a file that is not one JSON object
  `GENESIS_BLUEPRINT_FILE_INVALID`. A relative path is read from the folder the agent was
  started in: prefer an absolute path.
- `fragmentPath` (`genesis_validateService` only): a JSON file holding one entry of the
  blueprint's `services` list.
- `repo`: `{ "provider": "github" | "gitlab", "repo": "<owner>/<name>", "ref", "path" }`, the
  blueprint in a git repository, for CI. It is passed through as given. **Not available yet:**
  the API answers `422 GENESIS_BLUEPRINT_SOURCE_NOT_AVAILABLE`; use `blueprintPath`.

Give exactly one source. An unknown argument is refused (`GENESIS_BAD_ARGUMENTS`) before any
call: the tools send the blueprint and the parameters they name, nothing else.

### 4.2 `genesis_validateApplication`

Arguments: the source, optional `language`, optional `services` (check only that these exist and
can be built).

- `200 { "valid": true, "codename", "language", "blueprintHash", "services": [...] }`: `services`
  is the build order Genesis uses.
- `422 { "valid": false, "error": { "code": "GENESIS_BLUEPRINT_INVALID", "details": { "errors", "warnings" } } }`:
  every finding has `path`, `code` and `message`. Fix the blueprint, run `mindset validate`
  again, then call again.
- `429 GENESIS_RATE_LIMITED`: the validation budget (per user, per minute, shared with
  `genesis_validateService`) is spent; wait a minute. Do not loop on validation.

Validation is free. A warning is a decision: fix it, or record why it stays (the mind-set
validation rules hold for the Genesis answer too).

### 4.3 `genesis_validateService`

Arguments: `serviceName` and one source (`blueprintPath`, `fragmentPath` or `repo`), optional
`language`. Same answer shape as 4.2 plus `scope` (`blueprint` or `fragment`) and `notChecked`.

- With the whole blueprint the service is judged exactly as its build will judge it.
- With a fragment the service is judged alone. A finding that only exists because the context is
  missing (another service, a role of the authentication module, a provider or log declared in
  `projectSettings`, the hubs, the integrations) is listed under `notChecked`
  (`code: GENESIS_NOT_CHECKED`, `context`, `reference`, the validator's code as `reason`), never as
  an error. `notChecked` is not a pass: validate the whole blueprint before you build.
- A fragment whose own name is not `serviceName` answers `422 GENESIS_FRAGMENT_MISMATCH`.

Use the fragment form while iterating on one service; use the whole blueprint before a build.

### 4.4 `genesis_buildService`

Arguments: `serviceName`, the source (`blueprintPath` or `repo`), optional `deployTargets`,
`language`, `dryRun` (default and only accepted value today: `true`) and `idempotencyKey`.

- `202 { "build": { "id", "status": "queued", ... }, "jobId", "idempotencyKey" }`. The build runs
  asynchronously; follow `jobId` with `genesis_getServiceBuild`.
- The tool sends a fresh `Idempotency-Key` and returns it. If the answer is lost (a timeout, a
  dropped connection), call again with the SAME `idempotencyKey` and the same arguments: you get
  the same build (`200`), never a second one. The same key with a different request answers
  `409 GENESIS_IDEMPOTENCY_CONFLICT`. A new build needs no key (omit it).
- Refusals before the build starts: `GENESIS_SERVICE_UNKNOWN` (with `details.available`),
  `GENESIS_SERVICE_NOT_AVAILABLE` (panel, sdk), `GENESIS_BLUEPRINT_INVALID` (the same findings as
  4.2), `GENESIS_DRY_RUN_REQUIRED`, `GENESIS_OPTION_NOT_AVAILABLE`, `GENESIS_UNKNOWN_DEPLOY_TARGET`
  / `GENESIS_BAD_DEPLOY_TARGETS` (with `details.allowed`), `GENESIS_LANGUAGE_NOT_ALLOWED`.

### 4.5 `genesis_getServiceBuild`

Argument: `jobId`. Answers `{ "job": { ... } }`: `status` (`pending`, `running`, `succeeded`,
`failed`, `cancelled`), times, `addedLines`, `deletedLines`, `files`, `fileList`, `tokens`, the
`manifest` summary, `deployArtifacts`, `error`, and the tail of the build log. How to read each
field and each failure: [compile-results.md](compile-results.md).

- Poll with a growing interval: 5 s, then 10 s, then every 30 s, and stop at a final status
  (`succeeded`, `failed`, `cancelled`). Never report a build you did not see finish.
- `404 GENESIS_JOB_NOT_FOUND`: the id is wrong, or the job is another account's.
- A build whose worker stopped is failed with `GENESIS_BUILD_INTERRUPTED`: start a new build
  (a new key).

### 4.6 `genesis_getBuilds`

Filters: `codename`, `status` (`queued`, `running`, `succeeded`, `partial`, `failed`,
`cancelled`), `serviceName`, `since` / `until` (ISO 8601), `limit` (default 20, at most 100) and
`cursor` (the `nextCursor` of the previous page; `null` on the last page). Each build lists, per
service, `serviceName`, `jobId`, `status`, `addedLines` and `deletedLines`. A bad filter answers
`400 GENESIS_BAD_FILTER`, a cursor this API did not give `400 GENESIS_BAD_CURSOR`. Use it to find
a `jobId` again after a lost session, and to show the user what was compiled.

## 5. How to compile a project

1. Author the blueprint with mind-set and validate it with `mindset validate blueprint.json`.
2. `genesis_validateApplication` with the whole blueprint; repair until it is valid. While you
   work on one service, `genesis_validateService` with its fragment is the fast loop; finish with
   the whole blueprint.
3. **Author everything, validate everything, then compile once.** Once charging opens, each
   build's added lines will count toward usage (section 6). Compiling a service again after a
   dependency changes can add another charge. Compile `auth` first when the other services or
   your tests need its live shape.
4. Compile one service per `genesis_buildService` call, in the order `genesis_validateApplication`
   answered. Recompile `mcpbff`, `document` and `frontend` after the services they describe
   change.
5. Follow each job to its final status. Report, per service: status, added / deleted lines,
   files, deploy artifacts, and every failure with its code. A failed service does not stop the
   others; fix the cause (a blueprint fault: fix, validate, compile again; a compiler fault:
   report it with the job id and the exact error) and compile only that service again.
6. Check whether you have the generated service repositories. A successful dry run provides job
   results and a file inventory. It leaves no checkout, archive or deploy files you can use locally.
   If the user already has the matching generated repositories, follow [run-locally.md](run-locally.md)
   and [testing.md](testing.md). Otherwise report the dry-run results and wait for an artifact-producing
   build before starting the run and test steps. Author custom code in the blueprint, as described in
   [custom-code.md](custom-code.md).

## 6. Dry run, credit and the overdraft rule

- **Every build is a dry run today:** the code is generated and measured, nothing is written
  anywhere and nothing is charged. The job's `addedLines`, `deletedLines`, `files` and `fileList`
  show what the build would write.
- **Credit is counted per added line of each build's own diff.** `tokens` on a job is its added
  lines. Every build is counted again, and the counts add up: compiling the same unchanged
  service twice costs nothing the second time (an empty diff), but every real change costs its
  added lines, including lines that overwrite your own edits of generated files.
- **The overdraft rule:** before each service starts, Genesis asks whether the account may build.
  A running build may go over the credit by at most one service; the next service is refused with
  a Genesis `402` and the user is told to top up. Plan builds so a top-up does not land in the
  middle of a dependent set.
- Charging and the usage endpoint are not open yet; until then nothing is charged.

## 7. Where the code goes

- **One repository per service**, named `<codename>-<service>-service`, in the user's own GitHub
  or GitLab account or group (connected in the Genesis portal).
- **Push mode:** a direct push to the base branch by default; the user can switch to pull-request
  mode in the portal. Not available yet: today every build is a dry run (`push` and `target`
  answer `GENESIS_OPTION_NOT_AVAILABLE`).
- **Your files are kept.** Each build writes `.genesis/manifest.json` (the files it generated).
  On the next build a file the previous manifest does not list is yours and survives; a generated
  file you edited is overwritten (and its lines are counted); a file no longer generated is
  removed. Everything under `service-files/` is always yours. The job's `manifest` summary counts
  each case.
- **Service files** (bytes the blueprint's service library refers to) live in your service
  repository, not in Genesis. Until builds compile onto your repositories, a build cannot read
  them; the build log says so.
- **Deploy artifacts:** `deployTargets` (`"docker-compose"`, `"railway"`, `"fly"`, `"render"`)
  writes `deploy/<target>/` into each service (generated files, counted like any other).
  Genesis never deploys: you, or the user's own tools, run the deploy with the
  user's own login. Commands per target: [deploy.md](deploy.md).

## 8. Failures at a glance

| Code | Status | Meaning, and what to do |
|---|---|---|
| `GENESIS_API_KEY_MISSING` | local | No key: pass the message on (it says how to set it). |
| `GENESIS_UNAUTHENTICATED`, `GENESIS_BAD_CREDENTIALS` | 401, 400 | The key was not accepted: the user sets the right one. |
| `GENESIS_ACCOUNT_REQUIRED` | 403 | A service credential was used; a user API key is needed. |
| `GENESIS_UNREACHABLE`, `GENESIS_TIMEOUT`, `GENESIS_BAD_RESPONSE` | local | The API did not answer properly. Say so; do not retry in a loop. A build retry reuses its key. |
| `GENESIS_RATE_LIMITED` | 429 | Validation budget spent: wait a minute. |
| `GENESIS_BLUEPRINT_INVALID` | 422 | Fix the findings in `details`. |
| `GENESIS_BLUEPRINT_UNREADABLE` | 422 | The blueprint could not be loaded at all: check its structure with `mindset validate`. |
| `GENESIS_BLUEPRINT_TOO_LARGE`, `GENESIS_PAYLOAD_TOO_LARGE` | local, 413 | Over the size limit. |
| `GENESIS_SERVICE_UNKNOWN`, `GENESIS_SERVICE_NOT_AVAILABLE` | 422 | Wrong service name, or panel / sdk. |
| `GENESIS_LANGUAGE_NOT_ALLOWED`, `GENESIS_LANGUAGE_NOT_SUPPORTED` | 422 | Use a language the API lists (today `nodejs` and `rust`). |
| `GENESIS_IDEMPOTENCY_CONFLICT` | 409 | The key belongs to another request: omit the key for a new build. |
| `GENESIS_DRY_RUN_REQUIRED`, `GENESIS_OPTION_NOT_AVAILABLE` | 422 | Only dry runs today. |
| `GENESIS_JOB_NOT_FOUND`, `GENESIS_BUILD_NOT_FOUND` | 404 | Wrong id, or another account's. |
| `GENESIS_SERVICE_BUILD_FAILED`, `GENESIS_BUILD_INTERRUPTED`, ... | on the job | See [compile-results.md](compile-results.md). |

## 9. The REST surface

Every path is below `{apiBase}/genesis/compiler/v1`, with `Authorization: Bearer <key>` and JSON
bodies. The tools are thin wrappers over these calls:

| Call | Body or query |
|---|---|
| `POST /validate` | `{ "blueprint": { "inline": {...} }, "language"?, "services"? }` |
| `POST /validate/service` | `{ "serviceName", "blueprint": { "inline": {...} } \| { "fragment": {...} } }` |
| `POST /builds` | header `Idempotency-Key`; `{ "blueprint": {...}, "services": [...], "dryRun": true, "deployTargets"?, "language"? }` (several services in one build are allowed) |
| `GET /builds/:id` | the build with every service row |
| `POST /builds/:id/cancel` | stops a running build; services not started are cancelled; a finished build answers `409 GENESIS_BUILD_FINISHED` |
| `GET /jobs/:jobId` | one service build |
| `GET /builds` | the filters of 4.6 as the query |

## 10. Not available yet

Announced; do not call them, and say so when the user asks:

- reading the blueprint from a git repository (`repo` / `"blueprint": { "git": ... }`);
- pushing to the user's repositories (direct or pull request) and reading service files there;
- credit, usage and the overdraft refusal (`402`).
