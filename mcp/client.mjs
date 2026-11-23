// The Genesis Compiler API client of the genesis-set MCP server: one HTTPS call
// per tool call, the API key as a bearer token, and every answer reduced to
// `{ ok, httpStatus, body }` where a failure body is always in the Genesis error
// shape `{ error: { code, message, details? } }`. A Genesis error from the
// server passes through unchanged; a failure that never reached the API (no
// key, network, a non-JSON answer) is written in the same shape by this client.

import { API_PATH, missingKeyMessage } from './config.mjs';

/** A Genesis error body. */
export function genesisError(code, message, details) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function localFailure(code, message, details) {
  return { ok: false, httpStatus: null, body: genesisError(code, message, details) };
}

const RETRYABLE_NETWORK = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET']);

function networkCode(err) {
  return err?.cause?.code ?? err?.code ?? null;
}

function isGenesisErrorBody(v) {
  return Boolean(v && typeof v === 'object' && v.error && typeof v.error === 'object' && typeof v.error.code === 'string');
}

function authHint(status, configFile) {
  if (status === 401) {
    return (
      'The Genesis API did not accept the API key. Check the key in the Genesis portal and set the right one ' +
      `(GENESIS_API_KEY, or "genesis config set-key", which writes ${configFile}).`
    );
  }
  if (status === 403) return 'This key is not allowed to call the Genesis Compiler API (a user API key is needed).';
  return undefined;
}

/**
 * Calls `{apiBase}/genesis/compiler/v1{path}`. `settings` comes from
 * resolveSettings(); `opts`: { method, query, body, headers, signal, retry }.
 * Never throws.
 */
export async function callGenesis(settings, path, opts = {}) {
  if (!settings.apiKey) return localFailure('GENESIS_API_KEY_MISSING', missingKeyMessage(settings.configFile, settings.apiBase));
  if (!settings.apiBase) {
    return localFailure('GENESIS_BAD_API_BASE', `The Genesis API base is not usable: ${settings.problems.join('; ')}. Nothing was sent.`);
  }
  const url = new URL(`${settings.apiBase}${API_PATH}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const method = opts.method ?? 'GET';
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${settings.apiKey}`,
    'user-agent': settings.userAgent ?? 'genesis-set-mcp',
    ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(opts.headers ?? {}),
  };
  const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const attempts = opts.retry === false ? 1 : 2;
  let res;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const signals = [AbortSignal.timeout(settings.timeoutMs)];
    if (opts.signal) signals.push(opts.signal);
    const signal = signals.length === 1 ? signals[0] : anySignal(signals);
    try {
      res = await fetch(url, { method, headers, body: payload, signal, redirect: 'manual' });
      break;
    } catch (err) {
      if (opts.signal?.aborted) return localFailure('GENESIS_CANCELLED', 'The call was cancelled');
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        return localFailure('GENESIS_TIMEOUT', `The Genesis API did not answer within ${settings.timeoutMs} ms (${url.origin})`);
      }
      const code = networkCode(err);
      if (attempt < attempts && RETRYABLE_NETWORK.has(code)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return localFailure(
        'GENESIS_UNREACHABLE',
        `The Genesis API at ${settings.apiBase} could not be reached (${code ?? err?.message ?? 'network error'}). ` +
          'Check the network and the API base; do not report a validation or build that did not happen.',
        { apiBase: settings.apiBase },
      );
    }
  }
  const text = await res.text().catch(() => '');
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (res.status >= 300 && res.status < 400) {
    return {
      ok: false,
      httpStatus: res.status,
      body: genesisError('GENESIS_BAD_RESPONSE', `The API base ${settings.apiBase} answered a redirect; set the final https address as the API base`, {
        location: res.headers.get('location'),
      }),
    };
  }
  if (res.ok) {
    if (json && typeof json === 'object') return { ok: true, httpStatus: res.status, body: json };
    return {
      ok: false,
      httpStatus: res.status,
      body: genesisError('GENESIS_BAD_RESPONSE', `The Genesis API answered ${res.status} without a JSON body`, { snippet: text.slice(0, 200) }),
    };
  }
  if (isGenesisErrorBody(json)) {
    const hint = authHint(res.status, settings.configFile);
    return { ok: false, httpStatus: res.status, body: hint ? { ...json, hint } : json };
  }
  return {
    ok: false,
    httpStatus: res.status,
    body: genesisError(
      'GENESIS_BAD_RESPONSE',
      `${url.origin} answered ${res.status} without a Genesis error body; check the API base (${settings.apiBase})`,
      { snippet: text.slice(0, 200) },
    ),
  };
}

/** AbortSignal.any for Node 18 / 20.0-20.2, which lack it. */
function anySignal(signals) {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const ctl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctl.abort(s.reason), { once: true });
  }
  return ctl.signal;
}

/**
 * Downloads a build archive. `auth: "bearer"` means `url` is a path below the
 * Genesis API base and the API key goes with it; `auth: "none"` means `url` is
 * a presigned link (https, or http to localhost) that takes no credential, so
 * the key is never sent there. Answers `{ ok: true, bytes }` or a local failure.
 */
export async function downloadGenesis(settings, url, { auth, maxBytes, signal } = {}) {
  let target;
  const headers = { 'user-agent': settings.userAgent ?? 'genesis-set-mcp' };
  if (auth === 'bearer') {
    if (!settings.apiKey) return localFailure('GENESIS_API_KEY_MISSING', missingKeyMessage(settings.configFile, settings.apiBase));
    if (typeof url !== 'string' || !url.startsWith('/')) return localFailure('GENESIS_BAD_RESPONSE', 'The archive link is not a path below the API base');
    target = new URL(`${settings.apiBase}${API_PATH}${url}`);
    headers.authorization = `Bearer ${settings.apiKey}`;
  } else if (auth === 'none') {
    try {
      target = new URL(url);
    } catch {
      return localFailure('GENESIS_BAD_RESPONSE', 'The archive link is not a URL');
    }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && local)) {
      return localFailure('GENESIS_BAD_RESPONSE', 'The archive link is not https; nothing was downloaded');
    }
  } else {
    return localFailure('GENESIS_BAD_RESPONSE', `Unknown archive link auth "${auth}"`);
  }
  const signals = [AbortSignal.timeout(Math.max(settings.timeoutMs ?? 0, 300000))];
  if (signal) signals.push(signal);
  let res;
  try {
    res = await fetch(target, { headers, signal: signals.length === 1 ? signals[0] : anySignal(signals), redirect: 'error' });
  } catch (err) {
    return localFailure('GENESIS_UNREACHABLE', `The archive could not be downloaded (${networkCode(err) ?? err?.message ?? 'network error'})`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (isGenesisErrorBody(json)) return { ok: false, httpStatus: res.status, body: json };
    return { ok: false, httpStatus: res.status, body: genesisError('GENESIS_ARCHIVE_DOWNLOAD_FAILED', `The archive download answered ${res.status}`) };
  }
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (maxBytes && declared > maxBytes) return localFailure('GENESIS_ARCHIVE_TOO_LARGE', `The archive is ${declared} bytes, over the ${maxBytes} limit`);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (maxBytes && total > maxBytes) return localFailure('GENESIS_ARCHIVE_TOO_LARGE', `The archive is over the ${maxBytes} byte limit`);
    chunks.push(Buffer.from(chunk));
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}
