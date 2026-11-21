// Audio engine: 3D placement around you (HRTF), distance muffling, stadium echo, crowd.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.9;
  }

  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    // Ask iPhone to treat this as playback audio so the silent switch doesn't mute it.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }

    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.ratio.value = 4;
    this.comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.comp);

    // Stadium echo.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.8, 2.6);
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.55;
    this.reverb.connect(this.reverbOut);
    this.reverbOut.connect(this.master);

    // Shared white noise.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._startCrowd();

    // Unlock on iOS: play a silent buffer inside the tap.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);

    if (ctx.state === 'suspended') await ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  get now() { return this.ctx.currentTime; }

  suspend() { if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume(); }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        ch[i] = (i < ctx.sampleRate * 0.02 ? 0 : (Math.random() * 2 - 1)) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  // The crowd: two bands of noise with a slow swell, always running under the game.
  _startCrowd() {
    const ctx = this.ctx;
    this.crowd = ctx.createGain();
    this.crowd.gain.value = 0.0001;
    const mk = (freq, q, g) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const gg = ctx.createGain(); gg.gain.value = g;
      src.connect(f); f.connect(gg); gg.connect(this.crowd);
      src.start(0, Math.random());
    };
    mk(450, 0.6, 0.9);
    mk(1300, 0.9, 0.45);
    // Slow murmur movement.
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.15;
    const wob = ctx.createGain(); wob.gain.value = 1;
    lfo.connect(lfoG); lfoG.connect(wob.gain); lfo.start();
    this.crowd.connect(wob);
    wob.connect(this.master);
    wob.connect(this.reverb);
  }

  // level: 0 (quiet) to 1 (roaring).
  setCrowd(level, seconds = 0.6) {
    if (!this.crowd) return;
    const t = this.ctx.currentTime;
    this.crowd.gain.cancelScheduledValues(t);
    this.crowd.gain.setTargetAtTime(Math.max(0.0001, 0.03 + level * 0.32), t, seconds / 3);
  }

  // A sound source on the field. right and forward are yards from where you stand,
  // relative to the way you are facing.
  createVoice(right = 0, forward = 10, loud = 1) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    input.gain.value = loud;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.rolloffFactor = 0; // loudness is set below
    panner.refDistance = 1;
    panner.maxDistance = 10000;
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    input.connect(filter);
    filter.connect(panner);
    panner.connect(dry);
    panner.connect(wet);
    dry.connect(this.master);
    wet.connect(this.reverb);
    const voice = { input, filter, panner, dry, wet, disposed: false };
    this.placeVoice(voice, right, forward, true);
    return voice;
  }

  placeVoice(voice, right, forward, instant = false) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const d = Math.hypot(right, forward);
    // Direction only; loudness is handled by our own curve.
    const n = d > 0.01 ? 1 / d : 0;
    const x = right * n, z = -(forward * n) || -0.0001;
    const p = voice.panner;
    if (p.positionX) {
      if (instant) { p.positionX.value = x; p.positionY.value = 0; p.positionZ.value = z; }
      else {
        p.positionX.setTargetAtTime(x, t, 0.03);
        p.positionY.setTargetAtTime(0, t, 0.03);
        p.positionZ.setTargetAtTime(z, t, 0.03);
      }
    } else {
      p.setPosition(x, 0, z);
    }
    const gain = 1 / (1 + d / 4.5);
    const cutoff = 1500 + 15000 * Math.exp(-d / 14);
    const wet = 0.05 + 0.45 * Math.min(1, d / 40);
    const set = (param, v) => instant ? (param.value = v) : param.setTargetAtTime(v, t, 0.04);
    set(voice.dry.gain, gain);
    set(voice.wet.gain, gain * wet + 0.01);
    set(voice.filter.frequency, cutoff);
  }

  disposeVoice(voice, delay = 1.5) {
    if (!voice || voice.disposed) return;
    voice.disposed = true;
    setTimeout(() => {
      try { voice.input.disconnect(); voice.filter.disconnect(); voice.panner.disconnect(); voice.dry.disconnect(); voice.wet.disconnect(); } catch (e) { /* already gone */ }
    }, delay * 1000);
  }

  // A sound that is not placed on the field: your own body, menus. pan -1 (left) to 1 (right).
  createNear(pan = 0, gain = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.master);
      g.pan = p;
    } else {
      g.connect(this.master);
    }
    return g;
  }
}
