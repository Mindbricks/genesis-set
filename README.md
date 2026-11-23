# genesis-set

> **PRE-RELEASE.** The Genesis Compiler API is open at `https://api.genesiscompiler.com`.
> Builds are dry runs for now: the code is generated and measured, nothing is pushed yet.
> `genesis_deliverService` brings a succeeded service build into your project folder; delivery is
> open to every Genesis account.

Skills that teach a coding agent (Claude Code, Codex) to use the **Genesis compiler** on an
OpenAPPL blueprint: what the generated services do at run time, the Genesis steps next to the
blueprint procedures, and the Genesis Compiler API (validate, build, follow a build). A local
MCP server gives the agent the Compiler API as five `genesis_*` tools, two tools for the design
system catalog the frontend follows, one that delivers a build to your machine, plus four tools and a local page for the keys the agent needs.

genesis-set sits on [mind-set](https://github.com/Mindbricks/mind-set), the OpenAPPL layer.
mind-set teaches designing and writing the blueprint; genesis-set adds what is specific to
the Genesis compiler and never repeats a mind-set document. Installing genesis-set installs
mind-set when it is missing. Node 18 or newer.

```bash
npm install -g @mindbricks/genesis-set
genesis install
```

The npm package is `@mindbricks/genesis-set`; the command is `genesis` (`genesis-set` still works
as an alias). It depends on
`@mindbricks/mind-set`, so the global install brings mind-set's package too, and
`genesis install` runs `mindset install` when mind-set is not installed yet.

## Starting a project

The skills start when a request talks about OpenAPPL or Genesis. A plain "build me a booking
app" can make an agent hand-write a backend instead, so prepare the project folder once:

```bash
mkdir my-app && cd my-app
genesis init
```

`genesis init` writes a marked block into `CLAUDE.md` (Claude Code) and `AGENTS.md` (Codex),
which the agents read at the start of every session:
- the backend is an OpenAPPL blueprint compiled by Genesis, never hand-written;
- the order of work with the skill for each step;
- the key rules.

It also writes the project identity `.genesis/project.json` (a random id and a name, no secret,
fine to commit), creates `design/` and the env and secrets lines of `.gitignore`, and prints the
API key status and a starter prompt.
- Your own content in `CLAUDE.md` and `AGENTS.md` is kept.
- A second run only refreshes the block.
- `--dry-run` shows what it would write.

Then open the agent in the folder and start, for example:

```text
Let us design a new application with OpenAPPL and compile it with Genesis: a table booking
system for cafes, with owner, waiter and guest roles. Start with the requirements interview.
```

## The project board

`genesis board` in a project folder opens the project's board in your browser. The board is read
live from the folder as the agent writes, and shows:
- **Overview:** the next step, and the design flow from the interview to the test report, with
  every document written, waiting or "if needed" and its `design-check` result;
- **Documents:** every design document, rendered;
- **Interview:** its status, the coverage ledger and the open questions;
- **Blueprint:** every module of `blueprint.json` in a list (project settings, authentication,
  the BFF and notification services, each service with its data objects and business APIs, and
  any other section), each with its `mindset validate` problem count; picking one shows its JSON
  and its problems in the panel next to it (a literal secret is hidden there);
- **Mail:** what the generated services could not deliver: every mail and SMS in the mail sink,
  with its text and the codes in it (see below);
- **Keys:** this project's keys and your global ones; set, replace, clear, delete and add.

The design documents are strongly recommended for the quality of the blueprint (mind-set's
spec-driven method). They are not part of the OpenAPPL standard, which requires only the
blueprint. A project whose blueprint was written directly, because the user asked to skip the
design, shows the design as skipped and follows the blueprint.

**The mail sink.** A generated service with no complete email provider sends its mail
(verification codes, password resets, notifications), and an SMS with no SMS provider, to its
mail sink. The sink is infrastructure like the database, and its address is a system value of
the generated env:
- the docker-compose stack runs its own `mail-sink` (Mailpit);
- a service run natively names `localhost:10465` in its `.dev.env`, where you start the same
  Mailpit (the corpus page `run-locally.md` has the command).

The board's Mail tab reads that sink through Mailpit's API (`http://127.0.0.1:8025`,
`GENESIS_MAILPIT_URL` moves it). When none answers, it says how to start one.

The board runs on `http://127.0.0.1:4747/` (the next free port if that one is taken;
`GENESIS_BOARD_PORT` moves it) until it goes 30 minutes without use or you press Ctrl+C. The open
page's own refresh does not count as use, so a board left open in a forgotten tab still closes; the
page then says so, and `genesis board` opens it again.
- **Bookmark it:** the plain address is read-only.
- **Changing keys** takes the link `genesis board` opens, which sets a write cookie for that run.
- **One board per project:** a second `genesis board` for the same project reuses the running
  one.
- **The agent knows the board** (the `genesis init` instructions and the `genesis_openBoard`
  tool). It offers the link when it finishes a design document, and answers "where can I see
  this?" with it.

`genesis keys` stays the page of your global keys only, from any folder.

## Commands

| Command | What it does |
|---|---|
| `genesis init [<folder>] [--dry-run]` | Prepares a project folder (default: the current one) for the agent: the OpenAPPL + Genesis block in `CLAUDE.md` and `AGENTS.md`, `design/`, the env lines of `.gitignore`, then the key status and a starter prompt (see "Starting a project"). |
| `genesis install [--claude] [--codex] [--force] [--no-mcp] [--no-key] [--dry-run]` | Makes sure a compatible mind-set is installed (it comes with this package and is installed by its own CLI), copies the corpus to `~/.genesis-set/<version>/` (linked as `~/.genesis-set/current`), writes each `genesis-*` skill to Claude Code (`~/.claude/skills/`) and Codex (`~/.agents/skills/`), registers the MCP server (below), and ends with the API key step (below). |
| `genesis update [...]` | Installs this version for every agent installed before (and every detected one), then deletes older corpus versions. |
| `genesis uninstall [--dry-run]` | Removes only what `install` recorded in `~/.genesis-set/installed.json`, including the MCP registrations. mind-set and your API key file stay. |
| `genesis doctor` | Both versions (genesis-set and mind-set) and whether they are compatible, the skills of each package and the MCP server per agent, where the API key comes from and which key it is (its type prefix and last four characters, such as `sk_mbx_...9f3a`, never the whole key) and the API base. |
| `genesis config [show \| set-key \| unset-key \| set-base <url> \| unset-base]` | The API key and API base in `~/.genesis-set/config.json` (mode 0600). `set-key` reads the key from stdin (hidden on a terminal), never from the command line. |
| `genesis board [<folder>] [--no-open]` | Opens the board of the genesis project in `<folder>` (default: the current one): design flow, documents, interview, blueprint, project and global keys (see "The project board"). |
| `genesis keys [--no-open]` | Opens the local key page in your browser: add, change, clear or delete the keys your agent uses. The link is new each time; the page closes after 15 idle minutes or on Ctrl+C. `--no-open` only prints the link. |
| `genesis mcp` | Runs the MCP server on stdio from the package (for a registration by hand). |

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
| `genesis_listDesignSystems` | `GET /design-systems` |
| `genesis_applyDesignSystem` | `GET /design-systems/:slug`, written to `design/DESIGN_SYSTEM.md` of the project |
| `genesis_deliverService` | `GET /jobs/:jobId/archive`, downloaded (sha256 checked) and applied to `<project>/<codename>-<service>-service/` |

**Delivery.** Until builds push to your repositories, a succeeded service build comes to your
machine as an archive. Delivery is open to every Genesis account; `GENESIS_DELIVERY_NOT_ENABLED`
answers only where Genesis turned it off for the account. `genesis_deliverService` applies it with
the manifest rule:
- the generated files are written;
- generated files the build no longer makes are deleted (one you edited is kept and reported);
- everything else is kept: your files, `service-files/` and `.git`.

It runs no git command; you review and commit. `dryRun: true` shows the plan first. Archives are
kept for 7 days.

**Frontend.** The frontend service's prompt docs, once delivered, drive the frontend work: the
`genesis-frontend` skill builds the app in that folder one step at a time with subagents, after
the design system is picked. It records its progress in `design/frontend-progress.md`. The
board's Frontend tab shows the prompt docs and that progress.

**Design systems.** Genesis serves a catalog of style references for the frontend (tokens,
components, imagery, do's and don'ts, an agent prompt guide). Before the first frontend work the
agent proposes the five that fit `design/frontend-spec.md`, you pick one, and
`genesis_applyDesignSystem` writes it to `design/DESIGN_SYSTEM.md`; every frontend brief follows
that file (the `genesis-design-system` skill). The board shows the choice on its Overview. The
systems describe the look of known products: the product takes the look, never the brand.

A blueprint path is read on your machine, checked against the size limit (10 MiB of compact
JSON; `GENESIS_MAX_BLUEPRINT_BYTES` when your API says otherwise) and sent inline; the path
itself is never sent. A repository source (`repo`) is passed through as it is. Every failure
comes back in the Genesis error shape `{ "error": { "code", "message", "details" } }`.

### Keys: the local key page

Keys have a **scope**:
- **project:** this genesis project only; the default for a key the agent requests inside a
  project.
- **global:** yours in every project, like the Genesis API key.

Both scopes are stored in your home folder: the global ones in `~/.genesis-set/config.json`, a
project's in `~/.genesis-set/projects/<project id>/keys.json`. Neither is ever stored in the
project folder. A key is looked up in the project first, then globally.

- **The board:** inside a project, the board's Keys tab shows both scopes.
- **`genesis keys`:** shows the global ones.

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
- **Opening the page yourself:** `genesis keys` in any terminal opens it in the browser. The
  port and the link change every time, so there is nothing to remember or bookmark. Asking the
  agent ("open my keys") works too: it calls `genesis_openKeyManager`.
- **Where the keys live:** in `~/.genesis-set/config.json` (mode 0600).
  - The Genesis API key is the built-in key `genesis-api-key`, the same value `config set-key` stores.
  - Every other key is `keys.<name>`.
- **What the page shows:** whether a key is set and, for a long value, its type prefix and last
  four characters (`sk_test_...a1b2`), so test and live keys can be told apart. A
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
  no binding file. Only `genesis init`, run on a project folder, writes there (the agent
  instructions, `design/`, `.gitignore`); nothing else genesis-set does touches a project.
- **Getting the key:** the user signs in to the Genesis portal and creates one on its API keys
  page, `https://portal.genesiscompiler.com/keys` (the stage API `sapi.genesiscompiler.com`
  has `https://stage.genesiscompiler.com/keys`). The key is shown once.
- **The install key step:** with no key set, `genesis install` names that page.
  - On a terminal it reads the key with hidden input and stores it as `set-key` does; Enter
    skips.
  - Without a terminal (an agent runs the install) it only prints the page and the command, and
    never waits.
  - `--no-key` skips the step.
- The Compiler API key lives in the environment variable `GENESIS_API_KEY` or in
  `~/.genesis-set/config.json` (`genesis config set-key`), never in a file of the project,
  the blueprint or a commit. The environment variable wins. The MCP server never reads the
  folder it runs in for a key or a setting.
- The API base is `https://api.genesiscompiler.com` unless `GENESIS_API_BASE` or
  `genesis config set-base` says otherwise; a plain-http base is accepted only on a
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
