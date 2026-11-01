// 墨型: a made-up, sixteen-way way to remember how someone looked at the plates this time.
// Most letters borrow a Rorschach code and can be checked against the record. B is ours, and P here means
// no unusual form, not Popular. The names and cut lines are ours and have not been validated. The report says so wherever the type appears.

export const INK_TYPES = {
  WMFP: { name: '观星人', line: '从一整片天里连出星座', gift: '你能把散开的东西连成一张大家都看得懂的图。', shade: '图一旦连好，就不太容易看见它没画进去的那颗星。', heard: '别人常以为你太理性。你只是习惯先把星星连起来，才敢说那片天有多美。', with: '给你一点时间画完那张图，再问你看见了什么。' },
  WMFU: { name: '造字人', line: '用很少的笔画，造一个只属于你的字', gift: '你能用很简单的线条，说出别人没想过的意思。', shade: '别人读不懂时，你可能懒得解释，就把这个字收回去了。', heard: '别人常以为你不好接近。你只是还没找到会读你这个字的人。', with: '听不懂就直接问，你比看起来更愿意解释。' },
  WMBP: { name: '说书人', line: '十张图，被你讲成了一个故事', gift: '你会给看到的东西配上人物和情节，别人很容易听进去。', shade: '故事太顺的时候，那些不合情节的细节可能被你略过去了。', heard: '别人常以为你什么都聊得开。你讲了那么多故事，最想讲的那个还留着。', with: '听完你的故事，多问一句「那你呢」。' },
  WMBU: { name: '造梦人', line: '别人看见一团墨，你看见一个世界', gift: '你的想象又大又有层次，能把不存在的东西讲得像真的。', shade: '留在那个世界里太舒服，回到眼前这件小事会有点费劲。', heard: '别人常以为你不够现实。你只是比他们多看见了一层。', with: '先陪你把梦说完，再一起看它怎么落地。' },
  WCFP: { name: '领航人', line: '一眼看全局，顺手指个方向', gift: '你很快抓住全貌，也留意周围的气氛，说出来的话大家跟得上。', shade: '走得快，容易替所有人先定了方向，忘了问一句他们想去哪。', heard: '别人常以为你从来不慌。你只是慌的时候也在看路。', with: '偶尔替你看一会儿路，让你也能坐下来。' },
  WCFU: { name: '开路人', line: '走别人没走过的路，只带必要的东西', gift: '你敢用自己的角度看整件事，而且说得干脆。', shade: '路是自己开的，累了也容易不好意思喊人来帮忙。', heard: '别人常以为你不需要同伴。你只是习惯走在前面，再回头等人。', with: '不用一直跟着你走，在路口等你就好。' },
  WCBP: { name: '掌灯人', line: '走进一个房间，把气氛点亮', gift: '你感受得到整个场面的冷暖，也能让别人跟着暖起来。', shade: '照顾整个房间的时候，最容易被落下的是你自己。', heard: '别人常以为你永远有光。点灯的人，也有想坐在暗处歇一会儿的时候。', with: '散场以后，问问你今天累不累。' },
  WCBU: { name: '泼墨人', line: '一笔下去，满纸都是颜色', gift: '你的感受又大又直接，那种浓烈在你这儿是常态。', shade: '颜色一下子铺满的时候，你可能来不及分辨哪一笔是你想要的。', heard: '别人常以为你太用力。你只是没办法只感受一半。', with: '你情绪来的时候别急着讲道理，等墨干一会儿。' },
  DMFP: { name: '修书人', line: '一页一页，把细处修得妥帖', gift: '你看得细，想得稳，交到你手里的东西很少出错。', shade: '一直在修这一页，可能忘了抬头看这本书要讲什么。', heard: '别人常以为你太较真。你只是舍不得让一个好东西坏在小地方。', with: '夸你的时候说具体一点，你听得进去的都是细节。' },
  DMFU: { name: '篆刻人', line: '方寸之间，刻出别人想不到的线', gift: '你在很小的地方下功夫，刻出来的东西有你自己的脾气。', shade: '刀下得太准，也容易对自己下得太重。', heard: '别人常以为你太固执。你只是知道那一刀应该落在哪。', with: '别急着劝你改，先看看你为什么这样刻。' },
  DMBP: { name: '听雨人', line: '一滴一滴，听见别人漏掉的声音', gift: '你会停在细微处，从一点小动静里想到很多，这些想法也说得通。', shade: '听得太细的时候，一点小动静也能在心里响很久。', heard: '别人常以为你想太多。你只是听见了他们没听见的那一声。', with: '你说「没事」的时候，再多问一句。' },
  DMBU: { name: '织雾人', line: '用细到看不见的线，织出一片雾', gift: '你把细小的东西层层叠起来，织出一种只有你能进去的气氛。', shade: '雾织得太好，别人想靠近你的时候可能找不到路。', heard: '别人常以为你难懂。你只是还在等一个愿意走进雾里的人。', with: '别急着问清楚，多待一会儿，雾会自己散。' },
  DCFP: { name: '种花人', line: '照顾手边这一小块地', gift: '你留意眼前具体的人和事，给的反应实在，让人安心。', shade: '手边的事总也做不完，更远的地方就一直排在后面。', heard: '别人常以为你容易满足。你只是知道一朵花要养多久。', with: '记得你说过的那件小事，比送什么都管用。' },
  DCFU: { name: '拾贝人', line: '在沙滩上捡到别人踩过去的东西', gift: '你总能在不起眼的角落发现点什么，而且说得很直接。', shade: '捡到的东西太多太散，要留点时间问问哪几个是你真想留的。', heard: '别人常以为你总在走神。你只是看见了脚边的东西。', with: '你给别人看捡到的东西时，停下来看一眼。' },
  DCBP: { name: '煮茶人', line: '火候、香气、温度，都记在心里', gift: '你对细微的感受很敏锐，也懂得怎么让身边的人舒服。', shade: '一直在调别人的温度，你自己渴不渴可能没人问。', heard: '别人常以为你什么都不介意。你只是把那些话和水一起烧开了，才端出来。', with: '别总等你开口。有时候，也给你倒一杯茶。' },
  DCBU: { name: '追光人', line: '哪里有一点光，你就往哪里看', gift: '你会被别人没注意到的颜色和细节打动，这份敏感很难得。', shade: '光一直在动，追久了会累，记得也停下来歇一歇。', heard: '别人常以为你太容易被打动。你只是不肯对好看的东西装作没看见。', with: '你指给别人看那道光时，抬头看一下。' },
};

// lean runs from -1 (all the way to the left letter) to 1 (the right letter), with 0 at the cut line.
const leanOf = (share, cut) => (share >= cut ? -(share - cut) / (1 - cut) : (cut - share) / cut);
const pole = (letter, word, say) => ({ letter, word, say });

export const INK_AXES = [
  { key: 'look', left: pole('W', '先看整张', '你习惯先把整件事收进眼里，再决定往哪走。'), right: pole('D', '先看局部', '你从一小块开始，全貌是慢慢才让它出来的。'), rule: 'W ÷ R，分界 40%' },
  { key: 'move', left: pole('M', '往里想', '打动你的多是人在做什么、想什么，你往里走得多。'), right: pole('C', '往外感', '颜色和气氛会先碰到你，你往外感受得多。'), rule: 'M 对 WSumC' },
  { key: 'ink', left: pole('F', '简笔', '你话不多，靠轮廓就能把它说清楚。'), right: pole('B', '浓墨', '你看到的不只是形状，还有质地、浓淡和动静。'), rule: '纯 F ÷ R，分界 45%' },
  { key: 'seen', left: pole('P', '常见', '你看到的东西别人也能看懂，你和世界有共同的语言。'), right: pole('U', '少见', '你看到的，常常是别人没想到的那一个。'), rule: '(u + −) ÷ R，分界 1/3' },
];

// Shares of this person's own responses. Never a comparison with anyone else.
const INGREDIENTS = [
  ['想象', '看到东西在动', c => c.det.some(d => /^(M|FM|m)/.test(d))],
  ['人', '看到人或人的一部分', c => c.content.some(x => ['H', 'Hd', '(H)', '(Hd)'].includes(x))],
  ['感受', '用上了颜色', c => c.det.some(d => /^(FC|CF|C|Cn)$/.test(d))],
  ['细腻', '用上了明暗、质地或远近', c => c.det.some(d => /^(FC'|C'F|C'|FT|TF|T|FV|VF|V|FY|YF|Y|FD)$/.test(d))],
  ['组织', '把几样东西连成一件事', c => c.dq === '+' || c.dq === 'v/+'],
  ['独到', '只属于你的看法，或看向空白', c => c.fq === 'u' || c.space],
];

export function inkType(Y, codes = []) {
  if (!Y || Y.R < 8) return null;
  const R = Y.R, { W, D, Dd } = Y.processing, [M, WSumC] = Y.affect.EB, pureF = Y.validity.pureF, fq = Y.mediation.fq;
  const unusual = fq.u + fq['-'];
  const moveLean = M + WSumC ? (WSumC - M) / (M + WSumC) : 0;
  const measures = [
    { lean: leanOf(W / R, .4), a: W, b: D + Dd },
    { lean: moveLean, a: M, b: WSumC },
    { lean: leanOf(pureF / R, .45), a: pureF, b: R - pureF },
    { lean: -leanOf(unusual / R, 1 / 3), a: R - unusual, b: unusual },
  ];
  const axes = INK_AXES.map((axis, i) => {
    const { lean, a, b } = measures[i];
    const left = lean <= 0, side = left ? axis.left : axis.right;
    const leftPct = Math.round(50 - lean * 50);
    return { key: axis.key, letter: side.letter, word: side.word, say: side.say, left: axis.left, right: axis.right, rule: axis.rule, a, b, lean: +lean.toFixed(2), leftPct, rightPct: 100 - leftPct, even: Math.abs(lean) < .15 };
  });
  const code = axes.map(a => a.letter).join('');
  const flip = { W: 'D', D: 'W', M: 'C', C: 'M', F: 'B', B: 'F', P: 'U', U: 'P' };
  const mirror = [...code].map(l => flip[l]).join('');
  const ingredients = INGREDIENTS.map(([word, tip, has]) => ({ word, tip, pct: Math.round(codes.filter(has).length / R * 100) }));
  return { code, ...INK_TYPES[code], axes, mirror, mirrorName: INK_TYPES[mirror].name, ingredients };
}
