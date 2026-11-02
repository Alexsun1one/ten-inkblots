#!/usr/bin/env node
// Session server: canvas UI over HTTP/SSE, voice bridge, protocol pacing, and the agent's file channel.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, createReadStream, existsSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendLine, paths, readIf, readJson, writeJsonAtomic } from './lib/session.mjs';
import { CHOICE_NEXT, CHOICE_SKIP, INQUIRY_NEXT, NEXT_CMD, isRefusal, norm, pickedCard, transcriptAssembler } from './lib/transcript.mjs';
import { isCrisis } from './lib/safety.mjs';
import { RealtimeBridge, TALK_RULES, ACTOR_RULES, codexAvailable, findBin, toolEnv } from './lib/realtime.mjs';
import { structuralSummary, validateCodes, codeWarnings } from './lib/scoring.mjs';
import { renderReport, validateNarrative, transcriptMarkdown } from './lib/report.mjs';
import { computeSignals } from './lib/signals.mjs';
import { geometry, normDeg } from './lib/geometry.mjs';
import { derivedState, loadProtocol, validateProtocol } from './lib/protocol.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'app');
const DIR = process.argv[2];
const OPT = JSON.parse(process.argv[3] || '{}');
const P = paths(DIR);
// A restarted server keeps its address, so a page still open reconnects by itself.
const PRIOR = OPT.resume ? readJson(P.meta) : null;
const KEY = (PRIOR?.url && new URL(PRIOR.url).searchParams.get('k')) || randomBytes(16).toString('hex');
const PLATES = JSON.parse(readFileSync(join(APP, 'plates', 'plates.json'), 'utf8'));
const log = (...a) => { try { appendLine(P.log, { at: Date.now(), m: a.join(' ') }); } catch { /* the record was deleted */ } };
process.on('unhandledRejection', e => log('unhandled rejection', e?.stack || e));

const SCRIPT = {
  welcome: '你好。接下来我们会一起看十张墨迹，大约四十分钟，随时可以停下。开始之前想问你一件事：今天，有没有什么想带着来看的问题？',
  instruction: '我会一张一张给你看。每张请告诉我，它可能是什么。说两三个就好，没有对错。你可以转动它、放大它。你停下来的时候，我可能会问一句还有吗，或者为什么，这不是说你答得不对，我只是想看清你看到的。看完一张，就说下一张。',
  nextCard: '这张呢？',
  firstPrompt: '这可能是什么？',
  nudge: '不着急，想到什么都可以说。',
  again: '刚才声音断了一下，你说的我可能没听到，可以再说一遍吗？',
  promptMore: '也许还能看到别的。',
  more: '还有吗？',
  pull: '好，这张就看到这里。',
  responseDone: '十张都看完了，谢谢你。稍等一下，我把你说的整理好。',
  inquiryIntro: '现在我们回头，再一起看一遍。我想看到你看到的样子。我会念出你说过的，请你把它圈出来，再告诉我，是什么让它看起来像那样。',
  inquiryAsk: label => `你说：${label}。能把它圈给我看吗？是什么让它看起来像这样？`,
  inquiryWhy: '为什么说它像？',
  inquiryWhere: '能把它圈出来吗？',
  choicesIntro: '最后四个问题。可以点那张图，也可以直接说第几张。',
  ask: {
    liked: '这十张里，你最喜欢哪一张？',
    disliked: '你最不喜欢哪一张？',
    father: '哪一张最能代表你的父亲？不想答可以跳过。',
    mother: '哪一张最能代表你的母亲？不想答也可以跳过。',
  },
  why: '为什么选它？',
  whyAgain: '能说说为什么吗？说不清也可以说不清。',
  choiceNudge: '不着急。说完了，我们就往下走。',
  moreWhy: '还有别的原因吗？',
  pickFirst: '先选一张，或者说跳过。',
  sameAsOther: '这张刚才已经选过了，换一张吧。',
  scoring: '谢谢你。我需要一点时间，把今天的内容写成一封信。',
  report: '信写好了。你可以慢慢读。想聊聊的话，直接和我说就好。',
  farewell: '好，今天就到这里。谢谢你。',
  safety: '我听到了。我们先把测试放一放。你现在安全吗？',
};
const STALL_MS = Number(process.env.RORSCHACH_STALL_MS) || 5 * 60 * 1000;
const PAGE_LEFT_MS = 20000;
const REDIALS = 3;
const REDIAL_MS = Number(process.env.RORSCHACH_REDIAL_MS) || 90000;
const WESTERN = { ',': '，', '.': '。', '?': '？', '!': '！', ':': '：', ';': '；' };
const fullWidth = s => s.replace(/([一-鿿])([,.?!:;])/g, (_, a, b) => a + WESTERN[b]);
const clean = s => s.replace(/\s+/g, ' ').replace(/([一-鿿，。！？、,.!?])\s+(?=[一-鿿，。！？、,.!?])/g, '$1').trim();

const cardBlank = () => ({ shownAt: null, endedAt: null, deg: 0, prompted: false, nudged: false, hinted: false });
const CHOICES = ['liked', 'disliked', 'father', 'mother'];
const OPPOSITE = { liked: 'disliked', disliked: 'liked' };
const choiceBlank = () => ({ card: null, skipped: false, askedAt: null, chosenAt: null, endedAt: null, via: null, askedWhy: false });
const choicesBlank = () => Object.fromEntries(CHOICES.map(k => [k, choiceBlank()]));
let S = readJson(P.state) || {
  id: DIR.split('/').pop(),
  createdAt: Date.now(),
  phase: 'threshold',
  voice: { mode: OPT.voice || 'auto', name: OPT.voiceName || 'spruce', status: 'idle', available: {} },
  name: OPT.name || null,
  person: { age: null, education: null, occupation: null },
  question: null,
  card: 1,
  cards: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, cardBlank()])),
  phrases: [],
  responses: [],
  strokes: [],
  removedStrokes: [],
  focus: null,
  choices: choicesBlank(),
  choiceAt: null,
  progress: '',
  feedback: {},
  paused: false,
  reportReady: false,
};
// Never reused, even for what was dropped or erased: the trace still names those ids.
const highest = list => list.reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0);
S.choices ||= choicesBlank();
const seq = S.seq = { p: Math.max(S.seq?.p || 0, highest(S.phrases)), r: Math.max(S.seq?.r || 0, highest(S.responses)), s: Math.max(S.seq?.s || 0, highest([...S.strokes, ...S.removedStrokes])) };
const save = () => writeJsonAtomic(P.state, S);
const toAgent = evt => appendLine(P.events, { ...evt, at: Date.now() });

// ---------- trace: the lossless log everything in protocol.json is derived from ----------
let traceSeq = existsSync(P.trace) ? readFileSync(P.trace, 'utf8').split('\n').filter(Boolean).length : 0;
function trace(type, data = {}, at = Date.now(), src = 'server') {
  appendLine(P.trace, { seq: ++traceSeq, t: Math.max(0, Math.round(at - S.createdAt)), src, type, phase: S.phase, ...data });
}
if (traceSeq) trace('session.restart', { voice: S.voice.mode }); else trace('session.start', { voice: S.voice.mode });
const CLIENT_EVENTS = new Set(['client.info', 'client.resize', 'client.visibility', 'client.fullscreen', 'client.here', 'exposure.start', 'exposure.end', 'gesture', 'tool', 'speech.onset', 'speech.offset', 'mic.mute', 'drag.card']);
function protocolNow() { save(); return loadProtocol(DIR); }
function writeProtocol() {
  const p = protocolNow();
  const errors = validateProtocol(p);
  writeJsonAtomic(P.protocol, p);
  if (errors.length) log('protocol invalid', errors.slice(0, 8).join(' | '));
  return { protocol: p, errors };
}

const clients = new Set();
const push = (type, data = {}) => { const m = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(m); };
const publicState = () => S;
const sync = () => { save(); push('state', publicState()); };

// ---------- speech queue ----------
let bridge = null;
let holdLines = false; // true from a dropped call until the new one can be heard
// Words about safety do not wait for a call: they go out as captions if that is all there is.
const linesHeld = () => holdLines && S.voice.mode === 'codex' && !S.paused;
const speech = { queue: [], busy: false, timer: null, current: null, id: traceSeq, briefing: null, rebrief: false };
function say(text, { flush = false, then = null } = {}) {
  // A step forward makes older unspoken lines stale.
  if (flush) {
    speech.queue.length = 0;
    if (speech.current && S.voice.mode !== 'codex') finishLine();
  }
  speech.queue.push({ id: ++speech.id, text, then });
  pump();
}
function pump() {
  if (speech.busy || !speech.queue.length || linesHeld()) return;
  const line = speech.queue.shift();
  speech.busy = true; speech.current = line;
  const guard = Math.max(9000, line.text.length * 420);
  speech.timer = setTimeout(finishLine, guard);
  trace('say.start', { id: line.id, text: line.text });
  push('say', { id: line.id, text: line.text, mode: S.voice.mode });
  if (S.voice.mode === 'codex' && bridge?.live) bridge.speak(line.text).catch(e => { log('speak failed', e.message); voiceLost('error', e.message); });
  // Local speech reports its own end. Anything else that cannot be heard gets the time it takes to read.
  else if (S.voice.mode !== 'local') { clearTimeout(speech.timer); speech.timer = setTimeout(finishLine, Math.min(9000, 900 + line.text.length * 160)); }
}
function finishLine() {
  clearTimeout(speech.timer);
  const line = speech.current;
  if (line) { trace('say.end', { id: line.id }); push('said', { id: line.id }); }
  speech.busy = false; speech.current = null;
  lastActivity = Date.now();
  line?.then?.();
  pump();
}

// ---------- user speech ----------
let talking = false, lastActivity = Date.now();
const here = () => ({ card: S.card, phase: S.phase, focus: S.focus, deg: S.cards[S.card]?.deg || 0 });
const heard = transcriptAssembler({
  context: here,
  talking: () => talking,
  preview: text => push('partial', { text: clean(text) }),
  close: (text, ctx, at) => onFinal(text, { source: 'codex', ctx, firstTextAt: at }),
  revise: (id, raw) => {
    const p = S.phrases.find(x => x.id === id);
    if (!p) return;
    p.text = fullWidth(clean(raw));
    trace('utterance.revised', { id, text: p.text });
    // A response quotes its utterances, so it can never read differently from them.
    for (const r of S.responses) {
      if (r.phrases?.includes(id)) r.verbatim = r.phrases.map(x => S.phrases.find(q => q.id === x)?.text).filter(Boolean).join(' ');
      for (const q of r.inquiry || []) if (q.phrase === id) q.text = p.text;
    }
    if (isCrisis(p.text)) { p.safety = true; onCrisis(p.text); }
    sync();
    toAgent({ t: 'utterance_revised', id, text: p.text });
  },
});
// Words belong to the moment they were spoken, whatever has moved on by the time the phrase closes.
function onFinal(raw, { source = 'external', typedAt = null, ctx = null, firstTextAt = Date.now() } = {}) {
  if (source !== 'codex') heard.flush();
  const text = source === 'codex' || source === 'whisper' ? fullWidth(clean(raw || '')).replace(/^[，。、,.!！?？]+/, '') : clean(raw || '');
  if (!text) return null;
  // Speakers can leak the examiner's voice back into the mic.
  if (speech.current && norm(speech.current.text).includes(norm(text)) && norm(text).length > 3) { trace('utterance.echo_dropped', { text }); return null; }
  lastActivity = Date.now();
  const { card, phase, focus, deg } = ctx ?? here();
  // Said in a crisis, or while the test is paused for one: about this person, not about the plate.
  const safety = S.paused || isCrisis(text);
  const phrase = { id: `p${++seq.p}`, card, phase, text, at: Date.now(), firstTextAt: firstTextAt ?? Date.now(), source, deg, ...(typedAt != null ? { typedAt } : {}), ...(safety ? { safety: true } : {}) };
  if (phase === 'inquiry' && focus && !safety) phrase.response = focus;
  // What is said while a question is open belongs to that question.
  const question = phase === 'choices' && !safety ? S.choiceAt : null;
  if (question) phrase.question = question;
  S.phrases.push(phrase);
  trace('utterance', { id: phrase.id, card, text, raw: raw || null, source, response: phrase.response ?? null, ...(safety ? { safety: true } : {}) });
  if (isCrisis(text)) onCrisis(text);
  // "Next" moves things along. It is not an answer about the plate, and goes on no response's record.
  const live = !S.paused && S.phase === phase;
  const skips = live && !!question && CHOICE_SKIP.test(text);
  const moves = live && !!question && !skips && CHOICE_NEXT.test(text);
  const picked = live && question && !skips && !moves ? pickedCard(text) : null;
  const isCommand = live && ((phase === 'response' && NEXT_CMD.test(text)) || (phase === 'inquiry' && INQUIRY_NEXT.test(text)) || skips || moves || !!picked?.only);
  if (isCommand) phrase.command = true;
  else if (phrase.response) { const r = S.responses.find(x => x.id === phrase.response); if (r) (r.inquiry ||= []).push({ phrase: phrase.id, text }); }
  sync();
  const command = skips ? 'skip' : picked?.only ? 'pick' : isCommand ? 'next' : null;
  toAgent({ t: 'utterance', id: phrase.id, phase, card, response: phrase.response, ...(question ? { question } : {}), text, ...(deg ? { deg } : {}), ...(command ? { command } : {}), ...(safety ? { safety: true } : {}) });
  if (isCommand && phase === 'response') nextCard('voice');
  // Encouraged once and still nothing: that is an answer too, and the record keeps it. Nobody has to argue to move on.
  else if (live && phase === 'response' && !safety && S.cards[card]?.nudged && onlyRefused(card)) nextCard('refused');
  if (isCommand && phase === 'inquiry') {
    const r = COMMANDS.inquire({ advance: true });
    toAgent({ t: r.done ? 'inquiry_done' : 'inquiry_next', via: 'voice', ...r });
  }
  if (skips) skipChoice(question, 'voice');
  if (moves) nextChoice(question, 'voice');
  // A name in the middle of a reason (「比第三张亮」) is not a choice, unless nothing is chosen yet or they said they changed their mind.
  if (picked && (picked.only || picked.changed || !S.choices[question].card)) { try { choose(question, picked.card, 'voice'); } catch (e) { say(e.message, { flush: true }); } }
  return phrase.id;
}
// The voice may talk freely only in debrief and while someone's safety comes first. Otherwise it reads lines.
function talkRules() {
  const n = readJson(P.narrative);
  const type = readJson(P.codes) && S.responses.length >= 8 ? structuralSummary(readJson(P.codes), id => S.responses.find(r => r.id === id)?.card).inkType : null;
  const told = n ? [type ? `墨型：${type.name} ${type.code}。这是这个项目编的一套记法，方便记住，没有科学验证。` : '', ...(n.takeaways || []).map(x => x.text), n.type?.note || '', ...(n.letter || []), n.answer || '', ...(n.undercurrents || []).map(x => `${x.title}：${x.saw}${x.maybe}（也可能：${x.other}）`), ...(n.portraits || []).map(x => `${x.title}：${x.body}`), ...Object.values(n.choices || {}), ...(n.sides || []).map(x => `${x.light}；${x.shade}`)].filter(Boolean).join('\n').replaceAll('==', '') : '';
  return told ? `${TALK_RULES}\n\n【报告内容】\n${told}` : TALK_RULES;
}
function voiceTalks() {
  if (S.voice.mode !== 'codex' || !bridge?.live) return;
  bridge.context(talkRules()).catch(() => {});
  push('gate', { open: true });
}
function voiceReads() {
  if (S.voice.mode !== 'codex') return;
  // The gate closes whether or not there is a call right now: the next call must not inherit it open.
  push('gate', { open: false });
  if (bridge?.live) bridge.context(ACTOR_RULES).catch(() => {});
}
function onCrisis(text, via) {
  if (S.paused) return;
  S.paused = true;
  trace('safety.pause', via ? { via } : {});
  // The instructions never finished. They start again when the test does.
  if (speech.briefing) { speech.briefing = null; S.briefing = false; speech.rebrief = true; }
  speech.queue.length = 0;
  say(SCRIPT.safety, { flush: true });
  push('safety', {});
  if (via !== 'agent') toAgent({ t: 'safety', text, instruction: '暂停测验。先回应这个人，问是否安全，提供 12356。不要继续施测，除非对方明确想继续。' });
  voiceTalks();
}
function clearPause(via) {
  S.paused = false;
  speech.rebrief = false;
  trace('safety.resume', { via });
  if (S.phase !== 'debrief') voiceReads();
}

// ---------- protocol ----------
const phrasesOn = n => S.phrases.filter(p => p.card === n && p.phase === 'response' && !p.command && !p.safety);
const responsesOn = n => S.responses.filter(r => r.card === n);
const onlyRefused = n => !responsesOn(n).length && phrasesOn(n).length > 0 && phrasesOn(n).every(p => isRefusal(p.text));
function showCard(n) {
  S.card = n;
  const c = S.cards[n];
  if (!c.shownAt) { c.shownAt = Date.now(); trace('card.shown', { card: n }); }
  lastActivity = Date.now();
  sync();
  push('card', { card: n });
}
function nextCard(via) {
  if (S.phase !== 'response') return { moved: false };
  if (S.paused) return { moved: false, reason: 'paused' };
  const n = S.card, c = S.cards[n];
  const said = responsesOn(n).length || phrasesOn(n).length;
  if (said === 0 && !c.nudged) { c.nudged = true; trace('pacing', { card: n, kind: 'nudge' }); say(SCRIPT.nudge); sync(); return { moved: false, reason: 'no_response_yet' }; }
  if (onlyRefused(n) && !c.nudged) { c.nudged = c.prompted = true; trace('pacing', { card: n, kind: 'nudge' }); say(SCRIPT.nudge); sync(); return { moved: false, reason: 'encouraged' }; }
  if (said === 1 && !c.prompted && !onlyRefused(n)) { c.prompted = true; trace('pacing', { card: n, kind: 'prompt_more' }); say(SCRIPT.promptMore); sync(); return { moved: false, reason: 'prompted_for_more' }; }
  c.endedAt = Date.now();
  trace('card.end', { card: n, via });
  const rec = protocolNow().cards[n - 1];
  toAgent({ t: 'card_end', card: n, rtMs: rec.timing.rtMs, rtBasis: rec.timing.rtBasis, durationMs: rec.timing.durationMs, view: rec.view, orientation: { changes: rec.orientation.changes.map(x => x.notation), dwellMs: rec.orientation.dwellMs }, phrases: phrasesOn(n).map(p => p.id), via });
  if (n === 10) {
    say(SCRIPT.responseDone, { flush: via !== 'pull' });
    S.responseDone = true;
    sync();
    push('responseDone');
    toAgent({ t: 'response_done', recorded: S.responses.length, unrecorded: S.phrases.filter(p => p.phase === 'response' && !p.command && !p.safety && !S.responses.some(r => r.phrases.includes(p.id))).map(p => p.id) });
  } else {
    showCard(n + 1);
    say(SCRIPT.nextCard, { flush: via !== 'pull' });
  }
  return { moved: true, card: S.card };
}
// An examiner who waits, then asks. Never over someone still talking, turning the plate, drawing or typing.
const EDUCATION = ['初中及以下', '高中或中专', '大专', '本科', '硕士', '博士'];
const FOLLOWUP_MS = Number(process.env.RORSCHACH_FOLLOWUP_MS) || 8000;
const HINT_MS = Number(process.env.RORSCHACH_HINT_MS) || Math.max(18000, FOLLOWUP_MS);
const HOLD_MS = 12000;
let askedAt = 0;
// A question just asked and not yet answered: the agent should not move on from under it.
const justAsked = () => holdLines || (Date.now() - askedAt < HOLD_MS && !S.phrases.some(p => p.at > askedAt));
function followUp(kind, line, where) {
  askedAt = Date.now();
  trace('pacing', { ...where, kind });
  say(line);
  toAgent({ t: 'asked', kind, text: line, ...where });
}
function hintOnce(holder, where) {
  if (holder.hinted) return;
  holder.hinted = true;
  trace('pacing', { ...where, kind: 'hint' });
  push('hint', { next: true });
}
function pace() {
  if (S.paused || speech.busy || talking || linesHeld()) return;
  const idle = Date.now() - lastActivity;
  if (S.phase === 'response' && !S.responseDone) {
    const c = S.cards[S.card], said = responsesOn(S.card).length || phrasesOn(S.card).length;
    if (!said && idle > 45000 && !c.nudged) { c.nudged = true; trace('pacing', { card: S.card, kind: 'nudge' }); say(SCRIPT.nudge); return; }
    if (onlyRefused(S.card)) {
      if (idle > FOLLOWUP_MS && !c.nudged) { c.nudged = c.prompted = true; followUp('nudge', SCRIPT.nudge, { card: S.card }); }
      else if (idle > HINT_MS) hintOnce(c, { card: S.card });
      return;
    }
    if (said > 0 && said < 3 && idle > FOLLOWUP_MS && !c.asked?.[said]) {
      (c.asked ||= {})[said] = true;
      if (said === 1) c.prompted = true;
      followUp('ask_more', SCRIPT.more, { card: S.card });
      return;
    }
    if (said && idle > HINT_MS) hintOnce(c, { card: S.card });
  } else if (S.phase === 'inquiry' && S.focus) {
    const r = S.responses.find(x => x.id === S.focus), words = r?.inquiry?.length, circled = r?.strokes?.length;
    if (!r || (!words && !circled) || idle <= FOLLOWUP_MS) return;
    const [kind, line] = !words ? ['ask_why', SCRIPT.inquiryWhy] : !circled ? ['ask_where', SCRIPT.inquiryWhere] : ['ask_more', SCRIPT.more];
    if (!r.asked?.[kind]) { (r.asked ||= {})[kind] = true; followUp(kind, line, { card: r.card, response: r.id }); return; }
    if (idle > HINT_MS) hintOnce(r, { card: r.card, response: r.id });
  } else if (S.phase === 'choices' && S.choiceAt) {
    const k = S.choiceAt, a = S.choices[k];
    if (!a.card || idle <= FOLLOWUP_MS) return;
    if (!reasonFor(k).length) { if (!a.askedWhy) { a.askedWhy = true; followUp('ask_why', SCRIPT.whyAgain, { question: k }); } return; }
    if (!a.askedMore) { a.askedMore = true; followUp('ask_more', SCRIPT.moreWhy, { question: k }); return; }
    if (idle > HINT_MS) hintOnce(a, { question: k });
    if (idle > 45000 && !a.nudged) { a.nudged = true; trace('pacing', { question: k, kind: 'nudge' }); say(SCRIPT.choiceNudge); }
  }
}
setInterval(pace, 500);

function setPhase(phase) {
  const from = S.phase;
  S.phase = phase;
  trace('phase', { from, to: phase });
  if (S.paused) clearPause('phase');
  switch (phase) {
    case 'intake': say(SCRIPT.welcome, { flush: true }); break;
    case 'response':
      S.responseDone = false;
      showCard(1);
      say(SCRIPT.firstPrompt, { flush: true });
      toAgent({ t: 'phase', phase: 'response', card: 1 });
      break;
    case 'inquiry': S.focus = null; say(SCRIPT.inquiryIntro, { flush: true }); break;
    case 'choices':
      S.focus = null;
      say(SCRIPT.choicesIntro, { flush: true });
      askChoice(CHOICES.find(k => !S.choices[k].endedAt) || CHOICES[0], false);
      break;
    case 'scoring': say(SCRIPT.scoring, { flush: true }); break;
    case 'report': say(SCRIPT.report, { flush: true }); break;
    case 'debrief': voiceTalks(); break;
    default:
  }
  sync();
  push('phase', { phase });
  return { phase };
}

// Instructions first, plate after, as at a real table: reaction time starts with the plate, not with the briefing.
function brief(flush = false) {
  if (S.phase !== 'intake' || speech.briefing) return { phase: S.phase, briefing: !!speech.briefing };
  if (S.paused) clearPause('phase');
  const mine = speech.briefing = {};
  S.briefing = true;
  say(SCRIPT.instruction, { flush, then: () => { if (speech.briefing !== mine) return; speech.briefing = null; S.briefing = false; if (S.phase === 'intake') setPhase('response'); else sync(); } });
  sync();
  return { phase: S.phase, briefing: true, next: '指导语念完后自动进入第一张，等 phase 事件' };
}
// The person says they are done. The agent exports and stops; until then the report stays open.
function endSession(via) {
  if (S.endRequested) return { ended: true };
  S.endRequested = true;
  trace('end.requested', { via });
  say(SCRIPT.farewell, { flush: true });
  sync();
  toAgent({ t: 'end_requested', via });
  return { ended: true };
}

// ---------- the four questions ----------
const reasonFor = k => S.phrases.filter(p => p.question === k && !p.command && !p.safety);
const asAnswer = k => { const a = S.choices[k]; return { question: k, card: a.card, skipped: a.skipped, why: reasonFor(k).map(p => p.text).join(' ') }; };
function askChoice(k, flush = true) {
  S.choiceAt = k;
  S.choices[k].askedAt ??= Date.now();
  trace('choice.ask', { question: k });
  say(SCRIPT.ask[k], { flush });
  sync();
  return { question: k };
}
function choose(k, card, via) {
  if (!CHOICES.includes(k)) throw new Error(`没有这一题：${k}`);
  const n = Number(card);
  if (!S.cards[n]) throw new Error(`没有第 ${card} 张`);
  const other = OPPOSITE[k] && S.choices[OPPOSITE[k]];
  if (other?.card === n) throw new Error(SCRIPT.sameAsOther);
  const a = S.choices[k];
  Object.assign(a, { card: n, skipped: false, via, chosenAt: Date.now(), endedAt: k === S.choiceAt ? null : a.endedAt });
  trace('choice.card', { question: k, card: n, via });
  sync();
  toAgent({ t: 'choice', question: k, card: n, via });
  if (k === S.choiceAt && !reasonFor(k).length) say(SCRIPT.why, { flush: true });
  return { question: k, card: n };
}
function advanceChoice(k, via) {
  const a = S.choices[k];
  a.endedAt = Date.now();
  trace('choice.end', { question: k, via });
  toAgent({ t: 'choice_next', via, ...asAnswer(k) });
  const open = CHOICES.slice(CHOICES.indexOf(k) + 1).find(x => !S.choices[x].endedAt) || CHOICES.find(x => !S.choices[x].endedAt);
  if (open) { askChoice(open); return { moved: true, question: open }; }
  S.choiceAt = null;
  sync();
  toAgent({ t: 'choices_done', via, answers: CHOICES.map(asAnswer) });
  // Nothing is left for the person to do, so nobody waits on the agent to say so.
  setPhase('scoring');
  return { moved: true, done: true };
}
function nextChoice(k, via) {
  if (S.phase !== 'choices') return { moved: false, reason: 'not_choices' };
  if (S.paused) return { moved: false, reason: 'paused' };
  if (k !== S.choiceAt) return { moved: false, reason: 'already_moved', question: S.choiceAt };
  if (via === 'agent' && justAsked()) return { moved: false, reason: 'just_asked', question: k };
  const a = S.choices[k];
  if (!a.card && !a.skipped) { say(SCRIPT.pickFirst, { flush: true }); return { moved: false, reason: 'no_choice' }; }
  if (a.card && !reasonFor(k).length && !a.askedWhy) {
    a.askedWhy = true;
    trace('pacing', { question: k, kind: 'ask_why' });
    say(SCRIPT.whyAgain, { flush: true });
    sync();
    return { moved: false, reason: 'asked_why' };
  }
  return advanceChoice(k, via);
}
function skipChoice(k, via) {
  if (S.phase !== 'choices') return { moved: false, reason: 'not_choices' };
  if (S.paused) return { moved: false, reason: 'paused' };
  if (k !== S.choiceAt) return { moved: false, reason: 'already_moved', question: S.choiceAt };
  Object.assign(S.choices[k], { card: null, skipped: true, via, chosenAt: null });
  trace('choice.skip', { question: k, via });
  return advanceChoice(k, via);
}
function revisitChoice(k) {
  if (S.phase !== 'choices') return { moved: false, reason: 'not_choices' };
  if (S.paused) return { moved: false, reason: 'paused' };
  if (!CHOICES.includes(k)) throw new Error(`没有这一题：${k}`);
  S.choices[k].endedAt = null;
  S.choices[k].skipped = false;
  return { moved: true, ...askChoice(k) };
}

// ---------- agent commands ----------
function ellipsePts([cx, cy, rx, ry]) {
  const pts = [];
  for (let i = 0; i <= 36; i++) { const a = -Math.PI / 2 + (i / 36) * Math.PI * 2.08; pts.push([+(cx + rx * Math.cos(a)).toFixed(4), +(cy + ry * Math.sin(a)).toFixed(4)]); }
  return pts;
}
const COMMANDS = {
  say: ({ text }) => { if (!text) throw new Error('缺少文字'); say(text); return { queued: speech.queue.length }; },
  phase: ({ name }) => {
    if (!['intake', 'response', 'inquiry', 'choices', 'scoring', 'report', 'debrief'].includes(name)) throw new Error('未知阶段');
    if (name === S.phase) return { phase: name };
    if (name === 'report' && !S.reportReady) throw new Error('报告还没生成，先运行 report --file');
    if (name === 'response' && S.phase === 'intake') return brief();
    return setPhase(name);
  },
  resume: ({ via = 'agent' } = {}) => {
    const again = speech.rebrief;
    clearPause(via);
    if (again) brief();
    sync();
    return { paused: false };
  },
  // Keywords miss things. The agent can stop the test as well, and what it names is treated like anything said in a pause.
  pause: ({ phrases } = {}) => {
    const ids = String(phrases || '').split(',').map(s => s.trim()).filter(Boolean);
    const found = ids.map(i => S.phrases.find(p => p.id === i));
    if (found.some(x => !x)) throw new Error(`找不到语句：${ids.filter((_, k) => !found[k]).join(',')}`);
    for (const p of found) { p.safety = true; trace('utterance.safety', { id: p.id }); }
    onCrisis('', 'agent');
    sync();
    return { paused: true };
  },
  next: () => nextCard('agent'),
  question: ({ text }) => { S.question = clean(text || ''); sync(); return { question: S.question }; },
  name: ({ text }) => { S.name = clean(text || '') || null; sync(); return { name: S.name }; },
  record: ({ phrases, label, card, clean: tidy, id, plate }) => {
    const ids = String(phrases || '').split(',').map(s => s.trim()).filter(Boolean);
    const found = ids.map(i => S.phrases.find(p => p.id === i));
    if (!ids.length || found.some(x => !x)) throw new Error(`找不到语句：${ids.filter((_, k) => !found[k]).join(',') || '未提供 --phrases'}`);
    if (!label) throw new Error('缺少 --label');
    // Recording these would have the script read them back and ask the person to circle them.
    const personal = found.filter(p => p.safety).map(p => p.id);
    if (personal.length && !plate) throw new Error(`${personal.join(',')} 是对方在安全暂停里说的话，不是回应，不要记录。只有它确实在描述图版（如「一个上吊的人」）才加 --plate。`);
    const verbatim = found.map(p => p.text).join(' ');
    const existing = id && S.responses.find(r => r.id === id);
    const n = Number(card || found[0].card);
    const deg = found[0].deg || 0;
    if (existing) Object.assign(existing, { phrases: ids, label, verbatim, tidy: tidy || existing.tidy, card: n, deg });
    else S.responses.push({ id: `r${++seq.r}`, card: n, label, verbatim, tidy: tidy || null, phrases: ids, inquiry: [], strokes: [], deg });
    S.responses.sort((a, b) => a.card - b.card || Number(a.id.slice(1)) - Number(b.id.slice(1)));
    const rid = existing ? existing.id : `r${seq.r}`;
    const pull = !S.paused && S.phase === 'response' && n === S.card && responsesOn(n).length >= 4 && !S.cards[n].pulled;
    trace('response.recorded', { id: rid, card: n, phrases: ids, label, revised: !!existing });
    sync();
    push('record', { id: rid });
    if (pull) { S.cards[n].pulled = true; trace('pacing', { card: n, kind: 'pull' }); say(SCRIPT.pull); nextCard('pull'); }
    return { id: rid, onCard: responsesOn(n).length, pulled: !!pull };
  },
  drop: ({ id }) => {
    const k = S.responses.findIndex(r => r.id === id);
    if (k < 0) throw new Error('找不到回应');
    trace('response.dropped', { id, card: S.responses[k].card, label: S.responses[k].label });
    S.responses.splice(k, 1);
    // What was said and drawn stays on the record, without an owner.
    for (const s of S.strokes) if (s.response === id) { s.response = null; trace('stroke.assigned', { id: s.id, response: null }); }
    for (const s of S.removedStrokes) if (s.response === id) s.response = null;
    for (const p of S.phrases) if (p.response === id) delete p.response;
    if (S.focus === id) S.focus = null;
    sync();
    return { dropped: id };
  },
  assign: ({ stroke, response }) => {
    const s = S.strokes.find(x => x.id === stroke), r = response ? S.responses.find(x => x.id === response) : null;
    if (!s) throw new Error(`找不到圈画 ${stroke}`);
    if (response && !r) throw new Error(`找不到回应 ${response}`);
    if (r && r.card !== s.card) throw new Error(`${stroke} 在第 ${s.card} 张，${response} 在第 ${r.card} 张`);
    for (const x of S.responses) if (x.strokes) x.strokes = x.strokes.filter(i => i !== s.id);
    s.response = r?.id ?? null;
    if (r) (r.strokes ||= []).push(s.id);
    trace('stroke.assigned', { id: s.id, response: s.response });
    sync();
    return { stroke: s.id, response: s.response };
  },
  inquire: ({ id, line, advance }) => {
    if (S.paused) return { paused: true };
    const entering = S.phase !== 'inquiry';
    if (entering) setPhase('inquiry');
    // Asked twice without an answer in between: stay on this one, so nothing gets skipped by accident.
    const open = !id && !advance && S.focus && S.responses.find(r => r.id === S.focus);
    if (open && ((!open.inquiry?.length && !open.strokes?.length) || justAsked())) return { id: open.id, card: open.card, label: open.label, verbatim: open.verbatim, remaining: S.responses.filter(r => !r.inquired).length, unanswered: true };
    const target = id ? S.responses.find(r => r.id === id) : S.responses.find(r => !r.inquired);
    if (!target) return { done: true, remaining: 0 };
    target.inquired = true;
    S.focus = target.id;
    S.card = target.card;
    // The plate comes back the way it was when the person saw this in it.
    S.cards[target.card].deg = target.deg || 0;
    // Their own words, read back. A long ramble falls back to the short form.
    const quote = target.verbatim && norm(target.verbatim).length <= 40 ? target.verbatim.replace(/[\s，。！？、,.!?…]+$/, '') : target.tidy || target.label;
    const prompt = line || SCRIPT.inquiryAsk(quote);
    trace('inquiry.start', { response: target.id, card: target.card, prompt });
    sync();
    push('focus', { id: target.id, card: target.card, deg: target.deg || 0 });
    // Entering, the introduction is still to be heard: don't talk over it.
    say(prompt, { flush: !entering });
    return { id: target.id, card: target.card, label: target.label, verbatim: target.verbatim, remaining: S.responses.filter(r => !r.inquired).length };
  },
  mark: ({ card, region, box, label }) => {
    const n = Number(card || S.card);
    const shape = region ? PLATES.plates[n]?.regions[region] : (box || '').split(',').map(Number);
    if (!shape || shape.length !== 4 || shape.some(Number.isNaN)) throw new Error(`未知区域。第 ${n} 张可用：${Object.keys(PLATES.plates[n]?.regions || {}).join(', ')}`);
    const pts = ellipsePts(shape), now = Date.now();
    const stroke = { id: `s${++seq.s}`, card: n, by: 'examiner', phase: S.phase, pts, startAt: now, endAt: now, geo: geometry(PLATES, n, [pts], S.cards[n].deg), label: label || null, response: S.responses.find(r => r.id === S.focus && r.card === n)?.id ?? null };
    S.strokes.push(stroke);
    trace('stroke.added', { id: stroke.id, card: n, by: 'examiner', response: stroke.response });
    sync();
    push('stroke', stroke);
    return { id: stroke.id };
  },
  unmark: ({ card }) => { const n = Number(card || S.card); S.strokes.filter(s => s.by === 'examiner' && s.card === n).forEach(s => removeStroke(s, 'unmark')); sync(); return {}; },
  choice: ({ question, card, next, skip }) => {
    if (S.phase !== 'choices' && (next || skip)) return { moved: false, reason: 'not_choices' };
    const k = question || S.choiceAt;
    if (!k) throw new Error('现在没有正在问的题，用 --question 指明要改哪一题');
    if (next) return nextChoice(k, 'agent');
    if (skip) return skipChoice(k, 'agent');
    if (card == null) throw new Error('缺少 --card、--next 或 --skip');
    return choose(k, card, 'agent');
  },
  progress: ({ text }) => { S.progress = text || ''; sync(); return {}; },
  heard: ({ text }) => { onFinal(text || '', { source: 'external' }); return { phrases: S.phrases.length }; },
  code: ({ file }) => {
    const codes = readJson(file);
    if (!Array.isArray(codes)) throw new Error('codes 文件应是数组');
    const errors = validateCodes(codes, S.responses);
    if (errors.length) return { ok: false, errors };
    writeJsonAtomic(P.codes, codes);
    trace('scoring.coded', { responses: codes.length });
    const summary = structuralSummary(codes, id => S.responses.find(r => r.id === id).card);
    const { protocol } = writeProtocol();
    writeFileSync(P.transcript, transcriptMarkdown(derivedState(S, protocol), codes));
    return { ok: true, summary, signals: computeSignals(derivedState(S, protocol), codes, protocol), warnings: codeWarnings(codes, S.responses), transcript: P.transcript, protocol: P.protocol };
  },
  signals: () => {
    const codes = readJson(P.codes);
    if (!codes) throw new Error('先运行 code --file');
    const protocol = protocolNow();
    return { signals: computeSignals(derivedState(S, protocol), codes, protocol) };
  },
  report: ({ file }) => {
    const n = readJson(file);
    const codes = readJson(P.codes);
    if (!codes) throw new Error('先运行 code --file');
    // Responses can change after coding.
    const stale = validateCodes(codes, S.responses);
    if (stale.length) return { ok: false, errors: ['编码和现在的回应对不上，改好后重新运行 code --file', ...stale] };
    const summary = structuralSummary(codes, id => S.responses.find(r => r.id === id).card);
    const signals = (protocol => computeSignals(derivedState(S, protocol), codes, protocol))(protocolNow());
    const errors = validateNarrative(n, S, summary, signals);
    if (errors.length) return { ok: false, errors };
    const render = protocol => renderReport({ state: derivedState(S, protocol), codes, summary, narrative: n, signals, protocol, plates: join(APP, 'plates', 'thumbs'), qr: join(APP, 'author-qr.png'), repoQr: join(APP, 'repo-qr.png'), css: readFileSync(join(APP, 'report.css'), 'utf8'), js: readFileSync(join(APP, 'report.js'), 'utf8') });
    // A rehearsal first: if it cannot render, the person must not be moved to a report that isn't there.
    try { render(protocolNow()); }
    catch (e) { log('report render failed', e.stack); return { ok: false, errors: [`报告没有生成：${e.message}`] }; }
    writeJsonAtomic(P.narrative, n);
    S.reportReady = true;
    if (S.phase !== 'report' && S.phase !== 'debrief') setPhase('report');
    trace('report.generated');
    const { protocol, errors: dataErrors } = writeProtocol();
    writeFileSync(P.report, render(protocol));
    writeFileSync(P.transcript, transcriptMarkdown(derivedState(S, protocol), codes));
    push('report', { url: `/report?k=${KEY}` });
    return { ok: true, report: P.report, url: `${baseUrl}/report?k=${KEY}`, protocol: P.protocol, ...(dataErrors.length ? { protocolErrors: dataErrors } : {}) };
  },
  status: () => ({ session: DIR, phase: S.phase, card: S.card, paused: S.paused, voice: S.voice.mode, voiceStatus: S.voice.status, responses: S.responses.length, focus: S.focus, url: `${baseUrl}/?k=${KEY}`, browser: clients.size }),
  stop: () => { setTimeout(shutdown, 200); return { stopping: true }; },
};

// After a restart, whatever is already in the inbox has been done.
let inboxPos = existsSync(P.inbox) ? statSync(P.inbox).size : 0;
function pollInbox() {
  if (!existsSync(P.inbox)) return;
  const size = statSync(P.inbox).size;
  if (size <= inboxPos) return;
  const fd = openSync(P.inbox, 'r');
  const buf = Buffer.alloc(size - inboxPos);
  readSync(fd, buf, 0, buf.length, inboxPos);
  closeSync(fd);
  const end = buf.lastIndexOf(10);
  if (end < 0) return;
  inboxPos += end + 1;
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    let cmd;
    try { cmd = JSON.parse(line); } catch { continue; }
    let reply;
    try { reply = { id: cmd.id, ok: true, result: (COMMANDS[cmd.cmd] || (() => { throw new Error(`未知命令 ${cmd.cmd}`); }))(cmd.args || {}) }; }
    catch (e) { reply = { id: cmd.id, ok: false, error: e.message }; log('cmd error', cmd.cmd, e.stack); }
    appendLine(P.replies, reply);
  }
}
setInterval(pollInbox, 90);

// ---------- voice ----------
function whisperModel() {
  const dir = process.env.RORSCHACH_WHISPER_DIR || join(homedir(), '.cache', 'rorschach', 'models');
  try { const f = readdirSync(dir).filter(x => x.endsWith('.bin')).map(x => join(dir, x)); return f[0] || null; } catch { return null; }
}
const whisperBin = () => process.env.RORSCHACH_WHISPER_BIN || findBin('whisper-cli');
// Not by running it: a cold whisper-cli takes over 20s just to load its backends, even for --help.
const hasWhisper = () => !!whisperBin() && !!whisperModel();
function resolveVoice() {
  // A restart cannot keep a WebRTC call that died with the old process. Typing carries on unless a voice is asked for.
  if (OPT.resume && !OPT.voice) {
    OPT.voice = S.voice.mode === 'codex' ? 'text' : S.voice.mode;
    if (S.voice.mode === 'codex') { S.voice.status = 'closed'; S.voice.error = 'server restart'; trace('voice', { status: 'closed', mode: 'text', reason: 'server restart' }); }
  }
  const codex = OPT.voice === 'local' || OPT.voice === 'text' || OPT.voice === 'external' ? null : codexAvailable();
  const local = hasWhisper();
  S.voice.available = { codex: !!codex, local };
  if (OPT.voice === 'external' || OPT.voice === 'text') S.voice.mode = OPT.voice;
  else if (OPT.voice === 'local') S.voice.mode = local ? 'local' : 'text';
  else if (OPT.voice === 'codex') S.voice.mode = codex ? 'codex' : 'text';
  else S.voice.mode = codex ? 'codex' : local ? 'local' : 'text';
  // Warm the page cache now so the person's first sentence is not the one that waits.
  if (S.voice.mode === 'local') spawn(whisperBin(), ['--help'], { stdio: 'ignore', env: toolEnv(whisperBin()) }).on('error', () => {});
  if (codex) {
    bridge = new RealtimeBridge({ bin: codex.bin, cwd: DIR, log });
    bridge.on('started', () => {
      if (S.phase === 'debrief' || S.paused) voiceTalks();
      else if (callTalks) voiceReads(); // the pause ended while this call was being placed with talking rules
      callTalks = false;
    });
    bridge.on('delta', (role, d) => { if (role === 'user') { lastActivity = Date.now(); heard.delta(d); } else push('voiceDelta', { d }); });
    bridge.on('done', (role, text) => { if (role === 'user') heard.done(text); else if (speech.current) finishLine(); });
    bridge.on('handoff', text => { if (isCrisis(text)) onCrisis(clean(text)); toAgent({ t: 'handoff', text: clean(text || ''), note: '用户直接对你说的话或请求，语音模型已转交给你' }); });
    bridge.on('error', m => voiceLost('error', String(m ?? '')));
    bridge.on('closed', r => voiceLost('closed', String(r ?? '')));
  }
  sync();
}
// The record says what actually happened from here on: typing, not a voice that is gone.
function voiceLost(status, reason) {
  heard.flush();
  if (stopping || S.voice.mode !== 'codex') return;
  // Nothing to lose, unless the page reports a call the server had put down to a page leaving.
  if (S.voice.status !== 'live' && !(status === 'lost' && S.voice.status === 'idle')) return;
  // The call ends with the page that held it. A refresh brings a new one, so that is no reason to give up on voice.
  if (status === 'closed' && !clients.size && Date.now() - pageLeftAt < PAGE_LEFT_MS) {
    endCutLine();
    S.voice.status = 'idle';
    S.voice.dial = (S.voice.dial || 0) + 1; // the same page coming back on a reconnect has to place the call itself
    trace('voice', { status: 'page_left', mode: 'codex', reason });
    sync();
    return;
  }
  // A call can drop at any point in a long session. While the page is here, it can place a new one.
  if (Date.now() - liveSince > 60000) redials = 0;
  if (clients.size && redials < REDIALS) return redial(status, reason);
  giveUpVoice(status, reason);
}
// The line being read will never report that it ended.
function endCutLine() { if (speech.current) { clearTimeout(speech.timer); speech.timer = setTimeout(finishLine, 1500); } }
let redials = 0, redialTimer = null, liveSince = 0, callTalks = false, gap = null, speechInGap = false;
function redial(status, reason) {
  redials++;
  holdLines = true;
  S.voice.status = 'redialing';
  S.voice.dial = (S.voice.dial || 0) + 1;
  gap ??= { at: Date.now(), card: S.phase === 'response' ? S.card : null };
  speechInGap ||= talking;
  // The person never heard the end of whatever was being read, so the new call reads it again.
  const line = speech.current;
  if (line) {
    clearTimeout(speech.timer);
    trace('say.end', { id: line.id, cut: true });
    push('said', { id: line.id });
    speech.busy = false; speech.current = null;
    speech.queue.unshift({ ...line, id: ++speech.id });
  }
  trace('voice', { status: 'redialing', mode: 'codex', reason });
  sync();
  clearTimeout(redialTimer);
  redialTimer = setTimeout(() => giveUpVoice(status, reason), REDIAL_MS);
}
// Time with no voice is not time spent looking at the plate.
function endGap() {
  if (!gap) return;
  const ms = Date.now() - gap.at;
  for (const n of new Set([gap.card, S.phase === 'response' ? S.card : null])) if (S.cards[n]) S.cards[n].voiceGapMs = (S.cards[n].voiceGapMs || 0) + ms;
  gap = null;
}
function releaseLines() { holdLines = false; pump(); }
function giveUpVoice(status, reason) {
  clearTimeout(redialTimer);
  endGap();
  if (!stopping && S.voice.mode === 'codex') {
    endCutLine();
    Object.assign(S.voice, { mode: 'text', status, error: reason });
    trace('voice', { status, mode: 'text', reason });
    bridge?.stop().catch(() => {});
    sync();
    push('voiceLost', { message: reason });
    toAgent({ t: 'voice', status, mode: 'text', reason });
  }
  releaseLines();
}

function transcribe(buf) {
  return new Promise(resolve => {
    const f = join(DIR, `stt-${Date.now()}.wav`);
    writeFileSync(f, buf);
    const bin = whisperBin();
    const cp = spawn(bin, ['-m', whisperModel(), '-l', 'zh', '-nt', '-np', '--prompt', '以下是普通话的句子。', '-f', f], { stdio: ['ignore', 'pipe', 'ignore'], env: toolEnv(bin) });
    let out = '';
    cp.stdout.on('data', d => { out += d; });
    cp.on('close', () => { rmSync(f, { force: true }); resolve(out.trim()); });
    cp.on('error', () => { rmSync(f, { force: true }); resolve(''); });
  });
}

// ---------- browser API ----------
const body = req => new Promise((res, rej) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c))); req.on('error', rej); });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const json = (res, v, code = 200) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); };

function removeStroke(s, via, redoable = false) {
  S.strokes.splice(S.strokes.indexOf(s), 1);
  for (const r of S.responses) if (r.strokes) r.strokes = r.strokes.filter(x => x !== s.id);
  Object.assign(s, { removedAt: Date.now(), removedVia: via, redoable });
  S.removedStrokes.push(s);
  trace('stroke.removed', { id: s.id, card: s.card, via });
  toAgent({ t: 'stroke_removed', id: s.id, card: s.card, via });
}
const clampPt = v => Math.min(1.05, Math.max(-.05, +Number(v).toFixed(4)));

const API = {
  'POST /api/person': async b => {
    if (S.phase !== 'threshold') return { error: 'already_started' };
    const short = (v, n) => clean(String(v ?? '')).slice(0, n) || null;
    const age = Number(b.age);
    S.name = short(b.name, 20);
    S.person = {
      age: Number.isInteger(age) && age > 0 && age <= 120 ? age : null,
      education: EDUCATION.includes(b.education) ? b.education : null,
      occupation: short(b.occupation, 40),
    };
    trace('person', { name: S.name, ...S.person });
    sync();
    return { name: S.name, ...S.person };
  },
  'POST /api/begin': async () => { if (S.phase === 'threshold') setPhase('intake'); toAgent({ t: 'begin', voice: S.voice.mode, person: { name: S.name, ...S.person } }); return {}; },
  'POST /api/voice/offer': async b => {
    S.voice.name = b.voice || S.voice.name;
    const redialing = holdLines;
    try {
      if (!redialing) S.voice.status = 'connecting';
      // A call that begins where the voice may talk starts with those rules: rules appended later can arrive before the call can hear them.
      callTalks = S.phase === 'debrief' || S.paused;
      const sdp = await bridge.start(b.sdp, S.voice.name, callTalks ? talkRules() : undefined);
      if (redialing) {
        if (S.voice.mode === 'codex') return { sdp }; // live once the page says it can be heard
        bridge.stop().catch(() => {}); // given up while this was on its way
        return { error: 'voice_given_up' };
      }
      liveSince = Date.now();
      S.voice.status = 'live'; S.voice.mode = 'codex'; S.voice.error = null;
      pageLeftAt = 0; // the page that left has come back; if this call ends now, the voice really is gone
      trace('voice', { status: 'live', mode: 'codex' });
      sync();
      toAgent({ t: 'voice', status: 'live', voice: S.voice.name });
      return { sdp };
    } catch (e) {
      // Whether to try again is the page's call, and it knows when to stop.
      if (redialing) { log('redial failed', e.message); return { error: e.message, retry: true }; }
      S.voice.status = 'error'; S.voice.error = e.message;
      S.voice.mode = S.voice.available.local ? 'local' : 'text';
      trace('voice', { status: 'failed', mode: S.voice.mode, reason: e.message });
      sync();
      toAgent({ t: 'voice', status: 'failed', message: e.message, fallback: S.voice.mode });
      clearTimeout(redialTimer);
      if (holdLines) { endGap(); releaseLines(); }
      return { error: e.message, fallback: S.voice.mode };
    }
  },
  'POST /api/voice/up': async () => {
    if (!holdLines || S.voice.mode !== 'codex') return {};
    clearTimeout(redialTimer);
    endGap();
    liveSince = Date.now();
    S.voice.status = 'live'; S.voice.error = null;
    pageLeftAt = 0;
    // A question cut off is asked again from here, so the agent's wait for an answer starts from here too.
    if (askedAt && !S.phrases.some(p => p.at > askedAt)) askedAt = Date.now();
    trace('voice', { status: 'live', mode: 'codex' });
    sync();
    toAgent({ t: 'voice', status: 'live', voice: S.voice.name });
    releaseLines();
    if (speechInGap && !S.paused && S.phase !== 'debrief') say(SCRIPT.again);
    speechInGap = false;
    // The old call's end can be reported after the new one starts. Lines would then show without being read.
    setTimeout(() => { if (S.voice.status === 'live' && S.voice.mode === 'codex' && !bridge?.live) voiceLost('closed', 'no call after redial'); }, 3000);
    return {};
  },
  'POST /api/voice/redial': async b => { voiceLost('lost', String(b.reason ?? '')); return {}; },
  'POST /api/voice/mode': async b => {
    clearTimeout(redialTimer);
    if (b.status === 'failed' || b.status === 'lost') bridge?.stop().catch(() => {});
    S.voice.mode = b.mode; S.voice.status = b.status || (S.voice.status === 'redialing' ? 'failed' : S.voice.status);
    endGap();
    const status = b.status === 'lost' ? 'lost' : 'mode';
    trace('voice', { status, mode: b.mode, reason: b.reason || null });
    sync();
    toAgent({ t: 'voice', status, mode: b.mode, reason: b.reason || null });
    if (holdLines) releaseLines();
    return {};
  },
  'POST /api/said': async b => { if (speech.current && speech.current.id === b.id) finishLine(); return {}; },
  'POST /api/utter': async b => { onFinal(b.text || '', { source: 'typed', typedAt: b.startedAt != null && b.sentAt != null ? Date.now() - (b.sentAt - b.startedAt) : null }); return {}; },
  'POST /api/trace': async b => {
    // Re-anchor each batch to this clock, so browser clock drift cannot enter the record.
    const offset = Date.now() - (b.sentAt ?? Date.now());
    for (const { type, at, endAt, ...rest } of b.events || []) {
      if (!CLIENT_EVENTS.has(type)) { log('unknown client event', type); continue; }
      trace(type, { ...rest, ...(endAt != null ? { endMs: Math.max(0, Math.round(endAt + offset - S.createdAt)) } : {}) }, (at ?? Date.now() - offset) + offset, 'client');
      if (type === 'gesture' && rest.card && rest.to?.deg != null && S.cards[rest.card]) S.cards[rest.card].deg = normDeg(rest.to.deg);
      if (type === 'gesture') lastActivity = Date.now();
      if (type === 'speech.onset') { talking = true; if (holdLines) speechInGap = true; }
      if (type === 'speech.offset') talking = false;
    }
    save();
    return {};
  },
  'POST /api/next': async () => {
    if (S.phase === 'intake') {
      if (S.paused || speech.briefing) return { moved: false, reason: S.paused ? 'paused' : 'briefing' };
      const r = brief(true);
      toAgent({ t: 'intake_done', via: 'button', phrases: S.phrases.filter(p => p.phase === 'intake' && !p.safety).map(p => p.id) });
      return r;
    }
    if (S.phase === 'report' || S.phase === 'debrief') return endSession('button');
    if (S.phase === 'choices') return nextChoice(S.choiceAt, 'button');
    if (S.phase !== 'inquiry') return nextCard('button');
    const r = COMMANDS.inquire({ advance: true });
    if (!r.paused) toAgent({ t: r.done ? 'inquiry_done' : 'inquiry_next', via: 'button', ...r });
    return r;
  },
  'POST /api/typing': async () => { lastActivity = Date.now(); return {}; },
  'POST /api/stroke': async b => {
    const now = Date.now(), offset = now - (b.sentAt ?? now);
    if (!S.cards[b.card] || !Array.isArray(b.pts) || b.pts.length < 2) throw new Error('圈画数据不完整');
    const pts = b.pts.map(([x, y]) => [clampPt(x), clampPt(y)]);
    const sameLength = a => (Array.isArray(a) && a.length === pts.length ? a : null);
    // Whoever was being discussed when the pen went down, whatever has moved on since. Only if it is on this plate.
    const owner = S.responses.find(r => r.id === (b.response !== undefined ? b.response : S.focus) && r.card === b.card) ?? null;
    const stroke = {
      id: `s${++seq.s}`, card: b.card, by: 'user', phase: S.phase, pts,
      ts: sameLength(b.ts)?.map(Math.round) ?? null, pressure: sameLength(b.pressure), pointer: b.pointer ?? null,
      startAt: (b.at ?? now - offset) + offset, endAt: (b.endAt ?? now - offset) + offset, view: b.view ?? null,
      geo: geometry(PLATES, b.card, [pts], S.cards[b.card].deg), response: owner?.id ?? null,
    };
    for (const old of S.removedStrokes) if (old.card === b.card) old.redoable = false;
    if (b.snapshot) {
      const f = join(P.snapshots, `${stroke.id}.jpg`);
      writeFileSync(f, Buffer.from(b.snapshot.split(',')[1], 'base64'));
      stroke.snapshot = f;
    }
    S.strokes.push(stroke);
    if (owner) (owner.strokes ||= []).push(stroke.id);
    lastActivity = Date.now();
    trace('stroke.added', { id: stroke.id, card: stroke.card, by: 'user', response: stroke.response });
    sync();
    toAgent({ t: 'stroke', id: stroke.id, card: stroke.card, response: stroke.response, geo: stroke.geo, snapshot: stroke.snapshot });
    push('stroke', { ...stroke, echo: true });
    return { id: stroke.id };
  },
  // Undo stays inside the response being discussed, so it can never erase an earlier answer's circle.
  'POST /api/stroke/undo': async b => {
    const s = [...S.strokes].reverse().find(x => x.by === 'user' && x.card === b.card && (x.response ?? null) === (S.focus ?? null));
    if (s) removeStroke(s, 'undo', true);
    sync();
    return { id: s?.id ?? null };
  },
  'POST /api/stroke/redo': async b => {
    const s = [...S.removedStrokes].reverse().find(x => x.redoable && x.card === b.card);
    if (s) {
      S.removedStrokes.splice(S.removedStrokes.indexOf(s), 1);
      delete s.removedAt; delete s.removedVia; delete s.redoable;
      S.strokes.push(s);
      if (s.response) { const r = S.responses.find(x => x.id === s.response); if (r) (r.strokes ||= []).push(s.id); }
      trace('stroke.restored', { id: s.id, card: s.card });
      toAgent({ t: 'stroke_restored', id: s.id, card: s.card, response: s.response });
    }
    sync();
    return { id: s?.id ?? null };
  },
  'POST /api/stroke/erase': async b => {
    const s = S.strokes.find(x => x.id === b.id && x.by === 'user');
    if (s) removeStroke(s, 'erase', true);
    sync();
    return { id: s?.id ?? null };
  },
  'POST /api/choice': async b => {
    if (S.paused) return { moved: false, reason: 'paused' };
    try { return choose(b.question || S.choiceAt, b.card, b.via || 'click'); }
    catch (e) { say(e.message, { flush: true }); return { error: e.message }; }
  },
  'POST /api/choice/skip': async b => skipChoice(b.question || S.choiceAt, 'button'),
  'POST /api/choice/revisit': async b => revisitChoice(b.question),
  'POST /api/feedback': async b => { S.feedback[b.key] = b.value; trace('feedback', { key: b.key, value: b.value }); save(); toAgent({ t: 'feedback', key: b.key, value: b.value }); return {}; },
  'POST /api/resume': async () => { COMMANDS.resume({ via: 'user' }); toAgent({ t: 'resumed_by_user' }); return {}; },
  'POST /api/delete': async () => {
    stopping = true;
    push('bye', { deleted: true });
    toAgent({ t: 'deleted_by_user' });
    try { bridge?.stop(); bridge?.kill(); } catch { /* exiting anyway */ }
    setTimeout(() => { rmSync(DIR, { recursive: true, force: true }); process.exit(0); }, 300);
    return { deleted: true };
  },
};

let baseUrl = '';
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = `${req.method} ${url.pathname}`;
  const authed = url.searchParams.get('k') === KEY || req.headers['x-ror-key'] === KEY;
  const origin = req.headers.origin;
  if (origin && origin !== baseUrl) { res.writeHead(403); return res.end(); }
  try {
    if (route === 'GET /') {
      if (!authed) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('这个链接需要完整的访问码。'); }
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      return res.end(readFileSync(join(APP, 'index.html'), 'utf8').replace('__KEY__', KEY));
    }
    if (route === 'GET /api/events') {
      if (!authed) { res.writeHead(403); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      clients.add(res);
      watchBrowser();
      req.on('close', () => { clients.delete(res); pageLeftAt = Date.now(); watchBrowser(); });
      return;
    }
    if (route === 'GET /api/state') { if (!authed) { res.writeHead(403); return res.end(); } return json(res, publicState()); }
    if (route === 'GET /api/protocol') { if (!authed) { res.writeHead(403); return res.end(); } return json(res, protocolNow()); }
    if (route === 'GET /report') {
      if (!authed || !existsSync(P.report)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      return res.end(readFileSync(P.report, 'utf8').replace('__RUNTIME__', JSON.stringify({ key: KEY, live: true })));
    }
    if (route === 'POST /api/stt') {
      if (!authed) { res.writeHead(403); return res.end(); }
      if (!hasWhisper()) return json(res, { error: 'no_whisper' }, 501);
      // The sentence belongs to where things stood when it ended, not to where they are once whisper finishes.
      const ctx = here(), firstTextAt = Date.now();
      const text = await transcribe(await body(req));
      if (text) onFinal(text, { source: 'whisper', ctx, firstTextAt });
      return json(res, { text });
    }
    if (API[route]) {
      if (!authed) { res.writeHead(403); return res.end(); }
      const raw = await body(req);
      return json(res, await API[route](raw.length ? JSON.parse(raw) : {}));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/app/')) {
      const f = normalize(join(APP, url.pathname.slice(5)));
      if (!f.startsWith(APP) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'public, max-age=300' });
      return createReadStream(f).pipe(res);
    }
    res.writeHead(404); res.end();
  } catch (e) {
    log('http error', route, e.stack);
    json(res, { error: e.message }, 500);
  }
});

// ---------- liveness: nobody should sit in front of a test that stopped listening ----------
let browserGone = null, toldGone = false, pageLeftAt = 0;
function watchBrowser() {
  clearTimeout(browserGone);
  if (clients.size) {
    if (toldGone) { toldGone = false; toAgent({ t: 'browser', status: 'open' }); }
    return;
  }
  browserGone = setTimeout(() => {
    if (clients.size || stopping) return;
    toldGone = true;
    toAgent({ t: 'browser', status: 'closed', url: `${baseUrl}/?k=${KEY}` });
  }, 30000);
}
// Unread events mean no `wait` is running. Scoring is the one stretch where the agent is meant to be away from them.
let unreadSince = null;
setInterval(() => {
  let unread = 0;
  try { unread = statSync(P.events).size - Number(readIf(P.cursor) || 0); } catch { /* nothing written yet */ }
  if (unread <= 0 || S.phase === 'scoring' || S.phase === 'threshold') {
    unreadSince = null;
    if (S.agentStalled) { S.agentStalled = false; trace('agent.resumed'); sync(); }
    return;
  }
  unreadSince ??= Date.now();
  // An agent that has stepped away will read nothing until the person goes back and tells it to, so say so at once.
  if (!S.agentStalled && Date.now() - unreadSince > (existsSync(P.away) ? 0 : STALL_MS)) { S.agentStalled = true; trace('agent.stalled'); sync(); }
}, 5000);

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  try { bridge?.stop(); bridge?.kill(); } catch { /* exiting anyway */ }
  trace('session.stop');
  try { writeProtocol(); } catch (e) { log('protocol write failed', e.message); }
  push('bye');
  writeJsonAtomic(P.meta, { ...readJson(P.meta), stoppedAt: Date.now() });
  setTimeout(() => process.exit(0), 150);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
setInterval(() => { if (Date.now() - lastActivity > 3 * 3600 * 1000 && !clients.size) shutdown(); }, 60000);

server.on('error', e => {
  // The old address is taken: a new one, and the open page will need the new link.
  if (e.code === 'EADDRINUSE' && PRIOR?.port && !OPT.port) { server.listen(0, '127.0.0.1'); return; }
  throw e;
});
server.listen(Number(OPT.port) || PRIOR?.port || 0, '127.0.0.1');
server.on('listening', () => {
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  resolveVoice();
  writeJsonAtomic(P.meta, { pid: process.pid, port, url: `${baseUrl}/?k=${KEY}`, startedAt: Date.now(), voice: S.voice.mode, available: S.voice.available });
});
