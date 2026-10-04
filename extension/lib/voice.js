// DJ seslendirme katmanı.
// GeminiVoice: Gemini çok konuşmacılı TTS (iki DJ tek akışta, doğal sırayla konuşur).
// BrowserVoice: Tarayıcının Türkçe sesleri (Edge'de "Microsoft Emel/Ahmet Online (Natural)") — ücretsiz yedek.

import { plainSpeech } from './textutil.js';
import { langInfo } from './config.js';

/** Satırları TTS parçalarına böler: ilk parça kısa (hızlı başlangıç), sonrakiler orta boy. */
export function chunkLines(lines, { first = 3, max = 7, maxChars = 900 } = {}) {
  const chunks = [];
  let cur = [];
  let chars = 0;
  const limit = () => (chunks.length === 0 ? first : max);
  for (const l of lines) {
    if (cur.length && (cur.length >= limit() || chars + l.text.length > maxChars)) {
      chunks.push(cur); cur = []; chars = 0;
    }
    cur.push(l); chars += l.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Satırların ses içindeki tahmini başlangıç zamanları (karakter oranına göre). */
export function estimateTimings(lines, duration) {
  const weights = lines.map((l) => Math.max(8, plainSpeech(l.text).length) + 6);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return lines.map((l, i) => {
    const start = (acc / total) * duration;
    acc += weights[i];
    return { start, end: (acc / total) * duration };
  });
}

export class GeminiVoice {
  constructor({ client, engine, getSettings }) {
    this.client = client;
    this.engine = engine;
    this.getSettings = getSettings;
  }

  speakers(settings) {
    return [
      { speaker: settings.hostA.name, voice: settings.hostA.voice },
      { speaker: settings.hostB.name, voice: settings.hostB.voice },
    ];
  }

  /**
   * Senaryoyu seslendirir. Her parça için bir Promise döndürür (sırayla üretilir);
   * böylece ilk parça hazır olur olmaz çalmaya başlanabilir.
   */
  synthesize(script, { kind = 'regular', signal } = {}) {
    const settings = this.getSettings();
    const named = script.lines.map((l) => ({ ...l, speaker: l.speaker === 'A' ? settings.hostA.name : settings.hostB.name, key: l.speaker }));
    // Sohbetin doğal ritmi (üst üste binen tepkiler, gülmeler, söz kesmeler) parça sınırlarında kopar.
    // Bu yüzden önceden hazırlanan bölümler tek ya da iki büyük parçada seslendirilir (model tek çağrıda
    // 16 bin token'a kadar ses üretebiliyor). Acil bölümlerde ilk parça kısa tutulur ki hemen başlasın.
    const urgent = kind === 'breaking' || kind === 'listener';
    const groups = chunkLines(named, urgent ? { first: 4, max: 14, maxChars: 2000 } : { first: 18, max: 18, maxChars: 2600 });
    const model = settings.ttsModel;
    const speakers = this.speakers(settings);
    let prev = Promise.resolve();
    return groups.map((g) => {
      const p = prev.then(async () => {
        if (signal?.aborted) throw new Error('iptal');
        const { bytes } = await this.client.tts({ model, lines: g, speakers, kind, settings, signal, language: langInfo(settings.language).bcp47 });
        const buffer = await this.engine.decode(bytes);
        return { buffer, lines: g.map((l) => ({ speaker: l.key, name: l.speaker, text: l.text, style: l.style })) };
      });
      prev = p.catch(() => {});
      return p;
    });
  }
}

/** Tarayıcı TTS'i (speechSynthesis). Seslerin yüklenmesini bekler. */
export class BrowserVoice {
  constructor() {
    this.synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    this.voices = [];
    this.ready = this.load();
  }

  get available() { return !!this.synth; }

  load() {
    if (!this.synth) return Promise.resolve([]);
    return new Promise((resolve) => {
      const done = () => { this.voices = this.synth.getVoices(); resolve(this.voices); };
      const v = this.synth.getVoices();
      if (v.length) { this.voices = v; resolve(v); return; }
      this.synth.addEventListener?.('voiceschanged', done, { once: true });
      setTimeout(done, 2500);
    });
  }

  /** A (kadın) ve B (erkek) için yayın dilindeki en uygun sesleri seçer (lang: 'tr', 'en', 'de'…). */
  pick(lang = 'tr') {
    const re = new RegExp('^' + lang, 'i');
    const own = this.voices.filter((v) => re.test(v.lang));
    const pool = own.length ? own : this.voices;
    const score = (v, female) => {
      let s = 0;
      if (/natural|online|neural/i.test(v.name)) s += 5;
      if (re.test(v.lang)) s += 10;
      // Bilinen kadın/erkek ses adları (Edge doğal sesleri ve Windows sesleri)
      const fem = /emel|seda|filiz|yelda|female|kadın|zira|aria|jenny|sonia|libby|emma|ava|michelle|katja|amala|denise|elvira|elsa|isabella|francisca|svetlana|polina|dariya|salma|dilara|nanami|sunhi|xiaoxiao|hedda|hortense|helena|fenna|banu/i.test(v.name);
      const mal = /ahmet|tolga|cem|male|erkek|david|guy|ryan|andrew|brian|christopher|eric|mark|conrad|killian|henri|alvaro|diego|antonio|dmitry|ostap|hamed|farid|keita|injoon|maarten|babek|stefan/i.test(v.name);
      if (female && fem) s += 4;
      if (!female && mal) s += 4;
      if (female && mal) s -= 3;
      if (!female && fem) s -= 3;
      return s;
    };
    const best = (female) => [...pool].sort((a, b) => score(b, female) - score(a, female))[0] || null;
    const A = best(true);
    let B = best(false);
    const same = A && B && A.name === B.name;
    return { A, B, same, native: own.length > 0, turkish: own.length > 0, names: { A: A?.name || '-', B: B?.name || '-' } };
  }

  /** Satırları sırayla okur. onLine(i) her satırın başında çağrılır. */
  async speak(lines, { onLine = () => {}, signal, lang = 'tr', bcp47 = 'tr-TR' } = {}) {
    await this.ready;
    const { A, B, same } = this.pick(lang);
    for (let i = 0; i < lines.length; i++) {
      if (signal?.aborted) break;
      const l = lines[i];
      const text = plainSpeech(l.text);
      if (!text) continue;
      // Sistemde hiç ses yoksa ya da sentez çalışmıyorsa: altyazıyı okuma hızında akıt (radyo kilitlenmesin)
      if (!this.synth || !this.voices.length || this.broken) {
        onLine(i);
        await new Promise((r) => setTimeout(r, Math.min(9000, 900 + text.length * 55)));
        continue;
      }
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        const v = l.speaker === 'A' ? A : B;
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = bcp47;
        u.rate = l.speaker === 'A' ? 1.04 : 1.02;
        u.pitch = same ? (l.speaker === 'A' ? 1.25 : 0.8) : 1;
        u.volume = 1;
        let finished = false;
        let started = false;
        const finish = () => { if (!finished) { finished = true; clearTimeout(guard); clearTimeout(startGuard); resolve(); } };
        u.onstart = () => { started = true; onLine(i); };
        u.onend = finish;
        u.onerror = finish;
        // Bazı ortamlarda onend gelmeyebilir: süreye göre emniyet zamanlayıcısı
        const guard = setTimeout(finish, 4000 + text.length * 110);
        // 3 sn içinde konuşmaya başlamazsa sentez bozuk say; bu oturumda altyazı moduna geç
        const startGuard = setTimeout(() => {
          if (started) return;
          this.broken = true;
          try { this.synth.cancel(); } catch { /* */ }
          onLine(i);
          setTimeout(finish, Math.min(8000, 600 + text.length * 55));
        }, 3000);
        signal?.addEventListener('abort', () => { this.synth.cancel(); finish(); }, { once: true });
        this.synth.speak(u);
      });
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  cancel() { try { this.synth?.cancel(); } catch { /* */ } }
}
