// What the project board shows (#9386), read from the project folder each time:
// the design flow from the mind-set pipeline, the documents under design/, the
// interview record, the blueprint and its validation, the keys (masked) and the
// next step. Nothing here writes; the keys come from the key store.
//
// The design pipeline and the schema are read from the installed mind-set
// corpus (MIND_SET_HOME or ~/.mind-set/current). design-check and validate are
// mind-set's own code, loaded from the mind-set package that genesis install
// recorded (or that sits next to this package); without it the board says the
// checks are unavailable instead of guessing.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { blueprintModules, hideSecrets, isUnder, valueAt, withProblemCounts } from './board-blueprint.mjs';
import { diagramsState } from './board-diagrams.mjs';
import { dataDirOf } from './config.mjs';
import { listKeys } from './key-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function mindSetCorpusDir(env = process.env) {
  if (env.MIND_SET_HOME) return path.join(path.resolve(env.MIND_SET_HOME), 'current');
  const home = env.HOME || env.USERPROFILE || '';
  return path.join(home, '.mind-set', 'current');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** The mind-set package folder: the env override, the one genesis install recorded, or the one next to this package. */
export function mindSetPackageDir(env = process.env) {
  const candidates = [];
  if (env.GENESIS_SET_MIND_SET_PACKAGE) candidates.push(path.resolve(env.GENESIS_SET_MIND_SET_PACKAGE));
  const installed = readJson(path.join(dataDirOf(env), 'installed.json'));
  if (installed && typeof installed.mindSetPackage === 'string') candidates.push(installed.mindSetPackage);
  try {
    const req = createRequire(path.join(HERE, '..', 'package.json'));
    candidates.push(path.dirname(req.resolve('@mindbricks/mind-set/package.json')));
  } catch {
    // not next to this package (the standalone server copy)
  }
  return candidates.find((d) => fs.existsSync(path.join(d, 'lib', 'design-check.mjs'))) ?? null;
}

const libCache = new Map();
async function mindSetLib(env, name) {
  const dir = mindSetPackageDir(env);
  if (!dir) return null;
  const file = path.join(dir, 'lib', name);
  if (!libCache.has(file)) libCache.set(file, import(pathToFileURL(file).href).catch(() => null));
  return libCache.get(file);
}

/** The design documents present: docName -> { file, size, mtime }. */
function designFiles(root) {
  const dir = path.join(root, 'design');
  const out = new Map();
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (!n.endsWith('.md') || n === 'README.md') continue;
    const file = path.join(dir, n);
    const st = fs.statSync(file);
    if (st.isFile()) out.set(n.slice(0, -3), { file, size: st.size, mtime: st.mtime.toISOString() });
  }
  return out;
}

const STAGE_LABEL = {
  source: 'Interview',
  requirement: 'Requirements',
  spec: 'Specification',
  test: 'Test',
};

/** The interview record: its status, the OPEN items and the Coverage Ledger rows. */
export function interviewSummary(text) {
  if (text === null) return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let status = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+Status\s*:?\s*(.*)$/i);
    if (m) {
      status = (m[1] || lines.slice(i + 1).find((l) => l.trim()) || '').trim().replace(/[`*_]/g, '').toLowerCase() || null;
      break;
    }
  }
  const open = lines.filter((l) => /\bOPEN\b/.test(l) && !/^#/.test(l)).map((l) => l.replace(/^\s*[-*|]\s*/, '').trim()).slice(0, 50);
  const ledger = [];
  let inLedger = false;
  for (const l of lines) {
    if (/^##\s/.test(l)) inLedger = /coverage ledger/i.test(l);
    else if (inLedger && /^\s*\|/.test(l) && !/^\s*\|?\s*:?-{2,}/.test(l)) {
      const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      ledger.push(cells);
    }
  }
  return { status, open, ledger };
}

/**
 * The design system the project follows (design/DESIGN_SYSTEM.md, written by
 * genesis_applyDesignSystem): `{ slug, name, appliedAt }`, or null without the file.
 * A file written by hand (no marker) still counts, named by its first heading.
 */
export function designSystemOf(files) {
  const f = files.get('DESIGN_SYSTEM');
  if (!f) return null;
  const text = readText(f.file) ?? '';
  const m = /^<!-- genesis design system: ([a-z0-9-]+) \((.+?)\), applied (\d{4}-\d{2}-\d{2})/.exec(text);
  if (m) return { slug: m[1], name: m[2], appliedAt: m[3] };
  const h = /^#\s+(.+?)(?:\s+—\s+Style Reference)?\s*$/m.exec(text);
  return { slug: null, name: h ? h[1] : 'DESIGN_SYSTEM.md', appliedAt: null };
}

/** The blueprint at the project root: a summary, or the parse error. */
export function blueprintSummary(root) {
  const file = path.join(root, 'blueprint.json');
  const text = readText(file);
  if (text === null) return null;
  let bp;
  try {
    bp = JSON.parse(text);
  } catch (e) {
    return { file, error: `not valid JSON: ${e.message}` };
  }
  const services = Array.isArray(bp.services) ? bp.services : [];
  let mtime = null;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    // read a moment ago; a race with a delete only loses the cache key
  }
  return {
    file,
    mtime,
    name: bp?.projectSettings?.basicSettings?.name ?? null,
    services: services.map((s) => ({
      name: s?.serviceSettings?.serviceBasics?.name ?? '(unnamed)',
      dataObjects: Array.isArray(s?.dataObjects) ? s.dataObjects.length : 0,
      businessApis: Array.isArray(s?.businessLogic) ? s.businessLogic.length : Array.isArray(s?.businessApis) ? s.businessApis.length : 0,
    })),
    raw: bp,
  };
}

async function validation(env, bp) {
  if (!bp || bp.error) return null;
  const lib = await mindSetLib(env, 'validate.mjs');
  const schemaText = readText(path.join(mindSetCorpusDir(env), 'openappl.json'));
  if (!lib || !schemaText) return { available: false };
  try {
    const { errors, warnings } = lib.validateBlueprint(lib.loadSchema(JSON.parse(schemaText)), bp.raw);
    return {
      available: true,
      errors: errors.length,
      warnings: warnings.length,
      first: errors.slice(0, 10).map((p) => lib.formatProblem(p)),
      // Every problem, for the module counts and the module panel; not sent in the state.
      problems: [...errors, ...warnings].map((p) => ({ level: p.level, path: String(p.path ?? ''), text: lib.formatProblem(p) })),
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

/** The flow: every pipeline document with its state, plus the fan-out specs found. */
async function flow(env, root, pipeline, files) {
  if (!pipeline) return { available: false, docs: [] };
  const dc = await mindSetLib(env, 'design-check.mjs');
  let roster = null;
  const fan = pipeline.docs.find((d) => d.fanOut);
  const prefix = fan?.fanOut?.docNamePrefix ?? 'service-spec-';
  if (dc && fan?.fanOut?.roster && files.has(fan.fanOut.roster)) {
    try {
      roster = dc.rosterNamesOf(pipeline, readText(files.get(fan.fanOut.roster).file));
    } catch {
      roster = null;
    }
  }
  const check = (docName, file) => {
    if (!dc) return null;
    try {
      const r = dc.checkDesignDraft(pipeline, docName, readText(file) ?? '', roster ? { rosterNames: roster } : {});
      return { ok: r.ok, findings: (r.findings ?? []).map((f) => f.message ?? f.code).slice(0, 10) };
    } catch (e) {
      return { ok: false, findings: [e.message] };
    }
  };
  const docs = [];
  for (const d of pipeline.docs) {
    if (d.fanOut) {
      const names = roster ? roster.map((n) => `${prefix}${dc.serviceRosterKey(n)}`) : [...files.keys()].filter((n) => n.startsWith(prefix));
      const extra = [...files.keys()].filter((n) => n.startsWith(prefix) && !names.includes(n));
      for (const docName of [...names, ...extra]) {
        const f = files.get(docName);
        docs.push({ docName, stage: d.stage, class: d.class, label: STAGE_LABEL[d.class] ?? d.class, fanOut: true, conditional: false, written: Boolean(f), mtime: f?.mtime ?? null, check: f ? check(docName, f.file) : null });
      }
      if (names.length === 0 && extra.length === 0) {
        docs.push({ docName: `${prefix}<service>`, stage: d.stage, class: d.class, label: STAGE_LABEL[d.class] ?? d.class, fanOut: true, conditional: false, written: false, placeholder: true, mtime: null, check: null });
      }
      continue;
    }
    const f = files.get(d.docName);
    docs.push({
      docName: d.docName,
      stage: d.stage,
      class: d.class,
      label: STAGE_LABEL[d.class] ?? d.class,
      conditional: Boolean(d.when),
      written: Boolean(f),
      mtime: f?.mtime ?? null,
      check: f ? check(d.docName, f.file) : null,
    });
  }
  const known = new Set(docs.map((d) => d.docName));
  const other = [...files.keys()].filter((n) => !known.has(n)).sort();
  return { available: true, checksAvailable: Boolean(dc), docs, other };
}

function blueprintStep(blueprint, v) {
  if (!blueprint) return null;
  if (blueprint.error) return `Fix blueprint.json: ${blueprint.error}.`;
  if (v?.available && v.errors > 0) return `Fix the ${v.errors} validation error(s) of the blueprint.`;
  return 'Compile the blueprint with Genesis, one service at a time.';
}

function nextStep(state) {
  const { flow: f, interview, blueprint, validation: v } = state;
  // The design documents are mind-set's recommended method, not part of the OpenAPPL standard:
  // a blueprint written without them is followed on its own (#9390).
  if (state.designSkipped) return blueprintStep(blueprint, v);
  if (!f.available) return 'Install mind-set ("genesis install") so the board can show the design flow.';
  const byName = new Map(f.docs.map((d) => [d.docName, d]));
  const ir = byName.get('interview-record');
  if (!ir?.written) {
    return 'Start: ask the agent to design the application. The design documents are strongly recommended for the quality of the blueprint.';
  }
  if (interview?.status && !/closed/.test(interview.status)) return 'Finish the requirements interview (the record is not closed yet).';
  const failing = f.docs.find((d) => d.written && d.check && !d.check.ok);
  if (failing) return `Fix ${failing.docName}: its design-check has findings.`;
  const missing = f.docs.find((d) => !d.written && !d.conditional && d.class !== 'test');
  if (missing) return `Next document: ${missing.placeholder ? 'the service specs (one per service)' : missing.docName}.`;
  return blueprintStep(blueprint, v) ?? 'Write the blueprint (blueprint.json) from the design documents.';
}

/** The whole board state of a project (or, without one, only the global keys). */
export async function boardState({ env = process.env, project }) {
  const keys = listKeys(env, { project }).map(({ name, label, description, builtin, scope, status, source, masked, updatedAt }) => ({
    name,
    label,
    description,
    builtin,
    scope,
    status,
    ...(source ? { source } : {}),
    masked,
    updatedAt,
  }));
  if (!project) return { project: null, keys };
  const files = designFiles(project.root);
  const pipeline = readJson(path.join(mindSetCorpusDir(env), 'procedures', 'design', 'pipeline.json'));
  const bp = blueprintSummary(project.root);
  const v = await validation(env, bp);
  const state = {
    project: { id: project.id, name: project.name, root: project.root },
    flow: await flow(env, project.root, pipeline, files),
    designSystem: designSystemOf(files),
    frontend: frontendState(project.root),
    // #9407: the project diagrams (drawn with genesis_buildDiagrams, or delivered with the document service).
    diagrams: diagramsState(project.root, bp && !bp.error ? bp.raw : null),
    interview: interviewSummary(files.has('interview-record') ? readText(files.get('interview-record').file) : null),
    blueprint: bp ? { file: bp.file, name: bp.name ?? null, services: bp.services ?? [], error: bp.error ?? null, mtime: bp.mtime ?? null } : null,
    validation: v ? (({ problems, ...summary }) => summary)(v) : v,
    // A blueprint with no design document: the design was skipped, which the standard allows.
    designSkipped: Boolean(bp) && [...files.keys()].every((n) => n === 'DESIGN_SYSTEM'),
    keys,
  };
  if (bp && !bp.error) state.blueprint.modules = withProblemCounts(blueprintModules(bp.raw), v?.problems ?? []);
  state.next = nextStep(state);
  return state;
}

/**
 * One module of the blueprint for the board's panel: its JSON (literal secrets hidden) and the
 * validation problems at or below it. Null when there is no readable blueprint or no such path.
 */
export async function blueprintModule(env, project, modulePath) {
  const bp = blueprintSummary(project.root);
  if (!bp || bp.error) return null;
  const node = valueAt(bp.raw, modulePath);
  if (node === undefined) return null;
  const row = blueprintModules(bp.raw).find((r) => r.path === modulePath);
  const v = await validation(env, bp);
  const problems = (v?.problems ?? []).filter((p) => isUnder(p.path, modulePath));
  const { value, hidden } = hideSecrets(node);
  return {
    path: modulePath,
    label: row?.label ?? modulePath,
    group: row?.group ?? null,
    value,
    hidden,
    validated: Boolean(v?.available),
    problems: problems.slice(0, 200).map((p) => ({ level: p.level, text: p.text })),
    problemCount: problems.length,
  };
}

/**
 * The delivered frontend service of the project (`<codename>-frontend-service/` at the project
 * root, with `docs/README.md`): its prompt docs in catalog order, the architect docs, and
 * whether design/frontend-progress.md exists. Null when no frontend service was delivered.
 */
export function frontendState(root) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /-frontend-service$/.test(d.name));
  } catch {
    return null;
  }
  const dir = dirs.map((d) => d.name).sort().find((n) => fs.existsSync(path.join(root, n, 'docs', 'README.md')));
  if (!dir) return null;
  const docsDir = path.join(root, dir, 'docs');
  const titleOf = (file) => {
    const m = /^#\s+(.+)$/m.exec((readText(file) ?? '').slice(0, 4000));
    return m ? m[1].trim() : path.basename(file, '.md');
  };
  const docs = [{ path: 'README.md', title: 'Index (read first)', kind: 'index' }];
  for (const n of fs.readdirSync(docsDir).filter((x) => /^\d{2,3}-[A-Za-z0-9._-]+\.md$/.test(x)).sort()) {
    docs.push({ path: n, title: titleOf(path.join(docsDir, n)), kind: 'prompt' });
  }
  try {
    for (const n of fs.readdirSync(path.join(docsDir, 'architect')).filter((x) => /^[A-Za-z0-9._-]+\.md$/.test(x)).sort()) {
      docs.push({ path: `architect/${n}`, title: titleOf(path.join(docsDir, 'architect', n)), kind: 'architect' });
    }
  } catch {
    // no architect documents
  }
  return { folder: dir, docs, progress: fs.existsSync(path.join(root, 'design', 'frontend-progress.md')) };
}

/** One frontend doc's text (a path frontendState listed), or null. */
export function frontendDoc(project, rel) {
  const fe = frontendState(project.root);
  if (!fe || !fe.docs.some((d) => d.path === rel)) return null;
  return readText(path.join(project.root, fe.folder, 'docs', ...rel.split('/')));
}

/** One design document's text, by name; null for a name that is not a document of this project. */
export function designDoc(project, docName) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(docName)) return null;
  const file = path.join(project.root, 'design', `${docName}.md`);
  if (path.dirname(file) !== path.join(project.root, 'design')) return null;
  return readText(file);
}
