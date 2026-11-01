// Structural summary for coded responses. Deterministic: the agent codes, this file counts.
// Formulas follow the published Comprehensive System structural summary. No diagnostic constellations.

import { inkType } from './types.mjs';

export const Z_TABLE = {
  1: { ZW: 1.0, ZA: 4.0, ZD: 6.0, ZS: 3.5 },
  2: { ZW: 4.5, ZA: 3.0, ZD: 5.5, ZS: 4.5 },
  3: { ZW: 5.5, ZA: 3.0, ZD: 4.0, ZS: 4.5 },
  4: { ZW: 2.0, ZA: 4.0, ZD: 3.5, ZS: 5.0 },
  5: { ZW: 1.0, ZA: 2.5, ZD: 5.0, ZS: 4.0 },
  6: { ZW: 2.5, ZA: 2.5, ZD: 6.0, ZS: 6.5 },
  7: { ZW: 2.5, ZA: 1.0, ZD: 3.0, ZS: 4.0 },
  8: { ZW: 4.5, ZA: 3.0, ZD: 3.0, ZS: 4.0 },
  9: { ZW: 5.5, ZA: 2.5, ZD: 4.5, ZS: 5.0 },
  10: { ZW: 5.5, ZA: 4.0, ZD: 4.5, ZS: 6.0 },
};

const ZEST = [null, null, 2.5, 6, 10, 13.5, 17, 20.5, 24, 27.5, 31, 34.5, 38, 41.5, 45.5, 49, 52.5, 56, 59.5, 63, 66.5, 70, 73.5, 77, 81, 84.5, 88, 91.5, 95, 98.5, 102.5, 105.5, 109.5, 112.5, 116.5, 120, 123.5, 127, 130.5, 134, 137.5, 141, 144.5, 148, 152, 155.5, 159, 162.5, 166, 169.5, 173];
export const zest = zf => (zf < 2 ? null : ZEST[Math.min(zf, 50)]);

const WSUM6 = { DV: 1, INCOM: 2, DR: 3, FABCOM: 4, DV2: 2, INCOM2: 4, DR2: 6, FABCOM2: 7, ALOG: 5, CONTAM: 7 };
const LOC = new Set(['W', 'D', 'Dd']);
const DQ = new Set(['+', 'o', 'v/+', 'v']);
const FQ = new Set(['+', 'o', 'u', '-', 'none']);
const DET = /^(F|M[ap]|Mp|Ma|FM[ap]|m[ap]|Ma-p|Mp-a|FMa-p|ma-p|FC|CF|C|Cn|FC'|C'F|C'|FT|TF|T|FV|VF|V|FY|YF|Y|FD|Fr|rF)$/;
const SPECIAL = new Set(['DV', 'DV2', 'DR', 'DR2', 'INCOM', 'INCOM2', 'FABCOM', 'FABCOM2', 'CONTAM', 'ALOG', 'PSV', 'AB', 'AG', 'COP', 'CP', 'MOR', 'PER', 'GHR', 'PHR']);
const CONTENT = new Set(['H', '(H)', 'Hd', '(Hd)', 'Hx', 'A', '(A)', 'Ad', '(Ad)', 'An', 'Art', 'Ay', 'Bl', 'Bt', 'Cg', 'Cl', 'Ex', 'Fi', 'Fd', 'Ge', 'Hh', 'Ls', 'Na', 'Sc', 'Sx', 'Xy', 'Id']);
const CODE_FIELDS = new Set(['id', 'loc', 'space', 'dq', 'det', 'pair', 'fq', 'content', 'pop', 'z', 'special', 'evidence']);

export function validateCodes(codes, responses) {
  const errors = [];
  const ids = new Set(responses.map(r => r.id));
  const seen = new Set();
  for (const c of codes) {
    const at = `${c.id || '?'}`;
    if (!ids.has(c.id)) errors.push(`${at}: 找不到这条回应`);
    if (seen.has(c.id)) errors.push(`${at}: 编码了两次`);
    seen.add(c.id);
    for (const k of Object.keys(c)) if (!CODE_FIELDS.has(k)) errors.push(`${at}: 未知字段 ${k}`);
    for (const k of ['pop', 'pair', 'space']) if (c[k] !== undefined && typeof c[k] !== 'boolean') errors.push(`${at}: ${k} 必须是 true 或 false`);
    if (!LOC.has(c.loc)) errors.push(`${at}: loc 必须是 W/D/Dd`);
    if (!DQ.has(c.dq)) errors.push(`${at}: dq 必须是 + o v/+ v`);
    if (!FQ.has(c.fq)) errors.push(`${at}: fq 必须是 + o u - none`);
    if (!Array.isArray(c.det) || !c.det.length) errors.push(`${at}: det 不能为空`);
    else {
      for (const d of c.det) if (!DET.test(d)) errors.push(`${at}: 未知决定因子 ${d}`);
      if (c.det.length > 1 && c.det.includes('F')) errors.push(`${at}: F 表示只用了形状，不能和其他决定因子并列`);
    }
    if (!Array.isArray(c.content) || !c.content.length) errors.push(`${at}: content 不能为空`);
    else for (const d of c.content) if (!CONTENT.has(d)) errors.push(`${at}: 未知内容 ${d}`);
    for (const s of c.special || []) if (!SPECIAL.has(s)) errors.push(`${at}: 未知特殊分 ${s}`);
    if (c.z != null && !['ZW', 'ZA', 'ZD', 'ZS'].includes(c.z)) errors.push(`${at}: z 必须是 ZW/ZA/ZD/ZS 或 null`);
    if (!c.evidence || typeof c.evidence !== 'string') errors.push(`${at}: evidence 要写依据（引用用户原话）`);
  }
  for (const r of responses) if (!seen.has(r.id)) errors.push(`${r.id}: 这条回应还没编码`);
  return errors;
}

// Words in what was said that usually mean a determinant. A prompt to look again, never a verdict: 「白色这部分」 is a place, not a colour.
const CUES = [
  ['动作', /^(M|FM|m)/, /飞|爬|跑|跳|走|站|坐|躺|蹲|抬|拉|推|笑|哭|念|说话|聊|伸|举|弯|碰|抱|打|追|挂|飘|流|燃|烧|爆|落|跳舞|开会|看着|对着/],
  ['彩色', /^(FC|CF|C|Cn)$/, /红|绿|蓝|黄|橙|粉|紫|颜色|彩色/],
  ['无彩色', /^(FC'|C'F|C')$/, /黑|灰|白/],
  ['质感', /^(FT|TF|T)$/, /毛茸茸|毛毛|光滑|粗糙|柔软|摸/],
  ['纵深或浓淡', /^(FV|VF|V|FY|YF|Y|FD)$/, /很远|远处|距离|深浅|透明|透|纱|雾|朦胧|烟/],
  ['反射', /^(Fr|rF)$/, /倒影|镜子|水面/],
];
export function codeWarnings(codes, responses) {
  const out = [];
  for (const c of codes) {
    const r = responses.find(x => x.id === c.id);
    if (!r || !Array.isArray(c.det)) continue;
    const said = [r.verbatim, ...(r.inquiry || []).map(x => x.text)].join(' ');
    for (const [name, has, words] of CUES) {
      const hit = said.match(words);
      if (hit && !c.det.some(d => has.test(d))) out.push(`${c.id}：原话有「${hit[0]}」，编码里没有${name}`);
    }
  }
  return out;
}

const toD = x => {
  const s = Math.sign(x), a = Math.abs(x);
  if (a <= 2.5) return 0;
  return s * Math.min(5, Math.ceil((a - 2.5) / 2.5));
};
const ratio = (a, b) => (b ? +(a / b).toFixed(2) : null);

export function structuralSummary(codes, cardOf) {
  const summary = summarize(codes, cardOf);
  return { ...summary, inkType: inkType(summary, codes) };
}

function summarize(codes, cardOf) {
  const R = codes.length;
  const count = fn => codes.reduce((n, c) => n + (fn(c) ? 1 : 0), 0);
  const detCount = re => codes.reduce((n, c) => n + c.det.filter(d => re.test(d)).length, 0);
  const has = (c, x) => (c.special || []).includes(x);
  const con = x => codes.reduce((n, c) => n + (c.content.includes(x) ? 1 : 0), 0);

  const pureF = count(c => c.det.length === 1 && c.det[0] === 'F');
  const W = count(c => c.loc === 'W'), D = count(c => c.loc === 'D'), Dd = count(c => c.loc === 'Dd');
  const S = count(c => c.space);
  const fq = { '+': 0, o: 0, u: 0, '-': 0, none: 0 };
  for (const c of codes) fq[c.fq]++;
  const wd = codes.filter(c => c.loc !== 'Dd');
  const wda = wd.filter(c => ['+', 'o', 'u'].includes(c.fq)).length;

  const M = detCount(/^M/), FM = detCount(/^FM/), m = detCount(/^m/);
  const FC = detCount(/^FC$/), CF = detCount(/^CF$/), C = detCount(/^C$/);
  const WSumC = +(0.5 * FC + CF + 1.5 * C).toFixed(1);
  const Cp = detCount(/^(FC'|C'F|C')$/), T = detCount(/^(FT|TF|T)$/), V = detCount(/^(FV|VF|V)$/), Y = detCount(/^(FY|YF|Y)$/);
  const SumShading = Cp + T + V + Y;
  const EA = +(M + WSumC).toFixed(1);
  const es = FM + m + SumShading;
  const adjEs = es - Math.max(0, m - 1) - Math.max(0, Y - 1);
  const a = codes.reduce((n, c) => n + c.det.filter(d => /^(M|FM|m)a/.test(d) || /-a$/.test(d)).length, 0);
  const p = codes.reduce((n, c) => n + c.det.filter(d => /^(M|FM|m)p/.test(d) || /-p$/.test(d)).length, 0);
  const Ma = codes.reduce((n, c) => n + c.det.filter(d => /^Ma/.test(d)).length, 0);
  const Mp = codes.reduce((n, c) => n + c.det.filter(d => /^Mp/.test(d)).length, 0);

  const late = codes.filter(c => cardOf(c.id) >= 8).length;
  const early = R - late;
  const zScored = codes.filter(c => c.z);
  const Zf = zScored.length;
  const ZSum = +zScored.reduce((s, c) => s + Z_TABLE[cardOf(c.id)][c.z], 0).toFixed(1);
  const Zest = zest(Zf);
  const specials = {};
  for (const c of codes) for (const s of c.special || []) specials[s] = (specials[s] || 0) + 1;
  const WSum6 = Object.entries(WSUM6).reduce((sum, [k, w]) => sum + w * (specials[k] || 0), 0);
  const Sum6 = Object.keys(WSUM6).reduce((sum, k) => sum + (specials[k] || 0), 0);
  const reflections = detCount(/^(Fr|rF)$/);
  const pairs = count(c => c.pair);
  const H = con('H'), HOther = con('(H)') + con('Hd') + con('(Hd)');

  return {
    R,
    validity: { enough: R >= 14, lambda: ratio(pureF, R - pureF), pureF },
    processing: {
      W, D, Dd, S,
      Zf, ZSum, Zest, Zd: Zest == null ? null : +(ZSum - Zest).toFixed(1),
      dq: { '+': count(c => c.dq === '+'), o: count(c => c.dq === 'o'), 'v/+': count(c => c.dq === 'v/+'), v: count(c => c.dq === 'v') },
      PSV: specials.PSV || 0,
    },
    mediation: {
      fq,
      'X+%': ratio(fq['+'] + fq.o, R),
      'XA%': ratio(fq['+'] + fq.o + fq.u, R),
      'WDA%': ratio(wda, wd.length),
      'X-%': ratio(fq['-'], R),
      'Xu%': ratio(fq.u, R),
      'S-': count(c => c.space && c.fq === '-'),
      P: count(c => c.pop),
    },
    ideation: { M, 'M-': codes.filter(c => c.fq === '-' && c.det.some(d => /^M/.test(d))).length, 'a:p': [a, p], 'Ma:Mp': [Ma, Mp], WSum6, Sum6, specials, Intellect: 2 * (specials.AB || 0) + con('Art') + con('Ay') },
    affect: { EB: [M, WSumC], WSumC, 'FC:CF+C': [FC, CF + C], Afr: ratio(late, early), Cp, blends: count(c => c.det.length > 1) },
    control: { EA, es, D: toD(EA - es), adjEs, AdjD: toD(EA - adjEs), eb: [FM + m, SumShading], FM, m, T, V, Y },
    interpersonal: { COP: specials.COP || 0, AG: specials.AG || 0, Food: con('Fd'), T, H, 'H:other': [H, HOther], 'GHR:PHR': [specials.GHR || 0, specials.PHR || 0], PER: specials.PER || 0 },
    self: { reflections, pairs, MOR: specials.MOR || 0, An: con('An'), Xy: con('Xy'), FD: detCount(/^FD$/), V },
  };
}

// Tiers come from Mihura et al. 2013 (Psychological Bulletin 139:548): strongest support for cognitive
// and perceptual variables; weak for very rare scores and for the Egocentricity and Isolation indices.
// The report limits how confident a claim can be according to the domain it draws from.
export const DOMAIN_CAP = {
  processing: 'strong',
  mediation: 'strong',
  ideation: 'strong',
  affect: 'moderate',
  control: 'moderate',
  interpersonal: 'tentative',
  self: 'tentative',
};
const RANK = { tentative: 1, moderate: 2, strong: 3 };
export const capAllows = (domain, level) => RANK[level] <= RANK[DOMAIN_CAP[domain] || 'tentative'];
