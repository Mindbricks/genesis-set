#!/usr/bin/env node
// The genesis-set MCP server: the Genesis Compiler API as genesis_* tools for a
// coding agent (Claude Code, Codex). MCP over stdio: one JSON-RPC 2.0 message
// per line on stdin / stdout, logs on stderr only. No dependencies besides
// Node >= 18.
//
// `genesis install` copies this folder to ~/.genesis-set/mcp/ and registers
// it with each installed agent; `genesis mcp` runs it from the package.
// The API key and the API base are resolved on every call (./config.mjs), so a
// key stored with `genesis config set-key` works without a restart.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveSettings } from './config.mjs';
import { closeKeyPage } from './key-page.mjs';
import { TOOLS, hasTool, runTool } from './tools.mjs';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const HERE = path.dirname(fileURLToPath(import.meta.url));

function serverVersion() {
  for (const p of [path.join(HERE, 'version.json'), path.join(HERE, '..', 'package.json')]) {
    try {
      const v = JSON.parse(fs.readFileSync(p, 'utf8')).version;
      if (typeof v === 'string') return v;
    } catch {
      // next candidate
    }
  }
  return '0.0.0';
}

const INSTRUCTIONS =
  'Tools for the Genesis Compiler API (builds are dry runs for now; when a call answers GENESIS_UNREACHABLE, the API could not be reached: say so and stop, never report a validation or build that did not happen). ' +
  'Validate the whole blueprint with genesis_validateApplication before any build; compile one service at a time with genesis_buildService and follow its jobId with genesis_getServiceBuild until a final status. ' +
  'Blueprint paths are read on this machine and sent inline. Every failure is a Genesis error { error: { code, message, details } }: report the code. ' +
  'Keys (the Genesis API key, provider secrets): never ask for a value in the chat. Register the key with genesis_requestKey, give the user the local key page link it answers, and check genesis_listKeys; ' +
  'genesis_writeKeyToEnvFile puts a stored key into a gitignored env file without you seeing it. ' +
  'The genesis-compiler-api skill has the full procedure.';

/**
 * Serves MCP on `input` / `output` (streams) until `input` ends. Resolves when
 * every pending call has answered. `env` and `cwd` are for tests.
 */
export function serve({ input = process.stdin, output = process.stdout, log = (l) => process.stderr.write(`${l}\n`), env = process.env, cwd = process.cwd() } = {}) {
  const version = serverVersion();
  const inflight = new Map();
  let buffer = '';
  let ended = false;
  let resolveDone;
  const done = new Promise((r) => {
    resolveDone = r;
  });

  const send = (msg) => output.write(`${JSON.stringify(msg)}\n`);
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message, data) => send({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
  const maybeFinish = () => {
    if (ended && inflight.size === 0) resolveDone();
  };

  async function handle(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      if (msg && typeof msg === 'object' && ('result' in msg || 'error' in msg)) return; // a response to nothing we sent
      fail(msg?.id ?? null, -32600, 'Invalid Request');
      return;
    }
    const isRequest = msg.id !== undefined && msg.id !== null;
    const params = msg.params ?? {};
    switch (msg.method) {
      case 'initialize': {
        const asked = params.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : SUPPORTED_PROTOCOL_VERSIONS[0];
        reply(msg.id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'genesis-set', title: 'Genesis Compiler API (genesis-set)', version },
          instructions: INSTRUCTIONS,
        });
        return;
      }
      case 'notifications/initialized':
        return;
      case 'notifications/cancelled': {
        inflight.get(params.requestId)?.abort();
        return;
      }
      case 'ping':
        if (isRequest) reply(msg.id, {});
        return;
      case 'tools/list':
        reply(msg.id, { tools: TOOLS });
        return;
      case 'tools/call': {
        const name = params.name;
        if (!hasTool(name)) {
          fail(msg.id, -32602, `Unknown tool: ${name}`);
          return;
        }
        const ctl = new AbortController();
        inflight.set(msg.id, ctl);
        try {
          const settings = { ...resolveSettings(env), env, cwd, userAgent: `genesis-set/${version} (mcp)` };
          for (const p of settings.problems) log(`genesis mcp: ${p}`);
          const result = await runTool(name, params.arguments, settings, ctl.signal);
          if (!ctl.signal.aborted) reply(msg.id, result);
        } finally {
          inflight.delete(msg.id);
          maybeFinish();
        }
        return;
      }
      default:
        if (isRequest) fail(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  const dispatch = (msg) => {
    handle(msg).catch((err) => {
      log(`genesis mcp: ${err?.stack ?? err}`);
      if (msg?.id !== undefined && msg?.id !== null) fail(msg.id, -32603, 'Internal error');
    });
  };

  input.setEncoding?.('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        fail(null, -32700, 'Parse error');
        continue;
      }
      if (Array.isArray(msg)) msg.forEach(dispatch);
      else dispatch(msg);
    }
  });
  input.on('end', () => {
    ended = true;
    maybeFinish();
  });
  // The key page lives only as long as this server.
  return done.then(() => closeKeyPage());
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(fs.realpathSync(process.argv[1])).href === pathToFileURL(fs.realpathSync(fileURLToPath(import.meta.url))).href;
  } catch {
    return false;
  }
}
// Exit only once stdout is flushed: on a pipe, process.exit drops what is not
// written yet, and the last answer before stdin closed would be cut.
if (isMain()) serve().then(() => process.stdout.write('', () => process.exit(0)));
