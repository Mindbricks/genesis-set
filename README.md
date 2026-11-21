# genesis-set

> **PRE-RELEASE.** The Genesis Compiler API is open at `https://api.genesiscompiler.com`.
> Builds are dry runs for now: the code is generated and measured, nothing is pushed yet.
> This package is not published to npm yet.

Skills that teach a coding agent (Claude Code, Codex) to use the **Genesis compiler** on an
OpenAPPL blueprint: what the generated services do at run time, the Genesis steps next to the
blueprint procedures, and the Genesis Compiler API (validate, build, follow a build). A local
MCP server gives the agent the Compiler API as five `genesis_*` tools.

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
| `genesis-set install [--claude] [--codex] [--force] [--no-mcp] [--no-key] [--dry-run]` | Makes sure a compatible mind-set is installed (it comes with this package and is installed by its own CLI), copies the corpus to `~/.genesis-set/<version>/` (linked as `~/.genesis-set/current`), writes each `genesis-*` skill to Claude Code (`~/.claude/skills/`) and Codex (`~/.agents/skills/`), registers the MCP server (below), and ends with the API key step (below). |
| `genesis-set update [...]` | Installs this version for every agent installed before (and every detected one), then deletes older corpus versions. |
| `genesis-set uninstall [--dry-run]` | Removes only what `install` recorded in `~/.genesis-set/installed.json`, including the MCP registrations. mind-set and your API key file stay. |
| `genesis-set doctor` | Both versions (genesis-set and mind-set) and whether they are compatible, the skills of each package and the MCP server per agent, where the API key comes from (never its value) and the API base. |
| `genesis-set config [show \| set-key \| unset-key \| set-base <url> \| unset-base]` | The API key and API base in `~/.genesis-set/config.json` (mode 0600). `set-key` reads the key from stdin (hidden on a terminal), never from the command line. |
| `genesis-set keys [--no-open]` | Opens the local key page in your browser: add, change, clear or delete the keys your agent uses. The link is new each time; the page closes after 15 idle minutes or on Ctrl+C. `--no-open` only prints the link. |
| `genesis-set mcp` | Runs the MCP server on stdio from the package (for a registration by hand). |

### The MCP server

`install` copies the server to `~/.genesis-set/mcp/` and registers it at user scope as the MCP
server `genesis`: in `~/.claude.json` (`mcpServers.genesis`) for Claude Code and as a marked
block in `~/.codex/config.toml` (`[mcp_servers.genesis]`, `CODEX_HOME` moves it) for Codex. An
existing `genesis` entry that genesis-set did not write is left alone (Claude Code: `--force`
replaces it after a backup). Restart the agent after the install. The server has no
dependencies besides Node 18.

| Tool | Endpoint (below `{apiBase}/genesis/compiler/v1`) |
|---|---|
| `genesis_validateApplication` | `POST /validate` |
| `genesis_validateService` | `POST /validate/service` |
| `genesis_buildService` | `POST /builds` with one service |
| `genesis_getBuilds` | `GET /builds` |
| `genesis_getServiceBuild` | `GET /jobs/:jobId` |

A blueprint path is read on your machine, checked against the size limit (10 MiB of compact
JSON; `GENESIS_MAX_BLUEPRINT_BYTES` when your API says otherwise) and sent inline; the path
itself is never sent. A repository source (`repo`) is passed through as it is. Every failure
comes back in the Genesis error shape `{ "error": { "code", "message", "details" } }`.

### Keys: the local key page

A coding agent keeps needing secrets: the Genesis API key, and provider keys (payment, mail,
storage, AI) to run the generated services. The rule is that no value is ever typed into the chat.
Instead the MCP server serves a local key page, and four tools that never call the API and work
without a Genesis API key:

| Tool | What it does |
|---|---|
| `genesis_requestKey` | Registers a key by name (`stripe-secret-key`) with a readable label and a description, empty, and answers the page link. An existing key keeps its value. |
| `genesis_listKeys` | Every key with its label, description and status (`set` / `empty`); never a value. |
| `genesis_openKeyManager` | The page link, to add, change, clear or delete keys. |
| `genesis_writeKeyToEnvFile` | Copies a stored key into a service's env file as `VARIABLE=value`, without the value passing through the agent. |

- **The agent's flow:**
  1. `genesis_requestKey`.
  2. "Open this link and save the key there".
  3. `genesis_listKeys` until the key is `set`.
  4. `genesis_writeKeyToEnvFile` when a service needs it.
- **Opening the page yourself:** `genesis-set keys` in any terminal opens it in the browser. The
  port and the link change every time, so there is nothing to remember or bookmark. Asking the
  agent ("open my keys") works too: it calls `genesis_openKeyManager`.
- **Where the keys live:** in `~/.genesis-set/config.json` (mode 0600).
  - The Genesis API key is the built-in key `genesis-api-key`, the same value `config set-key` stores.
  - Every other key is `keys.<name>`.
- **What the page shows:** whether a key is set, and the last four characters of a long value. A
  value is sent once, when the user saves it. The field the user types into is hidden, with a
  Show / Hide toggle; the stored value is never shown again.
- **Env files:** `genesis_writeKeyToEnvFile` accepts only a file named `.env`, `.env.local` or
  `*.secrets.env`. Inside a git repository the file must be one git ignores and does not track.
- **Security:**
  - The page listens on `127.0.0.1` on a random port, behind a random token in its link.
  - It answers only to its own `Host`, takes writes only from its own `Origin` and only as JSON.
  - It sends `no-store`, `no-referrer` and a nonce Content-Security-Policy.
  - It closes after 15 idle minutes and when the agent session ends. The next key tool call
    gives a new link.
- **Where it does not work:** on a platform without a local disk and browser (a hosted builder).

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
- **Getting the key:** the user signs in to the Genesis portal and creates one on its API keys
  page, `https://portal.genesiscompiler.com/keys` (the stage API `sapi.genesiscompiler.com`
  has `https://stage.genesiscompiler.com/keys`). The key is shown once.
- **The install key step:** with no key set, `genesis-set install` names that page.
  - On a terminal it reads the key with hidden input and stores it as `set-key` does; Enter
    skips.
  - Without a terminal (an agent runs the install) it only prints the page and the command, and
    never waits.
  - `--no-key` skips the step.
- The Compiler API key lives in the environment variable `GENESIS_API_KEY` or in
  `~/.genesis-set/config.json` (`genesis-set config set-key`), never in a file of the project,
  the blueprint or a commit. The environment variable wins. The MCP server never reads the
  folder it runs in for a key or a setting.
- The API base is `https://api.genesiscompiler.com` unless `GENESIS_API_BASE` or
  `genesis-set config set-base` says otherwise; a plain-http base is accepted only on a
  loopback address.

### Environment

- `HOME`: where the agents' folders are looked up.
- `GENESIS_SET_HOME` moves `~/.genesis-set`; `MIND_SET_HOME` moves `~/.mind-set`;
  `CODEX_HOME` moves `~/.codex`.
- `GENESIS_API_KEY`, `GENESIS_API_BASE`, `GENESIS_MAX_BLUEPRINT_BYTES`, `GENESIS_TIMEOUT_MS`
  (default 120000): read by the MCP server on every call.

## Development

```bash
npm test
```

runs the `node:test` suites in `test/` against a throwaway package, a fake mind-set package
and a fake `HOME`; the MCP suites run the server against a local stub of the Compiler API. In a built package (one with a `corpus/` folder) it also packs the package
with `npm pack`, installs the tarball next to a mind-set tarball into a throwaway project,
and runs `install`, `doctor` and `uninstall` from there.
