// RorBlot: a mirrored inkblot grown from a seed and the person's own strokes.
// Report page behaviour lives below it; the session page only uses RorBlot.
(() => {
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function noiseField(seed) {
    const r = rng(seed * 7919 + 13), N = 256, g = new Float32Array(N * N);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const fade = t => t * t * (3 - 2 * t);
    const at = (x, y) => g[((y & 255) << 8) | (x & 255)];
    const v = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), w = fade(y - yi);
      return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - w) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * w;
    };
    return (x, y, oct = 4) => { let a = .5, f = 1, s = 0; for (let i = 0; i < oct; i++) { s += a * v(x * f, y * f); a *= .5; f *= 2.03; } return s; };
  }
  const INK = [34, 31, 28];
  const PIGMENT = [[168, 58, 48], [205, 112, 56], [62, 108, 128], [84, 124, 98], [192, 84, 110]];
  const CINNABAR = [[199, 50, 31], [176, 42, 28], [214, 74, 44]];
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  function draw(canvas, opt = {}) {
    const { seed = 11, points = [], color = false, colorful = 0, grow = 1, warm = false } = opt;
    const G = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    const scale = 1.25, w = Math.ceil(W / scale), h = Math.ceil(H / scale), half = Math.ceil(w / 2);
    const fbm = noiseField(seed), fine = noiseField(seed + 101);
    const r = rng(seed + 5);
    // Lobes are placed in (u, v): u is distance from the fold (0..1), v runs top to bottom.
    const blobs = [{ u: 0, v: .5, a: .16, b: .4, w: 1.1 }];
    const lobes = 5 + Math.floor(r() * 3);
    for (let i = 0; i < lobes; i++) blobs.push({ u: .14 + r() * .5, v: .16 + (i + r() * .6) / lobes * .68, a: .13 + r() * .17, b: .07 + r() * .08, w: .72 + r() * .42 });
    const wings = 1 + Math.floor(r() * 2);
    for (let i = 0; i < wings; i++) blobs.push({ u: .55 + r() * .22, v: .22 + r() * .5, a: .17, b: .035 + r() * .03, w: .8 });
    for (let i = 0; i < 9; i++) blobs.push({ u: .3 + r() * .55, v: .1 + r() * .8, a: .012 + r() * .012, b: .012 + r() * .012, w: .95 });
    // The person's strokes pull ink toward where they looked.
    const GX = 48, GY = 68, pull = new Float32Array(GX * GY);
    for (const p of points.slice(0, 600)) {
      const gx = Math.min(GX - 1, Math.floor(Math.abs(p[0] - .5) * 2 * GX)), gy = Math.min(GY - 1, Math.max(0, Math.floor(p[1] * GY)));
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        const X = gx + dx, Y = gy + dy;
        if (X >= 0 && X < GX && Y >= 0 && Y < GY) pull[Y * GX + X] += Math.exp(-(dx * dx + dy * dy) / 9) * .02;
      }
    }
    const t = .58 + (1 - grow) * .5;
    const pig = color || colorful > 0;
    const inks = warm ? CINNABAR : PIGMENT;
    const pa = inks[Math.floor(r() * inks.length)], pb = inks[(Math.floor(r() * (inks.length - 1)) + 1 + inks.indexOf(pa)) % inks.length];
    const img = G.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < half; x++) {
      const u = (half - x - .5) / half, v = (y + .5) / h;
      const wu = u + (fbm(u * 4 + 3, v * 6, 3) - .5) * .2, wv = v + (fbm(u * 4, v * 6 + 7, 3) - .5) * .14;
      let f = 0;
      for (const b of blobs) { const q = ((wu - b.u) / b.a) ** 2 + ((wv - b.v) / b.b) ** 2; if (q < 7) f += b.w * Math.exp(-q); }
      f += pull[Math.min(GY - 1, Math.floor(v * GY)) * GX + Math.min(GX - 1, Math.floor(u * GX))];
      f += (fbm(u * 13, v * 18, 4) - .5) * .5 + (fine(x * .09, y * .09, 3) - .5) * .17;
      f *= smooth(1, .78, u) * smooth(0, .1, v) * smooth(1, .9, v);
      const edge = smooth(t, t + .035, f);
      if (edge <= 0) continue;
      // Ink pools at the rim and thins in broad, uneven washes; the fold shows only as a faint seam.
      const wash = smooth(.28, .72, fbm(u * 3.2 + 11, v * 4.2 + 2, 4));
      const grain = fine(u * 38, v * 52, 2) - .5;
      const pool = Math.exp(-(f - t) * 9) * .42;
      const seam = Math.exp(-((u * half) ** 2) / 2.2) * .22 * fine(3, v * 40, 2);
      const density = Math.min(1, .6 + wash * (warm ? .36 : .42) + grain * .1 + pool + seam);
      let c = INK;
      if (pig) {
        const bias = fbm(u * 2.4 + 9, v * 2.4, 2) - .5;
        const amt = warm ? smooth(.14, .56, bias * 2.4 + Math.min(.34, colorful * .05)) : smooth(.1, .9, (color ? .52 : Math.min(.62, .1 + colorful * .09)) + bias * 1.6);
        const k = smooth(.32, .68, v + bias * .4);
        const m = [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k];
        c = [INK[0] + (m[0] - INK[0]) * amt, INK[1] + (m[1] - INK[1]) * amt, INK[2] + (m[2] - INK[2]) * amt];
      }
      const tooth = fine(x * .55, y * .55, 2);
      const missed = tooth > .76 ? .72 : 1;
      const alpha = 255 * edge * density * missed;
      for (const px of [x, w - 1 - x]) {
        const o = (y * w + px) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = alpha;
      }
    }
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    off.getContext('2d').putImageData(img, 0, 0);
    G.clearRect(0, 0, W, H);
    G.imageSmoothingQuality = 'high';
    G.drawImage(off, 0, 0, W, H);
  }
  window.RorBlot = { draw };

  if (document.body.dataset.page !== 'report') return;
  const data = JSON.parse(document.getElementById('blotData').textContent);
  // Every cover carries a little cinnabar. Seeing colour in the plates adds more.
  draw(document.getElementById('eleventh'), { seed: data.seed, points: data.points, colorful: 2 + data.colorful, warm: true });

  let rt = { live: false };
  try { rt = JSON.parse(document.getElementById('rt').textContent); } catch { /* opened as a plain file */ }
  const api = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ror-key': rt.key }, body: JSON.stringify(b || {}) });

  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };
  document.querySelectorAll('.portrait').forEach(el => {
    const key = el.dataset.key, id = `ror-${document.body.dataset.session}-${key}`;
    const mark = v => el.querySelectorAll('.ask button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    const saved = store.get(id);
    if (saved) mark(saved);
    el.querySelectorAll('.ask button').forEach(b => { b.onclick = () => { mark(b.dataset.v); store.set(id, b.dataset.v); if (rt.live) api('/api/feedback', { key, value: b.dataset.v }); }; });
  });
  document.getElementById('print').onclick = () => window.print();
  document.getElementById('data').onclick = async () => {
    let p = null;
    try { p = rt.live ? await fetch('/api/protocol', { headers: { 'x-ror-key': rt.key } }).then(r => r.json()) : null; } catch { /* the page may be opened from disk */ }
    p ||= JSON.parse(document.getElementById('protocol').textContent);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }));
    a.download = `rorschach-${p.session.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const del = document.getElementById('del');
  if (rt.live) {
    del.hidden = false;
    let armed = false;
    del.onclick = async () => {
      if (!armed) { armed = true; del.textContent = '确定删除？再点一次，不可恢复'; setTimeout(() => { armed = false; del.textContent = '删除这次记录'; }, 5000); return; }
      await api('/api/delete');
      document.body.innerHTML = '<p style="font:400 20px serif;padding:20vh 8vw;">这次的记录已经删除了。</p>';
    };
  }
  const pages = [...document.querySelectorAll('.page')];
  const reveal = () => pages.forEach(el => el.classList.remove('pre'));
  if ('IntersectionObserver' in window) {
    pages.forEach(el => { if (el.getBoundingClientRect().top > innerHeight * .9) el.classList.add('pre'); });
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.remove('pre'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px' });
    pages.forEach(el => io.observe(el));

    // Where you are in the booklet: one red dot among the black.
    const rail = document.querySelector('.rail'), links = [...rail.querySelectorAll('a')];
    const targets = links.map(a => [a, document.getElementById(a.dataset.to)]).filter(([, el]) => el);
    links.forEach(a => { if (!document.getElementById(a.dataset.to)) a.remove(); });
    const spot = () => {
      const y = innerHeight * .35;
      let now = null;
      for (const [a, el] of targets) if (el.getBoundingClientRect().top <= y) now = a;
      links.forEach(a => a.classList.toggle('now', a === now));
      rail.classList.toggle('on', scrollY > innerHeight * .6);
    };
    addEventListener('scroll', spot, { passive: true });
    spot();
  }
  addEventListener('beforeprint', () => { reveal(); document.querySelector('.seq').open = true; });

  // ---------- the small labels on the marks ----------
  const tip = document.getElementById('tip');
  const showTip = el => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    const left = el.dataset.side === 'left' ? r.left - t.width - 10 : Math.min(innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
    const top = el.dataset.side === 'left' ? r.top + r.height / 2 - t.height / 2 : r.top - t.height - 8 < 8 ? r.bottom + 8 : r.top - t.height - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hideTip = () => { tip.hidden = true; };
  const tipped = e => { const el = e.target.closest?.('[data-tip]'); return el?.dataset.tip ? el : null; };
  document.addEventListener('pointerover', e => { const el = tipped(e); if (el) showTip(el); else hideTip(); });
  document.addEventListener('focusin', e => { const el = tipped(e); if (el) showTip(el); });
  document.addEventListener('focusout', hideTip);
  addEventListener('scroll', hideTip, { passive: true });

  // ---------- the card to keep ----------
  const shareData = JSON.parse(document.getElementById('shareData').textContent);
  const SERIF = '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", STSong, serif';
  function spaced(G, text, cx, y, gap) {
    const chars = [...text], widths = chars.map(c => G.measureText(c).width);
    let x = cx - (widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1)) / 2;
    chars.forEach((c, i) => { G.fillText(c, x, y); x += widths[i] + gap; });
  }
  // The same daylight as the page: relief lit from the upper left.
  function relief(W, H, seed, freq, depth, base) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const G = c.getContext('2d'), img = G.createImageData(W, H), d = img.data, n = noiseField(seed);
    const lift = new Float32Array((W + 1) * (H + 1));
    for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) lift[y * (W + 1) + x] = n(x * freq, y * freq, 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = y * (W + 1) + x, slope = (lift[o + 1] - lift[o]) + (lift[o + W + 1] - lift[o]);
      const k = 1 - slope * depth, i = (y * W + x) * 4;
      d[i] = base[0] * k; d[i + 1] = base[1] * k; d[i + 2] = base[2] * k; d[i + 3] = 255;
    }
    G.putImageData(img, 0, 0);
    return c;
  }
  const card = document.getElementById('shareCard');
  let painted = null;
  const drawShare = () => (painted ||= paintShare());
  async function paintShare() {
    const G = card.getContext('2d'), W = card.width, H = card.height;
    G.drawImage(relief(W / 2, H / 2, 41, .09, .8, [231, 226, 215]), 0, 0, W, H);
    const m = 72, cw = W - m * 2, ch = H - m * 2, rad = 34;
    const rounded = (x, y) => { G.beginPath(); G.roundRect(x, y, cw, ch, rad); };
    // Thick stock: a long soft shadow to the lower right, then the cut edge, then the face.
    G.save();
    for (const [dx, dy, blur, alpha] of [[34, 52, 90, .2], [14, 22, 34, .16], [3, 6, 8, .22]]) {
      G.shadowColor = `rgba(70,58,38,${alpha})`; G.shadowOffsetX = dx; G.shadowOffsetY = dy; G.shadowBlur = blur;
      G.fillStyle = '#d9d2c3'; rounded(m, m + 6); G.fill();
    }
    G.restore();
    G.save();
    rounded(m, m); G.clip();
    G.drawImage(relief(cw, ch, 5, .3, .16, [244, 240, 231]), m, m);
    G.fillStyle = 'rgba(255,255,255,.7)'; G.fillRect(m, m, cw, 2);
    const blot = document.createElement('canvas');
    blot.width = 1200; blot.height = 848;
    draw(blot, { seed: data.seed, points: data.points, colorful: 2 + data.colorful, warm: true });
    G.globalCompositeOperation = 'multiply';
    const T = shareData.type;
    const bw = cw - 176, bh = bw * blot.height / blot.width, top = m + 40;
    G.drawImage(blot, W / 2 - bw / 2, top, bw, bh);
    G.globalCompositeOperation = 'source-over';
    G.textBaseline = 'alphabetic';
    let y = top + bh + 90;
    const press = (fn, ink) => { G.fillStyle = 'rgba(255,255,255,.9)'; G.save(); G.translate(0, 1.6); fn(); G.restore(); G.fillStyle = ink; fn(); };
    const LATIN = '"Iowan Old Style", Palatino, Georgia, serif';
    // A sentence set wide, shrunk only if it would run off the card.
    const fitted = (text, weight, size, gap, ink, at) => {
      let s = size;
      do { G.font = `${weight} ${s}px ${SERIF}`; s -= 1; } while (G.measureText(text).width + gap * ([...text].length - 1) > cw - 112 && s > 16);
      press(() => spaced(G, text, W / 2, at, gap), ink);
    };
    if (T) {
      G.font = `500 92px ${SERIF}`;
      press(() => spaced(G, T.name, W / 2, y, 20), '#1f1c18');
      y += 56;
      G.font = `400 32px ${LATIN}`;
      G.fillStyle = '#c7321f';
      spaced(G, T.code, W / 2, y, 22);
      y += 54;
      fitted(T.line, 400, 30, 4, '#565047', y);
      y += 40;
      G.fillStyle = '#c7321f'; G.fillRect(W / 2 - 22, y, 44, 3);
      y += 62;
      for (const part of T.heard.match(/[^。]+。/g) || [T.heard]) { fitted(part, 500, 31, 4, '#1f1c18', y); y += 48; }
      // The four letters with their shares, one column each.
      const colW = (cw - 160) / 4;
      y += 30;
      T.axes.forEach((x, i) => {
        const cx = m + 80 + colW * (i + .5);
        G.textAlign = 'center';
        G.font = `400 38px ${LATIN}`; G.fillStyle = '#1f1c18'; G.fillText(`${x.pct}%`, cx, y);
        G.font = `400 21px ${SERIF}`; G.fillStyle = '#565047'; G.fillText(`${x.letter} ${x.word}`, cx, y + 32);
      });
      G.textAlign = 'left';
    } else {
      G.font = `500 72px ${SERIF}`;
      press(() => spaced(G, '十张墨迹', W / 2, y, 16), '#1f1c18');
      y += 50;
      G.fillStyle = '#c7321f'; G.fillRect(W / 2 - 22, y, 44, 3);
      y += 76;
      fitted('说你看到了什么，再把它圈出来。', 400, 32, 6, '#565047', y);
    }
    // A way in for whoever sees the card.
    const qrSize = 124, qrY = H - m - 44 - qrSize, qrX = m + 56;
    const textX = shareData.qr ? qrX + qrSize + 28 : qrX;
    if (shareData.qr) {
      const img = new Image();
      img.src = shareData.qr;
      await img.decode();
      G.imageSmoothingEnabled = false;
      G.globalCompositeOperation = 'multiply';
      G.drawImage(img, qrX, qrY, qrSize, qrSize);
      G.globalCompositeOperation = 'source-over';
      G.imageSmoothingEnabled = true;
    }
    G.textAlign = 'left';
    G.font = `500 30px ${SERIF}`;
    press(() => G.fillText('你是哪一种墨？', textX, qrY + 38), '#1f1c18');
    G.font = `400 23px ${LATIN}`;
    G.fillStyle = '#565047';
    G.fillText(shareData.link, textX, qrY + 80);
    G.font = `400 19px ${SERIF}`;
    G.fillStyle = '#696257';
    G.fillText('十张墨迹。十六墨型是一种记法，不是诊断。', textX, qrY + 116);
    G.restore();
  }
  if ('IntersectionObserver' in window) {
    const near = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { near.disconnect(); drawShare(); } }, { rootMargin: '600px 0px' });
    near.observe(card);
  } else drawShare();
  addEventListener('beforeprint', drawShare);
  document.querySelectorAll('.saveCard').forEach(btn => { btn.onclick = async () => {
    await drawShare();
    card.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `十张墨迹-${shareData.type?.name || '分享卡'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  }; });
  const copyBtn = document.getElementById('copyText'), words = document.getElementById('shareText');
  const fitWords = () => { words.style.height = 'auto'; words.style.height = `${words.scrollHeight + 4}px`; };
  fitWords();
  words.addEventListener('input', fitWords);
  addEventListener('resize', fitWords);
  copyBtn.onclick = async () => {
    let done = false;
    try { await navigator.clipboard.writeText(words.value); done = true; }
    catch { words.select(); try { done = document.execCommand('copy'); } catch { /* the box stays selected, ready to copy by hand */ } }
    copyBtn.textContent = done ? '复制好了' : '选中了，手动复制一下';
    setTimeout(() => { copyBtn.textContent = '复制这段话'; }, 2400);
  };

  // ---------- the sixteen ----------
  const atlas = document.querySelector('.atlas');
  if (atlas) {
    const paint = () => atlas.querySelectorAll('canvas').forEach(c => {
      if (c.dataset.done) return;
      c.dataset.done = '1';
      const seed = [...c.dataset.code].reduce((a, ch) => (a * 37 + ch.charCodeAt(0)) >>> 0, 19) % 100000;
      draw(c, { seed, warm: !!c.closest('.me'), colorful: c.closest('.me') ? 3 : 0 });
    });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); paint(); } }, { rootMargin: '800px 0px' });
      io.observe(atlas);
    } else paint();
    addEventListener('beforeprint', paint);
  }
})();
