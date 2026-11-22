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
  return {
    file,
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
  const state = {
    project: { id: project.id, name: project.name, root: project.root },
    flow: await flow(env, project.root, pipeline, files),
    interview: interviewSummary(files.has('interview-record') ? readText(files.get('interview-record').file) : null),
    blueprint: bp ? { file: bp.file, name: bp.name ?? null, services: bp.services ?? [], error: bp.error ?? null } : null,
    validation: await validation(env, bp),
    // A blueprint with no design document: the design was skipped, which the standard allows.
    designSkipped: Boolean(bp) && files.size === 0,
    keys,
  };
  state.next = nextStep(state);
  return state;
}

/** One design document's text, by name; null for a name that is not a document of this project. */
export function designDoc(project, docName) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(docName)) return null;
  const file = path.join(project.root, 'design', `${docName}.md`);
  if (path.dirname(file) !== path.join(project.root, 'design')) return null;
  return readText(file);
}
