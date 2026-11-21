---
name: genesis-generated-code
description: Work with what the Genesis compiler generates from an OpenAPPL blueprint - the runtime behaviour of the generated services (payment and subscription ladders, verification codes, mail and SMS sinks, credential fallbacks, per-language support), custom code (library functions, edge controllers, dbLayer, LIB / API) and the Genesis steps next to the mind-set procedures. Use it while following a mind-set procedure for a project compiled by Genesis, when the blueprint needs custom code, and when a generated service behaves unexpectedly. Do not use it to write the blueprint itself (mind-set), to call the Compiler API (genesis-compiler-api) or to run and test the services (genesis-run-and-test).
---

# The Genesis compiler's output

genesis-set adds to mind-set; it never repeats it. The procedures are mind-set's, at
`{{MIND_SET}}/procedures/`. For each procedure that has Genesis-specific steps, genesis-set
ships one additions file under `{{CORPUS}}/genesis/procedures/` with the same name; the index is
`{{CORPUS}}/genesis/procedures/README.md`.

## How to read the additions

1. Follow the mind-set procedure as it is.
2. Before you start it, open its Genesis additions file (when the index lists one). Each section
   names the heading of the mind-set procedure it belongs to, and either ADDS steps there or
   REPLACES a step (the replaced mind-set text is quoted by its first words). Where a section
   replaces a step, do the Genesis version.
3. A rule in the additions about the generated runtime (error codes, admin routes, mock
   transports, health fields) is how Genesis-generated code behaves; treat a different answer
   from a running service as a finding to report, not as a reason to change the blueprint.

## Custom code

Read `{{CORPUS}}/genesis/custom-code.md` before you write a library function, an edge
controller or an arrow-function action. The pattern shapes are mind-set's
(`{{MIND_SET}}/procedures/blueprint-authoring.md`, section 8); the page says what the compiler
generates from them, what the code can call (`LIB`, `API`, `dbLayer`, `common`) and what survives
a rebuild.

- Custom code lives in the blueprint and is re-injected at every compile.
- Keep edits in the blueprint. A compile overwrites direct edits to generated files, and added
  lines will count toward usage when charging opens.
- Files you add to a service repository survive; `service-files/` is always yours.

## When the generated runtime surprises you

`{{CORPUS}}/genesis/pitfalls.md` lists the compiler facts that look like bugs: the slot decides
the verification-code echo and the sinks (`CONFIG_ENV`), mail without a complete provider goes to
a sink, credential fallbacks, payment tables that need `auth` compiled after the provider, schema
drift, signing keys, empty peer addresses, a service that never exits at boot.

## Where the fix goes

A wrong result from a generated service is a blueprint fault (fix the blueprint, validate,
compile again), a fault of your own deploy (env, keys, peers), or a compiler fault (report it
with the job id and the exact error; `{{CORPUS}}/genesis/compile-results.md`, section 7).
