# Reading a compile result

What a finished (or failed) Genesis build tells you, field by field, and what it does not
tell you. The compile result an agent reads is the job from `genesis_getServiceBuild`
(`GET /jobs/:jobId`), one per service. For the calls that start and list builds see
[compiler-api.md](compiler-api.md); to run what was generated see [run-locally.md](run-locally.md).

## 1. Which result to read

- `genesis_buildService` answers the build and a `jobId` per service. `genesis_getBuilds`
  lists builds with the `jobId`, status and line counts of each service.
- The build row (`GET /builds/:id`) is the summary: status, per-service status, line counts,
  `totals`, `deployArtifacts`. The log tail and the file list are NOT on it: they live on the job.
- Read the JOB for anything you need to act on. Poll it with a growing interval (5 s, 10 s,
  then 30 s) until the status is final: `succeeded`, `failed` or `cancelled`.
- A job of another account answers `404 GENESIS_JOB_NOT_FOUND`, the same as a wrong id.

## 2. Statuses

Job (service) status: `pending`, `running`, `succeeded`, `failed`, `cancelled`.

Build status: `queued`, `running`, then one of:

| Build status | Meaning | What to do |
|---|---|---|
| `succeeded` | every service of the build succeeded | read each job before saying so (section 3) |
| `partial` | some services succeeded, some failed (a failed service never stops the others) | use the complete services, repair the failed ones one by one |
| `failed` | no service could be generated; `error.code` is `GENESIS_BUILD_FAILED`, or `GENESIS_INTERNAL_ERROR` / `GENESIS_BUILD_INTERRUPTED` (section 5) | read the job errors, then the code table |
| `cancelled` | a cancel arrived; services not started are `cancelled`, a finished service keeps its result | start a new build when you still want the rest |

Services of one build are compiled one after the other, in the order you gave. A queued or
pending job is not a result.

## 3. The job fields

| Field | How to read it |
|---|---|
| `id`, `buildId`, `serviceName`, `codename`, `language`, `dryRun` | which build and service this is. `language` is `nodejs` for `mcpbff` whatever the build language is. `dryRun: true` means the code was generated and measured and nothing was pushed (the only mode for now) |
| `status` | section 2 |
| `createdAt`, `startedAt`, `finishedAt` | `startedAt` is null while the job waits; a long gap between `createdAt` and `startedAt` is queueing, not slowness |
| `addedLines`, `deletedLines` | the git diff of the generated tree against the previous state of the service repo (an empty base on a first build) |
| `files`, `binaryFiles` | count of changed text files and of changed binary files |
| `fileList`, `fileListTruncated` | the changed paths, at most 2000, the manifest file left out. `fileListTruncated: true` means the list is cut, the counts are not |
| `tokens` | the billed amount of this job: it equals `addedLines`. A dry run is not charged while charging is not open |
| `manifest` | what the build did to the files already in the repo (section 4) |
| `commitSha`, `pullRequestUrl` | null while builds are dry runs; they name the pushed commit / pull request once pushing opens. Null is not a failure |
| `deployArtifacts` | null when no `deployTargets` were asked; otherwise one entry per target with `status` (`emitted` or `skipped`), `path`, `files`, `reason` |
| `error` | null, or `{ code, message }` (section 5). `message` is cut at 2000 characters, workspace paths are masked |
| `logTail` | the last 50 lines of the service's compile log, each cut at 500 characters; the queue's own scheduling lines are dropped |

Rules:

- A `succeeded` job with `addedLines: 0` and `deletedLines: 0` means the generated tree equals
  what the repo already holds. That is correct after a rebuild without blueprint change.
- A big `deletedLines` on a rebuild is either a blueprint change that removed code or
  your edits to generated files being overwritten (section 4). Check `manifest` before
  blaming the compiler.
- `deployArtifacts[].status: "skipped"` is normal for a part that has no container image
  (the document service, the frontend prompt docs). Its `reason` says so.
- `fileList` is the way to see what a build touched. Open a few generated files; do not
  take the counts as proof the right code exists.

## 4. The `manifest` summary

Every build writes `.genesis/manifest.json` (schema `genesis-manifest/1`) into the service
repo: the generated paths, each with its git blob id. The next build sorts the files already
in the repo with it. Never edit that file. The job's `manifest` object counts the result:

| Field | Meaning |
|---|---|
| `firstBuild` | no previous manifest was found: every file already in the repo is yours and was kept |
| `generatedFiles` | files the build wrote and listed in the manifest |
| `customerFiles` | files that are not in the previous manifest, kept untouched (they cost no lines) |
| `removedFiles` | files the previous manifest listed that the blueprint no longer generates: deleted |
| `editedFilesOverwritten` | generated files you had edited: your edit is gone and the re-added lines are counted |
| `customerFilesOverwritten` | your files at a path the build now generates (or a folder path it writes as a file): replaced by the generated file |

What to do with it:

- `editedFilesOverwritten > 0` or `customerFilesOverwritten > 0` is a warning, not a
  failure. Diff the repo against its last commit, restore what mattered through the
  blueprint (custom code belongs in the places `custom-code.md` names) and rebuild.
- `removedFiles > 0` after you renamed or removed a design object is expected. After no
  blueprint change it is not: look at which files with `fileList`.
- Everything under `service-files/` is always yours: it is kept even over a generated
  path and never listed in the manifest.
- A broken manifest in the repo (not JSON, wrong schema, a bad path) is not treated as a
  first build: the job fails with `GENESIS_MANIFEST_INVALID`. Restore `.genesis/manifest.json`
  from git history, or remove the file only when you accept that the next build treats
  every file in the repo as yours.

## 5. Failure codes

On a job, `error.code` is one of these. On the build row the same field carries the
build-level ones.

| Code | Where | Meaning | What to do |
|---|---|---|---|
| `GENESIS_SERVICE_BUILD_FAILED` | job | the compiler could not generate this service. `error.message` is the compiler's message, `logTail` the end of its log | section 6: classify, then repair the blueprint or report it |
| `GENESIS_DEPLOY_ARTIFACTS_FAILED` | job | the code was generated but writing `deploy/<target>/` failed | rebuild; if it repeats, report it with the job id. The service is not complete: do not use its tree |
| `GENESIS_MANIFEST_INVALID` | job | `.genesis/manifest.json` of the repo is invalid (section 4) | repair the manifest file, rebuild |
| `GENESIS_DIFF_FAILED` | job | the code was generated but could not be measured against the repo | rebuild once; if it repeats, report it with the job id and the log tail |
| `GENESIS_BUILD_FAILED` | build | no service of the build could be generated | read each job's own error |
| `GENESIS_BUILD_INTERRUPTED` | build | the worker stopped (no sign of life for 10 minutes); unfinished services are `cancelled` | start a new build with a NEW idempotency key. Services that finished keep their result |
| `GENESIS_INTERNAL_ERROR` | build | the compiler could not finish the build | one retry with a new key; if it repeats, report it, do not loop |

Also on the paths you call: `GENESIS_JOB_NOT_FOUND` and `GENESIS_BUILD_NOT_FOUND` (404: wrong
id or another account's), `GENESIS_BUILD_FINISHED` (409: cancel of a finished build),
`GENESIS_BAD_FILTER` / `GENESIS_BAD_CURSOR` (400: a list call with a bad filter or cursor).

## 6. Where compiler-level diagnostics show up

The job has no structured list of compiler errors. The text of a failure is in two places:

1. `error.message` of a `GENESIS_SERVICE_BUILD_FAILED` job.
2. `logTail`, the last 50 lines. The cause is usually in the last lines; a long message is cut
   at 500 characters per line, so a very long compiler message may need the next step.

For more than the tail, compile the generated service yourself (section 8): the target
language's own compiler gives the full, authoritative list.

Shapes you will meet in the log or in a local compile of a nodejs service, and what they mean:

- **A library or edge function body that uses a name nothing declares** fails the build before
  anything is written. The message names the function, the identifier and the line. Fix the
  body in the blueprint.
- **Any other compile error in code you authored** (an MScript, a library body, an edge body)
  also fails the build: a service whose emitted code does not compile cannot boot. The message
  carries the TypeScript code and the compiler text. Two common ones:
  - `TS2801`: the result of a `LIB.*` call (a promise) is tested in a condition without being
    awaited. Await it first, test the result after.
  - `TS18047`: `const p = this.instance; p.x` with no null check. Guard the value before the
    member access.
- Validation warns about these shapes before a build: `MSCRIPT_LIB_CALL_IN_SYNC_CALLBACK`,
  `MSCRIPT_LIB_RESULT_VAR_NOT_AWAITED`, `MSCRIPT_NULLABLE_MEMBER_UNGUARDED`. A warning you
  left standing is the first suspect for a failed build. Warning-tier compiler diagnostics
  never block a build.
- The first compile error is the cause; later ones are often its echo. Fix the first,
  rebuild, then read the next.

### Translator gates (non-nodejs languages)

Validation success does not guarantee that every authored expression translates to another
language. For dotnet, fiscal hooks, feed expressions and socket predicate / mapper / lifecycle
bodies refuse an unsupported translation, or the warnings the translator added. API arrow
bodies refuse on the `FAITHFUL_WARNINGS` set; agent post-process also refuses on the
`POST_PROCESS_LOUD_WARNINGS` set. When a job fails this way, the log names the authored
slot:

- Keep the expression portable (the plain JS form the other languages translate) and
  simplify it, or move it to a supported shape. Do not bypass the gate, and do not rewrite
  the blueprint in the target language.
- If the same form is supported on nodejs, say so in your report: it is a known per-language
  gap, not your blueprint's fault.

## 7. Blueprint fault or compiler fault

Classify before acting; the remedy differs.

| Evidence | Class | Remedy |
|---|---|---|
| the message names an authored slot (an MScript path, a library or edge function, a property) | blueprint | fix the blueprint, `genesis_validateApplication`, rebuild |
| the message is a translator gate (section 6) | blueprint (shape) or known language gap | simplify, or report the unsupported form |
| a reference, role or object the message names does not exist in the blueprint | blueprint | add or correct it |
| the failing code is generated framework code you did not author, with no authored slot in the message | compiler | keep the job id, the log tail and the blueprint hash; report it |
| `GENESIS_INTERNAL_ERROR`, `GENESIS_BUILD_INTERRUPTED` | service side | one retry with a new key, then report |

Rules:

- Never hand-edit generated code as the fix. The next build overwrites it (and counts the
  overwrite). The blueprint is the source.
- A missing structured cause proves nothing. "No authored slot in the message" does not by
  itself make it the compiler's fault: read the log before deciding.
- **A workaround you ship is a bug report in disguise.** If your repair is one of these,
  the real defect is probably in the compiler: a data-clause override that forces a value the
  generated clause set wrong; moving a write to another milestone because the main operation
  overwrote it; raw database writes because the managed write does the wrong thing; manual
  cache invalidation because a write did not invalidate; a runtime guard (`if (!x) return`)
  against an undefined the data shape says cannot happen; skipping a test that shows real
  behaviour. Report it before you call the work done.
- **Cap: three build attempts per service for one failure.** After the third, stop and bring
  the evidence to the user. Each build adds lines to the bill; thrashing costs money.
- Build one wave: validate the whole blueprint, compile the services, read every job, then
  repair. Do not rebuild a service after each small authoring step.

## 8. Compiling the generated service yourself

The job proves that code was generated and measured. A repo that builds is a separate
fact, and the language's own toolchain is the only judge:

| Language | Check |
|---|---|
| nodejs | `npm install` then the TypeScript compile the repo's scripts give (run `npx tsc --noEmit` when the scripts name none) |
| dotnet | `dotnet build`, and `dotnet publish` for what the image runs |
| other languages | the repo's own build command (see its `README.md` / Dockerfile) |

Rules:

- A job that is `succeeded` with a log tail free of errors is **not** a compiler pass.
  For a language other than nodejs, a generation can finish without the emitted code ever
  being compiled by the target toolchain. Say "generated, compile unverified" until you
  compiled it.
- A local `dotnet build` pass does not prove `dotnet publish` inside the image: a different
  SDK or image can still fail, for example the native protoc step failing with `MSB6003`
  although generation succeeded. Build the image the deploy will use (`Dockerfile.prod` or
  the compose file) before calling a service deployable.
- Any frontend code you build from the frontend prompt docs needs its own toolchain; the
  backend result says nothing about it.
- Record target, toolchain version, commit and the command beside the verdict.
  "Compiles" without these is a guess.
- Pin the check to a commit. The repo's HEAD, the job's `commitSha` (once pushing exists)
  and what you run must be the same code. A local edit of a generated file makes your result
  about the edit, not the build.

## 9. Alive is not ready, a link is not health

Generated and running are different facts, and a green build says nothing about running.
After you start the service yourself (see [run-locally.md](run-locally.md)):

- `GET /health` answering `{"status":"ok"}` is liveness: the process is up.
- The same answer carries `readiness: { ready, schema: { outcome, phase?, reason? } }`.
  `ready: false` means the initial schema materialisation failed (for example
  `phase: "missing_tables"`, `reason: "permission_denied"`): the service answers 200 but
  every request that touches a missing table fails. Restarting does not fix it: read the
  service's log, fix the design or the database permission, rebuild and restart. A pending
  migration, an absent optional Elasticsearch or Kafka, ledger and index policies never make
  `ready` false.
- The generated service never exits at boot on a missing dependency or credential: it starts
  and answers errors. A running process and an open port prove nothing.
- Do not probe business endpoints to "verify" a build. They need a session, a body and
  fixtures you do not have yet, and every probe answers 401, 403, 400 or 404 from a layer you
  do not control. Test endpoints with a plan and fixtures ([testing.md](testing.md)).
- Copy routes from the generated service's API documents or route list; never build a URL
  from a blueprint `routePath` or from REST habit. For example the login route is
  `POST /login`, not `POST /auth/login`.
- A pull request URL, a commit sha, a `fileList` or a `succeeded` status are links and
  counts. None of them is a passing compile, a booted service or working business logic.
  Report each fact with its own evidence: validated, generated, measured, compiled,
  booted, healthy, tested.

## 10. Before you report a result

Write, per service: the job id, the status, `addedLines` / `deletedLines`, the `manifest`
overwrite counts, the error code and the first failing line of the message when there is one,
and which of the facts in section 9 you actually observed. Never report a build you did not
see finish, and never report "no errors" when you only saw no error field.
