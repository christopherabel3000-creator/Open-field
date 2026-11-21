// Screens, the huddle, running each snap, sound placement and commentary.

import { AudioEngine } from './audio.js';
import { Speaker } from './speech.js';
import { Input } from './input.js';
import { RunPlay, PassPlay, DefensePlay, planOffense, SIDELINE } from './engine.js';
import { Game, OFFENSE_PLAYS, DEFENSE_CALLS, fgDistance, clockText } from './rules.js';
import * as S from './sounds.js';

const SAVE_KEY = 'open-field-v1';
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);

const defaults = { voice: 'game', rate: 1.2, quarter: 5, difficulty: 'normal', volume: 90, laneHint: true };
function loadSettings() {
  try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}').settings || {}); }
  catch (e) { return { ...defaults }; }
}
function saveSettings() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ settings })); } catch (e) { /* storage unavailable */ }
}
const settings = loadSettings();

const engine = new AudioEngine();
const speaker = new Speaker($('live'));
const field = $('field');
const input = new Input(field, onAction);

function applySettings() {
  speaker.mode = settings.voice;
  speaker.rate = Number(settings.rate);
  engine.setVolume(settings.volume / 100);
}
applySettings();

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + id;
  const scr = $('screen-' + id);
  const h = scr.querySelector('h1, h2');
  if (id === 'game') field.focus();
  else if (h) h.focus();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b) show(b.dataset.go);
});

$('new-game').addEventListener('click', startGame);
$('again').addEventListener('click', startGame);

// Settings screen.
function fillSettings() {
  for (const r of document.querySelectorAll('input[name=voice]')) r.checked = r.value === settings.voice;
  $('set-rate').value = String(settings.rate);
  $('set-quarter').value = String(settings.quarter);
  $('set-difficulty').value = settings.difficulty;
  $('set-volume').value = settings.volume;
  $('set-lane').checked = !!settings.laneHint;
}
fillSettings();
document.querySelectorAll('input[name=voice]').forEach(r => r.addEventListener('change', () => { settings.voice = r.value; applySettings(); saveSettings(); }));
$('set-rate').addEventListener('change', (e) => { settings.rate = Number(e.target.value); applySettings(); saveSettings(); });
$('set-quarter').addEventListener('change', (e) => { settings.quarter = Number(e.target.value); saveSettings(); });
$('set-difficulty').addEventListener('change', (e) => { settings.difficulty = e.target.value; saveSettings(); });
$('set-volume').addEventListener('input', (e) => { settings.volume = Number(e.target.value); applySettings(); saveSettings(); });
$('set-lane').addEventListener('change', (e) => { settings.laneHint = e.target.checked; saveSettings(); });

// Pause menu.
$('pause-resume').addEventListener('click', () => togglePause(false));
$('pause-quit').addEventListener('click', () => { quitGame(); show('title'); });

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

let game = null;
let mode = 'idle';        // idle, huddle, cadence, play, wait, paused, over
let modeBefore = null;
let menu = null;          // { kind, items, index }
const lastPick = {};      // remembered cursor per menu kind
let play = null;          // the running play engine
let playInfo = null;      // { kind: 'run'|'pass'|'defense', call, choice, plan, twoPoint }
let ignoreUntil = 0;
let rafId = 0;
let lastFrame = 0;
let note = [];            // commentary waiting to be spoken with the next huddle
let cpuChoice = null;     // what the computer's offense will do this snap
let timers = [];

function later(ms, fn) { const id = setTimeout(fn, ms); timers.push(id); return id; }
function clearTimers() { timers.forEach(clearTimeout); timers = []; }

function say(text) { if (text) note.push(text); }
function flush(extra) {
  const text = [...note, extra].filter(Boolean).join(' ');
  note = [];
  if (text) speaker.say(text);
  hudText(text);
}

function hud() {
  if (!game) return;
  const g = game;
  $('hud-score').textContent = `You ${g.score.you}, Them ${g.score.cpu}. ${g.overtime ? 'Overtime' : 'Quarter ' + g.quarter}, ${clockText(g.clock)}.`;
  $('hud-down').textContent = g.pending ? '' : `${g.poss === 'you' ? 'Your' : 'Their'} ball. ${g.downText()}.`;
}
function hudText(t) { $('hud-line').textContent = t; hud(); }

async function startGame() {
  await engine.init();
  speaker.prime();
  applySettings();
  quitGame();
  game = new Game({ quarterMinutes: settings.quarter, diff: settings.difficulty });
  show('game');
  input.enable();
  engine.setCrowd(0.35);
  lastFrame = performance.now();
  loop();
  say(game.coinToss());
  game.kicker = game.other(game.firstReceiver);
  game.pending = 'kickoff';
  later(300, advance);
}

function quitGame() {
  clearTimers();
  cancelAnimationFrame(rafId);
  disposeSounds();
  play = null; playInfo = null; menu = null;
  mode = 'idle';
  input.disable();
  speaker.stop();
  $('pause-menu').hidden = true;
  if (engine.ctx) { engine.setCrowd(0, 0.5); engine.resume(); }
}

// Decides what happens next after a play or a kick.
function advance() {
  if (!game) return;
  const g = game;
  if (g.over) return endGame();

  if (g.pending === 'pat') return startPat();

  if (g.clock <= 0) {
    const r = g.endQuarter();
    say(r.text);
    S.whistle(engine, engine.createNear(0, 0.7), engine.now + 0.05, true);
    if (r.over) return endGame();
    if (r.half || r.ot) engine.setCrowd(0.5, 1);
  }
  if (g.pending === 'kickoff') {
    kickSound(true);
    say(g.kickoff(g.kicker));
  } else if (g.pending === 'safetyKick') {
    kickSound(true);
    say(g.freeKickAfterSafety(g.kicker));
  }
  if (g.warningNow) { g.warningNow = false; say('Two minute warning.'); }
  openHuddle();
}

function kickSound(distant = false) {
  const t = engine.now + 0.05;
  if (distant) { const v = engine.createVoice(0, 30, 0.8); engine.disposeVoice(v, 2); S.kick(engine, v.input, t); }
  else S.kick(engine, engine.createNear(0, 0.9), t);
  engine.setCrowd(0.7, 0.4);
  later(1600, () => engine.setCrowd(0.35, 1));
}

// ---------------------------------------------------------------------------
// The huddle: choosing a play
// ---------------------------------------------------------------------------

function offenseItems() {
  const g = game;
  const items = OFFENSE_PLAYS.map(p => ({ id: p.id, name: p.name, play: p }));
  const dist = fgDistance(g.ball);
  const endOfHalf = (g.quarter === 2 || g.quarter >= 4) && g.clock <= 30;
  if (g.down === 4) items.push({ id: 'punt', name: 'Punt' });
  if ((g.down === 4 || endOfHalf) && dist <= 66) items.push({ id: 'fg', name: `Field goal, ${dist} yards` });
  const lead = g.score.you - g.score.cpu;
  if (g.inLastTwo() && lead > 0 && g.clockRunning) items.push({ id: 'kneel', name: 'Kneel down' });
  if (g.timeouts.you > 0 && g.timeoutUseful()) items.push({ id: 'timeout', name: `Timeout, ${g.timeouts.you} left` });
  return items;
}

function defenseItems() {
  const g = game;
  const items = DEFENSE_CALLS.map(c => ({ id: c.id, name: c.name, call: c.id }));
  if (g.timeouts.you > 0 && g.timeoutUseful()) items.push({ id: 'timeout', name: `Timeout, ${g.timeouts.you} left` });
  return items;
}

function openHuddle() {
  const g = game;
  hud();
  // The computer may stop the clock first.
  if (g.cpuWantsTimeout()) {
    g.useTimeout('cpu');
    say(`They call a timeout. They have ${g.timeouts.cpu} left.`);
  }
  if (g.poss === 'cpu') {
    cpuChoice = g.cpuOffenseChoice();
    if (cpuChoice.kind !== 'play') return cpuSpecial(cpuChoice.kind);
    menu = { kind: 'defense', items: defenseItems() };
  } else {
    cpuChoice = null;
    menu = { kind: 'offense', items: offenseItems() };
  }
  setMenuIndex();
  mode = 'huddle';
  ignoreUntil = performance.now() + 300;
  flush(menu.items[menu.index].name);
}

function setMenuIndex() {
  const last = lastPick[menu.kind];
  const i = menu.items.findIndex(it => it.id === last);
  menu.index = i >= 0 ? i : 0;
}

function moveMenu(step) {
  menu.index = (menu.index + step + menu.items.length) % menu.items.length;
  S.menuTick(engine, engine.createNear(0, 1), engine.now);
  const it = menu.items[menu.index];
  speaker.say(it.name, { urgent: true });
  hudText(it.name);
}

function chooseItem(item) {
  if (!item) return;
  const g = game;
  speaker.stop();
  if (menu.kind !== 'pat') lastPick[menu.kind] = item.id;

  if (item.id === 'timeout') {
    g.useTimeout('you');
    say(`Timeout. You have ${g.timeouts.you} left.`);
    return openHuddle();
  }
  if (menu.kind === 'pat') {
    menu = null;
    if (item.id === 'kick') {
      kickSound();
      say(g.extraPoint('you'));
      return afterScoreCheck();
    }
    return runTwoPoint('you');
  }

  // The clock runs down to the snap.
  if (g.preSnap(false)) {
    say('The clock runs out before the snap.');
    menu = null;
    return advance();
  }
  if (g.warningNow) { g.warningNow = false; say('Two minute warning.'); return openHuddle(); }

  if (item.id === 'punt') {
    menu = null;
    kickSound();
    const r = g.punt();
    say(r.text);
    mode = 'wait';
    return later(900, advance);
  }
  if (item.id === 'fg') {
    menu = null;
    kickSound();
    const r = g.fieldGoal();
    mode = 'wait';
    later(1400, () => {
      if (r.good) { engine.setCrowd(1, 0.2); later(1500, () => engine.setCrowd(0.35, 1.5)); }
      else engine.setCrowd(0.15, 0.3);
      say(r.text);
      afterScoreCheck();
    });
    return;
  }
  if (item.id === 'kneel') {
    menu = null;
    S.hut(engine, engine.createNear(0, 0.8), engine.now + 0.1);
    say(g.kneel().text);
    mode = 'wait';
    return later(900, advance);
  }

  // A real play.
  if (menu.kind === 'offense') startOffense(item.play, false);
  else startDefense(item.call, cpuChoice.play, false);
}

// The computer punts, kicks a field goal, or kneels.
function cpuSpecial(kind) {
  const g = game;
  mode = 'wait';
  if (g.preSnap(false)) { say('The clock runs out.'); return later(400, advance); }
  if (g.warningNow) { g.warningNow = false; say('Two minute warning.'); }
  if (kind === 'punt') {
    say('They line up to punt.');
    flush();
    later(1500, () => { kickSound(true); say(g.punt().text); later(900, advance); });
  } else if (kind === 'fg') {
    say(`They try a ${fgDistance(g.ball)} yard field goal.`);
    flush();
    later(1600, () => {
      kickSound(true);
      const r = g.fieldGoal();
      later(1400, () => {
        if (r.good) engine.setCrowd(0.1, 0.3); else { engine.setCrowd(0.9, 0.2); later(1500, () => engine.setCrowd(0.35, 1.5)); }
        say(r.text);
        afterScoreCheck();
      });
    });
  } else {
    say('They kneel down.');
    say(g.kneel().text.replace('Kneel down. ', '').replace('Kneel down.', ''));
    later(1200, advance);
  }
}

// After any score: overtime can end the game right away.
function afterScoreCheck() {
  const sd = game.checkSuddenDeath();
  if (sd) { say(sd); return later(600, endGame); }
  later(700, advance);
}

// ---------------------------------------------------------------------------
// After a touchdown
// ---------------------------------------------------------------------------

function startPat() {
  const g = game;
  // The team that scored still has the ball.
  const team = g.poss;
  if (team === 'you') {
    menu = { kind: 'pat', items: [{ id: 'kick', name: 'Kick the extra point' }, { id: 'two', name: 'Go for two' }], index: 0 };
    mode = 'huddle';
    ignoreUntil = performance.now() + 300;
    flush(menu.items[0].name);
  } else {
    if (g.cpuGoesForTwo()) {
      say('They go for two.');
      flush();
      runTwoPoint('cpu');
    } else {
      kickSound(true);
      say(g.extraPoint('cpu'));
      afterScoreCheck();
    }
  }
}

function runTwoPoint(team) {
  const g = game;
  const saved = { ball: g.ball, down: g.down, toGo: g.toGo };
  g.ball = 98; g.down = 1; g.toGo = 2;
  const done = (success) => {
    Object.assign(g, saved);
    say(g.twoPointResult(team, success));
    afterScoreCheck();
  };
  if (team === 'you') {
    menu = { kind: 'offense2', items: OFFENSE_PLAYS.map(p => ({ id: p.id, name: p.name, play: p })) };
    setMenuIndex();
    mode = 'huddle';
    ignoreUntil = performance.now() + 300;
    menu.onPick = (item) => { menu = null; startOffense(item.play, done); };
    flush(menu.items[menu.index].name);
  } else {
    menu = { kind: 'defense2', items: DEFENSE_CALLS.map(c => ({ id: c.id, name: c.name, call: c.id })) };
    setMenuIndex();
    mode = 'huddle';
    ignoreUntil = performance.now() + 300;
    const choice = g.cpuPlay(true);
    menu.onPick = (item) => { menu = null; startDefense(item.call, choice, done); };
    flush(menu.items[menu.index].name);
  }
}

// ---------------------------------------------------------------------------
// Running a snap
// ---------------------------------------------------------------------------

function emit(type, data) { onPlayEvent(type, data); }

function cadence(then) {
  mode = 'cadence';
  cues = { side: 0, lane: 0, mine: 0, open: [0, 0, 0] };
  const near = playInfo.kind === 'defense' ? placedVoice(0, playInfo.los - 1, 0.8).input : engine.createNear(0, 0.7);
  const t = engine.now + 0.25;
  S.hut(engine, near, t);
  S.hut(engine, near, t + 0.45);
  later(950, () => {
    S.snap(engine, near, engine.now);
    // Both lines crash together.
    const los = playInfo.los;
    for (const x of [-5, -2.5, 0, 2.5, 5]) {
      const v = placedVoice(x, los + 0.5);
      S.padClash(engine, v.input, engine.now + rand(0.05, 0.18), 0.7);
    }
    engine.setCrowd(0.5, 0.3);
    mode = 'play';
    ignoreUntil = 0;
    then();
  });
}

function startOffense(choice, twoPoint) {
  const g = game;
  const call = g.cpuDefenseCall();
  const los = g.ball;
  playInfo = { kind: choice.type, choice, call, los, twoPoint, started: performance.now() };
  if (choice.type === 'run') {
    play = new RunPlay({ los, holeX: choice.dir * 3, call, diff: settings.difficulty, emit });
  } else {
    play = new PassPlay({ los, depth: choice.depth, call, diff: settings.difficulty, emit });
  }
  hudText(choice.name);
  cadence(() => {
    if (choice.type === 'run') S.handoff(engine, engine.createNear(0, 0.8), engine.now + 0.25);
  });
}

function startDefense(call, choice, twoPoint) {
  const g = game;
  const los = g.ball;
  const plan = planOffense(choice, call, settings.difficulty, los);
  playInfo = { kind: 'defense', choice, call, los, plan, twoPoint };
  play = new DefensePlay(plan, { los, diff: settings.difficulty, emit });
  hudText(DEFENSE_CALLS.find(c => c.id === call).name);
  cadence(() => {
    if (plan.type === 'run') S.handoff(engine, placedVoice(0, los - 4).input, engine.now + 0.4);
  });
}

// Where you are listening from, and which way you face.
function listener() {
  if (!play) return { x: 0, y: 0, f: 1 };
  if (playInfo.kind === 'run') return { x: play.runner.x, y: play.runner.y, f: 1 };
  if (playInfo.kind === 'pass') {
    if (play.phase === 'rac' && play.runner) return { x: play.runner.x, y: play.runner.y, f: 1 };
    return { x: play.qb.x, y: play.qb.y, f: 1 };
  }
  return { x: play.me.x, y: play.me.y, f: -1 };
}

function rel(x, y) {
  const L = listener();
  return { right: (x - L.x) * L.f, forward: (y - L.y) * L.f };
}

// One-shot voice placed at a spot on the field.
function placedVoice(x, y, loud = 1) {
  const r = rel(x, y);
  const v = engine.createVoice(r.right, r.forward, loud);
  engine.disposeVoice(v, 2);
  return v;
}

// Steady voices for players who keep moving (defenders, the ball carrier, the ball).
const live = new Map();
function liveVoice(key, x, y, loud = 1) {
  let s = live.get(key);
  const r = rel(x, y);
  if (!s) {
    s = { voice: engine.createVoice(r.right, r.forward, loud), nextStep: engine.now + rand(0, 0.2), nextClash: engine.now + rand(0.2, 0.6) };
    live.set(key, s);
  } else {
    engine.placeVoice(s.voice, r.right, r.forward);
  }
  return s;
}
function disposeSounds() {
  for (const s of live.values()) engine.disposeVoice(s.voice, 1.5);
  live.clear();
}

let cues = { side: 0, lane: 0, mine: 0, open: [0, 0, 0] };

function soundFrame() {
  if (!play || mode !== 'play') return;
  const now = engine.now;
  const runPlay = playInfo.kind === 'run' ? play : (playInfo.kind === 'pass' && play.phase === 'rac' ? play.run : null);

  if (runPlay) {
    const r = runPlay.runner;
    runPlay.defenders.forEach((df, i) => {
      const s = liveVoice('d' + i, df.x, df.y);
      if (df.state === 'blocked') {
        if (now >= s.nextClash) {
          S.padClash(engine, s.voice.input, now, 0.45);
          if (Math.random() < 0.3) S.grunt(engine, s.voice.input, now + 0.04, rand(0.8, 1.1), 0.3);
          s.nextClash = now + rand(0.35, 0.8);
        }
      } else if (df.state !== 'down') {
        const speed = Math.hypot(df.vx, df.vy);
        if (speed > 1.5 && now >= s.nextStep) {
          S.footstep(engine, s.voice.input, now, df.kind === 'lineman' ? 1.3 : 1.0);
          s.nextStep = now + 1.9 / Math.max(speed, 3);
        }
      }
    });
    // Your own steps.
    const sp = Math.hypot(r.vx, r.vy);
    if (sp > 1 && now >= cues.mine) {
      S.myStep(engine, engine.createNear(0, 1), now);
      cues.mine = now + 1.7 / Math.max(sp, 3);
    }
    // Sideline warning: ticks on that side, faster as it gets closer.
    const edge = SIDELINE - Math.abs(r.x);
    if (edge < 5 && now >= cues.side) {
      S.sideline(engine, engine.createNear(r.x > 0 ? 1 : -1, 0.8), now);
      cues.side = now + 0.1 + edge * 0.08;
    }
    // Open field hint.
    if (settings.laneHint && now >= cues.lane && runPlay.t > 0.4) {
      const ang = runPlay.openLane();
      if (ang !== null) {
        const a = ang * Math.PI / 180;
        const v = engine.createVoice(Math.sin(a) * 5, Math.cos(a) * 5, 1);
        engine.disposeVoice(v, 1);
        S.lane(engine, v.input, now);
      }
      cues.lane = now + 0.7;
    }
    // The crowd rises as you near the end zone or break into the open.
    const toGo = 100 - r.y;
    engine.setCrowd(Math.min(1, 0.5 + Math.max(0, (20 - toGo) / 30) + (r.y - playInfo.los > 12 ? 0.25 : 0)), 0.5);
    return;
  }

  if (playInfo.kind === 'pass') {
    if (play.phase === 'dropback') {
      // Receivers who are open call out with their tone, again and again until covered.
      play.receivers.forEach((rc, i) => {
        if (rc.open && now >= cues.open[i]) {
          const v = placedVoice(rc.x, rc.y, 1.3);
          S.open(engine, v.input, now, i);
          cues.open[i] = now + 0.28;
        }
      });
      // The pass rush.
      play.rushers.forEach((ru, i) => {
        const s = liveVoice('r' + i, ru.x, ru.y, 1.1);
        if (now >= s.nextStep) { S.footstep(engine, s.voice.input, now, 1.3); s.nextStep = now + 0.3; }
        if (now >= s.nextClash) { S.padClash(engine, s.voice.input, now, 0.4); s.nextClash = now + rand(0.4, 0.9); }
      });
      if (now >= cues.mine && play.t < 1.2) {
        S.myStep(engine, engine.createNear(0, 1), now);
        cues.mine = now + 0.3;
      }
    }
    if (play.ball && play.phase === 'flight') liveVoice('ball', play.ball.x ?? play.qb.x, play.ball.y ?? play.qb.y, 1);
    return;
  }

  // Defense.
  const m = play.me;
  if (play.carrier && (play.phase === 'run' || play.phase === 'rac')) {
    const c = play.carrier;
    const s = liveVoice('carrier', c.x, c.y, 1.2);
    if (now >= s.nextStep) { S.footstep(engine, s.voice.input, now, 0.9); s.nextStep = now + 0.24; }
    if (play.phase === 'run' && play.t < 2 && now >= s.nextClash) {
      const v = placedVoice(rand(-4, 4), playInfo.los + 0.5);
      S.padClash(engine, v.input, now, 0.4);
      s.nextClash = now + rand(0.25, 0.5);
    }
  } else if (play.phase === 'drop') {
    const s = liveVoice('qb', play.qb.x, play.qb.y, 0.9);
    if (play.t < 1.5 && now >= s.nextStep) { S.footstep(engine, s.voice.input, now, 0.9); s.nextStep = now + 0.3; }
    if (now >= s.nextClash) {
      const v = placedVoice(rand(-4, 4), playInfo.los + 0.5);
      S.padClash(engine, v.input, now, 0.4);
      s.nextClash = now + rand(0.3, 0.6);
    }
  }
  if (play.ball && play.phase === 'flight') liveVoice('ball', play.ball.x ?? play.qb.x, play.ball.y ?? play.qb.y, 1);
  const moving = Math.abs(m.targetX - m.x) > 0.3 || play.phase !== 'drop';
  if (moving && now >= cues.mine) {
    S.myStep(engine, engine.createNear(0, 1), now);
    cues.mine = now + 0.3;
  }
  if (Math.abs(m.x) > SIDELINE - 4 && now >= cues.side) {
    S.sideline(engine, engine.createNear(m.x > 0 ? -1 : 1, 0.8), now);
    cues.side = now + 0.35;
  }
}

function onPlayEvent(type, d) {
  const now = engine.now;
  const near = () => engine.createNear(0, 1);
  const at = (o, loud) => placedVoice(o.x, o.y, loud).input;
  switch (type) {
    case 'closing': S.closing(engine, at(d, 1.2), now); break;
    case 'juke': S.juke(engine, engine.createNear(d.dir * 0.6, 1), now); break;
    case 'jukeMiss': S.whiff(engine, at(d), now); engine.setCrowd(0.85, 0.2); break;
    case 'jukeNotReady': case 'noBurst': S.notReady(engine, near(), now); break;
    case 'burst': S.burst(engine, near(), now); break;
    case 'broken': S.broken(engine, near(), now); engine.setCrowd(0.9, 0.2); break;
    case 'tackle': S.tackled(engine, near(), now); break;
    case 'shed': S.grunt(engine, at(d), now, 1, 0.35); break;
    case 'armMiss': S.padClash(engine, at(d), now, 0.6); break;
    case 'open': S.open(engine, at(d, 1.3), now, d.i); cues.open[d.i] = now + 0.28; break;
    case 'throw':
      S.throwBall(engine, near(), now);
      if (playInfo.kind === 'defense') S.throwBall(engine, placedVoice(d.from.x, d.from.y, 1.2).input, now);
      {
        const s = liveVoice('ball', d.from.x, d.from.y, 1);
        S.ballFlight(engine, s.voice.input, now, d.flight);
      }
      break;
    case 'throwAway': S.throwBall(engine, near(), now); S.incomplete(engine, placedVoice(-SIDELINE - 3, playInfo.los + 5, 1).input, now + 0.7); break;
    case 'catch': S.catchBall(engine, at(d.to, 1.3), now); engine.setCrowd(0.7, 0.2); ignoreUntil = performance.now() + 250; break;
    case 'incomplete': S.incomplete(engine, at(d.to), now); engine.setCrowd(0.3, 0.3); break;
    case 'interception': S.catchBall(engine, at(d.to), now); engine.setCrowd(0.1, 0.2); break;
    case 'sack': S.sackCrash(engine, playInfo.kind === 'defense' ? at(play.qb, 1.2) : near(), now); break;
    case 'inRange': S.inRange(engine, near(), now); break;
    case 'myTackle': S.tackled(engine, at(play.carrier, 1.3), now); engine.setCrowd(0.8, 0.2); break;
    case 'myMiss': S.whiff(engine, near(), now); break;
    case 'dive': S.whiff(engine, near(), now); break;
    case 'reach': S.juke(engine, near(), now); break;
    case 'breakup': S.padClash(engine, at(d.to, 1.2), now, 0.9); S.incomplete(engine, at(d.to), now + 0.1); engine.setCrowd(0.9, 0.2); break;
    case 'myInt': S.catchBall(engine, near(), now); engine.setCrowd(1, 0.2); break;
    case 'end': onPlayEnd(d); break;
  }
}

function onPlayEnd(res) {
  mode = 'wait';
  S.whistle(engine, engine.createNear(0, 0.7), engine.now + 0.3);
  const info = playInfo;
  later(900, () => {
    disposeSounds();
    play = null;
    finishPlay(info, res);
  });
}

function describeCpuPlay(info) {
  const c = info.choice;
  if (c.type === 'run') return ['They run left.', 'They run up the middle.', 'They run right.'][c.dir + 1];
  const side = info.plan.side;
  const sideWord = side == null ? '' : side < 0 ? ' to the left' : side > 0 ? ' to the right' : ' over the middle';
  if (info.plan.outcome === 'sack') return 'They drop back to pass.';
  return `${c.depth === 'short' ? 'Short' : c.depth === 'medium' ? 'Medium' : 'Deep'} pass${sideWord}.`;
}

function finishPlay(info, res) {
  const g = game;
  // Two-point tries do not count as plays.
  if (info.twoPoint) {
    const success = res.kind === 'td' || (res.endY != null && res.endY >= 100);
    if (info.kind === 'defense') say(describeCpuPlay(info));
    if (success) { engine.setCrowd(info.kind === 'defense' ? 0.1 : 1, 0.2); }
    info.twoPoint(success);
    return;
  }
  let pre = '';
  if (info.kind === 'defense') {
    pre = describeCpuPlay(info);
    if (res.byMe && res.kind === 'gain') pre += ' You make the tackle!';
  }
  const r = g.resolvePlay(res, info.choice);
  let text = r.text;
  if (r.event === 'td') {
    if (info.kind === 'defense') { text = text.replace('Touchdown!', 'Touchdown, them.'); engine.setCrowd(0.1, 0.3); }
    else { S.horn(engine, engine.createNear(0, 1), engine.now + 0.1); engine.setCrowd(1, 0.2); }
    later(3000, () => engine.setCrowd(0.35, 2));
  } else if (r.event === 'safety') {
    engine.setCrowd(info.kind === 'defense' ? 1 : 0.1, 0.2);
  } else {
    engine.setCrowd(0.35, 1.2);
  }
  say(pre);
  say(text);
  hud();
  if (r.event === 'td' || r.event === 'safety') {
    const sd = r.event === 'safety' ? g.checkSuddenDeath() : null;
    if (sd) { say(sd); return later(600, endGame); }
    if (r.event === 'td' && g.overtime) {
      // Sudden death: no try needed.
      g.pending = null;
      const s2 = g.checkSuddenDeath();
      say(s2);
      return later(600, endGame);
    }
  }
  later(200, advance);
}

function endGame() {
  mode = 'over';
  clearTimers();
  cancelAnimationFrame(rafId);
  input.disable();
  const g = game;
  flush();
  engine.setCrowd(0.6, 1);
  later(4000, () => engine.setCrowd(0, 2));
  $('final-title').textContent = g.finalText();
  $('final-stats').textContent = `Total yards: you ${g.stats.you.yards} on ${g.stats.you.plays} plays, them ${g.stats.cpu.yards} on ${g.stats.cpu.plays} plays.`;
  setTimeout(() => show('final'), 2500);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function onAction(action, extra = {}) {
  if (action === 'pause') { if (mode !== 'over' && mode !== 'idle') togglePause(mode !== 'paused'); return; }
  if (mode === 'paused') return;
  if (performance.now() < ignoreUntil) return;

  if (mode === 'huddle' && menu) {
    if (action === 'status') { speaker.say(game.statusText(), { urgent: true }); return; }
    if (action === 'repeat') { speaker.repeat(); return; }
    const touch = extra.source === 'touch';
    if (action === 'down' && !touch) return moveMenu(1);
    if (action === 'up' && !touch) return moveMenu(-1);
    if (action === 'right') return moveMenu(1);
    if (action === 'left') return moveMenu(-1);
    if (touch && action === 'up') { speaker.say(game.statusText(), { urgent: true }); return; }
    if (touch && action === 'down') { speaker.repeat(); return; }
    let item = null;
    if (action === 'select' || action === 'doubleTap') item = menu.items[menu.index];
    else if (action.startsWith('digit')) item = menu.items[Number(action.slice(5)) - 1];
    if (!item) return;
    if (menu.onPick) { const f = menu.onPick; lastPick[menu.kind] = item.id; speaker.stop(); f(item); return; }
    chooseItem(item);
    return;
  }

  if (mode === 'play' && play) {
    if (action === 'status' || action === 'repeat' || action === 'doubleTap' || action.startsWith('digit')) return;
    const juke = action === 'select' || action === 'tap';
    if (playInfo.kind === 'run' || (playInfo.kind === 'pass' && play.phase === 'rac')) {
      if (action === 'left' || action === 'right') { play.input(action); S.cut(engine, engine.createNear(action === 'left' ? -0.5 : 0.5, 1), engine.now); }
      else if (action === 'up') play.input('burst');
      else if (juke) play.input('juke');
    } else if (playInfo.kind === 'pass') {
      if (action === 'left') play.input('throwLeft');
      else if (action === 'up') play.input('throwMiddle');
      else if (action === 'right') play.input('throwRight');
      else if (action === 'down') play.input('throwAway');
    } else {
      if (action === 'left' || action === 'right') play.input(action);
      else if (action === 'up') play.input('burst');
      else if (juke) play.input('tackle');
    }
  }
}

function togglePause(on) {
  if (on) {
    modeBefore = mode;
    mode = 'paused';
    speaker.stop();
    engine.suspend();
    $('pause-menu').hidden = false;
    $('pause-menu').querySelector('h2').focus();
  } else if (mode === 'paused') {
    mode = modeBefore;
    $('pause-menu').hidden = true;
    engine.resume();
    lastFrame = performance.now();
    field.focus();
    if (mode === 'huddle' && menu) speaker.say(menu.items[menu.index].name);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (mode === 'play' || mode === 'huddle' || mode === 'cadence')) togglePause(true);
});

// ---------------------------------------------------------------------------
// The frame loop
// ---------------------------------------------------------------------------

function loop() {
  rafId = requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (mode !== 'play' || !play) return;
  play.update(dt);
  soundFrame();
}
