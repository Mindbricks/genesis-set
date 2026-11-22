// `genesis init [<folder>] [--dry-run]` (#9383): prepare a project folder so a
// coding agent works the OpenAPPL + Genesis way from its first session.
//
// The mind-set and genesis skills trigger on OpenAPPL / Genesis wording; a plain
// "build me a booking app" can make an agent hand-write a backend. The agents
// read CLAUDE.md (Claude Code) and AGENTS.md (Codex) at the start of every
// session, so init writes the project's way of working there:
//
//   CLAUDE.md, AGENTS.md   a marked block (begin / end markers); content outside
//                          it is the user's and is kept; a second run replaces
//                          only the block
//   design/README.md       where the design documents go (written only when absent)
//   .gitignore             the env and secrets lines that are missing
//   .genesis/project.json  the project identity (random id, name; no secret,
//                          may be committed); an existing one is never changed.
//                          The project's keys live in the user's home under it.
//
// This is the one genesis command that writes into a project folder, and only
// into the folder it is run on. It never runs git and never touches the key store.

import fs from 'node:fs';
import path from 'node:path';

import { maskSecret, portalKeysUrl, resolveSettings } from '../mcp/config.mjs';
import { PROJECT_DIR, PROJECT_FILE, ensureProject } from '../mcp/project.mjs';

export const BLOCK_BEGIN = '<!-- genesis init: begin. "genesis init" rewrites this block; edit outside it -->';
export const BLOCK_END = '<!-- genesis init: end -->';

export const GITIGNORE_LINES = ['.env', '.env.local', '*.secrets.env', 'node_modules/'];

/** The instructions both agents read. Plain text: the agent follows it, the user can edit around it. */
export const INSTRUCTIONS = `## How this project is built: OpenAPPL + Genesis

The backend of this project is an OpenAPPL blueprint, \`blueprint.json\`, compiled into service
code by the Genesis compiler. Never hand-write backend code: describe the system in the
blueprint, and the compiler writes the services. When a request is about the backend (data,
APIs, roles, payments, notifications), it is a change to the design or to the blueprint.

Work in this order; each step has its skill:

1. **Design** (openappl-blueprint-design): the requirements interview, then the requirement,
   spec and blueprint-plan documents under \`design/\`. The user approves each document.
2. **Blueprint** (openappl-blueprint-authoring): write \`blueprint.json\` in small steps and run
   \`mindset validate blueprint.json\` after every step. Custom logic the blueprint declares
   (library functions, edge controllers) is written into the blueprint too
   (genesis-generated-code).
3. **Review** (openappl-blueprint-review): the checklist audit; \`mindset spec-coverage\` shows
   that every design document produced its part of the blueprint.
4. **Compile** (genesis-compiler-api): validate the whole blueprint, then build one service at a
   time and follow each build to its final status. Builds are dry runs for now.
5. **Run and test** (genesis-run-and-test), **deploy** (genesis-deploy): on the generated code.

Code that talks to the system (a frontend, a client, tests) is written against the blueprint
as its contract (openappl-blueprint-contract).

**Keys and secrets:** never ask for a key or a password in the chat, and never write one into
a file of this project yourself. Register the key with the genesis key tools, give the user
the local key page link to save it there, and check that it is set; a key reaches a service's
gitignored env file only through the key tool that writes it. A key this project needs is a
project key (the default here); the user's own keys, such as the Genesis API key, are global.

**The project board:** the user follows this project on a local board: the design flow with the
state of every document, the documents, the interview, the blueprint and its validation, and
the keys. They open it with \`genesis board\` in this folder; you give its link with the genesis
board tool (and open it in the browser when they ask). Offer it when you finish a design
document or the blueprint, and answer "where can I see this?" with it. The user's global keys
alone are behind \`genesis keys\`.`;

/** The block with its markers. */
export function instructionsBlock() {
  return `${BLOCK_BEGIN}\n${INSTRUCTIONS}\n${BLOCK_END}`;
}

/** The new text of an instructions file: the block replaced, appended, or a new file. */
export function withBlock(existing) {
  const block = instructionsBlock();
  if (existing === null) return `# Project instructions\n\n${block}\n`;
  const start = existing.indexOf(BLOCK_BEGIN);
  const end = existing.indexOf(BLOCK_END, start < 0 ? 0 : start);
  if (start >= 0 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + BLOCK_END.length);
  }
  return `${existing.replace(/\s*$/, '')}\n\n${block}\n`;
}

/** The .gitignore with the missing lines appended under a comment; unchanged when none is missing. */
export function withGitignore(existing) {
  const have = new Set((existing ?? '').split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !have.has(l));
  if (missing.length === 0) return existing;
  const head = existing ? `${existing.replace(/\s*$/, '')}\n\n` : '';
  return `${head}# genesis init: local env files hold secrets; never commit them\n${missing.join('\n')}\n`;
}

const DESIGN_README = `# Design documents

The design of this project: the requirements interview record, the requirement and spec
documents, and the blueprint plan. The openappl-blueprint-design skill writes them here, one
file per document, and \`mindset design-check <docName>\` checks each one's structure.
`;

/** The prompt the user pastes into the agent to start. */
export const STARTER_PROMPT =
  'Let us design a new application with OpenAPPL and compile it with Genesis: <one or two sentences on what it does and for whom>. ' +
  'Start with the requirements interview.';

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function isGitRepo(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    const up = path.dirname(d);
    if (up === d) return false;
    d = up;
  }
}

/**
 * Prepare `dir`. Answers 0, or 1 when a file could not be written. `out` gets the
 * actions (or, with dryRun, what would be done), the key status and the starter prompt.
 */
export function initProject({ dir = process.cwd(), env = process.env, out, err = out, dryRun = false }) {
  const target = path.resolve(dir);
  const act = (msg) => out(`${dryRun ? 'would ' : ''}${msg}`);
  const writes = [];

  if (!fs.existsSync(target)) {
    act(`create ${target}`);
    if (!dryRun) fs.mkdirSync(target, { recursive: true });
  } else if (!fs.statSync(target).isDirectory()) {
    err(`error: ${target} is not a folder`);
    return 1;
  }

  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const file = path.join(target, name);
    const before = read(file);
    const after = withBlock(before);
    if (after === before) {
      out(`${name}: up to date`);
      continue;
    }
    act(before === null ? `write ${name}` : before.includes(BLOCK_BEGIN) ? `update the genesis block in ${name}` : `add the genesis block to ${name} (your content is kept)`);
    writes.push([file, after]);
  }

  let project;
  try {
    const res = ensureProject(target, { dryRun });
    project = res.project;
    if (res.created) act(`write ${PROJECT_DIR}/${PROJECT_FILE} (project "${project.name}")`);
  } catch (e) {
    err(`error: ${e.message}`);
    return 1;
  }

  const designReadme = path.join(target, 'design', 'README.md');
  if (read(designReadme) === null) {
    act('write design/README.md');
    writes.push([designReadme, DESIGN_README]);
  }

  const gitignore = path.join(target, '.gitignore');
  const gBefore = read(gitignore);
  const gAfter = withGitignore(gBefore);
  if (gAfter !== gBefore) {
    act(gBefore === null ? 'write .gitignore' : 'add the env and secrets lines to .gitignore');
    writes.push([gitignore, gAfter]);
  }

  if (!dryRun) {
    try {
      for (const [file, text] of writes) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
      }
    } catch (e) {
      err(`error: ${e.message}`);
      return 1;
    }
  }

  const s = resolveSettings(env);
  out('');
  out(`Project "${project.name}" (id ${project.id}). Its keys are kept in your home folder, never in this folder.`);
  out(
    s.apiKey
      ? `Genesis API key: ${maskSecret(s.apiKey) ?? 'set'} (from ${s.keySource}).`
      : `Genesis API key: not set. Create one at ${portalKeysUrl(s.apiBase)}, then run "genesis config set-key" (or save it on the key page, "genesis keys").`,
  );
  if (!isGitRepo(target)) out('This folder is not a git repository yet; "git init" makes it one.');
  out('');
  out('Follow the project on its board: "genesis board" in this folder.');
  out(`Next: open Claude Code or Codex in ${target} and start with:`);
  out(`  ${STARTER_PROMPT}`);
  return 0;
}
