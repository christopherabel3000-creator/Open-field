// Gestures and keyboard, turned into the same game actions.
// Actions: left, right, up, down, select, tap, status, repeat, pause, digit1..digit9
//
// Keyboard: arrows, Space or Enter, 1 to 9, S, R, Escape or P.
// Phone: swipe left, right, up, down; tap; double tap; two-finger tap to pause.

const SWIPE_MIN = 30;    // pixels
const TAP_MAX_MOVE = 18;
const TAP_MAX_TIME = 400; // ms
const DOUBLE_TAP = 350;   // ms between taps

export class Input {
  constructor(surface, onAction) {
    this.surface = surface;
    this.onAction = onAction;
    this.enabled = false;
    this.touch = null;
    this.lastTap = 0;
    this.lastArrow = { left: 0, right: 0 };

    this._onKey = this._onKey.bind(this);
    this._onStart = this._onStart.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onEnd = this._onEnd.bind(this);

    document.addEventListener('keydown', this._onKey);
    surface.addEventListener('touchstart', this._onStart, { passive: false });
    surface.addEventListener('touchmove', this._onMove, { passive: false });
    surface.addEventListener('touchend', this._onEnd, { passive: false });
    surface.addEventListener('touchcancel', () => { this.touch = null; });
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; this.touch = null; }

  _emit(action, extra) { if (this.enabled) this.onAction(action, extra); }

  _onKey(e) {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    // On a menu button (the pause menu), only Escape and P reach the game.
    const onControl = e.target && e.target !== this.surface && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(e.target.tagName);
    if (onControl && !(k === 'Escape' || k === 'p' || k === 'P')) return;
    let action = null;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      // Holding an arrow keeps cutting, but not faster than about 6 cuts a second.
      const dir = k === 'ArrowLeft' ? 'left' : 'right';
      const now = performance.now();
      if (!e.repeat || now - this.lastArrow[dir] > 160) { this.lastArrow[dir] = now; action = dir; }
    }
    else if (k === 'ArrowUp') action = e.repeat ? null : 'up';
    else if (k === 'ArrowDown') action = e.repeat ? null : 'down';
    else if (k === ' ' || k === 'Enter') action = e.repeat ? null : 'select';
    else if (k >= '1' && k <= '9') action = e.repeat ? null : 'digit' + k;
    else if (k === 's' || k === 'S') action = e.repeat ? null : 'status';
    else if (k === 'r' || k === 'R') action = e.repeat ? null : 'repeat';
    else if (k === 'Escape' || k === 'p' || k === 'P') action = e.repeat ? null : 'pause';
    if (k.startsWith('Arrow') || k === ' ' || k === 'Enter') e.preventDefault();
    if (action) { e.preventDefault(); this._emit(action, { source: 'key' }); }
  }

  _onStart(e) {
    if (!this.enabled) return;
    // A single finger on a button (the pause menu) works as a normal button press.
    if (!this.touch && e.touches.length === 1 && e.target.closest && e.target.closest('button')) return;
    e.preventDefault();
    const t = e.touches[0];
    if (!this.touch) {
      this.touch = { x: t.clientX, y: t.clientY, time: performance.now(), maxFingers: e.touches.length, lastX: t.clientX, lastY: t.clientY };
    } else {
      this.touch.maxFingers = Math.max(this.touch.maxFingers, e.touches.length);
    }
  }

  _onMove(e) {
    if (!this.enabled || !this.touch) return;
    e.preventDefault();
    const t = e.touches[0];
    this.touch.lastX = t.clientX;
    this.touch.lastY = t.clientY;
  }

  _onEnd(e) {
    if (!this.enabled || !this.touch) return;
    e.preventDefault();
    if (e.touches.length > 0) return; // wait until every finger is up
    const s = this.touch;
    this.touch = null;
    const ct = e.changedTouches[0];
    const x = ct ? ct.clientX : s.lastX;
    const y = ct ? ct.clientY : s.lastY;
    const dx = x - s.x, dy = y - s.y;
    const dist = Math.hypot(dx, dy);
    const dt = performance.now() - s.time;
    const src = { source: 'touch' };

    if (s.maxFingers >= 2) {
      if (dist < 60) this._emit('pause', src);
      return;
    }
    if (dist <= TAP_MAX_MOVE && dt <= TAP_MAX_TIME) {
      const now = performance.now();
      this._emit('tap', src);
      if (now - this.lastTap < DOUBLE_TAP) { this.lastTap = 0; this._emit('doubleTap', src); }
      else this.lastTap = now;
      return;
    }
    if (dist >= SWIPE_MIN) {
      if (Math.abs(dx) > Math.abs(dy)) this._emit(dx < 0 ? 'left' : 'right', src);
      else this._emit(dy < 0 ? 'up' : 'down', src);
    }
  }
}
