// The HTML of the local key page (#9352), served by ./key-page.mjs. One
// self-contained document: no external script, style, font or image (the
// page's Content-Security-Policy allows only its own nonce'd script and style
// and requests to itself). Every text from the store is set with textContent.
// A value is sent once when the user saves it and never comes back: the page
// shows set / empty and, for a long value, its last four characters.

const STYLE = `
:root {
  --bg: #f6f7f9; --panel: #ffffff; --text: #16181d; --muted: #5c6370; --line: #e2e5ea;
  --accent: #3b5bdb; --accent-text: #ffffff; --ok: #1f7a4d; --ok-bg: #e6f4ec; --warn: #8a5a00; --warn-bg: #fdf3dc;
  --danger: #b42318; --field: #ffffff; --focus: rgba(59, 91, 219, .35);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111317; --panel: #1a1d23; --text: #e7e9ee; --muted: #9aa1ad; --line: #2b2f37;
    --accent: #7d97ff; --accent-text: #0d1020; --ok: #6fd3a0; --ok-bg: #16301f; --warn: #f0c060; --warn-bg: #33280f;
    --danger: #ff8a7a; --field: #14161a; --focus: rgba(125, 151, 255, .35);
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.lead { color: var(--muted); margin: 0 0 24px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px 18px 16px; margin: 0 0 14px; }
.head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.head h2 { font-size: 16px; margin: 0; }
code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
.badge { font-size: 12px; font-weight: 600; border-radius: 999px; padding: 1px 9px; margin-left: auto; }
.badge.set { color: var(--ok); background: var(--ok-bg); }
.badge.empty { color: var(--warn); background: var(--warn-bg); }
.desc { color: var(--muted); margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.meta { color: var(--muted); font-size: 13px; margin: 6px 0 0; }
.row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.field { position: relative; flex: 1 1 220px; min-width: 0; display: flex; }
.field input { flex: 1 1 auto; padding-right: 64px; }
.field .peek { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); padding: 3px 9px; font-size: 13px; font-weight: 600; border: none; background: transparent; color: var(--muted); }
.field .peek:hover { color: var(--text); }
input, textarea { flex: 1 1 220px; min-width: 0; font: inherit; color: var(--text); background: var(--field); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
textarea { min-height: 64px; resize: vertical; }
input:focus, textarea:focus, button:focus-visible { outline: 3px solid var(--focus); outline-offset: 1px; }
button { font: inherit; font-weight: 600; border-radius: 8px; padding: 8px 14px; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
button.danger { color: var(--danger); }
button:disabled { opacity: .55; cursor: default; }
.links { display: flex; gap: 14px; margin-top: 10px; }
.links button { background: none; border: none; padding: 0; color: var(--muted); font-weight: 500; text-decoration: underline; }
.links button.danger { color: var(--danger); }
.edit { display: none; margin-top: 10px; }
.edit.open { display: block; }
.edit .row { margin-top: 8px; }
.note { font-size: 13px; color: var(--warn); margin: 6px 0 0; }
.add h2 { font-size: 16px; margin: 0 0 4px; }
.add p { color: var(--muted); margin: 0; font-size: 14px; }
#flash { position: sticky; top: 0; z-index: 2; display: none; margin: 0 0 14px; padding: 10px 14px; border-radius: 8px; font-weight: 600; }
#flash.ok { display: block; color: var(--ok); background: var(--ok-bg); }
#flash.err { display: block; color: var(--danger); background: var(--panel); border: 1px solid var(--danger); }
footer { color: var(--muted); font-size: 13px; margin-top: 24px; }
.expired { text-align: center; padding-top: 80px; }
`;

const SCRIPT = `
(() => {
  const qs = new URLSearchParams(location.search);
  let token = qs.get('t');
  try {
    if (token) sessionStorage.setItem('genesis-key-token', token);
    else token = sessionStorage.getItem('genesis-key-token');
  } catch {}
  if (qs.has('t')) history.replaceState(null, '', location.pathname);
  const list = document.getElementById('keys');
  const flash = document.getElementById('flash');

  function say(text, kind) {
    flash.textContent = text;
    flash.className = kind;
    clearTimeout(say.t);
    say.t = setTimeout(() => { flash.className = ''; }, kind === 'err' ? 8000 : 3500);
  }

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { 'X-Genesis-Key-Token': token || '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data.error && data.error.message) || ('the page answered ' + res.status));
    return data;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function when(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString();
  }

  function card(k) {
    const c = el('section', 'card');
    const head = el('div', 'head');
    head.append(el('h2', '', k.label), el('code', '', k.name), el('span', 'badge ' + k.status, k.status === 'set' ? 'Set' : 'Empty'));
    c.append(head);
    if (k.description) c.append(el('p', 'desc', k.description));
    const meta = [];
    if (k.tail) meta.push('ends with ' + k.tail);
    if (k.status === 'set' && k.updatedAt) meta.push('saved ' + when(k.updatedAt));
    if (meta.length) c.append(el('p', 'meta', meta.join(' · ')));
    if (k.source) c.append(el('p', 'note', 'The environment variable ' + k.source + ' is set and wins over a value saved here.'));

    const row = el('div', 'row');
    const input = el('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = k.status === 'set' ? 'Paste a new value to replace it' : 'Paste the value';
    input.setAttribute('aria-label', 'Value of ' + k.label);
    const save = el('button', 'primary', k.status === 'set' ? 'Replace' : 'Save');
    save.type = 'button';
    const doSave = async () => {
      const v = input.value.trim();
      if (!v) { say('Paste the value first.', 'err'); input.focus(); return; }
      save.disabled = true;
      try {
        await api('PUT', '/api/keys/' + encodeURIComponent(k.name) + '/value', { value: v });
        input.value = '';
        input.type = 'password';
        say(k.label + ' saved.', 'ok');
        await load({ force: true });
      } catch (e) { say(e.message, 'err'); } finally { save.disabled = false; }
    };
    save.addEventListener('click', doSave);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') doSave(); });
    const peek = el('button', 'peek', 'Show');
    peek.type = 'button';
    peek.setAttribute('aria-pressed', 'false');
    peek.setAttribute('aria-label', 'Show the value of ' + k.label);
    peek.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      peek.textContent = show ? 'Hide' : 'Show';
      peek.setAttribute('aria-pressed', String(show));
      peek.setAttribute('aria-label', (show ? 'Hide' : 'Show') + ' the value of ' + k.label);
      input.focus();
    });
    const field = el('div', 'field');
    field.append(input, peek);
    row.append(field, save);
    c.append(row);

    const links = el('div', 'links');
    if (k.status === 'set' && !k.source) {
      const clear = el('button', '', 'Clear value');
      clear.type = 'button';
      clear.addEventListener('click', async () => {
        if (!confirm('Clear the value of ' + k.label + '?')) return;
        try { await api('DELETE', '/api/keys/' + encodeURIComponent(k.name) + '/value'); say(k.label + ' cleared.', 'ok'); await load({ force: true }); }
        catch (e) { say(e.message, 'err'); }
      });
      links.append(clear);
    }
    if (!k.builtin) {
      const edit = el('button', '', 'Edit details');
      edit.type = 'button';
      const box = el('div', 'edit');
      const l = el('input'); l.value = k.label; l.setAttribute('aria-label', 'Label');
      const d = el('textarea'); d.value = k.description; d.setAttribute('aria-label', 'Description');
      const ok = el('button', 'primary', 'Save details'); ok.type = 'button';
      ok.addEventListener('click', async () => {
        try { await api('PATCH', '/api/keys/' + encodeURIComponent(k.name), { label: l.value, description: d.value }); say('Details saved.', 'ok'); await load({ force: true }); }
        catch (e) { say(e.message, 'err'); }
      });
      const r1 = el('div', 'row'); r1.append(l);
      const r2 = el('div', 'row'); r2.append(d);
      const r3 = el('div', 'row'); r3.append(ok);
      box.append(r1, r2, r3);
      edit.addEventListener('click', () => box.classList.toggle('open'));
      const del = el('button', 'danger', 'Delete key');
      del.type = 'button';
      del.addEventListener('click', async () => {
        if (!confirm('Delete ' + k.label + ' and its value? The agent will have to ask for it again.')) return;
        try { await api('DELETE', '/api/keys/' + encodeURIComponent(k.name)); say(k.label + ' deleted.', 'ok'); await load({ force: true }); }
        catch (e) { say(e.message, 'err'); }
      });
      links.append(edit, del);
      c.append(links, box);
    } else if (links.childNodes.length) {
      c.append(links);
    }
    return c;
  }

  // A refresh rebuilds the cards only when the keys changed, and never while the user is
  // typing into one (a rebuild would drop what they typed).
  let shown = '';
  function typing() {
    const a = document.activeElement;
    if (a && list.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return true;
    return [...list.querySelectorAll('input, textarea')].some((e) => e.value && e.defaultValue !== e.value);
  }

  async function load({ force = false } = {}) {
    try {
      const { keys } = await api('GET', '/api/keys');
      const sig = JSON.stringify(keys);
      if (sig === shown && !force) return;
      if (!force && shown && typing()) return;
      shown = sig;
      list.replaceChildren(...keys.map(card));
    } catch (e) {
      say(e.message, 'err');
    }
  }

  const form = document.getElementById('add');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    try {
      await api('POST', '/api/keys', { name: String(f.get('name') || '').trim(), label: String(f.get('label') || ''), description: String(f.get('description') || '') });
      form.reset();
      say('Key added. Paste its value in the card above.', 'ok');
      await load({ force: true });
    } catch (e) { say(e.message, 'err'); }
  });

  window.addEventListener('focus', load);
  load();
})();
`;

/** The key page, or its "link expired" page. `nonce` is the request's CSP nonce. */
export function renderKeyPage({ nonce, idleMinutes = 15, expired = false }) {
  const head =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    '<title>Genesis keys</title>' +
    `<style nonce="${nonce}">${STYLE}</style></head>`;
  if (expired) {
    return (
      head +
      '<body><main class="expired"><h1>This link has expired</h1>' +
      '<p class="lead">The key page closes when it is idle or when the agent session ends. Run <code>genesis-set keys</code> in a terminal for a new one, or ask the agent.</p>' +
      '</main></body></html>'
    );
  }
  return (
    head +
    '<body><main>' +
    '<h1>Genesis keys</h1>' +
    '<p class="lead">Keys your coding agent needs, stored on this machine only (~/.genesis-set/config.json, readable only by you). ' +
    'Paste a value here, never in the chat. The agent sees whether a key is set, not its value.</p>' +
    '<div id="flash" role="status" aria-live="polite"></div>' +
    '<div id="keys"></div>' +
    '<section class="card add"><h2>Add a key</h2><p>The agent usually adds the keys it needs; you can add one yourself.</p>' +
    '<form id="add" autocomplete="off">' +
    '<div class="row"><input name="name" required pattern="[a-z][a-z0-9-]{1,63}" placeholder="name, e.g. stripe-secret-key" aria-label="Name">' +
    '<input name="label" placeholder="Label, e.g. Stripe secret key" aria-label="Label"></div>' +
    '<div class="row"><textarea name="description" placeholder="What it is for and where to get it" aria-label="Description"></textarea></div>' +
    '<div class="row"><button class="primary" type="submit">Add key</button></div>' +
    '</form></section>' +
    `<footer>This page runs on 127.0.0.1 inside genesis-set and closes after ${idleMinutes} idle minutes. Open it again any time with <code>genesis-set keys</code> in a terminal.</footer>` +
    `</main><script nonce="${nonce}">${SCRIPT}</script></body></html>`
  );
}
