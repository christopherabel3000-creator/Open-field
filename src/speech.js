// Commentary: spoken by the game's own voice, or sent to the screen reader.

export class Speaker {
  constructor(liveRegion) {
    this.live = liveRegion;
    this.mode = 'game'; // 'game' or 'reader'
    this.rate = 1.1;
    this.last = '';
    this.voice = null;
    this._pickVoice();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => this._pickVoice();
    }
  }

  _pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    this.voice = voices.find(v => v.lang === 'en-US' && v.localService) ||
      voices.find(v => v.lang && v.lang.startsWith('en')) || null;
  }

  // urgent: cut off whatever is being said.
  say(text, { urgent = false, remember = true } = {}) {
    if (!text) return;
    if (remember) this.last = text;
    if (this.mode === 'reader' || !('speechSynthesis' in window)) {
      // Clear then set, so the same text is announced again.
      this.live.textContent = '';
      setTimeout(() => { this.live.textContent = text; }, 30);
      return;
    }
    const s = window.speechSynthesis;
    if (urgent) s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = this.rate;
    u.volume = 1;
    s.speak(u);
  }

  // iPhone only allows speech that starts inside a tap, so speak a silent word right away.
  prime() {
    if (this.primed || !('speechSynthesis' in window)) return;
    this.primed = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  repeat() { if (this.last) this.say(this.last, { urgent: true }); }

  stop() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
}
