# Changelog

The package follows semantic versioning. Each release names the mind-set range it needs
(`dependencies["@mindbricks/mind-set"]` in `package.json`).

## 0.9.0 (pre-release)

- **Delivery: a succeeded build comes to this machine.** `genesis_deliverService` downloads a
  service job's generated tree (`GET /jobs/:jobId/archive`, a short-lived link, sha256
  checked) and applies it to `<project>/<codename>-<service>-service/` with the manifest rule:
  - generated files are written; generated files no longer made are deleted (an edited one is
    kept and reported);
  - your files, `service-files/` and `.git` are kept;
  - no git command runs; `dryRun: true` shows the plan.
  Delivery is open to every Genesis account. Where Genesis turns it off for an account, the
  tool answers `GENESIS_DELIVERY_NOT_ENABLED`.
- **The `genesis-frontend` skill:** after the design system is picked, the frontend is built
  from the delivered frontend service's prompt docs, one step at a time with subagents, and the
  progress is kept in `design/frontend-progress.md`.
- **The board's Frontend tab:** the prompt docs in catalog order, the architect docs and the
  progress.
- The Compiler API corpus page, the compiler-api and deploy skills, and the `genesis init`
  instructions describe delivery.

## 0.8.0 (pre-release)

- **Design systems for the frontend.** Genesis serves a catalog of style references (tokens,
  components, imagery, do's and don'ts, an agent prompt guide), and two new tools reach it:
  `genesis_listDesignSystems` (`GET /design-systems`) and `genesis_applyDesignSystem`
  (`GET /design-systems/:slug`, written to `design/DESIGN_SYSTEM.md` of the project).
  - The new skill `genesis-design-system`: before the first frontend work the agent proposes the
    five systems that fit the frontend spec, the user picks one, and every frontend brief
    follows `design/DESIGN_SYSTEM.md`. The product takes the look, never the brand.
  - The board shows the chosen system on its Overview and the file under Documents.
  - The `genesis init` instructions name the step.

## 0.7.1 (pre-release)

- **The board closes after 30 minutes without use** (was an hour without a request). The open page
  refreshes every 3 seconds; that refresh no longer keeps the board alive, only use does (a page
  load, a click, a key, a scroll, a tab change). A closed board's page says so and how to open it
  again (`genesis board`).

## 0.7.0 (pre-release)

- **The board's Blueprint tab shows every module of the blueprint.** A list on the left holds the
  project settings, authentication, the BFF and notification services, each service with its
  data objects and business APIs, and any other top-level section, each with its validation
  problem count. Picking one shows its JSON and the `mindset validate` problems inside it in a
  panel on the right, with its path to copy.
  - A secret written into the blueprint as a literal is hidden in the panel; `$ENV:NAME`
    references and `ENTER_CREDENTIAL` are shown as they are.
  - On a narrow screen the panel comes first and the list below it.

## 0.6.0 (pre-release)

- **The board reads the mail sink instead of running one.** The mail sink is infrastructure like
  the database: the generated docker-compose stack runs one (Mailpit), and for a service run
  natively the agent starts the same Mailpit on the `localhost:10465` its `.dev.env` names
  (written by the Genesis build, never by hand).
  - The board's Mail tab reads it through Mailpit's API (`GENESIS_MAILPIT_URL`), lists the mail
    and SMS with their codes, and clears it with the write cookie.
  - When no sink answers, the tab says how to start one.
  - genesis-set no longer opens an SMTP port, and `GENESIS_MAILSINK_PORT` is gone.
- **The board's document view wraps long lines:** code blocks, tables, long words and the panel
  column no longer stretch the page sideways.

## 0.5.0 (pre-release)

- **The mail sink:** the board runs a mail sink on `127.0.0.1:10465` and has a **Mail** tab.
  Mail and SMS that the generated services cannot deliver (no email or SMS provider) land
  there with their text, recipients and the codes in them. Run the services with
  `MAILSINK_HOST` / `MAILSINK_PORT`; `genesis board` prints them, and the agent's board tool
  answers them.
- **The design flow is a strong recommendation, not part of the standard:** it is mind-set's
  spec-driven method for the quality of the blueprint; the OpenAPPL standard requires only the
  blueprint.
  - The `genesis init` instructions start with the design. When the user explicitly asks to
    skip it, the agent names the quality risk once and writes the blueprint directly.
  - The board shows a blueprint without design documents as "design skipped" and follows the
    blueprint.

## 0.4.0 (pre-release)

- **`genesis board`:** a local board for a genesis project. It is read live from the folder and
  shows:
  - the design flow with each document's state and `design-check` result;
  - the rendered documents;
  - the interview (status, coverage ledger, open questions);
  - the blueprint with its validation;
  - the project and global keys;
  - the next step.

  It runs on 127.0.0.1:4747 (bookmarkable, read-only); the link `genesis board` opens can
  change keys. One board per project, reused. The agent gets it with `genesis_openBoard`, and
  the `genesis init` instructions tell it to offer the board.
- **Projects:** `genesis init` writes `.genesis/project.json` (a random id and a name).
- **Project keys:** they live in the home folder under that id. Inside a project,
  `genesis_requestKey` stores a project key by default, `genesis_listKeys` labels each key's
  scope, and `genesis_writeKeyToEnvFile` prefers the project key. `genesis keys` stays global.

## 0.3.0 (pre-release)

- `genesis init [<folder>] [--dry-run]` prepares a project folder so the agent works the
  OpenAPPL + Genesis way from its first session. It writes a marked block into `CLAUDE.md` and
  `AGENTS.md` (the order of work with the skill for each step, and the key rules) and creates
  `design/` and the env and secrets lines of `.gitignore`; it prints the API key status and a
  starter prompt. Content outside the block is kept, and a second run changes nothing.

## 0.2.1 (pre-release)

- A stored key is shown as its type prefix and last four characters (`sk_mbx_...9f3a`,
  `sk_test_...a1b2`) in `genesis config show`, `genesis doctor`, the install key step and the
  key page, so the user can tell which key is set and whether it is a test or a live key. At
  least eight characters always stay hidden; a shorter value is only shown as "set". The agent
  tools still answer set or empty only.

## 0.2.0 (pre-release)

Needs mind-set `^0.2.0`.

- The command is `genesis`, the same name as its MCP server; `genesis-set` still works as an
  alias (and keeps `npx @mindbricks/genesis-set ...` working). Every message, skill and
  guide names `genesis`. The data folder stays `~/.genesis-set`.
- The MCP server exits only after its answers are written out; before, an answer over 8 KiB
  could be cut when the client closed stdin.

## 0.1.0 (pre-release)

First version, published with the Genesis Compiler API open for dry-run builds.

- Published as `@mindbricks/genesis-set` (the command is `genesis-set`), like
  `@mindbricks/mind-set`.
- `genesis-set install | update | uninstall | doctor` for Claude Code (`~/.claude/skills`)
  and Codex (`~/.agents/skills`); installs or updates mind-set `^0.1.0` when needed and never
  replaces a mind-set skill.
- A local MCP server (no dependencies) with the tools `genesis_validateApplication`,
  `genesis_validateService`, `genesis_buildService`, `genesis_getBuilds` and
  `genesis_getServiceBuild`; `install` registers it for Claude Code (`~/.claude.json`) and
  Codex (`~/.codex/config.toml`). It reads the blueprint from the local file and sends it
  inline, checks the size first, and authenticates with `GENESIS_API_KEY` or the home config
  file (`genesis-set config set-key`).
- Keys without the chat: the MCP server serves a local key page (127.0.0.1, token link, closes
  when idle). Four more tools (`genesis_requestKey`, `genesis_listKeys`, `genesis_openKeyManager`,
  `genesis_writeKeyToEnvFile`) register a key, hand the user the page link, report set / empty,
  and copy a stored key into a gitignored env file. The agent never sees a value.
- `genesis-set install` ends with a key step that names the portal's API keys page and, on a
  terminal, reads the Genesis API key hidden; the missing-key message and `doctor` name the page.
- Four skills: `genesis-compiler-api` (the five tools), `genesis-generated-code` (procedure
  additions, custom code, runtime pitfalls), `genesis-run-and-test` and `genesis-deploy`.
- The corpus pages `compile-results`, `custom-code`, `run-locally`, `testing`, `deploy` and
  `pitfalls` (#9168): the shared compiler knowledge genesis-set needs, written in genesis-set's own
  sources (the platform side stays as it is).
- The corpus: the Compiler API guide and the Genesis additions to the mind-set procedures
  (payment and subscription runtime ladders, webhook and plan provisioning, the mailbox
  runtime check, per-language support, compile steps).
