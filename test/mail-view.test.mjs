// The board reads the mail sink (#9392): Mailpit's API, the shapes taken from a real Mailpit
// (axllent/mailpit:v1.33.1). Listing (newest first, SMS labelled, codes picked out), reading a
// message, clearing (with the board's write cookie only), and the guidance when no sink answers.
// genesis-set itself runs no SMTP listener.

import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { after, afterEach, before, describe, test } from 'node:test';

import { closeBoard, ensureBoard } from '../mcp/board.mjs';
import { MAILPIT_IMAGE, codesIn, isSms, listMail, mailpitUrl, readMail, startCommand } from '../mcp/mail-view.mjs';
import { ensureProject } from '../mcp/project.mjs';
import { cleanup, tempDir } from './helpers.mjs';

after(cleanup);

// ── a stub Mailpit ──────────────────────────────────────────────────

const MESSAGES = [
  {
    ID: 'aXwSmsMessage01',
    From: { Name: '', Address: 'no-reply@cafe.test' },
    To: [{ Name: '', Address: 'sms-905551112233@sms-sink.invalid' }],
    Subject: 'SMS to +905551112233',
    Created: '2026-11-22T02:12:03.250Z',
    Snippet: 'Cafe: kodunuz 7731',
  },
  {
    ID: 'aXwMailMessage2',
    From: { Name: 'Cafe', Address: 'no-reply@cafe.test' },
    To: null,
    Subject: 'Doğrulama kodu',
    Created: '2026-11-22T02:12:03.261Z',
    Snippet: 'Kodunuz: 482913 (2026-11-22)',
  },
];
const FULL = {
  aXwMailMessage2: { ID: 'aXwMailMessage2', From: MESSAGES[1].From, To: null, Subject: 'Doğrulama kodu', Date: '2026-11-22T02:12:03Z', Text: 'Kodunuz: *482913*', HTML: '<p>Kodunuz: <b>482913</b></p>' },
};

let stub;
let deletes = 0;
let messages = [...MESSAGES];
before(async () => {
  stub = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url.startsWith('/api/v1/messages')) return send(200, { total: messages.length, count: messages.length, messages });
    if (req.method === 'GET' && req.url.startsWith('/api/v1/message/')) {
      const m = FULL[decodeURIComponent(req.url.slice('/api/v1/message/'.length))];
      return m ? send(200, m) : send(404, {});
    }
    if (req.method === 'DELETE' && req.url === '/api/v1/messages') {
      deletes++;
      messages = [];
      return send(200, {});
    }
    return send(404, {});
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
});
after(() => new Promise((r) => stub.close(r)));
afterEach(() => {
  messages = [...MESSAGES];
});

const stubEnv = () => ({ GENESIS_MAILPIT_URL: `http://127.0.0.1:${stub.address().port}/` });
async function freePort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

describe('the mail view', () => {
  test('lists the sink newest first as the sink orders them: SMS labelled, codes picked out, dates skipped', async () => {
    const m = await listMail(stubEnv());
    assert.equal(m.available, true);
    assert.equal(m.url, `http://127.0.0.1:${stub.address().port}`);
    assert.deepEqual(m.messages.map((x) => [x.id, x.kind, x.codes]), [
      ['aXwSmsMessage01', 'sms', ['7731']],
      ['aXwMailMessage2', 'mail', ['482913']],
    ]);
    assert.deepEqual(m.messages[0].to, ['sms-905551112233@sms-sink.invalid']);
    assert.deepEqual(m.messages[1].to, []);
    assert.equal(m.messages[1].from, 'Cafe <no-reply@cafe.test>');
  });

  test('reads one message with its text; a bad id or an unknown one answers null', async () => {
    const msg = await readMail(stubEnv(), 'aXwMailMessage2');
    assert.equal(msg.text, 'Kodunuz: *482913*');
    assert.equal(msg.hasHtml, true);
    assert.deepEqual(msg.codes, ['482913']);
    assert.equal(await readMail(stubEnv(), '../../etc'), null);
    assert.equal(await readMail(stubEnv(), 'unknownMessage9'), null);
  });

  test('no sink: unavailable, with the command that starts the compose stack\'s Mailpit on host port 10465', async () => {
    const m = await listMail({ GENESIS_MAILPIT_URL: `http://127.0.0.1:${await freePort()}` });
    assert.equal(m.available, false);
    assert.match(m.start.command, new RegExp(`-p 10465:465 .*${MAILPIT_IMAGE.replace(/[.]/g, '\\.')}$`));
    assert.match(startCommand(), /MP_SMTP_AUTH_ACCEPT_ANY=true/);
    assert.deepEqual(m.start.env, { MAILSINK_HOST: '127.0.0.1', MAILSINK_PORT: '10465' });
  });

  test('the sink URL: GENESIS_MAILPIT_URL when it is an http(s) URL, else the default', () => {
    assert.equal(mailpitUrl({}), 'http://127.0.0.1:8025');
    assert.equal(mailpitUrl({ GENESIS_MAILPIT_URL: 'http://localhost:18025/' }), 'http://localhost:18025');
    assert.equal(mailpitUrl({ GENESIS_MAILPIT_URL: 'file:///etc/passwd' }), 'http://127.0.0.1:8025');
    assert.equal(mailpitUrl({ GENESIS_MAILPIT_URL: 'not a url' }), 'http://127.0.0.1:8025');
    assert.equal(isSms([], 'SMS to +90'), true);
    assert.deepEqual(codesIn('build 1.2345.6 at 10:30, code 0042'), ['0042']);
  });
});

function req(port, { method = 'GET', pathName = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: pathName, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(text) }));
    });
    r.on('error', reject);
    r.end();
  });
}

describe('the board and the mail sink', () => {
  afterEach(() => closeBoard());

  test('the board shows the sink, reads a message, clears it only with the write cookie, and opens no SMTP port', async () => {
    const home = tempDir();
    const env = { HOME: home, USERPROFILE: home, GENESIS_SET_HOME: path.join(home, '.genesis-set'), GENESIS_BOARD_PORT: String(await freePort()), ...stubEnv() };
    const project = ensureProject(tempDir(), { name: 'cafe' }).project;
    const b = await ensureBoard({ env, project });
    assert.equal('mailSink' in b, false, 'the board runs no sink of its own');
    const state = (await req(b.port, { pathName: '/api/state' })).json();
    assert.equal(state.mail.available, true);
    assert.equal(state.mail.messages.length, 2);
    assert.equal((await req(b.port, { pathName: '/api/mail/aXwMailMessage2' })).json().message.codes[0], '482913');
    assert.equal((await req(b.port, { pathName: '/api/mail/unknownMessage9' })).status, 404);
    const origin = { origin: `http://127.0.0.1:${b.port}` };
    assert.equal((await req(b.port, { method: 'DELETE', pathName: '/api/mail', headers: origin })).status, 403);
    assert.equal(deletes, 0);
    const t = new URL(b.url).searchParams.get('t');
    const cookie = (await req(b.port, { pathName: `/?t=${t}` })).headers['set-cookie'][0].split(';')[0];
    assert.equal((await req(b.port, { method: 'DELETE', pathName: '/api/mail', headers: { ...origin, cookie } })).status, 200);
    assert.equal(deletes, 1);
    assert.equal((await req(b.port, { pathName: '/api/state' })).json().mail.messages.length, 0);
  });

  test('without a sink the board says how to start one', async () => {
    const home = tempDir();
    const env = { HOME: home, USERPROFILE: home, GENESIS_SET_HOME: path.join(home, '.genesis-set'), GENESIS_BOARD_PORT: String(await freePort()), GENESIS_MAILPIT_URL: `http://127.0.0.1:${await freePort()}` };
    const b = await ensureBoard({ env, project: ensureProject(tempDir(), { name: 'cafe' }).project });
    const state = (await req(b.port, { pathName: '/api/state' })).json();
    assert.equal(state.mail.available, false);
    assert.match(state.mail.start.command, /^docker run -d --name mail-sink/);
  });
});
