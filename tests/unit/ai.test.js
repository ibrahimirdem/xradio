import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiClient, GeminiError, pickModels, interactionText } from '../../extension/lib/gemini.js';
import { buildWriterPrompt, buildWriterSystem, validateScript, parseJsonLoose, buildTriagePrompt, validateTriage, cleanTitle } from '../../extension/lib/prompts.js';
import { writeLocalScript } from '../../extension/lib/localwriter.js';
import { mergeSettings } from '../../extension/lib/config.js';
import { pcm16ToWav, wavInfo, isWav, bytesToBase64 } from '../../extension/lib/wav.js';
import { chunkLines, estimateTimings } from '../../extension/lib/voice.js';
import { plainSpeech, stems, storySimilarity } from '../../extension/lib/textutil.js';
import { toLegacyMarkup } from '../../extension/lib/expressive.js';

const settings = mergeSettings({ listenerName: 'Deniz', humor: 0.7 });
const NOW = Date.parse('2026-10-04T14:42:00+03:00');

const packet = (over = {}) => ({
  id: 's1', headline: 'Merkez Bankası faizi indirdi', summary: 'Politika faizi yüzde 30.', category: 'ekonomi', tone: 'neutral',
  importance: 8, breaking: false, status: 'yeni', coveredAt: null, authorsCount: 3,
  tweets: [{ id: '1', author: { name: 'Ekonomi Masası', handle: 'eko' }, text: 'Faiz yüzde 30\'a indi https://t.co/x', createdAt: NOW - 12 * 60e3, metrics: { likes: 3200 }, retweetedBy: [] }],
  ...over,
});

// ------------------------------------------------------------ İstemler
test('yazar istemi: zaman, dinleyici, müzik, hafıza ve hikâye bilgisi içerir', () => {
  const p = buildWriterPrompt({ kind: 'regular', stories: [packet()], now: NOW, settings, memory: ['14:20 — Açılış: Kaan faiz esprisi yaptı'], nextTrack: { kind: 'current', title: 'lofi hip hop radio 📚 beats to relax/study to', artist: 'Lofi Girl' }, shieldCount: 3, weather: 'İstanbul: 18 derece, açık' });
  assert.match(p, /Gündem arası/);
  assert.match(p, /saat 14:42/);
  assert.match(p, /Deniz/);
  assert.match(p, /3 kez X'i açmaya/);
  assert.match(p, /\[s1\] Merkez Bankası faizi indirdi/);
  assert.match(p, /3 farklı hesap/);
  assert.match(p, /Lofi Girl/);
  assert.ok(!p.includes('📚'), 'emoji temizlenmeli');
  assert.match(p, /faiz esprisi/);
  const sys = buildWriterSystem(settings);
  assert.match(sys, /A = Defne \(kadın\)/);
  assert.match(sys, /B = Kaan \(erkek\)/);
  assert.match(sys, /ASLA şaka yapma/);
});

test('son dakika ve gelişme istemleri', () => {
  const p = buildWriterPrompt({ kind: 'breaking', stories: [packet({ breaking: true, tone: 'serious' })], now: NOW, settings });
  assert.match(p, /SON DAKİKA/);
  assert.match(p, /Espri YOK/);
  assert.ok(!p.includes('KÜÇÜK DETAY'), 'son dakikada kalkan şakası olmamalı');
  const g = buildWriterPrompt({ kind: 'regular', stories: [packet({ status: 'gelisme', coveredAt: NOW - 40 * 60e3 })], now: NOW, settings });
  assert.match(g, /GELİŞME/);
  assert.match(g, /40 dk önce/);
});

test('senaryo doğrulama: isim eşleme, link temizliği, bilinmeyen hikâye kimliği', () => {
  const out = validateScript({
    title: 'Faiz', music_mood: 'chill', memory_note: 'not',
    covered_story_ids: ['s1', 'uydurma'],
    lines: [
      { speaker: 'Defne', text: 'Defne: Merhaba! https://x.com/abc', style: 'neşeli' },
      { speaker: 'B', text: 'Selam <laugh>' },
      { speaker: 'kim?', text: 'Üçüncü satır' },
      { speaker: 'A', text: '   ' },
    ],
  }, { settings, storyIds: ['s1'] });
  assert.equal(out.lines.length, 3);
  assert.equal(out.lines[0].speaker, 'A');
  assert.equal(out.lines[0].text, 'Merhaba!');
  assert.equal(out.lines[2].speaker, 'A', 'bilinmeyen konuşmacı sırayla atanır');
  assert.deepEqual(out.covered, ['s1']);
  assert.equal(out.musicMood, 'chill');
  assert.equal(validateScript({ lines: [] }, { settings }), null);
  assert.equal(validateScript('x', { settings }), null);
});

test('gevşek JSON ayıklama', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Tabii! İşte: {"a":{"b":"} içinde"}} ve bitti'), { a: { b: '} içinde' } });
  assert.deepEqual(parseJsonLoose('[1,2]'), [1, 2]);
  assert.equal(parseJsonLoose('yok'), null);
});

test('triyaj istemi ve doğrulama', () => {
  const tw = { id: '99', author: { name: 'A', handle: 'a' }, text: 'Deprem oldu', createdAt: NOW, metrics: { likes: 10, retweets: 2 }, retweetedBy: [{ handle: 'b' }] };
  const p = buildTriagePrompt({ tweets: [tw], storyIndex: [{ id: 's1', headline: 'Eski', covered: true, summary: 'x' }], now: NOW });
  assert.match(p, /s1 \| ANLATILDI \| Eski/);
  assert.match(p, /\[99\]/);
  assert.match(p, /RT edenler: @b/);
  const v = validateTriage({ items: [{ tweet_id: 99, story_id: 'yeni:deprem', importance: '12', category: 'xx', tone: 'bad', breaking: 1 }, { tweet_id: '5' }] }, new Set(['99']));
  assert.equal(v.length, 1);
  assert.equal(v[0].importance, 10);
  assert.equal(v[0].category, 'diger');
  assert.equal(v[0].tone, 'neutral');
  assert.equal(v[0].breaking, true);
});

test('YouTube başlığı temizleme', () => {
  assert.equal(cleanTitle('lofi hip hop radio 📚 beats to relax/study to'), 'lofi hip hop radio beats to relax/study to');
  assert.equal(cleanTitle('Gentleman Radio | Deep House • Chillout'), 'Gentleman Radio — Deep House — Chillout');
});

// ------------------------------------------------------------ Yerel yazar
test('yerel yazar her bölüm türü için geçerli diyalog üretir', () => {
  for (const kind of ['opener', 'regular', 'breaking', 'idle', 'recap', 'hourly', 'listener']) {
    const s = writeLocalScript({
      kind, settings, now: NOW, stories: kind === 'idle' || kind === 'recap' ? [] : [packet()],
      nextTrack: { kind: 'next', title: 'Kadıköy Yağmuru' }, recentHeadlines: ['Faiz indirildi'], message: 'biraz caz çalar mısınız?', firstEver: true,
    });
    assert.ok(s.lines.length >= 2, kind);
    for (const l of s.lines) { assert.ok(['A', 'B'].includes(l.speaker)); assert.ok(plainSpeech(l.text).length > 1); }
    if (['regular', 'breaking', 'opener'].includes(kind)) assert.deepEqual(s.covered, ['s1'], kind);
  }
  const l = writeLocalScript({ kind: 'listener', settings, now: NOW, stories: [], message: 'Biraz caz çalar mısınız?' });
  assert.equal(l.musicMood, 'groovy');
});

// ------------------------------------------------------------ Gemini istemcisi (sahte fetch)
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, headers: init.headers });
    for (const r of routes) {
      if (r.match(url, body)) {
        const out = typeof r.reply === 'function' ? r.reply(url, body) : r.reply;
        return new Response(JSON.stringify(out.json ?? out), { status: out.http || 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ error: { message: 'yok' } }), { status: 404 });
  };
  f.calls = calls;
  return f;
}

test('generateJson: Interactions API yanıtı ve anahtar başlığı', async () => {
  const fetchImpl = fakeFetch([{ match: (u) => u.endsWith('/v1beta/interactions'), reply: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"ok":true}' }] }], usage: { total_input_tokens: 10, total_output_tokens: 5 } } }]);
  const usage = [];
  const c = new GeminiClient({ apiKey: 'KEY', base: 'http://mock', fetchImpl, onUsage: (u) => usage.push(u) });
  const out = await c.generateJson({ model: 'gemini-3.8-flash', system: 's', prompt: 'p', schema: { type: 'object' } });
  assert.deepEqual(out, { ok: true });
  assert.equal(fetchImpl.calls[0].headers['x-goog-api-key'], 'KEY');
  assert.equal(fetchImpl.calls[0].body.response_format.mime_type, 'application/json');
  assert.equal(fetchImpl.calls[0].body.store, false);
  assert.equal(usage[0].input, 10);
});

test('generateJson: Interactions 404 → klasik generateContent', async () => {
  const fetchImpl = fakeFetch([
    { match: (u) => u.endsWith('/interactions'), reply: { http: 404, json: { error: { message: 'not found' } } } },
    { match: (u) => u.includes(':generateContent'), reply: { candidates: [{ content: { parts: [{ text: '```json\n{"x":2}\n```' }] } }], usageMetadata: { promptTokenCount: 3 } } },
  ]);
  const c = new GeminiClient({ apiKey: 'K', base: 'http://mock', fetchImpl });
  assert.deepEqual(await c.generateJson({ model: 'm', system: 's', prompt: 'p', schema: {} }), { x: 2 });
  // ikinci çağrıda doğrudan klasik yol
  await c.generateJson({ model: 'm', system: 's', prompt: 'p', schema: {} });
  assert.equal(fetchImpl.calls.filter((x) => x.url.endsWith('/interactions')).length, 1);
});

test('generateJson: 401 yeniden denenmez, authProblem işaretlenir', async () => {
  const fetchImpl = fakeFetch([{ match: () => true, reply: { http: 401, json: { error: { message: 'API key not valid', status: 'UNAUTHENTICATED' } } } }]);
  const c = new GeminiClient({ apiKey: 'bad', base: 'http://mock', fetchImpl });
  await assert.rejects(c.generateJson({ model: 'm', system: 's', prompt: 'p', schema: {} }), (e) => e instanceof GeminiError && e.authProblem && e.status === 401);
  assert.equal(fetchImpl.calls.length, 1);
});

test('tts: çok konuşmacılı Interactions isteği ve WAV yanıtı; 400 → sade varyant', async () => {
  const wav = pcm16ToWav(new Uint8Array(4800), 24000, 1);
  let n = 0;
  const fetchImpl = fakeFetch([{
    match: (u) => u.endsWith('/interactions'),
    reply: (u, body) => {
      n++;
      if (body.generation_config.speech_config.speakers?.[0]?.language) return { http: 400, json: { error: { message: 'Unknown field language' } } };
      return { steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: bytesToBase64(wav) }] }] };
    },
  }]);
  const c = new GeminiClient({ apiKey: 'K', base: 'http://mock', fetchImpl });
  const lines = [{ speaker: 'Defne', text: 'Merhaba', style: 'neşeli' }, { speaker: 'Kaan', text: 'Selam' }];
  const out = await c.tts({ model: 'gemini-3.8-flash-tts', lines, speakers: [{ speaker: 'Defne', voice: 'Zephyr' }, { speaker: 'Kaan', voice: 'Puck' }], settings });
  assert.ok(isWav(out.bytes));
  assert.equal(n, 2);
  const req = fetchImpl.calls[1].body;
  assert.equal(req.generation_config.speech_config.mode, 'conversational');
  assert.deepEqual(req.generation_config.speech_config.speakers.map((s) => s.voice), ['Zephyr', 'Puck']);
  assert.equal(req.input[0].content[0].annotations[0].speaker, 'Defne');
  assert.equal(req.input[0].content[0].annotations[0].style, 'neşeli');
  assert.equal(req.response_format.type, 'audio');
  // Sonraki çağrı doğrudan çalışan varyantla başlar
  await c.tts({ model: 'gemini-3.8-flash-tts', lines, speakers: [{ speaker: 'Defne', voice: 'Zephyr' }, { speaker: 'Kaan', voice: 'Puck' }], settings });
  assert.equal(n, 3);
});

test('tts: Interactions yoksa klasik API, PCM → WAV', async () => {
  const pcm = new Uint8Array(48000);
  const fetchImpl = fakeFetch([
    { match: (u) => u.endsWith('/interactions'), reply: { http: 404, json: { error: { message: 'nope' } } } },
    { match: (u) => u.includes('gemini-2.5-flash-preview-tts:generateContent'), reply: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: bytesToBase64(pcm) } }] } }] } },
  ]);
  const c = new GeminiClient({ apiKey: 'K', base: 'http://mock', fetchImpl });
  const out = await c.tts({ model: 'custom-voice-model', lines: [{ speaker: 'Defne', text: 'Merhaba <laugh>' }], speakers: [{ speaker: 'Defne', voice: 'Zephyr' }, { speaker: 'Kaan', voice: 'Puck' }], settings });
  const info = wavInfo(out.bytes);
  assert.equal(info.sampleRate, 24000);
  assert.ok(Math.abs(info.duration - 1) < 0.01);
  const legacyReq = fetchImpl.calls.at(-1).body;
  assert.ok(legacyReq.generationConfig.speechConfig.voiceConfig, 'tek konuşmacı → voiceConfig');
  assert.match(legacyReq.contents[0].parts[0].text, /\[laughing\]/, 'eski 2.5 modelleri köşeli etiket bekler');
});

test('model seçimi: en yeni kararlı flash / tts', () => {
  const list = ['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.8-flash-preview-09-2026', 'gemini-3.8-flash-lite',
    'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-2.5-pro-preview-tts', 'gemini-3.1-pro-preview', 'gemini-3.8-live', 'text-embedding-004', 'models/lyria-realtime-exp']
    .map((n) => ({ name: 'models/' + n }));
  const p = pickModels(list);
  assert.equal(p.text, 'gemini-3.8-flash');
  assert.equal(p.triage, 'gemini-3.8-flash-lite');
  assert.equal(p.tts, 'gemini-3.8-flash-tts');
  const old = pickModels([{ name: 'models/gemini-flash-latest' }, { name: 'models/gemini-2.5-flash-preview-tts' }]);
  assert.equal(old.text, 'gemini-flash-latest');
  assert.equal(old.tts, 'gemini-2.5-flash-preview-tts');
  assert.equal(interactionText({ outputs: [{ type: 'text', text: 'eski biçim' }] }), 'eski biçim');
});

// ------------------------------------------------------------ Ses yardımcıları
test('TTS parçalama ve zamanlama', () => {
  const lines = Array.from({ length: 12 }, (_, i) => ({ speaker: i % 2 ? 'B' : 'A', text: 'Cümle '.repeat(5 + i) }));
  const chunks = chunkLines(lines);
  assert.equal(chunks[0].length, 3, 'ilk parça kısa');
  assert.equal(chunks.flat().length, 12);
  const t = estimateTimings(lines.slice(0, 3), 9);
  assert.equal(t[0].start, 0);
  assert.ok(Math.abs(t[2].end - 9) < 1e-9);
  assert.ok(t[1].start > 0 && t[1].start < t[2].start);
  assert.equal(plainSpeech('Merhaba <laugh> nasılsın |hıı| iyi'), 'Merhaba nasılsın iyi');
  assert.equal(toLegacyMarkup('A <short pause> B |hıı| C'), 'A [short pause] B C');
});

test('Türkçe kök ve hikâye benzerliği', () => {
  assert.deepEqual(stems('bankası kararını faizi'), ['banka', 'karar', 'faiz']);
  assert.ok(storySimilarity('İstanbul\'da deprem oldu', 'Deprem sonrası AFAD açıklama yaptı') >= 0.5);
  assert.ok(storySimilarity('Galatasaray maçı kazandı', 'Yeni telefon tanıtıldı') < 0.3);
});
