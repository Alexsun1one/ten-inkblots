// Voice through the user's own Codex login: a child `codex app-server` signals a WebRTC realtime
// session; audio then flows directly between the browser and the realtime backend.
// Verified on codex-cli 0.166 with ChatGPT auth: only version v3 over webrtc is accepted.
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

// Agents launched from a GUI inherit a minimal PATH, so a bare command name is not enough.
const COMMON_BINS = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
export const toolEnv = bin => ({ ...process.env, PATH: [...new Set([dirname(bin), dirname(process.execPath), ...(process.env.PATH || '').split(delimiter), ...COMMON_BINS].filter(Boolean))].join(delimiter) });
export function findBin(name, extras = []) {
  for (const dir of [...(process.env.PATH || '').split(delimiter), ...COMMON_BINS]) {
    if (!dir) continue;
    const f = join(dir, name);
    try { accessSync(f, constants.X_OK); if (statSync(f).isFile()) return f; } catch { /* keep looking */ }
  }
  for (const f of extras) { try { accessSync(f, constants.X_OK); if (statSync(f).isFile()) return f; } catch { /* keep looking */ } }
  return null;
}

export const ACTOR_RULES = `你只是罗夏墨迹测验施测者的声音，是一位配音员。绝对规则：不要主动开口。用户说话时保持沉默，什么都不要说，也不要说嗯。不要提问、评价、复述或解释。只有消息以「[照读]」开头时，才逐字念出其后的内容，一字不增不减，语气温和、缓慢、平静，念完立刻停止。不要移交任务。`;

export const TALK_RULES = `现在规则改变：测验已经结束，你可以自然地和用户交谈。说简短温暖的中文，一次一两句。只依据下面提供的报告内容回答，不要给诊断，不要贴标签。用户说想不开、想伤害自己时，先认真回应，问对方现在是否安全，并告知可以拨打全国心理援助热线 12356。`;

const CHILD_ARGS = ['app-server', '-c', 'mcp_servers={}', '-c', 'model_reasoning_effort="low"', '--disable', 'hooks', '--disable', 'plugins', '--disable', 'apps', '--disable', 'memories'];

export function codexAvailable() {
  const bin = process.env.RORSCHACH_CODEX_BIN || findBin('codex', ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', '/Applications/ChatGPT.app/Contents/Resources/codex', '/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex', '/Applications/Codex.app/Contents/Resources/codex']);
  if (!bin) return null;
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000, env: toolEnv(bin) });
  return r.status === 0 ? { bin, version: r.stdout.trim() } : null;
}

export class RealtimeBridge extends EventEmitter {
  constructor({ bin, cwd, log, reqTimeoutMs = 20000, sdpTimeoutMs = 25000 }) {
    super();
    Object.assign(this, { bin, cwd, log: log || (() => {}), reqTimeoutMs, sdpTimeoutMs, seq: 0, pending: new Map(), buf: '', threadId: null, child: null, booted: null, sdpWaiter: null, live: false, expectClose: false });
  }

  boot() {
    this.booted ??= this.spawnChild().catch(e => { this.booted = null; this.kill(); throw e; });
    return this.booted;
  }

  async spawnChild() {
    const child = this.child = spawn(this.bin, CHILD_ARGS, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: toolEnv(this.bin) });
    const gone = why => {
      // An old child's exit says nothing about the one that replaced it.
      if (this.child && this.child !== child) return false;
      this.child = null; this.live = false; this.threadId = null; this.booted = null; this.buf = '';
      this.failAll(new Error(why));
      return true;
    };
    child.on('exit', code => { if (gone(`app-server 退出（${code}）`)) this.emit('closed', `app-server exit ${code}`); });
    child.on('error', e => { if (gone(e.message)) this.emit('error', e.message); });
    child.stdin.on('error', () => {}); // a write racing the exit above; the exit handler reports it
    child.stderr.on('data', () => {});
    child.stdout.on('data', d => this.onData(d));
    await this.req('initialize', { clientInfo: { name: 'rorschach_skill', title: 'Rorschach', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  }

  // Nobody is left to answer: everything still waiting has to hear that now, not hang.
  failAll(err) {
    for (const p of this.pending.values()) p.rej(err);
    this.pending.clear();
    this.sdpWaiter?.rej(err);
    this.sdpWaiter = null;
  }

  req(method, params) {
    return new Promise((res, rej) => {
      if (!this.child) return rej(new Error('app-server 未运行'));
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(`${method} 超时`)); }, this.reqTimeoutMs);
      this.pending.set(id, { method, res: v => { clearTimeout(timer); res(v); }, rej: e => { clearTimeout(timer); rej(e); } });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  onData(chunk) {
    this.buf += chunk;
    let k;
    while ((k = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, k);
      this.buf = this.buf.slice(k + 1);
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id != null && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(`${p.method}: ${m.error.message || JSON.stringify(m.error)}`)) : p.res(m.result);
      } else if (m.id != null) {
        // The voice thread has no tools and no approvals to give; decline anything it asks.
        this.child?.stdin.write(JSON.stringify({ id: m.id, result: {} }) + '\n');
      } else if (m.method) this.onNotify(m.method, m.params || {});
    }
  }

  onNotify(method, p) {
    switch (method) {
      case 'thread/realtime/sdp': this.sdpWaiter?.res(p.sdp); this.sdpWaiter = null; break;
      case 'thread/realtime/started': this.live = true; this.expectClose = false; this.emit('started', p); break;
      case 'thread/realtime/error':
        this.log('realtime error', p.message);
        if (this.sdpWaiter) { this.sdpWaiter.rej(new Error(p.message)); this.sdpWaiter = null; }
        else this.emit('error', p.message);
        break;
      case 'thread/realtime/closed':
        this.live = false;
        // We asked for this one, to replace it or because the page gave up on it. It is not a lost voice.
        if (this.expectClose) { this.expectClose = false; break; }
        this.emit('closed', p.reason || 'closed');
        break;
      case 'thread/realtime/transcript/delta': this.emit('delta', p.role, p.delta); break;
      case 'thread/realtime/transcript/done': this.emit('done', p.role, p.text); break;
      case 'thread/realtime/itemAdded':
        if (p.item?.type === 'handoff_request') this.emit('handoff', p.item.input_transcript);
        break;
      // A handoff would start a full Codex turn on this thread. Stop it: the invoking agent is the brain.
      case 'turn/started':
        this.req('turn/interrupt', { threadId: this.threadId, turnId: p.turn.id }).catch(() => {});
        break;
      default:
    }
  }

  // Two offers at once would answer each other's pages, so a newer one waits for the older to settle.
  start(offerSdp, voice, rules = ACTOR_RULES) {
    const run = (this.starting ?? Promise.resolve()).catch(() => {}).then(() => this.placeCall(offerSdp, voice, rules));
    this.starting = run;
    return run;
  }

  async placeCall(offerSdp, voice, rules) {
    // A refreshed page offers again: the session it left behind goes first.
    if (this.live) await this.stop();
    await this.boot();
    if (!this.threadId) {
      const th = await this.req('thread/start', { cwd: this.cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', developerInstructions: 'Reply with OK. Use no tools.' });
      this.threadId = th.thread.id;
    }
    let timer, waiter;
    const answer = new Promise((res, rej) => {
      waiter = this.sdpWaiter = { res, rej };
      timer = setTimeout(() => rej(new Error('实时语音连接超时')), this.sdpTimeoutMs);
    });
    answer.catch(() => {}); // the request below can fail first, and then nobody awaits this
    try {
      await this.req('thread/realtime/start', {
        threadId: this.threadId,
        version: 'v3',
        outputModality: 'audio',
        transport: { type: 'webrtc', sdp: offerSdp },
        includeStartupContext: false,
        initialItems: [{ role: 'developer', text: rules }],
        prompt: rules,
        voice: voice || 'spruce',
        clientManagedHandoffs: true,
        delegationAckFiller: false,
      });
      return await answer;
    } finally {
      clearTimeout(timer);
      if (this.sdpWaiter === waiter) this.sdpWaiter = null;
    }
  }

  speak(text) { return this.req('thread/realtime/appendText', { threadId: this.threadId, text: `[照读] ${text}`, role: 'user' }); }
  context(text) { return this.req('thread/realtime/appendText', { threadId: this.threadId, text, role: 'developer' }); }
  async stop() {
    if (!this.threadId || !this.live) { this.live = false; return; }
    this.live = false; this.expectClose = true;
    await this.req('thread/realtime/stop', { threadId: this.threadId }).catch(() => {});
  }
  kill() { try { this.child?.kill(); } catch { /* already gone */ } this.child = null; }
}
