// Game rules: downs, clock, scoring, kicks, and the computer coach's decisions.
// ball = yards from the team with the ball's own goal line (0 to 100).

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const OFFENSE_PLAYS = [
  { id: 'runLeft', name: 'Run left', type: 'run', dir: -1 },
  { id: 'runMiddle', name: 'Run up the middle', type: 'run', dir: 0 },
  { id: 'runRight', name: 'Run right', type: 'run', dir: 1 },
  { id: 'passShort', name: 'Short pass', type: 'pass', depth: 'short' },
  { id: 'passMedium', name: 'Medium pass', type: 'pass', depth: 'medium' },
  { id: 'passDeep', name: 'Deep pass', type: 'pass', depth: 'deep' },
];

export const DEFENSE_CALLS = [
  { id: 'run', name: 'Run defense' },
  { id: 'balanced', name: 'Balanced' },
  { id: 'pass', name: 'Pass defense' },
  { id: 'blitz', name: 'Blitz' },
];

export function fgDistance(ball) { return Math.round(100 - ball + 17); }

export function fgChance(distance) {
  if (distance <= 29) return 0.97;
  if (distance <= 39) return 0.92;
  if (distance <= 49) return 0.82;
  if (distance <= 54) return 0.68;
  if (distance <= 59) return 0.5;
  if (distance <= 63) return 0.3;
  return 0.08;
}

function num(n) {
  return ['zero', 'one', 'two', 'three'][n] ?? String(n);
}

export function ordinal(n) { return ['', '1st', '2nd', '3rd', '4th'][n] || `${n}th`; }

export function clockText(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class Game {
  constructor({ quarterMinutes = 5, diff = 'normal' } = {}) {
    this.qlen = quarterMinutes * 60;
    this.diff = diff;
    this.score = { you: 0, cpu: 0 };
    this.quarter = 1;
    this.clock = this.qlen;
    this.timeouts = { you: 3, cpu: 3 };
    this.poss = 'you';
    this.ball = 25;
    this.down = 1;
    this.toGo = 10;
    this.clockRunning = false;   // true when the clock keeps going until the next snap
    this.warned = false;         // two-minute warning given this half
    this.over = false;
    this.overtime = false;
    this.pending = null;         // 'pat' after a touchdown, 'kickoff' after a score
    this.kicker = null;
    this.firstReceiver = null;
    this.stats = { you: { yards: 0, plays: 0 }, cpu: { yards: 0, plays: 0 } };
  }

  other(team) { return team === 'you' ? 'cpu' : 'you'; }

  // Where the ball is, said from your point of view.
  spotText(ball = this.ball, poss = this.poss) {
    const b = Math.round(ball);
    if (b === 50) return 'midfield';
    const ownSide = b < 50;
    const yard = ownSide ? b : 100 - b;
    const yoursSide = (poss === 'you') === ownSide;
    if (yard <= 0) return yoursSide ? 'your goal line' : 'their goal line';
    return `${yoursSide ? 'your' : 'their'} ${yard}`;
  }

  downText() {
    const goal = this.ball + this.toGo >= 100;
    const dist = goal ? 'goal' : (this.toGo < 1 ? 'inches' : String(Math.round(this.toGo)));
    return `${ordinal(this.down)} and ${dist} at ${this.spotText()}`;
  }

  scoreText() {
    const { you, cpu } = this.score;
    if (you === cpu) return `Tied ${you} to ${cpu}`;
    return you > cpu ? `You lead ${you} to ${cpu}` : `They lead ${cpu} to ${you}`;
  }

  quarterText() {
    if (this.overtime) return 'overtime';
    return `${ordinal(this.quarter)} quarter`;
  }

  statusText() {
    const parts = [this.scoreText() + '.', `${clockText(this.clock)} left in the ${this.quarterText()}.`];
    if (!this.pending) parts.push(`${this.poss === 'you' ? 'Your' : 'Their'} ball, ${this.downText()}.`);
    parts.push(`Timeouts: you ${num(this.timeouts.you)}, them ${num(this.timeouts.cpu)}.`);
    return parts.join(' ');
  }

  inLastTwo() { return (this.quarter === 2 || this.quarter >= 4) && this.clock <= 120; }

  // ---------- Starting and kicking ----------

  coinToss() {
    const youWin = Math.random() < 0.5;
    this.firstReceiver = youWin ? 'you' : 'cpu';
    return youWin ? 'You win the coin toss and will receive.' : 'They win the coin toss and will receive.';
  }

  // Kickoff from the kicking team to the other. Returns commentary.
  kickoff(kicker) {
    const receiver = this.other(kicker);
    this.poss = receiver;
    this.clockRunning = false;
    const r = Math.random();
    let text;
    if (r < 0.55) {
      this.ball = 30;
      text = 'Touchback.';
    } else if (r < 0.97) {
      this.ball = Math.round(rand(18, 42));
      text = `Returned to ${this.spotText(this.ball, receiver)}.`;
    } else {
      this.ball = Math.round(rand(50, 75));
      text = `A big return, all the way to ${this.spotText(this.ball, receiver)}!`;
    }
    this.firstDown();
    this.pending = null;
    const who = kicker === 'you' ? 'You kick off.' : 'They kick off.';
    return `${who} ${text}`;
  }

  freeKickAfterSafety(kicker) {
    const receiver = this.other(kicker);
    this.poss = receiver;
    this.ball = Math.round(rand(35, 48));
    this.firstDown();
    this.pending = null;
    this.clockRunning = false;
    return `Free kick after the safety. ${receiver === 'you' ? 'You take over' : 'They take over'} at ${this.spotText()}.`;
  }

  firstDown() {
    this.down = 1;
    this.toGo = Math.min(10, 100 - this.ball);
  }

  changePossession(newBall) {
    this.poss = this.other(this.poss);
    this.ball = newBall;
    this.firstDown();
    this.clockRunning = false;
  }

  // ---------- The clock ----------

  // Time that ticks off before the snap. Called when a play is about to run.
  // Returns true if the quarter ran out first.
  preSnap(timeoutCalled) {
    if (!this.clockRunning || timeoutCalled) { this.clockRunning = false; return false; }
    let runoff = 28;
    const offense = this.poss;
    const lead = this.score[offense] - this.score[this.other(offense)];
    if (this.inLastTwo()) runoff = lead > 0 ? 38 : 12;
    return this.tick(runoff, true);
  }

  // Takes seconds off. Returns true when the quarter has ended.
  tick(sec, beforeSnap = false) {
    const wasAbove = this.clock > 120;
    this.clock -= sec;
    const warnQuarter = (this.quarter === 2 || this.quarter === 4) && !this.overtime;
    if (warnQuarter && wasAbove && this.clock <= 120 && this.qlen >= 300 && !this.warned) {
      this.warned = true;
      if (beforeSnap) this.clock = 120;
      this.warningNow = true;
      this.clockRunning = false;
      if (this.clock > 0) return false;
    }
    if (this.clock <= 0) { this.clock = 0; return true; }
    return false;
  }

  useTimeout(team) {
    if (this.timeouts[team] <= 0) return false;
    this.timeouts[team]--;
    this.clockRunning = false;
    return true;
  }

  // Whether calling a timeout would save time right now.
  timeoutUseful() { return this.clockRunning && this.clock > 0; }

  // ---------- After each play ----------

  // res: { kind, yards, oob, time, caught } from the play engine (from the offense's view).
  // Returns { text, event } where event can be 'td', 'safety', 'turnover', 'endQuarter', etc.
  resolvePlay(res, play) {
    const offense = this.poss;
    const off = offense === 'you' ? 'You' : 'They';
    const defense = this.other(offense);
    const before = this.ball;
    let text = '';
    let event = null;
    let stopClock = false;
    const playSecs = Math.max(3, Math.round(res.time || 5));

    if (res.kind === 'incomplete') {
      text = res.away ? 'Thrown away. Incomplete.' : 'Incomplete.';
      if (res.byMe) text = 'Broken up! Incomplete.';
      stopClock = true;
      this.nextDown(0);
    } else if (res.kind === 'int') {
      const spot = Math.min(99, Math.max(1, Math.round(res.spotY)));
      const ret = Math.round(rand(0, 14));
      this.stats[offense].plays++;
      let newBall = 100 - spot + ret;
      let tb = false;
      if (res.spotY >= 100) { newBall = 20; tb = true; }
      newBall = Math.min(newBall, 99);
      text = res.byMe ? 'Intercepted! You picked it off!' : `Intercepted by ${defense === 'you' ? 'your defense' : 'them'}!`;
      this.changePossession(newBall);
      text += tb ? ' Touchback.' : ` ${defense === 'you' ? 'You take over' : 'They take over'} at ${this.spotText()}.`;
      stopClock = true;
      event = 'turnover';
    } else if (res.kind === 'sack') {
      const y = res.yards;
      this.ball += y;
      this.stats[offense].yards += y; this.stats[offense].plays++;
      text = `Sacked for a loss of ${-y}.`;
      if (this.ball <= 0) return this.safety(playSecs, offense);
      this.nextDown(y);
    } else {
      // Gain on a run or a catch.
      let endY = res.endY != null ? res.endY : this.ball + res.yards;
      let gained = Math.round(endY - before);
      if (res.kind === 'td' || endY >= 100) {
        gained = 100 - before;
        this.stats[offense].yards += gained; this.stats[offense].plays++;
        this.tick(playSecs);
        this.score[offense] += 6;
        this.pending = 'pat';
        this.clockRunning = false;
        const what = res.caught ? 'Caught' : 'Run';
        return { text: `${gained} yard${gained === 1 ? '' : 's'}. Touchdown! ${what} for the score.`, event: 'td' };
      }
      this.ball = before + gained;
      this.stats[offense].yards += gained; this.stats[offense].plays++;
      if (this.ball <= 0) return this.safety(playSecs, offense);
      const verb = res.caught ? 'Caught' : (play && play.type === 'run' ? '' : '');
      text = gained > 0 ? `${res.caught ? 'Complete. ' : ''}Gain of ${gained}.` : gained === 0 ? `${res.caught ? 'Complete, ' : ''}No gain.` : `${res.caught ? 'Complete, ' : ''}Loss of ${-gained}.`;
      if (gained === 1) text = `${res.caught ? 'Complete. ' : ''}Gain of 1.`;
      if (res.oob || res.kind === 'oob') { text += ' Out of bounds.'; if (this.inLastTwo()) stopClock = true; }
      void verb;
      this.nextDown(gained);
    }

    // Clock.
    const ended = this.tick(playSecs);
    this.clockRunning = !stopClock && event !== 'turnover';
    if (this.turnoverOnDowns) {
      this.turnoverOnDowns = false;
      text += ` Turnover on downs. ${defense === 'you' ? 'Your ball' : 'Their ball'} at ${this.spotText()}.`;
      event = 'turnover';
      this.clockRunning = false;
    } else if (event !== 'turnover' && this.justFirst) {
      text += ' First down!';
    }
    this.justFirst = false;
    if (ended) event = event || 'endQuarter';
    return { text, event, ended };
  }

  nextDown(gained) {
    this.toGo -= gained;
    if (this.toGo <= 0) {
      this.firstDown();
      this.justFirst = true;
      return;
    }
    this.down++;
    if (this.down > 4) {
      // Turnover on downs at the spot.
      this.poss = this.other(this.poss);
      this.ball = 100 - this.ball;
      this.firstDown();
      this.turnoverOnDowns = true;
    }
  }

  safety(playSecs, offense) {
    const defense = this.other(offense);
    this.score[defense] += 2;
    this.tick(playSecs);
    this.pending = 'safetyKick';
    this.kicker = offense;
    this.clockRunning = false;
    return { text: 'Tackled in the end zone. Safety! Two points.', event: 'safety' };
  }

  // ---------- Kicks the offense chooses ----------

  punt() {
    const kicker = this.poss;
    const gross = Math.round(rand(37, 52));
    let land = this.ball + gross;
    let text = `${kicker === 'you' ? 'You punt' : 'They punt'}, ${gross} yards. `;
    let newBall;
    if (land >= 100) { newBall = 20; text += 'Touchback.'; }
    else {
      const ret = Math.random() < 0.4 ? 0 : Math.round(rand(0, 12));
      if (Math.random() < 0.02) {
        const big = Math.round(rand(20, 50));
        land -= big;
        text += 'A long return! ';
      } else land -= ret;
      newBall = Math.max(1, 100 - Math.round(land));
      if (ret === 0) text += 'Fair catch. ';
    }
    this.tick(Math.round(rand(6, 10)));
    this.changePossession(newBall);
    if (!text.includes('Touchback')) text += `${this.poss === 'you' ? 'You take over' : 'They take over'} at ${this.spotText()}.`;
    return { text, event: this.clock <= 0 ? 'endQuarter' : 'turnover', ended: this.clock <= 0 };
  }

  fieldGoal() {
    const kicker = this.poss;
    const dist = fgDistance(this.ball);
    const good = Math.random() < fgChance(dist) + (kicker === 'you' && this.diff === 'easy' ? 0.05 : 0);
    const ended = this.tick(5);
    if (good) {
      this.score[kicker] += 3;
      this.pending = 'kickoff';
      this.kicker = kicker;
      this.clockRunning = false;
      return { text: `${dist} yard field goal is good!`, event: 'fg', good: true, ended };
    }
    // Missed: the other team takes over at the spot of the kick, or their 20.
    const spot = this.ball - 7;
    const newBall = Math.max(20, 100 - spot);
    this.changePossession(newBall);
    return { text: `${dist} yard field goal is no good. ${this.poss === 'you' ? 'You take over' : 'They take over'} at ${this.spotText()}.`, event: 'turnover', good: false, ended };
  }

  kneel() {
    this.ball -= 1;
    this.stats[this.poss].plays++;
    this.nextDown(-1);
    const ended = this.tick(Math.min(this.clock, 40));
    this.clockRunning = true;
    let text = 'Kneel down.';
    if (this.turnoverOnDowns) { this.turnoverOnDowns = false; text += ' Turnover on downs.'; }
    return { text, event: ended ? 'endQuarter' : null, ended };
  }

  // ---------- After a touchdown ----------

  extraPoint(team) {
    const good = Math.random() < 0.94;
    if (good) this.score[team] += 1;
    this.pending = 'kickoff';
    this.kicker = team;
    return good ? 'The extra point is good.' : 'The extra point is no good!';
  }

  twoPointResult(team, success) {
    if (success) this.score[team] += 2;
    this.pending = 'kickoff';
    this.kicker = team;
    return success ? 'The two point try is good!' : 'The two point try fails.';
  }

  // ---------- End of quarters ----------

  // Called when the clock hits zero. Returns commentary and whether the game is over.
  endQuarter() {
    if (this.overtime) {
      this.over = true;
      return { text: `End of overtime. ${this.finalText()}`, over: true };
    }
    if (this.quarter === 1 || this.quarter === 3) {
      this.quarter++;
      this.clock = this.qlen;
      return { text: `End of the ${ordinal(this.quarter - 1)} quarter. ${this.scoreText()}.` };
    }
    if (this.quarter === 2) {
      this.quarter = 3;
      this.clock = this.qlen;
      this.timeouts = { you: 3, cpu: 3 };
      this.warned = false;
      this.pending = 'kickoff';
      this.kicker = this.firstReceiver;
      this.clockRunning = false;
      return { text: `Halftime. ${this.scoreText()}.`, half: true };
    }
    // End of the fourth.
    if (this.score.you === this.score.cpu) {
      this.overtime = true;
      this.quarter = 5;
      this.clock = Math.min(this.qlen, 600);
      this.timeouts = { you: 2, cpu: 2 };
      this.pending = 'kickoff';
      this.kicker = Math.random() < 0.5 ? 'you' : 'cpu';
      this.clockRunning = false;
      return { text: `End of regulation, tied ${this.score.you} to ${this.score.cpu}. We go to overtime. The next score wins.`, ot: true };
    }
    this.over = true;
    return { text: `That's the game. ${this.finalText()}`, over: true };
  }

  finalText() {
    const { you, cpu } = this.score;
    if (you > cpu) return `You win, ${you} to ${cpu}!`;
    if (cpu > you) return `They win, ${cpu} to ${you}.`;
    return `It ends in a tie, ${you} to ${cpu}.`;
  }

  // In overtime the first score ends it.
  checkSuddenDeath() {
    if (this.overtime && this.score.you !== this.score.cpu) {
      this.over = true;
      return `${this.finalText()}`;
    }
    return null;
  }

  // ---------- The computer coach ----------

  cpuOffenseChoice() {
    const toGoal = 100 - this.ball;
    const lead = this.score.cpu - this.score.you;
    const late = this.inLastTwo() && this.quarter >= 4;
    // Kneel only when the kneels can run out the clock.
    const downsLeft = 5 - this.down;
    if (late && lead > 0 && this.clockRunning && this.clock <= (downsLeft - this.timeouts.you) * 40) return { kind: 'kneel' };
    if (this.down === 4) {
      const dist = fgDistance(this.ball);
      const desperate = late && lead < 0;
      const needTd = desperate && lead < -3;
      if (!needTd && dist <= 52 && (!desperate || lead >= -3)) return { kind: 'fg' };
      if (desperate || (this.toGo <= 1 && toGoal < 55) || (this.toGo <= 2 && toGoal <= 40 && dist > 52)) {
        return { kind: 'play', play: this.cpuPlay(true) };
      }
      return { kind: 'punt' };
    }
    // End of half with the clock nearly out: kick it if in range.
    if (this.clock <= 8 && (this.quarter === 2 || this.quarter >= 4) && fgDistance(this.ball) <= 55 &&
        (this.quarter === 2 || (lead >= -3 && lead <= 0))) return { kind: 'fg' };
    return { kind: 'play', play: this.cpuPlay(false) };
  }

  cpuPlay(mustGain) {
    const lead = this.score.cpu - this.score.you;
    let passChance = 0.45;
    if (this.down === 3 && this.toGo >= 5) passChance = 0.82;
    else if (this.down >= 2 && this.toGo >= 8) passChance = 0.6;
    if (this.toGo <= 2) passChance = 0.25;
    if (this.inLastTwo() && lead < 0) passChance = 0.85;
    if (this.inLastTwo() && lead > 0) passChance = 0.2;
    if (mustGain && this.toGo > 4) passChance = 0.9;
    if (Math.random() < passChance) {
      let depth;
      const r = Math.random();
      if (this.toGo >= 15 || (this.inLastTwo() && lead < -3 && this.clock < 40)) depth = r < 0.55 ? 'deep' : 'medium';
      else if (this.toGo <= 5) depth = r < 0.6 ? 'short' : r < 0.9 ? 'medium' : 'deep';
      else depth = r < 0.4 ? 'short' : r < 0.82 ? 'medium' : 'deep';
      depth = 100 - this.ball <= 12 && depth === 'deep' ? 'medium' : depth;
      return OFFENSE_PLAYS.find(p => p.type === 'pass' && p.depth === depth);
    }
    return pick(OFFENSE_PLAYS.filter(p => p.type === 'run'));
  }

  cpuDefenseCall() {
    const r = Math.random();
    if (this.down === 3 && this.toGo >= 7) return r < 0.5 ? 'pass' : r < 0.8 ? 'blitz' : 'balanced';
    if (this.toGo <= 2) return r < 0.55 ? 'run' : r < 0.75 ? 'blitz' : 'balanced';
    if (this.down === 1) return r < 0.5 ? 'balanced' : r < 0.75 ? 'run' : r < 0.9 ? 'pass' : 'blitz';
    return r < 0.45 ? 'balanced' : r < 0.65 ? 'pass' : r < 0.83 ? 'run' : 'blitz';
  }

  // Whether the computer stops the clock before this snap.
  cpuWantsTimeout() {
    if (!this.clockRunning || this.timeouts.cpu <= 0) return false;
    const late = (this.quarter === 2 || this.quarter >= 4) && this.clock <= 120;
    if (!late) return false;
    const lead = this.score.cpu - this.score.you;
    if (this.poss === 'cpu') return lead <= 0 || this.quarter === 2;
    // On defense, save time to get the ball back when behind or close.
    return this.quarter >= 4 && lead <= 0;
  }

  cpuGoesForTwo() {
    const lead = this.score.cpu - this.score.you; // after the touchdown
    return this.quarter >= 4 && [-2, -5, -10, 1].includes(lead) && this.clock < 400;
  }
}
