# Changelog

The package follows semantic versioning. Each release names the mind-set range it needs
(`dependencies["@mindbricks/mind-set"]` in `package.json`).

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
