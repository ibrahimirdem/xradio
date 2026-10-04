// Gemini API istemcisi.
// Birincil yol: Interactions API (POST /v1beta/interactions) — Google'ın 2026'da önerdiği yeni arayüz.
// Yedek yol: klasik generateContent. Hangi biçimin çalıştığı model başına hatırlanır.

import { parseJsonLoose, transcriptFor, ttsDirectorNote } from './prompts.js';
import { base64ToBytes, ensureWav } from './wav.js';
import { toLegacyMarkup } from './expressive.js';
import { DEFAULT_MODELS } from './config.js';

export class GeminiError extends Error {
  constructor(message, { status = 0, code = '', retryAfter = 0, body = null } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.body = body;
  }
  get retryable() { return this.status === 0 || this.status === 429 || this.status >= 500; }
  get authProblem() { return this.status === 401 || this.status === 403 || /API key/i.test(this.message); }
}

function parseRetryDelay(body) {
  const details = body?.error?.details || [];
  for (const d of details) {
    if (d?.retryDelay) { const s = parseFloat(String(d.retryDelay)); if (s) return s * 1000; }
  }
  return 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GeminiClient {
  constructor({ apiKey, base = 'https://generativelanguage.googleapis.com', fetchImpl, onUsage } = {}) {
    this.apiKey = apiKey;
    this.base = String(base || '').replace(/\/+$/, '');
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.onUsage = onUsage || (() => {});
    this.mode = new Map(); // model -> 'interactions' | 'legacy'
    this.ttsVariant = new Map();
  }

  async request(path, body, { method = 'POST', timeoutMs = 60000, signal } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
    const onAbort = () => ctrl.abort(signal.reason);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let res;
    try {
      res = await this.fetch(this.base + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: method === 'GET' ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new GeminiError(ctrl.signal.aborted ? 'Zaman aşımı / iptal' : `Ağ hatası: ${e.message}`, { status: 0 });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : {}; } catch { json = null; }
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || text.slice(0, 300) || `HTTP ${res.status}`;
      const code = json?.error?.status || json?.code || '';
      const ra = parseInt(res.headers.get('retry-after') || '0', 10) * 1000 || parseRetryDelay(json);
      throw new GeminiError(msg, { status: res.status, code, retryAfter: ra, body: json });
    }
    if (json == null) throw new GeminiError('Geçersiz JSON yanıtı', { status: res.status });
    return json;
  }

  async withRetry(fn, { retries = 2, signal } = {}) {
    let attempt = 0;
    for (;;) {
      try { return await fn(); } catch (e) {
        if (!(e instanceof GeminiError) || !e.retryable || attempt >= retries || signal?.aborted) throw e;
        const wait = Math.min(20000, e.retryAfter || (1500 * 2 ** attempt + Math.random() * 500));
        await sleep(wait);
        attempt++;
      }
    }
  }

  // ------------------------------------------------------------ Modeller
  async listModels() {
    const all = [];
    let token = '';
    for (let i = 0; i < 4; i++) {
      const q = `?pageSize=1000${token ? '&pageToken=' + encodeURIComponent(token) : ''}`;
      const res = await this.request('/v1beta/models' + q, null, { method: 'GET', timeoutMs: 20000 });
      all.push(...(res.models || []));
      token = res.nextPageToken;
      if (!token) break;
    }
    return all;
  }

  // ------------------------------------------------------------ Metin (JSON)
  async generateJson({ model, system, prompt, schema, temperature = 0.9, thinking = 'low', maxTokens = 8192, signal, tag = 'text' }) {
    const mode = this.mode.get(model);
    if (mode !== 'legacy') {
      try {
        const res = await this.withRetry(() => this.request('/v1beta/interactions', {
          model,
          input: prompt,
          system_instruction: system,
          response_format: { type: 'text', mime_type: 'application/json', schema },
          generation_config: { temperature, thinking_level: thinking, max_output_tokens: maxTokens },
          store: false,
        }, { timeoutMs: 90000, signal }), { signal });
        this.mode.set(model, 'interactions');
        this.reportUsage(model, res, tag);
        const text = interactionText(res);
        const json = parseJsonLoose(text);
        if (!json) throw new GeminiError('Model geçerli JSON döndürmedi', { status: 200, body: text });
        return json;
      } catch (e) {
        if (mode === 'interactions' || !(e instanceof GeminiError) || ![400, 404, 405, 501].includes(e.status)) throw e;
        // Interactions bu model/hesap için desteklenmiyor olabilir → klasik API
      }
    }
    const legacyModel = model;
    const call = (withSchema) => this.request(`/v1beta/models/${encodeURIComponent(legacyModel)}:generateContent`, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(withSchema ? { responseJsonSchema: schema } : {}),
        temperature,
        maxOutputTokens: maxTokens,
      },
    }, { timeoutMs: 90000, signal });
    let res;
    try {
      res = await this.withRetry(() => call(true), { signal });
    } catch (e) {
      if (!(e instanceof GeminiError) || e.status !== 400) throw e;
      res = await this.withRetry(() => call(false), { signal });
    }
    this.mode.set(model, 'legacy');
    this.reportUsage(model, res, tag);
    const text = (res.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    const json = parseJsonLoose(text);
    if (!json) throw new GeminiError('Model geçerli JSON döndürmedi', { status: 200, body: text });
    return json;
  }

  // ------------------------------------------------------------ Seslendirme (TTS)
  /**
   * lines: [{ speaker: 'Defne', text, style }]
   * speakers: [{ speaker: 'Defne', voice: 'Zephyr' }, { speaker: 'Kaan', voice: 'Puck' }]
   * Dönüş: { bytes: Uint8Array (WAV), mime }
   */
  async tts({ model, lines, speakers, language = 'tr-TR', kind = 'regular', settings, signal }) {
    const used = new Set(lines.map((l) => l.speaker));
    const activeSpeakers = speakers.filter((s) => used.has(s.speaker));
    const multi = activeSpeakers.length > 1;
    const mode = this.mode.get('tts:' + model);
    if (mode !== 'legacy') {
      const variants = [
        { language: true, conv: true },
        { language: false, conv: true },
        { language: false, conv: false },
      ];
      const start = this.ttsVariant.get(model) || 0;
      let lastErr = null;
      for (let vi = start; vi < variants.length; vi++) {
        const v = variants[vi];
        const content = lines.map((l) => ({
          type: 'text',
          text: l.text,
          annotations: [{
            type: 'speech_metadata',
            ...(multi ? { speaker: l.speaker } : {}),
            ...(l.style ? { style: l.style } : {}),
          }],
        }));
        const speech_config = multi
          ? { ...(v.conv ? { mode: 'conversational' } : {}), speakers: activeSpeakers.map((s) => ({ speaker: s.speaker, voice: s.voice, ...(v.language ? { language } : {}) })) }
          : [{ voice: (activeSpeakers[0] || speakers[0]).voice, ...(v.language ? { language } : {}) }];
        try {
          const res = await this.withRetry(() => this.request('/v1beta/interactions', {
            model,
            input: [{ type: 'user_input', content }],
            response_format: { type: 'audio', mime_type: 'audio/wav' },
            generation_config: { speech_config },
            store: false,
          }, { timeoutMs: 120000, signal }), { signal });
          const audio = interactionAudio(res);
          if (!audio) throw new GeminiError('Yanıtta ses yok', { status: 200 });
          this.mode.set('tts:' + model, 'interactions');
          this.ttsVariant.set(model, vi);
          this.reportUsage(model, res, 'tts');
          const bytes = ensureWav(base64ToBytes(audio.data), audio.mime_type || audio.mimeType || 'audio/wav');
          return { bytes, mime: 'audio/wav' };
        } catch (e) {
          lastErr = e;
          if (!(e instanceof GeminiError) || e.status !== 400) break; // sadece şema hatasında sonraki varyant
        }
      }
      if (mode === 'interactions' || !(lastErr instanceof GeminiError) || ![400, 404, 405, 501].includes(lastErr.status)) throw lastErr;
    }
    // Klasik generateContent TTS: önce aynı model, olmazsa bilinen eski TTS modeli
    const candidates = [...new Set([/tts/.test(model) ? model : null, this.legacyTtsModel, DEFAULT_MODELS.legacyTts].filter(Boolean))];
    const remembered = this.mode.get('tts-legacy-model:' + model);
    if (remembered) candidates.unshift(remembered);
    let lastLegacyErr = null;
    for (const legacyModel of [...new Set(candidates)]) {
      try {
        const out = await this.legacyTts({ legacyModel, lines, activeSpeakers, speakers, multi, kind, settings, signal });
        this.mode.set('tts:' + model, 'legacy');
        this.mode.set('tts-legacy-model:' + model, legacyModel);
        return out;
      } catch (e) {
        lastLegacyErr = e;
        if (!(e instanceof GeminiError) || ![400, 404].includes(e.status)) throw e;
      }
    }
    throw lastLegacyErr;
  }

  async legacyTts({ legacyModel, lines, activeSpeakers, speakers, multi, kind, settings, signal }) {
    const st = settings || { hostA: { name: speakers[0]?.speaker }, hostB: { name: speakers[1]?.speaker } };
    // 2.5 modelleri açılı etiketleri tanımaz; köşeli parantezli karşılıklarına çevrilir, tepkiler atılır
    const body = lines.map((l) => `${multi ? l.speaker + ': ' : ''}${toLegacyMarkup(l.text)}`).join('\n');
    const text = `${ttsDirectorNote(st, kind)}\n${body}`;
    const speechConfig = multi
      ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs: activeSpeakers.map((s) => ({ speaker: s.speaker, voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } } })) } }
      : { voiceConfig: { prebuiltVoiceConfig: { voiceName: (activeSpeakers[0] || speakers[0]).voice } } };
    const res = await this.withRetry(() => this.request(`/v1beta/models/${encodeURIComponent(legacyModel)}:generateContent`, {
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig },
    }, { timeoutMs: 120000, signal }), { signal });
    const part = (res.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
    if (!part) throw new GeminiError('Klasik TTS yanıtında ses yok', { status: 200 });
    this.reportUsage(legacyModel, res, 'tts');
    return { bytes: ensureWav(base64ToBytes(part.inlineData.data), part.inlineData.mimeType || 'audio/L16;rate=24000'), mime: 'audio/wav' };
  }

  reportUsage(model, res, tag) {
    const u = res?.usage || {};
    const lm = res?.usageMetadata || {};
    const input = u.total_input_tokens ?? lm.promptTokenCount ?? 0;
    const output = (u.total_output_tokens ?? lm.candidatesTokenCount ?? 0) + (u.total_thought_tokens ?? lm.thoughtsTokenCount ?? 0);
    try { this.onUsage({ model, tag, input, output }); } catch { /* yoksay */ }
  }
}

/** Interactions yanıtından metin. */
export function interactionText(res) {
  if (!res) return '';
  if (typeof res.output_text === 'string') return res.output_text;
  if (typeof res.outputText === 'string') return res.outputText;
  const steps = res.steps || res.execution_steps || [];
  const texts = [];
  for (const s of steps) {
    if (s.type !== 'model_output') continue;
    for (const c of s.content || []) if (c.type === 'text' && c.text) texts.push(c.text);
  }
  if (texts.length) return texts.join('');
  for (const o of res.outputs || []) if (o.type === 'text' && o.text) texts.push(o.text);
  return texts.join('');
}

/** Interactions yanıtından ses parçası. */
export function interactionAudio(res) {
  const steps = res?.steps || res?.execution_steps || [];
  for (const s of steps) {
    if (s.type !== 'model_output') continue;
    for (const c of s.content || []) if (c.type === 'audio' && c.data) return c;
  }
  for (const o of res?.outputs || []) if (o.type === 'audio' && o.data) return o;
  return null;
}

function versionOf(name) {
  const m = /gemini-(\d+(?:\.\d+)?)/.exec(name);
  return m ? parseFloat(m[1]) : 0;
}

/** Hesapta erişilebilen en yeni/uygun modelleri seçer. */
export function pickModels(models) {
  const names = (models || []).map((m) => String(m.name || m).replace(/^models\//, ''));
  const has = (n) => names.includes(n);
  const isPreview = (n) => /preview|exp/.test(n);
  const best = (re, exclude = /$^/) => names
    .filter((n) => re.test(n) && !exclude.test(n))
    .sort((a, b) => (versionOf(b) - versionOf(a)) || (isPreview(a) - isPreview(b)) || a.length - b.length)[0] || null;
  const notText = /tts|live|audio|image|embedding|vision|thinking-exp|computer|robotics|native|veo|imagen|lyria/;
  const text = best(/^gemini-\d+(\.\d+)?-flash(-preview[\w-]*)?$/, notText)
    || (has('gemini-flash-latest') ? 'gemini-flash-latest' : null)
    || best(/^gemini-.*flash/, /lite|tts|live|audio|image/);
  const lite = best(/^gemini-\d+(\.\d+)?-flash-lite(-preview[\w-]*)?$/, notText);
  const triage = lite && versionOf(lite) >= versionOf(text || '') - 1.01 ? lite : text;
  const tts = best(/^gemini-\d+(\.\d+)?-flash-tts$/)
    || best(/^gemini-.*flash.*tts/, /lite/)
    || best(/tts/);
  return { text, triage, tts, lyria: names.some((n) => /lyria-realtime/.test(n)) };
}
