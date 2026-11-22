// The board's view of the mail sink (#9392, epic #9384).
//
// A generated service with no complete email provider sends its mail
// (verification codes, password resets, notifications), and an SMS with no SMS
// provider as a mail to `sms-<digits>@sms-sink.invalid`, to its mail sink
// (MAILSINK_HOST:MAILSINK_PORT, default mail-sink:465). The sink is
// infrastructure like Kafka or Postgres: the generated docker-compose stack runs
// one (Mailpit), and for a service run natively the agent starts one. genesis-set
// runs no sink of its own: the board reads the sink's HTTP API (Mailpit,
// default http://127.0.0.1:8025, GENESIS_MAILPIT_URL moves it) and, when none
// answers, tells the user how to start one.

export const DEFAULT_MAILPIT_URL = 'http://127.0.0.1:8025';
/** The image the generated compose stack runs (src/genesis-api/deploy-artifacts/docker-compose.ts). */
export const MAILPIT_IMAGE = 'axllent/mailpit:v1.33.1';
const TIMEOUT_MS = 2500;
const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

/** The sink's API base: GENESIS_MAILPIT_URL or the default, an http(s) URL without a trailing slash. */
export function mailpitUrl(env = process.env) {
  const raw = String(env.GENESIS_MAILPIT_URL ?? '').trim() || DEFAULT_MAILPIT_URL;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return DEFAULT_MAILPIT_URL;
    return u.href.replace(/\/+$/, '');
  } catch {
    return DEFAULT_MAILPIT_URL;
  }
}

/** How to start a sink for services run natively: the compose stack's image, its SMTP on host port 10465. */
export function startCommand() {
  return (
    `docker run -d --name mail-sink -p 8025:8025 -p 10465:465 ` +
    '-e MP_SMTP_BIND_ADDR=0.0.0.0:465 -e MP_SMTP_AUTH_ACCEPT_ANY=true -e MP_SMTP_AUTH_ALLOW_INSECURE=true ' +
    MAILPIT_IMAGE
  );
}
export const NATIVE_SERVICE_ENV = { MAILSINK_HOST: '127.0.0.1', MAILSINK_PORT: '10465' };

/** Codes a person would copy out of a mail: 4 to 8 digits standing alone (not part of a date, time or number). */
export function codesIn(text) {
  return [...new Set(String(text ?? '').match(/(?<![\d#\-/:.])\b\d{4,8}\b(?![\d\-/:.])/g) ?? [])].slice(0, 5);
}

const addressesOf = (list) => (Array.isArray(list) ? list : []).map((a) => (a && typeof a === 'object' ? a.Address || a.Name || '' : String(a))).filter(Boolean);
const fromOf = (f) => (f && typeof f === 'object' ? (f.Name ? `${f.Name} <${f.Address}>` : f.Address || '') : '');

/** An SMS the services sent through the sink: addressed to sms-<digits>@sms-sink.invalid, or titled "SMS to ...". */
export function isSms(to, subject) {
  return to.some((t) => /^sms-[^@]*@sms-sink\.invalid$/i.test(t)) || /^SMS to\b/.test(String(subject ?? ''));
}

async function call(env, path, init = {}) {
  const res = await fetch(`${mailpitUrl(env)}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  if (!res.ok) throw new Error(`the mail sink answered ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/**
 * The sink's messages, newest first: `{ available, url, total, messages }`, or
 * `{ available: false, url, error, start }` when nothing answers there.
 */
export async function listMail(env = process.env, limit = 100) {
  const url = mailpitUrl(env);
  try {
    const d = await call(env, `/api/v1/messages?limit=${limit}`);
    const messages = (Array.isArray(d.messages) ? d.messages : []).map((m) => {
      const to = addressesOf(m.To);
      return {
        id: String(m.ID),
        receivedAt: m.Created ?? null,
        from: fromOf(m.From),
        to,
        subject: m.Subject ?? '',
        kind: isSms(to, m.Subject) ? 'sms' : 'mail',
        codes: codesIn(`${m.Subject ?? ''}\n${m.Snippet ?? ''}`),
      };
    });
    return { available: true, url, total: Number(d.total ?? d.messages_count ?? messages.length), messages };
  } catch (e) {
    return { available: false, url, error: e?.name === 'TimeoutError' ? 'no answer' : (e?.cause?.code ?? e?.message ?? String(e)), start: { command: startCommand(), env: NATIVE_SERVICE_ENV } };
  }
}

/** One message with its text (Mailpit's text part, or its text rendering of the HTML). */
export async function readMail(env, id) {
  if (!ID_PATTERN.test(String(id))) return null;
  try {
    const m = await call(env, `/api/v1/message/${encodeURIComponent(id)}`);
    const to = addressesOf(m.To);
    const text = String(m.Text ?? '');
    return {
      id: String(m.ID ?? id),
      receivedAt: m.Date ?? null,
      from: fromOf(m.From),
      to,
      subject: m.Subject ?? '',
      kind: isSms(to, m.Subject) ? 'sms' : 'mail',
      text: text.slice(0, 200_000),
      hasHtml: Boolean(m.HTML),
      codes: codesIn(`${m.Subject ?? ''}\n${text}`),
    };
  } catch {
    return null;
  }
}

/** Deletes every message in the sink. */
export async function clearMail(env) {
  await call(env, '/api/v1/messages', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' });
}
