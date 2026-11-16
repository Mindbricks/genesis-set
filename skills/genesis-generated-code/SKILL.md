---
name: genesis-generated-code
description: Work with what the Genesis compiler generates from an OpenAPPL blueprint - the runtime behaviour of the generated services (payment and subscription ladders, webhook provisioning, mailbox listening, per-language support) and the Genesis steps that sit next to the mind-set procedures. Use it while following a mind-set procedure for a project compiled by Genesis, and when verifying a generated service. Do not use it to write the blueprint itself (mind-set) or to call the Compiler API (genesis-compiler-api).
---

# The Genesis compiler's output

genesis-set adds to mind-set; it never repeats it. The procedures are mind-set's, at
`{{MIND_SET}}/procedures/`. For each procedure that has Genesis-specific steps, genesis-set
ships one additions file under `{{CORPUS}}/genesis/procedures/` with the same name; the
index is `{{CORPUS}}/genesis/procedures/README.md`.

## How to read them

1. Follow the mind-set procedure as it is.
2. Before you start it, open its Genesis additions file (when the index lists one). Each
   section names the heading of the mind-set procedure it belongs to, and either ADDS steps
   there or REPLACES a step (the replaced mind-set text is quoted by its first words). Where
   a section replaces a step, do the Genesis version.
3. A rule in the additions about the generated runtime (error codes, admin routes, mock
   transports, health fields) is how Genesis-generated code behaves; treat a different
   answer from a running service as a finding to report, not as a reason to change the
   blueprint.

## Where the fix goes

A wrong result from a generated service is a blueprint fault (fix the blueprint, validate,
compile again) or a compiler fault (report it with the request id and the exact error).
Never edit generated code: the next compile overwrites it.
