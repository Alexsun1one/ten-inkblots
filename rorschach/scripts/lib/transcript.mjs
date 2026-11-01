// Turns the realtime transcript stream into phrases.
// "done" for a user turn can lag until the voice next speaks, so a phrase closes on its own once deltas go quiet.
export const norm = s => String(s || '').replace(/[\s,，。.!！?？、:：]/g, '');
const indexAfter = (s, n) => { let i = 0; for (let seen = 0; i < s.length && seen < n; i++) if (norm(s[i])) seen++; while (i < s.length && !norm(s[i])) i++; return i; };

const READY = '(?:(?:好的?了?|嗯|行|可以)[,，。 ]*)?';
export const NEXT_CMD = new RegExp(`^${READY}(下一张|看完了|这张看完了|就这些了?|没有了|没别的了|下一个|看别的|换一张|跳过这张|这张跳过|跳过|next)[吧了]?[。.!！]*$`, 'i');
export const INQUIRY_NEXT = new RegExp(`^${READY}(下一条|下一个|下一张|就这样|说完了)[吧了]?[。.!！]*$`);
export const CHOICE_NEXT = new RegExp(`^${READY}(下一题|下一个|下一张|就这样|说完了|好了)[吧了]?[。.!！]*$`);
export const CHOICE_SKIP = new RegExp(`^${READY}((这题|这一题)?跳过(这题|这一题|吧)?|不想(选|答|回答|说)|不选了?|不答了?)[吧了]?[。.!！]*$`);
// 「看不出来」 is no answer to 「还有吗」. Short, because a longer sentence usually goes on to say what they do see.
const REFUSAL = /看不出|看不懂|想不出|说不上来|说不出来|没什么想法|没想法|什么都不像|不知道/;
const SEES_SOMETHING = /可能是|好像|也许|像[一个只条是]/;
export const isRefusal = t => norm(t).length <= 20 && REFUSAL.test(t) && !SEES_SOMETHING.test(t);
const CHANGED_MIND = /换成|换一张|改成|改选|重选|还是|不对|应该是/;
const NUMERAL = '(十|[一二两三四五六七八九]|10|[1-9]|VIII|VII|VI|IX|IV|V|III|II|I|X)';
const CN_DIGIT = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const ROMAN_DIGIT = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
const PICK_FILLER = /我|选|挑|要|就|是|吧|了|呢|啊|嗯|那|这|张|的|最|喜欢|不喜欢|讨厌|代表|像|父亲|母亲|爸爸|妈妈|爸|妈|换成|改成|改选|重选|还是|不对|应该/g;
// A plate named out loud. `only`: nothing else was said, so these words are not a reason.
export function pickedCard(text) {
  const t = String(text || '').trim();
  const m = t.match(new RegExp(`第\\s*${NUMERAL}\\s*[张張幅]`, 'i'))
    || t.match(new RegExp(`^(?:图\\s*)?第?\\s*${NUMERAL}\\s*[张張幅号]?\\s*(?:吧|了|呢)?[。.!！]*$`, 'i'));
  const last = !m && /最后(那|一)张/.exec(t);
  if (!m && !last) return null;
  const word = m?.[1];
  const card = last ? 10 : CN_DIGIT[word] ?? ROMAN_DIGIT[word.toUpperCase()] ?? Number(word);
  if (!(card >= 1 && card <= 10)) return null;
  return { card, only: norm(t.replace((m || last)[0], '').replace(PICK_FILLER, '')).length < 2, changed: CHANGED_MIND.test(t) };
}

// 0 unless these read as the same words. Short strings carry too little to judge, so they must match exactly.
function likeness(a, b) {
  if (a === b) return 1;
  if (a.length < 4 || b.length < 4) return 0;
  // A long sentence contains a short phrase's words without being a rewording of it.
  if (Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.7) return 0;
  const grams = s => { const m = new Map(); for (let i = 0; i + 1 < s.length; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(a), B = grams(b);
  let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) || 0);
  const overlap = (2 * hit) / (a.length + b.length - 2);
  // A misheard character breaks two bigrams but leaves everything around it where it was.
  let placed = 0;
  if (a.length === b.length) { for (let i = 0; i < a.length; i++) if (a[i] === b[i]) placed++; placed /= a.length; }
  return overlap >= 0.6 || placed >= 0.5 ? Math.max(overlap, placed) : 0;
}

const MAX_AWAITING = 8;

export function transcriptAssembler({ context, close, revise, preview = () => {}, talking = () => false, quietMs = 1400, capMs = 6000, now = Date.now }) {
  let text = '', ctx = null, at = null, lastDelta = 0, timer = null;
  const awaiting = []; // closed here, transcript "done" still to come

  const commit = t => {
    const c = ctx, a = at;
    text = ''; ctx = at = null;
    clearTimeout(timer);
    preview('');
    return close(t, c, a);
  };
  const open = t => {
    text = t; ctx = context(); at = lastDelta = now();
    arm();
    preview(text);
  };
  const arm = () => { clearTimeout(timer); timer = setTimeout(quiet, quietMs); };
  function quiet() {
    if (!text) return;
    if (talking() && now() - lastDelta < capMs) { timer = setTimeout(quiet, 300); return; }
    flush();
  }
  function flush() {
    if (!text) return;
    const n = norm(text);
    awaiting.push({ norm: n, id: commit(text) });
    if (awaiting.length > MAX_AWAITING) awaiting.shift();
  }
  function delta(d) {
    if (!text) ctx = context(), at = now();
    text += d;
    lastDelta = now();
    arm();
    preview(text);
  }
  function done(raw) {
    const whole = norm(raw);
    let rest = whole;
    // Exactly what was closed here, possibly several in one, possibly after a done that never came.
    for (let i; rest && (i = awaiting.findIndex(a => a.norm && rest.startsWith(a.norm))) >= 0;) {
      rest = rest.slice(awaiting[i].norm.length);
      awaiting.splice(0, i + 1);
    }
    if (!rest) return;
    const heard = norm(text);
    if (heard.startsWith(rest)) {
      // The transcript closed part-way through what was heard: what follows opens the next phrase.
      const cut = indexAfter(text, rest.length), tail = text.slice(cut);
      commit(text.slice(0, cut));
      if (norm(tail)) open(tail);
      return;
    }
    // The same words transcribed a little differently: a correction, but only of the phrase it resembles.
    let k = -1, best = 0;
    awaiting.forEach((a, i) => { const score = likeness(a.norm, rest); if (score > best) { best = score; k = i; } });
    if (k >= 0) {
      const [late] = awaiting.splice(0, k + 1).slice(-1);
      if (late.id) revise(late.id, raw);
      return;
    }
    // Several closed phrases heard again as one sentence: nothing to take back, and no single phrase to correct.
    let joined = '';
    for (let j = 0; j < awaiting.length; j++) {
      joined += awaiting[j].norm;
      if (likeness(joined, rest)) { awaiting.splice(0, j + 1); return; }
    }
    if (heard && likeness(heard, rest)) { commit(raw); return; }
    // Nothing here resembles it: words we never saw arrive as deltas, spoken now.
    close(rest === whole ? raw : rest, context(), now());
  }
  return { delta, done, flush, get open() { return !!text; } };
}
