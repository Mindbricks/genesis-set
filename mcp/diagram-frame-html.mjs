// The diagram page of the project board (#9407), served at /diagrams-frame and shown inside the
// board's Diagrams tab. It reads the project's diagram set (/api/diagrams), draws one diagram at a
// time with mermaid (served by the board itself, /assets/mermaid-<version>.js) and opens the
// diagram a click region names: a click on the drawing, or on the region's link under it.
//
// Its own document because mermaid writes <style> into every SVG it draws (the board page allows
// no inline style). mermaid runs with securityLevel "strict" (its own sanitizer); every other
// text reaches the page as text.

const STYLE = `
:root {
  --bg: #f6f7f9; --panel: #ffffff; --text: #16181d; --muted: #5c6370; --line: #e2e5ea; --soft: #f0f2f5;
  --accent: #3b5bdb; --accent-text: #ffffff; --warn: #8a5a00; --warn-bg: #fdf3dc; --bad: #b42318; --bad-bg: #fdecea;
  --link: rgba(59, 91, 219, .18); --label-bg: rgba(240, 242, 245, .92);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111317; --panel: #1a1d23; --text: #e7e9ee; --muted: #9aa1ad; --line: #2b2f37; --soft: #20242b;
    --accent: #7d97ff; --accent-text: #0d1020; --warn: #f0c060; --warn-bg: #33280f; --bad: #ff8a7a; --bad-bg: #3a1714;
    --link: rgba(125, 151, 255, .22); --label-bg: rgba(32, 36, 43, .92);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--panel); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.top { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--panel); z-index: 2; }
button, select { font: inherit; font-weight: 600; border-radius: 8px; padding: 6px 12px; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
button.on { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
select { font-weight: 500; max-width: 260px; }
.grow { flex: 1 1 auto; }
.crumbs { padding: 8px 12px 0; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 13px; color: var(--muted); }
.crumbs a { color: var(--accent); cursor: pointer; text-decoration: none; }
.crumbs a:hover { text-decoration: underline; }
.crumbs .here { color: var(--text); font-weight: 600; }
.head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; }
.head h2 { font-size: 16px; margin: 0; }
.chip { font-size: 12px; font-weight: 600; border-radius: 999px; padding: 1px 9px; background: var(--soft); color: var(--muted); white-space: nowrap; }
.note { margin: 8px 12px; padding: 8px 12px; border-radius: 8px; background: var(--warn-bg); color: var(--warn); font-size: 13px; }
.note.bad { background: var(--bad-bg); color: var(--bad); }
.note ul { margin: 4px 0 0; padding-left: 18px; }
.canvas { margin: 0 12px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; overflow: auto; min-height: 120px; background: var(--bg); }
/* mermaid's edge-label background resolves to 50% black on these themes: a readable one instead. */
.canvas .labelBkg, .canvas .edgeLabel { background-color: var(--label-bg) !important; }
.canvas .edgeLabel rect { fill: var(--label-bg) !important; }
.mb-link { cursor: pointer; }
.mb-link:hover > rect, .mb-link:hover > polygon, .mb-link:hover > path, .mb-link:hover > circle, rect.mb-link:hover { filter: drop-shadow(0 0 4px var(--accent)); }
.opens { padding: 10px 12px 16px; }
.opens h3 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin: 4px 0 6px; }
.links { display: flex; flex-wrap: wrap; gap: 6px; }
.links button { font-weight: 500; padding: 3px 10px; font-size: 13px; }
.links button:disabled { opacity: .5; cursor: default; }
pre { margin: 8px 12px; padding: 10px 12px; background: var(--soft); border-radius: 8px; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.muted { color: var(--muted); }
.pad { padding: 12px; }
`;

const SCRIPT = `
(() => {
  const root = document.getElementById('app');
  const dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  let set = null, trail = [], seq = 0, fit = true, source = false, renderer = 'loading', rendererError = '';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function hashId() { try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { return ''; } }
  const titleOf = (id) => (set.diagrams[id] ? set.diagrams[id].title : id);

  /** The shortest way from a top diagram to \`id\` (the breadcrumb of a diagram opened directly). */
  function pathTo(id) {
    const prev = new Map(), q = [];
    for (const r of set.roots) if (!prev.has(r.id)) { prev.set(r.id, null); q.push(r.id); }
    while (q.length) {
      const x = q.shift();
      if (x === id) break;
      for (const g of set.diagrams[x].regions) if (g.to && !prev.has(g.to)) { prev.set(g.to, x); q.push(g.to); }
    }
    if (!prev.has(id)) return [id];
    const out = [];
    for (let x = id; x !== null; x = prev.get(x)) out.unshift(x);
    return out;
  }

  function open(id, how) {
    if (!set.diagrams[id]) return;
    if (how === 'push') { const at = trail.indexOf(id); trail = at >= 0 ? trail.slice(0, at + 1) : trail.concat(id); }
    else if (how === 'crumb') trail = trail.slice(0, trail.indexOf(id) + 1);
    else trail = pathTo(id);
    history.replaceState(null, '', '#' + encodeURIComponent(id));
    if (window.parent !== window) window.parent.postMessage({ type: 'genesis-diagram', id: id }, location.origin);
    show();
    window.scrollTo(0, 0);
  }

  function top() {
    const bar = el('div', 'top');
    for (const r of set.roots) {
      const b = el('button', trail[0] === r.id ? 'on' : '', r.title);
      b.type = 'button';
      b.addEventListener('click', () => open(r.id, 'jump'));
      bar.append(b);
    }
    if (set.others.length) {
      const s = el('select');
      s.setAttribute('aria-label', 'Other diagrams');
      const first = el('option', '', 'Other diagrams (' + set.others.length + ')'); first.value = ''; s.append(first);
      for (const id of set.others) { const o = el('option', '', titleOf(id)); o.value = id; if (trail[0] === id) o.selected = true; s.append(o); }
      s.addEventListener('change', () => { if (s.value) open(s.value, 'jump'); });
      bar.append(s);
    }
    bar.append(el('span', 'grow'));
    const f = el('button', '', fit ? 'Actual size' : 'Fit to width'); f.type = 'button';
    f.addEventListener('click', () => { fit = !fit; show(); });
    const src = el('button', source ? 'on' : '', 'Source'); src.type = 'button';
    src.addEventListener('click', () => { source = !source; show(); });
    bar.append(f, src);
    return bar;
  }

  function crumbs() {
    const c = el('div', 'crumbs');
    trail.forEach((id, i) => {
      if (i) c.append(el('span', '', '>'));
      if (i === trail.length - 1) c.append(el('span', 'here', titleOf(id)));
      else { const a = el('a', '', titleOf(id)); a.addEventListener('click', () => open(id, 'crumb')); c.append(a); }
    });
    return c;
  }

  /** participant / actor aliases of a sequence diagram: alias -> label. */
  function aliases(src) {
    const m = new Map();
    for (const line of src.split('\\n')) {
      const x = /^\\s*(?:participant|actor)\\s+(\\S+)(?:\\s+as\\s+(.+))?\\s*$/.exec(line);
      if (x) m.set(x[1], (x[2] || x[1]).trim());
    }
    return m;
  }

  /** Make the drawn nodes of the regions clickable (mermaid's own ids, then the visible labels). */
  function bind(canvas, d) {
    const byNode = new Map();
    for (const r of d.regions) if (r.to && !byNode.has(r.nodeId)) byNode.set(r.nodeId, r);
    if (!byNode.size) return 0;
    const done = new Set();
    let bound = 0;
    const hit = (node, r) => {
      if (!node || node.dataset.mbNode) return;
      node.dataset.mbNode = r.nodeId;
      node.classList.add('mb-link');
      node.setAttribute('role', 'link');
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = 'Open ' + titleOf(r.to);
      node.prepend(t);
      node.addEventListener('click', (ev) => { ev.stopPropagation(); open(r.to, 'push'); });
      done.add(r.nodeId);
      bound++;
    };
    const idRe = d.type === 'erDiagram' ? /(?:^|-)entity-(.+)-\\d+$/ : /(?:^|-)flowchart-(.+)-\\d+$/;
    for (const g of canvas.querySelectorAll('g.node, g[id*="entity-"]')) {
      const m = idRe.exec(g.id || '');
      if (m && byNode.has(m[1])) hit(g, byNode.get(m[1]));
    }
    if (d.type === 'sequenceDiagram') {
      const names = aliases(d.mermaid);
      for (const [nodeId, r] of byNode) {
        for (const rect of canvas.querySelectorAll('rect.actor')) if (rect.getAttribute('name') === nodeId) hit(rect.parentNode, r);
        if (done.has(nodeId)) continue;
        const label = names.get(nodeId) || nodeId;
        for (const t of canvas.querySelectorAll('text.actor')) if (t.textContent.trim() === label) hit(t.parentNode, r);
      }
    }
    // Last resort: a node whose visible label is the region's node id.
    for (const [nodeId, r] of byNode) {
      if (done.has(nodeId)) continue;
      for (const g of canvas.querySelectorAll('g.node')) if ((g.textContent || '').trim() === nodeId) { hit(g, r); break; }
    }
    return bound;
  }

  async function draw(canvas, d) {
    const mine = ++seq;
    if (renderer !== 'ready') {
      canvas.replaceChildren(el('p', 'muted', renderer === 'loading' ? 'Loading the diagram renderer (fetched once, then kept on this machine)...' : 'The diagram renderer is not available: ' + rendererError + '. The links below still open every diagram; Source shows the Mermaid text.'));
      return;
    }
    // ELK is not bundled: those diagrams are drawn with mermaid's default layout.
    const text = d.mermaid.replace(/^%%\\{init:\\s*\\{"layout":\\s*"elk"\\}\\}%%\\s*\\n/m, '');
    try {
      const out = await window.mermaid.render('mbd' + mine, text);
      if (mine !== seq) return;
      canvas.innerHTML = out.svg; // mermaid's own sanitized drawing (securityLevel strict)
      // Natural size, shrunk to the width when "fit" (never enlarged).
      const svg = canvas.querySelector('svg');
      if (svg) {
        const natural = parseFloat(svg.style.maxWidth) || (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) || 0;
        if (natural) svg.style.width = Math.ceil(natural) + 'px';
        svg.style.maxWidth = fit ? '100%' : 'none';
        svg.style.height = 'auto';
      }
      const n = bind(canvas, d);
      const linkable = d.regions.filter((r) => r.to).length;
      if (linkable && !n) canvas.append(el('p', 'muted', 'Use the links below to open the diagrams this one leads to.'));
    } catch (e) {
      if (mine !== seq) return;
      canvas.replaceChildren(el('p', 'muted', 'This diagram could not be drawn: ' + (e && e.message ? e.message : String(e)) + '. Source shows its Mermaid text.'));
    }
  }

  function opens(d) {
    const box = el('div', 'opens');
    const seen = new Map();
    for (const r of d.regions) { const key = r.to || ('-' + r.kind + JSON.stringify(r.target)); if (!seen.has(key)) seen.set(key, r); }
    if (!seen.size) { box.append(el('div', 'muted', 'This diagram opens nothing further.')); return box; }
    box.append(el('h3', '', 'Opens (' + seen.size + ')'));
    const links = el('div', 'links');
    const rows = [...seen.values()].sort((a, b) => (a.to ? titleOf(a.to) : '').localeCompare(b.to ? titleOf(b.to) : ''));
    for (const r of rows) {
      const label = r.to ? titleOf(r.to) : Object.values(r.target || {}).join(' / ') + ' (not drawn)';
      const b = el('button', '', label); b.type = 'button';
      if (r.to) b.addEventListener('click', () => open(r.to, 'push')); else b.disabled = true;
      links.append(b);
    }
    box.append(links);
    return box;
  }

  function show() {
    const id = trail[trail.length - 1];
    const d = set.diagrams[id];
    const frag = document.createDocumentFragment();
    frag.append(top(), crumbs());
    if (!set.valid && set.validation) {
      const n = el('div', 'note');
      n.append(el('div', '', set.validation.message || 'The blueprint does not validate.'));
      const errs = (set.validation.errors || []).slice(0, 5);
      if (errs.length) { const ul = el('ul'); for (const e of errs) ul.append(el('li', '', (e.path ? e.path + ': ' : '') + e.message)); n.append(ul); }
      frag.append(n);
    }
    const head = el('div', 'head');
    head.append(el('h2', '', d.title), el('span', 'chip', d.type || 'diagram'));
    frag.append(head);
    const canvas = el('div', 'canvas ' + (fit ? 'fit' : 'full'));
    frag.append(canvas);
    if (source) frag.append(el('pre', '', d.mermaid));
    frag.append(opens(d));
    root.replaceChildren(frag);
    draw(canvas, d);
  }

  function loadRenderer() {
    const s = document.createElement('script');
    s.src = MERMAID_PATH;
    s.onload = () => {
      try {
        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', maxTextSize: 5000000, maxEdges: 50000 });
        renderer = 'ready';
      } catch (e) { renderer = 'failed'; rendererError = e && e.message ? e.message : String(e); }
      if (set) show();
    };
    s.onerror = () => {
      fetch(MERMAID_PATH, { cache: 'no-store' }).then((r) => r.json()).then((j) => j.error && j.error.message).catch(() => '').then((m) => {
        renderer = 'failed'; rendererError = m || 'it could not be loaded';
        if (set) show();
      });
    };
    document.head.append(s);
  }

  async function start() {
    loadRenderer();
    try {
      const res = await fetch('/api/diagrams', { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error((j.error && j.error.message) || ('the board answered ' + res.status));
      set = j.bundle;
      set.roots = set.roots || []; set.others = set.others || [];
    } catch (e) {
      root.replaceChildren(el('p', 'pad muted', 'No diagrams to show: ' + e.message));
      return;
    }
    const want = hashId();
    const first = set.diagrams[want] ? want : (set.roots[0] && set.roots[0].id) || Object.keys(set.diagrams)[0];
    if (!first) { root.replaceChildren(el('p', 'pad muted', 'The diagram set is empty.')); return; }
    open(first, 'jump');
  }
  start();
})();
`;

/** The diagram page; `mermaidPath` is where the board serves the renderer. */
export function renderDiagramFrame({ nonce, mermaidPath }) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    '<title>Diagrams</title>' +
    `<style nonce="${nonce}">${STYLE}</style></head>` +
    '<body><div id="app"><p class="pad muted">Loading the diagrams...</p></div>' +
    `<script nonce="${nonce}">const MERMAID_PATH = ${JSON.stringify(mermaidPath)};${SCRIPT}</script></body></html>`
  );
}
