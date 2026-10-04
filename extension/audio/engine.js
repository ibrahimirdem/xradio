// Ses motoru: mikser, DJ sesi işleme zinciri, müziği kısma (ducking), limiter, görselleştirici.

export class AudioEngine {
  constructor() {
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.masterLevel = 0.9;
    this.musicLevel = 0.7;
    this.voiceLevel = 1;
    this.duckValue = 1;
    this.listeners = new Set();

    this.master = ctx.createGain();
    this.master.gain.value = this.masterLevel;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.002; limiter.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    this.master.connect(limiter).connect(this.analyser).connect(ctx.destination);

    // Müzik yolu (yerleşik motor / Web Audio kaynakları)
    this.musicIn = ctx.createGain();
    this.musicIn.gain.value = this.musicLevel;
    this.duck = ctx.createGain();
    this.musicIn.connect(this.duck).connect(this.master);

    // DJ sesi: yüksek geçiren + varlık (presence) + sıcaklık + kompresör → radyo sesi
    this.voiceIn = ctx.createGain();
    this.voiceIn.gain.value = this.voiceLevel;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowshelf'; warm.frequency.value = 180; warm.gain.value = 1.5;
    const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 3200; presence.Q.value = 0.9; presence.gain.value = 2.5;
    const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = 1.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22; comp.knee.value = 6; comp.ratio.value = 3.2; comp.attack.value = 0.004; comp.release.value = 0.16;
    const makeup = ctx.createGain(); makeup.gain.value = 1.35;
    this.voiceIn.connect(hp).connect(warm).connect(presence).connect(air).connect(comp).connect(makeup).connect(this.master);

    // Efektler (jenerikler)
    this.fxIn = ctx.createGain();
    this.fxIn.gain.value = 0.8;
    this.fxIn.connect(this.master);
  }

  get running() { return this.ctx.state === 'running'; }

  async resume() {
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { /* */ } }
    return this.ctx.state === 'running';
  }

  /** Harici kaynaklar (YouTube, akış) ses seviyesi değişimlerini dinler. */
  onLevels(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  notify(seconds) {
    for (const fn of this.listeners) {
      try { fn({ master: this.masterLevel, music: this.musicLevel, duck: this.duckValue, seconds }); } catch { /* */ }
    }
  }

  setVolumes({ master, music, voice } = {}) {
    const t = this.ctx.currentTime;
    if (master != null) { this.masterLevel = master; this.master.gain.setTargetAtTime(master, t, 0.05); }
    if (music != null) { this.musicLevel = music; this.musicIn.gain.setTargetAtTime(music, t, 0.05); }
    if (voice != null) { this.voiceLevel = voice; this.voiceIn.gain.setTargetAtTime(voice, t, 0.05); }
    this.notify(0.3);
  }

  /** Müziği kıs: level 0..1, süre saniye. */
  duckTo(level, seconds = 0.6) {
    this.duckValue = level;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(this.duck.gain.value, t);
    this.duck.gain.linearRampToValueAtTime(level, t + seconds);
    this.notify(seconds);
  }

  unduck(seconds = 1.8) { this.duckTo(1, seconds); }

  async decode(bytes) {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return this.ctx.decodeAudioData(copy);
  }

  /** Tamponu çalar. Dönüş: { stop(), ended: Promise, startAt, duration } */
  play(buffer, { bus = 'voice', when = 0, gain = 1 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain(); g.gain.value = gain;
    const dest = bus === 'fx' ? this.fxIn : bus === 'music' ? this.musicIn : this.voiceIn;
    src.connect(g).connect(dest);
    const startAt = Math.max(this.ctx.currentTime + 0.02, when || 0);
    let resolve;
    const ended = new Promise((r) => { resolve = r; });
    src.onended = () => { try { g.disconnect(); } catch { /* */ } resolve(); };
    src.start(startAt);
    return { stop: () => { try { src.stop(); } catch { /* */ } resolve(); }, ended, startAt, duration: buffer.duration };
  }

  /** Görselleştirici için 0..1 arası bant seviyeleri. */
  bands(n = 24) {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    const out = new Array(n).fill(0);
    const usable = Math.floor(data.length * 0.7);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(Math.pow(i / n, 1.6) * usable);
      const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 1.6) * usable));
      let s = 0; for (let k = a; k < b; k++) s += data[k];
      out[i] = Math.round((s / (b - a) / 255) * 100) / 100;
    }
    return out;
  }
}
