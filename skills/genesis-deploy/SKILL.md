---
name: genesis-deploy
description: Deploy the services the Genesis compiler generated, with the user's own login on the target - the docker-compose stack, Railway, Fly.io and Render - from the deploy files a Genesis build writes into each service (deploy/<target>/), and deploy the frontend app, whose deploy config you write yourself for the target the user picks. Use it when the user wants the generated backend or the frontend running somewhere: a server, Railway, Fly.io, Render, a static host. Genesis never deploys; this skill tells you how the user's own tools do it. Do not use it to compile (genesis-compiler-api) or for a local test run (genesis-run-and-test).
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

## The frontend

Genesis writes no frontend deploy files: the frontend app is the user's (genesis-frontend), and
so is its deploy config. Follow deploy.md section 7:
1. Agree the target with the user (a static host, or a web-server container next to the stack).
2. Write the config in the app, never in the generated docs set; the API host is a build-time
   setting per environment; no secret goes into the frontend build.
3. Set `FRONTEND_URL` on every backend service to the frontend's public address, and add the
   frontend's origin where the backend limits CORS.
4. Deploy with the user's own login, then verify in a browser: the page loads, a sign-in works and
   an API call succeeds with no CORS error.
