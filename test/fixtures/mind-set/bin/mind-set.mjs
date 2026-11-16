#!/usr/bin/env node
// A stand-in for the mind-set CLI in the genesis-set tests: `install` and
// `update` write a manifest, a corpus and one skill with the mind-set marker
// for the agents named (--claude / --codex), the way mind-set lays them out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const [command, ...flags] = process.argv.slice(2);
const home = process.env.HOME;
const data = process.env.MIND_SET_HOME || path.join(home, '.mind-set');
if (command !== 'install' && command !== 'update') {
  process.stderr.write(`fake mind-set: unsupported ${command}\n`);
  process.exit(2);
}
const dry = flags.includes('--dry-run');
const dirs = { claude: path.join(home, '.claude', 'skills'), codex: path.join(home, '.agents', 'skills') };
const agents = flags.filter((f) => f === '--claude' || f === '--codex').map((f) => f.slice(2));
process.stdout.write(`fake mind-set ${version} ${command} ${agents.join(',')}${dry ? ' (dry run)' : ''}\n`);
if (dry) process.exit(0);
const corpus = path.join(data, version);
fs.mkdirSync(corpus, { recursive: true });
fs.mkdirSync(path.join(corpus, 'procedures'), { recursive: true });
fs.writeFileSync(path.join(corpus, 'procedures', 'specs.md'), '# specs\n');
fs.writeFileSync(path.join(corpus, 'openappl.json'), '{"__patternsVersion":"9.9.9-test"}\n');
fs.rmSync(path.join(data, 'current'), { recursive: true, force: true });
fs.symlinkSync(corpus, path.join(data, 'current'), process.platform === 'win32' ? 'junction' : 'dir');
let manifest = { package: 'mind-set', agents: {} };
try {
  manifest = JSON.parse(fs.readFileSync(path.join(data, 'installed.json'), 'utf8'));
} catch {
  // first install
}
manifest.version = version;
manifest.corpus = corpus;
for (const a of agents) {
  const skill = path.join(dirs[a], 'openappl-demo');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '# demo\n');
  fs.writeFileSync(path.join(skill, '.mind-set.json'), JSON.stringify({ package: 'mind-set', version, corpus }));
  manifest.agents[a] = { skillsDir: dirs[a], corpus, version, skills: ['openappl-demo'] };
}
fs.writeFileSync(path.join(data, 'installed.json'), `${JSON.stringify(manifest, null, 2)}\n`);
