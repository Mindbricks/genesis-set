---
name: genesis-compiler-api
description: PRE-RELEASE. Compile a validated OpenAPPL blueprint into service code with the Genesis Compiler API (validate, start a build, follow it, cancel it) and report what each service build produced. Use it after the blueprint is written and validated with mind-set, when the user wants generated code. Do not use it to design or write the blueprint (the mind-set openappl-blueprint-* skills) or to run the generated services (genesis-generated-code).
---

# Genesis Compiler API

> **Pre-release.** The Genesis Compiler API is not reachable yet. Read the guide so you can
> explain what compiling will do, but do not claim a validation or a build happened. When a
> call cannot be made, say so plainly and stop there.

The guide is `{{CORPUS}}/genesis/compiler-api.md`. Read it fully before the first call.

## Before you call

1. The blueprint is written and validated with mind-set (the openappl-blueprint-authoring
   skill and `mind-set validate blueprint.json`, schema `{{MIND_SET}}/openappl.json`).
2. The project identity is the blueprint's: the codename is
   `projectSettings.basicSettings.name`. Do not create a binding file or any other file in
   the project folder for the compiler.
3. The API key is in the environment variable `GENESIS_API_KEY`. If it is not set, ask the
   user to set it in their shell; never ask them to paste it into a file, the blueprint or
   the chat, and never print it.

## The calls

1. `POST /validate` with the whole blueprint inline; fix every error, judge every warning.
2. `POST /builds` with a fresh `Idempotency-Key`, the services to compile and
   `"dryRun": true` (the only mode at opening). Compile `auth` first when the domain
   services read its shape; compile each other service once, after the whole blueprint
   validates.
3. Follow `GET /builds/:id` with a growing interval until the build is `succeeded`,
   `partial`, `failed` or `cancelled`. Retry a failed request with the SAME key.
4. Report per service: status, added / deleted lines, files, and every error code.

## Not available yet

Validating one service, per-service build jobs, listing builds, pushing to your own git,
deploy artifacts, credit, and the local `genesis_*` MCP tools are announced but not
available: the guide's section 5 lists them. Do not call them.
