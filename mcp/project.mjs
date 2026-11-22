// The project identity of genesis-set (#9385, epic #9384).
//
// A folder is a project when it, or one of its parents, holds
// `.genesis/project.json`: `{ "id": "<random>", "name": "<name>" }`. The file
// carries no secret and may be committed, so a clone or a moved folder keeps its
// identity. `genesis init` writes it; nothing ever changes an existing id.
//
// The project's own settings and keys live in the user's home, under that id
// (`<genesis-set data>/projects/<id>/`), never in the project folder.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { dataDirOf } from './config.mjs';

export const PROJECT_DIR = '.genesis';
export const PROJECT_FILE = 'project.json';
/** An id goes into a path under the user's home: letters, digits and dashes only. */
export const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;
const MAX_NAME = 80;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The project file of `dir` itself (not of a parent). */
export function projectFileOf(dir) {
  return path.join(path.resolve(dir), PROJECT_DIR, PROJECT_FILE);
}

/**
 * The project `start` belongs to: `{ root, id, name, file }`, or null. Walks up
 * from `start`; a project file with an unusable id is treated as no project.
 */
export function findProject(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const file = projectFileOf(dir);
    if (fs.existsSync(file)) {
      const p = readJson(file);
      if (p && typeof p.id === 'string' && PROJECT_ID_PATTERN.test(p.id)) {
        const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, MAX_NAME) : path.basename(dir);
        return { root: dir, id: p.id, name, file };
      }
      return null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * The project of `dir` itself, created when absent: answers `{ project, created }`.
 * An existing file is never changed; `dryRun` writes nothing.
 */
export function ensureProject(dir, { name, dryRun = false } = {}) {
  const file = projectFileOf(dir);
  if (fs.existsSync(file)) {
    const found = findProject(dir);
    if (found && found.root === path.resolve(dir)) return { project: found, created: false };
    throw new Error(`${file} is not a usable project file (its id must match ${PROJECT_ID_PATTERN}); fix or delete it`);
  }
  const project = {
    root: path.resolve(dir),
    id: randomUUID(),
    name: String(name || path.basename(path.resolve(dir))).trim().slice(0, MAX_NAME),
    file,
  };
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ id: project.id, name: project.name }, null, 2)}\n`);
  }
  return { project, created: true };
}

/** Where a project's settings and keys live: under the user's genesis-set folder, by id. */
export function projectDataDir(env, id) {
  if (!PROJECT_ID_PATTERN.test(id)) throw new Error(`"${id}" is not a project id`);
  return path.join(dataDirOf(env), 'projects', id);
}

export function projectKeysFile(env, id) {
  return path.join(projectDataDir(env, id), 'keys.json');
}
