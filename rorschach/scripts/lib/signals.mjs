// What someone left in the record without meaning to: pauses, repeated words, what never came up, what the
// hand did. These are leads for the agent to read, never findings. A high-weight lead has to be used in the
// report or dismissed with a reason, so nothing striking is skipped by accident.

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const LIST = cards => cards.map(n => ROMAN[n]).join('、');
const ASK = { liked: '最喜欢', disliked: '最不喜欢', father: '最能代表父亲', mother: '最能代表母亲' };
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[s.length >> 1] + s[(s.length - 1) >> 1]) / 2 : 0; };
const sec = ms => `${Math.round(ms / 1000)} 秒`;

const STOP = new Set('一个 两个 三个 这个 那个 一只 两只 一些 一点 有点 好像 像是 看起来 起来 看着 对着 有着 中间 上面 下面 左边 右边 两边 旁边 这里 那里 这边 那边 这张 那张 部分 感觉 觉得 就是 还是 可能 因为 所以 什么 东西 一样 颜色 形状 样子 地方 这块 那块 这些 那些 不是 有个 是个 整个 下来 上去 过来 它们 他们 我们 自己 看到 看见 说不 不上 上来 下一 一张 的话 然后 还有 没有 这样 那样 有些 一下 时候 比较 非常 特别 外面 里面 下边 上边 白色 黑色 红色'.split(' '));
const FUNCTION = /[的了是这那一个吗呢吧啊呀和与或也都就很在有]/;
const usable = g => !/^[只片块棵条张朵根]/.test(g) && (g.length === 2 ? !STOP.has(g) && !FUNCTION.test(g) : !/[的了这那]/.test(g) && !FUNCTION.test(g[0]) && !FUNCTION.test(g.at(-1)) && !STOP.has(g.slice(0, 2)) && !STOP.has(g.slice(-2)));
function grams(text) {
  const out = new Set();
  for (const run of String(text).match(/[一-鿿]+/g) || []) for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= run.length; i++) { const g = run.slice(i, i + n); if (usable(g)) out.add(g); }
  return out;
}

// Families of images. A word that repeats is easy to find; the same idea in different words is not.
const THEMES = [
  ['距离和阻隔', /隔|雾|远处|很远|墙|窗|玻璃|帘|纱|听不见|够不着|看不清|挡/g],
  ['受伤和破损', /破|裂|断|伤|血|碎|烂|骨头|枯|死|腐/g],
  ['危险和攻击', /怪物|怪兽|咬|撕|爪|牙|枪|刀|爆炸|火|烧|尖|吓|恐怖|可怕/g],
  ['遮蔽和保护', /壳|盔甲|披风|面具|盾|伞|山洞|洞|藏|躲|遮|裹/g],
  ['注视', /眼睛|盯|脸|镜子|看着我|望着/g],
  ['靠近和相连', /抱|牵|手拉手|靠|一起|依偎|连着|互相|面对面/g],
  ['离开', /飞走|逃|跑|离开|走开|远去|消失/g],
  ['悬着和下坠', /挂|吊|掉|下坠|悬|摇摇欲坠/g],
  ['光', /光|灯|亮|太阳|星|火苗/g],
  ['独自', /一个人|独自|孤|没人|空的|空荡/g],
  ['大和小', /巨大|高大|压着|俯视|小孩|渺小|很大/g],
];
const SPEECH = [
  ['hedge', '含糊的说法', /可能|好像|也许|大概|不确定|说不清|说不上来|不知道|或许|不太确定/g, 4],
  ['repair', '改口', /不对|也不是|其实|算了|怎么说|或者说|我是说|应该说/g, 2],
  ['minimize', '把它说小', /就是个|而已|没什么|随便|乱七八糟|不重要|没啥/g, 2],
  ['soften', '先否认再说', /不可怕|不吓人|没那么|也还好|还好吧/g, 1],
];
const SELF = /我(小时候|妈|爸|爷|奶|外婆|外公|姥|家|老公|老婆|爱人|男朋友|女朋友|对象|前任|孩子|女儿|儿子|工作|公司|老板|同事|以前|记得|想起|最近)/;
const RETRACT = /忘了|不记得|我说过|没说过|刚才说错|不是这个/;

export function computeSignals(S, codes, protocol) {
  const out = [], seen = {};
  const add = (kind, weight, cards, text, responses = []) => { seen[kind] = (seen[kind] || 0) + 1; out.push({ id: `${kind}-${seen[kind]}`, kind, weight, cards, text, responses }); };
  const cards = protocol.cards, R = codes.length;
  const byId = Object.fromEntries(codes.map(c => [c.id, c]));
  const responses = S.responses.filter(r => byId[r.id]);
  const on = n => responses.filter(r => r.card === n);
  const wordsOf = r => [r.verbatim, ...(r.inquiry || []).map(x => x.text)].join(' ');
  const textOn = n => on(n).map(wordsOf).join(' ');
  const reasonFor = k => (S.phrases || []).filter(p => p.question === k && !p.command && !p.safety).map(p => p.text).join(' ');
  const answered = Object.keys(ASK).filter(k => S.choices?.[k]?.card);

  // ---------- pauses ----------
  const timed = cards.filter(c => c.timing?.rtMs != null);
  const rtMid = median(timed.map(c => c.timing.rtMs));
  timed.map(c => ({ n: c.card, rt: c.timing.rtMs, x: c.timing.rtMs / (rtMid || 1) }))
    .filter(c => c.x >= 2 && c.rt - rtMid >= 4000).sort((a, b) => b.x - a.x).slice(0, 2)
    .forEach(c => add('pause', c.x >= 3 && c.n !== 1 ? 'high' : 'mid', [c.n], `第 ${ROMAN[c.n]} 张开口前停了 ${sec(c.rt)}，是你自己中位数（${sec(rtMid)}）的 ${c.x.toFixed(1)} 倍`, on(c.n).map(r => r.id)));
  const lingered = cards.filter(c => c.timing?.durationMs), stayMid = median(lingered.map(c => c.timing.durationMs));
  lingered.filter(c => c.timing.durationMs >= stayMid * 2 && c.timing.durationMs - stayMid >= 15000).slice(0, 2)
    .forEach(c => add('linger', 'mid', [c.card], `第 ${ROMAN[c.card]} 张一共停了 ${sec(c.timing.durationMs)}，比其他图长得多`, on(c.card).map(r => r.id)));

  // ---------- what stayed unsaid ----------
  cards.filter(c => c.timing?.shownMs != null && !on(c.card).length).forEach(c => add('silent', 'high', [c.card], `第 ${ROMAN[c.card]} 张没有留下回应`));
  if (R >= 10) {
    const humans = codes.filter(c => c.content.some(x => ['H', 'Hd', '(H)', '(Hd)'].includes(x)));
    if (!humans.length) add('absent', 'high', [], '整场没有出现一个人，也没有人的一部分');
    else if (!codes.some(c => c.content.includes('H'))) add('absent', 'mid', [], '出现的人都是假想的或只露一部分，没有一个完整的真人', humans.map(c => c.id));
    if (!codes.some(c => c.det.some(d => /^(M|FM|m)/.test(d)))) add('absent', 'high', [], '整场没有任何东西在动');
    const onColor = codes.filter(c => [2, 3, 8, 9, 10].includes(responses.find(r => r.id === c.id).card));
    if (onColor.length >= 4 && !onColor.some(c => c.det.some(d => /^(FC|CF|C|Cn)$/.test(d)))) add('absent', 'high', [2, 3, 8, 9, 10], `五张彩色图上说了 ${onColor.length} 样东西，一次也没有用上颜色`, onColor.map(c => c.id));
    const M = codes.flatMap(c => c.det.filter(d => /^M/.test(d)));
    if (M.length >= 2 && M.every(d => /^Mp/.test(d))) add('absent', 'mid', [], `看到人的 ${M.length} 次都是静止的，没有人在主动做什么`);
  }

  // ---------- words that come back ----------
  const seenOn = new Map();
  for (let n = 1; n <= 10; n++) for (const g of grams(textOn(n))) { if (!seenOn.has(g)) seenOn.set(g, new Set()); seenOn.get(g).add(n); }
  const motifs = [...seenOn].map(([g, set]) => ({ g, cards: [...set] })).filter(m => m.cards.length >= 3 || (m.cards.length === 2 && m.g.length >= 3));
  const kept = motifs.filter(m => !motifs.some(o => o !== m && ((o.g.includes(m.g) && o.cards.length === m.cards.length) || (m.g.includes(o.g) && m.cards.every(n => o.cards.includes(n)) && o.cards.length > m.cards.length)))).sort((a, b) => b.cards.length - a.cards.length || b.g.length - a.g.length).slice(0, 4);
  const whyTexts = answered.map(k => [k, reasonFor(k)]);
  for (const m of kept) {
    const overlaps = t => [...grams(t)].some(x => m.g.includes(x));
    const echoed = whyTexts.filter(([, t]) => overlaps(t)).map(([k]) => ASK[k]);
    const asked = !!S.question && overlaps(S.question);
    const weight = m.cards.length >= 4 || echoed.length || asked ? 'high' : m.cards.length === 3 ? 'mid' : 'low';
    add('motif', weight, m.cards, `「${m.g}」出现在第 ${LIST(m.cards)} 张${echoed.length ? `，选「${echoed.join('」「')}」时又说了一次` : ''}${asked ? '，你带来的问题里也有它' : ''}`, m.cards.flatMap(n => on(n).filter(r => wordsOf(r).includes(m.g)).map(r => r.id)));
  }
  for (const [name, re] of THEMES) {
    const hit = [];
    const words = new Set();
    for (let n = 1; n <= 10; n++) { const m = textOn(n).match(re); if (m) { hit.push(n); m.forEach(w => words.add(w)); } }
    if (hit.length >= 3) add('theme', hit.length >= 4 ? 'high' : 'mid', hit, `「${name}」这类画面在第 ${LIST(hit)} 张都出现了（${[...words].slice(0, 5).join('、')}）`, hit.flatMap(n => on(n).filter(r => wordsOf(r).match(re)).map(r => r.id)));
  }

  // ---------- what the coding shows ----------
  const withSpecial = x => codes.filter(c => (c.special || []).includes(x)).map(c => c.id);
  const withContent = (...xs) => codes.filter(c => c.content.some(x => xs.includes(x))).map(c => c.id);
  const coded = [['受伤或破损的画面', withSpecial('MOR'), 2, 'high'], ['对抗的画面', withSpecial('AG'), 2, 'mid'], ['合作的画面', withSpecial('COP'), 2, 'mid'], ['血、火或爆炸', withContent('Bl', 'Fi', 'Ex'), 2, 'mid'], ['身体内部', withContent('An', 'Xy'), 2, 'mid'], ['食物', withContent('Fd'), 2, 'mid'], ['说到自己经历的话', withSpecial('PER'), 2, 'mid'], ['镜子或倒影', codes.filter(c => c.det.some(d => /^(Fr|rF)$/.test(d))).map(c => c.id), 1, 'mid'], ['隔着距离看', codes.filter(c => c.det.some(d => /^(FD|FV|VF|V)$/.test(d))).map(c => c.id), 2, 'mid']];
  for (const [word, ids, min, weight] of coded) if (ids.length >= min) add('content', weight, [...new Set(ids.map(id => responses.find(r => r.id === id).card))], `${word}出现 ${ids.length} 次`, ids);

  // ---------- how it was said ----------
  const said = (S.phrases || []).filter(p => !p.command && !p.safety && ['response', 'inquiry'].includes(p.phase));
  for (const [kind, word, re, min] of SPEECH) {
    const hits = said.flatMap(p => (p.text.match(re) || []).map(w => ({ w, card: p.card })));
    if (hits.length >= min) {
      const hitCards = [...new Set(hits.map(h => h.card))];
      add(kind, kind === 'soften' ? 'high' : 'mid', hitCards, `${word} ${hits.length} 次（${[...new Set(hits.map(h => h.w))].slice(0, 4).join('、')}），在第 ${LIST(hitCards)} 张`);
    }
  }
  const owned = new Set(responses.flatMap(r => [...(r.phrases || []), ...(r.inquiry || []).map(x => x.phrase)]));
  said.filter(p => !owned.has(p.id)).slice(0, 4).forEach(p => {
    const self = SELF.test(p.text);
    add('aside', self ? 'high' : 'mid', [p.card], `第 ${ROMAN[p.card]} 张时说了一句不算回应的话：「${p.text.slice(0, 40)}」`);
  });
  said.filter(p => owned.has(p.id) && SELF.test(p.text)).slice(0, 2).forEach(p => add('self', 'high', [p.card], `看第 ${ROMAN[p.card]} 张时讲到了自己的事：「${p.text.slice(0, 40)}」`));
  responses.filter(r => (r.inquiry || []).some(x => RETRACT.test(x.text))).slice(0, 2).forEach(r => add('retract', 'mid', [r.card], `回看「${r.label || r.verbatim.slice(0, 12)}」时，你不太认这句了`, [r.id]));

  // ---------- colour against black and white ----------
  const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const chrom = timed.filter(c => c.chromatic).map(c => c.timing.rtMs), plain = timed.filter(c => !c.chromatic).map(c => c.timing.rtMs);
  if (chrom.length >= 3 && plain.length >= 3) {
    const a = mean(chrom), b = mean(plain);
    if (a >= b * 1.5 && a - b >= 3000) add('color', 'mid', [2, 3, 8, 9, 10], `彩色图平均 ${sec(a)} 才开口，黑白图只要 ${sec(b)}`);
    if (b >= a * 1.5 && b - a >= 3000) add('color', 'mid', [1, 4, 5, 6, 7], `黑白图平均 ${sec(b)} 才开口，彩色图只要 ${sec(a)}`);
  }
  const late = responses.filter(r => r.card >= 8).length / 3, early = responses.filter(r => r.card < 8).length / 7;
  if (R >= 10 && early && late / early <= .6) add('color', 'mid', [8, 9, 10], `最后三张全彩的图，平均每张说得比前七张少很多（${late.toFixed(1)} 对 ${early.toFixed(1)}）`);
  if (R >= 10 && early && late / early >= 1.5) add('color', 'mid', [8, 9, 10], `到了最后三张全彩的图，话明显变多（每张 ${late.toFixed(1)} 对 ${early.toFixed(1)}）`);
  const loose = list => (list.length ? list.filter(r => ['u', '-'].includes(byId[r.id].fq)).length / list.length : 0);
  const colored = responses.filter(r => [2, 3, 8, 9, 10].includes(r.card)), grey = responses.filter(r => ![2, 3, 8, 9, 10].includes(r.card));
  if (colored.length >= 4 && grey.length >= 4 && loose(colored) - loose(grey) >= .3) add('color', 'mid', [2, 3, 8, 9, 10], '一碰到颜色，看到的东西就更只属于你自己，和形状也离得更远');

  // ---------- order ----------
  const ordered = [...responses].sort((a, b) => a.card - b.card || S.responses.indexOf(a) - S.responses.indexOf(b));
  const charged = c => (c.special || []).some(x => x === 'MOR' || x === 'AG') || c.content.some(x => ['Bl', 'Fi', 'Ex'].includes(x)) || c.fq === '-';
  const retreats = ordered.slice(1).filter((r, i) => charged(byId[ordered[i].id]) && byId[r.id].det.length === 1 && byId[r.id].det[0] === 'F');
  if (retreats.length >= 2) add('sequence', 'mid', [...new Set(retreats.map(r => r.card))], `${retreats.length} 次，刚说完一个刺激的画面，下一个就回到只看形状`, retreats.map(r => r.id));
  const sizes = Array.from({ length: 10 }, (_, i) => on(i + 1).reduce((s, r) => s + r.verbatim.length, 0));
  const front = mean(sizes.slice(0, 5)), back = mean(sizes.slice(5));
  if (R >= 10 && front && back / front <= .55) add('trend', 'mid', [], '越到后面话越少');
  if (R >= 10 && front && back / front >= 1.8) add('trend', 'mid', [], '越到后面话越多');

  // ---------- the hand ----------
  cards.filter(c => (c.view?.rotations || 0) >= 3).slice(0, 2).forEach(c => add('hand', 'mid', [c.card], `第 ${ROMAN[c.card]} 张转动了 ${c.view.rotations} 次`, on(c.card).map(r => r.id)));
  cards.filter(c => (c.view?.zoomMax || 0) >= 2).slice(0, 2).forEach(c => add('hand', 'mid', [c.card], `第 ${ROMAN[c.card]} 张放大到 ${c.view.zoomMax.toFixed(1)} 倍去看`, on(c.card).map(r => r.id)));
  cards.filter(c => (c.removedStrokes || []).filter(s => s.by !== 'examiner').length).slice(0, 2).forEach(c => add('hand', 'mid', [c.card], `第 ${ROMAN[c.card]} 张圈了又擦掉 ${c.removedStrokes.filter(s => s.by !== 'examiner').length} 笔`, on(c.card).map(r => r.id)));
  const strokeOf = id => (S.strokes || []).find(s => s.response === id && s.by === 'user' && s.geo);
  responses.filter(r => { const s = strokeOf(r.id), loc = byId[r.id].loc; return s && ((loc === 'W' && s.geo.locationHint !== 'W') || (loc !== 'W' && s.geo.locationHint === 'W')); }).slice(0, 2)
    .forEach(r => add('hand', 'mid', [r.card], `「${r.label || r.verbatim.slice(0, 12)}」说的范围和实际圈的范围不一样，编码是 ${byId[r.id].loc}，圈的像 ${strokeOf(r.id).geo.locationHint}`, [r.id]));

  // ---------- the four choices ----------
  const slowest = timed.length ? timed.reduce((a, b) => (a.timing.rtMs >= b.timing.rtMs ? a : b)).card : null;
  const pick = k => S.choices?.[k]?.card;
  for (const [a, b] of [['father', 'mother'], ['father', 'disliked'], ['mother', 'disliked'], ['father', 'liked'], ['mother', 'liked'], ['liked', 'disliked']]) {
    if (pick(a) && pick(a) === pick(b)) add('choice', 'high', [pick(a)], `「${ASK[a]}」和「${ASK[b]}」选了同一张，第 ${ROMAN[pick(a)]} 张`);
  }
  for (const k of answered) {
    const n = pick(k);
    if (n === slowest && (timed.find(c => c.card === n)?.timing.rtMs || 0) >= rtMid * 1.5) add('choice', 'high', [n], `选「${ASK[k]}」的第 ${ROMAN[n]} 张，也是一开始你开口前停得最久的一张`, on(n).map(r => r.id));
    if (!on(n).length) add('choice', 'high', [n], `选「${ASK[k]}」的第 ${ROMAN[n]} 张，当时你一个回应也没有留下`);
  }
  const taken = answered.map(k => ({ k, ms: S.choices[k].chosenAt && S.choices[k].askedAt ? S.choices[k].chosenAt - S.choices[k].askedAt : null })).filter(x => x.ms != null);
  if (taken.length >= 2) {
    const max = taken.reduce((a, b) => (a.ms >= b.ms ? a : b)), min = taken.reduce((a, b) => (a.ms <= b.ms ? a : b));
    if (max.ms >= 15000 && max.ms >= min.ms * 2.5) add('choice', 'mid', [pick(max.k)], `选「${ASK[max.k]}」用了 ${sec(max.ms)}，选「${ASK[min.k]}」只用了 ${sec(min.ms)}`);
  }
  for (const k of Object.keys(ASK)) if (S.choices?.[k]?.skipped) add('choice', k === 'father' || k === 'mother' ? 'mid' : 'low', [], `「${ASK[k]}」这一题跳过了`);
  const echoed = new Set();
  for (const [k, why] of whyTexts) for (const [name, re] of THEMES) {
    const m = why.match(re);
    if (!m || echoed.has(`${k}${name}`)) continue;
    const hit = [];
    for (let n = 1; n <= 10; n++) if (textOn(n).match(re)) hit.push(n);
    if (hit.length < 2) continue;
    echoed.add(`${k}${name}`);
    add('echo', k === 'father' || k === 'mother' ? 'high' : 'mid', [pick(k), ...hit.filter(n => n !== pick(k))], `说「${ASK[k]}」的理由时用了「${m[0]}」，同一类画面也出现在第 ${LIST(hit)} 张（${name}）`);
  }
  if (S.question) for (const [name, re] of THEMES) {
    const m = S.question.match(re);
    if (!m) continue;
    const hit = [];
    for (let n = 1; n <= 10; n++) if (textOn(n).match(re)) hit.push(n);
    if (hit.length >= 2) add('echo', 'high', hit, `你带来的问题里有「${m[0]}」，同一类画面也出现在第 ${LIST(hit)} 张（${name}）`);
  }

  const rank = { high: 0, mid: 1, low: 2 };
  return out.sort((a, b) => rank[a.weight] - rank[b.weight]).slice(0, 30);
}
