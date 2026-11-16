# Changelog

The package follows semantic versioning. Each release names the mind-set range it needs
(`dependencies["@mindbricks/mind-set"]` in `package.json`).

## 0.1.0 (pre-release, not published)

First version, built ahead of the Genesis Compiler API opening.

- Published as `@mindbricks/genesis-set` (the command is `genesis-set`), like
  `@mindbricks/mind-set`.
- `genesis-set install | update | uninstall | doctor` for Claude Code (`~/.claude/skills`)
  and Codex (`~/.agents/skills`); installs or updates mind-set `^0.1.0` when needed and never
  replaces a mind-set skill.
- Two skills: `genesis-compiler-api` (the Compiler API surface at opening, marked
  pre-release) and `genesis-generated-code` (the Genesis additions to the mind-set
  procedures).
- The corpus: the Compiler API guide and the Genesis additions to the mind-set procedures
  (payment and subscription runtime ladders, webhook and plan provisioning, the mailbox
  runtime check, per-language support, compile steps).
