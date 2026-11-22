// The HTML of the project board (#9386), served by ./board.mjs. One
// self-contained document: no external script, style, font or image (the CSP
// allows only its nonce'd script and style and requests to itself). Store and
// document text reaches the page as text (textContent) or as the server's
// escaped Markdown rendering (board-md.mjs); nothing else is inserted as HTML.

const STYLE = `
:root {
  --bg: #f6f7f9; --panel: #ffffff; --text: #16181d; --muted: #5c6370; --line: #e2e5ea; --soft: #f0f2f5;
  --accent: #3b5bdb; --accent-text: #ffffff; --ok: #1f7a4d; --ok-bg: #e6f4ec; --warn: #8a5a00; --warn-bg: #fdf3dc;
  --bad: #b42318; --bad-bg: #fdecea; --field: #ffffff; --focus: rgba(59, 91, 219, .35);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111317; --panel: #1a1d23; --text: #e7e9ee; --muted: #9aa1ad; --line: #2b2f37; --soft: #20242b;
    --accent: #7d97ff; --accent-text: #0d1020; --ok: #6fd3a0; --ok-bg: #16301f; --warn: #f0c060; --warn-bg: #33280f;
    --bad: #ff8a7a; --bad-bg: #3a1714; --field: #14161a; --focus: rgba(125, 151, 255, .35);
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { background: var(--panel); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 3; }
.bar { max-width: 1100px; margin: 0 auto; padding: 14px 16px 0; }
.title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 19px; margin: 0; }
.sub { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
nav { display: flex; gap: 4px; margin-top: 10px; overflow-x: auto; }
nav a { padding: 8px 12px; color: var(--muted); text-decoration: none; border-bottom: 2px solid transparent; font-weight: 600; white-space: nowrap; }
nav a.on { color: var(--text); border-bottom-color: var(--accent); }
main { max-width: 1100px; margin: 0 auto; padding: 20px 16px 64px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; margin: 0 0 14px; }
.next { border-left: 4px solid var(--accent); }
.next b { display: block; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2px; }
h2 { font-size: 16px; margin: 0 0 10px; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.stage { margin: 0 0 16px; }
.stage h3 { font-size: 13px; color: var(--muted); margin: 0 0 6px; text-transform: uppercase; letter-spacing: .04em; }
.row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; flex-wrap: wrap; }
.row + .row { border-top: 1px solid var(--line); }
.row.link { cursor: pointer; }
.row.link:hover { background: var(--soft); }
.doc { font: 13.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
.chip { font-size: 12px; font-weight: 600; border-radius: 999px; padding: 1px 9px; white-space: nowrap; }
.chip.ok { color: var(--ok); background: var(--ok-bg); }
.chip.warn { color: var(--warn); background: var(--warn-bg); }
.chip.bad { color: var(--bad); background: var(--bad-bg); }
.chip.idle { color: var(--muted); background: var(--soft); }
.grow { flex: 1 1 auto; }
.split { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 14px; align-items: start; }
.split > * { min-width: 0; }
@media (max-width: 760px) { .split { grid-template-columns: 1fr; } }
.list .row { padding: 6px 10px; overflow-wrap: anywhere; }
.list .row.on { background: var(--soft); font-weight: 600; }
.md h2, .md h3, .md h4 { margin: 18px 0 8px; } .md h2 { font-size: 18px; } .md h3 { font-size: 16px; } .md h4, .md h5, .md h6 { font-size: 14px; }
.md p { margin: 8px 0; } .md ul, .md ol { padding-left: 22px; } .md li.d1 { margin-left: 18px; } .md li.d2 { margin-left: 36px; } .md li.d3, .md li.d4 { margin-left: 54px; }
.md pre { background: var(--soft); padding: 10px 12px; border-radius: 8px; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.md, .md p, .md li, .md td, .md th, .md blockquote, .md h2, .md h3, .md h4 { overflow-wrap: anywhere; }
.md code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--soft); padding: 1px 4px; border-radius: 4px; }
.md pre code { background: none; padding: 0; }
.md blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid var(--line); color: var(--muted); }
.md a { color: var(--accent); }
.tree { position: sticky; top: 112px; max-height: calc(100vh - 128px); overflow-y: auto; }
.tree .group { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin: 12px 10px 4px; }
.tree .group:first-child { margin-top: 0; }
.tree .row { border-top: none; gap: 6px; }
.tree .row.d1 { padding-left: 24px; }
.tree .row.d2 { padding-left: 40px; font-size: 13.5px; }
.json { white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--soft); padding: 12px; border-radius: 8px; margin: 10px 0 0; }
.json .k { color: var(--accent); } .json .s { color: var(--ok); } .json .n, .json .b { color: var(--warn); }
@media (max-width: 760px) { .tree { position: static; max-height: 45vh; } .bpsplit > .tree { order: 1; } }
.table { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--muted); font-weight: 600; }
.kgroup h2 { margin-top: 6px; }
.kcard { border-top: 1px solid var(--line); padding: 12px 0; }
.kcard:first-of-type { border-top: none; }
.khead { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.khead code { font-size: 12.5px; color: var(--muted); }
.khead .chip { margin-left: auto; }
.fields { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
input, textarea, select { flex: 1 1 200px; min-width: 0; font: inherit; color: var(--text); background: var(--field); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
textarea { min-height: 60px; resize: vertical; }
input:focus, textarea:focus, select:focus, button:focus-visible { outline: 3px solid var(--focus); outline-offset: 1px; }
.field { position: relative; flex: 1 1 220px; min-width: 0; display: flex; }
.field input { flex: 1 1 auto; padding-right: 64px; }
.peek { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); padding: 3px 9px; font-size: 13px; border: none; background: transparent; color: var(--muted); }
button { font: inherit; font-weight: 600; border-radius: 8px; padding: 8px 14px; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
button:disabled, input:disabled { opacity: .55; cursor: default; }
.links { display: flex; gap: 14px; margin-top: 8px; }
.links button { background: none; border: none; padding: 0; color: var(--muted); font-weight: 500; text-decoration: underline; }
.links button.danger { color: var(--bad); }
.note { font-size: 13px; color: var(--warn); margin: 6px 0 0; }
.mailtext { white-space: pre-wrap; overflow-wrap: anywhere; font: 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--soft); padding: 12px; border-radius: 8px; margin: 10px 0 0; }
.codes { display: flex; gap: 6px; flex-wrap: wrap; }
.code { font: 600 14px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--ok-bg); color: var(--ok); border-radius: 6px; padding: 2px 8px; }
.envline { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--soft); padding: 6px 10px; border-radius: 6px; display: inline-block; margin-top: 6px; overflow-wrap: anywhere; }
#flash { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); display: none; padding: 10px 16px; border-radius: 8px; font-weight: 600; z-index: 5; }
#flash.ok { display: block; color: var(--ok); background: var(--ok-bg); }
#flash.err { display: block; color: var(--bad); background: var(--bad-bg); }
footer { color: var(--muted); font-size: 13px; margin-top: 24px; }
`;

const SCRIPT = `
(() => {
  const main = document.getElementById('main');
  const flash = document.getElementById('flash');
  const TABS = ['overview', 'documents', 'interview', 'blueprint', 'mail', 'keys'];
  let state = null, shown = '', docCache = new Map(), moduleCache = new Map(), afterRender = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function say(text, kind) {
    flash.textContent = text; flash.className = kind;
    clearTimeout(say.t); say.t = setTimeout(() => { flash.className = ''; }, kind === 'err' ? 8000 : 3000);
  }
  function when(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(); }
  function route() {
    const h = location.hash.replace(/^#/, '');
    const [tab, ...rest] = h.split('/');
    return { tab: TABS.includes(tab) ? tab : 'overview', arg: decodeURIComponent(rest.join('/')) };
  }
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let data = {}; try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data.error && data.error.message) || ('the board answered ' + res.status));
    return data;
  }
  function typing() {
    const a = document.activeElement;
    if (a && main.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return true;
    return [...main.querySelectorAll('input, textarea')].some((e) => e.value && e.defaultValue !== e.value);
  }

  function chipOf(d) {
    if (d.written) {
      if (!d.check) return el('span', 'chip ok', 'Written');
      return d.check.ok ? el('span', 'chip ok', 'Checked') : el('span', 'chip bad', d.check.findings.length + ' finding' + (d.check.findings.length === 1 ? '' : 's'));
    }
    return d.conditional ? el('span', 'chip idle', 'If needed') : el('span', 'chip warn', 'Waiting');
  }

  function overview() {
    const frag = document.createDocumentFragment();
    const next = el('section', 'card next');
    next.append(el('b', '', 'Next step'), el('div', '', state.next));
    frag.append(next);
    const f = state.flow;
    const card = el('section', 'card');
    card.append(el('h2', '', 'Design flow'));
    card.append(el('div', 'small muted', 'The design documents are strongly recommended for the quality of the blueprint (the spec-driven method of mind-set). They are not part of the OpenAPPL standard, which requires only the blueprint.'));
    if (state.designSkipped) {
      card.append(el('p', 'note', 'No design documents: the blueprint was written directly, so its requirements were never settled in writing. Follow it on the Blueprint tab.'));
      frag.append(card);
      return frag;
    }
    if (!f.available) { card.append(el('p', 'muted', 'The design pipeline is not installed. Run "genesis install".')); frag.append(card); return frag; }
    if (!f.checksAvailable) card.append(el('p', 'note', 'design-check is unavailable here (mind-set package not found); documents show as written, not checked.'));
    const stages = [];
    for (const d of f.docs) { const last = stages[stages.length - 1]; if (last && last.stage === d.stage) last.docs.push(d); else stages.push({ stage: d.stage, label: d.label, docs: [d] }); }
    for (const s of stages) {
      const box = el('div', 'stage');
      box.append(el('h3', '', s.stage + ' · ' + s.label));
      for (const d of s.docs) {
        const r = el('div', 'row' + (d.written ? ' link' : ''));
        r.append(el('span', 'doc grow', d.docName), el('span', 'small muted', d.written ? when(d.mtime) : ''), chipOf(d));
        if (d.written) r.addEventListener('click', () => { location.hash = '#documents/' + encodeURIComponent(d.docName); });
        box.append(r);
      }
      card.append(box);
    }
    if (f.other && f.other.length) {
      const box = el('div', 'stage'); box.append(el('h3', '', 'Other documents'));
      for (const n of f.other) { const r = el('div', 'row link'); r.append(el('span', 'doc grow', n)); r.addEventListener('click', () => { location.hash = '#documents/' + encodeURIComponent(n); }); box.append(r); }
      card.append(box);
    }
    frag.append(card);
    return frag;
  }

  async function documents(arg) {
    const wrap = el('div', 'split');
    const list = el('section', 'card list');
    const names = state.flow.available ? state.flow.docs.filter((d) => d.written).map((d) => d.docName).concat(state.flow.other || []) : [];
    if (!names.length) { list.append(el('p', 'muted', 'No design document yet.')); wrap.append(list); return wrap; }
    const pick = names.includes(arg) ? arg : names[0];
    for (const n of names) { const r = el('div', 'row link doc' + (n === pick ? ' on' : ''), n); r.addEventListener('click', () => { location.hash = '#documents/' + encodeURIComponent(n); }); list.append(r); }
    const view = el('section', 'card md');
    const d = state.flow.docs.find((x) => x.docName === pick);
    const head = el('div', 'row'); head.append(el('h2', 'grow', pick)); if (d) head.append(chipOf(d)); view.append(head);
    if (d && d.check && !d.check.ok) { const ul = el('ul', 'small'); for (const m of d.check.findings) ul.append(el('li', '', m)); view.append(ul); }
    const body = el('div', '', 'Loading...'); view.append(body);
    wrap.append(list, view);
    const key = pick + '@' + (d ? d.mtime : '');
    try {
      if (!docCache.has(key)) docCache.set(key, (await api('GET', '/api/doc?name=' + encodeURIComponent(pick))).html);
      body.innerHTML = docCache.get(key); // the server's escaped rendering (board-md.mjs)
    } catch (e) { body.textContent = e.message; }
    return wrap;
  }

  function interview() {
    const card = el('section', 'card');
    const i = state.interview;
    card.append(el('h2', '', 'Requirements interview'));
    if (!i) { card.append(el('p', 'muted', 'The interview has not started. Ask the agent to design the application.')); return card; }
    const r = el('div', 'row'); r.append(el('span', 'grow', 'Status'), el('span', 'chip ' + (/closed/.test(i.status || '') ? 'ok' : 'warn'), i.status || 'unknown')); card.append(r);
    card.append(el('h2', '', 'Open questions (' + i.open.length + ')'));
    if (!i.open.length) card.append(el('p', 'muted', 'None.'));
    else { const ul = el('ul'); for (const o of i.open) ul.append(el('li', '', o)); card.append(ul); }
    if (i.ledger.length) {
      card.append(el('h2', '', 'Coverage ledger'));
      const t = el('table'); const [h, ...rows] = i.ledger;
      const tr = el('tr'); for (const c of h) tr.append(el('th', '', c)); const th = el('thead'); th.append(tr); t.append(th);
      const tb = el('tbody'); for (const row of rows) { const r2 = el('tr'); for (const c of row) r2.append(el('td', '', c)); tb.append(r2); } t.append(tb);
      const w = el('div', 'table'); w.append(t); card.append(w);
    }
    return card;
  }

  function blueprintSummaryCard(b, v) {
    const card = el('section', 'card');
    card.append(el('h2', '', 'Blueprint'));
    const r = el('div', 'row'); r.append(el('span', 'grow', b.name ? 'Project ' + b.name : 'blueprint.json'));
    if (v && v.available) r.append(el('span', 'chip ' + (v.errors ? 'bad' : v.warnings ? 'warn' : 'ok'), v.errors ? v.errors + ' error(s)' : v.warnings ? v.warnings + ' warning(s)' : 'Valid'));
    else r.append(el('span', 'chip idle', 'Not validated'));
    card.append(r);
    if (v && v.first && v.first.length) { const ul = el('ul', 'small'); for (const m of v.first) ul.append(el('li', 'doc', m)); card.append(ul); }
    const t = el('table'); const tr = el('tr'); for (const c of ['Service', 'Data objects', 'Business APIs']) tr.append(el('th', '', c));
    const th = el('thead'); th.append(tr); t.append(th); const tb = el('tbody');
    for (const s of b.services) { const r2 = el('tr'); r2.append(el('td', 'doc', s.name), el('td', '', String(s.dataObjects)), el('td', '', String(s.businessApis))); tb.append(r2); }
    t.append(tb); const w = el('div', 'table'); w.append(t); card.append(w);
    card.append(el('p', 'small muted', 'Pick a module on the left to see its part of blueprint.json and the validation problems inside it.'));
    return card;
  }

  /** JSON as text nodes and colored spans (never HTML), indented two spaces. */
  function jsonInto(v, ind, out) {
    const pad = '  '.repeat(ind);
    if (Array.isArray(v)) {
      if (!v.length) { out.append('[]'); return; }
      out.append('[\\n');
      v.forEach(function (x, i) { out.append(pad + '  '); jsonInto(x, ind + 1, out); out.append(i < v.length - 1 ? ',\\n' : '\\n'); });
      out.append(pad + ']'); return;
    }
    if (v && typeof v === 'object') {
      const ks = Object.keys(v);
      if (!ks.length) { out.append('{}'); return; }
      out.append('{\\n');
      ks.forEach(function (k, i) { out.append(pad + '  ', el('span', 'k', JSON.stringify(k)), ': '); jsonInto(v[k], ind + 1, out); out.append(i < ks.length - 1 ? ',\\n' : '\\n'); });
      out.append(pad + '}'); return;
    }
    out.append(el('span', typeof v === 'string' ? 's' : typeof v === 'number' ? 'n' : 'b', JSON.stringify(v)));
  }

  async function blueprint(arg) {
    const b = state.blueprint, v = state.validation;
    if (!b || b.error) {
      const card = el('section', 'card'); card.append(el('h2', '', 'Blueprint'));
      card.append(b ? el('p', 'note', b.error) : el('p', 'muted', 'No blueprint.json yet. It is written after the design documents.'));
      return card;
    }
    const mods = b.modules || [];
    const pick = mods.some(function (m) { return m.path === arg; }) ? arg : '';
    const wrap = el('div', 'split bpsplit');
    const list = el('section', 'card list tree');
    // A re-render keeps the list where the user scrolled it, and shows the picked row.
    const before = main.querySelector('.tree');
    const keep = before ? before.scrollTop : 0;
    afterRender = function () {
      list.scrollTop = keep;
      const on = list.querySelector('.row.on');
      if (on && (on.offsetTop < list.scrollTop || on.offsetTop + on.offsetHeight > list.scrollTop + list.clientHeight)) list.scrollTop = Math.max(0, on.offsetTop - 40);
    };
    let group = null;
    for (const m of mods) {
      if (m.group !== group) { group = m.group; list.append(el('div', 'group', group)); }
      const r = el('div', 'row link d' + m.depth + (m.path === pick ? ' on' : ''));
      r.title = m.path;
      r.append(el('span', 'grow', m.label));
      if (typeof m.count === 'number') r.append(el('span', 'small muted', String(m.count)));
      if (m.errors) r.append(el('span', 'chip bad', String(m.errors)));
      else if (m.warnings) r.append(el('span', 'chip warn', String(m.warnings)));
      r.addEventListener('click', function () { window.scrollTo(0, 0); location.hash = '#blueprint/' + encodeURIComponent(m.path); });
      list.append(r);
    }
    if (!pick) { wrap.append(list, blueprintSummaryCard(b, v)); return wrap; }
    const row = mods.find(function (m) { return m.path === pick; });
    const view = el('section', 'card');
    const head = el('div', 'row');
    head.append(el('h2', 'grow', row.label));
    if (row.errors) head.append(el('span', 'chip bad', row.errors + ' error(s)'));
    else if (row.warnings) head.append(el('span', 'chip warn', row.warnings + ' warning(s)'));
    else if (v && v.available) head.append(el('span', 'chip ok', 'No problems'));
    const copy = el('button', '', 'Copy path');
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(pick).then(function () { say('Path copied', 'ok'); }, function () { say('Copy failed: the path is ' + pick, 'err'); });
    });
    head.append(copy);
    view.append(head, el('div', 'doc small muted', pick));
    const body = el('div', '', 'Loading...'); view.append(body);
    wrap.append(list, view);
    const key = pick + '@' + b.mtime;
    try {
      if (!moduleCache.has(key)) moduleCache.set(key, (await api('GET', '/api/blueprint?path=' + encodeURIComponent(pick))).module);
      const m = moduleCache.get(key);
      body.replaceChildren();
      if (m.problems.length) {
        const ul = el('ul', 'small');
        for (const p of m.problems) ul.append(el('li', 'doc', p.text));
        body.append(ul);
        if (m.problemCount > m.problems.length) body.append(el('p', 'small muted', (m.problemCount - m.problems.length) + ' more; run mindset validate for the full list.'));
      }
      if (m.hidden) body.append(el('p', 'note', m.hidden + ' literal secret value(s) hidden here. A blueprint holds references, not secrets: use $ENV:NAME or ENTER_CREDENTIAL, and rotate a key that was written here.'));
      const pre = el('pre', 'json'); jsonInto(m.value, 0, pre); body.append(pre);
    } catch (e) { body.textContent = e.message; }
    return wrap;
  }

  /** A message's title: its subject, marked SMS unless the subject already says so. */
  function smsTitle(x) {
    const subject = x.subject || '(no subject)';
    return x.kind === 'sms' && !/^SMS\b/.test(subject) ? 'SMS · ' + subject : subject;
  }

  async function mail(arg) {
    const m = state.mail || { available: false, url: 'http://127.0.0.1:8025' };
    const frag = document.createDocumentFragment();
    const head = el('section', 'card');
    head.append(el('h2', '', 'Mail sink'));
    if (!m.available) {
      head.append(el('p', 'note', 'No mail sink answers at ' + m.url + '. The mail and SMS your services cannot deliver (no email or SMS provider) go to a mail sink; start one to read them here.'));
      head.append(el('div', 'small muted', 'In the docker-compose stack of a build: it runs its own mail-sink (Mailpit); "docker compose up" starts it.'));
      head.append(el('div', 'small muted', 'For services run natively (their .dev.env already names localhost:10465), start the same Mailpit:'));
      if (m.start) head.append(el('div', 'envline', m.start.command));
      head.append(el('div', 'small muted', 'Or ask the agent to start the mail sink. GENESIS_MAILPIT_URL points the board at another one.'));
      frag.append(head);
      return frag;
    }
    const link = el('a', '', m.url); link.href = m.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const line = el('div', 'small muted', 'Reading the mail sink (Mailpit) at '); line.append(link, document.createTextNode(': every mail and SMS your services could not deliver.'));
    head.append(line);
    if (state.canWrite && m.messages.length) {
      const clear = el('button', '', 'Clear mailbox'); clear.type = 'button';
      clear.addEventListener('click', async () => { if (!confirm('Delete every message in the mail sink?')) return; try { await api('DELETE', '/api/mail'); say('Mailbox cleared.', 'ok'); await load(true); } catch (e) { say(e.message, 'err'); } });
      const r = el('div', 'fields'); r.append(clear); head.append(r);
    }
    frag.append(head);
    if (!m.messages.length) { const c = el('section', 'card'); c.append(el('p', 'muted', 'No message yet.')); frag.append(c); return frag; }
    const wrap = el('div', 'split');
    const list = el('section', 'card list');
    const pick = m.messages.some((x) => x.id === arg) ? arg : m.messages[0].id;
    for (const x of m.messages) {
      const r = el('div', 'row link' + (x.id === pick ? ' on' : ''));
      const t = el('div', 'grow');
      t.append(el('div', '', smsTitle(x)), el('div', 'small muted', ((x.to || []).join(', ') || '-') + ' · ' + when(x.receivedAt)));
      r.append(t);
      r.addEventListener('click', () => { location.hash = '#mail/' + encodeURIComponent(x.id); });
      list.append(r);
    }
    const view = el('section', 'card');
    view.append(el('div', '', 'Loading...'));
    wrap.append(list, view);
    frag.append(wrap);
    try {
      const { message: msg } = await api('GET', '/api/mail/' + encodeURIComponent(pick));
      view.replaceChildren();
      view.append(el('h2', '', smsTitle(msg)));
      view.append(el('div', 'small muted', 'From ' + (msg.from || '-') + ' · to ' + ((msg.to || []).join(', ') || '-') + ' · ' + when(msg.receivedAt)));
      if (msg.codes && msg.codes.length) { const c = el('div', 'codes'); c.append(el('span', 'small muted', 'Codes:')); for (const code of msg.codes) c.append(el('span', 'code', code)); view.append(c); }
      view.append(el('div', 'mailtext', msg.text || '(no text body)'));
      if (msg.hasHtml) view.append(el('div', 'small muted', 'This message also has an HTML part; it is shown here as text (the full message is in the mail sink).'));
    } catch (e) { view.replaceChildren(el('p', 'note', e.message)); }
    return frag;
  }

  function keyCard(k) {
    const c = el('div', 'kcard');
    const head = el('div', 'khead');
    head.append(el('strong', '', k.label), el('code', '', k.name), el('span', 'chip ' + (k.status === 'set' ? 'ok' : 'warn'), k.status === 'set' ? 'Set' : 'Empty'));
    c.append(head);
    if (k.description) c.append(el('div', 'small muted', k.description));
    const meta = []; if (k.masked) meta.push('key ' + k.masked); if (k.status === 'set' && k.updatedAt) meta.push('saved ' + when(k.updatedAt));
    if (meta.length) c.append(el('div', 'small muted', meta.join(' · ')));
    if (k.source) c.append(el('p', 'note', 'The environment variable ' + k.source + ' is set and wins over a value saved here.'));
    const base = '/api/keys/' + k.scope + '/' + encodeURIComponent(k.name);
    const fields = el('div', 'fields');
    const field = el('div', 'field');
    const input = el('input'); input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false;
    input.placeholder = k.status === 'set' ? 'Paste a new value to replace it' : 'Paste the value'; input.setAttribute('aria-label', 'Value of ' + k.label);
    const peek = el('button', 'peek', 'Show'); peek.type = 'button';
    peek.addEventListener('click', () => { const s = input.type === 'password'; input.type = s ? 'text' : 'password'; peek.textContent = s ? 'Hide' : 'Show'; input.focus(); });
    field.append(input, peek);
    const save = el('button', 'primary', k.status === 'set' ? 'Replace' : 'Save'); save.type = 'button';
    const doSave = async () => {
      const v = input.value.trim(); if (!v) { say('Paste the value first.', 'err'); return; }
      save.disabled = true;
      try { await api('PUT', base + '/value', { value: v }); input.value = ''; input.type = 'password'; say(k.label + ' saved.', 'ok'); await load(true); }
      catch (e) { say(e.message, 'err'); } finally { save.disabled = false; }
    };
    save.addEventListener('click', doSave); input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') doSave(); });
    fields.append(field, save);
    if (!state.canWrite) { input.disabled = true; save.disabled = true; peek.disabled = true; }
    c.append(fields);
    if (state.canWrite) {
      const links = el('div', 'links');
      if (k.status === 'set' && !k.source) { const b = el('button', '', 'Clear value'); b.type = 'button'; b.addEventListener('click', async () => { if (!confirm('Clear the value of ' + k.label + '?')) return; try { await api('DELETE', base + '/value'); say(k.label + ' cleared.', 'ok'); await load(true); } catch (e) { say(e.message, 'err'); } }); links.append(b); }
      if (!k.builtin) { const b = el('button', 'danger', 'Delete key'); b.type = 'button'; b.addEventListener('click', async () => { if (!confirm('Delete ' + k.label + ' and its value?')) return; try { await api('DELETE', base); say(k.label + ' deleted.', 'ok'); await load(true); } catch (e) { say(e.message, 'err'); } }); links.append(b); }
      if (links.childNodes.length) c.append(links);
    }
    return c;
  }

  function keys() {
    const frag = document.createDocumentFragment();
    if (!state.canWrite) { const n = el('section', 'card'); n.append(el('p', 'note', 'Read-only here. To add or change keys, run "genesis board" in the project folder (it opens the board with write access).')); frag.append(n); }
    for (const [scope, title, hint] of [['project', 'This project', 'Kept in your home folder under this project, never in the project folder.'], ['global', 'Global', 'Yours in every project, such as the Genesis API key.']]) {
      const g = el('section', 'card kgroup');
      g.append(el('h2', '', title), el('div', 'small muted', hint));
      const ks = state.keys.filter((k) => k.scope === scope);
      if (!ks.length) g.append(el('p', 'muted', 'No keys yet.'));
      for (const k of ks) g.append(keyCard(k));
      frag.append(g);
    }
    if (state.canWrite) {
      const add = el('section', 'card');
      add.append(el('h2', '', 'Add a key'), el('div', 'small muted', 'The agent usually adds the keys it needs; you can add one yourself.'));
      const f1 = el('div', 'fields'), f2 = el('div', 'fields'), f3 = el('div', 'fields');
      const name = el('input'); name.placeholder = 'name, e.g. stripe-secret-key';
      const label = el('input'); label.placeholder = 'Label';
      const scope = el('select'); for (const [v, t] of [['project', 'This project'], ['global', 'Global']]) { const o = el('option', '', t); o.value = v; scope.append(o); }
      const desc = el('textarea'); desc.placeholder = 'What it is for and where to get it';
      const go = el('button', 'primary', 'Add key'); go.type = 'button';
      go.addEventListener('click', async () => { try { await api('POST', '/api/keys', { name: name.value.trim(), label: label.value, description: desc.value, scope: scope.value }); name.value = ''; label.value = ''; desc.value = ''; say('Key added.', 'ok'); await load(true); } catch (e) { say(e.message, 'err'); } });
      f1.append(name, label, scope); f2.append(desc); f3.append(go); add.append(f1, f2, f3);
      frag.append(add);
    }
    return frag;
  }

  async function render(force) {
    const { tab, arg } = route();
    for (const a of document.querySelectorAll('nav a')) a.classList.toggle('on', a.dataset.tab === tab);
    const sig = tab + '|' + arg + '|' + JSON.stringify(state);
    if (sig === shown && !force) return;
    if (!force && tab === 'keys' && typing()) return;
    shown = sig;
    const content = tab === 'overview' ? overview() : tab === 'documents' ? await documents(arg) : tab === 'interview' ? interview() : tab === 'blueprint' ? await blueprint(arg) : tab === 'mail' ? await mail(arg) : keys();
    main.replaceChildren(content);
    // A view that needs its own layout settled (the blueprint list scroll) runs after it is in the page.
    if (afterRender) { const f = afterRender; afterRender = null; f(); }
  }

  async function load(force) {
    try { state = await api('GET', '/api/state'); await render(force); }
    catch (e) { say(e.message, 'err'); }
  }

  window.addEventListener('hashchange', () => render(true));
  setInterval(() => { if (document.visibilityState === 'visible') load(false); }, 3000);
  load(true);
})();
`;

/** The board page; the project name is set as text by the script's first state load. */
export function renderBoardPage({ nonce, projectName }) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    `<title>${esc(projectName)} · Genesis board</title>` +
    `<style nonce="${nonce}">${STYLE}</style></head>` +
    '<body><header><div class="bar">' +
    `<div class="title"><h1>${esc(projectName)}</h1><span class="sub">Genesis project board</span></div>` +
    '<nav><a href="#overview" data-tab="overview">Overview</a><a href="#documents" data-tab="documents">Documents</a>' +
    '<a href="#interview" data-tab="interview">Interview</a><a href="#blueprint" data-tab="blueprint">Blueprint</a>' +
    '<a href="#mail" data-tab="mail">Mail</a><a href="#keys" data-tab="keys">Keys</a></nav></div></header>' +
    '<main id="main"></main>' +
    '<div class="bar"><footer>Local board on 127.0.0.1, read from the project folder as the agent writes. Open it any time with <code>genesis board</code> in the project folder.</footer></div>' +
    '<div id="flash" role="status" aria-live="polite"></div>' +
    `<script nonce="${nonce}">${SCRIPT}</script></body></html>`
  );
}
