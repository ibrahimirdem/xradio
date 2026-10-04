// Parça planını gerçek sese dönüştüren sentezleyici.
// Her 4 ölçülük parça OfflineAudioContext ile önceden render edilir; böylece arka plan sekme
// zamanlayıcı kısıtlamalarından etkilenmeden kesintisiz, tutarlı müzik çalınır.

import { mulberry32, hashSeed, choice, range, chance, midiToHz } from './rng.js';
import { voiceChord, bassNote, scaleNotes } from './composer.js';

const TAIL = 3.2; // yankı kuyruğu (saniye)
const sharedBuffers = new Map();

function noiseBuffer(sr) {
  const key = 'noise' + sr;
  if (sharedBuffers.has(key)) return sharedBuffers.get(key);
  const len = sr * 2;
  const b = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 });
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
  sharedBuffers.set(key, b);
  return b;
}

function impulseResponse(sr, seconds = 2.6, decay = 2.8) {
  const key = `ir${sr}-${seconds}-${decay}`;
  if (sharedBuffers.has(key)) return sharedBuffers.get(key);
  const len = Math.floor(sr * seconds);
  const b = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 2 });
  const rnd = mulberry32(99);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const early = i < sr * 0.08 && rnd() < 0.004 ? 0.8 : 0;
      d[i] = ((rnd() * 2 - 1) * Math.pow(1 - t, decay) + early * (1 - t)) * 0.9;
    }
  }
  sharedBuffers.set(key, b);
  return b;
}

function crackleBuffer(sr, seconds, amount, seed) {
  const len = Math.floor(sr * seconds);
  const b = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 2 });
  const rnd = mulberry32(seed);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let hiss = 0;
    for (let i = 0; i < len; i++) {
      hiss = hiss * 0.92 + (rnd() * 2 - 1) * 0.08;
      d[i] = hiss * 0.05 * amount;
      if (rnd() < 0.00035 * amount) {
        const amp = (rnd() * 0.3 + 0.08) * amount;
        const l = Math.floor(sr * (0.0004 + rnd() * 0.0012));
        for (let k = 0; k < l && i + k < len; k++) d[i + k] += amp * (1 - k / l) * (rnd() < 0.5 ? -1 : 1);
      }
    }
  }
  return b;
}

function softClipCurve(drive = 1.4) {
  const key = 'clip' + drive;
  if (sharedBuffers.has(key)) return sharedBuffers.get(key);
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  sharedBuffers.set(key, curve);
  return curve;
}

/** Bir zarf uygular: atak → tepe → üstel sönüm. */
function env(param, t, { a = 0.005, peak = 1, d = 0.3, s = 0.0001, r = 0.05, hold = 0 }) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (hold) param.setValueAtTime(peak, t + a + hold);
  param.exponentialRampToValueAtTime(Math.max(0.0001, s), t + a + hold + d);
  param.exponentialRampToValueAtTime(0.0001, t + a + hold + d + r);
}

class Kit {
  constructor(ctx, out, rnd, opts) {
    this.ctx = ctx; this.out = out; this.rnd = rnd; this.opts = opts;
    this.noise = noiseBuffer(ctx.sampleRate);
  }

  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, this.rnd() * 1.5, dur + 0.05);
    return s;
  }

  kick(t, vel = 1, punch = 1) {
    const { ctx } = this;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150 * punch, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.13);
    env(g.gain, t, { a: 0.002, peak: 0.95 * vel, d: 0.38 + 0.1 * punch, r: 0.04 });
    o.connect(g).connect(this.out.drums);
    o.start(t); o.stop(t + 0.6);
    // tık
    const n = this.noiseSrc(t, 0.02);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = ctx.createGain(); env(ng.gain, t, { a: 0.001, peak: 0.12 * vel * punch, d: 0.012, r: 0.005 });
    n.connect(hp).connect(ng).connect(this.out.drums);
  }

  snare(t, vel = 1, tone = 1800, verb = 0.2) {
    const { ctx } = this;
    const n = this.noiseSrc(t, 0.3);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = tone; bp.Q.value = 0.7;
    const g = ctx.createGain(); env(g.gain, t, { a: 0.002, peak: 0.42 * vel, d: 0.2, r: 0.04 });
    n.connect(bp).connect(g).connect(this.out.drums);
    if (verb) { const sg = ctx.createGain(); sg.gain.value = verb; g.connect(sg).connect(this.out.verb); }
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = ctx.createGain(); env(og.gain, t, { a: 0.001, peak: 0.32 * vel, d: 0.09, r: 0.02 });
    o.connect(og).connect(this.out.drums); o.start(t); o.stop(t + 0.2);
  }

  clap(t, vel = 1) {
    const { ctx } = this;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.1;
    const g = ctx.createGain(); g.gain.value = 0;
    for (let i = 0; i < 3; i++) {
      g.gain.setValueAtTime(0.5 * vel, t + i * 0.011);
      g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.011 + 0.009);
    }
    g.gain.setValueAtTime(0.38 * vel, t + 0.033);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    this.noiseSrc(t, 0.25).connect(bp).connect(g).connect(this.out.drums);
    const sg = ctx.createGain(); sg.gain.value = 0.25; g.connect(sg).connect(this.out.verb);
  }

  hat(t, vel = 1, open = false) {
    const { ctx } = this;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 10500; pk.gain.value = 6;
    const g = ctx.createGain(); env(g.gain, t, { a: 0.001, peak: 0.16 * vel, d: open ? 0.24 : 0.035, r: 0.02 });
    this.noiseSrc(t, open ? 0.3 : 0.06).connect(hp).connect(pk).connect(g).connect(this.out.drums);
  }

  ride(t, vel = 1) {
    const { ctx } = this;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
    const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 8400; bp.gain.value = 9; bp.Q.value = 2;
    const g = ctx.createGain(); env(g.gain, t, { a: 0.001, peak: 0.075 * vel, d: 0.7, r: 0.1 });
    this.noiseSrc(t, 0.9).connect(hp).connect(bp).connect(g).connect(this.out.drums);
    // metalik ton
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 3150;
    const og = ctx.createGain(); env(og.gain, t, { a: 0.001, peak: 0.008 * vel, d: 0.5, r: 0.05 });
    const ohp = ctx.createBiquadFilter(); ohp.type = 'highpass'; ohp.frequency.value = 3000;
    o.connect(ohp).connect(og).connect(this.out.drums); o.start(t); o.stop(t + 0.7);
  }

  brush(t, vel = 1, len = 0.18) {
    const { ctx } = this;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2800; bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12 * vel, t + len * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    this.noiseSrc(t, len + 0.05).connect(bp).connect(g).connect(this.out.drums);
  }

  shaker(t, vel = 1) {
    const { ctx } = this;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05 * vel, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    this.noiseSrc(t, 0.1).connect(hp).connect(g).connect(this.out.drums);
  }

  tom(t, vel = 1, f = 110) {
    const { ctx } = this;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    const g = ctx.createGain(); env(g.gain, t, { a: 0.002, peak: 0.5 * vel, d: 0.3, r: 0.05 });
    o.connect(g).connect(this.out.drums); o.start(t); o.stop(t + 0.5);
    const sg = ctx.createGain(); sg.gain.value = 0.3; g.connect(sg).connect(this.out.verb);
  }

  // ------------------------------------------------ Melodik enstrümanlar
  rhodes(t, midi, dur, vel = 1, wurli = false) {
    const { ctx } = this;
    const f = midiToHz(midi);
    const g = ctx.createGain();
    env(g.gain, t, { a: 0.006, peak: 0.075 * vel, d: Math.max(0.4, dur * 1.1), s: 0.008, r: 0.25 });
    const o1 = ctx.createOscillator(); o1.type = wurli ? 'triangle' : 'sine'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.003;
    const g2 = ctx.createGain(); env(g2.gain, t, { a: 0.003, peak: 0.35, d: 0.25, s: 0.02, r: 0.1 });
    const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = f * (wurli ? 3.0 : 4.01);
    const g3 = ctx.createGain(); env(g3.gain, t, { a: 0.002, peak: wurli ? 0.12 : 0.08, d: 0.08, r: 0.04 });
    o1.connect(g); o2.connect(g2).connect(g); o3.connect(g3).connect(g);
    g.connect(this.out.keys);
    if (this.out.wow) { this.out.wow.connect(o1.detune); this.out.wow.connect(o2.detune); }
    const end = t + dur + 0.6;
    for (const o of [o1, o2, o3]) { o.start(t); o.stop(end); }
  }

  organ(t, midi, dur, vel = 1) {
    const { ctx } = this;
    const f = midiToHz(midi);
    const g = ctx.createGain();
    env(g.gain, t, { a: 0.004, peak: 0.05 * vel, hold: Math.max(0.02, dur - 0.05), d: 0.06, s: 0.01, r: 0.05 });
    for (const [mul, amp] of [[1, 1], [2, 0.5], [3, 0.3], [4, 0.12]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul;
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og).connect(g); o.start(t); o.stop(t + dur + 0.2);
    }
    g.connect(this.out.keys);
  }

  pad(t, notes, dur, vel = 1, bright = 0.6) {
    const { ctx } = this;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500 + 900 * bright, t);
    lp.frequency.linearRampToValueAtTime(900 + 1600 * bright, t + dur * 0.6);
    lp.frequency.linearRampToValueAtTime(600 + 900 * bright, t + dur + 1);
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.03 * vel, t + Math.min(1.2, dur * 0.4));
    g.gain.setValueAtTime(0.03 * vel, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.4);
    for (const n of notes) {
      for (const det of [-8, 7]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiToHz(n); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + dur + 1.5);
        if (this.out.wow) this.out.wow.connect(o.detune);
      }
    }
    lp.connect(g).connect(this.out.pad);
  }

  bass(t, midi, dur, vel = 1, kind = 'round') {
    const { ctx } = this;
    const f = midiToHz(midi);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    if (kind === 'saw') {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      lp.frequency.setValueAtTime(260, t); lp.frequency.exponentialRampToValueAtTime(1400, t + 0.015); lp.frequency.exponentialRampToValueAtTime(320, t + 0.18);
      lp.Q.value = 3;
      env(g.gain, t, { a: 0.003, peak: 0.24 * vel, hold: Math.max(0.01, dur - 0.08), d: 0.06, s: 0.05, r: 0.03 });
      o.connect(lp); o.start(t); o.stop(t + dur + 0.15);
    } else {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = kind === 'upright' ? 'triangle' : 'triangle'; o2.frequency.value = f;
      const g2 = ctx.createGain(); g2.gain.value = kind === 'upright' ? 0.55 : kind === 'sub' ? 0.05 : 0.3;
      lp.frequency.value = kind === 'upright' ? 900 : kind === 'sub' ? 220 : 520;
      const decay = kind === 'upright' ? Math.min(dur, 0.5) : dur;
      env(g.gain, t, { a: kind === 'sub' ? 0.08 : 0.008, peak: (kind === 'sub' ? 0.32 : 0.36) * vel, hold: Math.max(0.01, decay * 0.4), d: decay * 0.6 + 0.05, s: 0.02, r: 0.06 });
      o.connect(lp); o2.connect(g2).connect(lp);
      o.start(t); o2.start(t); o.stop(t + dur + 0.3); o2.stop(t + dur + 0.3);
    }
    lp.connect(g).connect(this.out.bass);
  }

  bell(t, midi, dur, vel = 1) {
    const { ctx } = this;
    const f = midiToHz(midi);
    const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 3.5;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.6, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.9);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain(); env(g.gain, t, { a: 0.003, peak: 0.07 * vel, d: 1.4, r: 0.2 });
    car.connect(g).connect(this.out.lead);
    car.start(t); mod.start(t); car.stop(t + 1.8); mod.stop(t + 1.8);
  }

  vibes(t, midi, dur, vel = 1) {
    const { ctx } = this;
    const f = midiToHz(midi);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 4;
    const g2 = ctx.createGain(); env(g2.gain, t, { a: 0.001, peak: 0.2, d: 0.15, r: 0.05 });
    const trem = ctx.createOscillator(); trem.frequency.value = 5.2;
    const tg = ctx.createGain(); tg.gain.value = 0.25;
    const g = ctx.createGain(); env(g.gain, t, { a: 0.002, peak: 0.06 * vel, d: 1.2, r: 0.2 });
    const am = ctx.createGain(); am.gain.value = 0.8;
    trem.connect(tg).connect(am.gain);
    o.connect(am); o2.connect(g2).connect(am); am.connect(g).connect(this.out.lead);
    for (const x of [o, o2, trem]) { x.start(t); x.stop(t + 1.6); }
  }

  pluck(t, midi, dur, vel = 1, kind = 'pluck') {
    const { ctx } = this;
    const f = midiToHz(midi);
    const o = ctx.createOscillator(); o.type = kind === 'arp' ? 'sawtooth' : 'triangle'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = kind === 'arp' ? 4 : 1;
    lp.frequency.setValueAtTime(kind === 'arp' ? 2600 : 3200, t);
    lp.frequency.exponentialRampToValueAtTime(kind === 'arp' ? 500 : 700, t + Math.min(0.25, dur));
    const g = ctx.createGain(); env(g.gain, t, { a: 0.002, peak: (kind === 'arp' ? 0.05 : 0.08) * vel, d: Math.min(0.5, dur + 0.15), r: 0.05 });
    o.connect(lp).connect(g).connect(this.out.lead);
    o.start(t); o.stop(t + dur + 0.6);
  }
}

function buildBuses(ctx, track, chunk, sec, len, rnd) {
  const sr = ctx.sampleRate;
  const st = track.style;
  const bright = track.instruments.brightness;
  const master = ctx.createGain(); master.gain.value = 0.9;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass';
  const toneHz = st === 'lofi' ? 4200 + 2500 * bright : st === 'jazz' ? 9000 : st === 'ambient' ? 8000 : 15000;
  if (sec.sweep && chunk.barOffset === 0) {
    tone.frequency.setValueAtTime(500, 0);
    tone.frequency.exponentialRampToValueAtTime(toneHz, len * 0.95);
  } else tone.frequency.value = toneHz;
  tone.Q.value = st === 'lofi' ? 0.9 : 0.5;
  const clip = ctx.createWaveShaper(); clip.curve = softClipCurve(st === 'lofi' ? 1.8 : 1.2); clip.oversample = '2x';
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.18;
  const out = ctx.createGain(); out.gain.value = 1.0;
  master.connect(tone).connect(clip).connect(comp).connect(out).connect(ctx.destination);
  if (sec.fadeOut && chunk.last) {
    out.gain.setValueAtTime(1, 0);
    out.gain.linearRampToValueAtTime(0.0001, len + 0.5);
  }

  const verb = ctx.createConvolver(); verb.buffer = impulseResponse(sr, st === 'ambient' ? 4 : 2.6, st === 'ambient' ? 2 : 3);
  const verbOut = ctx.createGain(); verbOut.gain.value = st === 'ambient' ? 0.55 : st === 'synthwave' ? 0.4 : 0.28;
  verb.connect(verbOut).connect(master);

  const beat = 60 / track.bpm;
  const delay = ctx.createDelay(2); delay.delayTime.value = beat * 0.75;
  const fb = ctx.createGain(); fb.gain.value = st === 'ambient' ? 0.5 : 0.35;
  const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3000;
  delay.connect(dlp).connect(fb).connect(delay);
  const delayOut = ctx.createGain(); delayOut.gain.value = 0.32;
  dlp.connect(delayOut).connect(master);
  delayOut.connect(verb);

  // Sidechain pompalama (house/synthwave): her vuruşta kısa düşüş
  const pump = ctx.createGain(); pump.gain.value = 1;
  pump.connect(master);
  if ((st === 'house' || st === 'synthwave') && sec.drums) {
    for (let t = 0; t < len; t += beat) {
      pump.gain.setValueAtTime(0.55, t);
      pump.gain.linearRampToValueAtTime(1, t + beat * 0.55);
    }
  }

  const mk = (gain, { toVerb = 0, toDelay = 0, pumped = false } = {}) => {
    const g = ctx.createGain(); g.gain.value = gain;
    g.connect(pumped ? pump : master);
    if (toVerb) { const s = ctx.createGain(); s.gain.value = toVerb; g.connect(s).connect(verb); }
    if (toDelay) { const s = ctx.createGain(); s.gain.value = toDelay; g.connect(s).connect(delay); }
    return g;
  };
  const buses = {
    drums: mk(st === 'jazz' ? 0.8 : 1, { toVerb: st === 'synthwave' ? 0.18 : 0.05 }),
    bass: mk(1, { pumped: true }),
    keys: mk(1, { toVerb: 0.35, toDelay: st === 'lofi' ? 0.08 : 0, pumped: true }),
    pad: mk(1, { toVerb: 0.6, pumped: true }),
    lead: mk(1, { toVerb: 0.4, toDelay: st === 'house' ? 0.2 : 0.45, pumped: true }),
    verb,
    delay,
  };
  // Teyp dalgalanması (lo-fi)
  if (st === 'lofi' || (st === 'jazz' && track.instruments.crackle > 0.2)) {
    const lfo = ctx.createOscillator(); lfo.frequency.value = range(rnd, 0.35, 0.7);
    const depth = ctx.createGain(); depth.gain.value = st === 'lofi' ? 7 : 3;
    lfo.connect(depth); lfo.start(0); lfo.stop(len + TAIL);
    buses.wow = depth;
  }
  return buses;
}

/** Tek bir 4 ölçülük parçayı render eder. Dönüş: AudioBuffer (uzunluk + kuyruk). */
export async function renderChunk(track, chunkIndex, sampleRate = 48000) {
  const chunk = track.chunks[chunkIndex];
  const sec = track.sections[chunk.section];
  const barDur = track.barDur;
  const len = chunk.bars * barDur;
  const ctx = new OfflineAudioContext(2, Math.ceil((len + TAIL) * sampleRate), sampleRate);
  const rnd = mulberry32(hashSeed(track.seed, chunkIndex));
  const out = buildBuses(ctx, track, chunk, sec, len, rnd);
  const kit = new Kit(ctx, out, rnd, {});
  const st = track.style;
  const step = barDur / 16;
  const swingAt = (s) => (s % 2 === 1 ? track.swing * step * 2 * (st === 'jazz' ? 1 : 0.5) : 0);
  // İnsansı zamanlama sapması; ilk vuruşta negatif zamana düşmesin (AudioParam negatif zaman kabul etmez)
  const at = (bar, s) => Math.max(0, bar * barDur + s * step + swingAt(s) + (rnd() - 0.5) * 0.006);
  const absBar0 = track.sections.slice(0, chunk.section).reduce((a, x) => a + x.bars, 0) + chunk.barOffset;
  const scale = scaleNotes(track.key, track.minor);
  const ins = track.instruments;

  // Plak cızırtısı
  if (ins.crackle > 0) {
    const cr = ctx.createBufferSource();
    cr.buffer = crackleBuffer(sampleRate, len + 0.5, ins.crackle, hashSeed(track.seed, 'cr', chunkIndex));
    const cg = ctx.createGain(); cg.gain.value = 0.55;
    cr.connect(cg).connect(ctx.destination); cr.start(0);
  }

  // Melodi motifi: bölüm başına 2 ölçülük motif, tekrar + varyasyon
  const motifRnd = mulberry32(hashSeed(track.seed, 'motif', chunk.section % 3));
  const motif = [];
  for (let s = 0; s < 32; s += choice(motifRnd, [2, 2, 3, 4, 4, 6])) {
    if (chance(motifRnd, 0.62)) motif.push({ s, n: choice(motifRnd, scale), d: choice(motifRnd, [2, 3, 4, 6]) });
  }

  for (let b = 0; b < chunk.bars; b++) {
    const barInSec = chunk.barOffset + b;
    const chord = sec.prog[barInSec % sec.prog.length];
    const nextChord = sec.prog[(barInSec + 1) % sec.prog.length];
    const t0 = b * barDur;
    const isLastBarOfSection = chunk.last && b === chunk.bars - 1;
    const outroDrop = sec.fadeOut && barInSec >= 2;
    const drums = sec.drums && !outroDrop;
    const vel = () => 0.75 + rnd() * 0.25;

    // ---- Davul
    if (drums) {
      if (st === 'lofi') {
        const kicks = choice(rnd, [[0, 10], [0, 7, 10], [0, 3, 10], [0, 8, 11]]);
        for (const s of kicks) if (!(isLastBarOfSection && s > 8)) kit.kick(at(b, s), s === 0 ? 0.95 : 0.75, 0.8);
        for (const s of [4, 12]) if (!(isLastBarOfSection && s === 12 && sec.drums < 2)) kit.snare(at(b, s), 0.8 + rnd() * 0.15, 1700, 0.18);
        for (let s = 0; s < 16; s += 2) kit.hat(at(b, s), (s % 4 === 0 ? 0.7 : 0.45) * vel(), s === 14 && chance(rnd, 0.25));
        if (sec.drums >= 2 && chance(rnd, 0.5)) kit.hat(at(b, 15), 0.3);
      } else if (st === 'jazz') {
        for (const s of [0, 4, 6, 8, 12, 14]) kit.ride(at(b, s), (s % 4 === 0 ? 0.9 : 0.6) * vel());
        for (const s of [4, 12]) kit.hat(at(b, s), 0.35, false);
        kit.brush(at(b, 4), 0.7); kit.brush(at(b, 12), 0.7);
        if (chance(rnd, 0.35)) kit.snare(at(b, choice(rnd, [7, 11, 15])), 0.18, 2400, 0.1);
        kit.kick(at(b, 0), 0.35, 0.6);
        if (chance(rnd, 0.4)) kit.kick(at(b, 10), 0.25, 0.6);
      } else if (st === 'house') {
        for (const s of [0, 4, 8, 12]) kit.kick(at(b, s), 1, 1.1);
        for (const s of [4, 12]) kit.clap(at(b, s), 0.8);
        for (const s of [2, 6, 10, 14]) kit.hat(at(b, s), 0.75, true);
        if (sec.drums >= 2) for (let s = 0; s < 16; s++) if (s % 2 === 1) kit.shaker(at(b, s), 0.7 * vel());
        if (isLastBarOfSection && chance(rnd, 0.6)) for (const s of [13, 14, 15]) kit.clap(at(b, s), 0.5);
      } else if (st === 'synthwave') {
        for (const s of [0, 8]) kit.kick(at(b, s), 1, 1);
        if (chance(rnd, 0.4)) kit.kick(at(b, 10), 0.7, 1);
        for (const s of [4, 12]) kit.snare(at(b, s), 1, 1500, 0.55);
        for (let s = 0; s < 16; s += 2) kit.hat(at(b, s), 0.55 * vel());
        if (isLastBarOfSection) for (const [s, f] of [[12, 160], [13, 140], [14, 120], [15, 100]]) kit.tom(at(b, s), 0.8, f);
      }
    } else if (st === 'ambient' && sec.type !== 'intro') {
      if (chance(rnd, 0.7)) kit.shaker(at(b, 4), 0.4); if (chance(rnd, 0.7)) kit.shaker(at(b, 12), 0.4);
    }

    // ---- Bas
    if (sec.bass && !(sec.fadeOut && barInSec >= 3)) {
      const root = bassNote(track.key, chord, st === 'synthwave' ? 33 : 36);
      const fifth = root + 7;
      const kind = ins.bass;
      if (st === 'lofi') {
        kit.bass(at(b, 0), root, step * 6, 1, kind);
        kit.bass(at(b, 10), chance(rnd, 0.5) ? root : fifth, step * 4, 0.8, kind);
        if (chance(rnd, 0.3)) kit.bass(at(b, 14), root + (chance(rnd, 0.5) ? 12 : 10), step * 2, 0.6, kind);
      } else if (st === 'jazz') {
        const next = bassNote(track.key, nextChord, 36);
        const ints = [0, chance(rnd, 0.5) ? 3 : 4, 7, null];
        ints.forEach((iv, q) => {
          const note = iv == null ? next + (chance(rnd, 0.5) ? 1 : -1) : root + iv;
          kit.bass(at(b, q * 4), note, step * 3.6, 0.85 + (q === 0 ? 0.15 : 0), 'upright');
        });
      } else if (st === 'house') {
        for (const s of [2, 6, 10, 14]) kit.bass(at(b, s), s === 10 && chance(rnd, 0.4) ? root + 12 : root, step * 1.6, 1, 'round');
        if (chance(rnd, 0.3)) kit.bass(at(b, 15), fifth, step * 0.8, 0.6, 'round');
      } else if (st === 'synthwave') {
        for (let s = 0; s < 16; s += 2) kit.bass(at(b, s), s % 4 === 2 ? root + 12 : root, step * 1.5, 0.9, 'saw');
      } else {
        kit.bass(at(b, 0), root, barDur * 0.95, 0.8, 'sub');
      }
    }

    // ---- Akorlar / tuşlular
    if (sec.keys) {
      const voicing = voiceChord(track.key, chord, { low: st === 'synthwave' ? 52 : 55, high: st === 'house' ? 74 : 77, rootless: st !== 'synthwave' && st !== 'ambient' });
      const strum = (notes, t, dur, v, fn) => notes.forEach((n, i) => fn(t + i * (0.008 + rnd() * 0.008), n, dur, v));
      if (ins.keys === 'organ') {
        const hits = choice(rnd, [[3, 6, 11, 14], [2, 7, 10, 14], [3, 8, 11]]);
        for (const s of hits) strum(voicing, at(b, s), step * 1.3, 0.9 * vel(), (t, n, d, v) => kit.organ(t, n, d, v));
      } else if (ins.keys === 'pad') {
        if (st !== 'ambient' || barInSec % 2 === 0) kit.pad(at(b, 0), voicing, st === 'ambient' ? barDur * 2 - 0.1 : barDur - 0.05, sec.type === 'intro' ? 0.8 : 1, ins.brightness);
        if (st === 'ambient' && sec.type !== 'intro' && chance(rnd, 0.4)) kit.rhodes(at(b, 8), voicing[voicing.length - 1] + 12, step * 8, 0.35);
      } else {
        const wurli = ins.keys === 'wurli';
        if (sec.sparse) {
          strum(voicing, at(b, 0), barDur * 0.9, 0.6, (t, n, d, v) => kit.rhodes(t, n, d, v, wurli));
        } else if (st === 'jazz') {
          const comps = choice(rnd, [[0, 6], [2, 10], [0, 10, 14], [6, 12]]);
          for (const s of comps) strum(voicing, at(b, s), step * 2.5, 0.75 * vel(), (t, n, d, v) => kit.rhodes(t, n, d, v, wurli));
        } else {
          strum(voicing, at(b, 0), step * 9, 0.95, (t, n, d, v) => kit.rhodes(t, n, d, v, wurli));
          if (chance(rnd, 0.55)) strum(voicing, at(b, 10), step * 5, 0.6, (t, n, d, v) => kit.rhodes(t, n, d, v, wurli));
        }
      }
      if (sec.pad && ins.keys !== 'pad' && (st !== 'jazz')) kit.pad(at(b, 0), voicing, barDur - 0.05, 0.55, ins.brightness);
    }

    // ---- Melodi
    if (sec.melody && ins.lead !== 'none') {
      if (ins.lead === 'arp') {
        const v = voiceChord(track.key, chord, { low: 64, high: 84, rootless: false });
        const pattern = [0, 1, 2, 1, 2, 3 % v.length, 2, 1];
        for (let s = 0; s < 16; s++) kit.pluck(at(b, s), v[pattern[s % 8] % v.length] + (s >= 8 && chance(rnd, 0.2) ? 12 : 0), step * 0.9, 0.85, 'arp');
      } else {
        const half = ((absBar0 + b) % 2) * 16;
        for (const m of motif) {
          if (m.s < half || m.s >= half + 16) continue;
          if (sec.sparse && chance(rnd, 0.5)) continue;
          let n = m.n;
          if (chance(rnd, 0.15)) n = choice(rnd, scale); // varyasyon
          const t = at(b, m.s - half);
          if (ins.lead === 'bell') kit.bell(t, n, step * m.d, 0.8);
          else if (ins.lead === 'vibes') kit.vibes(t, n, step * m.d, 0.85);
          else kit.pluck(t, n, step * m.d, 0.8, 'pluck');
        }
      }
    }
  }

  return ctx.startRendering();
}

export function chunkDuration(track, chunkIndex) {
  return track.chunks[chunkIndex].bars * track.barDur;
}
