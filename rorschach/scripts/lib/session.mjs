// Session paths and the file-based channel between the agent CLI and the server.
// Files, not sockets: agent sandboxes often block localhost but allow writes under a known directory.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, accessSync, constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const writable = dir => {
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); accessSync(dir, constants.W_OK); return true; } catch { return false; }
};

export function homeDir() {
  const wanted = process.env.RORSCHACH_HOME || join(homedir(), '.rorschach');
  if (writable(wanted)) return wanted;
  const fallback = join(process.env.TMPDIR || tmpdir(), 'rorschach');
  if (writable(fallback)) return fallback;
  throw new Error('没有可写的会话目录，请设置 RORSCHACH_HOME');
}

export function newSessionDir() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const root = join(homeDir(), 'sessions');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // A second start within the same second must not reopen the first session's record.
  for (let n = 1; ; n++) {
    const dir = join(root, n === 1 ? stamp : `${stamp}-${n}`);
    try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
    mkdirSync(join(dir, 'snapshots'), { mode: 0o700 });
    writeFileSync(join(homeDir(), 'current'), dir);
    return dir;
  }
}

export function resolveSession(explicit) {
  const dir = explicit || process.env.RORSCHACH_SESSION || readIf(join(homeDir(), 'current'))?.trim();
  if (!dir || !existsSync(dir)) throw new Error('没有进行中的会话，先运行 start');
  return dir;
}

export const readIf = p => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
export const readJson = (p, d = null) => { const s = readIf(p); if (s == null) return d; try { return JSON.parse(s); } catch { return d; } };
export function writeJsonAtomic(p, v) {
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(v, null, 2));
  renameSync(tmp, p);
}

export const paths = dir => ({
  state: join(dir, 'state.json'),
  meta: join(dir, 'server.json'),
  events: join(dir, 'events.jsonl'),
  trace: join(dir, 'trace.jsonl'),
  protocol: join(dir, 'protocol.json'),
  inbox: join(dir, 'inbox.jsonl'),
  cursor: join(dir, 'agent.cursor'),
  away: join(dir, 'agent.away'),
  replies: join(dir, 'replies.jsonl'),
  codes: join(dir, 'codes.json'),
  narrative: join(dir, 'narrative.json'),
  report: join(dir, 'report.html'),
  transcript: join(dir, 'transcript.md'),
  snapshots: join(dir, 'snapshots'),
  log: join(dir, 'server.log'),
});

export const appendLine = (file, obj) => appendFileSync(file, JSON.stringify(obj) + '\n');
