#!/usr/bin/env node
// Agent-facing CLI. Talks to the session server through files so it works inside agent sandboxes.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendLine, newSessionDir, paths, readIf, readJson, resolveSession, homeDir, writeJsonAtomic } from './lib/session.mjs';
import { compact, loadProtocol, validateProtocol } from './lib/protocol.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv.shift();
const opts = {}, rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; opts[k] = v; } else rest.push(argv[i]);
}
const out = v => console.log(JSON.stringify(v));
const die = (m, code = 1) => { console.log(JSON.stringify({ ok: false, error: m })); process.exit(code); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// EPERM means it exists and belongs to someone we may not signal, which a sandbox can make of our own server.
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

async function start() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) die(`需要 Node 18 以上，当前 ${process.version}`);
  const resume = !!opts.session;
  const dir = resume ? DIR() : newSessionDir();
  const P = paths(dir);
  if (resume) {
    const was = readJson(P.meta);
    if (was?.pid && !was.stoppedAt && alive(was.pid)) return out({ ok: true, session: dir, url: was.url, voice: was.voice, available: was.available, running: true });
    writeFileSync(join(homeDir(), 'current'), dir);
  }
  const child = spawn(process.execPath, [join(HERE, 'server.mjs'), dir, JSON.stringify({ voice: opts.voice || (resume ? null : 'auto'), voiceName: opts['voice-name'], name: opts.name, port: opts.port, resume })], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 120; i++) {
    await sleep(100);
    const m = readJson(P.meta);
    if (m?.url && m.pid === child.pid) {
      let opened = false;
      if (!opts['no-open']) {
        const opener = process.platform === 'darwin' ? ['open', [m.url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', m.url]] : ['xdg-open', [m.url]];
        opened = spawnSync(opener[0], opener[1], { stdio: 'ignore', timeout: 8000 }).status === 0;
      }
      return out({ ok: true, session: dir, url: m.url, voice: m.voice, available: m.available, opened, next: `已展开界面。现在进入循环：node ${join(HERE, 'ror.mjs')} wait` });
    }
    if (child.exitCode != null) break;
  }
  die('服务没有启动。如果在 Codex 沙箱里，端口绑定可能被拒绝：请申请提权运行本命令，或让用户在终端运行它。', 2);
}

const DIR = () => { try { return resolveSession(opts.session); } catch (e) { return die(e.message); } };

async function wait() {
  // The person can delete the whole record at any moment, including between two calls of this.
  const named = opts.session || process.env.RORSCHACH_SESSION || readIf(join(homeDir(), 'current'))?.trim();
  if (named && !existsSync(named)) return out({ ended: true, deleted: true });
  const dir = DIR(), P = paths(dir);
  const timeout = Number(opts.timeout || 45) * 1000;
  const t0 = Date.now();
  let pos = Number(readIf(P.cursor) || 0);
  const read = () => {
    try {
      if (!existsSync(P.events)) return [];
      const size = statSync(P.events).size;
      if (size <= pos) return [];
      const fd = openSync(P.events, 'r');
      const buf = Buffer.alloc(size - pos);
      readSync(fd, buf, 0, buf.length, pos);
      closeSync(fd);
      const end = buf.lastIndexOf(10);
      if (end < 0) return [];
      pos += end + 1;
      return buf.subarray(0, end).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  };
  const remember = () => { try { writeFileSync(P.cursor, String(pos)); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
  const events = [];
  while (Date.now() - t0 < timeout) {
    events.push(...read());
    if (events.length) {
      // Let a burst settle so one turn gets the whole thought.
      await sleep(350);
      events.push(...read());
      break;
    }
    await sleep(120);
    if (!existsSync(dir)) return out({ ended: true, deleted: true });
    const meta = readJson(P.meta);
    if (meta?.stoppedAt || (meta?.pid && !alive(meta.pid))) { remember(); return out({ ended: true }); }
  }
  remember();
  const s = readJson(P.state) || {};
  const heldFor = events.length ? null : Math.round((Date.now() - t0) / 1000);
  out({ events, phase: s.phase, card: s.card, focus: s.focus, responses: (s.responses || []).length, paused: s.paused, ...(heldFor != null ? { idleSeconds: heldFor } : {}) });
}

async function send(name, args, wait_ = 20000) {
  const dir = DIR(), P = paths(dir);
  const meta = readJson(P.meta);
  if (!meta?.pid || !alive(meta.pid)) die('服务已停止');
  const id = randomBytes(6).toString('hex');
  appendLine(P.inbox, { id, cmd: name, args });
  const t0 = Date.now();
  while (Date.now() - t0 < wait_) {
    await sleep(60);
    if (!existsSync(P.replies)) continue;
    const text = readFileSync(P.replies, 'utf8');
    for (const line of text.split('\n').reverse()) {
      if (!line.includes(id)) continue;
      const r = JSON.parse(line);
      if (!r.ok) die(r.error);
      out(r.result ?? {});
      if (r.result && r.result.ok === false) process.exit(1);
      return;
    }
  }
  die('服务没有回应');
}

// Reads files directly, so the record stays reachable after the server has stopped.
function data() {
  const p = loadProtocol(DIR());
  const v = opts.full ? p : compact(p);
  if (opts.response) { const r = v.cards.flatMap(c => c.responses).find(x => x.id === opts.response); return r ? out(r) : die(`找不到回应 ${opts.response}`); }
  if (opts.card) { const c = v.cards[Number(opts.card) - 1]; return c ? out(c) : die(`没有第 ${opts.card} 张`); }
  return out(v);
}
function exportProtocol() {
  const dir = DIR();
  const p = loadProtocol(dir, { withTrace: !!opts['with-trace'] });
  const errors = validateProtocol(p);
  if (errors.length) { out({ ok: false, errors }); process.exit(1); }
  const file = resolvePath(opts.out || paths(dir).protocol);
  writeJsonAtomic(file, p);
  out({ ok: true, file, bytes: statSync(file).size, cards: 10, responses: p.integrity.responses, strokes: p.integrity.strokes, status: p.session.status });
}
function validateFile() {
  const f = rest[0] || opts.file;
  if (!f) die('用法：validate <protocol.json>');
  const p = readJson(resolvePath(f));
  if (!p) die(`读不了 ${f}`);
  const errors = validateProtocol(p);
  out({ ok: !errors.length, errors });
  if (errors.length) process.exit(1);
}

const fileArg = () => { const f = opts.file || rest[0]; if (!f) die('缺少 --file'); return resolvePath(f); };
switch (cmd) {
  case 'start': await start(); break;
  case 'wait': await wait(); break;
  case 'say': await send('say', { text: rest.join(' ') || opts.text }); break;
  case 'phase': await send('phase', { name: rest[0] }); break;
  case 'resume': await send('resume', {}); break;
  case 'pause': await send('pause', { phrases: opts.phrases }); break;
  case 'next': await send('next', {}); break;
  case 'question': await send('question', { text: rest.join(' ') }); break;
  case 'name': await send('name', { text: rest.join(' ') }); break;
  case 'record': await send('record', { phrases: opts.phrases, label: opts.label, card: opts.card, clean: opts.clean, id: opts.id, plate: !!opts.plate }); break;
  case 'drop': await send('drop', { id: rest[0] || opts.id }); break;
  case 'assign': await send('assign', { stroke: opts.stroke, response: opts.response }); break;
  case 'data': data(); break;
  case 'export': exportProtocol(); break;
  case 'validate': validateFile(); break;
  case 'inquire': await send('inquire', { id: rest[0] || opts.id, line: opts.line, advance: !!opts.next }); break;
  case 'mark': await send('mark', { card: opts.card, region: opts.region, box: opts.box, label: opts.label }); break;
  case 'unmark': await send('unmark', { card: opts.card }); break;
  case 'choice': await send('choice', { question: opts.question, card: opts.card, next: !!opts.next, skip: !!opts.skip }); break;
  case 'progress': await send('progress', { text: rest.join(' ') }); break;
  case 'heard': await send('heard', { text: rest.join(' ') }); break;
  case 'code': await send('code', { file: fileArg() }); break;
  case 'signals': await send('signals', {}); break;
  case 'report': await send('report', { file: fileArg() }); break;
  case 'status': await send('status', {}); break;
  case 'stop': await send('stop', {}); break;
  case 'home': out({ home: homeDir() }); break;
  default:
    die('用法：start | wait | say | phase | next | record | drop | assign | inquire | mark | unmark | choice | progress | question | name | heard | code | report | data | export | validate | resume | status | stop');
}
