// Müzik kaynakları. Hepsi aynı arayüzü uygular:
//   start(), stop(), skip(), planNext(mood) → meta, transitionTo(meta?, opts), nowPlaying(), timeToTrackEnd(), setStyle(style)
// GenerativeMusic: tarayıcıda üretilen telifsiz müzik (varsayılan).
// StreamMusic: kullanıcının verdiği internet radyosu adresi.
// SilentMusic: müziksiz (sadece DJ'ler).

import { composeTrack, chooseStyle, trackMeta } from './composer.js';
import { renderChunk, chunkDuration } from './renderer.js';

const LOOKAHEAD = 9; // saniye: bu kadar ileriyi hazır tut

export class GenerativeMusic {
  constructor(engine, { style = 'auto', onTrack = () => {}, log = () => {} } = {}) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.style = style;
    this.onTrack = onTrack;
    this.log = log;
    this.current = null;   // { track, gain, nextChunk, nextTime, startTime, sources }
    this.next = null;      // planlanmış sonraki parça
    this.cache = new Map();
    this.rendering = false;
    this.timer = null;
    this.mood = null;
    this.history = [];
  }

  setStyle(style) { this.style = style || 'auto'; }

  compose(mood = this.mood) {
    const style = chooseStyle(this.style, mood, new Date().getHours());
    let t = composeTrack({ style, mood });
    // Aynı adı yakın zamanda kullandıysak yeniden dene
    for (let i = 0; i < 3 && this.history.includes(t.title); i++) t = composeTrack({ style, mood });
    return t;
  }

  async start() {
    if (this.timer) return;
    this.running = true;
    if (!this.current) await this.startTrack(this.next || this.compose(), this.ctx.currentTime + 0.1);
    this.next = null;
    this.timer = setInterval(() => this.pump().catch((e) => this.log('music pump', e)), 400);
  }

  stop(fade = 1.2) {
    this.running = false;
    clearInterval(this.timer); this.timer = null;
    if (this.current) this.fadeOutAndStop(this.current, fade);
    this.current = null;
  }

  fadeOutAndStop(cur, fade) {
    const now = this.ctx.currentTime;
    try {
      cur.gain.gain.cancelScheduledValues(now);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, now);
      cur.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
    } catch { /* yoksay */ }
    setTimeout(() => {
      for (const s of cur.sources) { try { s.stop(); } catch { /* */ } }
      try { cur.gain.disconnect(); } catch { /* */ }
    }, (fade + 0.2) * 1000);
    cur.dead = true;
  }

  async getChunk(track, i) {
    const key = track.id + ':' + i;
    if (this.cache.has(key)) { const b = this.cache.get(key); this.cache.delete(key); return b; }
    return renderChunk(track, i, this.ctx.sampleRate);
  }

  async startTrack(track, when) {
    const gain = this.ctx.createGain();
    gain.connect(this.engine.musicIn);
    const cur = { track, gain, nextChunk: 0, nextTime: when, startTime: when, sources: [] };
    this.current = cur;
    this.history.push(track.title); if (this.history.length > 12) this.history.shift();
    const delayMs = Math.max(0, (when - this.ctx.currentTime) * 1000);
    setTimeout(() => { if (!cur.dead) this.onTrack(trackMeta(track)); }, delayMs);
    await this.pump(true);
  }

  async pump(force = false) {
    if ((this.rendering && !force) || !this.current) return;
    this.rendering = true;
    try {
      let cur = this.current;
      while (cur && !cur.dead && cur.nextChunk < cur.track.chunks.length && cur.nextTime - this.ctx.currentTime < LOOKAHEAD) {
        const i = cur.nextChunk;
        const buf = await this.getChunk(cur.track, i);
        if (cur !== this.current || cur.dead) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(cur.gain);
        const startAt = Math.max(cur.nextTime, this.ctx.currentTime + 0.03);
        src.start(startAt);
        cur.sources.push(src);
        src.onended = () => { const k = cur.sources.indexOf(src); if (k >= 0) cur.sources.splice(k, 1); };
        if (startAt > cur.nextTime + 0.05) { cur.startTime += startAt - cur.nextTime; } // gecikme telafisi
        cur.nextTime = startAt + chunkDuration(cur.track, i);
        cur.nextChunk++;
      }
      // Tüm parçalar zamanlandıysa bir sonrakini tam bitişte başlat (kesintisiz geçiş)
      if (cur && !cur.dead && cur.nextChunk >= cur.track.chunks.length && this.running) {
        const nextTrack = this.next || this.compose();
        this.next = null;
        const old = cur;
        this.rendering = false;
        await this.startTrack(nextTrack, cur.nextTime + 0.6);
        // eski parçanın kaynakları kendi kendine biter
        setTimeout(() => { try { old.gain.disconnect(); } catch { /* */ } }, (old.nextTime - this.ctx.currentTime + 5) * 1000);
      }
    } finally {
      this.rendering = false;
    }
  }

  /** Sonraki parçayı planlar ve ilk bölümünü önceden render eder. */
  async planNext(mood) {
    if (mood) this.mood = mood;
    const t = this.compose(mood || this.mood);
    this.next = t;
    try {
      const buf = await renderChunk(t, 0, this.ctx.sampleRate);
      this.cache.clear();
      this.cache.set(t.id + ':0', buf);
    } catch (e) { this.log('prerender', e); }
    return trackMeta(t);
  }

  /** DJ konuşması başlarken: mevcut parçayı kıs, planlanan parçayı (intro'suyla) başlat. */
  async transitionTo({ fade = 2.5, delay = 0.6 } = {}) {
    const track = this.next || this.compose();
    this.next = null;
    if (this.current) this.fadeOutAndStop(this.current, fade);
    this.current = null;
    await this.startTrack(track, this.ctx.currentTime + delay);
    return trackMeta(track);
  }

  async skip() {
    this.next = this.compose();
    return this.transitionTo({ fade: 1.0, delay: 0.3 });
  }

  nowPlaying() {
    const c = this.current;
    if (!c) return null;
    const m = trackMeta(c.track);
    m.position = Math.max(0, this.ctx.currentTime - c.startTime);
    return m;
  }

  timeToTrackEnd() {
    const c = this.current;
    if (!c) return Infinity;
    return c.track.duration - (this.ctx.currentTime - c.startTime);
  }

  plannedMeta() { return this.next ? trackMeta(this.next) : null; }
}

/** İnternet radyo akışı (ör. Icecast). Ses öğesinin kendi seviyesiyle kısılır. */
export class StreamMusic {
  constructor(engine, { url, onTrack = () => {}, log = () => {} } = {}) {
    this.engine = engine; this.url = url; this.onTrack = onTrack; this.log = log;
    this.audio = null; this.level = 1; this.duck = 1; this.tween = null;
  }

  setStyle() {}

  async start() {
    if (this.audio) return;
    const a = new Audio();
    a.src = this.url;
    a.preload = 'none';
    a.volume = 0;
    this.audio = a;
    a.addEventListener('error', () => this.log('stream error', a.error));
    await a.play();
    this.applyVolume(1.5);
    this.onTrack({ id: 'stream', title: 'Canlı yayın akışı', artist: hostOf(this.url), style: 'stream', styleLabel: 'internet radyosu', mood: null, bpm: 0, duration: 0 });
  }

  setLevels(musicVol, duck) { this.level = musicVol; this.duck = duck; this.applyVolume(0.6); }

  applyVolume(seconds) {
    if (!this.audio) return;
    const target = Math.max(0, Math.min(1, this.level * this.duck * (this.engine.masterLevel ?? 1)));
    clearInterval(this.tween);
    const from = this.audio.volume;
    const steps = Math.max(1, Math.round(seconds * 20));
    let i = 0;
    this.tween = setInterval(() => {
      i++;
      if (!this.audio) return clearInterval(this.tween);
      this.audio.volume = from + (target - from) * (i / steps);
      if (i >= steps) clearInterval(this.tween);
    }, 50);
  }

  stop() {
    clearInterval(this.tween);
    if (this.audio) { this.audio.pause(); this.audio.src = ''; this.audio = null; }
  }

  async skip() { return this.nowPlaying(); }
  async planNext() { return null; }
  async transitionTo() { return null; }
  nowPlaying() { return this.audio ? { id: 'stream', title: 'Canlı yayın akışı', artist: hostOf(this.url), style: 'stream', styleLabel: 'internet radyosu' } : null; }
  timeToTrackEnd() { return Infinity; }
  plannedMeta() { return null; }
}

function hostOf(url) { try { return new URL(url).host; } catch { return 'akış'; } }

export class SilentMusic {
  setStyle() {}
  async start() {}
  stop() {}
  async skip() { return null; }
  async planNext() { return null; }
  async transitionTo() { return null; }
  nowPlaying() { return null; }
  timeToTrackEnd() { return Infinity; }
  plannedMeta() { return null; }
}
