---
name: genesis-deploy
description: Deploy the services the Genesis compiler generated, with the user's own login on the target - the docker-compose stack, Railway, Fly.io and Render - from the deploy files a Genesis build writes into each service (deploy/<target>/). Use it when the user wants the generated backend running somewhere: a server, Railway, Fly.io, Render. Genesis never deploys; this skill tells you how the user's own tools do it. Do not use it to compile (genesis-compiler-api) or for a local test run (genesis-run-and-test).
---

# Deploying the generated services

**Genesis never deploys.** It writes the deploy files; you run the deploy with the user's own
login on the target. No deploy token or platform credential ever goes to Genesis, into the
blueprint, into a project file or into a commit.

Read `{{CORPUS}}/genesis/deploy.md` fully first. Each target folder also has a generated
`README.md` for that service and build: read it before you run anything; where it and the guide
differ, it wins.

Builds are dry runs for now: nothing is pushed to the user's repositories. Deploy from a service
delivered with `genesis_deliverService` (the build must have asked for the target). Where
delivery is turned off for the account (`GENESIS_DELIVERY_NOT_ENABLED`) there is nothing to deploy yet (deploy.md says so first):
tell the user, and do not write the files by hand.

## Steps

1. The build must have asked for the target: `genesis_buildService` with
   `deployTargets: ["docker-compose", "railway"]` (the genesis-compiler-api skill). The job's
   `deployArtifacts` says per target `emitted` or `skipped`.
2. Prepare what every target needs: one Ed25519 signing key and key id per service, the
   provider credentials the service lists, the peer addresses the target does not wire itself.
   Secrets go into the target's secret variables or a gitignored local file, never a committed one.
   - **A local file:** ask for each key on the local key page (`genesis_requestKey`, the user saves
     it, `genesis_writeKeyToEnvFile`). Never take a value from the chat.
   - **A hosting target:** the user enters the key in the target's own secret settings.
3. Deploy with the target's own tools and the user's own login (deploy.md, sections 3 to 6).
   When a command needs the user's sign-in, ask the user to do it; do not handle their password.
4. Verify on the target: its deploy log, then `/health` ready on the public address. Report the
   address and the health verdict per service; never report a deploy you did not see succeed.
5. A target the API does not accept (`GENESIS_UNKNOWN_DEPLOY_TARGET`): say it is not available;
   do not write its config by hand as if Genesis had generated it.
