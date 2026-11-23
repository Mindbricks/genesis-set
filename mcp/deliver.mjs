// Applies a Genesis build archive to the service folder on this machine, with
// the same manifest rule the compiler uses in a repository
// (`.genesis/manifest.json`, schema genesis-manifest/1, git blob ids):
//
//   - a file the archive holds is written (a generated file is always
//     complete; an edit to a generated file is overwritten and reported);
//   - a file the PREVIOUS manifest listed and the new one does not is deleted
//     (only when it is still the generated content; an edited one is kept and
//     reported);
//   - every other file is the user's and is not touched; `service-files/` is
//     always the user's, and `.git` is never touched.
//
// No git command runs here: the user commits the result. A dry run reports the
// same plan and writes nothing.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ArchiveError } from './tar-read.mjs';

export const MANIFEST_PATH = '.genesis/manifest.json';
const CUSTOMER_PREFIXES = ['service-files/'];
const NEVER = ['.git/', '.git'];

/** The git blob id of `bytes` (what `git hash-object` prints). */
export function gitBlobId(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function readManifest(buf, where) {
  let m;
  try {
    m = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new ArchiveError(`${where} is not valid JSON`);
  }
  if (!m || m.schema !== 'genesis-manifest/1' || !m.files || typeof m.files !== 'object') {
    throw new ArchiveError(`${where} is not a genesis-manifest/1 file`);
  }
  return m;
}

function isCustomerOwned(p) {
  return CUSTOMER_PREFIXES.some((x) => p.startsWith(x));
}

function isNever(p) {
  return NEVER.some((x) => p === x || p.startsWith(x.endsWith('/') ? x : `${x}/`));
}

function readIfFile(file) {
  try {
    const st = fs.lstatSync(file);
    return st.isFile() ? fs.readFileSync(file) : null;
  } catch {
    return null;
  }
}

/**
 * The plan for `entries` (from readTar) into `target`:
 * { firstDelivery, write: [{ path, data, mode, state }], remove: [path], keptEdited: [path], editedOverwritten: [path], unchanged, skippedCustomer: [path] }.
 */
export function planDelivery(entries, target) {
  const files = entries.filter((e) => e.type === 'file');
  const manifestEntry = files.find((e) => e.path === MANIFEST_PATH);
  if (!manifestEntry) throw new ArchiveError(`the archive holds no ${MANIFEST_PATH}`);
  const next = readManifest(manifestEntry.data, `the archive's ${MANIFEST_PATH}`);
  const oldBuf = readIfFile(path.join(target, MANIFEST_PATH));
  const prev = oldBuf ? readManifest(oldBuf, `${path.join(target, MANIFEST_PATH)} (the previous delivery)`) : null;

  const plan = { firstDelivery: !prev, write: [], remove: [], keptEdited: [], editedOverwritten: [], unchanged: 0, skippedCustomer: [] };
  for (const e of files) {
    if (isNever(e.path)) continue;
    const dest = path.join(target, ...e.path.split('/'));
    const current = readIfFile(dest);
    if (isCustomerOwned(e.path) && current !== null) {
      plan.skippedCustomer.push(e.path);
      continue;
    }
    if (current?.equals(e.data)) {
      plan.unchanged++;
      continue;
    }
    let state = current === null ? 'new' : 'changed';
    if (current !== null && prev?.files?.[e.path] && prev.files[e.path] !== gitBlobId(current)) {
      plan.editedOverwritten.push(e.path);
      state = 'edit-overwritten';
    } else if (current !== null && !prev?.files?.[e.path] && e.path !== MANIFEST_PATH) {
      state = 'user-file-overwritten';
      plan.editedOverwritten.push(e.path);
    }
    plan.write.push({ path: e.path, data: e.data, mode: e.mode, state });
  }
  if (prev) {
    const nextPaths = new Set(Object.keys(next.files));
    for (const [p, blob] of Object.entries(prev.files)) {
      if (nextPaths.has(p) || isCustomerOwned(p) || isNever(p)) continue;
      const current = readIfFile(path.join(target, ...p.split('/')));
      if (current === null) continue;
      if (gitBlobId(current) === blob) plan.remove.push(p);
      else plan.keptEdited.push(p);
    }
  }
  for (const k of ['remove', 'keptEdited', 'editedOverwritten', 'skippedCustomer']) plan[k].sort();
  plan.write.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return plan;
}

function removeEmptyParents(target, rel) {
  let dir = path.dirname(path.join(target, ...rel.split('/')));
  const root = path.resolve(target);
  while (path.resolve(dir).startsWith(root + path.sep)) {
    try {
      if (fs.readdirSync(dir).length) return;
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/** Writes the plan into `target` (created when absent). The manifest is written last. */
export function applyDelivery(plan, target) {
  fs.mkdirSync(target, { recursive: true });
  const ordered = [...plan.write.filter((w) => w.path !== MANIFEST_PATH), ...plan.write.filter((w) => w.path === MANIFEST_PATH)];
  for (const w of ordered) {
    const dest = path.join(target, ...w.path.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      if (fs.lstatSync(dest).isSymbolicLink()) fs.unlinkSync(dest);
    } catch {
      // absent
    }
    fs.writeFileSync(dest, w.data);
    if (process.platform !== 'win32') fs.chmodSync(dest, w.mode & 0o111 ? 0o755 : 0o644);
  }
  for (const p of plan.remove) {
    fs.rmSync(path.join(target, ...p.split('/')), { force: true });
    removeEmptyParents(target, p);
  }
}

/** The plan as the tool answers it: counts and path lists, never file contents. */
export function planSummary(plan, { target, applied }) {
  const count = (s) => plan.write.filter((w) => w.state === s).length;
  return {
    target,
    applied,
    firstDelivery: plan.firstDelivery,
    written: plan.write.length,
    newFiles: count('new'),
    changedFiles: count('changed'),
    unchanged: plan.unchanged,
    deleted: plan.remove,
    editsOverwritten: plan.editedOverwritten,
    editedFilesKept: plan.keptEdited,
    userFilesKept: plan.skippedCustomer,
  };
}
