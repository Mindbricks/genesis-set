---
name: genesis-run-and-test
description: Run, debug and test the services the Genesis compiler generated, on the user's own machine - start the stack (the docker-compose deploy files or one service natively), read /health (alive is not ready), reproduce a failure and decide whose fault it is, write and run the API test suite, drive Kafka / cron / internal APIs through the generated test transport, and seed sample data. Use it after a Genesis build when the user wants to see the services work, test them or debug them. Do not use it to compile (genesis-compiler-api) or to deploy to a hosting target (genesis-deploy).
---

# Running and testing the generated services

Genesis never runs anything for the user: you run the generated services with the user's own
tools. Everything stays on the user's machine; nothing is sent to Genesis.

## Read first

- `{{CORPUS}}/genesis/run-locally.md`: what a generated service repository holds, env precedence,
  ports and signing keys, starting the stack, health, reproducing a failure, whose fault it is.
- `{{CORPUS}}/genesis/testing.md`: the test suite, identity bootstrap, fixtures, the test
  transport, reasoned skips, triage, and the sample-data seed.
- The test plan and the test report are mind-set's documents:
  `{{MIND_SET}}/procedures/design/writers/test-plan.md` and
  `{{MIND_SET}}/procedures/design/writers/test-report.md`. Write them as mind-set says; run them
  as the pages above say.

## Steps

1. Check out every service repository of the build side by side, at the commit of the build you
   test. Without push (pre-release), the repositories come from wherever the user keeps the
   generated code.
2. Start the stack: the `docker-compose` deploy files when the build asked for them
   (`deploy/docker-compose/README.md`), or one service natively (`npm run dev`) against local
   infrastructure. Generate an Ed25519 signing key per service first.
   Check the container runtime first (`docker info`). When there is none, follow run-locally.md
   section 4c: the user installs one (OrbStack or Docker Desktop on macOS, Docker Engine on
   Linux, Docker Desktop with WSL 2 on Windows), or one service runs natively against a
   database only, with what is missing said up front.
3. Wait for `/health` to say ready (`readiness.ready: true`, `boot.state: ready`). A 200 alone is
   only alive.
4. Run the suite; drive what HTTP cannot reach through the test transport as super-admin; never
   weaken an assertion to get green.
5. A failure: reproduce it, then route the fix (blueprint, custom code, the user's own deploy, or
   a compiler fault reported with the job id). Never patch a generated file.
6. Payment and subscription flows: follow the ladders in
   `{{CORPUS}}/genesis/procedures/howto-payment-flow.md` and
   `{{CORPUS}}/genesis/procedures/howto-subscription.md` next to their mind-set procedures.
7. Report what ran, what passed, what was skipped and why, and what is still running.
