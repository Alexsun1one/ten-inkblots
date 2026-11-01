import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newSessionDir } from '../lib/session.mjs';
import { INQUIRY_NEXT, NEXT_CMD, transcriptAssembler } from '../lib/transcript.mjs';
import { isCrisis } from '../lib/safety.mjs';
import { buildProtocol, validateProtocol, compact, caret, CONVENTIONS } from '../lib/protocol.mjs';
import { geometry, normDeg } from '../lib/geometry.mjs';
import { checkSchema } from '../lib/schema.mjs';

const plates = JSON.parse(readFileSync(fileURLToPath(new URL('../../app/plates/plates.json', import.meta.url)), 'utf8'));
const T0 = 1_000_000;
const view = (over = {}) => ({ mode: 'focus', z: 1, w: 900, cx: .5, cy: .5, deg: 0, visible: 1, box: [0, 0, 1, 1], ...over });
const blank = () => ({ shownAt: null, endedAt: null, deg: 0 });

// A small hand-built session. Times are chosen so every derived number can be checked by eye.
function session() {
  const state = {
    id: 'sess', createdAt: T0, phase: 'inquiry', name: null, question: '我最近为什么总是累', reportReady: false,
    voice: { mode: 'codex', name: 'spruce' }, card: 1, focus: 'r1', choices: {}, feedback: {},
    cards: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, blank()])),
    phrases: [
      { id: 'p1', card: 1, phase: 'intake', text: '我最近为什么总是累', at: T0 + 500, firstTextAt: T0 + 300, source: 'typed', typedAt: T0 + 100, deg: 0 },
      { id: 'p2', card: 1, phase: 'response', text: '倒过来像一只蝙蝠', at: T0 + 8500, firstTextAt: T0 + 7300, source: 'codex', deg: 90 },
      { id: 'p3', card: 1, phase: 'response', text: '下一张', at: T0 + 12000, firstTextAt: T0 + 11900, source: 'codex', deg: 90, command: true },
      { id: 'p4', card: 1, phase: 'inquiry', response: 'r1', text: '两边是翅膀', at: T0 + 20500, firstTextAt: T0 + 20200, source: 'codex', deg: 90 },
    ],
    responses: [{ id: 'r1', card: 1, label: '蝙蝠', tidy: null, verbatim: '倒过来像一只蝙蝠', phrases: ['p2'], inquiry: [{ phrase: 'p4', text: '两边是翅膀' }], strokes: ['s1'], deg: 90 }],
    strokes: [{ id: 's1', card: 1, by: 'user', phase: 'inquiry', response: 'r1', pts: [[.1, .1], [.9, .1], [.9, .9], [.1, .9], [.1, .1]], ts: [0, 100, 200, 300, 400], pressure: null, pointer: 'mouse', startAt: T0 + 19000, endAt: T0 + 19400, view: view({ deg: 90 }), geo: null }],
    removedStrokes: [{ id: 's2', card: 1, by: 'user', phase: 'inquiry', response: 'r1', pts: [[.2, .2], [.3, .3]], ts: [0, 50], pressure: null, pointer: 'mouse', startAt: T0 + 18000, endAt: T0 + 18050, view: null, geo: null, removedAt: T0 + 18500, removedVia: 'undo' }],
  };
  const trace = [
    { type: 'phase', t: 50, from: 'threshold', to: 'intake' },
    { type: 'phase', t: 1000, from: 'intake', to: 'response' },
    { type: 'card.shown', t: 1000, card: 1 },
    { type: 'say.start', t: 1000, id: 1, text: '这可能是什么？' },
    { type: 'say.end', t: 2500, id: 1 },
    { type: 'exposure.start', t: 2000, card: 1, phase: 'response', response: null, state: view() },
    { type: 'gesture', t: 3000, endMs: 3500, card: 1, op: 'zoom', via: 'wheel', from: view(), to: view({ z: 2, visible: .4 }), samples: [[100, 1.5, .5, .5, 0]] },
    { type: 'gesture', t: 5000, endMs: 5000, card: 1, op: 'fit', via: 'key', from: view({ z: 2, visible: .4 }), to: view(), samples: [] },
    { type: 'gesture', t: 6000, endMs: 6000, card: 1, op: 'rotate', via: 'button', from: view(), to: view({ deg: 90 }), samples: [] },
    { type: 'speech.onset', t: 4000 },
    { type: 'speech.onset', t: 7000 },
    { type: 'pacing', t: 11000, card: 1, kind: 'prompt_more' },
    { type: 'client.visibility', t: 9000, visible: false },
    { type: 'client.visibility', t: 10000, visible: true },
    { type: 'card.end', t: 12000, card: 1, via: 'voice' },
    { type: 'exposure.end', t: 12000, card: 1 },
    { type: 'phase', t: 17000, from: 'response', to: 'inquiry' },
    { type: 'inquiry.start', t: 17000, response: 'r1', prompt: '你说：蝙蝠。' },
    { type: 'exposure.start', t: 17500, card: 1, phase: 'inquiry', response: 'r1', state: view({ deg: 90 }) },
    { type: 'client.info', t: 40, viewport: { w: 1440, h: 900 }, dpr: 2, pointer: 'fine', touch: 0, userAgent: 'test' },
    { type: 'exposure.end', t: 22000, card: 1 },
  ].map((e, i) => ({ seq: i + 1, src: 'test', ...e }));
  return { state, trace };
}
const build = (s = session()) => buildProtocol({ ...s, plates, generatedAt: T0 + 22000, stimulus: Array.from({ length: 10 }, (_, i) => ({ card: i + 1, roman: 'X', chromatic: false, file: 'x.jpg', sha256: null })) });

test('a real session shape validates', () => assert.deepEqual(validateProtocol(build()), []));

test('reaction time runs from paint to speech, not from the server sending the card', () => {
  const t = build().cards[0].timing;
  assert.equal(t.shownMs, 1000);
  assert.equal(t.onsetMs, 2000);
  assert.equal(t.onsetBasis, 'painted');
  assert.equal(t.rtMs, 5000); // the latest onset before text (7000) minus paint (2000)
  assert.equal(t.rtBasis, 'vad');
  assert.equal(t.promptEndMs, 2500);
  assert.equal(t.durationMs, 10000);
  assert.equal(t.hiddenMs, 1000);
  assert.equal(t.endedBy, 'voice');
});

test('without any measured onset, RT says it came from the transcript', () => {
  const s = session();
  s.trace = s.trace.filter(e => e.type !== 'speech.onset');
  const t = build(s).cards[0].timing;
  assert.equal(t.rtMs, 5300);
  assert.equal(t.rtBasis, 'transcript');
});

test('typed intake uses the first key as onset', () => {
  const u = build().other.utterances.find(x => x.id === 'p1');
  assert.deepEqual([u.onsetMs, u.onsetBasis, u.firstTextMs, u.endMs], [100, 'typing', 300, 500]);
});

test('orientation is recorded per response and dwell adds up', () => {
  const c = build().cards[0];
  assert.deepEqual(c.orientation.dwellMs, { 0: 4000, 90: 6000, 180: 0, 270: 0 });
  assert.equal(c.orientation.changes.length, 1);
  assert.deepEqual([c.orientation.changes[0].notation, c.orientation.changes[0].via], ['>', 'button']);
  assert.deepEqual(c.responses[0].orientation, { deg: 90, notation: '>' });
  assert.equal(c.responses[0].viewAtOnset.deg, 90);
});

test('zoom is summarized from the gestures', () => {
  const v = build().cards[0].view;
  assert.equal(v.gestures, 3);
  assert.equal(v.rotations, 1);
  assert.equal(v.zoomMax, 2);
  assert.equal(v.zoomedMs, 1900); // 1.5 from 3100 to 3500, then 2 until the fit at 5000
  assert.equal(v.visibleMin, .4);
});

test('the hierarchy holds: exposures, gestures, inquiry, strokes, unassigned', () => {
  const p = build(), c = p.cards[0];
  assert.deepEqual(c.exposures.map(x => [x.phase, x.response, x.gestures.length]), [['response', null, 3], ['inquiry', 'r1', 0]]);
  const r = c.responses[0];
  assert.equal(r.inquiry.utterances[0].text, '两边是翅膀');
  assert.equal(r.location.strokes[0].id, 's1');
  assert.equal(r.location.geometry.closed, false);
  assert.equal(c.removedStrokes[0].removedVia, 'undo');
  assert.deepEqual(c.unassigned.utterances.map(u => [u.id, u.command]), [['p3', true]]);
  assert.deepEqual(p.other.utterances.map(u => u.id), ['p1']);
  assert.ok(p.transcript.every((x, i, a) => !i || a[i - 1].tMs <= x.tMs));
  assert.ok(!p.transcript.some(x => x.text === '下一张'));
});

test('a move just before an exposure belongs to that exposure, and dwell stays exact', () => {
  const s = session();
  s.trace.push({ seq: 90, src: 'test', type: 'gesture', t: 17200, endMs: 17200, card: 1, op: 'rotate', via: 'system', from: view(), to: view({ deg: 90 }), samples: [] });
  const c = build(s).cards[0];
  assert.deepEqual(c.exposures.map(x => x.gestures.length), [3, 1]);
  assert.deepEqual(c.orientation.dwellMs, { 0: 4000, 90: 6000, 180: 0, 270: 0 });
  assert.deepEqual(validateProtocol(build(s)), []);
});

test('a code that leaves out optional fields is written out in full', () => {
  const s = session();
  const p = buildProtocol({ ...s, plates, codes: [{ id: 'r1', loc: 'W', dq: 'o', det: ['F'], fq: 'o', content: ['A'], evidence: '形状' }], stimulus: build().stimulus.plates });
  assert.deepEqual([p.cards[0].responses[0].code.z, p.cards[0].responses[0].code.pop, p.cards[0].responses[0].code.special], [null, false, []]);
  assert.deepEqual(validateProtocol(p), []);
});

test('a broken object reports the real field, not "should be null"', () => {
  const p = JSON.parse(JSON.stringify(build()));
  p.cards[0].responses[0].code = { id: 'r1' };
  const e = validateProtocol(p);
  assert.ok(e.some(m => m.includes('code') && m.includes('缺少')), e.join('\n'));
});

test('compact drops the heavy arrays and keeps everything else', () => {
  const c = compact(build());
  assert.equal(c.cards[0].exposures[0].gestures[0].samples, undefined);
  assert.equal(c.cards[0].responses[0].location.strokes[0].points, undefined);
  assert.equal(c.cards[0].timing.rtMs, 5000);
});

test('caret and angle helpers', () => {
  assert.deepEqual([0, 90, 180, 270, 359, 44, 46, -90].map(caret), ['∧', '>', '∨', '<', '∧', '∧', '>', '<']);
  assert.equal(normDeg(-90), 270);
  assert.equal(normDeg(450), 90);
  assert.equal(normDeg(360), 0);
});

test('geometry is measured on the plate, not the screen', () => {
  const whole = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const a = geometry(plates, 1, [whole], 0), b = geometry(plates, 1, [whole], 90);
  assert.equal(a.inkCoverage, b.inkCoverage);
  assert.equal(a.locationHint, 'W');
  assert.equal(b.rotation, 90);
  const blank = [[.001, .001], [.02, .001], [.02, .02], [.001, .02], [.001, .001]];
  assert.equal(geometry(plates, 1, [blank]).inkCoverage, 0);
  const split = geometry(plates, 1, [[[.1, .2], [.45, .2], [.45, .8], [.1, .8], [.1, .2]], [[.55, .2], [.9, .2], [.9, .8], [.55, .8], [.55, .2]]]);
  const left = geometry(plates, 1, [[[.1, .2], [.45, .2], [.45, .8], [.1, .8], [.1, .2]]]);
  assert.ok(split.inkCoverage > left.inkCoverage, 'a union covers more ink than one of its parts');
});

// ---------- the gate must also say no ----------
const breaks = {
  'wrong schema id': p => { p.schema = 'other/1.0'; },
  'nine cards': p => { p.cards.pop(); },
  'unknown top-level field': p => { p.extra = 1; },
  'unknown gesture via': p => { p.cards[0].exposures[0].gestures[0].via = 'telepathy'; },
  'angle out of range': p => { p.cards[0].responses[0].orientation.deg = 400; },
  'bad notation': p => { p.cards[0].responses[0].orientation.notation = '^'; },
  'stroke off the plate': p => { p.cards[0].responses[0].location.strokes[0].points[0] = [3, 3]; },
  'point times out of order': p => { p.cards[0].responses[0].location.strokes[0].pointTimes[2] = 0; },
  'point times wrong length': p => { p.cards[0].responses[0].location.strokes[0].pointTimes.pop(); },
  'reversed exposure': p => { p.cards[0].exposures[0].endMs = 0; },
  'overlapping exposures': p => { p.cards[0].exposures[1].startMs = 3000; },
  'event after session end': p => { p.cards[0].timing.endMs = p.session.durationMs + 1; },
  'dwell does not add up': p => { p.cards[0].orientation.dwellMs[0] += 500; },
  'rt without a basis': p => { p.cards[0].timing.rtBasis = null; },
  'utterance lost': p => { p.cards[0].responses[0].freeAssociation.utterances = []; },
  'stroke lost': p => { p.cards[0].responses[0].location.strokes = []; },
  'stroke claimed twice': p => { p.cards[0].unassigned.strokes.push(p.cards[0].responses[0].location.strokes[0]); },
  'duplicate response id': p => { p.cards[1].responses.push(p.cards[0].responses[0]); },
  'code for another response': p => { p.cards[0].responses[0].code = { id: 'r9', loc: 'W', dq: 'o', det: ['F'], fq: 'o', content: ['A'], z: null, special: [], evidence: 'x' }; },
  'completed without narrative': p => { p.session.status = 'completed'; },
  'same card liked and disliked': p => { p.choices.answers[0].card = 3; p.choices.answers[1].card = 3; },
  'skipped with a card': p => { p.choices.answers[2].skipped = true; p.choices.answers[2].card = 4; },
  'questions out of order': p => { p.choices.answers.reverse(); },
};
for (const [name, mutate] of Object.entries(breaks)) {
  test(`rejects: ${name}`, () => {
    const p = JSON.parse(JSON.stringify(build()));
    mutate(p);
    assert.notDeepEqual(validateProtocol(p), [], `${name} slipped through`);
  });
}

test('the schema checker reports where and why', () => {
  const schema = { type: 'object', required: ['a'], additionalProperties: false, properties: { a: { type: 'integer', minimum: 1 } } };
  assert.deepEqual(checkSchema(schema, { a: 2 }), []);
  assert.match(checkSchema(schema, { a: 0 })[0], /\$\.a/);
  assert.match(checkSchema(schema, {})[0], /缺少 a/);
  assert.match(checkSchema(schema, { a: 1, b: 2 })[0], /多余字段 b/);
  assert.match(checkSchema(schema, { a: 1.5 })[0], /integer/);
});

test('conventions travel with the data', () => assert.ok(CONVENTIONS.coordinates && CONVENTIONS.interpretation));

test('two starts in the same second get separate records', () => {
  const before = process.env.RORSCHACH_HOME;
  process.env.RORSCHACH_HOME = mkdtempSync(join(tmpdir(), 'ror-'));
  try { assert.equal(new Set(Array.from({ length: 5 }, newSessionDir)).size, 5); }
  finally { if (before == null) delete process.env.RORSCHACH_HOME; else process.env.RORSCHACH_HOME = before; }
});

const assembler = (over = {}) => {
  const out = { closed: [], revised: [], previews: [] };
  let n = 0, card = 1;
  const a = transcriptAssembler({ context: () => ({ card }), close: (t, c) => { out.closed.push([t, c?.card]); return `p${++n}`; }, revise: (id, t) => out.revised.push([id, t]), preview: t => out.previews.push(t), quietMs: 20, capMs: 80, ...over });
  return { a, out, setCard: v => { card = v; } };
};
const wait = ms => new Promise(r => setTimeout(r, ms));

test('a phrase closes once deltas go quiet, and the late done does not duplicate it', async () => {
  const { a, out } = assembler();
  a.delta('一只'); a.delta('蝙蝠');
  await wait(40);
  assert.deepEqual(out.closed, [['一只蝙蝠', 1]]);
  a.done('一只 蝙蝠。');
  assert.equal(out.closed.length, 1);
  assert.deepEqual(out.revised, []);
});
test('a phrase keeps the card it was spoken on', async () => {
  const { a, out, setCard } = assembler();
  a.delta('一只蝙蝠');
  setCard(2);
  await wait(40);
  assert.deepEqual(out.closed, [['一只蝙蝠', 1]]);
});
test('a done covering two early phrases consumes both', async () => {
  const { a, out } = assembler();
  a.delta('一只蝙蝠'); await wait(40);
  a.delta('翅膀张开'); await wait(40);
  a.done('一只蝙蝠，翅膀张开。');
  assert.equal(out.closed.length, 2);
  assert.deepEqual(out.revised, []);
});
test('a late done for the last phrase leaves the phrase in progress alone', async () => {
  const { a, out } = assembler({ quietMs: 30 });
  a.delta('一只蝙蝠'); await wait(50);
  a.delta('翅膀');
  a.done('一只蝙蝠');
  assert.deepEqual(out.closed, [['一只蝙蝠', 1]]);
  await wait(50);
  assert.deepEqual(out.closed, [['一只蝙蝠', 1], ['翅膀', 1]]);
});
test('a done that closes part-way keeps what follows', async () => {
  const { a, out } = assembler({ quietMs: 200 });
  a.delta('一只蝙蝠，翅膀张开');
  a.done('一只蝙蝠，');
  assert.deepEqual(out.closed, [['一只蝙蝠，', 1]]);
  assert.ok(a.open);
  a.flush();
  assert.deepEqual(out.closed, [['一只蝙蝠，', 1], ['翅膀张开', 1]]);
});
test('a done that disagrees revises the early phrase rather than adding one', async () => {
  const { a, out } = assembler();
  a.delta('一只编幅'); await wait(40);
  a.done('一只蝙蝠');
  assert.equal(out.closed.length, 1);
  assert.deepEqual(out.revised, [['p1', '一只蝙蝠']]);
});
test('a done with nothing pending still closes a phrase', () => {
  const { a, out } = assembler();
  a.done('一只蝙蝠');
  assert.equal(out.closed.length, 1);
  assert.equal(out.closed[0][0], '一只蝙蝠');
});
test('a person still talking holds the phrase open, up to a cap', async () => {
  let on = true;
  const { a, out } = assembler({ talking: () => on });
  a.delta('一只');
  await wait(40);
  assert.equal(out.closed.length, 0);
  await wait(350);
  assert.equal(out.closed.length, 1);
  on = false;
});

test('a done that went missing does not let the next one overwrite the phrase before it', async () => {
  const { a, out, setCard } = assembler();
  a.delta('一只蝙蝠'); await wait(40);
  setCard(2);
  a.delta('两个人在跳舞'); await wait(40);
  a.done('两个人在跳舞。');
  assert.deepEqual(out.closed, [['一只蝙蝠', 1], ['两个人在跳舞', 2]]);
  assert.deepEqual(out.revised, []);
  a.done('两个人在跳舞。');
  assert.equal(out.closed.length, 3, 'consumed once: the same words again are new words');
});
test('a done unlike anything pending is a phrase of its own, never a correction', async () => {
  const { a, out } = assembler();
  a.delta('一只蝙蝠'); await wait(40);
  a.done('中间有一座塔');
  assert.deepEqual(out.revised, []);
  assert.equal(out.closed.at(-1)[0], '中间有一座塔');
});
test('a correction goes to the phrase it resembles most, not simply the oldest', async () => {
  const { a, out } = assembler();
  a.delta('一只蝙蝠停在树上'); await wait(40);
  a.delta('两只小熊鼻子碰在一起'); await wait(40);
  a.done('两只小熊鼻子贴在一起');
  assert.deepEqual(out.revised, [['p2', '两只小熊鼻子贴在一起']]);
});
test('one sentence covering two closed phrases, slightly reworded, adds nothing and corrects nothing', async () => {
  const { a, out } = assembler();
  a.delta('一只蝙蝠翅膀张开'); await wait(40);
  a.delta('停在那棵树上面'); await wait(40);
  a.done('一只蝙蝠翅膀张着停在那棵树上面');
  assert.equal(out.closed.length, 2);
  assert.deepEqual(out.revised, []);
});
test('an unrelated done leaves the phrase still being spoken alone', async () => {
  const { a, out } = assembler({ quietMs: 200 });
  a.delta('一只蝙蝠');
  a.done('中间有一座塔');
  assert.ok(a.open);
  a.flush();
  assert.deepEqual(out.closed.map(x => x[0]), ['中间有一座塔', '一只蝙蝠']);
});
test('saying "next" the way people say it', () => {
  for (const s of ['下一张', '下一张。', '好的，下一张', '好，下一张吧', '下一张吧', '嗯，下一张', '就这些了', '看完了。', '好了，看完了']) assert.ok(NEXT_CMD.test(s), s);
  for (const s of ['下一张是什么', '这像下一张纸', '没有了翅膀']) assert.ok(!NEXT_CMD.test(s), s);
  for (const s of ['下一条', '好的，下一条', '说完了', '就这样吧']) assert.ok(INQUIRY_NEXT.test(s), s);
  assert.ok(!INQUIRY_NEXT.test('就这样的形状'));
});
test('crisis words, including what the first list missed, and through punctuation', () => {
  for (const s of ['我不想再活了', '死了算了', '我想去死', '我想自残', '活着没意思', '活着真没什么意思', '想，死', '不 想 活 了']) assert.ok(isCrisis(s), s);
  for (const s of ['一只蝙蝠', '活着的东西', '两个人很有意思']) assert.ok(!isCrisis(s), s);
});
test('an exposure is only closed by its own end, not a late end of the one before', () => {
  const trace = [
    { seq: 1, t: 0, type: 'session.start' },
    { seq: 2, t: 100, type: 'exposure.start', card: 1, state: {} },
    { seq: 3, t: 500, type: 'exposure.start', card: 2, state: {} },
    { seq: 4, t: 600, type: 'exposure.end', card: 1 },
    { seq: 5, t: 900, type: 'exposure.end', card: 2 },
  ];
  const S = { id: 'x', createdAt: 0, phase: 'response', cards: {}, phrases: [], responses: [], strokes: [], removedStrokes: [], favorites: {}, voice: {} };
  const p = buildProtocol({ state: S, trace, plates: null, stimulus: [] });
  assert.equal(p.cards[1].exposures[0].endMs, 900);
});
test('validator: a response that reads differently from its utterances, and a stroke owned by nothing here', () => {
  const trace = [{ seq: 1, t: 0, type: 'session.start' }, { seq: 2, t: 1000, type: 'phase', from: 'threshold', to: 'response' }];
  const S = { id: 'x', createdAt: 0, phase: 'response', cards: {}, voice: {}, choices: {}, removedStrokes: [],
    phrases: [{ id: 'p1', card: 1, phase: 'response', text: '一只蝙蝠', at: 500, firstTextAt: 400, source: 'typed' }],
    responses: [{ id: 'r1', card: 1, label: '蝙蝠', verbatim: '一只旧的话', phrases: ['p1'], inquiry: [], strokes: [] }],
    strokes: [{ id: 's1', card: 2, by: 'user', phase: 'inquiry', pts: [[.1, .1], [.2, .2]], startAt: 600, endAt: 700, response: 'r9' }] };
  const errors = validateProtocol(buildProtocol({ state: S, trace, plates: null }));
  assert.ok(errors.some(e => e.includes('verbatim')), errors.join('\n'));
  assert.ok(errors.some(e => e.includes('r9')), errors.join('\n'));
});
