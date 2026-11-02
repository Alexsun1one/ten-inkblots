#!/usr/bin/env node
// Stands in for `codex app-server` so failure paths can be exercised without a network or a login.
import { appendFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

if (process.argv[2] === '--version') { console.log('codex-cli fake'); process.exit(0); }
const MODE = process.env.FAKE_CODEX_MODE || 'ok';
const LOG = process.env.FAKE_CODEX_LOG;
const note = m => { if (LOG) appendFileSync(LOG, JSON.stringify(m) + '\n'); };
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
note({ pid: process.pid });

createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  note({ method: m.method, role: m.params?.role, text: m.params?.text });
  if (m.id == null || MODE === 'silent') return;
  const ok = (result = {}) => send({ id: m.id, result });
  switch (m.method) {
    case 'thread/start': return ok({ thread: { id: 't1' } });
    case 'thread/realtime/start':
      if (MODE === 'reject-start' || (process.env.FAKE_CODEX_REFUSE && existsSync(process.env.FAKE_CODEX_REFUSE))) return send({ id: m.id, error: { message: 'realtime refused' } });
      if (MODE === 'die-on-start') process.exit(3);
      ok();
      if (MODE === 'no-sdp') return;
      send({ method: 'thread/realtime/sdp', params: { sdp: 'fake-answer' } });
      return send({ method: 'thread/realtime/started', params: {} });
    case 'thread/realtime/stop':
      ok();
      return send({ method: 'thread/realtime/closed', params: { reason: 'stopped' } });
    default: return ok();
  }
});
