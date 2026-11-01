// The server and the CLI as an agent and a page use them, including the ways a session goes wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RealtimeBridge } from '../lib/realtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROR = join(HERE, '..', 'ror.mjs');
const FAKE = join(HERE, 'fake-codex.mjs');
chmodSync(FAKE, 0o755); // skill installers unpack without the executable bit
const wait = ms => new Promise(r => setTimeout(r, ms));
const scratch = () => mkdtempSync(join(tmpdir(), 'ror-test-'));

function session(t, { voice = 'text', env = {} } = {}) {
  const home = scratch(), E = { ...process.env, RORSCHACH_HOME: home, RORSCHACH_FOLLOWUP_MS: '600000', ...env };
  const ror = (...args) => { const r = spawnSync(process.execPath, [ROR, ...args], { encoding: 'utf8', env: E }); return JSON.parse(r.stdout.trim().split('\n').pop()); };
  const s = { home, ror, E, ...ror('start', '--no-open', '--voice', voice) };
  const key = () => new URL(s.url).searchParams.get('k'), base = () => new URL(s.url).origin;
  s.post = (p, b = {}) => fetch(base() + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ror-key': key() }, body: JSON.stringify(b) }).then(r => r.json());
  s.state = () => fetch(`${base()}/api/state`, { headers: { 'x-ror-key': key() } }).then(r => r.json());
  s.trace = () => readFileSync(join(s.session, 'trace.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  s.events = () => readFileSync(join(s.session, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  s.meta = () => JSON.parse(readFileSync(join(s.session, 'server.json'), 'utf8'));
  // Lines take as long as they take to read. These tests are about what happens after them.
  s.finishLines = async () => { for (let i = 0; i < 12; i++) { const lines = s.trace().filter(e => e.type === 'say.start' || e.type === 'say.end'); const last = lines.at(-1); if (!last || last.type === 'say.end') return; await s.post('/api/said', { id: last.id }); await wait(30); } };
  s.utter = async text => { const before = (await s.state()).phrases.length; await s.post('/api/utter', { text }); return (await s.state()).phrases[before]?.id; };
  t.after(() => { try { process.kill(s.meta().pid, 'SIGKILL'); } catch { /* already gone */ } rmSync(home, { recursive: true, force: true }); });
  return s;
}
const until = async (what, fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) assert.fail(`等不到：${what}`); await wait(40); } };

test('a pause holds: nothing moves the test forward until someone decides', async t => {
  const s = session(t);
  await s.post('/api/begin');
  s.ror('phase', 'inquiry');
  s.ror('phase', 'response');
  await s.utter('我觉得活着没意思');
  assert.equal((await s.state()).paused, true);
  assert.equal((await s.post('/api/next')).reason, 'paused');
  assert.equal(s.ror('next').reason, 'paused');
  assert.deepEqual(s.ror('inquire'), { paused: true });
  await s.utter('下一张');
  assert.equal((await s.state()).card, 1);
  s.ror('resume');
  assert.equal((await s.state()).paused, false);
  assert.ok(s.trace().some(e => e.type === 'safety.resume' && e.via === 'agent'));
});

test('the agent can pause too: the page stops, the named words become private, and the report file leaves them out', async t => {
  const s = session(t);
  await s.post('/api/begin');
  s.ror('phase', 'inquiry');
  s.ror('phase', 'response');
  await s.finishLines();
  const veiled = await s.utter('我最近常常想，大家没有我会不会更好');
  assert.equal((await s.state()).paused, false, 'no keyword in this one');
  assert.deepEqual(s.ror('pause', '--phrases', veiled), { paused: true });
  const st = await s.state();
  assert.equal(st.paused, true);
  assert.equal(st.phrases.find(p => p.id === veiled).safety, true);
  assert.equal((await s.post('/api/next')).reason, 'paused');
  assert.equal(s.ror('record', '--phrases', veiled, '--label', 'x').ok, false);
  assert.ok(s.trace().some(e => e.type === 'safety.pause' && e.via === 'agent'));
  assert.ok(!s.events().some(e => e.t === 'safety'), 'the agent already knows');
  assert.ok(s.ror('status').session.endsWith(s.session.split('/').pop()));
  assert.equal(s.ror('pause', '--phrases', 'p999').ok, false);
  s.ror('resume');
});

test('words around a pause are about the person: not asked for, not recordable, never read back', async t => {
  const s = session(t);
  await s.post('/api/begin');
  s.ror('phase', 'inquiry');
  s.ror('phase', 'response');
  await s.finishLines();
  const bat = await s.utter('一只蝙蝠');
  s.ror('record', '--phrases', bat, '--label', '蝙蝠');
  const hurt = await s.utter('最近有时候觉得活着没意思');
  const safe = await s.utter('谢谢，我现在是安全的，我们继续吧');
  assert.deepEqual((await s.state()).phrases.filter(p => p.safety).map(p => p.id), [hurt, safe]);
  assert.equal(s.events().find(e => e.id === safe).safety, true);

  const refused = s.ror('record', '--phrases', hurt, '--label', '暂停陈述');
  assert.equal(refused.ok, false);
  assert.match(refused.error, /安全暂停/);
  assert.equal((await s.state()).responses.length, 1);
  s.ror('resume');
  await s.finishLines();
  // They do not count as having said something about the plate: one response still draws the one prompt.
  assert.equal(s.ror('next').reason, 'prompted_for_more');

  // A person can honestly see this in a plate. Once the agent has checked, it can go on the record.
  const seen = await s.utter('一个上吊的人');
  assert.equal(s.ror('record', '--phrases', seen, '--label', '上吊的人').ok, false);
  s.ror('resume');
  await s.finishLines();
  assert.ok(s.ror('record', '--phrases', seen, '--label', '上吊的人', '--plate').id);

  s.ror('next');
  const no = await s.utter('这张看不出来');
  for (let i = 0; i < 30 && !(await s.state()).responseDone; i++) s.ror('next');
  assert.deepEqual(s.events().find(e => e.t === 'response_done').unrecorded, [no]);

  // Nothing said in a pause during the inquiry lands on the response being asked about, and nothing personal is read back.
  const first = s.ror('inquire');
  assert.ok(first.id);
  await s.finishLines();
  const during = await s.utter('我不想活了');
  const st = await s.state();
  assert.equal(st.phrases.find(p => p.id === during).response, undefined);
  assert.equal(st.responses.find(r => r.id === first.id).inquiry.length, 0);
  assert.ok(!s.trace().some(e => e.type === 'say.start' && e.phase === 'inquiry' && e.text.includes('活着没意思')));
  s.ror('resume');

  const ex = s.ror('export');
  assert.equal(ex.ok, true, JSON.stringify(ex));
  const p = JSON.parse(readFileSync(ex.file, 'utf8'));
  const card = p.cards[0];
  assert.deepEqual(card.unassigned.utterances.filter(u => u.safety).map(u => u.id).sort(), [hurt, safe, during].sort());
  assert.equal(card.responses.length, 2);
  assert.equal(card.responses[0].freeAssociation.verbatim, '一只蝙蝠');
});

test('a phase change that ends a pause is on the record as doing so', async t => {
  const s = session(t);
  await s.post('/api/begin');
  await s.utter('不想再活了');
  s.ror('phase', 'choices');
  assert.equal((await s.state()).paused, false);
  assert.ok(s.trace().some(e => e.type === 'safety.resume' && e.via === 'phase'));
});

test('four questions: each is asked, each asks why once, and voice, clicks and the agent all reach the same record', async t => {
  const s = session(t);
  await s.post('/api/begin');
  s.ror('phase', 'choices');
  await s.finishLines();
  const st = () => s.state();
  assert.equal((await st()).choiceAt, 'liked');
  assert.equal((await s.post('/api/next')).reason, 'no_choice');

  // Naming a plate is a choice, not a reason, so the question of why is still open. It is asked once.
  const named = await s.utter('第七张');
  assert.equal((await st()).choices.liked.card, 7);
  assert.equal((await st()).phrases.find(p => p.id === named).command, true);
  assert.equal(s.events().find(e => e.id === named).command, 'pick');
  await s.finishLines();
  assert.ok(s.trace().some(e => e.type === 'say.start' && e.text === '为什么选它？'));
  assert.equal(s.ror('choice', '--next', '--question', 'liked').reason, 'asked_why');
  await s.finishLines();

  // A plate mentioned in the course of a reason does not change the choice.
  await s.utter('因为它比第三张亮，看着舒服');
  assert.equal((await st()).choices.liked.card, 7);
  assert.equal((await s.post('/api/next')).question, 'disliked');
  await s.finishLines();

  // The same plate cannot be both, and a late "next" from the agent cannot skip a question.
  assert.ok((await s.post('/api/choice', { card: 7 })).error);
  assert.equal(s.ror('choice', '--next', '--question', 'liked').reason, 'already_moved');
  assert.equal((await st()).choiceAt, 'disliked');
  await s.finishLines();

  // A plate and a reason in one breath: nothing more to ask.
  await s.utter('第九张吧，颜色太乱了');
  assert.equal((await st()).choices.disliked.card, 9);
  await s.finishLines();
  assert.equal(s.trace().filter(e => e.type === 'say.start' && e.text === '为什么选它？').length, 1);
  await s.utter('换成第四张');
  assert.equal((await st()).choices.disliked.card, 4);
  await s.finishLines();
  assert.equal(s.ror('choice', '--next', '--question', 'disliked').question, 'father');
  await s.finishLines();

  // Not wanting to answer is an answer.
  await s.utter('不想答');
  assert.equal((await st()).choices.father.skipped, true);
  assert.equal((await st()).choiceAt, 'mother');
  await s.finishLines();

  // Father and mother can be any plate, including one already used.
  assert.equal((await s.post('/api/choice', { card: 7, via: 'drag' })).card, 7);
  await s.finishLines();
  const hurt = await s.utter('我不想活了');
  assert.equal((await st()).paused, true);
  assert.equal((await s.post('/api/next')).reason, 'paused');
  assert.equal((await s.post('/api/choice', { card: 3 })).reason, 'paused');
  s.ror('resume');
  await s.finishLines();
  const why = await s.utter('她总是很安静');
  // Going back keeps the answer and asks again.
  assert.equal((await s.post('/api/choice/revisit', { question: 'father' })).question, 'father');
  assert.equal((await st()).choices.father.skipped, false);
  await s.finishLines();
  assert.equal(s.ror('choice', '--skip').question, 'mother');
  await s.finishLines();

  // The last answer needs nobody to say so: the page moves on by itself.
  assert.equal((await s.post('/api/next')).done, true);
  assert.equal((await st()).phase, 'scoring');
  assert.equal((await st()).choiceAt, null);
  assert.equal(s.ror('phase', 'scoring').phase, 'scoring');
  const done = s.events().find(e => e.t === 'choices_done');
  assert.deepEqual(done.answers.map(a => [a.question, a.card, a.skipped]), [['liked', 7, false], ['disliked', 4, false], ['father', null, true], ['mother', 7, false]]);
  assert.equal(done.answers[2].why, '');

  const ex = s.ror('export');
  assert.equal(ex.ok, true, JSON.stringify(ex));
  const p = JSON.parse(readFileSync(ex.file, 'utf8'));
  const [liked, disliked, father, mother] = p.choices.answers;
  assert.equal(liked.why.verbatim, '因为它比第三张亮，看着舒服');
  assert.equal(liked.why.utterances.length, 2);
  assert.equal(disliked.why.verbatim, '第九张吧，颜色太乱了');
  assert.deepEqual(disliked.history.map(h => h.card), [9, 4]);
  assert.equal(father.skipped, true);
  assert.equal(mother.why.verbatim, '她总是很安静');
  assert.equal(mother.via, 'drag');
  assert.ok(mother.why.utterances.some(u => u.id === why));
  assert.ok(p.other.utterances.some(u => u.id === hurt && u.safety));
  assert.ok(!mother.why.utterances.some(u => u.id === hurt));
});

test('a crisis during the instructions: they are read again in full before the first plate', async t => {
  const s = session(t);
  await s.post('/api/begin');
  assert.equal(s.ror('phase', 'response').briefing, true);
  await s.utter('死了算了');
  await s.finishLines();
  assert.equal((await s.state()).phase, 'intake');
  s.ror('resume');
  const reads = () => s.trace().filter(e => e.type === 'say.start' && e.text.startsWith('我会一张一张'));
  assert.equal(reads().length >= 1, true);
  await s.finishLines();
  await until('第一张', async () => (await s.state()).phase === 'response');
  assert.equal(s.trace().filter(e => e.type === 'phase' && e.to === 'response').length, 1);
});

test('"next" in inquiry moves on and is not recorded as an answer', async t => {
  const s = session(t);
  await s.post('/api/begin');
  s.ror('phase', 'response');
  await s.finishLines();
  await until('回应', async () => (await s.state()).phase === 'response');
  const p1 = await s.utter('一只蝙蝠，翅膀张开。'), p2 = await s.utter('也像一片叶子。');
  s.ror('record', '--phrases', p1, '--label', '蝙蝠');
  s.ror('record', '--phrases', p2, '--label', '叶子');
  const first = s.ror('inquire');
  assert.equal(first.id, 'r1');
  assert.equal(s.ror('inquire').unanswered, true);
  await s.finishLines();
  const says = s.trace().filter(e => e.type === 'inquiry.start').at(-1);
  assert.ok(says.prompt.includes('一只蝙蝠，翅膀张开。'.replace(/。$/, '')), says.prompt);
  await s.utter('好的，下一条');
  const st = await s.state();
  assert.equal(st.focus, 'r2');
  assert.deepEqual(st.responses.find(r => r.id === 'r1').inquiry, []);
  const r1 = s.ror('data', '--response', 'r1', '--full');
  assert.equal(r1.inquiry.verbatim, '');
  assert.ok(r1.inquiry.utterances.every(u => u.command));
  assert.ok(s.events().some(e => e.t === 'inquiry_next' && e.id === 'r2'));
});

test('entering inquiry keeps its introduction, and the fourth response keeps its closing line', async t => {
  const s = session(t);
  await s.post('/api/begin');
  s.ror('phase', 'response');
  await s.finishLines();
  await until('回应', async () => (await s.state()).phase === 'response');
  for (let i = 1; i <= 4; i++) { const p = await s.utter(`第${i}个东西`); s.ror('record', '--phrases', p, '--label', `东西${i}`); }
  assert.equal((await s.state()).card, 2);
  await wait(100);
  const said = s.trace().filter(e => e.type === 'say.start').map(e => e.text);
  await s.finishLines();
  const after = s.trace().filter(e => e.type === 'say.start').map(e => e.text);
  assert.ok(said.concat(after).some(x => x.startsWith('好，这张就看到这里')), 'pull line was never read');
  s.ror('inquire');
  await s.finishLines();
  const lines = s.trace().filter(e => e.type === 'say.start').map(e => e.text);
  const intro = lines.findIndex(x => x.startsWith('现在我们回头')), ask = lines.findIndex(x => x.startsWith('你说：'));
  assert.ok(intro >= 0 && ask > intro, JSON.stringify(lines.slice(-4)));
});

test('a report refuses codes that no longer match, and a second report does not repeat the announcement', async t => {
  const s = session(t);
  await s.post('/api/begin');
  s.ror('phase', 'response');
  await s.finishLines();
  await until('回应', async () => (await s.state()).phase === 'response');
  const p1 = await s.utter('一只蝙蝠'), p2 = await s.utter('一片叶子');
  s.ror('record', '--phrases', p1, '--label', '蝙蝠');
  s.ror('record', '--phrases', p2, '--label', '叶子');
  const code = id => ({ id, loc: 'W', dq: 'o', det: ['F'], fq: 'o', content: ['A'], evidence: '形状' });
  const dir = s.session, codes = join(dir, 'c.json'), story = join(dir, 'n.json');
  writeFileSync(codes, JSON.stringify([code('r1'), code('r2')]));
  assert.equal(s.ror('code', '--file', codes).ok, true);
  s.ror('drop', 'r2');
  writeFileSync(story, JSON.stringify({ letter: ['第一段。', '第二段。'], portraits: [{ domain: 'processing', title: '一处观察', body: '你看到了蝙蝠。', confidence: 'tentative', evidence: [{ response: 'r1', quote: '蝙蝠' }] }], invitations: [{ text: '再看一次。' }] }));
  const refused = s.ror('report', '--file', story);
  assert.equal(refused.ok, false);
  assert.ok(refused.errors[0].includes('code --file'), JSON.stringify(refused));
  assert.notEqual((await s.state()).phase, 'report');
  writeFileSync(codes, JSON.stringify([code('r1')]));
  s.ror('code', '--file', codes);
  const r = s.ror('report', '--file', story);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await s.state()).phase, 'report');
  s.ror('report', '--file', story);
  assert.equal(s.trace().filter(e => e.type === 'say.start' && e.text.startsWith('信写好了')).length, 1);
  assert.equal(s.ror('export').ok, true);
});

test('a dropped response leaves its strokes and words on the record, unowned', async t => {
  const s = session(t);
  await s.post('/api/begin');
  s.ror('phase', 'response');
  await s.finishLines();
  await until('回应', async () => (await s.state()).phase === 'response');
  const p = await s.utter('一只蝙蝠');
  s.ror('record', '--phrases', p, '--label', '蝙蝠');
  s.ror('inquire');
  await s.utter('这里是翅膀');
  await s.post('/api/stroke', { card: 1, pts: [[.1, .1], [.2, .2], [.3, .1]], at: Date.now(), endAt: Date.now(), sentAt: Date.now() });
  s.ror('drop', 'r1');
  const st = await s.state();
  assert.equal(st.strokes[0].response, null);
  assert.equal(st.focus, null);
  assert.equal(s.ror('export').ok, true);
  const c = s.ror('data', '--card', '1', '--full');
  assert.equal(c.unassigned.strokes.length, 1);
  assert.equal(c.unassigned.utterances.length, 2);
});

test('a stroke belongs to whoever was in focus when the pen went down', async t => {
  const s = session(t);
  await s.post('/api/begin');
  s.ror('phase', 'response');
  await s.finishLines();
  await until('回应', async () => (await s.state()).phase === 'response');
  const p1 = await s.utter('一只蝙蝠'), p2 = await s.utter('一片叶子');
  s.ror('record', '--phrases', p1, '--label', '蝙蝠');
  s.ror('record', '--phrases', p2, '--label', '叶子');
  s.ror('inquire');
  await s.utter('翅膀');
  s.ror('inquire');
  assert.equal((await s.state()).focus, 'r2');
  await s.post('/api/stroke', { card: 1, response: 'r1', pts: [[.1, .1], [.2, .2], [.3, .1]], at: Date.now(), endAt: Date.now(), sentAt: Date.now() });
  const st = await s.state();
  assert.equal(st.strokes[0].response, 'r1');
  assert.deepEqual(st.responses.find(r => r.id === 'r1').strokes, [st.strokes[0].id]);
  // Not a response on that plate: it stays unowned rather than dangling.
  await s.post('/api/stroke', { card: 2, response: 'r1', pts: [[.1, .1], [.2, .2], [.3, .1]], at: Date.now(), endAt: Date.now(), sentAt: Date.now() });
  assert.equal((await s.state()).strokes[1].response, null);
});

test('killed and restarted: same address, nothing replayed, ids carry on, the record still validates', async t => {
  const s = session(t);
  await s.post('/api/begin');
  s.ror('phase', 'response');
  await s.finishLines();
  await until('回应', async () => (await s.state()).phase === 'response');
  const p1 = await s.utter('一只蝙蝠');
  s.ror('record', '--phrases', p1, '--label', '蝙蝠');
  await s.post('/api/stroke', { card: 1, pts: [[.1, .1], [.2, .2], [.3, .1]], at: Date.now(), endAt: Date.now(), sentAt: Date.now() });
  await s.post('/api/stroke/undo', { card: 1 });
  const url = s.url, before = s.trace().filter(e => e.type === 'response.recorded').length, says = s.trace().filter(e => e.type === 'say.start').map(e => e.id);
  process.kill(s.meta().pid, 'SIGKILL');
  await until('进程退出', () => { try { process.kill(s.meta().pid, 0); return false; } catch { return true; } });
  s.ror('wait', '--timeout', '1'); // whatever was unread comes first
  assert.equal(s.ror('wait', '--timeout', '1').ended, true);
  const back = s.ror('start', '--session', s.session, '--no-open');
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.equal(back.url, url);
  await wait(300);
  assert.equal(s.trace().filter(e => e.type === 'response.recorded').length, before);
  const p2 = await s.utter('一片叶子');
  assert.equal(p2, 'p2');
  s.ror('record', '--phrases', p2, '--label', '叶子');
  await s.post('/api/stroke', { card: 1, pts: [[.1, .1], [.2, .2], [.3, .1]], at: Date.now(), endAt: Date.now(), sentAt: Date.now() });
  const st = await s.state();
  assert.deepEqual(st.responses.map(r => r.id), ['r1', 'r2']);
  assert.equal(st.strokes[0].id, 's2');
  s.ror('say', '再来一句');
  await wait(100);
  const newSay = s.trace().filter(e => e.type === 'say.start').at(-1).id;
  assert.ok(!says.includes(newSay), 'say ids must not collide across a restart');
  assert.deepEqual(s.ror('export').ok, true);
  assert.equal(s.ror('start', '--session', s.session, '--no-open').running, true);
});

test('deleted: the page is told, the agent is told, and wait says so without crashing', async t => {
  const s = session(t);
  await s.post('/api/begin');
  s.ror('wait', '--timeout', '1');
  await s.post('/api/delete');
  const got = s.ror('wait', '--timeout', '3');
  assert.ok(got.deleted || got.events?.some(e => e.t === 'deleted_by_user'), JSON.stringify(got));
  await until('目录被删', () => !existsSync(s.session));
  assert.deepEqual(s.ror('wait', '--timeout', '1'), { ended: true, deleted: true });
});

test('a server the sandbox will not let us signal still counts as running', t => {
  const home = scratch(), dir = join(home, 'sessions', 'x');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'server.json'), JSON.stringify({ pid: 1, url: 'http://127.0.0.1:1/?k=x' }));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ phase: 'response' }));
  const r = spawnSync(process.execPath, [ROR, 'wait', '--session', dir, '--timeout', '1'], { encoding: 'utf8', env: { ...process.env, RORSCHACH_HOME: home } });
  const got = JSON.parse(r.stdout.trim());
  assert.equal(got.ended, undefined, r.stdout);
  assert.equal(got.idleSeconds, 1);
});

test('an agent that stops reading events is noticed on the page, and cleared once it reads again', async t => {
  const s = session(t, { env: { RORSCHACH_STALL_MS: '1' } });
  await s.post('/api/begin');
  await until('提示', async () => (await s.state()).agentStalled === true, 12000);
  s.ror('wait', '--timeout', '1');
  await until('恢复', async () => (await s.state()).agentStalled === false, 12000);
});

// ---------- the voice bridge, against a stand-in app-server ----------
const bridgeFor = (t, mode, extra = {}) => {
  const log = join(scratch(), 'fake.log');
  process.env.FAKE_CODEX_MODE = mode;
  const b = new RealtimeBridge({ bin: FAKE, cwd: tmpdir(), reqTimeoutMs: 1500, sdpTimeoutMs: 300, ...extra });
  t.after(() => { b.kill(); delete process.env.FAKE_CODEX_MODE; });
  return { b, log };
};

test('a refused start rejects once and leaves no timer behind to crash the server', async t => {
  const { b } = bridgeFor(t, 'reject-start');
  await assert.rejects(b.start('offer', 'spruce'), /realtime refused/);
  await wait(400); // past the SDP timeout; an unhandled rejection here fails the test run
  assert.equal(b.sdpWaiter, null);
});

test('no SDP answer: the start times out with a reason', async t => {
  const { b } = bridgeFor(t, 'no-sdp');
  await assert.rejects(b.start('offer', 'spruce'), /超时/);
});

test('an app-server that dies mid-start fails everything waiting on it, and a later start can spawn again', async t => {
  const { b } = bridgeFor(t, 'die-on-start', { reqTimeoutMs: 5000 });
  const closed = new Promise(r => b.once('closed', r));
  await assert.rejects(b.start('offer', 'spruce'), /退出/);
  await closed;
  assert.equal(b.pending.size, 0);
  assert.equal(b.threadId, null);
  process.env.FAKE_CODEX_MODE = 'ok';
  assert.equal(await b.start('offer', 'spruce'), 'fake-answer');
});

test('an app-server that never answers does not hang the caller', async t => {
  const { b } = bridgeFor(t, 'silent');
  await assert.rejects(b.start('offer', 'spruce'), /超时/);
  await assert.rejects(b.boot().then(() => b.req('thread/start', {})), /超时/);
});

test('offering again stops the old session first, and that close is not reported as a lost voice', async t => {
  const { b } = bridgeFor(t, 'ok');
  let lost = 0;
  b.on('closed', () => { lost++; });
  await b.start('offer', 'spruce');
  await wait(50);
  assert.equal(b.live, true);
  await b.start('offer2', 'spruce');
  await wait(50);
  assert.equal(lost, 0);
  assert.equal(b.live, true);
});

// ---------- the same failures, seen from the session ----------
const voiceSession = (t, mode = 'ok') => {
  const log = join(scratch(), 'fake.log');
  const s = session(t, { voice: 'auto', env: { RORSCHACH_CODEX_BIN: FAKE, FAKE_CODEX_MODE: mode, FAKE_CODEX_LOG: log, RORSCHACH_WHISPER_DIR: join(tmpdir(), 'no-such-dir') } });
  s.calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
  return s;
};

test('voice goes away mid-session: the record and the state say typing from then on', async t => {
  const s = voiceSession(t);
  assert.equal(s.voice, 'codex');
  assert.equal((await s.post('/api/voice/offer', { sdp: 'x' })).sdp, 'fake-answer');
  await s.post('/api/begin');
  assert.equal((await s.state()).voice.status, 'live');
  await until('台词已发给语音', () => s.calls().some(c => c.text?.startsWith('[照读]')));
  const pid = s.calls().find(c => c.pid).pid;
  process.kill(pid, 'SIGKILL');
  await until('退回打字', async () => (await s.state()).voice.mode === 'text');
  assert.ok(s.trace().some(e => e.type === 'voice' && e.status === 'closed' && e.mode === 'text'));
  assert.ok(s.events().some(e => e.t === 'voice' && e.status === 'closed' && e.mode === 'text'));
  // The interrupted line does not hold everything up for its long guard timer.
  await until('台词结束', () => s.trace().filter(e => e.type === 'say.end').length >= 1, 3000);
  assert.equal(s.ror('export').ok, true);
  const p = s.ror('data');
  assert.equal(p.administration.voice.mode, 'text');
});

test('a refresh ends the call with the page: that is not a lost voice, and the new page gets one back', async t => {
  const s = voiceSession(t);
  await s.post('/api/voice/offer', { sdp: 'x' });
  await s.post('/api/begin');
  const ctl = new AbortController();
  const es = await fetch(s.url.replace('/?k=', '/api/events?k='), { signal: ctl.signal });
  await es.body.getReader().read();
  ctl.abort();
  await wait(100);
  process.kill(s.calls().find(c => c.pid).pid, 'SIGKILL');
  await until('通话结束', async () => (await s.state()).voice.status === 'idle');
  const st = await s.state();
  assert.equal(st.voice.mode, 'codex');
  assert.ok(!s.events().some(e => e.t === 'voice' && e.status === 'closed'));
  s.ror('say', '这句话没有人念');
  await until('念不出来的台词不会卡住', () => { const tr = s.trace(); return tr.filter(e => e.type === 'say.start').length === tr.filter(e => e.type === 'say.end').length; }, 15000);
  assert.equal((await s.post('/api/voice/offer', { sdp: 'y' })).sdp, 'fake-answer');
  assert.equal((await s.state()).voice.status, 'live');
});

test('a page giving up on the call is recorded as lost, and the deliberate close is not reported twice', async t => {
  const s = voiceSession(t);
  await s.post('/api/voice/offer', { sdp: 'x' });
  await s.post('/api/voice/mode', { mode: 'text', status: 'lost', reason: 'webrtc_failed' });
  await wait(150);
  assert.equal((await s.state()).voice.mode, 'text');
  const voice = s.trace().filter(e => e.type === 'voice');
  assert.equal(voice.at(-1).status, 'lost');
  assert.equal(voice.filter(e => e.status === 'closed').length, 0);
});

test('a refused voice falls back without taking the server down', async t => {
  const s = voiceSession(t, 'reject-start');
  const r = await s.post('/api/voice/offer', { sdp: 'x' });
  assert.ok(r.error);
  assert.equal(r.fallback, 'text');
  assert.equal((await s.state()).voice.mode, 'text');
});

test('a refresh during debrief hands the new call its talking rules, not the actor rules alone', async t => {
  const s = voiceSession(t);
  await s.post('/api/voice/offer', { sdp: 'x' });
  s.ror('phase', 'debrief');
  const talks = () => s.calls().filter(c => c.role === 'developer' && c.text?.includes('现在规则改变')).length;
  await until('第一次交谈规则', () => talks() >= 1);
  const first = talks();
  await s.post('/api/voice/offer', { sdp: 'y' });
  await until('刷新后的交谈规则', () => talks() > first);
  const methods = s.calls().map(c => c.method);
  assert.ok(methods.indexOf('thread/realtime/stop') > 0, 'old session must be stopped');
  assert.ok(methods.lastIndexOf('thread/realtime/start') > methods.indexOf('thread/realtime/stop'));
  // Resuming from a pause in debrief must not silence the conversation.
  await s.utter('不想活了');
  s.ror('resume');
  await wait(100);
  assert.ok(!s.calls().slice(-3).some(c => c.role === 'developer' && c.text?.startsWith('你只是罗夏')));
});

// ---------- who is sitting there ----------
test('the card before the test: everything optional, kept tidy, passed to the agent, on the record', async t => {
  const s = session(t);
  const kept = await s.post('/api/person', { name: ' 小林 ', age: '28', education: '本科', occupation: '  产品经理 ' });
  assert.deepEqual(kept, { name: '小林', age: 28, education: '本科', occupation: '产品经理' });
  await s.post('/api/begin');
  const begin = s.events().find(e => e.t === 'begin');
  assert.deepEqual(begin.person, kept);
  const p = JSON.parse(readFileSync(s.ror('export').out || join(s.session, 'protocol.json'), 'utf8'));
  assert.equal(p.participant.age, 28);
  assert.equal(p.participant.occupation, '产品经理');
  assert.deepEqual(s.ror('validate', join(s.session, 'protocol.json')).errors || [], []);
  assert.equal((await s.post('/api/person', { name: '别人' })).error, 'already_started');
});
test('nothing filled in is fine, and nonsense does not get in', async t => {
  const s = session(t);
  assert.deepEqual(await s.post('/api/person', {}), { name: null, age: null, education: null, occupation: null });
  assert.deepEqual(await s.post('/api/person', { age: '二十', education: '博士后', occupation: '' }), { name: null, age: null, education: null, occupation: null });
  assert.equal((await s.post('/api/person', { age: 200 })).age, null);
  assert.equal((await s.post('/api/person', { age: 15 })).age, 15);
});

// ---------- an examiner who asks ----------
const quick = { env: { RORSCHACH_FOLLOWUP_MS: '200', RORSCHACH_HINT_MS: '1200' } };
const asked = s => s.events().filter(e => e.t === 'asked');
const lastActivityHold = ms => wait(ms);
const toCard1 = async s => { await s.post('/api/begin'); s.ror('phase', 'inquiry'); s.ror('phase', 'response'); await s.finishLines(); };
test('看不出来 draws encouragement, not 还有吗, and said again it moves on with the words kept', async t => {
  const s = session(t, quick);
  await toCard1(s);
  const no = await s.utter('这张看不出来。');
  await until('encouragement', () => asked(s).some(e => e.kind === 'nudge' && e.card === 1));
  assert.equal(asked(s).find(e => e.kind === 'nudge').text, '不着急，想到什么都可以说。');
  assert.ok(!asked(s).some(e => e.kind === 'ask_more'), 'no 还有吗 after a refusal');
  assert.equal((await s.state()).card, 1);
  const again = await s.utter('真的看不出来，咱们看别的吧。');
  await until('moved on', async () => (await s.state()).card === 2);
  assert.ok(s.events().some(e => e.t === 'card_end' && e.card === 1));
  assert.ok(s.trace().some(e => e.type === 'card.end' && e.card === 1 && e.via === 'refused'));
  const kept = (await s.state()).phrases.filter(p => p.card === 1).map(p => p.id);
  assert.deepEqual(kept, [no, again]);
  assert.equal((await s.state()).responses.length, 0);
});

test('a refusal then the button: encouragement first, and a sentence that goes on to see something is not a refusal', async t => {
  const s = session(t);
  await toCard1(s);
  await s.utter('不知道');
  assert.equal((await s.post('/api/next')).reason, 'encouraged');
  assert.equal((await s.state()).card, 1);
  await s.utter('看不出来，可能是一只蝴蝶');
  assert.equal((await s.state()).card, 1, 'this one is an answer');
  assert.equal((await s.post('/api/next')).moved, true);
  assert.equal((await s.state()).card, 2);
  // Said about an untouched plate, these get the one 不着急 first, like any other way of saying next.
  await s.utter('换一张吧');
  assert.equal((await s.state()).card, 2);
  await s.utter('跳过这张');
  assert.equal((await s.state()).card, 3);
});

test('after one answer and a silence: 还有吗, once per count, with the agent told', async t => {
  const s = session(t, quick);
  await s.post('/api/begin');
  s.ror('phase', 'response');
  await s.finishLines();
  await s.utter('一只蝙蝠');
  await until('还有吗', () => asked(s).length === 1);
  assert.equal(asked(s)[0].kind, 'ask_more');
  assert.equal(asked(s)[0].text, '还有吗？');
  await s.finishLines();
  await lastActivityHold(600);
  assert.equal(asked(s).length, 1, 'the same count is not asked twice');
  await s.utter('也像一只蝴蝶');
  await until('再问一次', () => asked(s).length === 2);
  await s.finishLines();
  await s.utter('还像一个面具');
  await lastActivityHold(600);
  assert.equal(asked(s).length, 2, 'three is enough');
  assert.ok(s.trace().some(e => e.type === 'pacing' && e.kind === 'ask_more' && e.card === 1));
});
test('not while they are drawing, turning the plate, or typing', async t => {
  const s = session(t, { env: { RORSCHACH_FOLLOWUP_MS: '500' } });
  await s.post('/api/begin');
  s.ror('phase', 'response');
  await s.finishLines();
  await s.utter('一只蝙蝠');
  for (let i = 0; i < 6; i++) { await wait(200); await s.post('/api/typing'); }
  assert.equal(asked(s).length, 0, 'still typing');
  await until('停下来以后才问', () => asked(s).length === 1);
});
test('in inquiry, what is missing gets asked: where, why, then anything more', async t => {
  const s = session(t, quick);
  await s.post('/api/begin');
  s.ror('phase', 'response');
  await s.finishLines();
  const id = await s.utter('一只蝙蝠');
  s.ror('record', '--phrases', id, '--label', '蝙蝠');
  s.ror('phase', 'inquiry');
  await s.finishLines();
  s.ror('inquire');
  await s.finishLines();
  await s.utter('翅膀张开的样子');
  await until('请圈出来', () => asked(s).some(e => e.kind === 'ask_where'));
  await s.finishLines();
  const refused = s.ror('inquire');
  assert.equal(refused.unanswered, true, 'the agent does not move on from under a question');
});
test('in the four questions: why, then any other reason, then the button lights up; the agent waits', async t => {
  const s = session(t, quick);
  await s.post('/api/begin');
  s.ror('phase', 'choices');
  await s.finishLines();
  await s.post('/api/choice', { card: 7, via: 'click' });
  await s.finishLines();
  await s.utter('因为它安静');
  await until('还有别的原因吗', () => asked(s).some(e => e.kind === 'ask_more' && e.question === 'liked'));
  const held = s.ror('choice', '--next', '--question', 'liked');
  assert.equal(held.reason, 'just_asked');
  assert.equal((await s.state()).choiceAt, 'liked');
  await s.finishLines();
  await until('按钮亮起', () => s.trace().some(e => e.type === 'pacing' && e.kind === 'hint' && e.question === 'liked'));
  await s.post('/api/next');
  assert.equal((await s.state()).choiceAt, 'disliked');
  const answers = JSON.parse(readFileSync(s.ror('export').out || join(s.session, 'protocol.json'), 'utf8')).choices.answers;
  assert.ok(answers.find(a => a.question === 'liked').prompts.some(x => x.kind === 'ask_more'));
  assert.deepEqual(s.ror('validate', join(s.session, 'protocol.json')).errors || [], []);
});
test('a button at every step: starting from the intake, and ending from the report', async t => {
  const s = session(t);
  await s.post('/api/begin');
  await s.finishLines();
  await s.utter('我想问问自己');
  await s.post('/api/next');
  const start = s.events().find(e => e.t === 'intake_done');
  assert.equal(start.via, 'button');
  assert.equal(start.phrases.length, 1);
  assert.equal((await s.state()).briefing, true);
  await until('念完指导语进入第一张', async () => (await s.state()).phase === 'response', 40000);
  s.ror('phase', 'debrief');
  await s.post('/api/next');
  assert.equal(s.events().find(e => e.t === 'end_requested').via, 'button');
  assert.ok((await s.state()).endRequested);
});
