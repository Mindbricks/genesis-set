---
name: genesis-compiler-api
description: PRE-RELEASE. Compile a validated OpenAPPL blueprint into service code with the Genesis Compiler API through the genesis_* MCP tools (genesis_validateApplication, genesis_validateService, genesis_buildService, genesis_getServiceBuild, genesis_getBuilds), follow each service build and report what it produced. Use it after the blueprint is written and validated with mind-set, when the user wants generated code, deploy files or the status of a build. Do not use it to design or write the blueprint (the mind-set openappl-blueprint-* skills), to run or test the generated services (genesis-run-and-test) or to deploy them (genesis-deploy).
---

# Genesis Compiler API

> **Builds are dry runs for now:** the code is generated and measured, nothing is pushed. When a
> tool answers `GENESIS_UNREACHABLE`, say so plainly and stop: never claim a validation or a
> build happened.

The guide is `{{CORPUS}}/genesis/compiler-api.md`. Read it fully before the first call. Reading a
service build's result is `{{CORPUS}}/genesis/compile-results.md`.

## Before you call

1. The blueprint is written and validated with mind-set (the openappl-blueprint-authoring skill
   and `mind-set validate blueprint.json`, schema `{{MIND_SET}}/openappl.json`). Follow the
   mind-set procedure `{{MIND_SET}}/procedures/project-lifecycle.md` with its Genesis additions
   `{{CORPUS}}/genesis/procedures/project-lifecycle.md`.
2. Identity is the blueprint's: the codename is `projectSettings.basicSettings.name`; a new
   blueprint gets a stable project id (a UUID) once. Write no binding file or other compiler file
   into the project folder.
3. The `genesis_*` tools are there (the MCP server `genesis`; `genesis-set install` registers it,
   then restart the agent). A call that answers `GENESIS_API_KEY_MISSING` carries the message that
   tells the user where to create the key (the Genesis portal's API keys page) and how to set it
   (`GENESIS_API_KEY`, or `genesis-set config set-key` in their own terminal): pass it on. The
   easiest way for the user is the local key page: `genesis_requestKey` with
   `name: "genesis-api-key"` answers its link; then check `genesis_listKeys`. Never ask for the key
   in the chat, never write it into a file, never print it.

## The calls

1. `genesis_validateApplication` with `blueprintPath` (absolute). Fix every error, judge every
   warning. While iterating on one service, `genesis_validateService` with `fragmentPath` is the
   fast loop; `notChecked` is not a pass, so finish with the whole blueprint.
2. Author everything and validate everything first, then compile each service once. During the
   dry-run release the line counts are estimates and no credit is charged. Compile `auth` first
   when the others or the tests need it.
3. `genesis_buildService` per service, with `deployTargets` when the user wants deploy files.
   Keep the returned `idempotencyKey`; after a lost answer, call again with the same key and the
   same arguments (never a second build).
4. `genesis_getServiceBuild` with the `jobId`: 5 s, 10 s, then every 30 s, until `succeeded`,
   `failed` or `cancelled`. Never report a build you did not see finish.
5. Report per service: status, added / deleted lines, files, deploy artifacts, every error code.
   A failure is a blueprint fault (fix, validate, compile that service again) or a compiler fault
   (report it with the job id and the exact error).
6. `genesis_getBuilds` finds earlier builds and their job ids (filter by `codename`).
7. Start the run-and-test skill when the matching generated service repositories are available.
   A successful dry run provides a report and inventory. It leaves no checkout or local deploy files.

## Not available yet

Reading the blueprint from git (`repo`), pushing to the user's repositories (direct or pull
request), credit and usage: the guide's section 10. Do
not call them; say so when asked.
