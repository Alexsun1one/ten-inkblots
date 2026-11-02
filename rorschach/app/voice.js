// Voice for the session page. Backends: codex (WebRTC realtime), local (whisper + system speech), text.
(() => {
  const K = window.ROR_KEY;
  const api = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ror-key': K }, body: JSON.stringify(b || {}) }).then(r => r.json());
  const V = window.RorVoice = { mode: 'text', muted: false, level: 0, speakingLevel: 0, speaking: false, onStatus: () => {}, onSpeech: () => {}, onLost: () => {} };
  const clock = () => performance.timeOrigin + performance.now();
  let micStream, micAnalyser, outAnalyser, ctx, pc, dc, audioEl;
  let pendingSay = false, talk = false, gateTarget = 0, closing = false, quietSince = 0;
  let inCall = false, lostTimer = 0, localNode = null;
  // The examiner's voice is audible only while it is reading a line we gave it.
  const gate = on => { gateTarget = on ? 1 : 0; closing = false; if (audioEl) audioEl.volume = gateTarget; };

  const peak = (an, buf) => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); return m / 128; };
  function meters() {
    const buf = new Uint8Array(1024);
    // A timer, not rAF: the gate and the onset clock keep running while the tab is in the background.
    setInterval(() => {
      if (micAnalyser) V.level = V.level * .7 + (V.muted ? 0 : peak(micAnalyser, buf)) * .3;
      const out = outAnalyser ? peak(outAnalyser, buf) : 0;
      V.speakingLevel = V.speakingLevel * .7 + (gateTarget ? out : 0) * .3;
      voiceActivity();
      // "Done" means generated, not played: let the line finish before closing.
      if (closing) {
        if (out > .012) quietSince = 0;
        else if (!quietSince) quietSince = clock();
        else if (clock() - quietSince > 300) gate(false);
      }
    }, 33);
  }

  // Speech onset for reaction time: a level crossing held for 100ms, against a noise floor that adapts.
  let talking = false, crossedAt = 0, quietAt = 0, noise = .012;
  function voiceActivity() {
    if (V.muted || vadOff) { if (talking) { talking = false; V.onSpeech(false, clock()); } crossedAt = quietAt = 0; return; }
    const now = clock(), l = V.level;
    if (!talking) noise = noise * .995 + Math.min(l, .12) * .005;
    const up = Math.max(.05, noise * 3), down = up * .5;
    if (!talking) {
      if (l <= up) { crossedAt = 0; return; }
      crossedAt ||= now;
      if (now - crossedAt >= 100) { talking = true; quietAt = 0; V.onSpeech(true, crossedAt); }
      return;
    }
    if (l >= down) { quietAt = 0; return; }
    quietAt ||= now;
    if (now - quietAt >= 450) { talking = false; crossedAt = 0; V.onSpeech(false, quietAt); }
  }

  async function mic() {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    // After a refresh there may be no gesture yet, and this would wait for one. The call itself does not need it.
    ctx.resume().catch(() => {});
    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 1024;
    ctx.createMediaStreamSource(micStream).connect(micAnalyser);
  }

  async function connectRealtime(voiceName) {
    // Privacy extensions blank this out on every page. Respect that: say so, don't work around it.
    if (typeof RTCPeerConnection !== 'function') return { error: 'webrtc_blocked' };
    pc = new RTCPeerConnection();
    micStream.getAudioTracks().forEach(t => pc.addTrack(t, micStream));
    audioEl = new Audio();
    audioEl.autoplay = true;
    audioEl.volume = 0;
    pc.ontrack = e => {
      audioEl.srcObject = e.streams[0];
      audioEl.play().catch(() => {});
      outAnalyser = ctx.createAnalyser();
      outAnalyser.fftSize = 1024;
      ctx.createMediaStreamSource(e.streams[0]).connect(outAnalyser);
    };
    dc = pc.createDataChannel('oai-events');
    dc.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'turn.created' && m.turn?.role === 'assistant' && (pendingSay || talk)) { pendingSay = false; gate(true); V.speaking = true; }
      else if (m.type === 'turn.done' && gateTarget && (m.turn?.role === 'assistant' || !m.turn?.role)) { V.speaking = false; if (!talk) { closing = true; quietSince = 0; } }
    };
    // "Disconnected" often heals on its own, so it gets a moment. "Failed" does not.
    pc.onconnectionstatechange = () => {
      clearTimeout(lostTimer);
      if (!inCall) return;
      if (pc?.connectionState === 'failed') lost('webrtc_failed');
      else if (pc?.connectionState === 'disconnected') lostTimer = setTimeout(() => lost('webrtc_disconnected'), 5000);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise(r => { if (pc.iceGatheringState === 'complete') return r(); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r(); setTimeout(r, 1800); });
    const res = await api('/api/voice/offer', { sdp: pc.localDescription.sdp, voice: voiceName });
    if (res.error) { pc.close(); pc = null; return res; }
    await pc.setRemoteDescription({ type: 'answer', sdp: res.sdp });
    // A line sent before audio flows is never spoken, so "connected" has to mean connected.
    const up = await new Promise(r => {
      const check = () => { if (pc.connectionState === 'failed') r(false); else if (pc.connectionState === 'connected' && dc.readyState === 'open') r(true); };
      pc.addEventListener('connectionstatechange', check);
      dc.addEventListener('open', check);
      setTimeout(() => r(false), 15000);
      check();
    });
    if (!up) { pc.close(); pc = null; return { error: 'webrtc_timeout' }; }
    inCall = true;
    if (talk) gate(true);
    await api('/api/voice/up').catch(() => {});
    return { ok: true };
  }
  const hangUp = () => {
    inCall = false; pendingSay = false;
    clearTimeout(lostTimer);
    gate(false);
    try { dc?.close(); pc?.close(); } catch { /* already closed */ }
    pc = dc = null;
    if (audioEl) audioEl.srcObject = null;
    outAnalyser = null;
  };
  // The server decides: a new call, or typing if it has tried enough.
  function lost(reason) {
    if (V.mode !== 'codex') return;
    api('/api/voice/redial', { reason }).catch(() => { V.stop(); V.onLost(reason); });
  }
  // A new call on the same microphone.
  let redialing = false;
  V.redial = async voiceName => {
    if (V.mode !== 'codex' || redialing) return;
    redialing = true;
    let r = {};
    for (let i = 0; i < 3 && V.mode === 'codex'; i++) {
      if (i) await new Promise(done => setTimeout(done, 3000));
      hangUp();
      r = await connectRealtime(voiceName).catch(e => ({ error: e.message }));
      if (!r.error) break;
    }
    redialing = false;
    if (!r.error || V.mode !== 'codex') return;
    V.stop();
    api('/api/voice/mode', { mode: 'text', status: 'lost', reason: r.error }).catch(() => {});
    V.onLost(r.error);
  };

  // ---------- local fallback: energy VAD → whisper; system speech for the examiner ----------
  let vadOff = false;
  function startLocal() {
    const node = localNode = ctx.createScriptProcessor(4096, 1, 1);
    const src = ctx.createMediaStreamSource(micStream);
    const zero = ctx.createGain(); zero.gain.value = 0;
    src.connect(node); node.connect(zero); zero.connect(ctx.destination);
    const rate = ctx.sampleRate, ratio = rate / 16000;
    let speech = [], pre = [], hang = 0, active = false, floor = .012;
    node.onaudioprocess = e => {
      if (V.muted || vadOff) { active = false; speech = []; return; }
      const d = e.inputBuffer.getChannelData(0);
      const out = new Float32Array(Math.floor(d.length / ratio));
      for (let i = 0; i < out.length; i++) out[i] = d[Math.floor(i * ratio)];
      const rms = Math.sqrt(out.reduce((s, v) => s + v * v, 0) / out.length);
      if (!active) floor = floor * .995 + Math.min(rms, .05) * .005;
      const loud = rms > Math.max(.018, floor * 2.6);
      if (loud) { if (!active) { active = true; speech = pre.slice(); V.onStatus('hearing'); } hang = 0; }
      if (active) {
        speech.push(out);
        if (!loud && ++hang > (900 / (out.length / 16))) {
          active = false;
          const len = speech.reduce((s, a) => s + a.length, 0);
          if (len > 16000 * .35) sendWav(speech, len);
          speech = [];
          V.onStatus('idle');
        }
      } else { pre.push(out); if (pre.length > 2) pre.shift(); }
    };
  }
  function sendWav(chunks, len) {
    const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
    let o = 44; for (const c of chunks) for (const x of c) { v.setInt16(o, Math.max(-1, Math.min(1, x)) * 32767, true); o += 2; }
    fetch('/api/stt', { method: 'POST', headers: { 'x-ror-key': K, 'content-type': 'audio/wav' }, body: buf }).catch(() => {});
  }
  function systemSpeak(id, text) {
    // No speech available: the line is on screen, so give it the time it takes to read.
    const timed = () => setTimeout(() => api('/api/said', { id }), Math.min(9000, 800 + text.length * 170));
    if (!('speechSynthesis' in window)) { timed(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = .92; u.pitch = 1;
    const zh = speechSynthesis.getVoices().find(x => /zh[-_]CN/i.test(x.lang) && /Tingting|婷婷/i.test(x.name)) || speechSynthesis.getVoices().find(x => /zh/i.test(x.lang));
    if (zh) u.voice = zh;
    vadOff = true; V.speaking = true;
    const done = () => { vadOff = false; V.speaking = false; api('/api/said', { id }); };
    const failed = () => { vadOff = false; V.speaking = false; timed(); };
    const began = clock();
    // Some browsers have no engine and report "ended" straight away.
    u.onend = () => (clock() - began < 400 ? failed() : done());
    u.onerror = failed;
    speechSynthesis.speak(u);
  }

  const wake = () => { if (ctx?.state === 'suspended') ctx.resume().catch(() => {}); if (audioEl?.paused && audioEl.srcObject) audioEl.play().catch(() => {}); };
  addEventListener('pointerdown', wake, true);
  addEventListener('keydown', wake, true);

  V.connect = async ({ mode, voiceName, localReady, retry }) => {
    if (mode === 'external') { V.mode = 'external'; return { mode: 'external' }; }
    if (mode === 'text') { V.mode = 'text'; return { mode: 'text' }; }
    try { await mic(); } catch (e) {
      V.mode = 'text';
      await api('/api/voice/mode', { mode: 'text', reason: `mic: ${e.name}` });
      return { mode: 'text', reason: 'mic' };
    }
    meters();
    let m = mode, reason = null;
    if (m === 'codex') {
      let r = await connectRealtime(voiceName).catch(e => ({ error: e.message }));
      // A page opened while a dropped call is being replaced gets the tries the old page would have had.
      for (let i = 0; retry && r.error && r.error !== 'webrtc_blocked' && i < 2; i++) {
        await new Promise(done => setTimeout(done, 3000));
        hangUp();
        r = await connectRealtime(voiceName).catch(e => ({ error: e.message }));
      }
      if (r.error) {
        // Whatever the cause, the server and the record must know the voice did not come up.
        m = r.fallback && r.fallback !== 'codex' ? r.fallback : localReady ? 'local' : 'text';
        reason = r.error;
        await api('/api/voice/mode', { mode: m, status: 'failed', reason });
      }
    }
    if (m === 'local') startLocal();
    if (m === 'text') micStream?.getTracks().forEach(t => t.stop());
    V.mode = m;
    return { mode: m, reason };
  };
  V.onSay = (id, text) => {
    if (V.mode === 'codex') pendingSay = true;
    else if (V.mode === 'local') systemSpeak(id, text);
  };
  V.setTalk = on => { talk = on; gate(on); };
  // Nothing keeps listening after this: not the microphone, not the call.
  V.stop = () => {
    talk = false;
    hangUp();
    if (localNode) { localNode.onaudioprocess = null; localNode.disconnect(); localNode = null; }
    micStream?.getTracks().forEach(t => t.stop());
    micStream = micAnalyser = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    Object.assign(V, { mode: 'text', level: 0, speakingLevel: 0, speaking: false });
  };
  V.toggleMute = () => { V.muted = !V.muted; micStream?.getAudioTracks().forEach(t => { t.enabled = !V.muted; }); return V.muted; };
})();
