// The record of one session. trace.jsonl is the lossless event log; protocol.json is derived from it,
// deterministically, as a hierarchy: session > card > exposure > gesture > sample, and card > response > utterance | stroke.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geometry, normDeg } from './geometry.mjs';
import { checkSchema } from './schema.mjs';
import { paths, readJson } from './session.mjs';
import { structuralSummary } from './scoring.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
export const SCHEMA_ID = 'rorschach-protocol/1.0';
export const VERSION = '1.0.0';
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const CHROMATIC = new Set([2, 3, 8, 9, 10]);
const CARETS = ['∧', '>', '∨', '<'];
const quadrant = deg => (Math.round(normDeg(deg) / 90) % 4) * 90;
export const caret = deg => CARETS[quadrant(deg) / 90];

export const CONVENTIONS = {
  time: 'Integer milliseconds since session.createdAt on the server clock. Browser events are re-anchored to it per batch.',
  coordinates: 'Plate frame: (0,0) is the top-left and (1,1) the bottom-right of the upright plate, whatever the rotation or zoom. Stroke points are clamped to -0.05..1.05.',
  angle: 'Degrees clockwise; 0 is upright.',
  notation: 'Caret points at the top edge of the plate: ∧ upright, > top to the right, ∨ upside down, < top to the left. Free angles report the nearest quadrant.',
  zoom: 'z = 1 means the plate fits the free viewport at its current angle. w is the plate width in CSS pixels.',
  view: 'cx,cy is the centre of the free viewport in the plate frame. visible is the fraction of the plate inside the window. This records what was on screen, not where the eyes were.',
  rt: 'rtMs runs from the plate being painted and settled to the first speech. rtBasis says how onset was measured: vad (microphone level), typing (first key), transcript (first transcribed text, slowest).',
  interpretation: 'Rotation is part of location notation. Zoom and pan have no norms: describe them, never score or interpret them.',
};

const sha = b => createHash('sha256').update(b).digest('hex');
let stimulusMemo = null;
export function stimulusInfo() {
  stimulusMemo ||= Array.from({ length: 10 }, (_, i) => {
    const n = i + 1, file = `plates/${String(n).padStart(2, '0')}.jpg`, f = join(APP, file);
    return { card: n, roman: ROMAN[n], chromatic: CHROMATIC.has(n), file, sha256: existsSync(f) ? sha(readFileSync(f)) : null };
  });
  return stimulusMemo;
}

export function buildProtocol({ state: S, trace, codes = null, narrative = null, plates, stimulus = stimulusInfo(), generatedAt = Date.now(), traceSha = null, withTrace = false }) {
  const events = [...trace].sort((a, b) => a.t - b.t || a.seq - b.seq);
  const T = at => (at == null ? null : Math.max(0, Math.round(at - S.createdAt)));
  const of = type => events.filter(e => e.type === type);
  const durationMs = events.reduce((m, e) => Math.max(m, e.t, e.endMs ?? 0), 0);

  // ---------- phases ----------
  const phases = [{ name: 'threshold', startMs: 0, endMs: durationMs }];
  for (const e of of('phase')) { phases[phases.length - 1].endMs = e.t; phases.push({ name: e.to, startMs: e.t, endMs: durationMs }); }
  const phaseAt = t => [...phases].reverse().find(p => p.startMs <= t)?.name ?? 'threshold';

  // ---------- hidden time ----------
  const hidden = [];
  let hiddenSince = null;
  for (const e of of('client.visibility')) {
    if (e.visible === false && hiddenSince == null) hiddenSince = e.t;
    if (e.visible === true && hiddenSince != null) { hidden.push([hiddenSince, e.t]); hiddenSince = null; }
  }
  if (hiddenSince != null) hidden.push([hiddenSince, durationMs]);
  const hiddenIn = (a, b) => hidden.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);

  // ---------- exposures and the gestures inside them ----------
  const exposures = [];
  let open = null;
  const close = t => { if (open) { open.endMs = Math.max(open.startMs, t); open = null; } };
  for (const e of events) {
    if (e.type === 'exposure.start') {
      close(e.t);
      open = { card: e.card ?? null, phase: e.phase ?? phaseAt(e.t), response: e.response ?? null, startMs: e.t, endMs: e.t, start: e.state ?? null, gestures: [] };
      exposures.push(open);
    } else if (e.type === 'exposure.end' && open && (e.card ?? null) === open.card) close(e.t);
  }
  close(durationMs);
  const gesture = e => ({ op: e.op, via: e.via, startMs: e.t, endMs: e.endMs ?? e.t, from: e.from, to: e.to, samples: e.samples || [] });
  const looseGestures = [];
  for (const e of of('gesture')) {
    const mine = exposures.filter(x => x.card === (e.card ?? null));
    // Inside an exposure if it can be; a move just before one (the plate turning back for inquiry) belongs to what comes next.
    const home = mine.find(x => x.startMs <= e.t && e.t <= x.endMs) || mine.find(x => x.startMs > e.t) || mine[mine.length - 1];
    (home ? home.gestures : looseGestures).push(gesture(e));
  }
  const turned = g => g.from?.deg != null && g.to?.deg != null && g.from.deg !== g.to.deg;
  const viewSummary = x => {
    const line = [[x.startMs, x.start?.z ?? null]];
    let zoomMax = x.start?.z ?? null, visibleMin = x.start?.visible ?? null;
    for (const g of x.gestures) {
      for (const s of g.samples) line.push([g.startMs + s[0], s[1]]);
      line.push([g.endMs, g.to?.z ?? null]);
      if (g.to?.z != null) zoomMax = Math.max(zoomMax ?? 0, g.to.z);
      if (g.to?.visible != null) visibleMin = Math.min(visibleMin ?? 1, g.to.visible);
      for (const s of g.samples) zoomMax = Math.max(zoomMax ?? 0, s[1] ?? 0);
    }
    line.push([x.endMs, null]);
    let zoomedMs = 0;
    for (let i = 0; i + 1 < line.length; i++) if (line[i][1] > 1.05) zoomedMs += Math.max(0, line[i + 1][0] - line[i][0]);
    return { gestures: x.gestures.length, rotations: x.gestures.filter(turned).length, zoomMax: zoomMax == null ? null : +zoomMax.toFixed(2), zoomedMs: Math.round(zoomedMs), visibleMin };
  };
  const outExposure = x => ({ phase: x.phase, response: x.response, startMs: x.startMs, endMs: x.endMs, hiddenMs: hiddenIn(x.startMs, x.endMs), start: x.start, summary: viewSummary(x), gestures: x.gestures });
  const stateAt = (card, t) => {
    const mine = exposures.filter(x => x.card === card && x.startMs <= t);
    const x = mine[mine.length - 1];
    if (!x) return null;
    const last = [...x.gestures].reverse().find(g => g.endMs <= t);
    return last?.to ?? x.start;
  };

  // ---------- utterances ----------
  const onsets = of('speech.onset').map(e => e.t);
  const ordered = [...S.phrases].sort((a, b) => a.at - b.at);
  const utterances = {};
  ordered.forEach((p, i) => {
    const firstTextMs = T(p.firstTextAt ?? p.at), endMs = T(p.at);
    const after = i ? T(ordered[i - 1].at) : 0;
    let onsetMs = firstTextMs, onsetBasis = 'transcript';
    if (p.typedAt != null) { onsetMs = Math.min(T(p.typedAt), firstTextMs); onsetBasis = 'typing'; }
    else {
      const hits = onsets.filter(t => t >= after && t <= firstTextMs);
      // Streaming speech reaches us just after it starts; whisper text arrives after the whole utterance.
      if (hits.length) { onsetMs = p.source === 'whisper' ? hits[0] : hits[hits.length - 1]; onsetBasis = 'vad'; }
    }
    utterances[p.id] = { id: p.id, phase: p.phase, text: p.text, source: p.source || 'external', onsetMs, onsetBasis, firstTextMs, endMs, deg: normDeg(p.deg || 0), command: !!p.command, safety: !!p.safety };
  });

  // ---------- strokes ----------
  const outStroke = s => ({
    id: s.id, by: s.by, phase: s.phase ?? null, response: s.response ?? null,
    startMs: T(s.startAt), endMs: T(s.endAt), pointer: s.pointer ?? null,
    points: s.pts, pointTimes: s.ts ?? null, pressure: s.pressure ?? null,
    view: s.view ?? null, geometry: s.geo ?? null, label: s.label ?? null, snapshot: s.snapshot ? `snapshots/${s.id}.jpg` : null,
    removedMs: s.removedAt != null ? T(s.removedAt) : null, removedVia: s.removedVia ?? null,
  });

  // ---------- responses ----------
  const byCode = Object.fromEntries((codes || []).map(c => [c.id, c]));
  const inquiryStarts = of('inquiry.start');
  const usedPhrases = new Set(), usedStrokes = new Set();
  const outResponse = (r, ordinal) => {
    const own = (r.phrases || []).map(id => utterances[id]).filter(Boolean);
    own.forEach(u => usedPhrases.add(u.id));
    const asked = inquiryStarts.filter(e => e.response === r.id);
    const inq = S.phrases.filter(p => p.phase === 'inquiry' && p.response === r.id).map(p => utterances[p.id]).filter(Boolean);
    inq.forEach(u => usedPhrases.add(u.id));
    let inquiry = null;
    if (asked.length || inq.length) {
      const askedMs = asked[0]?.t ?? inq[0].firstTextMs;
      const following = [...inquiryStarts, ...of('phase')].filter(e => e.t > (asked[asked.length - 1]?.t ?? askedMs)).map(e => e.t);
      inquiry = { askedMs, endMs: following.length ? Math.min(...following) : durationMs, prompt: asked[asked.length - 1]?.prompt ?? null, verbatim: inq.filter(u => !u.command).map(u => u.text).join(' '), utterances: inq };
    }
    const live = S.strokes.filter(s => s.response === r.id && s.card === r.card);
    live.forEach(s => usedStrokes.add(s.id));
    const userShapes = live.filter(s => s.by === 'user').map(s => s.pts);
    const onset = own[0]?.onsetMs ?? null;
    const deg = normDeg(r.deg ?? own[0]?.deg ?? 0);
    return {
      id: r.id, ordinal, label: r.label, tidy: r.tidy ?? null,
      orientation: { deg, notation: caret(deg) },
      freeAssociation: { startMs: onset, endMs: own.length ? own[own.length - 1].endMs : null, verbatim: r.verbatim, utterances: own },
      viewAtOnset: onset == null ? null : stateAt(r.card, onset),
      inquiry,
      location: { geometry: userShapes.length && plates ? geometry(plates, r.card, userShapes, deg) : null, strokes: live.map(outStroke) },
      code: byCode[r.id] ? { space: false, pair: false, pop: false, z: null, special: [], ...byCode[r.id] } : null,
    };
  };

  // ---------- cards ----------
  const lines = of('say.start').map(e => ({ id: e.id, startMs: e.t, text: e.text, endMs: events.find(x => x.type === 'say.end' && x.id === e.id)?.t ?? null }));
  const cards = Array.from({ length: 10 }, (_, i) => {
    const n = i + 1, st = S.cards[n] || {};
    const shown = of('card.shown').find(e => e.card === n);
    const mine = exposures.filter(x => x.card === n);
    const inResponse = mine.filter(x => x.phase === 'response');
    const ended = of('card.end').find(e => e.card === n);
    const painted = inResponse[0]?.startMs ?? null;
    const onsetMs = painted ?? shown?.t ?? null;
    const spoken = ordered.filter(p => p.card === n && p.phase === 'response' && !p.command && !p.safety).map(p => utterances[p.id]);
    const first = spoken[0] ?? null;
    const endMs = ended?.t ?? null;
    const prompt = shown ? lines.filter(l => l.startMs >= shown.t && l.startMs <= (first?.onsetMs ?? endMs ?? Infinity)).pop() : null;
    const responses = S.responses.filter(r => r.card === n).map((r, k) => outResponse(r, k + 1));
    const orphanWords = ordered.filter(p => p.card === n && !usedPhrases.has(p.id) && ['response', 'inquiry'].includes(p.phase)).map(p => { usedPhrases.add(p.id); return utterances[p.id]; });
    const orphanStrokes = S.strokes.filter(s => s.card === n && !usedStrokes.has(s.id)).map(s => { usedStrokes.add(s.id); return outStroke(s); });

    const allG = mine.flatMap(x => x.gestures).sort((a, b) => a.startMs - b.startMs);
    const dwellMs = { 0: 0, 90: 0, 180: 0, 270: 0 };
    for (const x of inResponse) {
      let cur = x.start?.deg ?? 0, at = x.startMs;
      for (const g of x.gestures.filter(turned)) { const until = Math.min(x.endMs, Math.max(at, g.endMs)); dwellMs[quadrant(cur)] += until - at; cur = g.to.deg; at = until; }
      dwellMs[quadrant(cur)] += Math.max(0, x.endMs - at);
    }
    const sums = inResponse.map(viewSummary);
    return {
      card: n, roman: ROMAN[n], chromatic: CHROMATIC.has(n),
      timing: {
        shownMs: shown?.t ?? null, onsetMs, onsetBasis: painted != null ? 'painted' : shown ? 'server' : null,
        promptEndMs: prompt?.endMs ?? null,
        rtMs: first && onsetMs != null ? Math.max(0, first.onsetMs - onsetMs) : null, rtBasis: first?.onsetBasis ?? null,
        endMs, durationMs: endMs != null && onsetMs != null ? Math.max(0, endMs - onsetMs) : null,
        hiddenMs: inResponse.reduce((s, x) => s + hiddenIn(x.startMs, x.endMs), 0), voiceGapMs: S.cards?.[n]?.voiceGapMs ?? 0, endedBy: ended?.via ?? null,
      },
      pacing: of('pacing').filter(e => e.card === n).map(e => ({ tMs: e.t, kind: e.kind, ...(e.response ? { response: e.response } : {}) })),
      orientation: { final: normDeg(st.deg || 0), changes: allG.filter(turned).map(g => ({ tMs: g.endMs, deg: g.to.deg, notation: caret(g.to.deg), via: g.via, phase: phaseAt(g.endMs) })), dwellMs },
      view: {
        gestures: sums.reduce((s, x) => s + x.gestures, 0), rotations: sums.reduce((s, x) => s + x.rotations, 0),
        zoomMax: sums.reduce((m, x) => (x.zoomMax == null ? m : Math.max(m ?? 0, x.zoomMax)), null),
        zoomedMs: sums.reduce((s, x) => s + x.zoomedMs, 0),
        visibleMin: sums.reduce((m, x) => (x.visibleMin == null ? m : Math.min(m ?? 1, x.visibleMin)), null),
      },
      exposures: mine.map(outExposure),
      responses,
      unassigned: { utterances: orphanWords, strokes: orphanStrokes },
      removedStrokes: (S.removedStrokes || []).filter(s => s.card === n).map(outStroke),
    };
  });

  // ---------- the four questions ----------
  const answers = ['liked', 'disliked', 'father', 'mother'].map(k => {
    const a = S.choices?.[k] || {};
    const own = ordered.filter(p => p.question === k && p.phase === 'choices').map(p => utterances[p.id]);
    own.forEach(u => usedPhrases.add(u.id));
    return {
      question: k, card: a.card ?? null, skipped: !!a.skipped, via: a.via ?? null,
      askedMs: T(a.askedAt), chosenMs: T(a.chosenAt), endMs: T(a.endedAt),
      why: { verbatim: own.filter(u => !u.command).map(u => u.text).join(' '), utterances: own },
      history: of('choice.card').filter(e => e.question === k).map(e => ({ tMs: e.t, card: e.card, via: e.via ?? null })),
      prompts: of('pacing').filter(e => e.question === k).map(e => ({ tMs: e.t, kind: e.kind })),
    };
  });

  const other = ordered.filter(p => !usedPhrases.has(p.id)).map(p => utterances[p.id]);
  const seenCodes = codes?.length ? (() => { try { return structuralSummary(codes, id => S.responses.find(r => r.id === id).card); } catch { return null; } })() : null;
  const client = of('client.info').pop();

  const out = {
    schema: SCHEMA_ID,
    conventions: CONVENTIONS,
    session: {
      id: S.id, createdAt: new Date(S.createdAt).toISOString(), generatedAt: new Date(generatedAt).toISOString(), durationMs,
      status: S.reportReady ? 'completed' : 'incomplete', phaseReached: S.phase, language: 'zh-CN',
      software: { name: 'rorschach', version: VERSION },
    },
    participant: { name: S.name ?? null, age: S.person?.age ?? null, education: S.person?.education ?? null, occupation: S.person?.occupation ?? null, question: S.question ?? null },
    stimulus: { set: 'Rorschach 1921, public-domain scans', widthPx: 2400, heightPx: 1666, plates: stimulus },
    administration: {
      voice: { mode: S.voice?.mode ?? 'text', name: S.voice?.name ?? null, changes: of('voice').map(e => ({ tMs: e.t, status: e.status ?? null, mode: e.mode ?? null, reason: e.reason ?? null })) },
      client: client ? { viewport: client.viewport, dpr: client.dpr, pointer: client.pointer, touch: client.touch, userAgent: client.userAgent } : null,
      resizes: of('client.resize').map(e => ({ tMs: e.t, viewport: e.viewport })),
      fullscreen: of('client.fullscreen').map(e => ({ tMs: e.t, on: !!e.on })),
      mic: of('mic.mute').map(e => ({ tMs: e.t, muted: !!e.muted })),
      tools: of('tool').map(e => ({ tMs: e.t, tool: e.tool })),
      echoDropped: of('utterance.echo_dropped').map(e => ({ tMs: e.t, text: e.text })),
    },
    phases,
    cards,
    other: { utterances: other, gestures: looseGestures },
    choices: {
      answers,
      moves: of('drag.card').map(e => ({ card: e.card, startMs: e.t, endMs: e.endMs ?? e.t, question: e.question ?? null })),
      exposures: exposures.filter(x => x.card == null).map(outExposure),
    },
    transcript: [
      ...lines.map(l => ({ tMs: l.startMs, endMs: l.endMs, who: 'examiner', text: l.text, utterance: null })),
      ...Object.values(utterances).filter(u => !u.command).map(u => ({ tMs: u.onsetMs, endMs: u.endMs, who: 'participant', text: u.text, utterance: u.id })),
    ].sort((a, b) => a.tMs - b.tMs),
    safety: [...of('safety.pause').map(e => ({ tMs: e.t, kind: 'paused', via: e.via ?? null })), ...of('safety.resume').map(e => ({ tMs: e.t, kind: 'resumed', via: e.via ?? null }))].sort((a, b) => a.tMs - b.tMs),
    scoring: { coded: !!codes?.length, summary: seenCodes },
    narrative: narrative ?? null,
    feedback: S.feedback ?? {},
    integrity: { traceEvents: trace.length, traceSha256: traceSha, utterances: S.phrases.length, responses: S.responses.length, strokes: S.strokes.length, removedStrokes: (S.removedStrokes || []).length },
  };
  if (withTrace) out.trace = events;
  return out;
}

// ---------- validity ----------
export function validateProtocol(p, schema = readJson(join(HERE, '..', '..', 'schema', 'protocol.schema.json'))) {
  const E = checkSchema(schema, p);
  if (E.length) return E;
  const D = p.session.durationMs;
  const inSpan = (t, at) => { if (t != null && (t < 0 || t > D)) E.push(`${at}: ${t} 超出会话时长 ${D}`); };
  const span = (a, b, at) => { inSpan(a, at); inSpan(b, at); if (a != null && b != null && a > b) E.push(`${at}: 开始 ${a} 晚于结束 ${b}`); };
  const ids = new Set(), once = (id, at) => { if (ids.has(id)) E.push(`${at}: id ${id} 重复`); ids.add(id); };
  const words = new Set();
  const utter = (u, at) => { words.add(u.id); span(u.onsetMs, u.endMs, at); if (u.onsetMs > u.firstTextMs) E.push(`${at}: 开口晚于首个文字`); if (u.firstTextMs > u.endMs) E.push(`${at}: 首个文字晚于结束`); };
  const strokeSeen = new Set();
  const stroke = (s, at, card) => {
    if (strokeSeen.has(s.id)) E.push(`${at}: 圈画 ${s.id} 出现两次`);
    strokeSeen.add(s.id);
    span(s.startMs, s.endMs, at);
    if (s.points.some(q => q[0] < -.05 || q[0] > 1.05 || q[1] < -.05 || q[1] > 1.05)) E.push(`${at}: 坐标超出图版`);
    if (s.pointTimes) {
      if (s.pointTimes.length !== s.points.length) E.push(`${at}: pointTimes 与 points 长度不同`);
      if (s.pointTimes.some((t, i) => i && t < s.pointTimes[i - 1])) E.push(`${at}: pointTimes 不单调`);
    }
    if (s.pressure && s.pressure.length !== s.points.length) E.push(`${at}: pressure 与 points 长度不同`);
    if (s.geometry && s.by === 'user' && card == null) E.push(`${at}: 圈画没有归属图版`);
  };
  const exposure = (x, at) => {
    span(x.startMs, x.endMs, at);
    if (x.hiddenMs > x.endMs - x.startMs) E.push(`${at}: 隐藏时间超过呈现时间`);
    x.gestures.forEach((g, k) => {
      const gat = `${at}.gestures[${k}]`;
      span(g.startMs, g.endMs, gat);
      if (g.samples.some((s, i) => s[0] < 0 || (i && s[0] < g.samples[i - 1][0]))) E.push(`${gat}: samples 时间不单调`);
    });
  };
  p.phases.forEach((f, i) => { span(f.startMs, f.endMs, `phases[${i}]`); if (i && f.startMs < p.phases[i - 1].startMs) E.push(`phases[${i}]: 阶段顺序倒退`); });
  if (p.cards.length !== 10 || p.cards.some((c, i) => c.card !== i + 1)) E.push('cards 必须是按顺序的 10 张');
  for (const c of p.cards) {
    const at = `cards[${c.card - 1}]`, t = c.timing;
    span(t.onsetMs, t.endMs, `${at}.timing`);
    inSpan(t.promptEndMs, `${at}.timing.promptEndMs`);
    if (t.rtMs != null && (t.rtMs < 0 || t.rtMs > D)) E.push(`${at}.timing.rtMs: ${t.rtMs} 不合理`);
    if ((t.rtMs == null) !== (t.rtBasis == null)) E.push(`${at}.timing: rtMs 和 rtBasis 必须同时有或同时无`);
    c.exposures.forEach((x, k) => exposure(x, `${at}.exposures[${k}]`));
    for (let k = 1; k < c.exposures.length; k++) if (c.exposures[k].startMs < c.exposures[k - 1].endMs) E.push(`${at}.exposures[${k}]: 与上一次呈现重叠`);
    const inResponse = c.exposures.filter(x => x.phase === 'response').reduce((s, x) => s + x.endMs - x.startMs, 0);
    const dwell = Object.values(c.orientation.dwellMs).reduce((a, b) => a + b, 0);
    if (Math.abs(dwell - inResponse) > 1) E.push(`${at}.orientation.dwellMs: 合计 ${dwell} 与呈现时长 ${inResponse} 不符`);
    c.responses.forEach((r, k) => {
      const rat = `${at}.responses[${k}]`;
      once(r.id, rat);
      if (r.ordinal !== k + 1) E.push(`${rat}: ordinal 应为 ${k + 1}`);
      if (r.code && r.code.id !== r.id) E.push(`${rat}: code.id ${r.code.id} 对不上`);
      if (r.freeAssociation.utterances.length) {
        span(r.freeAssociation.startMs, r.freeAssociation.endMs, `${rat}.freeAssociation`);
        if (r.freeAssociation.verbatim !== r.freeAssociation.utterances.map(u => u.text).join(' ')) E.push(`${rat}.freeAssociation.verbatim: 与它的话语不一致`);
      }
      r.freeAssociation.utterances.forEach((u, i) => utter(u, `${rat}.freeAssociation.utterances[${i}]`));
      if (r.inquiry) { span(r.inquiry.askedMs, r.inquiry.endMs, `${rat}.inquiry`); r.inquiry.utterances.forEach((u, i) => utter(u, `${rat}.inquiry.utterances[${i}]`)); }
      r.location.strokes.forEach((s, i) => { stroke(s, `${rat}.location.strokes[${i}]`, c.card); if (s.response !== r.id) E.push(`${rat}: 圈画 ${s.id} 归属不一致`); });
    });
    c.unassigned.utterances.forEach((u, i) => utter(u, `${at}.unassigned.utterances[${i}]`));
    c.unassigned.strokes.forEach((s, i) => { stroke(s, `${at}.unassigned.strokes[${i}]`, c.card); if (s.response != null) E.push(`${at}.unassigned.strokes[${i}]: 归属的回应 ${s.response} 不在这张图上`); });
    c.removedStrokes.forEach((s, i) => { stroke(s, `${at}.removedStrokes[${i}]`, c.card); if (s.removedMs == null) E.push(`${at}.removedStrokes[${i}]: 缺少 removedMs`); });
  }
  p.other.utterances.forEach((u, i) => utter(u, `other.utterances[${i}]`));
  p.choices.exposures.forEach((x, k) => exposure(x, `choices.exposures[${k}]`));
  p.choices.answers.forEach((a, k) => {
    const at = `choices.answers[${k}]`;
    if (a.question !== ['liked', 'disliked', 'father', 'mother'][k]) E.push(`${at}: 题目顺序不对`);
    if (a.skipped && a.card != null) E.push(`${at}: 跳过了却有图版`);
    inSpan(a.askedMs, `${at}.askedMs`); inSpan(a.chosenMs, `${at}.chosenMs`); inSpan(a.endMs, `${at}.endMs`);
    if (a.why.verbatim !== a.why.utterances.filter(u => !u.command).map(u => u.text).join(' ')) E.push(`${at}.why.verbatim: 与它的话语不一致`);
    a.why.utterances.forEach((u, i) => utter(u, `${at}.why.utterances[${i}]`));
  });
  const [liked, disliked] = p.choices.answers;
  if (liked.card != null && liked.card === disliked.card) E.push('choices: 同一张不能既最喜欢又最不喜欢');
  const I = p.integrity;
  if (words.size !== I.utterances) E.push(`integrity: 话语 ${words.size} 条，应为 ${I.utterances}`);
  if (p.cards.reduce((s, c) => s + c.responses.length, 0) !== I.responses) E.push('integrity: 回应数量对不上');
  const liveStrokes = p.cards.reduce((s, c) => s + c.responses.reduce((a, r) => a + r.location.strokes.length, 0) + c.unassigned.strokes.length, 0);
  if (liveStrokes !== I.strokes) E.push(`integrity: 圈画 ${liveStrokes} 条，应为 ${I.strokes}`);
  if (p.session.status === 'completed') {
    if (!p.narrative) E.push('已完成的会话必须有 narrative');
    if (!p.scoring.coded) E.push('已完成的会话必须已编码');
    p.cards.forEach(c => c.responses.forEach(r => { if (!r.code) E.push(`回应 ${r.id} 没有编码`); }));
  }
  return E;
}

// ---------- loading from a session directory ----------
export const readTrace = file => {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
};
export function loadProtocol(dir, opts = {}) {
  const P = paths(dir);
  const state = readJson(P.state);
  if (!state) throw new Error(`${dir} 里没有会话记录`);
  const raw = existsSync(P.trace) ? readFileSync(P.trace) : Buffer.alloc(0);
  return buildProtocol({ state, trace: readTrace(P.trace), codes: readJson(P.codes), narrative: readJson(P.narrative), plates: readJson(join(APP, 'plates', 'plates.json')), traceSha: sha(raw), ...opts });
}

// The numbers the report prints come from the protocol, so there is only one measured value of each.
export function derivedState(S, p) {
  const rec = n => p.cards[n - 1];
  return {
    ...S,
    cards: Object.fromEntries(Object.keys(S.cards).map(k => [k, { ...S.cards[k], rtMs: rec(k).timing.rtMs, totalMs: rec(k).timing.durationMs, rotationCount: rec(k).orientation.changes.filter(x => x.phase === 'response').length }])),
    responses: S.responses.map(r => ({ ...r, notation: caret(r.deg || 0) })),
  };
}

// Agents read slices: samples and raw points are heavy and rarely needed mid-session.
export function compact(p) {
  const strip = o => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).filter(([k]) => !['samples', 'points', 'pointTimes', 'pressure', 'conventions'].includes(k)).map(([k, v]) => [k, strip(v)]));
    return o;
  };
  return strip(p);
}
