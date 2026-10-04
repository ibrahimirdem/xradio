// Radyo jenerikleri: istasyon logosu, geçiş "whoosh"u, son dakika stingeri, saat başı bip sesleri,
// dinleyici mesajı zili. Hepsi OfflineAudioContext ile bir kez üretilip önbelleğe alınır.

const cache = new Map();

function noise(ctx, seconds) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(); s.buffer = b; return s;
}

function verb(ctx, seconds = 2.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const v = ctx.createConvolver(); v.buffer = b; return v;
}

function tone(ctx, out, { f, t, d, type = 'sine', peak = 0.2, a = 0.005, f2 = null }) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.05);
  return g;
}

const RECIPES = {
  // Sonik logo: 5 notalık parlak motif ("X-Ra-di-o-!") + akor
  logo(ctx) {
    const out = ctx.createGain(); out.gain.value = 0.9;
    const rv = verb(ctx, 2.5); const wet = ctx.createGain(); wet.gain.value = 0.35;
    out.connect(ctx.destination); out.connect(rv).connect(wet).connect(ctx.destination);
    const notes = [72, 79, 76, 84, 88];
    notes.forEach((m, i) => {
      const f = 440 * 2 ** ((m - 69) / 12);
      const t = 0.05 + i * 0.13;
      tone(ctx, out, { f, t, d: 0.9, peak: 0.16 });
      tone(ctx, out, { f: f * 2, t, d: 0.3, peak: 0.05 });
    });
    for (const m of [60, 64, 67, 71, 74]) {
      tone(ctx, out, { f: 440 * 2 ** ((m - 69) / 12), t: 0.7, d: 1.6, type: 'triangle', peak: 0.06, a: 0.02 });
    }
    return 2.6;
  },
  // Konuşmaya geçiş: yükselen filtreli gürültü + yumuşak darbe
  sweeper(ctx) {
    const n = noise(ctx, 1.4);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, 0); bp.frequency.exponentialRampToValueAtTime(7000, 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.25, 0.85); g.gain.exponentialRampToValueAtTime(0.0001, 1.25);
    n.connect(bp).connect(g).connect(ctx.destination); n.start(0);
    tone(ctx, ctx.destination, { f: 110, f2: 55, t: 0.88, d: 0.5, peak: 0.35 });
    tone(ctx, ctx.destination, { f: 1318, t: 0.9, d: 0.6, peak: 0.05 });
    return 1.5;
  },
  // Son dakika: alçak darbe + haber bipleri (dıt-dıt-dıt-dııııt) + gerilim pedi
  breaking(ctx) {
    const out = ctx.createGain(); out.gain.value = 0.9; out.connect(ctx.destination);
    tone(ctx, out, { f: 90, f2: 38, t: 0, d: 1.1, peak: 0.6 });
    const n = noise(ctx, 1); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.3, 0); ng.gain.exponentialRampToValueAtTime(0.0001, 0.8);
    n.connect(lp).connect(ng).connect(out); n.start(0);
    const beeps = [[0.55, 0.1], [0.75, 0.1], [0.95, 0.1], [1.15, 0.55]];
    for (const [t, d] of beeps) {
      tone(ctx, out, { f: 1046.5, t, d, type: 'square', peak: 0.07, a: 0.003 });
      tone(ctx, out, { f: 523.25, t, d, type: 'sine', peak: 0.1, a: 0.003 });
    }
    for (const m of [45, 52, 57, 60]) {
      const f = 440 * 2 ** ((m - 69) / 12);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(300, 0.4); fl.frequency.linearRampToValueAtTime(1800, 2.6);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0.4); g.gain.linearRampToValueAtTime(0.035, 2.2); g.gain.exponentialRampToValueAtTime(0.0001, 3.1);
      o.connect(fl).connect(g).connect(out); o.start(0.4); o.stop(3.2);
    }
    return 3.2;
  },
  // Saat başı: 5 kısa + 1 uzun bip (saat ayarı)
  pips(ctx) {
    for (let i = 0; i < 6; i++) tone(ctx, ctx.destination, { f: 1000, t: i, d: i === 5 ? 0.5 : 0.1, peak: 0.18, a: 0.004 });
    return 5.7;
  },
  // Dinleyici mesajı geldi zili
  ping(ctx) {
    tone(ctx, ctx.destination, { f: 1568, t: 0, d: 0.5, peak: 0.12 });
    tone(ctx, ctx.destination, { f: 2093, t: 0.12, d: 0.7, peak: 0.1 });
    return 0.9;
  },
};

/** Jeneriği üretir (önbellekli). */
export async function getFx(name, sampleRate = 48000) {
  const key = name + sampleRate;
  if (cache.has(key)) return cache.get(key);
  const recipe = RECIPES[name];
  if (!recipe) throw new Error('bilinmeyen jenerik: ' + name);
  // Uzunluğu öğrenmek için önce tahmini, sonra gerçek render
  const probe = new OfflineAudioContext(2, sampleRate, sampleRate);
  const len = recipe(probe);
  const ctx = new OfflineAudioContext(2, Math.ceil((len + 0.3) * sampleRate), sampleRate);
  recipe(ctx);
  const p = ctx.startRendering();
  cache.set(key, p);
  return p;
}

export const FX_NAMES = Object.keys(RECIPES);
