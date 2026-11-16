# genesis-set

> **PRE-RELEASE. The Genesis Compiler API is not reachable yet.** This package teaches the
> Genesis compiler's output and the Compiler API surface ahead of the API's opening. It is
> not published to npm yet; the first npm release follows the API.

Skills that teach a coding agent (Claude Code, Codex) to use the **Genesis compiler** on an
OpenAPPL blueprint: what the generated services do at run time, the Genesis steps next to the
blueprint procedures, and the Genesis Compiler API (validate, build, follow a build).

genesis-set sits on [mind-set](https://github.com/Mindbricks/mind-set), the OpenAPPL layer.
mind-set teaches designing and writing the blueprint; genesis-set adds what is specific to
the Genesis compiler and never repeats a mind-set document. Installing genesis-set installs
mind-set when it is missing. Node 18 or newer.

```bash
npm install -g @mindbricks/genesis-set
genesis-set install
```

The npm package is `@mindbricks/genesis-set`; the command is `genesis-set`. It depends on
`@mindbricks/mind-set`, so the global install brings mind-set's package too, and
`genesis-set install` runs `mind-set install` when mind-set is not installed yet.

## Commands

| Command | What it does |
|---|---|
| `genesis-set install [--claude] [--codex] [--force] [--dry-run]` | Makes sure a compatible mind-set is installed (it comes with this package and is installed by its own CLI), copies the corpus to `~/.genesis-set/<version>/` (linked as `~/.genesis-set/current`) and writes each `genesis-*` skill to Claude Code (`~/.claude/skills/`) and Codex (`~/.agents/skills/`). |
| `genesis-set update [...]` | Installs this version for every agent installed before (and every detected one), then deletes older corpus versions. |
| `genesis-set uninstall [--dry-run]` | Removes only what `install` recorded in `~/.genesis-set/installed.json`. mind-set stays. |
| `genesis-set doctor` | Both versions (genesis-set and mind-set) and whether they are compatible, the skills of each package per agent, and whether `GENESIS_API_KEY` is set. |

### mind-set

- The mind-set range is `dependencies["@mindbricks/mind-set"]` in `package.json`. `install` installs the
  bundled mind-set when none is installed, updates an older one, and stops with an error
  when the installed mind-set is outside the range and cannot be updated (it never
  downgrades someone's mind-set).
- genesis-set skills are all named `genesis-*`. A skill folder that carries mind-set's marker
  is never replaced, not even with `--force`; a folder of another owner is replaced only with
  `--force` (it is backed up to `~/.genesis-set/backup/` first).
- In a skill's Markdown, `{{CORPUS}}` becomes the genesis-set corpus and `{{MIND_SET}}` the
  mind-set corpus (`~/.mind-set/current`).

### Projects and credentials

- The project's identity is the blueprint's (`projectSettings.basicSettings.name`); there is
  no binding file, and genesis-set writes nothing into a project folder.
- The Compiler API key lives in the environment variable `GENESIS_API_KEY`, never in a file
  of the project, the blueprint or a commit.

### Environment

- `HOME`: where the agents' folders are looked up.
- `GENESIS_SET_HOME` moves `~/.genesis-set`; `MIND_SET_HOME` moves `~/.mind-set`.

## Development

```bash
npm test
```

runs the `node:test` suites in `test/` against a throwaway package, a fake mind-set package
and a fake `HOME`. In a built package (one with a `corpus/` folder) it also packs the package
with `npm pack`, installs the tarball next to a mind-set tarball into a throwaway project,
and runs `install`, `doctor` and `uninstall` from there.
