/* ==========================================================
   AUDIO — WebAudio synth (no external assets).

   - engine: looping rumble (osc + filtered noise), volume = intensity
   - snap:   short click for part placement
   - launch: noise + falling sweep
   - explosion: low-pass noise burst
   - win:    rising chord
   ========================================================== */
(function (global) {
  'use strict';

  let ctx = null;
  let master = null;
  let engineNodes = null;
  let engineGain = 0;        // smoothed
  let engineTarget = 0;
  let engineRamp = null;
  let initialized = false;
  let muted = false;

  function ensureCtx() {
    if (initialized) return ctx;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
      initialized = true;
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  // ----- helpers -------------------------------------------------------------
  function noiseBuffer(durationSec) {
    const c = ensureCtx();
    if (!c) return null;
    const n = Math.floor(c.sampleRate * durationSec);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function envGain(start, attack, decay, peak, sustain) {
    const c = ensureCtx();
    if (!c) return null;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + attack + decay);
    return g;
  }

  // ----- engine loop ---------------------------------------------------------
  function startEngine() {
    const c = ensureCtx();
    if (!c) return;
    if (engineNodes) return;

    // low oscillator
    const osc1 = c.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 60;

    const osc2 = c.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 90;

    const oscGain = c.createGain();
    oscGain.gain.value = 0.0;

    osc1.connect(oscGain);
    osc2.connect(oscGain);

    // noise layer
    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer(2);
    noise.loop = true;
    const noiseFilt = c.createBiquadFilter();
    noiseFilt.type = 'lowpass';
    noiseFilt.frequency.value = 350;
    const noiseGain = c.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilt);
    noiseFilt.connect(noiseGain);

    const mix = c.createGain();
    mix.gain.value = 1.0;
    oscGain.connect(mix);
    noiseGain.connect(mix);
    mix.connect(master);

    osc1.start();
    osc2.start();
    noise.start();

    engineNodes = { osc1, osc2, oscGain, noise, noiseGain, mix };
    engineGain = 0;
    engineTarget = 0;

    if (engineRamp) cancelAnimationFrame(engineRamp);
    rampLoop();
  }

  function rampLoop() {
    if (!engineNodes) return;
    engineGain += (engineTarget - engineGain) * 0.1;
    const g = Math.max(0, Math.min(1, engineGain));
    engineNodes.oscGain.gain.value = g * 0.18;
    engineNodes.noiseGain.gain.value = g * 0.22;
    // pitch up slightly with intensity
    engineNodes.osc1.frequency.value = 50 + g * 30;
    engineNodes.osc2.frequency.value = 80 + g * 50;
    engineRamp = requestAnimationFrame(rampLoop);
  }

  function stopEngine() {
    if (!engineNodes) return;
    const c = ctx;
    const t = c.currentTime;
    engineNodes.mix.gain.setTargetAtTime(0.0001, t, 0.05);
    const old = engineNodes;
    engineNodes = null;
    if (engineRamp) cancelAnimationFrame(engineRamp);
    setTimeout(() => {
      try {
        old.osc1.stop(); old.osc2.stop(); old.noise.stop();
      } catch (e) {}
    }, 200);
  }

  function setEngineIntensity(v) {
    engineTarget = Math.max(0, Math.min(1, v));
  }

  // ----- one-shots -----------------------------------------------------------
  function play(name) {
    const c = ensureCtx();
    if (!c || muted) return;
    if (name === 'snap') return playSnap();
    if (name === 'launch') return playLaunch();
    if (name === 'explosion') return playExplosion();
    if (name === 'win') return playWin();
    if (name === 'click') return playClick();
  }

  function playSnap() {
    const c = ctx;
    const t = c.currentTime;
    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer(0.05);
    const filt = c.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 1500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    noise.connect(filt); filt.connect(g); g.connect(master);
    noise.start(t); noise.stop(t + 0.06);
  }

  function playClick() { playSnap(); }

  function playLaunch() {
    const c = ctx;
    const t = c.currentTime;
    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer(0.8);
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(2000, t);
    filt.frequency.exponentialRampToValueAtTime(300, t + 0.7);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.7);
    noise.connect(filt); filt.connect(g); g.connect(master);
    noise.start(t); noise.stop(t + 0.8);

    // boomy thud
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    const og = c.createGain();
    og.gain.setValueAtTime(0.4, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(og); og.connect(master);
    osc.start(t); osc.stop(t + 0.4);
  }

  function playExplosion() {
    const c = ctx;
    const t = c.currentTime;
    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer(1.2);
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(900, t);
    filt.frequency.exponentialRampToValueAtTime(120, t + 1.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    noise.connect(filt); filt.connect(g); g.connect(master);
    noise.start(t); noise.stop(t + 1.2);

    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.exponentialRampToValueAtTime(20, t + 0.6);
    const og = c.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(og); og.connect(master);
    osc.start(t); osc.stop(t + 0.6);
  }

  function playWin() {
    const c = ctx;
    const t = c.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = c.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const g = c.createGain();
      const start = t + i * 0.08;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
      osc.connect(g); g.connect(master);
      osc.start(start); osc.stop(start + 0.4);
    });
  }

  // resume context on first interaction (browser autoplay policy)
  function unlock() {
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume();
  }
  ['click', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, unlock, { once: false, passive: true })
  );

  global.Sfx = {
    play,
    startEngine,
    stopEngine,
    setEngineIntensity,
    setMuted: (m) => { muted = m; if (master) master.gain.value = m ? 0 : 0.6; },
  };
})(window);
