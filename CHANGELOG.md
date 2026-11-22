# Changelog

The package follows semantic versioning. Each release names the mind-set range it needs
(`dependencies["@mindbricks/mind-set"]` in `package.json`).

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
