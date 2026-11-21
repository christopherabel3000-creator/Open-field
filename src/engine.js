// Play engine: the physics of each snap, with no sound in it.
// Field coordinates: x is across the field in yards (0 = middle, sidelines at +/-26.67),
// y is down the field in yards from the offense's own goal line (100 = the end zone).
// Each play reports what happens through emit(type, data), and the sound layer listens.

export const SIDELINE = 26.67;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Difficulty tweaks shared by every play.
export const DIFF = {
  easy:   { defSpeed: 0.92, breakBonus: 0.08, tackleBonus: 0.12, windowBonus: 1.25, rushBonus: 1.12 },
  normal: { defSpeed: 1.0,  breakBonus: 0,    tackleBonus: 0,    windowBonus: 1.0,  rushBonus: 1.0 },
  hard:   { defSpeed: 1.06, breakBonus: -0.04, tackleBonus: -0.1, windowBonus: 0.85, rushBonus: 0.9 },
};

// ---------------------------------------------------------------------------
// The ball carrier you control (runs, and after a catch).
// ---------------------------------------------------------------------------

class Runner {
  constructor(x, y, vy = 0) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = vy;
    this.targetX = x;
    this.maxSpeed = 6.8;
    this.burstLeft = 1;      // one burst per play
    this.burstUntil = 0;
    this.jukeReadyAt = 0;
    this.jukeUntil = 0;
    this.slowUntil = 0;
  }
}

function makeDefender(kind, x, y, speed, extra = {}) {
  return Object.assign({
    kind, x, y, vx: 0, vy: 0, speed,
    state: 'free',          // free, blocked, down, wait
    until: 0,               // when the current state ends
    holdX: x, holdY: y,
    armTried: false,
    near: false,
  }, extra);
}

// Lines up the defense against a run, for the call the defense made.
// los = line of scrimmage, holeX = where the play is designed to go.
function runDefense(los, call, holeX, d) {
  const defs = [];
  const sp = d.defSpeed;
  const blockMul = call === 'run' ? 0.72 : call === 'pass' ? 1.2 : call === 'blitz' ? 0.85 : 1.0;
  // Defensive line, each engaged with a blocker.
  for (const x of [-5.5, -2, 2, 5.5]) {
    let hx = x;
    // Blockers at the point of attack drive their man away from the hole.
    if (Math.abs(x - holeX) < 3.2) hx = x + Math.sign(x - holeX || 1) * rand(1.4, 2.4) * (call === 'run' ? 0.7 : 1);
    defs.push(makeDefender('lineman', hx, los + 0.8, 6.0 * sp, {
      state: 'blocked', until: rand(1.1, 3.4) * blockMul, holdX: hx, holdY: los + 0.6,
    }));
  }
  // Linebackers read the play, and some get picked up by a blocker at the second level.
  const lbXs = [-5, 0, 5];
  if (call === 'run' || call === 'blitz') lbXs.push(Math.random() < 0.5 ? -8 : 8);
  for (const x of lbXs) {
    const blitzing = call === 'blitz' && Math.abs(x) <= 5 && Math.random() < 0.42;
    const blockChance = call === 'run' ? 0.38 : call === 'pass' ? 0.62 : 0.5;
    if (blitzing) {
      // A running back or pulling guard picks up most blitzers for a moment.
      if (Math.random() < 0.55) {
        defs.push(makeDefender('blitzer', x * 0.6, los + 1.5, 6.9 * sp, {
          state: 'blocked', until: rand(0.5, 1.2), holdX: x * 0.6, holdY: los - 1.5,
        }));
      } else {
        defs.push(makeDefender('blitzer', x * 0.6, los + 1.5, 6.9 * sp, { state: 'wait', until: rand(0.2, 0.45) }));
      }
    } else if (Math.random() < blockChance) {
      defs.push(makeDefender('linebacker', x, los + 4.5, 6.7 * sp, {
        state: 'blocked', until: rand(0.9, 2.0) * blockMul, holdX: x + rand(-1, 1), holdY: los + 3.5,
      }));
    } else {
      defs.push(makeDefender('linebacker', x, los + 4.5, 6.7 * sp, { state: 'wait', until: rand(0.25, 0.6) }));
    }
  }
  // Cornerbacks are covering receivers until they see it is a run.
  for (const x of [-17, 17]) {
    defs.push(makeDefender('corner', x, los + 6, 7.2 * sp, { state: 'wait', until: rand(1.0, 1.8) }));
  }
  // Safeties, deep.
  const deep = call === 'pass' ? 15 : call === 'run' ? 9 : 12;
  const safeties = (call === 'run' || call === 'blitz') ? [Math.random() < 0.5 ? -4 : 4] : [-9, 9];
  for (const x of safeties) {
    defs.push(makeDefender('safety', x, los + deep, 7.1 * sp, { state: 'wait', until: rand(0.3, 0.6) }));
  }
  return defs;
}

// ---------------------------------------------------------------------------
// RunPlay: you carry the ball. Used for runs and for running after a catch.
// ---------------------------------------------------------------------------

export class RunPlay {
  // opts: { los, holeX, call, diff, emit, start: {x,y,vy}, defenders (optional), afterCatch }
  constructor(opts) {
    this.d = DIFF[opts.diff] || DIFF.normal;
    this.emit = opts.emit || (() => {});
    this.los = opts.los;
    this.t = 0;
    this.done = false;
    this.result = null;
    this.afterCatch = !!opts.afterCatch;
    const s = opts.start || { x: opts.holeX * 0.3, y: opts.los - 4, vy: 0 };
    this.runner = new Runner(s.x, s.y, s.vy || 0);
    this.runner.targetX = opts.holeX;
    this.defenders = opts.defenders || runDefense(opts.los, opts.call, opts.holeX, this.d);
    this.startY = this.runner.y;
  }

  input(action) {
    if (this.done) return;
    const r = this.runner;
    if (action === 'left') r.targetX = clamp(r.targetX - 2, -SIDELINE - 1, SIDELINE + 1);
    else if (action === 'right') r.targetX = clamp(r.targetX + 2, -SIDELINE - 1, SIDELINE + 1);
    else if (action === 'burst') {
      if (r.burstLeft > 0) { r.burstLeft--; r.burstUntil = this.t + 1.5; this.emit('burst'); }
      else this.emit('noBurst');
    } else if (action === 'juke') {
      if (this.t >= r.jukeReadyAt) {
        r.jukeReadyAt = this.t + 1.6;
        r.jukeUntil = this.t + 0.4;
        r.slowUntil = this.t + 0.25;
        // Step away from the closest tackler.
        const th = this.closestThreat();
        const away = th ? (th.x > r.x ? -1 : 1) : (Math.random() < 0.5 ? -1 : 1);
        r.targetX = clamp(r.x + away * 1.6, -SIDELINE - 1, SIDELINE + 1);
        this.emit('juke', { dir: away });
      } else {
        this.emit('jukeNotReady');
      }
    }
  }

  closestThreat() {
    let best = null, bd = 1e9;
    for (const df of this.defenders) {
      if (df.state !== 'free') continue;
      const dd = dist(df, this.runner);
      if (dd < bd) { bd = dd; best = df; }
    }
    return best;
  }

  finish(kind, extra = {}) {
    if (this.done) return;
    this.done = true;
    const r = this.runner;
    let y = r.y;
    if (kind === 'tackle' && r.vy > 2) y += 0.6; // falls forward
    this.result = Object.assign({ kind, endY: Math.min(y, 100), endX: r.x, time: this.t }, extra);
    this.emit('end', this.result);
  }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    const t = this.t;
    const r = this.runner;

    // Runner speed.
    let top = r.maxSpeed;
    if (t < r.burstUntil) top = 8.9;
    if (t < r.slowUntil) top *= 0.55;
    r.vy += clamp(top - r.vy, -12 * dt, 7 * dt);
    const wantVx = clamp((r.targetX - r.x) * 7, -6.5, 6.5);
    r.vx += (wantVx - r.vx) * Math.min(1, dt * 9);
    r.x += r.vx * dt;
    r.y += r.vy * dt;

    if (Math.abs(r.x) > SIDELINE) { this.finish('oob'); return; }
    if (r.y >= 100) { this.finish('td'); return; }

    // Sideline and end zone warnings.
    const edge = SIDELINE - Math.abs(r.x);
    this.edgeDist = edge;

    for (const df of this.defenders) {
      // State changes.
      if (df.state === 'wait' && t >= df.until) df.state = 'free';
      if (df.state === 'blocked' && t >= df.until) { df.state = 'free'; this.emit('shed', df); }
      if (df.state === 'down' && t >= df.until) df.state = 'free';

      if (df.state === 'blocked') {
        // Held in place by a blocker, but can reach out as the runner goes by.
        df.x += (df.holdX - df.x) * Math.min(1, dt * 3);
        df.y += (df.holdY - df.y) * Math.min(1, dt * 3);
        if (!df.armTried && dist(df, r) < 1.1) {
          df.armTried = true;
          if (Math.random() < 0.22 - this.d.breakBonus) {
            this.emit('tackle', df);
            this.finish('tackle', { by: df.kind });
            return;
          }
          this.emit('armMiss', df);
        }
        continue;
      }
      if (df.state === 'wait') {
        // Drifting with the play while reading it.
        df.x += clamp(r.x - df.x, -1, 1) * dt;
        continue;
      }
      if (df.state === 'down') continue;

      // Free: take an angle on the runner.
      const dd = dist(df, r);
      const lead = Math.min(1.0, dd / df.speed) * 0.75;
      const tx = r.x + r.vx * lead, ty = r.y + r.vy * lead;
      const ax = tx - df.x, ay = ty - df.y;
      const al = Math.hypot(ax, ay) || 1;
      const wvx = ax / al * df.speed, wvy = ay / al * df.speed;
      df.vx += (wvx - df.vx) * Math.min(1, dt * 3.5);
      df.vy += (wvy - df.vy) * Math.min(1, dt * 3.5);
      df.x += df.vx * dt;
      df.y += df.vy * dt;

      // The moment to make a move.
      const nowNear = dd < 2.8;
      if (nowNear && !df.near) this.emit('closing', df);
      df.near = nowNear;

      if (dd < 1.0) {
        if (t < r.jukeUntil && !df.jukeTried) {
          df.jukeTried = true;
          if (Math.random() < 0.6 + this.d.breakBonus) {
            df.state = 'down'; df.until = t + 0.7;
            r.jukeUntil = 0;
            this.emit('jukeMiss', df);
            continue;
          }
        }
        // Another tackler arriving at the same time makes it harder to break free.
        let helpers = 0;
        for (const o of this.defenders) if (o !== df && o.state === 'free' && dist(o, r) < 1.8) helpers++;
        let breakChance = 0.09 + this.d.breakBonus + (t < r.burstUntil ? 0.07 : 0) - helpers * 0.06;
        if (Math.random() < Math.max(0.02, breakChance)) {
          df.state = 'down'; df.until = t + 1.2;
          r.slowUntil = t + 0.45;
          this.emit('broken', df);
          continue;
        }
        this.emit('tackle', df);
        this.finish('tackle', { by: df.kind });
        return;
      }
    }
    if (t > 25) this.finish('tackle');
  }

  // The best open direction ahead, in degrees (negative = left), or null when nothing is clear.
  openLane() {
    const r = this.runner;
    let best = null, bestScore = -1e9;
    for (let ang = -50; ang <= 50; ang += 10) {
      const a = ang * Math.PI / 180;
      const dx = Math.sin(a), dy = Math.cos(a);
      let clear = 12;
      for (const df of this.defenders) {
        if (df.state === 'down') continue;
        const rx = df.x - r.x, ry = df.y - r.y;
        const along = rx * dx + ry * dy;
        if (along < 0 || along > 12) continue;
        const across = Math.abs(rx * dy - ry * dx);
        if (across < 2.2) clear = Math.min(clear, along);
      }
      const px = r.x + dx * 6;
      if (Math.abs(px) > SIDELINE - 1) clear -= 6;
      const score = clear - Math.abs(ang) * 0.02;
      if (score > bestScore) { bestScore = score; best = ang; }
    }
    return bestScore >= 5 ? best : null;
  }
}

// ---------------------------------------------------------------------------
// PassPlay: you are the quarterback. Three receivers get open at different times.
// ---------------------------------------------------------------------------

export const DEPTHS = { short: 6, medium: 13, deep: 26 };
const RECEIVER_X = [-16, -4, 16]; // left, middle, right

export class PassPlay {
  // opts: { los, depth: 'short'|'medium'|'deep', call, diff, emit }
  constructor(opts) {
    this.d = DIFF[opts.diff] || DIFF.normal;
    this.emit = opts.emit || (() => {});
    this.los = opts.los;
    this.call = opts.call;
    this.depthName = opts.depth;
    this.depth = DEPTHS[opts.depth];
    this.diffName = opts.diff;
    this.t = 0;
    this.done = false;
    this.phase = 'dropback'; // dropback, flight, rac, over
    this.qb = { x: 0, y: this.los - 7 };
    const base = { short: [0.9, 1.5], medium: [1.6, 2.4], deep: [2.4, 3.3] }[opts.depth];
    const neverOpen = { run: 0.22, balanced: 0.34, pass: 0.48, blitz: 0.16 }[opts.call] ?? 0.28;
    const winMul = ({ run: 1.25, balanced: 1, pass: 0.7, blitz: 1.15 }[opts.call] ?? 1) * this.d.windowBonus;
    const earlier = opts.call === 'blitz' ? -0.25 : 0;
    this.receivers = RECEIVER_X.map((x, i) => {
      const depth = this.depth * (i === 1 ? 0.85 : 1) + rand(-1, 1);
      const r = {
        i, x: x + rand(-1.5, 1.5), y: this.los + depth,
        open: false, openAt: Infinity, closeAt: Infinity, everOpen: false,
      };
      if (Math.random() > neverOpen) {
        r.openAt = rand(base[0], base[1]) + earlier + rand(-0.2, 0.2);
        r.closeAt = r.openAt + rand(0.45, 1.05) * winMul;
      }
      return r;
    });
    // Make sure at least one receiver has a chance most of the time.
    if (this.receivers.every(r => r.openAt === Infinity) && Math.random() < 0.6) {
      const r = this.receivers[Math.floor(Math.random() * 3)];
      r.openAt = rand(base[0], base[1]) + 0.3;
      r.closeAt = r.openAt + rand(0.5, 0.9) * winMul;
    }
    const rush = { run: [3.9, 4.9], balanced: [3.4, 4.5], pass: [4.1, 5.4], blitz: [2.3, 3.2] }[opts.call] || [3.4, 4.5];
    this.sackAt = rand(rush[0], rush[1]) * this.d.rushBonus;
    // Two rushers you can hear closing in on the pocket.
    this.rushers = [
      { x: -4, y: this.los + 0.8, sx: -4 },
      { x: 4, y: this.los + 0.8, sx: 4 },
    ];
    this.ball = null;
    this.run = null;
    this.result = null;
  }

  input(action) {
    if (this.done) return;
    if (this.phase === 'rac' && this.run) { this.run.input(action); return; }
    if (this.phase !== 'dropback' || this.t < 0.35) return;
    if (action === 'throwLeft') this.throwTo(0);
    else if (action === 'throwMiddle') this.throwTo(1);
    else if (action === 'throwRight') this.throwTo(2);
    else if (action === 'throwAway') {
      this.phase = 'over';
      this.emit('throwAway');
      this.finish({ kind: 'incomplete', away: true, time: this.t + 0.8 });
    }
  }

  throwTo(i) {
    const r = this.receivers[i];
    const open = r.open;
    const lateInWindow = open && (r.closeAt - this.t) < 0.2;
    let pComplete, pInt;
    const k = this.depthName;
    if (open) {
      pComplete = { short: 0.8, medium: 0.68, deep: 0.5 }[k] - (lateInWindow ? 0.12 : 0);
      pInt = { short: 0.015, medium: 0.025, deep: 0.04 }[k];
    } else {
      pComplete = { short: 0.26, medium: 0.17, deep: 0.1 }[k];
      pInt = { short: 0.1, medium: 0.14, deep: 0.18 }[k];
    }
    pComplete += { run: 0.05, balanced: 0, pass: -0.09, blitz: k === 'short' ? 0.04 : -0.03 }[this.call] || 0;
    if (this.diffName === 'easy') { pComplete += 0.05; pInt *= 0.7; }
    if (this.diffName === 'hard') { pComplete -= 0.04; pInt *= 1.25; }
    const roll = Math.random();
    const outcome = roll < pInt ? 'int' : roll < pInt + pComplete ? 'catch' : 'incomplete';
    const flight = { short: 0.55, medium: 0.9, deep: 1.5 }[k];
    this.ball = { from: { ...this.qb }, to: { x: r.x, y: r.y }, start: this.t, flight, outcome, receiver: i, open };
    this.phase = 'flight';
    this.emit('throw', this.ball);
  }

  finish(res) {
    if (this.done) return;
    this.done = true;
    this.result = res;
    this.emit('end', res);
  }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    const t = this.t;

    if (this.phase === 'dropback') {
      for (const r of this.receivers) {
        const isOpen = t >= r.openAt && t < r.closeAt;
        if (isOpen && !r.open) { r.open = true; r.everOpen = true; this.emit('open', r); }
        if (!isOpen && r.open) { r.open = false; this.emit('covered', r); }
      }
      // Pass rush closing on the quarterback.
      const f = clamp(t / this.sackAt, 0, 1);
      for (const ru of this.rushers) {
        ru.x = ru.sx * (1 - f) + this.qb.x * f + (ru.sx < 0 ? -0.6 : 0.6);
        ru.y = (this.los + 0.8) * (1 - f) + this.qb.y * f;
      }
      if (t >= this.sackAt) {
        this.phase = 'over';
        const loss = Math.round(rand(4, 9));
        this.emit('sack');
        this.finish({ kind: 'sack', yards: -loss, time: t + 0.5 });
      }
      return;
    }

    if (this.phase === 'flight') {
      const b = this.ball;
      const f = clamp((t - b.start) / b.flight, 0, 1);
      b.x = b.from.x + (b.to.x - b.from.x) * f;
      b.y = b.from.y + (b.to.y - b.from.y) * f;
      if (f >= 1) {
        if (b.outcome === 'incomplete') {
          this.phase = 'over';
          this.emit('incomplete', b);
          this.finish({ kind: 'incomplete', time: t + 0.4 });
        } else if (b.outcome === 'int') {
          this.phase = 'over';
          this.emit('interception', b);
          this.finish({ kind: 'int', spotY: b.to.y, spotX: b.to.x, time: t + 2 });
        } else {
          this.emit('catch', b);
          this.startRac(b);
        }
      }
      return;
    }

    if (this.phase === 'rac') {
      this.run.update(dt);
      if (this.run.done) {
        const rr = this.run.result;
        this.finish(Object.assign({}, rr, { kind: rr.kind, caught: true, time: t }));
      }
    }
  }

  startRac(b) {
    this.phase = 'rac';
    const cx = b.to.x, cy = b.to.y;
    const sp = this.d.defSpeed;
    const defs = [];
    // The man covering him.
    const gap = b.open ? rand(1.8, 3.4) : rand(0.9, 1.6);
    const side = Math.random() < 0.5 ? -1 : 1;
    defs.push(makeDefender('corner', cx + side * gap * 0.6, cy + gap * 0.8, 7.2 * sp));
    // Deep help.
    const deep = this.depthName === 'deep' ? rand(4, 9) : rand(8, 14);
    defs.push(makeDefender('safety', clamp(cx * 0.4 + rand(-4, 4), -20, 20), cy + deep, 7.0 * sp));
    if (this.depthName !== 'deep') {
      defs.push(makeDefender('safety', clamp(-cx * 0.3 + rand(-5, 5), -20, 20), cy + deep + rand(2, 6), 7.0 * sp));
    }
    // Underneath defenders chasing from behind and the side.
    defs.push(makeDefender('linebacker', cx - side * rand(2.5, 5), cy - rand(1, 4), 6.7 * sp));
    if (this.depthName === 'short') defs.push(makeDefender('linebacker', cx + side * rand(5, 9), cy + rand(-1, 3), 6.7 * sp));
    this.run = new RunPlay({
      los: this.los, holeX: cx, diff: this.diffName, emit: (type, data) => { if (type !== 'end') this.emit(type, data); },
      start: { x: cx, y: cy, vy: 5.5 }, defenders: defs, afterCatch: true,
    });
    this.run.t = 0;
  }

  get runner() { return this.run ? this.run.runner : null; }
}

// ---------------------------------------------------------------------------
// DefensePlay: the computer has the ball, you play one defender.
// The plan (what the offense does if you do not make the play) is decided up front.
// ---------------------------------------------------------------------------

function pathAt(path, t) {
  if (t <= path[0].t) return { x: path[0].x, y: path[0].y };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (t <= b.t) {
      const f = (t - a.t) / (b.t - a.t || 1);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  const last = path[path.length - 1];
  return { x: last.x, y: last.y };
}

// A ball carrier's route to where he ends up, with a little weaving.
function carrierPath(sx, sy, st, ex, ey, speed = 6.6) {
  const pts = [{ x: sx, y: sy, t: st }];
  const len = Math.hypot(ex - sx, ey - sy);
  const steps = Math.max(1, Math.round(len / 5));
  let t = st;
  let px = sx, py = sy;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const x = sx + (ex - sx) * f + (i < steps ? rand(-1.6, 1.6) : 0);
    const y = sy + (ey - sy) * f;
    t += Math.hypot(x - px, y - py) / speed;
    pts.push({ x: clamp(x, -SIDELINE + 0.5, SIDELINE - 0.5), y, t });
    px = x; py = y;
  }
  return pts;
}

export class DefensePlay {
  // plan from planOffense(); opts: { los, diff, emit }
  constructor(plan, opts) {
    this.plan = plan;
    this.d = DIFF[opts.diff] || DIFF.normal;
    this.emit = opts.emit || (() => {});
    this.los = opts.los;
    this.t = 0;
    this.done = false;
    this.me = { x: rand(-1, 1), y: this.los + 5.5, targetX: 0, down: 0, burstUntil: 0, burstLeft: 1, blockedUntil: 0 };
    this.me.targetX = this.me.x;
    this.qb = { x: 0, y: this.los - 1 };
    this.carrier = null;     // { x, y } once someone has the ball
    this.path = null;
    this.ball = null;
    this.contestAt = -10;
    this.inRange = false;
    this.phase = plan.type === 'run' ? 'run' : 'drop';

    if (plan.type === 'run') {
      const holeX = plan.dir * 3;
      const ey = this.los + plan.yards;
      const ex = plan.yards > 8 ? clamp(holeX * 2 + rand(-10, 10), -22, 22) : holeX + rand(-2, 2);
      this.path = [{ x: 0, y: this.los - 1, t: 0 }, { x: holeX * 0.4, y: this.los - 5, t: 0.45 }];
      const toLine = carrierPath(holeX * 0.4, this.los - 5, 0.45, holeX, this.los, 6.0);
      const rest = carrierPath(holeX, this.los, toLine[toLine.length - 1].t, ex, ey, plan.yards > 12 ? 7.0 : 6.2);
      this.path.push(...toLine.slice(1), ...rest.slice(1));
      if (plan.yards < 0) {
        this.path = [{ x: 0, y: this.los - 1, t: 0 }, { x: holeX * 0.4, y: this.los - 5, t: 0.45 }];
        this.path.push(...carrierPath(holeX * 0.4, this.los - 5, 0.45, holeX * 0.8, ey, 5).slice(1));
      }
      this.endT = this.path[this.path.length - 1].t;
      // Sometimes a blocker gets a hat on you.
      if (Math.random() < 0.3) this.me.blockedUntil = rand(0.7, 1.0) + rand(0.4, 1.0);
      this.blockStart = this.me.blockedUntil ? this.me.blockedUntil - rand(0.4, 1.0) : 0;
    }
  }

  input(action) {
    if (this.done) return;
    const m = this.me;
    if (action === 'left') m.targetX = clamp(m.targetX - 2, -SIDELINE, SIDELINE);
    else if (action === 'right') m.targetX = clamp(m.targetX + 2, -SIDELINE, SIDELINE);
    else if (action === 'burst') {
      if (m.burstLeft > 0) { m.burstLeft--; m.burstUntil = this.t + 1.3; this.emit('burst'); }
      else this.emit('noBurst');
    } else if (action === 'tackle') {
      if (this.t < m.down) return;
      if (this.carrier && this.phase !== 'drop' && this.phase !== 'flight') this.tryTackle();
      else { this.contestAt = this.t; this.emit('reach'); }
    }
  }

  tryTackle() {
    const m = this.me;
    const dd = dist(m, this.carrier);
    if (dd <= 1.7) {
      const p = 0.74 + this.d.tackleBonus - (dd > 1.2 ? 0.12 : 0);
      if (Math.random() < p) {
        this.emit('myTackle');
        const y = this.carrier.y;
        this.finishCarrier(y, 'tackle', true);
        return;
      }
      this.emit('myMiss');
      m.down = this.t + 1.0;
    } else {
      this.emit('dive');
      m.down = this.t + 0.8;
    }
  }

  finishCarrier(y, how, byMe = false) {
    const yards = y - this.los;
    let kind = 'gain';
    if (y >= 100) kind = 'td';
    const res = {
      kind, yards: Math.round(Math.min(y, 100) - this.los), endY: Math.min(y, 100), time: this.t + 0.3,
      byMe, how, playType: this.plan.type, caught: this.plan.type === 'pass',
      oob: how === 'oob', depth: this.plan.depth, dir: this.plan.dir, side: this.plan.side,
    };
    if (yards < 0 && y <= 0) res.kind = 'safety';
    this.finish(res);
  }

  finish(res) {
    if (this.done) return;
    this.done = true;
    this.result = res;
    this.emit('end', res);
  }

  moveMe(dt, targetY, chase) {
    const m = this.me;
    const t = this.t;
    if (t < m.down) return;
    if (t < m.blockedUntil && t > this.blockStart) return;
    const lat = clamp((m.targetX - m.x) * 6, -6, 6);
    m.x += lat * dt;
    if (targetY != null) {
      const sp = (t < m.burstUntil ? 8.6 : 6.4) * (chase ? 1 : 0.8);
      m.y += clamp(targetY - m.y, -sp * dt, sp * dt);
    }
  }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    const t = this.t;
    const m = this.me;
    const p = this.plan;

    if (this.phase === 'run' || this.phase === 'rac') {
      const pos = pathAt(this.path, t - (this.phase === 'rac' ? this.racStart : 0));
      this.carrier = pos;
      if (t > 0.35) this.moveMe(dt, pos.y, true);
      // Auto-follow helps you stay level with him across the field once you are close.
      const dd = dist(m, pos);
      const nowIn = dd <= 1.7 && t >= m.down;
      if (nowIn && !this.inRange) this.emit('inRange');
      this.inRange = nowIn;
      if (this.t >= (this.phase === 'rac' ? this.racStart + this.endT : this.endT)) {
        const y = pos.y;
        if (p.oob) this.finishCarrier(y, 'oob');
        else this.finishCarrier(y, 'tackle');
      }
      return;
    }

    if (this.phase === 'drop') {
      this.qb.y = this.los - 1 - Math.min(6, t * 4);
      this.moveMe(dt, null, false);
      if (t >= p.throwTime) {
        if (p.outcome === 'sack') {
          this.emit('sack');
          this.done = true;
          this.result = { kind: 'sack', yards: p.yards, time: t + 0.5 };
          this.emit('end', this.result);
          return;
        }
        if (p.outcome === 'away') {
          this.emit('throwAway');
          this.finish({ kind: 'incomplete', time: t + 0.6 });
          return;
        }
        this.phase = 'flight';
        this.ball = { from: { ...this.qb }, to: { x: p.landX, y: this.los + p.depthYards }, start: t, flight: p.flight };
        this.emit('throw', this.ball);
      }
      return;
    }

    if (this.phase === 'flight') {
      const b = this.ball;
      const f = clamp((t - b.start) / b.flight, 0, 1);
      b.x = b.from.x + (b.to.x - b.from.x) * f;
      b.y = b.from.y + (b.to.y - b.from.y) * f;
      // Break toward the ball.
      this.moveMe(dt, b.to.y, true);
      if (f >= 1) {
        const dd = dist(m, b.to);
        const timed = t - this.contestAt <= 0.6;
        let outcome = p.outcome;
        if (dd <= 2.6 && timed && t >= m.down) {
          const roll = Math.random() + this.d.tackleBonus * 0.5;
          outcome = roll > 0.78 ? 'int' : roll > 0.2 ? 'pbu' : 'catch';
        } else if (dd <= 2.6 && outcome === 'catch' && Math.random() < 0.25) {
          // Just being there makes the catch harder.
          outcome = 'incomplete';
        }
        if (outcome === 'int') {
          this.emit('myInt', b);
          this.finish({ kind: 'int', byMe: dd <= 2.6 && timed, spotY: b.to.y, spotX: b.to.x, time: t + 1.5 });
        } else if (outcome === 'pbu') {
          this.emit('breakup', b);
          this.finish({ kind: 'incomplete', byMe: true, time: t + 0.4 });
        } else if (outcome === 'incomplete') {
          this.emit('incomplete', b);
          this.finish({ kind: 'incomplete', time: t + 0.4 });
        } else {
          this.emit('catch', b);
          this.phase = 'rac';
          this.racStart = t;
          const ey = b.to.y + p.yac;
          const ex = clamp(b.to.x + rand(-6, 6) * (p.yac > 10 ? 2 : 1), -24, 24);
          this.path = carrierPath(b.to.x, b.to.y, 0, ex, ey, p.yac > 12 ? 7.2 : 6.4);
          this.endT = this.path[this.path.length - 1].t + 0.1;
          this.carrier = { x: b.to.x, y: b.to.y };
          // Too close to be beaten easily: a caught ball right on top of you can still be stopped.
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// What the computer's offense would gain against your call, before you make a play.
// ---------------------------------------------------------------------------

function normalish() { return (Math.random() + Math.random() + Math.random() - 1.5) / 0.5; } // about -3..3

export function planOffense(choice, call, diff, los) {
  const dmod = diff === 'easy' ? -0.7 : diff === 'hard' ? 0.7 : 0;
  const toGoal = 100 - los;
  if (choice.type === 'run') {
    let mean = 3.4 + dmod, spread = 3.0, big = 0.07, tfl = 0.1;
    if (call === 'run') { mean -= 1.6; big = 0.03; tfl = 0.16; }
    if (call === 'pass') { mean += 1.4; big = 0.1; tfl = 0.06; }
    if (call === 'blitz') { mean += 0.6; big = 0.13; tfl = 0.24; }
    let yards;
    const r = Math.random();
    if (r < tfl) yards = -Math.round(rand(1, 4));
    else if (r < tfl + big) yards = Math.round(rand(11, 45));
    else yards = Math.round(Math.max(0, mean + normalish() * spread));
    yards = Math.min(yards, toGoal + 1);
    return { type: 'run', dir: choice.dir, yards, oob: yards > 8 && Math.random() < 0.3 };
  }
  // Pass.
  const depthName = choice.depth;
  const baseDepth = DEPTHS[depthName];
  let pc = { short: 0.66, medium: 0.52, deep: 0.33 }[depthName] + (diff === 'easy' ? -0.06 : diff === 'hard' ? 0.05 : 0);
  let sack = 0.06, pInt = { short: 0.015, medium: 0.03, deep: 0.05 }[depthName];
  if (call === 'pass') { pc -= 0.12; sack = 0.04; pInt *= 1.5; }
  if (call === 'run') { pc += 0.1; sack = 0.04; }
  if (call === 'blitz') { pc += depthName === 'short' ? 0.04 : -0.08; sack = 0.15; }
  const r = Math.random();
  const side = [-1, 0, 1][Math.floor(Math.random() * 3)];
  const depthYards = Math.min(baseDepth + rand(-2, 2) * (depthName === 'deep' ? 2 : 1), toGoal + 2);
  const landX = side * 15 + rand(-3, 3) + (side === 0 ? -3 : 0);
  const flight = { short: 0.55, medium: 0.9, deep: 1.5 }[depthName];
  const throwTime = rand(1.4, 2.6) + (depthName === 'deep' ? 0.6 : 0);
  if (r < sack) return { type: 'pass', depth: depthName, outcome: 'sack', yards: -Math.round(rand(4, 9)), throwTime: throwTime + 0.6 };
  let outcome;
  const r2 = Math.random();
  if (r2 < pInt) outcome = 'int';
  else if (r2 < pInt + pc) outcome = 'catch';
  else outcome = 'incomplete';
  let yac = Math.round(Math.max(0, rand(0, 4) + (Math.random() < 0.06 ? rand(10, 40) : 0)));
  yac = Math.min(yac, Math.max(0, toGoal - depthYards));
  return { type: 'pass', depth: depthName, side, outcome, landX, depthYards, flight, throwTime, yac };
}
