import test from 'node:test';
import assert from 'node:assert/strict';
import { structuralSummary, validateCodes, codeWarnings, zest, capAllows } from '../lib/scoring.mjs';
import { validateNarrative, renderReport, transcriptMarkdown, shareWords, PROJECT } from '../lib/report.mjs';
import { CHOICES, PROTOCOL, NARRATIVE_FOR, NAME, QUESTION } from './fixture.mjs';
import { fileURLToPath } from 'node:url';
import { INK_TYPES, inkType } from '../lib/types.mjs';
import { computeSignals } from '../lib/signals.mjs';

const ids = PROTOCOL.map((_, i) => `r${i + 1}`);
const responses = PROTOCOL.map((p, i) => ({ id: ids[i], card: p.card, label: p.label, verbatim: p.say, inquiry: [{ text: p.inq }], strokes: [], phrases: [] }));
const codes = PROTOCOL.map((p, i) => ({ id: ids[i], ...p.code }));
const cardOf = id => responses.find(r => r.id === id).card;
const QS = Object.keys(CHOICES);
const phrases = QS.map((k, i) => ({ id: `c${i}`, phase: 'choices', question: k, text: CHOICES[k].why }));
const choices = Object.fromEntries(QS.map(k => [k, { card: CHOICES[k].card, skipped: false }]));
const S = { id: 'x', createdAt: 0, question: '问题', responses, strokes: [], phrases, choices, cards: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, { rtMs: 3000, totalMs: 30000, rotations: [] }])) };

test('fixture codes validate', () => assert.deepEqual(validateCodes(codes, responses), []));

test('hand-checked structural values', () => {
  const y = structuralSummary(codes, cardOf);
  assert.equal(y.R, 22);
  assert.deepEqual([y.processing.W, y.processing.D, y.processing.Dd], [5, 16, 1]);
  assert.equal(y.processing.S, 1);
  // M: r2 Mp, r5 Ma, r13 Ma, r18 Ma, r22 Ma = 5. WSumC: FC×3 (r6,r16,r21) .5 each, CF×2 (r17,r19) 1 each, C×1 (r4) 1.5 = 5.0.
  assert.equal(y.ideation.M, 5);
  assert.equal(y.affect.WSumC, 5);
  assert.equal(y.control.EA, 10);
  // FM 5 (r3,r9,r10,r12,r15,r21 = 6), m 1. shading: C' 1, T 2, V 1, Y 2 = 6.
  assert.equal(y.control.FM, 6);
  assert.equal(y.control.m, 1);
  assert.deepEqual(y.control.eb, [7, 6]);
  assert.equal(y.control.es, 13);
  assert.equal(y.control.D, -1); // EA - es = -3 → -1
  assert.deepEqual(y.affect['FC:CF+C'], [3, 3]);
  // Late cards VIII-X hold 8 responses, I-VII hold 14.
  assert.equal(y.affect.Afr, +(8 / 14).toFixed(2));
  // FQ o: r1,2,3,5,6,7,9,11,13,15,18,20. u: r8,10,12,14,16,19,21,22. none: r4,17.
  assert.equal(y.mediation.fq.o, 12);
  assert.equal(y.mediation.fq.u, 8);
  assert.equal(y.mediation.fq.none, 2);
  assert.equal(y.mediation['XA%'], +(20 / 22).toFixed(2));
  assert.equal(y.mediation.P, 10); // r1,3,5,7,9,11,13,15,18,20
  // Pure F: r8, r14, r20 → Lambda 3/19.
  assert.equal(y.validity.lambda, +(3 / 19).toFixed(2));
  assert.equal(y.interpersonal.COP, 4);
  assert.equal(y.ideation.WSum6, 4); // FABCOM ×1
});

test('Z scoring uses the card table', () => {
  const y = structuralSummary(codes, cardOf);
  // r1 I ZW 1, r2 I ZA 4, r3 II ZA 3, r5 III ZA 3, r7 IV ZW 2, r9 V ZW 1, r12 VI ZA 2.5,
  // r13 VII ZA 1, r14 VII ZS 4, r16 VIII ZW 4.5, r18 IX ZA 2.5, r21 X ZW 5.5, r22 X ZD 4.5
  assert.equal(y.processing.Zf, 13);
  assert.equal(y.processing.ZSum, 38.5);
  assert.equal(zest(13), 41.5);
  assert.equal(y.processing.Zd, -3);
});

test('confidence caps follow the validity literature', () => {
  assert.ok(capAllows('mediation', 'strong'));
  assert.ok(!capAllows('self', 'moderate'));
  assert.ok(!capAllows('interpersonal', 'strong'));
});

const y = structuralSummary(codes, cardOf);
const good = () => NARRATIVE_FOR(ids);

test('the report file leaves out what was said in a pause, and only that', () => {
  const said = { ...S, phrases: [...phrases, { id: 'p9', text: '最近有时候觉得活着没意思', safety: true }] };
  const protocol = { transcript: [{ who: 'participant', text: '最近有时候觉得活着没意思' }, { who: 'participant', text: '一只蝙蝠' }] };
  const html = renderReport({ state: said, codes, summary: y, narrative: good(), protocol, plates: fileURLToPath(new URL('../../app/plates/thumbs', import.meta.url)), css: '', js: '' });
  assert.ok(!html.includes('活着没意思'));
  assert.ok(html.includes('一只蝙蝠'));
  assert.ok(html.includes('只留在本机的记录里'));
});

test('good narrative passes the gate', () => assert.deepEqual(validateNarrative(good(), S, y), []));
test('invented quote fails', () => {
  const n = good(); n.portraits[0].evidence[0].quote = '我从来没说过这句';
  assert.ok(validateNarrative(n, S, y).some(e => e.includes('不是')));
});
test('diagnostic word fails', () => {
  const n = good(); n.letter[0] = '你可能有抑郁症。';
  assert.ok(validateNarrative(n, S, y).some(e => e.includes('诊断词')));
});
test('barnum phrasing fails', () => {
  const n = good(); n.letter[0] = '你内心深处渴望被看见。';
  assert.ok(validateNarrative(n, S, y).some(e => e.includes('放在谁身上都成立')));
});
test('overclaiming a weak domain fails', () => {
  const n = good(); n.portraits[4].confidence = 'strong';
  assert.ok(validateNarrative(n, S, y).some(e => e.includes('最多标到')));
});
test('single-card evidence fails', () => {
  const n = good(); n.portraits[0].evidence = [{ response: 'r1', quote: '一只蝙蝠' }, { response: 'r2', quote: '中间像一个女人' }];
  assert.ok(validateNarrative(n, S, y).some(e => e.includes('至少两张')));
});
test('short records cannot claim strong', () => {
  const few = structuralSummary(codes.slice(0, 10), cardOf);
  assert.ok(validateNarrative(good(), { ...S, responses: responses.slice(0, 22) }, { ...few }).some(e => e.includes('不足 14')));
});
test('missing answer to the brought question fails', () => {
  const n = good(); delete n.answer;
  assert.ok(validateNarrative(n, S, y).some(e => e.includes('answer')));
});

test('a quote can come from why a plate was chosen, and only if those were the words', () => {
  const n = good(); n.portraits[0].evidence[1] = { question: 'liked', quote: '空白里有光' };
  assert.deepEqual(validateNarrative(n, S, y), []);
  n.portraits[0].evidence[1] = { question: 'liked', quote: '我从没说过' };
  assert.ok(validateNarrative(n, S, y).some(e => e.includes('选这张图时说的原话')));
});
test('things a Rorschach cannot measure are refused', () => {
  for (const w of ['你是 INTJ。', '细节能力 Top 15%。', '超过 90% 的人。', '杏仁核很活跃。', '潜在自杀概率 11%。', '智商很高。']) {
    const n = good(); n.letter[0] = w;
    assert.ok(validateNarrative(n, S, y).some(e => e.includes('测不出来')), w);
  }
});
test('a claim about real parents is refused; what the plate felt like is not', () => {
  const n = good(); n.choices.father = '你的父亲很严厉，这影响了你。';
  assert.ok(validateNarrative(n, S, y).some(e => e.includes('真实的家人')));
  const m = good(); m.letter[0] = '这说明你的原生家庭缺少沟通。';
  assert.ok(validateNarrative(m, S, y).some(e => e.includes('真实的家人')));
  assert.deepEqual(validateNarrative(good(), S, y), []);
});
test('no note on a question that was not answered', () => {
  const skipped = { ...S, choices: { ...choices, father: { card: null, skipped: true } } };
  assert.ok(validateNarrative(good(), skipped, y).some(e => e.includes('choices.father')));
});
test('short words from a pause, crisis words in any voice and claims about family are all stopped by the gate', () => {
  const said = { ...S, phrases: [...phrases, { id: 'p9', text: '我想死', safety: true }] };
  const withLetter = t => { const n = NARRATIVE_FOR(ids); n.letter = [...n.letter, t]; return n; };
  const errorsFor = (t, st = said) => validateNarrative(withLetter(t), st, y).join(' ');
  assert.match(errorsFor('那时你说我想死，我记住了。'), /安全暂停/);
  assert.match(errorsFor('你提到过活不下去了，这很重要。', S), /危险的词/);
  assert.doesNotMatch(errorsFor('如果最近很难熬，可以打 12356。', S), /危险的词/);
  for (const claim of ['你父母对你很严厉。', '你的童年很孤独。', '你妈妈不够爱你。', '你小时候没有被好好看见。']) assert.match(errorsFor(claim, S), /判断真实的家人/, claim);
  assert.doesNotMatch(errorsFor('你选第三张代表母亲，说她一直在忙。', S), /判断真实的家人/);
});

test('what said in a safety pause stays out of everything written', () => {
  const said = { ...S, phrases: [...phrases, { id: 'p9', text: '最近有时候觉得活着没意思', safety: true }] };
  const n = good(); n.closing = '你说最近有时候觉得活着没意思，我听到了。';
  assert.ok(validateNarrative(n, said, y).some(e => e.includes('安全暂停')));
});
test('the shareable card holds nothing private and every part of the title is sourced', () => {
  const asked = { ...S, question: '为什么我总要拖到最后' };
  const n = good(); n.share[2] = '为什么总要拖到最后';
  assert.ok(validateNarrative(n, asked, y).some(e => e.includes('可以分享的卡片')));
  const dad = good(); dad.share[0] = '靴子很重离我有点远';
  assert.ok(validateNarrative(dad, S, y).some(e => e.includes('可以分享的卡片')));
  const made = good(); made.title.from.quote = '我编的一句';
  assert.ok(validateNarrative(made, S, y).some(e => e.includes('title.from')));
  const long = good(); long.title.text = '一个很长很长很长很长很长的称号';
  assert.ok(validateNarrative(long, S, y).some(e => e.includes('12 个字')));
  const nine = good(); nine.share = ['一行'];
  assert.ok(validateNarrative(nine, S, y).some(e => e.includes('正好 3 行')));
});
test('a long record needs the title, the glance, the two sides and the card; a short one does not', () => {
  for (const k of ['title', 'glance', 'sides', 'share']) {
    const n = good(); delete n[k];
    assert.ok(validateNarrative(n, S, y).some(e => e.startsWith(k)), k);
  }
});

test('report renders self-contained and escapes user text', () => {
  const nasty = { ...S, responses: responses.map((r, i) => (i ? r : { ...r, verbatim: '<img src=x onerror=alert(1)> 一只蝙蝠，翅膀张开' })) };
  const html = renderReport({ state: nasty, codes, summary: y, narrative: good(), plates: fileURLToPath(new URL('../../app/plates/thumbs', import.meta.url)), css: '', js: '' });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.equal((html.match(/data:image\/jpeg;base64/g) || []).length, 10);
  assert.ok(!/src="https?:/.test(html));
  assert.ok(transcriptMarkdown(nasty, codes).includes('编码'));
  assert.ok(transcriptMarkdown(nasty, codes).includes('最能代表父亲：第 IV 张'));
});

test('the report shows each of the four choices and why, and is honest about a skipped one', () => {
  const render = state => renderReport({ state, codes, summary: y, narrative: { ...good(), choices: { liked: good().choices.liked } }, plates: fileURLToPath(new URL('../../app/plates/thumbs', import.meta.url)), css: '', js: '' });
  const html = render({ ...S, choices: { ...choices, father: { card: null, skipped: true } } });
  const part = html.slice(html.indexOf('id="choices"'), html.indexOf('id="sides"'));
  for (const k of ['liked', 'disliked', 'mother']) assert.ok(part.includes(CHOICES[k].why), k);
  assert.ok(!part.includes(CHOICES.father.why) || !html.includes('这一题跳过了') === false);
  assert.ok(part.includes('这一题跳过了'));
  assert.ok(part.includes('不是对他们的判断'));
  assert.ok(html.includes('空白里点灯的人'));
});

test('a plate refused out loud shows what was said, not silence', () => {
  const noIX = responses.filter(r => r.card !== 9);
  const c = codes.filter(k => noIX.some(r => r.id === k.id));
  const state = { ...S, responses: noIX, phrases: [{ id: 'p1', card: 9, phase: 'response', text: '这张看不出来' }], cards: { ...S.cards, 9: { ...S.cards[9], shownAt: 1 } } };
  const html = renderReport({ state, codes: c, summary: structuralSummary(c, id => noIX.find(r => r.id === id).card), narrative: good(), plates: fileURLToPath(new URL('../../app/plates/thumbs', import.meta.url)), css: '', js: '' });
  assert.ok(html.match(/id="plate-9".*?<\/section>/s)[0].includes('这张看不出来'));
});

test('a tidy form that only repeats the words is shown once, under the label', () => {
  const render = r0 => renderReport({ state: { ...S, responses: responses.map((r, i) => (i ? r : { ...r, ...r0 })) }, codes, summary: y, narrative: good(), plates: fileURLToPath(new URL('../../app/plates/thumbs', import.meta.url)), css: '', js: '' });
  const item = html => html.match(new RegExp(`<li id="${responses[0].id}">.*?</li>`))[0];
  const same = item(render({ label: '蝙蝠', verbatim: '一只蝙蝠，翅膀张开', tidy: '一只蝙蝠翅膀张开。' }));
  assert.ok(same.includes('</i>蝙蝠</b><q>一只蝙蝠，翅膀张开</q>'), same);
  const short = item(render({ label: '蝙蝠', verbatim: '蝙蝠。', tidy: null }));
  assert.ok(short.includes('</i>蝙蝠</b>') && !short.includes('<q>'), short);
  const near = item(render({ label: '背靠背的人', verbatim: '这两边也像两个人靠着背睡觉。', tidy: '两边像两个人靠着背睡觉。' }));
  assert.ok(near.includes('</i>背靠背的人</b><q>这两边也像'), near);
  const told = item(render({ label: '蝙蝠', verbatim: '嗯，一只蝙蝠，翅膀张开吧', tidy: '张开翅膀的蝙蝠' }));
  assert.ok(told.includes('张开翅膀的蝙蝠') && told.includes('<q>嗯，一只蝙蝠'), told);
});

test('F cannot sit in a blend', () => {
  const bad = codes.map((c, i) => (i ? c : { ...c, det: ['F', 'FT'] }));
  assert.ok(validateCodes(bad, responses).some(e => e.includes('不能和其他决定因子并列')));
});
test('code warnings point at words the coding missed, and only those', () => {
  const rs = [{ id: 'a', card: 1, verbatim: '两个小女孩在笑', inquiry: [{ text: '扎着辫子' }] }, { id: 'b', card: 2, verbatim: '一个花瓶', inquiry: [{ text: '形状像' }] }];
  const base = { loc: 'D', dq: 'o', fq: 'o', content: ['H'], evidence: 'x' };
  const warned = codeWarnings([{ id: 'a', det: ['F'], ...base }, { id: 'b', det: ['F'], ...base }], rs);
  assert.deepEqual(warned, ['a：原话有「笑」，编码里没有动作']);
  assert.deepEqual(codeWarnings([{ id: 'a', det: ['Ma'], ...base }], rs), []);
});

test('codes: duplicates, non-booleans and unknown fields are refused', () => {
  const rs = [{ id: 'r1', card: 1 }];
  const good = { id: 'r1', loc: 'W', dq: 'o', det: ['F'], fq: 'o', content: ['A'], evidence: '形状', pop: true };
  assert.deepEqual(validateCodes([good], rs), []);
  assert.ok(validateCodes([good, good], rs).some(e => e.includes('两次')));
  assert.ok(validateCodes([{ ...good, pop: 'P' }], rs).some(e => e.includes('pop')));
  assert.ok(validateCodes([{ ...good, pair: 1 }], rs).some(e => e.includes('pair')));
  assert.ok(validateCodes([{ ...good, note: 'x' }], rs).some(e => e.includes('note')));
});

const miniS = (n, cards = n) => ({ question: null, responses: Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, card: (i % cards) + 1, verbatim: `一只蝙蝠${i}`, inquiry: [] })) });
const miniNote = ev => ({ letter: ['一', '二'], portraits: [{ domain: 'processing', title: '观察', body: '看到了。', confidence: 'tentative', evidence: ev }], invitations: [{ text: '再看。' }] });
const miniSum = { validity: { enough: false }, R: 2 };
test('a short record gets a shorter letter, not a refusal', () => {
  assert.deepEqual(validateNarrative(miniNote([{ response: 'r1', quote: '蝙蝠' }]), miniS(2, 1), miniSum), []);
});
test('a short record across two plates still needs evidence from both when it cites two', () => {
  const errors = validateNarrative(miniNote([{ response: 'r1', quote: '蝙蝠' }, { response: 'r3', quote: '蝙蝠' }]), miniS(4, 2), miniSum);
  assert.ok(errors.some(e => e.includes('两张')), errors.join());
});
test('no responses at all: a letter can still be written', () => {
  assert.deepEqual(validateNarrative({ letter: ['一', '二'], portraits: [], invitations: [{ text: '再看。' }] }, miniS(0), { validity: { enough: false }, R: 0 }), []);
});
test('a long record keeps the full gate', () => {
  const errors = validateNarrative(miniNote([{ response: 'r1', quote: '蝙蝠' }]), miniS(10, 5), miniSum);
  assert.ok(errors.some(e => e.includes('portraits 要 3')));
  assert.ok(errors.some(e => e.includes('两条证据')));
});
test('a quote of nothing but punctuation is not a quote', () => {
  const errors = validateNarrative(miniNote([{ response: 'r1', quote: '，。' }]), miniS(2, 1), miniSum);
  assert.ok(errors.some(e => e.includes('不是')), errors.join());
});

// ---------- 墨型 ----------
const summaryOf = over => ({ R: 20, processing: { W: 8, D: 10, Dd: 2 }, affect: { EB: [4, 2] }, validity: { pureF: 9 }, mediation: { fq: { '+': 0, o: 14, u: 6, '-': 0, none: 0 } }, ...over });
test('the four letters follow the record, and each cut line sits where it says', () => {
  assert.equal(inkType(summaryOf()).code, 'WMFP');
  assert.equal(inkType(summaryOf({ processing: { W: 7, D: 11, Dd: 2 } })).code[0], 'D');
  assert.equal(inkType(summaryOf({ affect: { EB: [2, 4] } })).code[1], 'C');
  assert.equal(inkType(summaryOf({ validity: { pureF: 8 } })).code[2], 'B');
  assert.equal(inkType(summaryOf({ mediation: { fq: { '+': 0, o: 13, u: 5, '-': 2, none: 0 } } })).code[3], 'U');
});
test('shares add up and always lean toward the letter that was given', () => {
  for (const W of [0, 4, 8, 9, 15]) for (const pureF of [0, 8, 9, 20]) {
    const t = inkType(summaryOf({ processing: { W, D: 20 - W, Dd: 0 }, validity: { pureF } }));
    for (const a of t.axes) {
      assert.equal(a.leftPct + a.rightPct, 100);
      assert.ok(a.letter === a.left.letter ? a.leftPct >= 50 : a.rightPct >= 50, `${a.letter} ${a.leftPct}`);
    }
  }
});
test('a tie is said to be a tie, and a record too short has no type', () => {
  assert.equal(inkType(summaryOf({ affect: { EB: [3, 3] } })).axes[1].even, true);
  assert.equal(inkType(summaryOf({ R: 7 })), null);
});
test('sixteen distinct types, each with a mirror, and none says what the gate forbids', () => {
  assert.equal(Object.keys(INK_TYPES).length, 16);
  assert.equal(new Set(Object.values(INK_TYPES).map(t => t.name)).size, 16);
  for (const t of Object.values(INK_TYPES)) for (const k of ['line', 'gift', 'shade', 'heard', 'with']) {
    assert.ok(t[k], `${t.name} ${k}`);
    const n = good(); n.closing = t[k].replaceAll('「', '').replaceAll('」', '');
    assert.deepEqual(validateNarrative(n, S, y), [], `${t.name} ${k}`);
  }
});

// ---------- what the letter has to do ----------
const says = (n, text) => validateNarrative(n, S, y).some(e => e.includes(text));
test('someone who took the whole test is told one line, three things, and what lies under the surface', () => {
  for (const [field, text] of [['seen', 'seen'], ['takeaways', 'takeaways'], ['undercurrents', 'undercurrents'], ['type', 'type.note']]) {
    const n = good(); delete n[field];
    assert.ok(says(n, text), field);
  }
});
test('in a letter, 「」 only ever holds what the person said', () => {
  const n = good(); n.letter[1] = '你说过「我从来没有说过这句话」。';
  assert.ok(says(n, '不是对方说过的话'));
  const few = good(); few.letter = ['没有引用的第一段，==这里是重点==。', '没有引用的第二段，==这里也是==。'];
  assert.ok(says(few, '三句原话'));
});
test('a lead stays a lead: certainty about hidden motives is refused', () => {
  for (const w of ['你的潜意识里害怕失去。', '这说明你很孤独。', '这一定是因为过去。', '你压抑了愤怒，被压抑的东西会回来。']) {
    const n = good(); n.closing = w;
    assert.ok(says(n, '线索说成了事实'), w);
  }
});
test('an undercurrent is a guess with another explanation and a question', () => {
  const unhedged = good(); unhedged.undercurrents[0].maybe = '你担心的时候会==把它放好==。';
  assert.ok(says(unhedged, '要写成猜想'));
  const sameTwice = good(); sameTwice.undercurrents[0].other = sameTwice.undercurrents[0].maybe;
  assert.ok(says(sameTwice, '真正不同的另一种解释'));
  const noAsk = good(); noAsk.undercurrents[0].ask = '想想这件事。';
  assert.ok(says(noAsk, '问对方的问题'));
  const onePlate = good(); onePlate.undercurrents[0].evidence = [{ response: ids[21], quote: '差一点就断了' }, { response: ids[21], quote: '绷得很紧' }];
  assert.ok(says(onePlate, '两张不同的图'));
});
test('a striking lead has to be used or dismissed with a reason', () => {
  const lead = { id: 'pause-1', kind: 'pause', weight: 'high', cards: [9], text: '第 IX 张开口前停了很久', responses: [] };
  const n = good();
  assert.ok(validateNarrative(n, S, y, [lead]).some(e => e.includes('pause-1')));
  n.undercurrents[0].signals = ['pause-1'];
  assert.ok(!validateNarrative(n, S, y, [lead]).some(e => e.includes('没有处理')));
  const waved = good(); waved.undercurrents.forEach(u => { u.signals = ['pause-1']; }); waved.undercurrents[0].signals = ['nope-9'];
  assert.ok(validateNarrative(waved, S, y, [lead]).some(e => e.includes('没有线索 nope-9')));
  const dismissed = good(); dismissed.undercurrents.forEach(u => { u.signals = ['mid-1']; }); dismissed.dismissed = [{ signal: 'pause-1', why: '第九张本来就最难' }];
  assert.ok(!validateNarrative(dismissed, S, y, [lead, { ...lead, id: 'mid-1', weight: 'mid' }]).some(e => e.includes('没有处理')));
  dismissed.dismissed[0].why = '不算';
  assert.ok(validateNarrative(dismissed, S, y, [lead, { ...lead, id: 'mid-1', weight: 'mid' }]).some(e => e.includes('为什么不算')));
});
test('every plate with words gets a note, and the note has to be about that plate', () => {
  const missing = good(); delete missing.plateNotes[6];
  assert.ok(says(missing, 'plateNotes.6'));
  const generic = good(); generic.plateNotes[6] = '这一张让我想了很久。';
  assert.ok(says(generic, 'plateNotes.6: 小注要用上'));
  const twin = good(); twin.plateNotes[5] = twin.plateNotes[10];
  assert.ok(says(twin, '一模一样'));
});
test('marks are few and short, and never on what gets passed around', () => {
  const many = good(); many.letter[1] = '==一处==，==两处==，==三处==，「一只蝙蝠」';
  assert.ok(says(many, '最多标两处'));
  const long = good(); long.letter[1] = `==${'很长'.repeat(14)}==，「一只蝙蝠」`;
  assert.ok(says(long, '不超过 24 个字'));
  const none = good(); none.letter = none.letter.map(t => t.replaceAll('==', ''));
  assert.ok(says(none, '两处重点'));
  const card = good(); card.share[0] = '==先看全局==';
  assert.ok(says(card, '不能用 == 标记'));
});
test('a lecture and a stock line are refused; a type that is not theirs is a slip', () => {
  const lecture = good(); lecture.closing = '你应该多关心自己。';
  assert.ok(says(lecture, '教对方做事'));
  const stock = good(); stock.closing = '相信自己，你值得。';
  assert.ok(says(stock, '谁都能说'));
  const wrong = good(); wrong.type.note = `==你是造梦人==。${good().type.note}`;
  assert.ok(says(wrong, '墨型不是「造梦人」'));
});
test('the page shows marks and quotes as such, with no raw markup, and puts the one line first', () => {
  const html = renderReport({ state: S, codes, summary: y, narrative: good(), signals: [{ id: 'a-1', weight: 'high', text: '<线索>', cards: [], responses: [] }], plates: fileURLToPath(new URL('../../app/plates/thumbs', import.meta.url)), css: '', js: '' });
  assert.ok(html.includes('<mark>'));
  const main = html.slice(html.indexOf('<main>'));
  assert.ok(!main.includes('=='));
  assert.ok(main.indexOf('id="seen"') < main.indexOf('id="type"') && main.indexOf('id="type"') < main.indexOf('id="letter"'));
  assert.ok(html.includes('&lt;线索&gt;') && !html.includes('<线索>'));
  assert.ok(html.includes('没有科学验证'));
});

// ---------- leads ----------
const leadsFor = ({ responses: rs, codes: cs, cards: over = {}, ...rest }) => {
  const cards = Array.from({ length: 10 }, (_, i) => ({ card: i + 1, chromatic: [2, 3, 8, 9, 10].includes(i + 1), timing: { rtMs: 4000, durationMs: 30000, shownMs: 1 }, view: { rotations: 0, zoomMax: 1 }, removedStrokes: [], ...over[i + 1] }));
  return computeSignals({ phrases: [], strokes: [], choices: {}, responses: rs, ...rest }, cs, { cards });
};
const leadWord = (id, card, verbatim) => ({ id, card, verbatim, label: verbatim.slice(0, 6), phrases: [`${id}p`], inquiry: [] });
const leadCode = (id, over = {}) => ({ id, loc: 'D', dq: 'o', det: ['F'], fq: 'o', content: ['A'], ...over });
const tenPlates = Array.from({ length: 12 }, (_, i) => leadWord(`r${i + 1}`, (i % 10) + 1, ['一只鸟', '一片叶子', '一棵树', '一块石头'][i % 4]));
const tenCodes = tenPlates.map(r => leadCode(r.id));
const has = (list, kind, text) => list.some(x => x.kind === kind && x.text.includes(text));
test('a pause is measured against the person, not against anyone else', () => {
  const list = leadsFor({ responses: tenPlates, codes: tenCodes, cards: { 7: { timing: { rtMs: 20000, durationMs: 30000, shownMs: 1 } } } });
  const pause = list.find(x => x.kind === 'pause');
  assert.equal(pause.weight, 'high');
  assert.deepEqual(pause.cards, [7]);
  assert.ok(pause.text.includes('5.0 倍'));
  assert.ok(!leadsFor({ responses: tenPlates, codes: tenCodes }).some(x => x.kind === 'pause'));
});
test('a word that comes back across plates is found, even when the question used it', () => {
  const rs = [1, 3, 5, 7].map((n, i) => leadWord(`r${i + 1}`, n, '两个人隔着一堵东西')).concat(tenPlates.slice(0, 8).map((r, i) => ({ ...r, id: `x${i}` })));
  const cs = rs.map(r => leadCode(r.id));
  const list = leadsFor({ responses: rs, codes: cs, question: '为什么总是隔着' });
  const m = list.find(x => x.kind === 'motif' && x.text.includes('隔着'));
  assert.equal(m.weight, 'high');
  assert.ok(m.text.includes('问题里也有'));
  assert.ok(has(list, 'theme', '距离和阻隔'));
  assert.ok(list.some(x => x.kind === 'echo' && x.text.includes('带来的问题')));
});
test('what never came up is itself a lead', () => {
  const list = leadsFor({ responses: tenPlates, codes: tenCodes });
  assert.ok(has(list, 'absent', '没有出现一个人'));
  assert.ok(has(list, 'absent', '没有任何东西在动'));
  assert.ok(has(list, 'absent', '没有用上颜色'));
  const withColor = tenCodes.map((c, i) => (i === 1 ? { ...c, det: ['FC'] } : c));
  assert.ok(!has(leadsFor({ responses: tenPlates, codes: withColor }), 'absent', '没有用上颜色'));
});
test('a plate passed over, words about their own life, and a retreat after something charged', () => {
  const rs = tenPlates.filter(r => r.card !== 6);
  const cs = rs.map(r => leadCode(r.id));
  const phrases = [{ id: 'a', card: 4, phase: 'response', text: '这个让我想起我妈' }, { id: 'b', card: 5, phase: 'response', text: '算了算了', safety: true }];
  const list = leadsFor({ responses: rs, codes: cs, phrases });
  assert.ok(list.some(x => x.kind === 'silent' && x.cards[0] === 6 && x.weight === 'high'));
  assert.ok(list.some(x => x.kind === 'aside' && x.weight === 'high' && x.text.includes('想起我妈')));
  assert.ok(!list.some(x => x.text.includes('算了算了')), 'words in a safety pause are never used');
  const charged = tenPlates.map((r, i) => leadCode(r.id, i % 2 ? { det: ['F'] } : { det: ['FC'], special: ['MOR'] }));
  assert.ok(leadsFor({ responses: tenPlates, codes: charged }).some(x => x.kind === 'sequence'));
});
test('the four choices are read against what happened on those plates', () => {
  const pick = { father: { card: 4, askedAt: 1000, chosenAt: 41000 }, disliked: { card: 4, askedAt: 1000, chosenAt: 4000 } };
  const cards = { 4: { timing: { rtMs: 20000, durationMs: 30000, shownMs: 1 } } };
  const rs = tenPlates.concat(leadWord('r20', 2, '离得很远的一个人'), leadWord('r21', 8, '很远很远的山'));
  const list = leadsFor({ responses: rs, codes: rs.map(r => leadCode(r.id)), cards, choices: pick, phrases: [{ question: 'father', text: '离我很远' }] });
  assert.ok(has(list, 'choice', '选了同一张'));
  assert.ok(has(list, 'choice', '停得最久'));
  assert.ok(has(list, 'choice', '用了 40 秒'));
  assert.ok(list.some(x => x.kind === 'echo' && x.weight === 'high' && x.text.includes('父亲')));
});

// ---------- what can be passed on ----------
test('what gets shared is the type and a way in, and nothing from the record', () => {
  const words = shareWords(y.inkType);
  assert.ok(words.includes(y.inkType.name) && words.includes(y.inkType.code));
  assert.ok(words.includes(PROJECT.skill));
  assert.ok(words.includes('不是诊断'));
  assert.ok(!words.includes('你讲') && words.includes('我'), 'in their own voice');
  const html = renderReport({ state: S, codes, summary: y, narrative: good(), plates: fileURLToPath(new URL('../../app/plates/thumbs', import.meta.url)), css: '', js: '' });
  const card = html.match(/<script type="application\/json" id="shareData">(.*?)<\/script>/s)[1];
  const box = html.match(/<textarea id="shareText"[^>]*>(.*?)<\/textarea>/s)[1];
  const n = good();
  for (const private_ of [NAME, QUESTION, n.title.text, ...n.share, ...PROTOCOL.map(p => p.say), ...Object.values(CHOICES).map(c => c.why)]) {
    assert.ok(!card.includes(private_), `card: ${private_}`);
    assert.ok(!box.includes(private_), `words: ${private_}`);
  }
  assert.ok(shareWords(null).includes(PROJECT.skill), 'a short record can still pass on the way in');
});
