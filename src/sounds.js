// Every sound effect, synthesized in code.
// Each function takes the engine, a destination node and a start time.

const rand = (a, b) => a + Math.random() * (b - a);

function envGain(ctx, dest, t, { attack = 0.003, dur = 0.1, peak = 1 }) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  g.connect(dest);
  return g;
}

function noise(e, dest, t, { type = 'bandpass', freq = 1000, freqEnd = null, q = 1, dur = 0.1, gain = 0.5, attack = 0.002 }) {
  const ctx = e.ctx;
  const src = ctx.createBufferSource();
  src.buffer = e.noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + dur);
  f.Q.value = q;
  const g = envGain(ctx, dest, t, { attack, dur, peak: gain });
  src.connect(f); f.connect(g);
  src.start(t, Math.random() * 1.5);
  src.stop(t + attack + dur + 0.05);
}

function tone(e, dest, t, { type = 'sine', freq = 440, freqEnd = null, dur = 0.2, gain = 0.3, attack = 0.003, filter = null }) {
  const ctx = e.ctx;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + dur);
  const g = envGain(ctx, dest, t, { attack, dur, peak: gain });
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter.type || 'lowpass';
    f.frequency.value = filter.freq;
    f.Q.value = filter.q || 0.7;
    o.connect(f); f.connect(g);
  } else {
    o.connect(g);
  }
  o.start(t);
  o.stop(t + attack + dur + 0.05);
  return o;
}

// ---------- Bodies on the field ----------

// Cleats on turf. Defenders are heavier and lower than your own steps.
export function footstep(e, dest, t, weight = 1) {
  noise(e, dest, t, { freq: rand(500, 900) / weight, q: 1.4, dur: 0.05, gain: 0.55 * weight });
  tone(e, dest, t, { freq: 110 / weight, freqEnd: 50, dur: 0.06, gain: 0.35 * weight });
}

export function myStep(e, dest, t) {
  noise(e, dest, t, { freq: rand(1400, 2000), q: 1.6, dur: 0.035, gain: 0.18 });
}

// Pads cracking together: blockers and defenders fighting at the line.
export function padClash(e, dest, t, gain = 0.8) {
  noise(e, dest, t, { type: 'lowpass', freq: 1800, freqEnd: 400, dur: 0.09, gain });
  tone(e, dest, t, { freq: 95, freqEnd: 55, dur: 0.12, gain: gain * 0.7 });
  noise(e, dest, t + 0.01, { freq: 3200, q: 3, dur: 0.03, gain: gain * 0.35 });
}

// A short effort grunt.
export function grunt(e, dest, t, pitch = 1, gain = 0.4) {
  tone(e, dest, t, { type: 'sawtooth', freq: 130 * pitch, freqEnd: 95 * pitch, dur: 0.14, gain, attack: 0.02, filter: { type: 'bandpass', freq: 650, q: 2.5 } });
}

// A defender bearing down on you: heavy breathing and rattling gear, the moment to make a move.
export function closing(e, dest, t) {
  grunt(e, dest, t, rand(0.85, 1.05), 0.55);
  noise(e, dest, t, { freq: 2600, q: 2, dur: 0.12, gain: 0.3 });
}

// ---------- Your moves ----------

export function cut(e, dest, t) {
  // Sneaker squeak on the cut.
  tone(e, dest, t, { type: 'square', freq: 2200, freqEnd: 3200, dur: 0.07, gain: 0.08, filter: { type: 'bandpass', freq: 2800, q: 4 } });
}

export function juke(e, dest, t) {
  noise(e, dest, t, { freq: 1200, freqEnd: 3000, q: 1, dur: 0.18, gain: 0.35, attack: 0.03 });
  tone(e, dest, t, { type: 'square', freq: 2600, freqEnd: 1900, dur: 0.09, gain: 0.07, filter: { type: 'bandpass', freq: 2400, q: 4 } });
}

export function burst(e, dest, t) {
  noise(e, dest, t, { freq: 700, freqEnd: 1600, q: 0.8, dur: 0.4, gain: 0.3, attack: 0.08 });
  tone(e, dest, t, { freq: 300, freqEnd: 600, dur: 0.35, gain: 0.12, attack: 0.05 });
}

// The move isn't ready, or already used.
export function notReady(e, dest, t) {
  tone(e, dest, t, { type: 'triangle', freq: 160, dur: 0.1, gain: 0.25 });
}

// Defender missed you.
export function whiff(e, dest, t) {
  noise(e, dest, t, { freq: 900, freqEnd: 300, q: 0.8, dur: 0.25, gain: 0.45, attack: 0.02 });
  tone(e, dest, t + 0.18, { freq: 80, freqEnd: 40, dur: 0.15, gain: 0.4 }); // he hits the turf
}

// Bouncing off a tackle.
export function broken(e, dest, t) {
  padClash(e, dest, t, 0.9);
  grunt(e, dest, t + 0.03, 0.9, 0.5);
}

export function tackled(e, dest, t) {
  padClash(e, dest, t, 1.1);
  padClash(e, dest, t + 0.07, 0.6);
  tone(e, dest, t + 0.1, { freq: 70, freqEnd: 35, dur: 0.3, gain: 0.7 }); // hitting the ground
}

// ---------- The ball and the referee ----------

export function whistle(e, dest, t, long = false) {
  const ctx = e.ctx;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = 2900;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 32;
  const lg = ctx.createGain(); lg.gain.value = 140;
  lfo.connect(lg); lg.connect(o.frequency);
  const dur = long ? 0.7 : 0.4;
  const g = envGain(ctx, dest, t, { attack: 0.01, dur, peak: 0.16 });
  o.connect(g);
  o.start(t); lfo.start(t);
  o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
}

// Quarterback's cadence: one short call.
export function hut(e, dest, t, gain = 0.5) {
  tone(e, dest, t, { type: 'sawtooth', freq: 180, freqEnd: 150, dur: 0.12, gain, attack: 0.01, filter: { type: 'bandpass', freq: 900, q: 3 } });
  noise(e, dest, t, { freq: 2500, q: 2, dur: 0.04, gain: gain * 0.3 });
}

export function snap(e, dest, t) {
  tone(e, dest, t, { freq: 140, freqEnd: 70, dur: 0.08, gain: 0.5 });
  noise(e, dest, t, { type: 'lowpass', freq: 900, dur: 0.05, gain: 0.4 });
}

export function handoff(e, dest, t) {
  tone(e, dest, t, { freq: 180, freqEnd: 90, dur: 0.07, gain: 0.5 });
  noise(e, dest, t, { freq: 700, q: 1, dur: 0.05, gain: 0.3 });
}

export function throwBall(e, dest, t) {
  noise(e, dest, t, { freq: 600, freqEnd: 1800, q: 1.2, dur: 0.15, gain: 0.45, attack: 0.02 });
}

export function catchBall(e, dest, t) {
  tone(e, dest, t, { freq: 220, freqEnd: 110, dur: 0.07, gain: 0.7 });
  noise(e, dest, t, { type: 'lowpass', freq: 1500, dur: 0.05, gain: 0.5 });
}

// Ball hitting the turf and bouncing.
export function incomplete(e, dest, t) {
  tone(e, dest, t, { freq: 160, freqEnd: 80, dur: 0.08, gain: 0.55 });
  tone(e, dest, t + 0.24, { freq: 180, freqEnd: 90, dur: 0.06, gain: 0.3 });
  tone(e, dest, t + 0.38, { freq: 200, freqEnd: 100, dur: 0.05, gain: 0.15 });
}

export function kick(e, dest, t) {
  tone(e, dest, t, { freq: 120, freqEnd: 60, dur: 0.12, gain: 0.9 });
  noise(e, dest, t, { type: 'lowpass', freq: 1200, freqEnd: 200, dur: 0.08, gain: 0.7 });
}

// A receiver who has gotten open: a short tone from his direction.
// Each receiver has his own pitch: left lowest, middle in between, right highest.
export const RECEIVER_PITCH = [520, 700, 940];
export function open(e, dest, t, i) {
  const f = RECEIVER_PITCH[i];
  tone(e, dest, t, { type: 'triangle', freq: f, dur: 0.09, gain: 0.7 });
  tone(e, dest, t + 0.11, { type: 'triangle', freq: f * 1.25, dur: 0.09, gain: 0.7 });
}

// The ball carrier you are chasing on defense: quick, bright cleats you can pick out.
export function carrierStep(e, dest, t) {
  noise(e, dest, t, { freq: rand(1100, 1500), q: 2, dur: 0.05, gain: 0.8 });
  tone(e, dest, t, { freq: 150, freqEnd: 70, dur: 0.06, gain: 0.5 });
}

// Where a thrown ball will land. Higher pitch when you are lined up under it.
export function beacon(e, dest, t, aligned) {
  tone(e, dest, t, { type: 'square', freq: aligned ? 1320 : 760, dur: 0.04, gain: 0.22, filter: { freq: 3000 } });
}

// The ball leaving the quarterback's hand, sweeping toward where it is headed.
export function thrownToward(e, dest, t) {
  tone(e, dest, t, { freq: 500, freqEnd: 1100, dur: 0.25, gain: 0.45 });
}

// The ball in the air: a rushing spiral, played through a moving voice.
export function ballFlight(e, dest, t, dur) {
  const ctx = e.ctx;
  const src = ctx.createBufferSource();
  src.buffer = e.noise; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.08);
  g.gain.setValueAtTime(0.5, t + dur - 0.05);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  // Spiral flutter.
  const lfo = ctx.createOscillator(); lfo.frequency.value = 14;
  const lg = ctx.createGain(); lg.gain.value = 300;
  lfo.connect(lg); lg.connect(f.frequency);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t); lfo.start(t);
  src.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
}

// ---------- Cues ----------

// You are close enough to make the tackle.
export function inRange(e, dest, t) {
  tone(e, dest, t, { type: 'square', freq: 1500, dur: 0.03, gain: 0.12 });
  tone(e, dest, t + 0.06, { type: 'square', freq: 1500, dur: 0.03, gain: 0.12 });
}

// The sideline is close on that side.
export function sideline(e, dest, t) {
  tone(e, dest, t, { type: 'triangle', freq: 1900, dur: 0.035, gain: 0.25 });
}

// Soft blip pointing toward open field.
export function lane(e, dest, t) {
  tone(e, dest, t, { freq: 1240, dur: 0.06, gain: 0.12 });
}

export function horn(e, dest, t) {
  for (const f of [233, 294, 349]) {
    tone(e, dest, t, { type: 'sawtooth', freq: f, dur: 1.2, gain: 0.12, attack: 0.03, filter: { freq: 1600 } });
  }
}

export function menuTick(e, dest, t) {
  tone(e, dest, t, { freq: 900, dur: 0.025, gain: 0.08 });
}

export function sackCrash(e, dest, t) {
  padClash(e, dest, t, 1.2);
  padClash(e, dest, t + 0.06, 0.9);
  grunt(e, dest, t + 0.04, 0.8, 0.6);
  tone(e, dest, t + 0.12, { freq: 60, freqEnd: 30, dur: 0.35, gain: 0.8 });
}
