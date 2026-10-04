// Sahte Gemini API sunucusu (test için).
// Interactions API (POST /v1beta/interactions), klasik generateContent ve model listesini taklit eder.
// Triyaj ve senaryo isteklerine istemdeki bilgilere dayanan mantıklı JSON, TTS isteklerine konuşmaya benzeyen WAV döner.
//   node tests/mock/gemini-mock.mjs [port]

import http from 'node:http';

const SR = 24000;

function wavFromLines(lines, voices) {
  const chunks = [];
  for (const [i, l] of lines.entries()) {
    const text = String(l.text || '').replace(/<[^>]+>|\|[^|]+\|/g, '');
    const dur = Math.max(0.6, Math.min(12, text.length / 15));
    const base = (voices[l.speaker] || 'f') === 'f' ? 205 + (i % 3) * 6 : 118 + (i % 3) * 4;
    const n = Math.floor(dur * SR);
    const pcm = new Int16Array(n + Math.floor(0.25 * SR));
    let syl = 0; let sylLen = 0; let phase = 0;
    for (let k = 0; k < n; k++) {
      if (k >= syl + sylLen) { syl = k; sylLen = Math.floor((0.11 + Math.random() * 0.12) * SR); }
      const p = (k - syl) / sylLen;
      const env = Math.sin(Math.PI * p) ** 0.7 * (0.55 + 0.45 * Math.sin(k / SR * 3.1));
      const f = base * (1 + 0.06 * Math.sin(k / SR * 5 + i));
      phase += (2 * Math.PI * f) / SR;
      const v = Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.25 + Math.sin(phase * 3) * 0.12;
      pcm[k] = Math.round(v * env * 0.32 * 32767);
    }
    chunks.push(pcm);
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const data = Buffer.alloc(total * 2);
  let o = 0;
  for (const c of chunks) for (const s of c) { data.writeInt16LE(s, o); o += 2; }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(SR, 24);
  head.writeUInt32LE(SR * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const FEMALE = new Set(['Zephyr', 'Kore', 'Leda', 'Aoede', 'Callirrhoe', 'Autonoe', 'Despina', 'Erinome', 'Laomedeia', 'Achernar', 'Gacrux', 'Pulcherrima', 'Vindemiatrix', 'Sulafat']);

function triage(prompt) {
  const items = [];
  const existing = [...prompt.matchAll(/^- (s[a-z0-9]+) \| (ANLATILDI|bekliyor) \| (.+?) —/gm)].map((m) => ({ id: m[1], covered: m[2] === 'ANLATILDI', headline: m[3] }));
  const blocks = prompt.split(/\n(?=\[\d+\])/);
  for (const b of blocks) {
    const m = b.match(/^\[(\d+)\]/);
    if (!m) continue;
    const text = (b.match(/Metin: (.+)/) || [])[1] || '';
    const low = text.toLocaleLowerCase('tr-TR');
    let key = 'yeni:' + (low.replace(/[^a-zçğıöşü0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 4)[0] || 'konu');
    let headline = text.split(/[.:!?]/)[0].slice(0, 70);
    let importance = 6; let breaking = false; let tone = 'neutral'; let category = 'gundem'; let dev = false;
    if (/faiz|merkez bankası|mevduat/.test(low)) { key = 'yeni:faiz'; headline = 'Merkez Bankası faiz indirdi'; category = 'ekonomi'; importance = 8; }
    if (/deprem|artçı/.test(low)) { key = 'yeni:deprem'; headline = 'Marmara\'da 4,9 büyüklüğünde deprem'; category = 'gundem'; tone = 'serious'; importance = /son dakika/.test(low) ? 9 : 7; breaking = /son dakika/.test(low); dev = /artçı/.test(low); }
    if (/milli takım|orta saha/.test(low)) { key = 'yeni:milli'; headline = 'Milli takım aday kadrosu açıklandı'; category = 'spor'; importance = 6; }
    if (/günaydın|^gm/.test(low.trim())) { importance = 1; }
    const ex = existing.find((e) => e.headline === headline);
    if (ex) key = ex.id;
    items.push({ tweet_id: m[1], story_id: key, headline, summary: text.slice(0, 160), category, importance, breaking, new_development: !!ex && dev, tone, skip: importance < 2 });
  }
  return { items };
}

function writer(system, prompt) {
  const A = (system.match(/A = (\S+) \(kadın\)/) || [])[1] || 'Defne';
  const B = (system.match(/B = (\S+) \(erkek\)/) || [])[1] || 'Kaan';
  const kind = (prompt.match(/BÖLÜM TÜRÜ: ([^.\n]+)/) || [])[1] || '';
  const stories = [...prompt.matchAll(/^\[(s[a-z0-9]+)\] (?:🔴 SON DAKİKA · )?(.+)$/gm)].map((m) => ({ id: m[1], headline: m[2] }));
  const lines = [];
  if (/SON DAKİKA/.test(kind)) {
    const s = stories[0];
    lines.push({ speaker: 'A', text: `Son dakika… Müziği kısıyoruz. ${s ? s.headline : 'Önemli bir gelişme var'}.`, style: 'ciddi, net' });
    lines.push({ speaker: 'B', text: 'Şu ana kadar olumsuz bir ihbar yok; resmi açıklamaları takip ediyoruz.', style: 'sakin' });
    lines.push({ speaker: 'A', text: 'Yeni bilgi geldikçe hemen buradayız. <short pause> Müziğe dönüyoruz.', style: 'sakin' });
  } else {
    lines.push({ speaker: 'A', text: kind.includes('açılış') ? `Merhaba, ben ${A}! XRadio yayında |selam| ve bugün akış dolu.` : 'Müziği biraz kısalım |hıı| akışta yeni şeyler var.', style: 'enerjik' });
    lines.push({ speaker: 'B', text: `<chuckle> Ben de ${B}. Bakalım neler olmuş.`, style: 'neşeli' });
    for (const s of stories.slice(0, 3)) {
      lines.push({ speaker: 'A', text: `${s.headline}. |vay| Takip ettiğin hesaplar bunu konuşuyor.` });
      lines.push({ speaker: 'B', text: 'Asıl ilginç olan şu—', style: 'heyecanlı' });
      lines.push({ speaker: 'A', text: '—dur tahmin edeyim, yine herkes aynı anda paylaşmış! [laughing]', style: 'alaycı' });
      lines.push({ speaker: 'B', text: '<laugh> Aynen öyle.' });
    }
    if (!stories.length) lines.push({ speaker: 'A', text: 'Şu an akış sakin, biz de müziğin tadını çıkaralım.' });
  }
  return { title: stories[0]?.headline || (kind.includes('açılış') ? 'Yayın açılışı' : 'Ara sohbet'), lines, covered_story_ids: stories.slice(0, 3).map((s) => s.id), music_mood: 'chill', memory_note: `Test bölümü (${kind.slice(0, 30)})` };
}

export function startMock(port = 8787, { latency = 250 } = {}) {
  const log = [];
  const config = { failTts: false, failText: false, failInteractions: false };
  const server = http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-goog-api-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : null;
    const send = (status, obj) => { res.writeHead(status, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__log') return send(200, log);
    if (url.pathname === '/__config') { Object.assign(config, json || {}); return send(200, config); }
    if (url.pathname === '/__reset') { log.length = 0; return send(200, { ok: true }); }
    const key = req.headers['x-goog-api-key'];
    if (key === 'bad-key') return send(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
    await new Promise((r) => setTimeout(r, latency));

    if (req.method === 'GET' && url.pathname === '/v1beta/models') {
      log.push({ type: 'models' });
      return send(200, { models: ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'].map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) });
    }
    if (req.method === 'POST' && url.pathname === '/v1beta/interactions') {
      if (config.failInteractions) return send(404, { error: { message: 'interactions not found' } });
      if (json.response_format?.type === 'audio') {
        const items = json.input?.[0]?.content || [];
        log.push({ type: 'tts', model: json.model, lines: items.length, text: items.map((c) => c.text).join(' ').slice(0, 2000), styles: items.map((c) => c.annotations?.[0]?.style).filter(Boolean), mode: json.generation_config?.speech_config?.mode });
        if (config.failTts) return send(503, { error: { message: 'TTS overloaded', status: 'UNAVAILABLE' } });
        const sc = json.generation_config?.speech_config;
        const voices = {};
        for (const s of (Array.isArray(sc) ? [] : sc?.speakers || [])) voices[s.speaker] = FEMALE.has(s.voice) ? 'f' : 'm';
        if (Array.isArray(sc)) voices[undefined] = FEMALE.has(sc[0]?.voice) ? 'f' : 'm';
        const lines = (json.input?.[0]?.content || []).map((c) => ({ text: c.text, speaker: c.annotations?.[0]?.speaker }));
        const wav = wavFromLines(lines, voices);
        return send(200, { id: 'v1_mock', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: wav.toString('base64') }] }], usage: { total_input_tokens: 50, total_output_tokens: 400 } });
      }
      const system = json.system_instruction || '';
      const prompt = typeof json.input === 'string' ? json.input : '';
      if (config.failText) return send(500, { error: { message: 'internal' } });
      let out;
      if (/haber masası editörü/.test(system)) { out = triage(prompt); log.push({ type: 'triage', n: out.items.length }); }
      else if (/baş yazarı/.test(system)) { out = writer(system, prompt); log.push({ type: 'writer', kind: (prompt.match(/BÖLÜM TÜRÜ: ([^.\n]+)/) || [])[1], stories: out.covered_story_ids.length, prompt }); }
      else { out = { selam: 'Merhaba, XRadio test yayınındasın!' }; log.push({ type: 'other' }); }
      return send(200, { id: 'v1_mock', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(out) }] }], usage: { total_input_tokens: prompt.length / 4, total_output_tokens: 300 } });
    }
    if (req.method === 'POST' && /:generateContent$/.test(url.pathname)) {
      log.push({ type: 'legacy', path: url.pathname });
      if (json.generationConfig?.responseModalities?.includes('AUDIO')) {
        const wav = wavFromLines([{ text: json.contents[0].parts[0].text.slice(0, 200), speaker: 'x' }], {});
        return send(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: wav.subarray(44).toString('base64') } }] } }] });
      }
      const prompt = json.contents?.[0]?.parts?.[0]?.text || '';
      const system = json.systemInstruction?.parts?.[0]?.text || '';
      const out = /haber masası/.test(system) ? triage(prompt) : writer(system, prompt);
      return send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } });
    }
    send(404, { error: { message: 'bulunamadı: ' + url.pathname } });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, log, config, url: `http://127.0.0.1:${port}` })));
}

if (process.argv[1] && process.argv[1].endsWith('gemini-mock.mjs')) {
  const port = +(process.argv[2] || 8787);
  startMock(port).then(({ url }) => console.log('Sahte Gemini sunucusu:', url));
}
