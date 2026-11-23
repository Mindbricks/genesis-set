// The project diagrams on the board (#9407): where they are, what they say, and the renderer.
//
// A diagram set is one `genesis-diagrams/1` file (Mermaid source per diagram, with click regions
// that name the diagram they open). It comes from one of two places in the project folder:
//
//   - <project>/diagrams/diagrams.json, written by genesis_buildDiagrams (POST /diagrams);
//   - <project>/<codename>-document-service/diagrams/diagrams.json, delivered with a build of the
//     document service.
//
// The newer of the two is shown. Nothing here writes into the project.
//
// The renderer is mermaid, fetched once from a public npm mirror, checked against its pinned
// sha256 and kept under the genesis-set data folder; the board serves it to its own diagram page
// only. GENESIS_MERMAID_FILE names a local copy instead (the same file: the hash is checked too).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { dataDirOf } from './config.mjs';

export const DIAGRAMS_SCHEMA = 'genesis-diagrams/1';
/** Where genesis_buildDiagrams writes the set, relative to the project root. */
export const DIAGRAMS_FILE = path.join('diagrams', 'diagrams.json');

export const MERMAID_VERSION = '11.15.0';
export const MERMAID_SHA256 = '70137e77bb273bb2ef972b86e8b0400cca8be53cb25bfc45911a186dc98665de';
export const MERMAID_URLS = [
  `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`,
  `https://unpkg.com/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`,
];
const MERMAID_MAX_BYTES = 8 * 1024 * 1024;

/** sha256 of the blueprint as Genesis hashes it: the JSON text of the parsed file. */
export function blueprintHashOf(raw) {
  return createHash('sha256').update(JSON.stringify(raw)).digest('hex');
}

/** The diagram files present: [{ file, rel, source }], the project's own first. */
function candidates(root) {
  const out = [];
  const own = path.join(root, DIAGRAMS_FILE);
  if (fs.existsSync(own)) out.push({ file: own, rel: DIAGRAMS_FILE.split(path.sep).join('/'), source: 'drawn' });
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /-document-service$/.test(d.name));
  } catch {
    return out;
  }
  for (const d of dirs.map((x) => x.name).sort()) {
    const file = path.join(root, d, 'diagrams', 'diagrams.json');
    if (fs.existsSync(file)) out.push({ file, rel: `${d}/diagrams/diagrams.json`, source: 'build' });
  }
  return out;
}

const cache = new Map(); // file -> { key, bundle, error }

/** The parsed set of a file, cached by mtime and size (the board polls every few seconds). */
function readBundle(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return { ...hit, mtime: st.mtimeMs };
  let entry;
  try {
    const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!bundle || bundle.schema !== DIAGRAMS_SCHEMA || !bundle.diagrams || typeof bundle.diagrams !== 'object') {
      entry = { key, bundle: null, error: `not a ${DIAGRAMS_SCHEMA} file` };
    } else {
      entry = { key, bundle, error: null };
    }
  } catch (e) {
    entry = { key, bundle: null, error: `not valid JSON: ${e.message}` };
  }
  cache.set(file, entry);
  return { ...entry, mtime: st.mtimeMs };
}

/** The set the board shows: the newest readable one (by generatedAt, then file time). */
function pick(root) {
  const read = candidates(root)
    .map((c) => ({ ...c, ...readBundle(c.file) }))
    .filter((c) => c.key);
  if (!read.length) return null;
  const good = read.filter((c) => c.bundle);
  if (!good.length) return read[0];
  const at = (c) => Date.parse(c.bundle.generatedAt) || c.mtime || 0;
  return good.sort((a, b) => at(b) - at(a))[0];
}

/**
 * The Diagrams summary of the board state, or null when the project has none:
 * { file, source, generatedAt, count, valid, errorCount, codename, blueprintChanged, stamp } or { file, error, stamp }.
 */
export function diagramsState(root, blueprintRaw) {
  const c = pick(root);
  if (!c) return null;
  const stamp = `${c.rel}@${c.key}`;
  if (!c.bundle) return { file: c.rel, error: `${c.rel} is ${c.error}`, stamp };
  const b = c.bundle;
  return {
    file: c.rel,
    source: c.source,
    generatedAt: b.generatedAt ?? null,
    count: typeof b.count === 'number' ? b.count : Object.keys(b.diagrams).length,
    valid: b.valid !== false,
    errorCount: b.validation?.errorCount ?? 0,
    codename: b.codename ?? null,
    // Null when there is no readable blueprint to compare with.
    blueprintChanged: blueprintRaw && typeof b.blueprintHash === 'string' ? blueprintHashOf(blueprintRaw) !== b.blueprintHash : null,
    stamp,
  };
}

/** The whole set the board shows (for its diagram page), or null. */
export function diagramsBundle(root) {
  const c = pick(root);
  return c?.bundle ? { file: c.rel, source: c.source, bundle: c.bundle } : null;
}

// ── the renderer ──────────────────────────────────────────────────────

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function mermaidCacheFile(env) {
  return path.join(dataDirOf(env), 'vendor', `mermaid-${MERMAID_VERSION}.min.js`);
}

function readChecked(file, sha = MERMAID_SHA256) {
  try {
    const bytes = fs.readFileSync(file);
    return sha256(bytes) === sha ? bytes : null;
  } catch {
    return null;
  }
}

let inflight = null;

/**
 * The mermaid bytes: the local copy (GENESIS_MERMAID_FILE), the cached download, or a new
 * download from the mirrors. Every source is checked against MERMAID_SHA256. Throws with a
 * message the page can show when none works.
 */
export async function mermaidScript(env = process.env, { fetchImpl = globalThis.fetch, urls = MERMAID_URLS, sha = MERMAID_SHA256 } = {}) {
  if (env.GENESIS_MERMAID_FILE) {
    const bytes = readChecked(path.resolve(env.GENESIS_MERMAID_FILE), sha);
    if (!bytes) throw new Error(`GENESIS_MERMAID_FILE is not mermaid ${MERMAID_VERSION} (missing, or its sha256 differs)`);
    return bytes;
  }
  const file = mermaidCacheFile(env);
  const cached = readChecked(file, sha);
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      const failures = [];
      for (const url of urls) {
        try {
          const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000), redirect: 'follow' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const bytes = Buffer.from(await res.arrayBuffer());
          if (bytes.length > MERMAID_MAX_BYTES) throw new Error('too large');
          if (sha256(bytes) !== sha) throw new Error('sha256 differs from the pinned one');
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const tmp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, bytes);
          fs.renameSync(tmp, file);
          return bytes;
        } catch (e) {
          failures.push(`${new URL(url).host}: ${e.message}`);
        }
      }
      throw new Error(`mermaid ${MERMAID_VERSION} could not be fetched (${failures.join('; ')})`);
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
