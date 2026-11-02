// Narrative validation (the precision gate) and the self-contained report page.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCrisis } from './safety.mjs';
import { capAllows } from './scoring.mjs';
import { INK_TYPES } from './types.mjs';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const CONF = { strong: 3, moderate: 2, tentative: 1 };
const DOMAINS = ['processing', 'mediation', 'ideation', 'affect', 'control', 'interpersonal', 'self'];
const DIAGNOSTIC = /(抑郁症|焦虑症|精神分裂|人格障碍|双相|边缘型|自恋型|反社会|强迫症|创伤后应激|PTSD|ADHD|多动症|自闭|孤独症|精神病|诊断为|确诊|患有|病态|心理疾病)/;
const BARNUM = /(你是一个|你内心深处|其实你|每个人都|很多人都|有时候你.{0,12}有时候|有时.{0,12}有时又|你渴望被理解|表面上.{0,16}内心)/;
const PSEUDO = /(MBTI|INTJ|INTP|ENTJ|ENTP|INFJ|INFP|ENFJ|ENFP|ISTJ|ISFJ|ESTJ|ESFJ|ISTP|ISFP|ESTP|ESFP|大五人格|九型人格|依恋类型|依恋模式|回避型|智商|\bIQ\b|百分位|前\s*\d+\s*%|Top\s*\d+|超过\s*\d+\s*%|\d+\s*%\s*的人|杏仁核|前额叶|皮质醇|多巴胺|血清素|薪资|年薪|匹配度|适配度|患病|发病|概率|潜在(自杀|犯罪)|犯罪倾向)/i;
const FAMILY_CLAIM = /(原生家庭|童年创伤|你的?(父亲|母亲|爸爸|妈妈|父母|爸妈|家人)(是|很|太|一直|总是|从不|从来|曾经|对你|不爱|不够|没有|缺席|冷漠|严厉|控制)|你的?童年(是|很|太|不|没|缺|充满|过得)|你小时候(很|太|不|没|缺|被|受|一定|总是))/;
const DEMOGRAPHIC = /(同龄|同辈|同学历|同行们|高学历|低学历|学历(高|低|不高|不低|有限)|文化(程度|水平)|受教育程度|这个(年纪|年龄|岁数)|你的(年龄|学历|职业)|(年龄|学历|职业)(决定|导致|造成|说明|意味着|让你|使你)|以你的|作为(一名|一个|一位))/;
// Certainty about hidden motives. What lies under the surface can only be offered as a lead.
const CERTAIN = /(潜意识(里|中|深处|在|告诉|想|害怕|渴望)|被压抑|压抑了|防御机制|投射出|恋母|恋父|俄狄浦斯|一定是|肯定是|毫无疑问|证明了|说明你|你真正)/;
const HEDGED = /可能|也许|或许|像是|不一定|猜|大概/;
// A letter that lectures or consoles in general terms does not feel like being understood.
const PREACH = /(你应该|你需要|你要学会|你必须|建议你|问题在于|你的缺点|不足之处)/;
const CLICHE = /(你值得|值得被|加油|相信自己|拥抱自己|与自己和解|和自己和解|内在小孩|疗愈|勇敢做自己|做真实的自己|世界.{0,4}温柔|能量场|宇宙)/;
const QUESTIONS = ['liked', 'disliked', 'father', 'mother'];
// Whether a note uses a real word from what was said, not just 「一张」.
const sharesWord = (a, b) => { const x = bare(a), y = bare(b); for (let i = 0; i + 2 <= x.length; i++) { const g = x.slice(i, i + 2); if (!/[一这那的了是个张图你我它他她有在和]/.test(g) && y.includes(g)) return true; } return false; };
const bare = s => String(s || '').replace(/[\s,，。.!！?？、:：;；"“”'‘’《》()（）…—=-]/g, '');
// Whether two texts share a run of n characters.
const sharesRun = (a, b, n) => { const x = bare(a), y = bare(b); for (let i = 0; i + n <= x.length; i++) if (y.includes(x.slice(i, i + n))) return true; return false; };
const reasonsFor = (S, k) => (S.phrases || []).filter(p => p.question === k && !p.command && !p.safety).map(p => p.text).join(' ');

export function validateNarrative(n, S, summary, signals = []) {
  const E = [];
  if (!n || typeof n !== 'object') return ['叙述文件不是 JSON 对象'];
  const marksIn = t => [...String(t).matchAll(/==(.+?)==/g)].map(m => m[1]);
  const texts = [];
  const pushText = (where, t) => { if (t) texts.push([where, t]); };
  if (!Array.isArray(n.letter) || n.letter.length < 2 || n.letter.length > 6) E.push('letter 要 2–6 段');
  (n.letter || []).forEach((t, i) => pushText(`letter[${i}]`, t));
  if (S.question && !n.answer) E.push(`用户带来了问题「${S.question}」，answer 不能空`);
  pushText('answer', n.answer);
  pushText('closing', n.closing);
  // Someone who stopped early still gets a letter. It just cannot claim what a short record does not hold.
  const R = S.responses.length, short = R < 8;
  const minPortraits = !R ? 0 : short ? 1 : 3, minDomains = !R ? 0 : short ? 1 : 3, minEvidence = short ? 1 : 2;
  const platesWithWords = new Set(S.responses.map(r => r.card)).size;
  if (!Array.isArray(n.portraits) || n.portraits.length < minPortraits || n.portraits.length > 7) E.push(`portraits 要 ${minPortraits}–7 条`);
  const byId = Object.fromEntries(S.responses.map(r => [r.id, r]));
  const domains = new Set();
  const checkQuote = (e, at, cards) => {
    const quote = bare(e.quote);
    if (e.question) {
      if (!QUESTIONS.includes(e.question)) { E.push(`${at}: 没有这一题 ${e.question}`); return; }
      const source = bare(reasonsFor(S, e.question));
      if (quote.length < 2 || !source.includes(quote)) E.push(`${at}: 「${e.quote}」不是对方选这张图时说的原话`);
      const card = S.choices?.[e.question]?.card;
      if (card) cards?.add(card);
      return;
    }
    const r = byId[e.response];
    if (!r) { E.push(`${at}: 找不到回应 ${e.response}`); return; }
    cards?.add(r.card);
    const source = bare(r.verbatim + (r.inquiry || []).map(x => x.text).join(''));
    if (quote.length < 2 || !source.includes(quote)) E.push(`${at}: 「${e.quote}」不是 ${e.response} 的原话`);
  };
  (n.portraits || []).forEach((p, i) => {
    const at = `portraits[${i}]`;
    if (!DOMAINS.includes(p.domain)) E.push(`${at}: domain 必须是 ${DOMAINS.join('/')}`);
    domains.add(p.domain);
    if (!p.title || !p.body) E.push(`${at}: 要有 title 和 body`);
    pushText(`${at}.title`, p.title);
    pushText(`${at}.body`, p.body);
    if (!CONF[p.confidence]) E.push(`${at}: confidence 必须是 strong/moderate/tentative`);
    else if (!capAllows(p.domain, p.confidence)) E.push(`${at}: ${p.domain} 这一类证据最多标到 ${p.domain === 'affect' || p.domain === 'control' ? 'moderate' : 'tentative'}`);
    if (!summary.validity.enough && p.confidence === 'strong') E.push(`${at}: 回应不足 14 条（当前 ${summary.R}），不能标 strong`);
    if (S.person?.age < 18 && p.confidence === 'strong') E.push(`${at}: 对方未满 18 岁，知觉还在发展，这里没有对应的参照，不能标 strong`);
    const ev = p.evidence || [];
    if (ev.length < minEvidence) E.push(`${at}: 至少${minEvidence === 1 ? '一条' : '两条'}证据`);
    const cards = new Set();
    ev.forEach((e, k) => checkQuote(e, `${at}.evidence[${k}]`, cards));
    if (ev.length >= 2 && cards.size < 2 && platesWithWords >= 2) E.push(`${at}: 证据要来自至少两张不同的图`);
  });
  if (domains.size < minDomains) E.push(`portraits 至少覆盖 ${minDomains} 个 domain`);
  const quoted = new Set((n.portraits || []).flatMap(p => (p.evidence || []).filter(e => e.response).map(e => e.response)));
  if (R >= 8 && quoted.size < 4) E.push('证据至少引用 4 条不同的回应');
  if (!Array.isArray(n.invitations) || n.invitations.length < 1 || n.invitations.length > 3) E.push('invitations 要 1–3 条');
  (n.invitations || []).forEach((v, i) => { pushText(`invitations[${i}]`, v.text); pushText(`invitations[${i}].because`, v.because); pushText(`invitations[${i}].notice`, v.notice); });
  for (const k of Object.keys(n.plateNotes || {})) { if (!(Number(k) >= 1 && Number(k) <= 10)) E.push(`plateNotes: 第 ${k} 张不存在`); pushText(`plateNotes.${k}`, n.plateNotes[k]); }

  // The title, the short lines and the light and shade: what a reader remembers and may pass on.
  if (R >= 8 && !n.title?.text) E.push('title 不能空：用对方自己的画面起一个称号');
  if (n.title) {
    if (!n.title.text || bare(n.title.text).length > 12) E.push('title.text 要有，不超过 12 个字');
    pushText('title.text', n.title.text);
    if (!n.title.from) E.push('title.from 要写明这个称号来自哪句原话');
    else checkQuote(n.title.from, 'title.from');
  }
  if (R >= 8 && !(Array.isArray(n.glance) && n.glance.length >= 3)) E.push('glance 要 3–4 条');
  if (n.glance && (!Array.isArray(n.glance) || n.glance.length > 4)) E.push('glance 最多 4 条');
  (Array.isArray(n.glance) ? n.glance : []).forEach((g, i) => {
    if (!DOMAINS.includes(g.domain)) E.push(`glance[${i}]: domain 必须是 ${DOMAINS.join('/')}`);
    if (!g.text || bare(g.text).length > 10) E.push(`glance[${i}]: text 要有，不超过 10 个字`);
    pushText(`glance[${i}]`, g.text);
  });
  if (R >= 8 && !(Array.isArray(n.sides) && n.sides.length >= 2)) E.push('sides 要 2–3 组');
  if (n.sides && (!Array.isArray(n.sides) || n.sides.length > 3)) E.push('sides 最多 3 组');
  (Array.isArray(n.sides) ? n.sides : []).forEach((x, i) => {
    const at = `sides[${i}]`;
    if (!x.light || !x.shade) E.push(`${at}: 要有 light 和 shade`);
    pushText(`${at}.light`, x.light);
    pushText(`${at}.shade`, x.shade);
    if (!x.evidence?.length) E.push(`${at}: 至少一条证据`);
    (x.evidence || []).forEach((e, k) => checkQuote(e, `${at}.evidence[${k}]`));
  });
  if (R >= 8 && !n.share) E.push('share 要 3 行短句');
  if (n.share) {
    if (!Array.isArray(n.share) || n.share.length !== 3) E.push('share 要正好 3 行');
    else n.share.forEach((t, i) => { if (!t || bare(t).length > 18) E.push(`share[${i}]: 要有，不超过 18 个字`); pushText(`share[${i}]`, t); });
  }
  for (const k of Object.keys(n.choices || {})) {
    if (!QUESTIONS.includes(k)) { E.push(`choices: 没有这一题 ${k}`); continue; }
    if (!S.choices?.[k]?.card) E.push(`choices.${k}: 对方没有选这一题，不要写`);
    pushText(`choices.${k}`, n.choices[k]);
  }

  // ---------- what someone can take away ----------
  const full = R >= 8;
  const under = Array.isArray(n.undercurrents) ? n.undercurrents : [];
  const evidenceOf = (list, at, min, needTwoPlates = true) => {
    const ev = Array.isArray(list) ? list : [];
    if (ev.length < min) E.push(`${at}: 至少 ${min} 条证据`);
    const cards = new Set();
    ev.forEach((e, k) => checkQuote(e, `${at}.evidence[${k}]`, cards));
    if (needTwoPlates && min >= 2 && ev.length >= 2 && cards.size < 2 && platesWithWords >= 2) E.push(`${at}: 证据要来自至少两张不同的图`);
  };
  if (full && !n.seen?.text) E.push('seen 要写：一句只属于这个人的话，用对方自己的画面，放在报告最前面');
  if (n.seen) {
    if (!n.seen.text || bare(n.seen.text).length > 30) E.push('seen.text 要有，不超过 30 个字');
    pushText('seen.text', n.seen.text);
    evidenceOf(n.seen.evidence, 'seen', 1);
    const words = (n.seen.evidence || []).map(e => e.quote).join('');
    if (n.seen.text && !sharesRun(n.seen.text, words, 2)) E.push('seen.text 要用上证据里对方自己的词');
  }
  // Everything in 「」 is what they actually said. That is what makes a letter feel like it was listening.
  const allWords = bare([S.question, ...S.responses.flatMap(r => [r.verbatim, ...(r.inquiry || []).map(x => x.text)]), ...QUESTIONS.map(k => reasonsFor(S, k))].filter(Boolean).join(' '));
  const quotesIn = t => [...String(t).matchAll(/「([^「」]+)」/g)].map(m => m[1]);
  const letterQuotes = (n.letter || []).flatMap(quotesIn);
  for (const q of letterQuotes) if (!allWords.includes(bare(q))) E.push(`letter: 「${q}」不是对方说过的话。「」只留给对方的原话`);
  if (full && new Set(letterQuotes.filter(q => allWords.includes(bare(q))).map(bare)).size < 3) E.push('letter 里至少用「」引用对方的三句原话');
  under.forEach((u, i) => { for (const q of quotesIn(u.saw)) if (!allWords.includes(bare(q))) E.push(`undercurrents[${i}].saw: 「${q}」不是对方说过的话`); });
  const takeaways = Array.isArray(n.takeaways) ? n.takeaways : [];
  if (full && takeaways.length !== 3) E.push('takeaways 要正好 3 条：读完这份报告最该记住的三件事');
  takeaways.forEach((x, i) => {
    const at = `takeaways[${i}]`;
    if (!x.text || bare(x.text).length > 40) E.push(`${at}: text 要有，不超过 40 个字`);
    pushText(at, x.text);
    evidenceOf(x.evidence, at, 1);
  });
  if (summary.inkType) {
    if (!n.type?.note) E.push(`type.note 要写：用对方自己的话说明 ${summary.inkType.code}「${summary.inkType.name}」在这次记录里是什么样`);
    pushText('type.note', n.type?.note);
    evidenceOf(n.type?.evidence, 'type', 2);
  }

  // A type named in the letter is either this person's or their mirror. Anything else is a slip.
  const mine = new Set([summary.inkType?.name, summary.inkType?.mirrorName]);
  const otherType = Object.values(INK_TYPES).map(t => t.name).filter(name => !mine.has(name));
  for (const [where, t] of texts) { const hit = otherType.find(name => String(t).includes(name)); if (hit) E.push(`${where}: 这个人的墨型不是「${hit}」`); }

  // ---------- under the surface: leads the agent had to read ----------
  const minUnder = R >= 14 ? 3 : full ? 1 : 0;
  if (under.length < minUnder || under.length > 5) E.push(`undercurrents 要 ${minUnder}–5 条`);
  const known = new Set(signals.map(s => s.id));
  under.forEach((u, i) => {
    const at = `undercurrents[${i}]`;
    for (const k of ['title', 'saw', 'maybe', 'other', 'ask']) { if (!u[k]) E.push(`${at}: 要有 ${k}`); pushText(`${at}.${k}`, u[k]); }
    if (u.maybe && !HEDGED.test(u.maybe)) E.push(`${at}.maybe: 这是猜想，要写成猜想（可能、也许、像是……）`);
    if (u.ask && !/[？?]\s*$/.test(u.ask)) E.push(`${at}.ask: 要是一个问对方的问题`);
    if (u.maybe && u.other && sharesRun(u.maybe, u.other, 8)) E.push(`${at}.other: 要给出真正不同的另一种解释，不是换句话再说一遍`);
    if (u.maybe && !marksIn(u.maybe).length) E.push(`${at}.maybe: 用 ==这样== 标出这条最重要的一句`);
    if (signals.length && !u.signals?.length) E.push(`${at}.signals: 写明这条来自哪条线索`);
    for (const id of u.signals || []) if (!known.has(id)) E.push(`${at}.signals: 没有线索 ${id}，运行 ror signals 查看`);
    evidenceOf(u.evidence, at, 2);
  });
  const used = new Set(under.flatMap(u => u.signals || []));
  const dismissed = Array.isArray(n.dismissed) ? n.dismissed : [];
  dismissed.forEach((d, i) => {
    if (!known.has(d.signal)) E.push(`dismissed[${i}]: 没有线索 ${d.signal}`);
    if (bare(d.why).length < 6) E.push(`dismissed[${i}]: 要说明为什么不算，比如「第一张开口慢是因为还不熟悉」`);
    pushText(`dismissed[${i}]`, d.why);
  });
  const waved = new Set(dismissed.map(d => d.signal));
  for (const x of signals) if (x.weight === 'high' && !used.has(x.id) && !waved.has(x.id)) E.push(`线索 ${x.id} 没有处理（${x.text}）：写进 undercurrents，或在 dismissed 里说明为什么不算`);

  // Every plate gets looked at, and the note has to be about that plate.
  if (full) {
    const notes = n.plateNotes || {};
    for (let c = 1; c <= 10; c++) {
      const words = S.responses.filter(r => r.card === c).map(r => r.verbatim + (r.inquiry || []).map(x => x.text).join('')).join('');
      if (!words) continue;
      if (!notes[c]) E.push(`plateNotes.${c}: 这张有回应，要写一句小注`);
      else if (!sharesWord(notes[c], words)) E.push(`plateNotes.${c}: 小注要用上这张图上对方说过的词`);
    }
    const seenNotes = new Set();
    for (const v of Object.values(notes)) { if (seenNotes.has(bare(v))) E.push(`plateNotes: 有两张图的小注一模一样`); seenNotes.add(bare(v)); }
  }

  for (const [where, t] of texts) {
    const lecture = String(t).match(PREACH);
    if (lecture) E.push(`${where}: 「${lecture[0]}」是在教对方做事。把看到的摆出来，或者写成一个问题`);
    const stock = String(t).match(CLICHE);
    if (stock) E.push(`${where}: 「${stock[0]}」谁都能说。换成只有看过这份记录才说得出的话`);
    const w = String(t).match(CERTAIN);
    if (w) E.push(`${where}: 「${w[0]}」把线索说成了事实。这份记录只能给出线索，请写成猜想，留给对方判断`);
    const d = String(t).match(DIAGNOSTIC);
    if (d) E.push(`${where}: 不写诊断词「${d[0]}」，说看到了什么行为`);
    const b = String(t).match(BARNUM);
    if (b) E.push(`${where}: 「${b[0]}」放在谁身上都成立，换成这个人说过的具体内容`);
    const f = String(t).match(PSEUDO);
    if (f) E.push(`${where}: 「${f[0]}」这份记录测不出来，也没有常模可比，删掉`);
    const c = String(t).match(FAMILY_CLAIM);
    if (c) E.push(`${where}: 「${c[0]}」是在判断真实的家人。这里只能说对方说了什么、这张图给对方什么感觉`);
    const m = String(t).match(DEMOGRAPHIC);
    if (m) E.push(`${where}: 「${m[0]}」是在按年龄、学历或职业下判断。基本信息没有常模，只能当语境，比如「你是护士，伤口对你可能是日常」`);
    for (const p of S.phrases || []) {
      const said = bare(p.text);
      if (p.safety && (sharesRun(p.text, t, 6) || (said.length >= 2 && said.length < 6 && bare(t).includes(said)))) E.push(`${where}: 这里用了对方在安全暂停里说的话，不写进报告`);
    }
    // Quoted plate descriptions (「一个上吊的人」) have passed the quote check. Anything else in these words is about the person.
    if (isCrisis(String(t).replace(/「[^「」]*」/g, ''))) E.push(`${where}: 这里写了危险的词，不写进报告。关心的话写成「如果最近很难熬」，不提原话`);
  }
  // Marks are for the few lines worth finding again, and only where a sentence is read as a sentence.
  const plainOnly = new Set(['title.text', ...(n.glance || []).map((_, i) => `glance[${i}]`), ...(n.share || []).map((_, i) => `share[${i}]`)]);
  for (const [where, t] of texts) {
    if (!String(t).includes('==')) continue;
    if (plainOnly.has(where)) { E.push(`${where}: 这里不能用 == 标记`); continue; }
    if ((String(t).split('==').length - 1) % 2) E.push(`${where}: == 没有成对`);
    const marks = marksIn(t);
    if (marks.length > 2) E.push(`${where}: 一段最多标两处重点，现在 ${marks.length} 处`);
    for (const m of marks) if (bare(m).length > 24) E.push(`${where}: 「${m}」太长，重点不超过 24 个字`);
  }
  if (R >= 8 && (n.letter || []).flatMap(marksIn).length < 2) E.push('letter 里至少用 ==这样== 标出两处重点');

  // What can be saved and passed around holds nothing private.
  const privateWords = [S.question, reasonsFor(S, 'father'), reasonsFor(S, 'mother'), n.choices?.father, n.choices?.mother, ...(S.phrases || []).filter(p => p.safety).map(p => p.text)].filter(Boolean);
  const shared = [...(Array.isArray(n.share) ? n.share : []), n.title?.text].filter(Boolean);
  for (const t of shared) if (privateWords.some(w => sharesRun(t, w, 4))) E.push(`「${t}」会出现在可以分享的卡片上，不能用带来的问题或选父母时说的话`);
  const identity = [S.name, S.person?.occupation].map(bare).filter(w => w.length >= 2);
  for (const t of shared) if (identity.some(w => bare(t).includes(w)) || (S.person?.age && /\d+\s*岁/.test(t))) E.push(`「${t}」会出现在可以分享的卡片上，不能带昵称、年龄或职业`);
  return E;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rich = t => esc(t).replace(/==(.+?)==/g, '<mark>$1</mark>').replace(/「([^「」]{1,80})」/g, '<q>$1</q>');
const pathD = pts => {
  const X = p => (p[0] * 3000).toFixed(0), Y = p => (p[1] * 2083).toFixed(0);
  let d = `M${X(pts[0])} ${Y(pts[0])}`;
  for (let i = 1; i < pts.length; i++) d += `L${X(pts[i])} ${Y(pts[i])}`;
  return d;
};
const sec = ms => (ms == null ? '—' : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}″`);
const fmt = v => (v == null ? '—' : Array.isArray(v) ? v.join(' : ') : String(v));
const dateDots = t => { const d = new Date(t); return `${d.getFullYear()} · ${String(d.getMonth() + 1).padStart(2, '0')} · ${String(d.getDate()).padStart(2, '0')}`; };
const CHROMATIC = new Set([2, 3, 8, 9, 10]);
const ASK = { liked: '最喜欢', disliked: '最不喜欢', father: '最能代表父亲', mother: '最能代表母亲' };
const KEY = { processing: '看', mediation: '准', ideation: '想', affect: '感', control: '稳', interpersonal: '人', self: '己' };
const KEY_TIP = { processing: '怎么看', mediation: '看得准不准', ideation: '怎么想', affect: '怎么感受', control: '怎么应对', interpersonal: '怎么看人', self: '怎么看自己' };

function plateSvg(n, strokes = [], numbered = [], label = '') {
  return `<svg viewBox="0 0 3000 2083" role="img" aria-label="${esc(label || `第 ${ROMAN[n]} 张`)}"><use href="#img${n}"/>${strokes.map(s => `<path class="m" d="${pathD(s.pts)}"/>`).join('')}${numbered.map(([s, k]) => `<g class="tag"><circle cx="${(s.pts[0][0] * 3000).toFixed(0)}" cy="${(s.pts[0][1] * 2083).toFixed(0)}" r="52"/><text x="${(s.pts[0][0] * 3000).toFixed(0)}" y="${(s.pts[0][1] * 2083 + 22).toFixed(0)}">${k}</text></g>`).join('')}</svg>`;
}

const personLine = S => [S.name, S.person?.age && `${S.person.age} 岁`, S.person?.education, S.person?.occupation].filter(Boolean).join('，');

export function transcriptMarkdown(S, codes) {
  const byId = Object.fromEntries((codes || []).map(c => [c.id, c]));
  const out = [`# 记录 ${S.id}`, '', personLine(S) ? `基本信息：${personLine(S)}` : '', S.question ? `带来的问题：${S.question}` : '', ''];
  for (let n = 1; n <= 10; n++) {
    const c = S.cards[n];
    out.push(`## 第 ${ROMAN[n]} 张（首次反应 ${sec(c.rtMs)}，停留 ${sec(c.totalMs)}${c.rotationCount ? `，转动 ${c.rotationCount} 次` : ''}）`, '');
    for (const r of S.responses.filter(x => x.card === n)) {
      const k = byId[r.id];
      out.push(`- **${r.id} ${r.tidy || r.label}**${r.notation && r.notation !== '∧' ? ` ${r.notation}` : ''}`, `  - 原话：${r.verbatim}`);
      if (r.inquiry?.length) out.push(`  - 追问：${r.inquiry.map(x => x.text).join(' / ')}`);
      if (k) out.push(`  - 编码：${k.loc}${k.space ? 'S' : ''} ${k.dq} ${k.det.join('.')}${k.pair ? ' (2)' : ''} ${k.fq} ${k.content.join(',')}${k.pop ? ' P' : ''}${k.z ? ` ${k.z}` : ''}${k.special?.length ? ` ${k.special.join(',')}` : ''}`, `  - 依据：${k.evidence}`);
    }
    out.push('');
  }
  const answered = QUESTIONS.filter(k => S.choices?.[k]?.card || S.choices?.[k]?.skipped);
  if (answered.length) {
    out.push('## 四个问题', '');
    for (const k of answered) out.push(`- ${ASK[k]}：${S.choices[k].skipped ? '跳过' : `第 ${ROMAN[S.choices[k].card]} 张`}${reasonsFor(S, k) ? `。${reasonsFor(S, k)}` : ''}`);
  }
  return out.join('\n');
}

// A tidied form earns the headline only by being clearly shorter than the words it stands above.
const headline = r => { const t = bare(r.tidy); return t && t.length <= bare(r.verbatim).length * 0.7 ? r.tidy : r.label; };
const codeLine = k => `${k.loc}${k.space ? 'S' : ''} ${k.dq} ${k.det.join('.')}${k.pair ? ' (2)' : ''} ${k.fq === 'none' ? '' : k.fq} ${k.content.join(', ')}${k.pop ? ' P' : ''}${k.special?.length ? ` ${k.special.join(' ')}` : ''}`.replace(/\s+/g, ' ').trim();
const inOneOf = (list, set) => list.some(x => set.has(x));
const CONTENT_GROUPS = [
  ['人', new Set(['H', '(H)', 'Hd', '(Hd)', 'Hx'])],
  ['动物', new Set(['A', '(A)', 'Ad', '(Ad)'])],
  ['自然', new Set(['Bt', 'Cl', 'Ge', 'Ls', 'Na'])],
  ['物件', new Set(['Art', 'Ay', 'Cg', 'Hh', 'Sc', 'Id', 'Fd'])],
  ['身体', new Set(['An', 'Bl', 'Sx', 'Xy'])],
  ['火与爆炸', new Set(['Ex', 'Fi'])],
];
const DET_GROUPS = [
  ['只看形状', /^F$/], ['人的动作', /^M/], ['动物的动作', /^FM/], ['物的动作', /^m/], ['颜色', /^(FC|CF|C|Cn)$/],
  ['黑白灰', /^(FC'|C'F|C')$/], ['质地', /^(FT|TF|T)$/], ['远近', /^(FV|VF|V|FD)$/], ['明暗', /^(FY|YF|Y)$/], ['镜像', /^(Fr|rF)$/],
];

// Where a friend can go. A fork changes these and replaces app/repo-qr.png.
// A report gets saved and sent on. What was said in a safety pause stays in protocol.json on this machine and out of this file.
const withoutPauseWords = (protocol, S) => {
  const said = new Set((S.phrases || []).filter(p => p.safety).flatMap(p => [p.text, p.raw].filter(Boolean)));
  if (!said.size) return protocol;
  const walk = v => Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : said.has(v) ? '（安全暂停时说的话，只留在本机的记录里）' : v;
  return walk(protocol);
};
export const PROJECT = { repo: 'https://github.com/Alexsun1one/ten-inkblots', short: 'github.com/Alexsun1one/ten-inkblots', skill: 'https://github.com/Alexsun1one/ten-inkblots/tree/main/rorschach' };
const firstPerson = t => t.replaceAll('你', '我');
// What someone can send to a friend. Their type and a way in, and nothing else from the record.
export function shareWords(T) {
  const invite = `你是十六种墨型里的哪一种？把这句话发给 Codex 就能做：\n安装这个 skill：${PROJECT.skill}`;
  if (!T) return `我刚看完「十张墨迹」，一个说出看到什么、再把它圈出来的罗夏墨迹练习。\n\n${invite}`;
  return `我刚做完「十张墨迹」，测出来是「${T.name}」${T.code}：${firstPerson(T.line)}。\n\n${firstPerson(T.heard)}\n\n${invite}\n\n（一种好玩的记法，不是诊断。）`;
}

// The person who made this tool, not a line for psychological help. A fork replaces this and app/author-qr.png.
const MAKER = { name: '孙务远', note: '做这个测试的人。聊这个工具可以加我，心理咨询请找专业的人。' };
function maker(qr) {
  if (!qr || !existsSync(qr)) return '';
  return `<aside class="maker"><img src="data:image/png;base64,${readFileSync(qr).toString('base64')}" width="92" height="92" alt="${MAKER.name}的微信二维码"><div><b>${MAKER.name}</b><span>${MAKER.note}</span></div></aside>`;
}

export function renderReport({ state: S, codes, summary: Y, narrative: N, signals = [], protocol = null, plates, qr, repoQr, css, js }) {
  const img = n => `data:image/jpeg;base64,${readFileSync(join(plates, `${String(n).padStart(2, '0')}.jpg`)).toString('base64')}`;
  const defs = Array.from({ length: 10 }, (_, i) => `<image id="img${i + 1}" width="3000" height="2083" preserveAspectRatio="none" href="${img(i + 1)}"/>`).join('');
  const byCode = Object.fromEntries(codes.map(c => [c.id, c]));
  const userStrokes = S.strokes.filter(s => s.by === 'user' && s.pts?.length);
  const respNo = {};
  for (let n = 1; n <= 10; n++) S.responses.filter(r => r.card === n).forEach((r, i) => { respNo[r.id] = i + 1; });
  const stampsOf = n => QUESTIONS.filter(k => S.choices?.[k]?.card === n).map(k => ASK[k].replace('最能代表', ''));
  const to = N.to || S.name || '';
  const title = N.title?.text || '第十一张';
  const P = Y.processing, M = Y.mediation, I = Y.ideation, A = Y.affect, C = Y.control, H = Y.interpersonal;

  // ---------- 十张 ----------
  const plateBlock = n => {
    const rs = S.responses.filter(r => r.card === n);
    const strokes = userStrokes.filter(s => s.card === n);
    const numbered = rs.flatMap(r => { const s = strokes.find(x => x.response === r.id); return s ? [[s, respNo[r.id]]] : []; });
    const c = S.cards[n];
    const stamps = stampsOf(n);
    // Words that were not an answer, such as 「看不出来」, are still what was said about this plate.
    const unsaid = (S.phrases || []).filter(p => p.card === n && p.phase === 'response' && !p.command && !p.safety && !S.responses.some(r => r.phrases?.includes(p.id)));
    const silent = c.shownAt === null ? '<p class="silent">这一张没有看。</p>' : unsaid.length ? `<p class="silent"><q>${esc(unsaid.map(p => p.text).join(' '))}</q></p>` : '<p class="silent">这一张你没有说什么。这也是一种回答。</p>';
    return `<section class="page plate" id="plate-${n}">
      <div class="art card-thick">${plateSvg(n, strokes, numbered, `第 ${ROMAN[n]} 张墨迹与你的圈画`)}</div>
      <div class="said">
        <div class="head"><span class="roman press">${ROMAN[n]}</span>${stamps.map(s => `<span class="stamp">${esc(s)}</span>`).join('')}<span class="rt" data-tip="从看到图到开口">${sec(c.rtMs)}</span></div>
        ${rs.length ? `<ol>${rs.map(r => `<li id="${esc(r.id)}"><b><i>${respNo[r.id]}</i>${esc(headline(r))}${r.notation && r.notation !== '∧' ? `<span class="caret" data-tip="转动图版后看到的">${esc(r.notation)}</span>` : ''}</b>${bare(headline(r)) === bare(r.verbatim) ? '' : `<q>${esc(r.verbatim)}</q>`}${r.inquiry?.length ? `<p>${r.inquiry.map(x => esc(x.text)).join(' ')}</p>` : ''}<code data-tip="${esc(byCode[r.id]?.evidence || '')}">${esc(byCode[r.id] ? codeLine(byCode[r.id]) : '')}</code></li>`).join('')}</ol>` : silent}
        ${N.plateNotes?.[n] ? `<p class="note">${rich(N.plateNotes[n])}</p>` : ''}
      </div>
    </section>`;
  };
  const contact = `<div class="contact">${Array.from({ length: 10 }, (_, i) => {
    const n = i + 1, rs = S.responses.filter(r => r.card === n), strokes = userStrokes.filter(s => s.card === n);
    return `<a href="#plate-${n}"><span class="art card-thin">${plateSvg(n, strokes)}</span><span class="cap"><b>${ROMAN[n]}</b><i class="count" data-tip="${rs.length} 条回应">${'<u></u>'.repeat(rs.length)}</i></span></a>`;
  }).join('')}</div>`;

  // ---------- 这一次 ----------
  const cardList = Array.from({ length: 10 }, (_, i) => i + 1);
  const totalMs = cardList.reduce((s, n) => s + (S.cards[n].totalMs || 0), 0);
  const turns = cardList.reduce((s, n) => s + (S.cards[n].rotationCount || 0), 0);
  const steadyRt = n => (S.cards[n].voiceGapMs ? 0 : S.cards[n].rtMs || 0);
  const slow = cardList.reduce((b, n) => (steadyRt(n) > steadyRt(b) ? n : b), 1);
  const ordered = [...S.responses].sort((a, b) => a.card - b.card);
  const contentCounts = CONTENT_GROUPS.map(([w, set]) => [w, codes.filter(c => inOneOf(c.content, set)).length]).sort((a, b) => b[1] - a[1]);
  const fact = (v, unit, word, tip) => `<div class="fact"${tip ? ` data-tip="${esc(tip)}"` : ''}><b class="press">${v}</b>${unit ? `<i>${unit}</i>` : ''}<span>${word}</span></div>`;
  const ribbon = totalMs ? `<div class="ribbon" role="img" aria-label="十张图各停了多久">${cardList.map(n => {
    const c = S.cards[n], rec = protocol?.cards?.[n - 1];
    const marks = rec && c.totalMs ? rec.responses.map(r => r.freeAssociation.startMs == null ? null : Math.min(100, Math.max(0, (r.freeAssociation.startMs - rec.timing.onsetMs) / c.totalMs * 100))).filter(x => x != null) : [];
    return `<a href="#plate-${n}" class="seg${CHROMATIC.has(n) ? ' c' : ''}" style="flex:${Math.max(c.totalMs || 0, totalMs * .03)}" data-tip="第 ${ROMAN[n]} 张：停了 ${sec(c.totalMs)}，开口前 ${sec(c.rtMs)}"><span>${marks.map(x => `<u style="left:${x.toFixed(1)}%"></u>`).join('')}</span><b>${ROMAN[n]}</b></a>`;
  }).join('')}</div>` : '';
  const facts = `<section class="page" id="once"><h2 class="ch press">这一次</h2>
    <div class="facts">
      ${fact(Y.R, '', '样东西')}
      ${totalMs ? fact(Math.max(1, Math.round(totalMs / 60000)), '', '分钟') : ''}
      ${fact(userStrokes.length, '', '笔圈画')}
      ${fact(turns, '', '次转动图版')}
      ${S.cards[slow].rtMs ? fact(ROMAN[slow], '', `开口前停得最久，${sec(S.cards[slow].rtMs)}`) : ''}
      ${contentCounts[0]?.[1] ? fact(contentCounts[0][0], '', `看到最多，${contentCounts[0][1]} 次`) : ''}
    </div>
    ${ribbon}
    ${ordered.length > 1 ? `<p class="arc">从<q>${esc(headline(ordered[0]))}</q>开始，到<q>${esc(headline(ordered[ordered.length - 1]))}</q>结束。</p>` : ''}
  </section>`;

  // ---------- 结构 ----------
  const scale = (left, a, right, b, tip) => {
    const sum = a + b, x = sum ? a / sum * 100 : null;
    return `<div class="scale${sum ? '' : ' none'}" data-tip="${esc(tip)}"><span class="end">${esc(left)}<b>${a}</b></span><span class="axis">${sum ? `<i style="left:${x.toFixed(1)}%"></i>` : ''}</span><span class="end r"><b>${b}</b>${esc(right)}</span></div>`;
  };
  const late = codes.filter(c => (S.responses.find(r => r.id === c.id)?.card || 0) >= 8).length;
  const scales = [
    scale('整体', P.W, '局部', P.D + P.Dd, 'W : D + Dd'),
    scale('人的动作', A.EB[0], '颜色', A.EB[1], 'EB'),
    scale('主动', I['a:p'][0], '静止', I['a:p'][1], 'a : p'),
    scale('颜色收着', A['FC:CF+C'][0], '颜色放开', A['FC:CF+C'][1], 'FC : CF + C'),
    scale('只看形状', Y.validity.pureF, '还看别的', Y.R - Y.validity.pureF, 'F : 其他决定因子'),
    scale('前七张', Y.R - late, '后三张', late, 'Afr'),
    scale('合作', H.COP, '拉扯', H.AG, 'COP : AG'),
  ].join('');
  const said = c => S.responses.find(r => r.id === c.id);
  const dotOf = c => { const r = said(c); return `<a class="u${CHROMATIC.has(r.card) ? ' c' : ''}" href="#plate-${r.card}" data-tip="${esc(`${ROMAN[r.card]}　${headline(r)}`)}" aria-label="${esc(`第 ${ROMAN[r.card]} 张：${headline(r)}`)}"></a>`; };
  const unitRow = (word, list) => (list.length ? `<div class="ur"><dt>${esc(word)}</dt><dd>${list.map(dotOf).join('')}<b>${list.length}</b></dd></div>` : '');
  const units = (name, rows) => `<figure class="units"><figcaption>${name}</figcaption><dl>${rows.map(([w, f]) => unitRow(w, codes.filter(f))).join('')}</dl></figure>`;
  const rtMax = Math.max(...cardList.map(n => S.cards[n].rtMs || 0), 1);
  const rtFast = cardList.filter(n => S.cards[n].rtMs != null).reduce((b, n) => (b == null || S.cards[n].rtMs < S.cards[b].rtMs ? n : b), null);
  const rtChart = `<figure class="rtc"><figcaption>开口前的停顿</figcaption><div class="cols">${cardList.map(n => {
    const v = S.cards[n].rtMs, shown = n === slow || n === rtFast;
    return `<a href="#plate-${n}" class="col${CHROMATIC.has(n) ? ' c' : ''}" data-tip="第 ${ROMAN[n]} 张：${sec(v)}"><span class="track"><span class="bar" style="height:${v ? Math.max(2, v / rtMax * 100) : 1}%">${shown && v ? `<em>${sec(v)}</em>` : ''}</span></span><b>${ROMAN[n]}</b></a>`;
  }).join('')}</div></figure>`;
  const shape = `<section class="page shape" id="shape"><h2 class="ch press">结构</h2>
    <div class="scales">${scales}</div>
    <p class="key"><span><i></i>黑白图</span><span><i class="c"></i>彩色图</span></p>
    ${rtChart}
    <div class="unitgrid">
      ${units('看哪里', [['整体', c => c.loc === 'W'], ['常见局部', c => c.loc === 'D'], ['少见局部', c => c.loc === 'Dd'], ['用上空白', c => c.space]])}
      ${units('和形状贴得多近', [['贴合', c => ['+', 'o'].includes(c.fq)], ['独特', c => c.fq === 'u'], ['偏离', c => c.fq === '-'], ['没有形状', c => c.fq === 'none']])}
      ${units('凭什么看出来', DET_GROUPS.map(([w, re]) => [w, c => c.det.some(d => re.test(d))]))}
      ${units('看到了什么', CONTENT_GROUPS.map(([w, set]) => [w, c => inOneOf(c.content, set)]))}
    </div>
  </section>`;

  // ---------- 画像 ----------
  const dots = c => `<span class="dots" data-tip="${{ strong: '这条有较多依据', moderate: '这条有一些依据', tentative: '这条只是一个猜想' }[c]}" aria-label="${c}">${[1, 2, 3].map(i => `<i class="${i <= CONF[c] ? 'on' : ''}"></i>`).join('')}</span>`;
  const whereOf = e => (e.question ? S.choices?.[e.question]?.card : S.responses.find(x => x.id === e.response)?.card);
  const quoteLink = e => {
    const n = whereOf(e);
    return `<li><a href="${e.question ? '#choices' : `#plate-${n}`}"><span class="roman">${ROMAN[n] || ''}</span><q>${esc(e.quote)}</q></a></li>`;
  };
  const portrait = (p, i) => {
    const lit = new Set((p.evidence || []).map(whereOf));
    return `<article class="portrait" data-key="p${i}">
      <header><h3 class="press">${esc(p.title)}</h3><div class="marks">${dots(p.confidence)}<span class="track10" aria-label="证据来自这几张">${cardList.map(n => `<a href="#plate-${n}" class="${lit.has(n) ? 'on' : ''}" data-tip="第 ${ROMAN[n]} 张" tabindex="${lit.has(n) ? 0 : -1}"></a>`).join('')}</span></div></header>
      <div class="body"><p>${rich(p.body)}</p>
      <ul class="ev">${(p.evidence || []).map(quoteLink).join('')}</ul>
      <div class="ask" role="group" aria-label="这条像你吗"><button data-v="yes">像我</button><button data-v="no">不太像</button></div></div>
    </article>`;
  };
  const portraits = N.portraits?.length ? `<section class="page" id="portraits"><h2 class="ch press">画像</h2>
    ${N.portraits.map(portrait).join('')}
    <aside class="legend">${dots('strong')}<span>较多依据</span>${dots('moderate')}<span>一些依据</span>${dots('tentative')}<span>一个猜想</span></aside>
  </section>` : '';

  // ---------- 四张选择 ----------
  const choiceCard = k => {
    const a = S.choices?.[k];
    if (!a || (!a.card && !a.skipped)) return '';
    const why = reasonsFor(S, k);
    return `<article class="choice${a.card ? '' : ' empty'}">
      <div class="art ${a.card ? 'card-thick' : 'hollow'}">${a.card ? plateSvg(a.card) : ''}</div>
      <h3 class="press">${ASK[k]}${a.card ? `<span class="roman">${ROMAN[a.card]}</span>` : ''}</h3>
      ${a.card ? (why ? `<blockquote>${esc(why)}</blockquote>` : '') : '<p class="silent">这一题跳过了。</p>'}
      ${N.choices?.[k] ? `<p class="note">${rich(N.choices[k])}</p>` : ''}
    </article>`;
  };
  const anyChoice = QUESTIONS.some(k => S.choices?.[k]?.card || S.choices?.[k]?.skipped);
  const parents = S.choices?.father?.card || S.choices?.mother?.card;
  const choices = anyChoice ? `<section class="page" id="choices"><h2 class="ch press">四张选择</h2>
    <div class="pair">${choiceCard('liked')}${choiceCard('disliked')}</div>
    <div class="pair parents">${choiceCard('father')}${choiceCard('mother')}</div>
    ${parents ? '<p class="aside">这里说的是这张图给你的感觉，不是对他们的判断。</p>' : ''}
  </section>` : '';

  // ---------- 光与影 ----------
  const sides = N.sides?.length ? `<section class="page" id="sides"><h2 class="ch press">光与影</h2>
    ${N.sides.map(x => `<article class="side"><div class="light"><b class="press">光</b><p>${rich(x.light)}</p></div><div class="shade"><b class="press">影</b><p>${rich(x.shade)}</p></div><ul class="ev">${(x.evidence || []).map(quoteLink).join('')}</ul></article>`).join('')}
  </section>` : '';

  // ---------- 试试 ----------
  const tries = `<section class="page" id="try"><h2 class="ch press">这周可以试</h2><ol class="tries">${(N.invitations || []).map(v => `<li>${v.because ? `<p class="because">${esc(v.because)}</p>` : ''}<p class="do press">${esc(v.text)}</p>${v.notice ? `<p class="notice">${esc(v.notice)}</p>` : ''}</li>`).join('')}</ol></section>`;

  // ---------- 记住这三件 ----------
  const takeaways = Array.isArray(N.takeaways) ? N.takeaways : [];
  const know = takeaways.length ? `<section class="page" id="know"><h2 class="ch press">记住这三件</h2><ol class="tries knows">${takeaways.map(x => `<li><p class="do press">${rich(x.text)}</p><ul class="ev">${(x.evidence || []).map(quoteLink).join('')}</ul></li>`).join('')}</ol></section>` : '';

  // ---------- the one line ----------
  const seen = N.seen?.text ? `<section class="page seen" id="seen"><p class="press">${esc(N.seen.text)}</p><i class="redline"></i><ul class="ev">${(N.seen.evidence || []).map(quoteLink).join('')}</ul></section>` : '';

  // ---------- 墨型 ----------
  const T = Y.inkType;
  const axisRow = a => {
    const leftWins = a.letter === a.left.letter;
    return `<div class="iaxis" data-tip="${esc(`${a.rule}。这次是 ${a.a} : ${a.b}。比例按分界线换算`)}">
      <div class="irow">
        <span class="end${leftWins ? ' on' : ''}"><i>${a.left.letter}</i>${esc(a.left.word)}<b>${a.leftPct}%</b></span>
        <span class="split"><u></u><i class="${leftWins ? 'l' : 'r'}" style="width:${leftWins ? a.leftPct : a.rightPct}%"></i></span>
        <span class="end r${leftWins ? '' : ' on'}"><b>${a.rightPct}%</b>${esc(a.right.word)}<i>${a.right.letter}</i></span>
      </div>
      <p>${a.even ? '这一格两边差不多，你两边都去得了。' : esc(a.say)}</p>
    </div>`;
  };
  const tile = ([code, t]) => `<a class="ty${code === T.code ? ' me' : code === T.mirror ? ' mirror' : ''}" data-tip="${esc(t.line)}" tabindex="0"><canvas data-code="${code}" width="280" height="198" aria-hidden="true"></canvas><b>${t.name}</b><i>${code}</i></a>`;
  const typeSection = T ? `<section class="page inktype" id="type">
    <p class="kicker">墨型</p>
    <h2 class="name press">${esc(T.name)}</h2>
    <p class="code">${[...T.code].join(' ')}</p>
    <p class="line">${esc(T.line)}</p>
    <div class="iaxes">${T.axes.map(axisRow).join('')}</div>
    <blockquote class="heard press">${esc(T.heard).replace('。', '。<br>')}</blockquote>
    ${N.type?.note ? `<div class="tnote"><p>${rich(N.type.note)}</p><ul class="ev">${(N.type.evidence || []).map(quoteLink).join('')}</ul></div>` : ''}
    <article class="side three"><div class="light"><b class="press">长处</b><p>${esc(T.gift)}</p></div><div class="shade"><b class="press">卡点</b><p>${esc(T.shade)}</p></div><div class="light"><b class="press">和你相处</b><p>${esc(T.with)}</p></div></article>
    <figure class="ingredients"><figcaption class="press">你的墨里有什么</figcaption>${T.ingredients.map(x => `<div class="ing" data-tip="${esc(`${x.tip}的回应，占你这次的 ${x.pct}%`)}"><span>${esc(x.word)}</span><span class="bar2"><i style="width:${x.pct}%"></i></span><b>${x.pct}%</b></div>`).join('')}</figure>
    <div class="atlas">${Object.entries(INK_TYPES).map(tile).join('')}</div>
    <p class="mirrorline">你的镜像是<b>${esc(T.mirrorName)}</b> ${T.mirror}，同一张图，你们大概会看向相反的地方。<br>找个朋友测一测，比比看。</p>
    <a class="paperbtn" href="#share">分享我的墨型</a>
    <p class="aside">墨型是这个项目编的一套记法，方便记住这次看图的方式。部分字母借自罗夏的记号，比例按我们定的分界线换算，都没有科学验证，下次做可能不同，也不能用来判断别人。</p>
  </section>` : '';

  // ---------- 水面下 ----------
  const under = Array.isArray(N.undercurrents) ? N.undercurrents : [];
  const underCard = (u, i) => {
    const lit = new Set((u.evidence || []).map(whereOf));
    return `<article class="portrait under" data-key="u${i}">
      <header><h3 class="press">${esc(u.title)}</h3><div class="marks"><span class="track10" aria-label="证据来自这几张">${cardList.map(n => `<a href="#plate-${n}" class="${lit.has(n) ? 'on' : ''}" data-tip="第 ${ROMAN[n]} 张" tabindex="${lit.has(n) ? 0 : -1}"></a>`).join('')}</span></div></header>
      <div class="body"><p class="saw">${rich(u.saw)}</p><p class="maybe">${rich(u.maybe)}</p><p class="other">也可能：${rich(String(u.other).replace(/^也可能[：:，,]?/, ''))}</p>
      <ul class="ev">${(u.evidence || []).map(quoteLink).join('')}</ul>
      <p class="askit press">${esc(u.ask)}</p>
      <div class="ask" role="group" aria-label="这条像你吗"><button data-v="yes">像我</button><button data-v="no">不太像</button></div></div>
    </article>`;
  };
  const undercurrents = under.length ? `<section class="page" id="under"><h2 class="ch press">水面下</h2>
    <p class="lede">这些不是你打算告诉我的，是停顿、用词和手留下的痕迹。老派的说法叫潜意识的线索，但没有证据表明一次测试能读出潜意识。它们只是线索，对不对由你判断。</p>
    ${under.map(underCard).join('')}
  </section>` : '';

  // ---------- 怎么来的 ----------
  const indexGroups = [
    ['怎么看', [['W : D : Dd', `${P.W} : ${P.D} : ${P.Dd}`, '整体、常见局部、少见局部各用了几次'], ['S', P.S, '用上空白的次数'], ['DQ+', P.dq['+'], '把几样东西连成一件事的次数'], ['DQv', P.dq.v, '说不出具体轮廓的次数'], ['Zf', P.Zf, '需要组织画面的回应数'], ['Zd', P.Zd, '组织分和按 Zf 估计的差']]],
    ['看得准不准', [['XA%', M['XA%'], '和形状基本相符的比例'], ['WDA%', M['WDA%'], '常见位置上相符的比例'], ['X+%', M['X+%'], '贴合且常见的比例'], ['Xu%', M['Xu%'], '独特但不违背形状的比例'], ['X-%', M['X-%'], '明显偏离形状的比例'], ['P', M.P, '和多数人相同的常见回应']]],
    ['怎么想', [['M', I.M, '看到人在动的次数'], ['M-', I['M-'], '其中偏离形状的'], ['a : p', fmt(I['a:p']), '主动与静止的动作'], ['Ma : Mp', fmt(I['Ma:Mp']), '人的动作里，主动与静止'], ['WSum6', I.WSum6, '想法跳脱的加权分']]],
    ['怎么感受', [['EB', fmt(A.EB), '人的动作与颜色加权之比'], ['FC : CF+C', fmt(A['FC:CF+C']), '颜色收着与放开之比'], ['Afr', A.Afr, '后三张与前七张的回应比'], ["C'", A.Cp, '用到黑白灰的次数'], ['Blends', A.blends, '同时用到两种以上依据的回应数']]],
    ['怎么应对', [['EA', C.EA, '人的动作加颜色加权'], ['es', C.es, '动物与物的动作，加明暗颜色'], ['D', C.D, 'EA 和 es 的差换算成的分'], ['AdjD', C.AdjD, '去掉一时性因素后的 D'], ['eb', fmt(C.eb), '动作与明暗颜色之比']]],
    ['人与自己', [['COP', H.COP, '合作的画面'], ['AG', H.AG, '对抗的画面'], ['GHR : PHR', fmt(H['GHR:PHR']), '好的与不好的人物画面'], ['MOR', Y.self.MOR, '受伤或破损的画面'], ['Fr+rF', Y.self.reflections, '镜像与倒影'], ['FD', Y.self.FD, '从远处看的画面']]],
  ];
  const seqRows = S.responses.map(r => {
    const k = byCode[r.id];
    return `<tr><td>${ROMAN[r.card]}</td><td>${respNo[r.id]}</td><td>${esc(r.notation || '∧')}</td><td>${k.loc}${k.space ? 'S' : ''}</td><td>${esc(k.dq)}</td><td>${esc(k.det.join('.'))}${k.pair ? ' (2)' : ''}</td><td>${esc(k.fq)}</td><td>${esc(k.content.join(', '))}</td><td>${k.pop ? 'P' : ''}</td><td>${k.z ? `${k.z}` : ''}</td><td>${esc((k.special || []).join(', '))}</td></tr>`;
  }).join('');
  const steps = [['听', (S.phrases || []).filter(p => !p.command).length, '句话'], ['圈', userStrokes.length, '笔'], ['编码', codes.length, '条'], ['计算', indexGroups.reduce((s, g) => s + g[1].length, 0), '项'], ['写信', (N.portraits || []).length, '条画像']];
  const colophon = `<section class="page appendix" id="method"><h2 class="ch press">这份报告怎么来的</h2>
    <ol class="steps">${steps.map(([w, v, u]) => `<li><i></i><b>${w}</b><span>${v} ${u}</span></li>`).join('')}</ol>
    ${Y.validity.enough ? '' : `<p class="warn">这次一共 ${Y.R} 条回应，少于通常需要的 14 条，下面的数字只作参考。</p>`}
    <div class="indices">${indexGroups.map(([g, rows]) => `<section><h3>${g}</h3><table><tbody>${rows.map(([k, v, plain]) => `<tr><th>${esc(k)}</th><td class="v">${esc(fmt(v))}</td><td>${esc(plain)}</td></tr>`).join('')}</tbody></table></section>`).join('')}</div>
    <details class="seq"><summary>完整编码</summary><div class="scroll"><table><thead><tr><th>图</th><th>#</th><th>方向</th><th>位置</th><th>DQ</th><th>决定因子</th><th>形状</th><th>内容</th><th>P</th><th>Z</th><th>特殊</th></tr></thead><tbody>${seqRows}</tbody></table></div></details>
    ${T ? `<details class="seq"><summary>墨型怎么算</summary><div class="scroll"><table><thead><tr><th>这一格</th><th>规则</th><th>这次</th><th>结果</th></tr></thead><tbody>${T.axes.map(a => `<tr><td>${a.left.letter} / ${a.right.letter}</td><td>${esc(a.rule)}</td><td>${a.a} : ${a.b}${a.even ? '，差不多' : ''}</td><td>${a.letter}</td></tr>`).join('')}</tbody></table></div><p class="aside">W/D、F/B、P/U 的比例按分界线换算，50% 就是正好在分界线上，不是回应的原始占比。M/C 是字面占比。B 是我们自己的叫法，这里的 P 指没有用到少见形状，不是罗夏的 Popular。</p></details>` : ''}
    ${(signals || []).length ? `<details class="seq"><summary>脚本找到的 ${signals.length} 条线索</summary><ul class="leads">${signals.map(x => { const why = (N.dismissed || []).find(d => d.signal === x.id)?.why; const on = under.some(u => (u.signals || []).includes(x.id)); return `<li class="${x.weight}"><span>${esc(x.text)}</span>${on ? '<em>写进了水面下</em>' : why ? `<em>没有用：${esc(why)}</em>` : ''}</li>`; }).join('')}</ul></details>` : ''}
    ${personLine(S) ? `<p class="method">你填写的是：${esc(personLine(S))}。这些只用来读懂你说的话，没有和任何人比较。研究发现，受教育年限和回应的复杂程度有关，所以这里不把说得复杂读成能力强。</p>` : ''}
    <p class="method">施测流程参照综合系统与 R-PAS 的公开描述，每张图请你说两到三个回应。主持人会在你停下后多问一句「还有吗」，比原版回应阶段问得多，所以回应数可能偏多。编码由 AI 完成，没有经过持证评估者复核；形状质量没有对照原版常模表，所以这里只比较你自己的前后，不和别人比。可信度分级依据 Mihura 等人 2013 年的元分析：认知与知觉类指标证据最强，自我中心指数、孤立指数这类证据最弱。罗夏变量整体上和外部观察的相关是 r = .27，和自评问卷只有 r = .08，所以这里的说法不必和你对自己的看法一致。墨型是这个项目编的一套记法，分界线由我们定，没有经过验证。称号和卡片是一种比喻。「水面下」一章是从记录里的痕迹做出的猜想，没有研究证明这样能读出潜意识。缩放和移动只作记录，没有常模，不计分。</p>
  </section>`;

  const blotPoints = userStrokes.flatMap(s => s.pts.filter((_, i) => i % 5 === 0));
  const colorful = codes.reduce((n, c) => n + c.det.filter(d => /^(FC|CF|C)$/.test(d)).length, 0);
  const seed = [...S.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % 100000;
  const glance = (Array.isArray(N.glance) ? N.glance : []).slice(0, 4);
  const glanceCell = g => `<li><b class="press" data-tip="${esc(KEY_TIP[g.domain] || '')}">${KEY[g.domain] || ''}</b><span>${esc(g.text)}</span></li>`;
  const railItems = [['seen', '想对你说'], ['type', '墨型'], ['letter', '一封信'], ['know', '记住这三件'], ['under', '水面下'], ['portraits', '画像'], ['choices', '四张选择'], ['sides', '光与影'], ['try', '这周可以试'], ['plates', '十张'], ['once', '这一次'], ['shape', '结构'], ['closing', `致${to ? ` ${to}` : '你'}`], ['share', '分享给朋友'], ['method', '怎么来的']];
  const shareData = { type: T ? { name: T.name, code: T.code, line: firstPerson(T.line), heard: firstPerson(T.heard), axes: T.axes.map(a => ({ letter: a.letter, word: a.word, pct: a.letter === a.left.letter ? a.leftPct : a.rightPct })) } : null, link: PROJECT.short, qr: repoQr && existsSync(repoQr) ? `data:image/png;base64,${readFileSync(repoQr).toString('base64')}` : null };
  const coverLines = Array.isArray(N.share) ? N.share : [];

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>十张墨迹${T ? ` · ${esc(T.name)}` : ''}${to ? ` · ${esc(to)}` : ''}</title><style>${css}</style></head>
<body data-page="report" data-session="${esc(S.id)}">
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${defs}</defs></svg>
<nav class="rail" aria-label="目录">${railItems.map(([id, w]) => `<a href="#${id}" data-to="${id}" data-tip="${esc(w)}" data-side="left" aria-label="${esc(w)}"></a>`).join('')}</nav>

<header class="hero" id="top">
  ${glance.length ? `<ul class="glance left">${glance.slice(0, 2).map(glanceCell).join('')}</ul>` : ''}
  <article class="deck">
    <canvas id="eleventh" width="1200" height="848" role="img" aria-label="根据你今天的圈画生成的一张墨迹"></canvas>
    ${T ? `<h1 class="press">${esc(T.name)}</h1><p class="code">${[...T.code].join(' ')}</p><i class="redline"></i><p class="own press">${esc(title)}</p>` : `<h1 class="press">${esc(title)}</h1><i class="redline"></i>`}
    ${coverLines.length ? `<p class="lines">${coverLines.map(esc).join('<br>')}</p>` : ''}
    <footer>${to ? `<span>写给 ${esc(to)}</span>` : '<span>十张墨迹</span>'}<span>${dateDots(S.createdAt)}</span></footer>
  </article>
  ${glance.length > 2 ? `<ul class="glance right">${glance.slice(2).map(glanceCell).join('')}</ul>` : ''}
</header>

<main>
${seen}
${typeSection}
<section class="page letter" id="letter">
  ${S.question ? `<blockquote class="press">${esc(S.question)}</blockquote><i class="redline"></i>` : ''}
  ${(N.letter || []).map(t => `<p>${rich(t)}</p>`).join('')}
  ${N.answer ? `<p class="answer">${rich(N.answer)}</p>` : ''}
  <p class="sign">${esc(N.signature || '陪你看完这十张的 AI')}<i class="seal" aria-hidden="true"></i></p>
</section>

${know}
${undercurrents}
${portraits}
${choices}
${sides}
${tries}

<section class="page" id="plates"><h2 class="ch press">十张</h2>${contact}</section>
${cardList.map(plateBlock).join('')}

${facts}
${shape}

<section class="page closing" id="closing">
  <div class="words">
    <h2 class="press">致${to ? ` ${esc(to)}` : '你'}</h2>
    <i class="redline"></i>
    ${N.closing ? `<p>${rich(N.closing)}</p>` : ''}
  </div>
</section>

<section class="page" id="share"><h2 class="ch press">分享给朋友</h2>
  <div class="sharegrid">
    <figure class="sharebox"><canvas id="shareCard" width="1080" height="1440" role="img" aria-label="可以保存和分享的墨型卡"></canvas><button class="paperbtn saveCard">保存卡片</button></figure>
    <div class="sharewords">
      <textarea id="shareText" rows="11" spellcheck="false" aria-label="可以发给朋友的一段话">${esc(shareWords(T))}</textarea>
      <button id="copyText" class="paperbtn">复制这段话</button>
      <p class="aside">卡片和这段话只有墨型，没有你说过的任何一句话。</p>
    </div>
  </div>
</section>

${colophon}
</main>

${maker(qr)}
<footer class="limit">
  <p>这份报告来自一次自我探索，不是诊断，也不能用于招聘、司法或任何对你做决定的场合。如果最近很难熬，请找一位真人聊聊：全国心理援助热线 12356。</p>
  <div class="acts"><button id="print">打印</button><button id="data">下载数据</button><button id="del" hidden>删除这次记录</button></div>
</footer>
<div class="tip" id="tip" role="tooltip" hidden></div>
<script type="application/json" id="rt">__RUNTIME__</script>
<script type="application/json" id="protocol">${protocol ? JSON.stringify(withoutPauseWords(protocol, S)).replace(/</g, '\\u003c') : 'null'}</script>
<script type="application/json" id="blotData">${JSON.stringify({ seed, points: blotPoints, colorful }).replace(/</g, '\\u003c')}</script>
<script type="application/json" id="shareData">${JSON.stringify(shareData).replace(/</g, '\\u003c')}</script>
<script>${js}</script>
</body></html>`;
}
