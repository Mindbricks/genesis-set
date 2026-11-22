// The blueprint modules of the project board: every part of blueprint.json the
// user may want to look at (project settings, authentication, the BFF and
// notification services, each business service with its data objects and
// business APIs, and any other top-level section), as a tree the page lists on
// the left, and the JSON of one module for the panel on the right.
//
// Paths use the validator's spelling (`$.services[0].dataObjects[1]`), so a
// module counts the validation problems under it by a plain prefix match.
// Nothing here writes. A secret value written into the blueprint as a literal
// (which mind-set validate already reports) is hidden in the panel; references
// (`$ENV:NAME`) and the `ENTER_CREDENTIAL` placeholder are shown as they are.

const KNOWN = [
  ['projectSettings', 'Project settings', 'Project'],
  ['authentication', 'Authentication', 'Authentication'],
  ['bffService', 'BFF service', 'BFF'],
  ['notificationService', 'Notification service', 'Notification'],
];

/** `basicSettings` -> `Basic settings`. */
export function humanize(key) {
  const words = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : String(key);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function childPath(path, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/** The first `name` string within three object levels (arrays are not searched): a service, data object or API name. */
export function nameOf(node) {
  let level = [node];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next = [];
    for (const n of level) {
      if (!isObject(n)) continue;
      if (typeof n.name === 'string' && n.name.trim()) return n.name.trim();
      for (const v of Object.values(n)) if (isObject(v)) next.push(v);
    }
    level = next;
  }
  return null;
}

/** The children worth a row of their own: object and array members, never scalars. */
function sections(node) {
  return isObject(node) ? Object.entries(node).filter(([, v]) => v !== null && typeof v === 'object') : [];
}

/** The tree of modules, in page order: `{ path, label, group, depth, count? }`. */
export function blueprintModules(bp) {
  const rows = [];
  const add = (path, label, group, depth, count) => rows.push({ path, label, group, depth, ...(count === undefined ? {} : { count }) });
  if (!isObject(bp)) return rows;
  add('$', 'Whole blueprint', 'Project', 0);
  const listed = new Set();
  for (const [key, label, group] of KNOWN) {
    if (!(key in bp)) continue;
    listed.add(key);
    const path = childPath('$', key);
    add(path, label, group, 0);
    for (const [k, v] of sections(bp[key])) add(childPath(path, k), humanize(k), group, 1, Array.isArray(v) ? v.length : undefined);
  }
  if (Array.isArray(bp.services)) {
    listed.add('services');
    bp.services.forEach((svc, i) => {
      const path = `$.services[${i}]`;
      add(path, nameOf(svc?.serviceSettings) ?? nameOf(svc) ?? `service ${i + 1}`, 'Services', 0);
      for (const [k, v] of sections(svc)) {
        const sub = childPath(path, k);
        if (!Array.isArray(v)) {
          add(sub, humanize(k), 'Services', 1);
          continue;
        }
        add(sub, k === 'businessLogic' ? 'Business APIs' : humanize(k), 'Services', 1, v.length);
        v.forEach((item, j) => {
          add(`${sub}[${j}]`, nameOf(item) ?? `${humanize(k)} ${j + 1}`, 'Services', 2);
        });
      }
    });
  }
  for (const [key, v] of Object.entries(bp)) {
    if (listed.has(key) || v === null || typeof v !== 'object') continue;
    const path = childPath('$', key);
    add(path, humanize(key), 'Other', 0, Array.isArray(v) ? v.length : undefined);
    for (const [k, w] of sections(v)) add(childPath(path, k), humanize(k), 'Other', 1, Array.isArray(w) ? w.length : undefined);
  }
  return rows;
}

/** Is `problemPath` at `path` or below it? */
export function isUnder(problemPath, path) {
  if (path === '$') return true;
  if (problemPath === path) return true;
  if (!problemPath.startsWith(path)) return false;
  const c = problemPath[path.length];
  return c === '.' || c === '[';
}

/** Each module row with the errors and warnings at or below it. */
export function withProblemCounts(rows, problems) {
  return rows.map((r) => {
    let errors = 0;
    let warnings = 0;
    for (const p of problems) {
      if (!isUnder(String(p.path ?? ''), r.path)) continue;
      if (p.level === 'error') errors++;
      else warnings++;
    }
    return { ...r, errors, warnings };
  });
}

const TOKEN = /\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/y;

/** The value at a validator-style path; `undefined` for a malformed path or one that is not there. */
export function valueAt(bp, path) {
  if (typeof path !== 'string' || !path.startsWith('$') || path.length > 500) return undefined;
  let node = bp;
  TOKEN.lastIndex = 1;
  while (TOKEN.lastIndex < path.length) {
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(path);
    if (!m || m.index !== at) return undefined;
    let key;
    if (m[1] !== undefined) key = m[1];
    else if (m[2] !== undefined) key = Number(m[2]);
    else {
      try {
        key = JSON.parse(m[3]);
      } catch {
        return undefined;
      }
    }
    if (node === null || typeof node !== 'object') return undefined;
    if (typeof key === 'number' ? !Array.isArray(node) : Array.isArray(node)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

const REFERENCE = /^\s*(\$ENV:[A-Za-z_][A-Za-z0-9_]*|ENTER_CREDENTIAL)\s*$/;

/** A copy with every literal secret value (`secret: true` and not a reference or the placeholder) hidden; plus how many. */
export function hideSecrets(value) {
  let hidden = 0;
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isObject(v)) return v;
    const out = {};
    for (const [k, w] of Object.entries(v)) out[k] = walk(w);
    if (v.secret === true && typeof v.value === 'string' && v.value !== '' && !REFERENCE.test(v.value)) {
      out.value = `(hidden: a literal secret, ${v.value.length} characters)`;
      hidden++;
    }
    return out;
  };
  return { value: walk(value), hidden };
}
