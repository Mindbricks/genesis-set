---
name: genesis-frontend
description: Build the frontend of a genesis project from the frontend prompt docs the Genesis compiler generates (the frontend service), one step at a time with subagents, following the frontend spec and the chosen design system. Use it when the user wants the frontend, the web app, the UI or the screens of a genesis project built or extended. Do not use it to design the backend (the mind-set openappl-blueprint-* skills), to compile (genesis-compiler-api) or to choose the design system (genesis-design-system, which this skill calls first).
---

# Building the frontend from the prompt docs

The Genesis compiler generates a **frontend service** next to the backend services: a briefing
package, not an app. It holds the prompt catalog (`docs/NN-<slug>.md` and the index
`docs/README.md`), the architect documents (`docs/architect/`), and `project.json` (every API of
every service, with request and response shapes). The frontend app is written into the same
folder: the app files are the user's, and every later delivery keeps them and replaces only the
generated set.

The delivery tool, its archive and the manifest rule are in `{{CORPUS}}/genesis/compiler-api.md`
(section 7, Where the code goes).

## Before you start

1. **The backend is compiled** and its services build (genesis-compiler-api).
2. **The frontend service is compiled and delivered:**
   - compile it: `genesis_buildService` with `serviceName: "frontend"`;
   - deliver it: `genesis_deliverService` with its jobId, into `<project>/<codename>-frontend-service/`.
   If it answers `GENESIS_DELIVERY_NOT_ENABLED` (Genesis turned delivery off for the account), the
   build stays a dry run and there are no prompt docs on this machine. Tell the user and stop here; do not
   write the frontend from memory.
3. **A design system is chosen:** `design/DESIGN_SYSTEM.md` exists, or run genesis-design-system
   now.
4. **The frontend spec:** `design/frontend-spec.md` (from the design flow). The same text may be
   in `docs/architect/frontend-spec.md` of the frontend folder.

## Read, in this order (you, not a subagent)

1. `<frontend folder>/README.md`. It sets three hard rules:
   - no mock data for a screen whose API exists;
   - every screen reads and writes a real API;
   - the reading order is not the scope.
2. `docs/README.md`: the tiers (start, core, feature, reference), the minimal read-first set per
   service, and the docs left out on purpose.
3. `docs/architect/` when present, then `design/frontend-spec.md` and `design/DESIGN_SYSTEM.md`.

Never read the whole catalog front to back: one service with its reference docs runs past 100k
tokens. A subagent gets only the docs of its step.

## Plan and record it

Write `design/frontend-progress.md`: one table with a row per step (Step, Docs, Status, Notes).
- The status is one of: waiting, in progress, done, blocked.
- Update the row when a step starts and when it ends.
- The user follows it on the board (Frontend tab), so keep it current.

The steps:

1. **Scaffold** (yours). The app stack comes from the frontend spec; if it names none, ask once
   and propose React + Vite + TypeScript. The scaffold sets up:
   - the design system's tokens in one theme (CSS variables or the UI library's theme);
   - one API client: the host is a build-time setting per environment, joined to the service
     path from `project.json` `info.baseUrl`, never a hard-coded host;
   - the auth flow from the start tier (the project overview and the Authentication doc);
   - routing and the layout shell.
2. **One step per business service**, in the order of `docs/README.md`'s minimal read-first
   table:
   - the service's core docs (Service, Business APIs with its Candidate screens, Data objects);
   - then its feature docs.
3. **One step per cross-cutting feature doc** that applies (cart, uploads, payments, realtime...),
   unless the doc says the feature is unavailable.
4. **Verify** against the running backend (genesis-run-and-test): every screen loads real data,
   and every action calls its API.

## Each step's subagent brief

Give each subagent a complete brief; it knows nothing else:
- **Its input files** (paths): this step's docs, `project.json` (the shapes), `design/DESIGN_SYSTEM.md`
  (its Agent Prompt Guide and Quick Start first) and `design/frontend-spec.md`.
- **The app's conventions:** the folder layout, the API client, routing and the theme, with the
  files to imitate.
- **The rules:**
  - no mocks; a screen with no API is a contract gap: report it, do not invent it;
  - use the design tokens, never ad-hoc colors or sizes;
  - the look of the design system, never its brand.
- **Done** means: the app builds and type-checks, each screen of the step is listed with the API
  it uses, and the gaps are listed.

Run the steps one at a time: each builds on the app the previous one left. After each step,
build the app, update the progress file and show the user what changed before the next step.

## When the backend changes

Rebuild and re-deliver the frontend service after a blueprint change. The generated set is
replaced and the app is kept. Then compare the docs that changed (`git diff` in the frontend
folder) and run a step for the screens they touch.

A gap the docs reveal (a screen that needs an API the blueprint lacks) is a blueprint change
(openappl-blueprint-authoring). Never patch around it in the frontend.
