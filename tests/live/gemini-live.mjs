// Gerçek Gemini API'sine karşı küçük, düşük maliyetli canlı test.
//   1) .env.local dosyasına GEMINI_API_KEY=... yaz (git'e girmez)
//   2) node tests/live/gemini-live.mjs
// Yapılan çağrılar: model listesi, 1 triyaj, 1 senaryo, 1-2 seslendirme. Ses dosyaları tests/e2e/out/ altına kaydedilir.
// Anahtar hiçbir zaman ekrana yazdırılmaz.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeminiClient, pickModels } from '../../extension/lib/gemini.js';
import { mergeSettings, personasFor, langInfo } from '../../extension/lib/config.js';
import { NewsDesk } from '../../extension/lib/newsdesk.js';
import { demoWave } from '../../extension/lib/demo-tweets.js';
import {
  buildTriageSystem, TRIAGE_SCHEMA, buildTriagePrompt, validateTriage,
  SCRIPT_SCHEMA, buildWriterSystem, buildWriterPrompt, validateScript,
} from '../../extension/lib/prompts.js';
import { chunkLines } from '../../extension/lib/voice.js';
import { expressiveStats } from '../../extension/lib/expressive.js';
import { wavInfo } from '../../extension/lib/wav.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(root, 'tests', 'e2e', 'out');
fs.mkdirSync(OUT, { recursive: true });

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const f = path.join(root, '.env.local');
  if (!fs.existsSync(f)) return null;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*["']?([^"'\s]+)["']?\s*$/);
    if (m) return m[1];
  }
  return null;
}

const key = loadKey();
if (!key) {
  console.log('GEMINI_API_KEY bulunamadı. Proje kökünde .env.local dosyasına GEMINI_API_KEY=... satırını ekle.');
  process.exit(2);
}
console.log(`Anahtar bulundu (…${key.slice(-4)}).`);

const usage = [];
const client = new GeminiClient({ apiKey: key, onUsage: (u) => usage.push(u) });
// LANG_CODE=en|de|…: yayın dili (varsayılan Türkçe; kabuğun LANG değişkeniyle karışmasın diye ayrı ad)
const LANG = process.env.LANG_CODE || 'tr';
const P = personasFor(LANG);
const settings = mergeSettings({ apiKey: key, listenerName: process.env.LISTENER || 'Deniz', humor: 0.65, language: LANG, languageConfirmed: true, hostA: { persona: P.A }, hostB: { persona: P.B } });
console.log('Yayın dili:', langInfo(LANG).native);
const t = () => performance.now();
const ms = (t0) => `${Math.round(performance.now() - t0)} ms`;

// 1) Modeller
let t0 = t();
const list = await client.listModels();
const picked = pickModels(list);
console.log(`\n1) Model listesi: ${list.length} model (${ms(t0)})`);
console.log(`   Metin: ${picked.text} · Triyaj: ${picked.triage} · Ses: ${picked.tts}`);
const textModel = process.env.TEXT_MODEL || picked.text || settings.textModel;
const ttsModel = process.env.TTS_MODEL || picked.tts || settings.ttsModel;

// 2) Triyaj (kurgusal demo paylaşımları: faiz haberleri + deprem)
const now = Date.now();
const desk = new NewsDesk({ settings, now: () => now });
// SCENARIO=mixed: gerçek bir X akışına benzeyen karışık paket (yabancı dil, "SON DAKİKA" enflasyonu, eski haber)
function mixedTweets(t) {
  let k = 0;
  const mk = (name, handle, text, lang, minutesAgo, likes) => ({
    id: String(1900000000000000000n + BigInt(++k)), url: `https://x.com/${handle}/status/${k}`, text, lang, createdAt: t - minutesAgo * 60e3,
    author: { name, handle, verified: true }, metrics: { likes, retweets: Math.round(likes / 5), replies: 50, views: likes * 30 }, retweetedBy: [], seenAt: t,
  });
  return [
    mk('Gündem Haber', 'gundemhaber_demo', 'SON DAKİKA: Bakan, yarın yeni ulaşım paketini açıklayacaklarını söyledi. (DEMO)', 'tr', 12, 3000),
    mk('Haber Merkezi', 'habermerkezi_demo', 'SON DAKİKA | Muhalefet lideri: "Bu bütçe halkın bütçesi değil" (DEMO)', 'tr', 20, 4500),
    mk('Global Wire', 'globalwire_demo', 'BREAKING: European Central Bank unexpectedly cuts rates by 50 basis points, citing slowing growth. (DEMO)', 'en', 8, 22000),
    mk('Tech Daily', 'techdaily_demo', 'This new open-source AI model just beat every benchmark we threw at it. Wild times. (DEMO)', 'en', 35, 9000),
    mk('Israel News Desk', 'ilnewsdesk_demo', 'הממשלה הודיעה הערב על תוכנית חדשה לחיזוק התחבורה הציבורית בערים הגדולות (DEMO)', 'iw', 25, 2500),
    mk('Afet Takip', 'afettakip_demo', 'Kuzey Ege açıklarında 5,2 büyüklüğünde deprem meydana geldi; çevre illerde hissedildi. (DEMO)', 'tr', 125, 15000),
    mk('Son Dakika Ajansı', 'sondakikaajans_demo', 'SON DAKİKA: İstanbul Boğazı\'nda bir tanker arızalandı, gemi trafiği çift yönlü askıya alındı. (DEMO)', 'tr', 4, 26000),
    mk('Spor Ekranı', 'sporekrani_demo', 'SON DAKİKA: Yıldız forvet sezon sonuna kadar sözleşme uzattı! (DEMO)', 'tr', 15, 8000),
  ];
}
const tweets = process.env.SCENARIO === 'mixed' ? mixedTweets(now) : [...demoWave(0, now), ...demoWave(2, now)];
desk.ingest(tweets);
t0 = t();
const triJson = await client.generateJson({
  model: picked.triage || textModel,
  system: buildTriageSystem(settings.language),
  prompt: buildTriagePrompt({ tweets, storyIndex: desk.storyIndex(), now }),
  schema: TRIAGE_SCHEMA,
  temperature: 0.2,
  thinking: 'low',
  tag: 'triage',
});
const items = validateTriage(triJson, new Set(tweets.map((x) => x.id)));
desk.applyTriage(items, 'ai');
console.log(`\n2) Triyaj: ${items.length}/${tweets.length} paylaşım sınıflandı (${ms(t0)}, ${client.mode.get(picked.triage || textModel)} API)`);
for (const s of [...desk.stories.values()].sort((a, b) => b.importance - a.importance)) {
  console.log(`   ${s.breaking ? '🔴' : '  '} [${Math.round(s.importance)}/10] ${s.headline}  (${s.tweetIds.length} paylaşım, ${s.category}, ${s.tone})`);
}
const skipped = items.filter((i) => i.skip).length;
console.log(`   Atlanan (önemsiz/spam): ${skipped}`);
console.log(`   Yapay zekânın "breaking" dediği: ${items.filter((i) => i.breaking).length} · masada son dakika kalan: ${desk.breakingStories().length}`);

// 3) Senaryo (normal gündem arası)
const pending = desk.pendingStories({ limit: 3 });
const packets = pending.map((s) => desk.storyPacket(s));
t0 = t();
const scJson = await client.generateJson({
  model: textModel,
  system: buildWriterSystem(settings),
  prompt: buildWriterPrompt({ kind: 'regular', stories: packets, now, settings, memory: [], nextTrack: { kind: 'current', title: 'lofi hip hop radio 📚 beats to relax/study to', artist: 'Lofi Girl' }, shieldCount: 3, demo: true }),
  schema: SCRIPT_SCHEMA,
  temperature: 1.0,
  thinking: 'low',
  tag: 'writer',
});
const script = validateScript(scJson, { settings, storyIds: packets.map((p) => p.id) });
console.log(`\n3) Senaryo: "${script?.title}" — ${script?.lines.length} satır (${ms(t0)}, ${client.mode.get(textModel)} API)`);
for (const l of script?.lines || []) console.log(`   ${l.speaker === 'A' ? settings.hostA.name : settings.hostB.name}: ${l.text}${l.style ? `  [${l.style}]` : ''}`);
console.log(`   Anlatılan hikâyeler: ${script?.covered.length} · müzik havası: ${script?.musicMood}`);
if (script) {
  const st = expressiveStats(script.lines);
  console.log(`   Yayın dili koruması: ${script.dropped.length} satır ayıklandı${script.dropped.length ? ' → ' + script.dropped.join(' | ') : ''}`);
  console.log(`   Etkileşim: ${st.laughs} gülme · ${st.backs} araya giren tepki · ${st.interrupts} söz kesme · ${st.shortLines} kısa atışma · ${st.tags} etiket · ${st.styled} duygu tarifli satır`);
}
fs.writeFileSync(path.join(OUT, 'live-senaryo.json'), JSON.stringify(scJson, null, 2));

// 4) Seslendirme (ilk 1-2 parça)
if (script && !process.env.NO_TTS) {
  const named = script.lines.map((l) => ({ ...l, speaker: l.speaker === 'A' ? settings.hostA.name : settings.hostB.name }));
  // Eklentideki gibi: bölüm tek büyük parçada seslendirilir (sohbet akışı kopmasın)
  const chunks = chunkLines(named, { first: 18, max: 18, maxChars: 2600 }).slice(0, Number(process.env.TTS_CHUNKS || 1));
  const speakers = [{ speaker: settings.hostA.name, voice: settings.hostA.voice }, { speaker: settings.hostB.name, voice: settings.hostB.voice }];
  for (const [i, c] of chunks.entries()) {
    t0 = t();
    const { bytes } = await client.tts({ model: ttsModel, lines: c, speakers, settings, language: langInfo(LANG).bcp47 });
    const info = wavInfo(bytes);
    const file = path.join(OUT, `live-dj-${i + 1}.wav`);
    fs.writeFileSync(file, bytes);
    console.log(`\n4.${i + 1}) Ses: ${c.length} satır → ${info?.duration.toFixed(1)} sn, ${info?.sampleRate} Hz (${ms(t0)}, ${client.mode.get('tts:' + ttsModel)} API) → ${path.relative(root, file)}`);
  }
}

const tot = usage.reduce((a, u) => ({ input: a.input + u.input, output: a.output + u.output }), { input: 0, output: 0 });
console.log(`\nToplam: ${usage.length} çağrı · ${tot.input} giriş + ${tot.output} çıkış token`);
