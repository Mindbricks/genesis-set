// The board's mail sink (#9389): an SMTP sink for the mail and SMS a generated service cannot
// deliver. The dialogue (AUTH PLAIN, AUTH LOGIN, none), the MIME reading (multipart, base64,
// quoted-printable, encoded-word subjects, HTML only), SMS detection, the codes found, storage and
// pruning, and the board's Mail API (list, read, clear with the write cookie only).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { after, afterEach, describe, test } from 'node:test';

import { closeBoard, ensureBoard } from '../mcp/board.mjs';
import { MAX_MESSAGES, closeMailSink, codesIn, decodeHeader, ensureMailSink, listMail, mailDir, parseMessage, readMail } from '../mcp/mail-sink.mjs';
import { ensureProject } from '../mcp/project.mjs';
import { cleanup, tempDir } from './helpers.mjs';

after(cleanup);

let portBase = 43000 + Math.floor(Math.random() * 1500) * 10;
function envFor() {
  const home = tempDir();
  portBase += 30;
  return { HOME: home, USERPROFILE: home, GENESIS_SET_HOME: path.join(home, '.genesis-set'), GENESIS_BOARD_PORT: String(portBase), GENESIS_MAILSINK_PORT: String(portBase + 15) };
}

/** A tiny SMTP client: sends `lines` one by one, waiting for each answer; answers the replies. */
function smtp(port, lines) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    const replies = [];
    let buf = '';
    let i = -1;
    s.setEncoding('utf8');
    s.on('data', (c) => {
      buf += c;
      // A reply ends with a line whose 4th character is a space (not "-").
      while (/(^|\r\n)\d{3} [^\r\n]*\r\n$/.test(buf)) {
        const reply = buf.trim();
        replies.push(reply);
        buf = '';
        i++;
        if (i >= lines.length) {
          s.end();
          return;
        }
        if (reply.startsWith('354')) {
          // The message body gets no reply per line: send it whole, up to the lone ".".
          const end = lines.indexOf('.', i);
          s.write(`${lines.slice(i, end + 1).join('\r\n')}\r\n`);
          i = end;
        } else s.write(`${lines[i]}\r\n`);
      }
    });
    s.on('end', () => resolve(replies));
    s.on('error', reject);
  });
}

const b64 = (s) => Buffer.from(s).toString('base64');

describe('MIME reading', () => {
  test('multipart with base64 and quoted-printable parts, an encoded subject, and the codes', () => {
    const raw = [
      'From: Cafe <no-reply@cafe.test>',
      'To: ada@example.test',
      `Subject: =?UTF-8?B?${b64('Doğrulama kodunuz')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Kodunuz: 482913 =C3=A7ok gizli',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64('<p>Kodunuz: <b>482913</b></p>'),
      '--b1--',
    ].join('\r\n');
    const m = parseMessage(raw);
    assert.equal(m.subject, 'Doğrulama kodunuz');
    assert.equal(m.text, 'Kodunuz: 482913 çok gizli');
    assert.equal(m.hasHtml, true);
    assert.deepEqual(m.codes, ['482913']);
    assert.equal(m.kind, 'mail');
  });

  test('an HTML-only mail is shown as text; an SMS through the sink is an SMS', () => {
    const html = parseMessage('Subject: Reset\r\nContent-Type: text/html\r\n\r\n<p>Open <a href="https://x.test/r?t=1">this link</a></p><script>x()</script>');
    assert.equal(html.text, 'Open this link (https://x.test/r?t=1)');
    const sms = parseMessage('Subject: SMS to +905551112233\r\n\r\nYour code is 1234', { to: ['sms-905551112233@sms-sink.invalid'] });
    assert.equal(sms.kind, 'sms');
    assert.deepEqual(sms.codes, ['1234']);
    assert.equal(decodeHeader('=?utf-8?Q?Merhaba_d=C3=BCnya?='), 'Merhaba dünya');
    assert.deepEqual(codesIn('order #123456 and 2026-11-21, code 9876'), ['9876']);
  });
});

describe('the SMTP sink', () => {
  afterEach(() => closeMailSink());

  test('accepts AUTH PLAIN, AUTH LOGIN or no auth, refuses STARTTLS, and stores each message under the project', async () => {
    const env = envFor();
    const project = ensureProject(tempDir(), { name: 'cafe' }).project;
    const sink = await ensureMailSink({ env, project });
    assert.equal(sink.host, '127.0.0.1');
    const msg = (to, subject) => [`MAIL FROM:<no-reply@cafe.test>`, `RCPT TO:<${to}>`, 'DATA', `Subject: ${subject}`, '', 'Your code is 777111', '..starts with a dot', '.', 'QUIT'];
    const plain = await smtp(sink.port, ['EHLO test', `AUTH PLAIN ${b64('\0cafe\0ignored')}`, ...msg('ada@example.test', 'One')]);
    assert.match(plain[0], /^220 /);
    assert.match(plain[1], /AUTH PLAIN LOGIN/);
    assert.match(plain[2], /^235 /);
    assert.ok(plain.some((r) => /^250 stored/.test(r)));
    await smtp(sink.port, ['EHLO test', 'AUTH LOGIN', b64('cafe'), b64('ignored'), ...msg('bob@example.test', 'Two')]);
    await smtp(sink.port, ['HELO test', ...msg('sms-905551112233@sms-sink.invalid', 'SMS to +905551112233')]);
    const tls = await smtp(sink.port, ['EHLO test', 'STARTTLS', 'QUIT']);
    assert.match(tls[2], /^502 /);
    const list = listMail(env, project.id);
    assert.deepEqual(list.map((m) => m.subject), ['SMS to +905551112233', 'Two', 'One']);
    assert.equal(list[0].kind, 'sms');
    const one = readMail(env, project.id, list[2].id);
    assert.equal(one.text, 'Your code is 777111\r\n.starts with a dot');
    assert.deepEqual(one.codes, ['777111']);
    assert.ok(mailDir(env, project.id).startsWith(env.GENESIS_SET_HOME));
    assert.equal(readMail(env, project.id, '../../config'), null);
  });

  test(`keeps only the newest ${MAX_MESSAGES} messages`, async () => {
    const env = envFor();
    const project = ensureProject(tempDir(), { name: 'cafe' }).project;
    const sink = await ensureMailSink({ env, project });
    const lines = ['HELO test'];
    for (let i = 0; i < MAX_MESSAGES + 5; i++) lines.push('MAIL FROM:<a@b.test>', 'RCPT TO:<c@d.test>', 'DATA', `Subject: m${i}`, '', 'x', '.');
    lines.push('QUIT');
    await smtp(sink.port, lines);
    const list = listMail(env, project.id);
    assert.equal(list.length, MAX_MESSAGES);
    assert.equal(list[0].subject, `m${MAX_MESSAGES + 4}`);
    assert.equal(fs.readdirSync(mailDir(env, project.id)).length, MAX_MESSAGES);
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

describe('the board and its mail sink', () => {
  afterEach(() => closeBoard());

  test('the board starts the sink, lists and reads its mail, clears it only with the write cookie; the sink closes with the board', async () => {
    const env = envFor();
    const project = ensureProject(tempDir(), { name: 'cafe' }).project;
    const b = await ensureBoard({ env, project });
    assert.equal(b.mailSink.port, Number(env.GENESIS_MAILSINK_PORT));
    await smtp(b.mailSink.port, ['HELO t', 'MAIL FROM:<a@b.test>', 'RCPT TO:<ada@example.test>', 'DATA', 'Subject: Welcome', '', 'Code 5150', '.', 'QUIT']);
    const state = (await req(b.port, { pathName: '/api/state' })).json();
    assert.deepEqual(state.mail.sink, b.mailSink);
    assert.equal(state.mail.count, 1);
    const id = state.mail.messages[0].id;
    assert.equal((await req(b.port, { pathName: `/api/mail/${id}` })).json().message.text, 'Code 5150');
    const origin = { origin: `http://127.0.0.1:${b.port}` };
    assert.equal((await req(b.port, { method: 'DELETE', pathName: '/api/mail', headers: origin })).status, 403);
    const t = new URL(b.url).searchParams.get('t');
    const cookie = (await req(b.port, { pathName: `/?t=${t}` })).headers['set-cookie'][0].split(';')[0];
    assert.equal((await req(b.port, { method: 'DELETE', pathName: '/api/mail', headers: { ...origin, cookie } })).status, 200);
    assert.equal((await req(b.port, { pathName: '/api/state' })).json().mail.count, 0);
    await closeBoard();
    await assert.rejects(smtp(b.mailSink.port, ['QUIT']));
  });
});
