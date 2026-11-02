// Session page: one table, ten plates, a camera. Everything the examiner does arrives over SSE.
(() => {
  const K = window.ROR_KEY;
  const $ = s => document.querySelector(s);
  const api = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ror-key': K }, body: JSON.stringify(b || {}) }).then(r => r.json());
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const W = 1200, H = 833, GAP = 300;
  const stage = $('#stage'), world = $('#world'), zoomv = $('#zoomv');
  let S = null, tool = 'hand', view = 'focus', fitted = true;
  const cam = { x: 0, y: 0, z: .5, tx: 0, ty: 0, tz: .5 };
  const cards = {};
  const viewable = () => ['response', 'inquiry', 'choices'].includes(S?.phase);
  const plateInFocus = () => ['response', 'inquiry'].includes(S?.phase) && view !== 'board' && !!S.card;

  // ---------- trace: every interaction reaches the record, timed on the browser's monotonic clock ----------
  const clock = () => performance.timeOrigin + performance.now();
  const outbox = [];
  let sending = false, flushTimer = 0;
  function emit(ev) { outbox.push(ev); clearTimeout(flushTimer); flushTimer = setTimeout(flush, 120); }
  async function flush() {
    if (sending || !outbox.length) return;
    sending = true;
    const events = outbox.splice(0);
    try { await api('/api/trace', { sentAt: clock(), events }); } catch { outbox.unshift(...events); }
    sending = false;
    if (outbox.length) flushTimer = setTimeout(flush, 800);
  }

  // ---------- layout ----------
  const seat = n => { const i = n - 1, col = i % 5, row = Math.floor(i / 5); return { x: col * (W + GAP), y: row * (H + GAP + 90) }; };
  const tilt = n => [-1.2, .8, -.5, 1.1, -.9, .6, -1, .9, -.4, .7][n - 1];
  for (let n = 1; n <= 10; n++) {
    const id = String(n).padStart(2, '0');
    const el = document.createElement('article');
    el.className = 'plate future';
    el.dataset.card = n;
    el.innerHTML = `<div class="turn"><div class="sheet"><img alt="" src="/app/plates/thumbs/${id}.jpg" draggable="false"><svg class="ink" viewBox="0 0 3000 2083" preserveAspectRatio="none"></svg><div class="back">${ROMAN[n]}</div></div><div class="knob" title="拖动转动，靠近正位时会吸附"></div></div><div class="stamps"></div>`;
    world.appendChild(el);
    cards[n] = { el, turn: el.querySelector('.turn'), img: el.querySelector('img'), svg: el.querySelector('svg'), stamps: el.querySelector('.stamps'), rot: 0, rest: 0, pos: seat(n), hi: false };
    placeCard(n);
  }
  function placeCard(n) {
    const c = cards[n];
    const t = view === 'board' ? tilt(n) : 0;
    c.el.style.transform = `translate(${c.pos.x}px, ${c.pos.y}px) rotate(${t}deg)`;
    c.turn.style.transform = `rotate(${c.rot}deg)`;
  }
  function hiRes(n) {
    const c = cards[n];
    if (c.hi) return;
    c.hi = true;
    const id = String(n).padStart(2, '0');
    const im = new Image();
    im.onload = () => { c.img.src = im.src; };
    im.src = `/app/plates/${id}.jpg`;
  }

  // ---------- camera ----------
  const applyCam = () => {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
    world.style.setProperty('--z', cam.z);
    // Far means pulled well back from this plate's own fit, on a phone as on a wall screen.
    document.body.classList.toggle('far', cam.z < (S?.card && cards[S.card] ? fitScale(cards[S.card].rest) : .78) * .54);
    // Zoom is measured against the angle the plate last rested at: turning it does not make it bigger.
    zoomv.textContent = plateInFocus() ? `${Math.round(cam.z / fitScale(cards[S.card].rest) * 100)}%` : '—';
  };
  let raf = 0;
  function camLoop() {
    const k = .14;
    cam.x += (cam.tx - cam.x) * k; cam.y += (cam.ty - cam.y) * k; cam.z += (cam.tz - cam.z) * k;
    applyCam();
    if (Math.abs(cam.tx - cam.x) + Math.abs(cam.ty - cam.y) > .3 || Math.abs(cam.tz - cam.z) > .0004) raf = requestAnimationFrame(camLoop);
    else { cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz; applyCam(); raf = 0; }
  }
  const go = () => { if (!raf) raf = requestAnimationFrame(camLoop); };
  const jump = () => { cam.tx = cam.x; cam.ty = cam.y; cam.tz = cam.z; if (raf) { cancelAnimationFrame(raf); raf = 0; } applyCam(); };
  function insets() {
    const vw = innerWidth, vh = innerHeight, narrow = vw < 860;
    const ledger = !narrow && S && ['response', 'inquiry'].includes(S.phase);
    return { l: narrow ? 16 : 164, r: ledger ? Math.min(340, vw * .25) : (narrow ? 16 : 64), t: narrow ? 90 : 36, b: narrow ? 240 : 206 };
  }
  // The words and the input sit under the plate, not under the window.
  const alignDock = () => { const m = insets(); document.documentElement.style.setProperty('--plate-x', `${(m.l + innerWidth - m.r) / 2}px`); };
  function fitBox(x, y, w, h, m = insets()) {
    const vw = innerWidth - m.l - m.r, vh = innerHeight - m.t - m.b;
    const z = Math.min(vw / w, vh / h);
    cam.tz = z;
    cam.tx = m.l + (vw - w * z) / 2 - x * z;
    cam.ty = m.t + (vh - h * z) / 2 - y * z;
    go();
  }
  const bbox = deg => { const a = deg * Math.PI / 180, s = Math.abs(Math.sin(a)), c = Math.abs(Math.cos(a)); return [W * c + H * s, W * s + H * c]; };
  function fitScale(deg) { const m = insets(), [bw, bh] = bbox(deg); return Math.min((innerWidth - m.l - m.r) / bw, (innerHeight - m.t - m.b) / bh); }
  function fitCard(n) { const c = cards[n], [bw, bh] = bbox(c.rot); fitBox(c.pos.x + W / 2 - bw / 2, c.pos.y + H / 2 - bh / 2, bw, bh); fitted = true; go(); }
  function fitBoard() {
    const xs = Object.values(cards).map(c => c.pos);
    const x0 = Math.min(...xs.map(p => p.x)), y0 = Math.min(...xs.map(p => p.y));
    const x1 = Math.max(...xs.map(p => p.x)) + W, y1 = Math.max(...xs.map(p => p.y)) + H + 70;
    if (S?.phase === 'choices') {
      const narrow = innerWidth < 860;
      fitBox(x0, y0, x1 - x0, y1 - 70 - y0, { l: narrow ? 14 : 56, r: narrow ? 14 : 56, t: narrow ? 104 : 144, b: narrow ? 186 : 176 });
      return;
    }
    fitBox(x0, y0, x1 - x0, y1 - y0, { l: 90, r: 50, t: 50, b: 170 });
  }
  function setView(v) {
    view = v;
    document.body.dataset.view = v;
    for (let n = 1; n <= 10; n++) placeCard(n);
    v === 'board' ? fitBoard() : fitCard(S?.card || 1);
  }
  const zoomAt = (f, px, py) => {
    const z = Math.min(9, Math.max(.06, cam.tz * f));
    const r = z / cam.tz;
    cam.tx = px - (px - cam.tx) * r; cam.ty = py - (py - cam.ty) * r; cam.tz = z;
    fitted = false;
    go();
  };

  // ---------- what is on screen, in the plate's own frame ----------
  const norm = d => +(((d % 360) + 360) % 360).toFixed(1) % 360;
  const r3 = v => +v.toFixed(3);
  function viewState() {
    const n = S?.card;
    if (!plateInFocus()) return { mode: 'board', z: null, w: Math.round(W * cam.tz), cx: null, cy: null, deg: null, visible: null, box: null };
    const c = cards[n], z = cam.tz, m = insets();
    const rad = c.rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const mx = (m.l + innerWidth - m.r) / 2, my = (m.t + innerHeight - m.b) / 2;
    const dx = (mx - cam.tx) / z - c.pos.x - W / 2, dy = (my - cam.ty) / z - c.pos.y - H / 2;
    const cols = 24, rows = 16;
    let seen = 0, x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const u = (i + .5) / cols, v = (j + .5) / rows, px = (u - .5) * W, py = (v - .5) * H;
      const sx = cam.tx + z * (c.pos.x + W / 2 + px * cos - py * sin), sy = cam.ty + z * (c.pos.y + H / 2 + px * sin + py * cos);
      if (sx < 0 || sx > innerWidth || sy < 0 || sy > innerHeight) continue;
      seen++;
      x0 = Math.min(x0, i / cols); y0 = Math.min(y0, j / rows); x1 = Math.max(x1, (i + 1) / cols); y1 = Math.max(y1, (j + 1) / rows);
    }
    return {
      mode: 'focus', z: r3(z / fitScale(c.rest)), w: Math.round(W * z),
      cx: r3((dx * cos + dy * sin + W / 2) / W), cy: r3((-dx * sin + dy * cos + H / 2) / H),
      deg: norm(c.rot), visible: r3(seen / (cols * rows)), box: seen ? [x0, y0, x1, y1].map(r3) : null,
    };
  }

  // One gesture per continuous interaction. Endpoints are exact; samples in between are rate-limited.
  let g = null, gTimer = 0, gSampled = 0;
  function act(op, via, fn, hold = false) {
    const now = clock();
    if (g && (g.op !== op || g.via !== via)) endGesture();
    if (!g) { g = { card: S?.phase === 'choices' ? null : S?.card ?? null, op, via, at: now, last: now, from: viewState(), samples: [] }; gSampled = 0; }
    fn();
    g.last = now;
    if (now - gSampled >= 80) { gSampled = now; const s = viewState(); g.samples.push([Math.round(now - g.at), s.z, s.cx, s.cy, s.deg]); }
    clearTimeout(gTimer);
    if (!hold) gTimer = setTimeout(endGesture, 220);
  }
  function endGesture() {
    if (!g) return;
    clearTimeout(gTimer);
    const { card, op, via, at, last, from, samples } = g;
    g = null;
    emit({ type: 'gesture', card, op, via, at, endAt: last, from, to: viewState(), samples });
  }
  const once = (op, via, fn) => { act(op, via, fn); endGesture(); };

  // ---------- exposures: a plate counts as shown once it is decoded, painted and the camera has settled ----------
  let exposure = null, exposureKey = null, exposureToken = 0;
  // Close enough that the person can see the plate; the last pixels of easing are not perception.
  const arrived = () => Math.abs(cam.tx - cam.x) + Math.abs(cam.ty - cam.y) < 24 && Math.abs(cam.tz - cam.z) / cam.tz < .03;
  const settled = () => new Promise(res => {
    const guard = setTimeout(res, 1500);
    const check = () => { if (!arrived()) requestAnimationFrame(check); else requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(guard); res(); })); };
    check();
  });
  async function beginExposure(card, response) {
    const key = `${card}/${response}`;
    if (exposureKey === key) return;
    endExposure();
    exposureKey = key;
    const token = exposureToken;
    if (card) await cards[card].img.decode().catch(() => {});
    await settled();
    if (token !== exposureToken) return;
    exposure = { card };
    emit({ type: 'exposure.start', at: clock(), card, response, state: viewState() });
  }
  function endExposure() {
    endGesture();
    if (exposure) emit({ type: 'exposure.end', at: clock(), card: exposure.card });
    exposure = null; exposureKey = null; exposureToken++;
  }

  // ---------- rotation ----------
  function turnTo(n, deg, via) { once('rotate', via, () => { cards[n].rot = cards[n].rest = deg; placeCard(n); if (fitted) fitCard(n); }); }
  function rotateStep(dir, via) {
    if (!plateInFocus()) return;
    const n = S.card, q = cards[n].rot / 90;
    turnTo(n, (dir > 0 ? Math.floor(q + 1e-6) + 1 : Math.ceil(q - 1e-6) - 1) * 90, via);
  }
  const snapped = (deg, within) => { const q = Math.round(deg / 90) * 90; return Math.abs(deg - q) < within ? q : deg; };

  // ---------- pointer ----------
  const ptrs = new Map();
  let drag = null, stroke = null, pinch = null, space = false, turning = null;
  const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const svgPoint = (n, x, y) => {
    const svg = cards[n].svg, m = svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(x, y).matrixTransform(m.inverse());
    return [p.x / 3000, p.y / 2083];
  };
  const inBounds = p => p && p[0] >= -.02 && p[0] <= 1.02 && p[1] >= -.02 && p[1] <= 1.02;
  stage.addEventListener('pointerdown', e => {
    if (!viewable()) return;
    stage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      stroke && cancelStroke();
      turning = null;
      drag = null;
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a: angle(a, b), twist: 0, rot0: plateInFocus() ? cards[S.card].rot : 0 };
      if (plateInFocus()) cards[S.card].turn.classList.add('live');
      return;
    }
    const n = S?.card;
    if (e.target.closest?.('.knob') && plateInFocus()) {
      const r = cards[n].el.getBoundingClientRect(), c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      turning = { n, c, a0: angle(c, { x: e.clientX, y: e.clientY }), rot0: cards[n].rot };
      cards[n].turn.classList.add('live');
      return;
    }
    if (tool === 'pen' && !space && e.button === 0 && plateInFocus()) {
      const p = svgPoint(n, e.clientX, e.clientY);
      if (inBounds(p)) { startStroke(n, p, e); return; }
    }
    if (tool === 'erase' && !space && e.button === 0 && plateInFocus()) { drag = { erase: true }; eraseAt(e.clientX, e.clientY); return; }
    if (S?.phase === 'choices' && e.button === 0) {
      const el = e.target.closest?.('.plate') || document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList?.contains('plate'));
      if (el) { const m = Number(el.dataset.card); drag = { card: m, at: clock(), sx: e.clientX, sy: e.clientY, ox: cards[m].pos.x, oy: cards[m].pos.y }; el.style.transition = 'none'; el.style.zIndex = 5; return; }
    }
    drag = { pan: true, sx: e.clientX, sy: e.clientY, ox: cam.tx, oy: cam.ty };
    stage.classList.add('grabbing');
  });
  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, ang = angle(a, b);
      const step = ((ang - pinch.a + 540) % 360) - 180;
      act('transform', 'pinch', () => {
        cam.tx += x - pinch.x; cam.ty += y - pinch.y;
        zoomAt(d / pinch.d, x, y);
        pinch.twist += step;
        if (plateInFocus() && Math.abs(pinch.twist) > 8) { cards[S.card].rot = pinch.rot0 + pinch.twist; placeCard(S.card); }
      }, true);
      Object.assign(pinch, { d, x, y, a: ang });
      return;
    }
    if (turning) {
      const deg = turning.rot0 + angle(turning.c, { x: e.clientX, y: e.clientY }) - turning.a0;
      act('rotate', 'handle', () => { cards[turning.n].rot = e.altKey ? deg : snapped(deg, 5); placeCard(turning.n); }, true);
      return;
    }
    if (stroke) { extendStroke(e); return; }
    if (!drag) return;
    if (drag.erase) { eraseAt(e.clientX, e.clientY); return; }
    if (drag.pan) { act('pan', 'drag', () => { cam.x = cam.tx = drag.ox + e.clientX - drag.sx; cam.y = cam.ty = drag.oy + e.clientY - drag.sy; fitted = false; jump(); }, true); return; }
    const c = cards[drag.card];
    c.pos.x = drag.ox + (e.clientX - drag.sx) / cam.tz;
    c.pos.y = drag.oy + (e.clientY - drag.sy) / cam.tz;
    placeCard(drag.card);
    highlightSlot(e.clientX, e.clientY);
  });
  const release = e => {
    ptrs.delete(e.pointerId);
    if (pinch && ptrs.size < 2) {
      if (plateInFocus()) { const c = cards[S.card]; c.rot = c.rest = snapped(c.rot, 10); placeCard(S.card); c.turn.classList.remove('live'); }
      pinch = null;
      endGesture();
    }
    if (turning) {
      const c = cards[turning.n];
      c.turn.classList.remove('live');
      c.rest = c.rot;
      if (g && fitted) fitCard(turning.n);
      turning = null;
      endGesture();
      return;
    }
    if (stroke) { endStroke(); return; }
    if (drag?.card) dropCard(drag, e.clientX, e.clientY);
    if (drag?.pan) endGesture();
    drag = null;
    stage.classList.remove('grabbing');
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    if (!viewable()) return;
    const mouseWheel = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 100 && Number.isInteger(e.deltaY) && e.deltaX === 0);
    const via = mouseWheel ? 'wheel' : 'trackpad';
    if (e.ctrlKey || e.metaKey || mouseWheel) act('zoom', via, () => zoomAt(Math.exp(-e.deltaY * (mouseWheel ? .0016 : .012)), e.clientX, e.clientY));
    else act('pan', via, () => { cam.x = cam.tx -= e.deltaX; cam.y = cam.ty -= e.deltaY; fitted = false; jump(); });
  }, { passive: false });
  stage.addEventListener('dblclick', e => {
    if (!viewable() || tool !== 'hand' || S.phase === 'choices' || e.target.closest?.('.knob')) return;
    once('zoom', 'dblclick', () => zoomAt(1.6, e.clientX, e.clientY));
  });
  // Safari reports trackpad pinch and twist as gesture events instead of ctrl+wheel.
  let trackpad = null;
  stage.addEventListener('gesturestart', e => {
    e.preventDefault();
    if (!viewable()) return;
    trackpad = { scale: 1, rot0: plateInFocus() ? cards[S.card].rot : 0 };
    if (plateInFocus()) cards[S.card].turn.classList.add('live');
  });
  stage.addEventListener('gesturechange', e => {
    e.preventDefault();
    if (!trackpad) return;
    act('transform', 'trackpad', () => {
      zoomAt(e.scale / trackpad.scale, e.clientX, e.clientY);
      trackpad.scale = e.scale;
      if (plateInFocus() && Math.abs(e.rotation) > 8) { cards[S.card].rot = trackpad.rot0 + e.rotation; placeCard(S.card); }
    }, true);
  });
  stage.addEventListener('gestureend', e => {
    e.preventDefault();
    if (!trackpad) return;
    if (plateInFocus()) { const c = cards[S.card]; c.rot = c.rest = snapped(c.rot, 10); placeCard(S.card); c.turn.classList.remove('live'); }
    trackpad = null;
    endGesture();
  });
  addEventListener('resize', () => {
    alignDock();
    emit({ type: 'client.resize', at: clock(), viewport: { w: innerWidth, h: innerHeight } });
    if (S?.phase === 'choices') layoutBoard();
    if (view === 'board') fitBoard(); else if (S && fitted && plateInFocus()) fitCard(S.card);
  });
  document.addEventListener('visibilitychange', () => emit({ type: 'client.visibility', at: clock(), visible: !document.hidden }));
  document.addEventListener('fullscreenchange', () => emit({ type: 'client.fullscreen', at: clock(), on: !!document.fullscreenElement }));
  // Thinking in front of a plate looks like an empty room unless the page says otherwise. "Still here", never where or what.
  let hereAt = 0;
  const here = () => { if (document.hidden || Date.now() - hereAt < 30000) return; hereAt = Date.now(); emit({ type: 'client.here', at: clock() }); };
  const watchHere = w => { for (const k of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll']) w.addEventListener(k, here, { capture: true, passive: true }); };
  watchHere(window);
  $('#report').addEventListener('load', e => { try { watchHere(e.target.contentWindow); } catch { /* a walled-off frame keeps its events to itself */ } });
  addEventListener('pagehide', () => {
    endExposure();
    if (outbox.length) fetch('/api/trace', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-ror-key': K }, body: JSON.stringify({ sentAt: clock(), events: outbox.splice(0) }) }).catch(() => {});
  });

  // ---------- strokes ----------
  function pathD(pts, close) {
    if (!pts.length) return '';
    const X = p => (p[0] * 3000).toFixed(1), Y = p => (p[1] * 2083).toFixed(1);
    let d = `M${X(pts[0])} ${Y(pts[0])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += `Q${X(pts[i])} ${Y(pts[i])} ${(mx * 3000).toFixed(1)} ${(my * 2083).toFixed(1)}`;
    }
    if (pts.length > 1) d += `L${X(pts[pts.length - 1])} ${Y(pts[pts.length - 1])}`;
    return close ? `${d}Z` : d;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function strokeEl(s) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', s.by === 'examiner' ? 'examiner' : 'user');
    g.dataset.id = s.id || '';
    g.dataset.response = s.response || '';
    const closed = isClosed(s.pts);
    if (s.by !== 'examiner') { const f = document.createElementNS(NS, 'path'); f.setAttribute('class', 'fillIn'); f.setAttribute('d', pathD(s.pts, true)); if (!closed) f.style.display = 'none'; g.appendChild(f); }
    for (const cls of ['halo', 'core']) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('class', cls);
      p.setAttribute('d', pathD(s.pts));
      if (cls === 'core') p.setAttribute('pathLength', '1');
      g.appendChild(p);
    }
    return g;
  }
  const isClosed = pts => pts.length > 8 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], (pts[0][1] - pts[pts.length - 1][1]) / 1.44) < .07;
  function startStroke(n, p, e) {
    const first = [+p[0].toFixed(4), +p[1].toFixed(4)];
    stroke = { card: n, response: S?.focus ?? null, pts: [first], ts: [0], stamp: e.timeStamp, at: clock(), pointer: e.pointerType || null, pressure: e.pointerType === 'pen' ? [e.pressure] : null, view: viewState(), el: strokeEl({ pts: [first], by: 'user' }) };
    cards[n].svg.appendChild(stroke.el);
  }
  function extendStroke(e) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      const p = svgPoint(stroke.card, ev.clientX, ev.clientY);
      const last = stroke.pts[stroke.pts.length - 1];
      if (p && Math.hypot(p[0] - last[0], p[1] - last[1]) > .0022) {
        stroke.pts.push([+p[0].toFixed(4), +p[1].toFixed(4)]);
        stroke.ts.push(Math.max(stroke.ts[stroke.ts.length - 1], Math.round(ev.timeStamp - stroke.stamp)));
        stroke.pressure?.push(ev.pressure);
      }
    }
    const d = pathD(stroke.pts);
    stroke.el.querySelectorAll('path.halo, path.core').forEach(x => x.setAttribute('d', d));
  }
  function cancelStroke() { stroke?.el.remove(); stroke = null; }
  function endStroke() {
    const s = stroke; stroke = null;
    if (s.pts.length < 4) { s.el.remove(); return; }
    const f = s.el.querySelector('.fillIn');
    if (isClosed(s.pts)) { f.setAttribute('d', pathD(s.pts, true)); f.style.display = ''; }
    const endAt = clock();
    snapshot(s.card, s.pts).then(snap => api('/api/stroke', { card: s.card, response: s.response, pts: s.pts, ts: s.ts, pressure: s.pressure, pointer: s.pointer, at: s.at, endAt, sentAt: clock(), view: s.view, snapshot: snap })).then(r => { s.el.dataset.id = r.id; });
  }
  const offLine = (pts, p) => {
    let best = Infinity;
    const k = H / W;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = (by - ay) * k;
      const t = Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - ay) * k * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p[0] - ax - t * dx, (p[1] - ay) * k - t * dy));
    }
    return best;
  };
  const erasing = new Set();
  function eraseAt(x, y) {
    const n = S.card, p = svgPoint(n, x, y);
    if (!p) return;
    const reach = 14 / (W * cam.tz);
    const hit = (S.strokes || []).find(s => s.card === n && s.by === 'user' && !erasing.has(s.id) && (s.response ?? null) === (S.focus ?? null) && offLine(s.pts, p) < reach);
    if (!hit) return;
    erasing.add(hit.id);
    cards[n].svg.querySelector(`g[data-id="${hit.id}"]`)?.remove();
    api('/api/stroke/erase', { id: hit.id }).finally(() => erasing.delete(hit.id));
  }

  // ---------- the picture the agent sees alongside the server's geometry ----------
  async function snapshot(n, pts) {
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `/app/plates/thumbs/${String(n).padStart(2, '0')}.jpg`; });
      const c = document.createElement('canvas'); c.width = 900; c.height = Math.round(900 * 2083 / 3000);
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, c.width, c.height);
      const drawn = (S.strokes || []).filter(s => s.card === n && s.by === 'user').map(s => s.pts).concat([pts]);
      g.strokeStyle = '#d0301a'; g.lineWidth = 5; g.lineJoin = g.lineCap = 'round';
      for (const q of drawn) { g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p[0] * c.width, p[1] * c.height) : g.moveTo(p[0] * c.width, p[1] * c.height))); g.stroke(); }
      return c.toDataURL('image/jpeg', .82);
    } catch { return null; }
  }
  function renderStrokes(all) {
    for (let n = 1; n <= 10; n++) {
      const svg = cards[n].svg;
      if (stroke && stroke.card === n) continue;
      const want = all.filter(s => s.card === n);
      const have = new Set([...svg.children].map(g => g.dataset.id));
      if (want.length === have.size && want.every(s => have.has(s.id))) continue;
      const ids = new Set(want.map(s => s.id));
      [...svg.children].forEach(g => { if (!ids.has(g.dataset.id)) g.remove(); });
      want.forEach(s => { if (!have.has(s.id)) svg.appendChild(strokeEl(s)); });
    }
  }
  function dimStrokes() {
    const focus = S?.focus;
    document.querySelectorAll('svg.ink g').forEach(g => g.classList.toggle('dim', S?.phase === 'inquiry' && !!focus && g.dataset.response !== focus));
  }

  // ---------- the four questions ----------
  const QUESTIONS = { liked: '最喜欢', disliked: '最不喜欢', father: '父亲', mother: '母亲' };
  const slots = $('#slots');
  const slotAt = (x, y) => [...slots.querySelectorAll('.slot')].find(b => { const r = b.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
  for (const [k, word] of Object.entries(QUESTIONS)) {
    const b = document.createElement('button');
    b.className = 'slot';
    b.dataset.q = k;
    b.innerHTML = `<span class="frame"><img alt="" hidden><i class="num"></i></span><span class="word">${word}</span>`;
    b.onclick = () => { if (S?.choiceAt !== k && (S?.choices[k].card || S?.choices[k].skipped)) api('/api/choice/revisit', { question: k }); };
    slots.appendChild(b);
  }
  const tableSeat = n => { const i = n - 1, cols = innerWidth < 860 ? 2 : 5; return { x: (i % cols) * (W + 90), y: Math.floor(i / cols) * (H + 90) }; };
  function highlightSlot(x, y) {
    const hit = slotAt(x, y);
    slots.querySelectorAll('.slot').forEach(b => b.classList.toggle('over', b === hit));
  }
  function dropCard(d, x, y) {
    const { card: n, at } = d, el = cards[n].el;
    el.style.transition = ''; el.style.zIndex = '';
    const moved = Math.hypot(x - d.sx, y - d.sy) > 6;
    const hit = moved ? slotAt(x, y)?.dataset.q ?? null : S.choiceAt;
    slots.querySelectorAll('.slot').forEach(b => b.classList.remove('over'));
    Object.assign(cards[n].pos, { x: d.ox, y: d.oy });
    placeCard(n);
    if (moved) emit({ type: 'drag.card', at, endAt: clock(), card: n, question: hit });
    if (hit) api('/api/choice', { question: hit, card: n, via: moved ? 'drag' : 'click' });
  }
  function renderChoices() {
    const on = S.phase === 'choices';
    slots.hidden = !on;
    $('#skip').hidden = !on;
    for (let n = 1; n <= 10; n++) {
      const c = cards[n];
      const mine = on ? Object.keys(QUESTIONS).filter(k => S.choices[k].card === n) : [];
      const sig = mine.join();
      c.el.classList.toggle('picked', mine.includes(S.choiceAt));
      c.el.tabIndex = on ? 0 : -1;
      c.el.setAttribute('role', on ? 'button' : 'article');
      c.el.setAttribute('aria-label', `第 ${ROMAN[n]} 张`);
      if (c.stampSig === sig) continue;
      c.stampSig = sig;
      c.stamps.textContent = '';
      mine.forEach(k => { const s = document.createElement('span'); s.textContent = QUESTIONS[k]; c.stamps.appendChild(s); });
    }
    if (!on) return;
    const open = Object.keys(QUESTIONS).filter(k => !S.choices[k].endedAt && k !== S.choiceAt);
    $('#next').textContent = open.length ? '下一题' : '完成';
    slots.querySelectorAll('.slot').forEach(b => {
      const k = b.dataset.q, a = S.choices[k], img = b.querySelector('img');
      b.classList.toggle('now', S.choiceAt === k);
      b.classList.toggle('filled', !!a.card);
      b.classList.toggle('skipped', !!a.skipped);
      b.disabled = S.choiceAt === k || !(a.card || a.skipped);
      b.setAttribute('aria-label', `${QUESTIONS[k]}：${a.card ? `第 ${ROMAN[a.card]} 张` : a.skipped ? '跳过了' : '还没选'}`);
      img.hidden = !a.card;
      if (a.card) { const src = `/app/plates/thumbs/${String(a.card).padStart(2, '0')}.jpg`; if (img.getAttribute('src') !== src) img.src = src; }
      b.querySelector('.num').textContent = a.card ? ROMAN[a.card] : '';
    });
  }

  // ---------- rendering ----------
  const ticks = $('#ticks');
  for (let n = 1; n <= 10; n++) ticks.appendChild(document.createElement('li'));
  function setTool(t) {
    if (S && t !== tool) emit({ type: 'tool', at: clock(), tool: t });
    tool = t;
    document.body.dataset.tool = t;
    document.querySelectorAll('#tools button[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  }
  setTool('hand');
  function renderLedger() {
    const list = (S.responses || []).filter(r => r.card === S.card);
    const box = $('#items');
    const sig = JSON.stringify(list.map(r => [r.id, r.label, r.tidy, r.verbatim, r.strokes?.length, S.focus === r.id]));
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.textContent = '';
    for (const r of list) {
      const li = document.createElement('li');
      li.className = `${r.strokes?.length ? 'circled ' : ''}${S.focus === r.id ? 'focus' : ''}`;
      const plain = t => String(t || '').replace(/[\s,，。.!！?？、:：;；"“”'‘’《》()（）…—-]/g, '');
      const head = r.tidy && plain(r.tidy).length <= plain(r.verbatim).length * 0.7 ? r.tidy : r.label;
      const b = document.createElement('b'); b.textContent = head;
      li.append(b);
      if (plain(head) !== plain(r.verbatim)) { const s = document.createElement('span'); s.textContent = r.verbatim; li.append(s); }
      box.appendChild(li);
    }
  }
  const NEXT_WORD = { intake: '开始看图', inquiry: '下一条', report: '结束', debrief: '结束' };
  let lastStep = '';
  function render() {
    if (!S) return;
    document.body.dataset.phase = S.phase;
    alignDock();
    const seen = S.phase === 'response' ? S.card : 10;
    for (let n = 1; n <= 10; n++) {
      cards[n].el.classList.toggle('future', n > seen || S.phase === 'threshold' || S.phase === 'intake');
      cards[n].el.classList.toggle('current', n === S.card);
      ticks.children[n - 1].className = n === S.card ? 'now' : (S.cards[n]?.endedAt ? 'done' : '');
    }
    $('#numeral').textContent = ROMAN[S.card];
    $('#next').textContent = NEXT_WORD[S.phase] || '下一张';
    renderChoices();
    $('#next').hidden = (S.responseDone && S.phase === 'response') || (S.phase === 'intake' && S.briefing) || !!S.endRequested;
    // A glow belongs to the step it was lit on.
    const step = [S.phase, S.card, S.focus, S.choiceAt].join();
    if (step !== lastStep) { lastStep = step; $('#next').classList.remove('hint'); }
    $('#scoring').hidden = S.phase !== 'scoring';
    $('#scoreProgress').textContent = S.progress || '';
    $('#safety').hidden = !S.paused;
    showNotice();
    renderLedger();
    renderStrokes(S.strokes || []);
    dimStrokes();
    if (S.phase !== 'threshold') $('#threshold').classList.add('gone');
    if (S.phase === 'scoring' && !scoreStarted) { scoreStarted = true; animateBlot(); }
    if (S.reportReady && ['report', 'debrief'].includes(S.phase) && $('#report').hidden) showReport();
  }
  let scoreStarted = false;
  function animateBlot() {
    const pts = (S.strokes || []).flatMap(s => s.pts.filter((_, i) => i % 6 === 0));
    let t = 0;
    const draw = () => {
      if (S.phase !== 'scoring') return;
      window.RorBlot.draw($('#scoreBlot'), { seed: 11 + t * 3, points: pts, grow: Math.min(1, .25 + t * .05), colorful: 2, warm: true });
      t++;
      setTimeout(draw, 2400);
    };
    draw();
  }
  function showReport() {
    const f = $('#report');
    f.src = `/report?k=${K}`;
    f.hidden = false;
    $('#scoring').hidden = true;
  }

  // ---------- what the person needs to know when something upstream stops ----------
  let linkDown = false, sendFailed = false;
  function showNotice() {
    const n = $('#notice');
    n.textContent = linkDown ? '和本机服务的连接断了，正在重连。' : sendFailed ? '刚才那句没有发出去，再按一次回车。' : S?.voice?.mode === 'codex' && S.voice.status === 'redialing' ? '语音断了一下，正在接回来。' : S?.agentStalled ? '主持的 AI 停下了，你说的都还在。回到和它的对话框，说一声「继续」。' : '';
    n.hidden = !n.textContent;
  }
  function dropToText() {
    window.RorVoice.stop();
    document.body.dataset.input = 'text';
    $('#typed').placeholder = '语音断了，打字也一样';
  }
  window.RorVoice.onLost = dropToText;

  // ---------- captions ----------
  let lineTimer;
  const setLine = t => { clearTimeout(lineTimer); const l = $('#line'); if (t) { l.textContent = t; l.classList.add('on'); } else l.classList.remove('on'); };

  // ---------- SSE ----------
  let dialed;
  function connect() {
    const es = new EventSource(`/api/events?k=${K}`);
    es.addEventListener('state', e => {
      const first = !S;
      const prevCard = S?.card, prevPhase = S?.phase;
      S = JSON.parse(e.data);
      render();
      if (S.voice?.mode === 'text' && ['codex', 'local'].includes(window.RorVoice.mode)) dropToText();
      // Read from the state, not told once: this page may have been between connections when the call dropped.
      if (S.voice?.dial !== dialed && S.voice?.mode === 'codex' && window.RorVoice.mode === 'codex' && ['redialing', 'idle'].includes(S.voice.status)) { dialed = S.voice.dial; window.RorVoice.redial(S.voice.name); }
      if (first) onFirstState();
      if (prevPhase !== S.phase) onPhase(S.phase);
      else if (prevCard !== S.card && view !== 'board') { hiRes(S.card); fitCard(S.card); }
    });
    es.addEventListener('card', e => { const { card } = JSON.parse(e.data); endExposure(); hiRes(card); setView('focus'); $('#next').classList.remove('hint'); beginExposure(card, null); });
    es.addEventListener('focus', e => {
      const d = JSON.parse(e.data), c = cards[d.card];
      endExposure();
      hiRes(d.card);
      setView('focus');
      setTool('pen');
      if (norm(c.rot) !== norm(d.deg)) turnTo(d.card, c.rot + ((d.deg - c.rot) % 360 + 540) % 360 - 180, 'system');
      beginExposure(d.card, d.id);
    });
    es.addEventListener('say', e => { const d = JSON.parse(e.data); setLine(d.text); window.RorVoice.onSay(d.id, d.text); });
    // The question asked at the start stays up: it is all there is on the page, and it is waiting for an answer.
    es.addEventListener('said', () => { if (!['intake', 'choices'].includes(S?.phase)) lineTimer = setTimeout(() => setLine(''), 2600); });
    es.addEventListener('partial', e => { $('#live').textContent = JSON.parse(e.data).text; });
    es.addEventListener('hint', () => $('#next').classList.add('hint'));
    es.addEventListener('gate', e => window.RorVoice.setTalk(JSON.parse(e.data).open));
    es.addEventListener('voiceLost', () => { if (!['text', 'external'].includes(window.RorVoice.mode)) dropToText(); });
    es.addEventListener('report', () => { const f = $('#report'); if (!f.hidden) f.src = `/report?k=${K}&v=${Date.now()}`; });
    es.addEventListener('bye', () => { es.close(); clearTimeout(linkTimer); window.RorVoice.stop(); });
    let linkTimer = 0;
    es.onopen = () => { clearTimeout(linkTimer); linkTimer = 0; linkDown = false; showNotice(); };
    es.onerror = () => { linkTimer ||= setTimeout(() => { linkDown = true; showNotice(); }, 4000); };
  }
  function onFirstState() {
    setTool('hand');
    for (let n = 1; n <= 10; n++) { cards[n].rot = cards[n].rest = S.cards[n]?.deg || 0; placeCard(n); }
    emit({ type: 'client.info', at: clock(), viewport: { w: innerWidth, h: innerHeight }, dpr: devicePixelRatio, pointer: matchMedia('(pointer: coarse)').matches ? 'coarse' : matchMedia('(pointer: fine)').matches ? 'fine' : 'none', touch: navigator.maxTouchPoints || 0, userAgent: navigator.userAgent });
    if (S.phase !== 'threshold') beginVoice(true);
    if (S.card) hiRes(S.card);
    onPhase(S.phase);
    jump();
  }
  function onPhase(p) {
    if (p === 'response' || p === 'inquiry') { hiRes(S.card); setView('focus'); setTool(p === 'inquiry' ? 'pen' : 'hand'); beginExposure(S.card, S.focus); }
    else if (p === 'choices') { endExposure(); setTool('hand'); layoutBoard(); setView('board'); beginExposure(null, null); }
    else endExposure();
    if (p === 'debrief') window.RorVoice.setTalk(S.voice.mode === 'codex');
  }
  function layoutBoard() {
    for (let n = 1; n <= 10; n++) { Object.assign(cards[n], { rot: 0, rest: 0, pos: tableSeat(n) }); placeCard(n); }
  }

  // ---------- begin ----------
  async function beginVoice(resuming) {
    window.RorVoice.onSpeech = (on, at) => emit({ type: on ? 'speech.onset' : 'speech.offset', at });
    const res = await window.RorVoice.connect({ mode: S.voice.mode, voiceName: S.voice.status === 'redialing' ? S.voice.name : voiceChoice, localReady: !!S.voice.available?.local, retry: S.voice.status === 'redialing' });
    document.body.dataset.input = res.mode === 'codex' || res.mode === 'local' ? 'voice' : 'text';
    if (res.reason && res.mode === 'text') $('#typed').placeholder = res.reason === 'webrtc_blocked' ? '浏览器禁用了 WebRTC，语音连不上。打字也一样' : '语音没有连上，打字也一样';
    if (res.mode === 'external') $('#orb').hidden = true;
    if (!resuming) await api('/api/begin');
    return res;
  }
  let voiceChoice = 'spruce';
  const VOICES = [['spruce', '沉静'], ['juniper', '明亮'], ['arbor', '随和']];
  function buildVoices() {
    const v = $('#voices'), note = $('#voiceNote');
    const mode = S?.voice.mode;
    if (mode !== 'codex') { v.hidden = true; note.textContent = { local: '声音在本机转写和朗读。', text: '这台电脑暂时用不了语音，可以打字。', external: '声音走 Codex 的语音模式。' }[mode] || ''; return; }
    note.textContent = '声音经由你的 Codex 账号实时对话，语音会发送到 OpenAI。';
    VOICES.forEach(([id, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(id === voiceChoice));
      b.onclick = () => { voiceChoice = id; v.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', 'false')); b.setAttribute('aria-checked', 'true'); };
      v.appendChild(b);
    });
  }
  const EDUCATION = ['初中及以下', '高中或中专', '大专', '本科', '硕士', '博士'];
  let education = null;
  EDUCATION.forEach(label => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
    b.onclick = () => {
      education = education === label ? null : label;
      $('#pEdu').querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x.textContent === education)));
    };
    $('#pEdu').appendChild(b);
  });
  $('#pAge').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '');
    const age = Number(e.target.value);
    $('#pMinor').hidden = !(age > 0 && age < 18);
  });
  $('#begin').onclick = () => {
    $('.door:not(.person)').hidden = true;
    $('#person').hidden = false;
    if (matchMedia('(pointer: fine)').matches) $('#pName').focus();
  };
  $('#person').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#personGo');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '连接中';
    await api('/api/person', { name: $('#pName').value, age: $('#pAge').value, education, occupation: $('#pJob').value });
    try { await beginVoice(false); }
    catch (err) { const box = $('#beginErr'); box.hidden = false; box.textContent = '语音没有连上，你仍然可以打字进行。'; document.body.dataset.input = 'text'; await api('/api/voice/mode', { mode: 'text', reason: err.message }); await api('/api/begin'); }
  });
  $('#next').onclick = () => { $('#next').classList.remove('hint'); endGesture(); clearTimeout(flushTimer); flush(); api('/api/next'); };
  $('#skip').onclick = () => api('/api/choice/skip');
  $('#world').addEventListener('keydown', e => {
    const el = e.target.closest?.('.plate');
    if (!el || S?.phase !== 'choices' || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    e.stopPropagation();
    api('/api/choice', { card: Number(el.dataset.card), via: 'key' });
  });
  $('#resume').onclick = () => api('/api/resume');
  let typedAt = null;
  let typingPing = 0;
  $('#typed').addEventListener('input', e => {
    if (!e.target.value) { typedAt = null; return; }
    if (typedAt == null) typedAt = clock();
    if (Date.now() - typingPing > 2000) { typingPing = Date.now(); api('/api/typing'); }
  });
  let typedSending = false;
  $('#type').addEventListener('submit', async e => {
    e.preventDefault();
    const box = $('#typed'), t = box.value.trim();
    if (!t || typedSending) return;
    typedSending = true;
    // What they wrote stays in the box until the server has it.
    try {
      const r = await api('/api/utter', { text: t, startedAt: typedAt, sentAt: clock() });
      if (r?.error) throw new Error(r.error);
      if (box.value.trim() === t) box.value = '';
      typedAt = null;
      sendFailed = false;
    } catch { sendFailed = true; }
    typedSending = false;
    showNotice();
  });
  $('#kbd').onclick = () => { const t = $('#type'); t.classList.toggle('on'); if (t.classList.contains('on')) $('#typed').focus(); };
  $('#orb').onclick = () => { if (['codex', 'local'].includes(window.RorVoice.mode)) { const muted = window.RorVoice.toggleMute(); $('#orb').classList.toggle('muted', muted); emit({ type: 'mic.mute', at: clock(), muted }); } };

  // ---------- tools ----------
  $('#tools').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool);
    const a = b.dataset.act;
    if (a === 'in') zoomBy(1.3, 'button');
    if (a === 'out') zoomBy(1 / 1.3, 'button');
    if (a === 'fit') fitNow('button');
    if (a === 'board') toggleBoard('button');
    if (a === 'cw') rotateStep(1, 'button');
    if (a === 'ccw') rotateStep(-1, 'button');
    if (a === 'undo') undo();
    if (a === 'redo') redo();
    if (a === 'full') toggleFull();
  });
  const zoomBy = (f, via) => act('zoom', via, () => zoomAt(f, innerWidth / 2, innerHeight / 2));
  const fitNow = via => once('fit', via, () => setView('focus'));
  const toggleBoard = via => once('board', via, () => setView(view === 'board' ? 'focus' : 'board'));
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); };
  function undo() { if (S?.card) api('/api/stroke/undo', { card: S.card }); }
  function redo() { if (S?.card) api('/api/stroke/redo', { card: S.card }); }
  addEventListener('keydown', e => {
    if (e.target.matches('input')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.code === 'Space') { if (!space) { space = true; document.body.dataset.tool = 'hand'; } e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'y')) { e.preventDefault(); if (k === 'y' || e.shiftKey) redo(); else undo(); return; }
    if (e.metaKey || e.ctrlKey) return;
    if (k === 'h') setTool('hand');
    if (k === 'p') setTool('pen');
    if (k === 'e') setTool('erase');
    if (k === 'r') rotateStep(e.shiftKey ? -1 : 1, 'key');
    if (k === 'b') toggleBoard('key');
    if (k === 'f') toggleFull();
    if (k === '0') fitNow('key');
    if (k === '=' || k === '+') zoomBy(1.2, 'key');
    if (k === '-') zoomBy(1 / 1.2, 'key');
    const pan = { arrowleft: [60, 0], arrowright: [-60, 0], arrowup: [0, 60], arrowdown: [0, -60] }[k];
    if (pan && viewable()) { e.preventDefault(); act('pan', 'key', () => { cam.tx += pan[0]; cam.ty += pan[1]; fitted = false; go(); }); }
    if (k === 'm') $('#orb').click();
    if (k === 't') { $('#type').classList.add('on'); $('#typed').focus(); e.preventDefault(); }
    if (k === 'n' && (plateInFocus() || S?.phase === 'choices')) $('#next').click();
  });
  addEventListener('keyup', e => { if (e.code === 'Space') { space = false; document.body.dataset.tool = tool; } });

  // ---------- orb: a small mirrored blot that breathes with whoever is speaking ----------
  const orb = $('#orb canvas'), og = orb.getContext('2d');
  const lobes = [[0, -22, 12], [0, 6, 14], [0, 28, 9], [17, -33, 8], [26, -12, 12], [30, 12, 11], [19, 30, 8], [39, -24, 6]];
  function orbFrame(t) {
    const v = window.RorVoice, lvl = Math.min(1, (v.level || 0) * 2.6), out = Math.min(1, (v.speakingLevel || 0) * 2.4);
    const amp = Math.max(lvl, out);
    og.clearRect(0, 0, 168, 168);
    og.fillStyle = out > lvl && out > .04 ? '#2f4858' : '#1f1b16';
    const breathe = amp ? 0 : Math.sin(t / 1500) * .05;
    lobes.forEach(([x, y, rad], i) => {
      const wob = Math.sin(t / 820 + i * 1.9), wob2 = Math.cos(t / 1040 + i * 1.3);
      const R = rad * (1 + breathe + amp * .55 + wob * (.05 + amp * .22));
      const X = x * (1 + amp * .5) + wob2 * (2 + amp * 5), Y = y * (1 + amp * .16) + wob * (2 + amp * 3);
      for (const m of x ? [-1, 1] : [1]) { og.beginPath(); og.arc(84 + m * X, 84 + Y, R * 1.05, 0, 7); og.fill(); }
    });
    requestAnimationFrame(orbFrame);
  }
  requestAnimationFrame(orbFrame);

  // ---------- boot ----------
  window.RorBlot.draw($('#doorBlot'), { seed: 7, colorful: 2, warm: true });
  fetch('/api/state', { headers: { 'x-ror-key': K } }).then(r => r.json()).then(s => { S = s; voiceChoice = s.voice?.name || voiceChoice; $('#pName').value = s.name || ''; buildVoices(); S = null; connect(); });
  applyCam();
  // Test hook: lets automated checks read the camera without touching the app.
  window.__ror = { cam, cards, get state() { return S; }, setTool, viewState, flush: () => { endGesture(); return flush(); } };
})();
