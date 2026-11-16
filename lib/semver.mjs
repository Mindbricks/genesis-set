// The small part of semantic versioning genesis-set needs: parse a version and
// check it against the range in package.json `dependencies["@mindbricks/mind-set"]`.
// Ranges: an exact version, `^x.y.z`, `~x.y.z`, comparators (`>=0.1.0 <0.3.0`)
// and `||` alternatives. A pre-release version only matches a range that names
// the same major.minor.patch with a pre-release.

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(v) {
  const m = VERSION.exec(String(v ?? '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    if (x.pre[i] === y.pre[i]) continue;
    const nx = /^\d+$/.test(x.pre[i]);
    const ny = /^\d+$/.test(y.pre[i]);
    if (nx && ny) return +x.pre[i] < +y.pre[i] ? -1 : 1;
    if (nx) return -1;
    if (ny) return 1;
    return x.pre[i] < y.pre[i] ? -1 : 1;
  }
  return 0;
}

function comparators(part) {
  const p = part.trim();
  if (!p || p === '*' || p === 'x') return [{ op: '>=', v: parseVersion('0.0.0') }];
  const caret = /^\^(.+)$/.exec(p);
  if (caret) {
    const v = parseVersion(caret[1]);
    if (!v) return null;
    const upper =
      v.major > 0
        ? `${v.major + 1}.0.0`
        : v.minor > 0
          ? `0.${v.minor + 1}.0`
          : `0.0.${v.patch + 1}`;
    return [
      { op: '>=', v },
      { op: '<', v: parseVersion(`${upper}-0`) },
    ];
  }
  const tilde = /^~(.+)$/.exec(p);
  if (tilde) {
    const v = parseVersion(tilde[1]);
    if (!v) return null;
    return [
      { op: '>=', v },
      { op: '<', v: parseVersion(`${v.major}.${v.minor + 1}.0-0`) },
    ];
  }
  const out = [];
  for (const tok of p.split(/\s+/)) {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(tok);
    const v = m && parseVersion(m[2]);
    if (!v) return null;
    out.push({ op: m[1] || '=', v });
  }
  return out;
}

/** True when `version` satisfies `range`; null when either cannot be read. */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return null;
  const alternatives = String(range ?? '').split('||');
  let readable = false;
  for (const alt of alternatives) {
    const cs = comparators(alt);
    if (!cs) continue;
    readable = true;
    if (v.pre.length && !cs.some((c) => c.v.pre.length && c.v.major === v.major && c.v.minor === v.minor && c.v.patch === v.patch)) {
      // a pre-release only matches a comparator on the same version with a pre-release
      continue;
    }
    const ok = cs.every(({ op, v: w }) => {
      const c = compareVersions(v, w);
      return op === '>=' ? c >= 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : op === '<' ? c < 0 : c === 0;
    });
    if (ok) return true;
  }
  return readable ? false : null;
}
