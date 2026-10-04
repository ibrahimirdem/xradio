// Kullanıcı geri bildirimiyle eklenen yayın kuralları:
//  - açılışta "haber yok" denmemesi, art arda son dakika olmaması
//  - DJ'lerin tweet okumaması ve yabancı dilde konuşmaması
import test from 'node:test';
import assert from 'node:assert/strict';
import { NewsDesk, hasEventWord, hasUrgencyWord, isForeign } from '../../extension/lib/newsdesk.js';
import { mergeSettings } from '../../extension/lib/config.js';
import { enforceSpokenTurkish, languageIssue } from '../../extension/lib/expressive.js';
import { validateScript, buildWriterPrompt, buildWriterSystem, buildTriagePrompt, TRIAGE_SYSTEM } from '../../extension/lib/prompts.js';
import { writeLocalScript } from '../../extension/lib/localwriter.js';

const NOW = Date.parse('2026-10-04T18:00:00Z');
const settings = mergeSettings({ breakingThreshold: 8, minImportance: 4 });
let n = 0;
const tw = (text, { minutesAgo = 5, likes = 5000, lang = 'tr', handle } = {}) => ({
  id: String(1800000000000000000n + BigInt(++n)), text, lang, author: { name: handle || 'Haber' + n, handle: handle || 'haber' + n },
  createdAt: NOW - minutesAgo * 60e3, metrics: { likes, retweets: likes / 4, replies: 10, views: 100000 }, retweetedBy: [], seenAt: NOW,
});
const ai = (t, over = {}) => ({ tweet_id: t.id, story_id: 'yeni:' + t.id, headline: t.text.slice(0, 40), summary: t.text, category: 'gundem', importance: 9, breaking: true, new_development: false, tone: 'serious', skip: false, ...over });

test('"SON DAKİKA" etiketi tek başına olay sayılmaz; deprem gibi olay sözcüğü sayılır', () => {
  assert.ok(hasUrgencyWord('SON DAKİKA: Bakan açıklama yaptı'));
  assert.ok(!hasEventWord('SON DAKİKA: Bakan açıklama yaptı'));
  assert.ok(hasEventWord('Marmara\'da deprem'));
  const d = new NewsDesk({ settings, now: () => NOW });
  const a = tw('SON DAKİKA: Bakan yarın yeni bir açıklama yapacağını duyurdu', { likes: 60000 });
  d.ingest([a]); d.triageLocal();
  assert.equal(d.breakingStories().length, 0, 'siyasi açıklama yerel modda son dakika olmamalı');
});

test('birikmiş (45 dk\'dan eski) paylaşımlar yapay zekâ "breaking" dese de son dakika olmaz', () => {
  const d = new NewsDesk({ settings, now: () => NOW });
  const old = tw('Büyük deprem oldu', { minutesAgo: 90 });
  d.ingest([old]);
  d.applyTriage([ai(old)]);
  assert.equal(d.breakingStories().length, 0);
  assert.equal(d.pendingStories().length, 1, 'ama normal haber olarak anlatılır');
});

test('aynı partide birden çok son dakika gelirse yalnızca en önemlisi kalır', () => {
  const d = new NewsDesk({ settings, now: () => NOW });
  const a = tw('Marmara\'da 5,1 deprem', { minutesAgo: 3 });
  const b = tw('Ankara\'da patlama sesi duyuldu', { minutesAgo: 4 });
  const c = tw('Limanda yangın çıktı', { minutesAgo: 6 });
  d.ingest([a, b, c]);
  d.applyTriage([ai(a, { importance: 10 }), ai(b, { importance: 9 }), ai(c, { importance: 8 })]);
  const br = d.breakingStories();
  assert.equal(br.length, 1);
  assert.match(br[0].headline, /deprem/);
  assert.equal(d.pendingStories({ limit: 10 }).length, 3, 'diğerleri normal gündemde bekler');
});

test('dil kodu: Türkçe dışı paylaşımlar işaretlenir; yerel modda önemi düşer', () => {
  assert.ok(isForeign({ lang: 'en' }));
  assert.ok(isForeign({ lang: 'iw' }));
  assert.ok(!isForeign({ lang: 'tr' }));
  assert.ok(!isForeign({ lang: 'und' }));
  const d = new NewsDesk({ settings, now: () => NOW });
  const en = tw('Major breakthrough announced in fusion energy research today', { lang: 'en', likes: 20000 });
  const tr = tw('Füzyon enerjisi araştırmalarında büyük bir gelişme duyuruldu', { likes: 20000 });
  d.ingest([en, tr]); d.triageLocal();
  assert.ok(d.tweets.get(en.id).importance < d.tweets.get(tr.id).importance);
  assert.equal(d.storyOfTweet(en.id).foreign, true);
});

test('yayın dili koruması: tweet alıntısı ve yabancı dil satırları ayıklanır', () => {
  assert.equal(enforceSpokenTurkish('Elon Musk şöyle yazmış: “We are going to Mars and this is the best day of my life”'), null);
  assert.equal(enforceSpokenTurkish('Başbakan açıklamasında שלום dedi.'), null);
  assert.equal(enforceSpokenTurkish('The market is crashing and we have no idea what will happen'), null);
  assert.equal(enforceSpokenTurkish('On dakika önce Reuters bu haberi aktardı.'), 'On dakika önce Reuters bu haberi aktardı.');
  assert.equal(enforceSpokenTurkish('Ekonomist “kira yüksek” diyor.'), 'Ekonomist “kira yüksek” diyor.');
  // Uzun Türkçe alıntı da "tweet okuma"dır → alıntı çıkar, aktarma yarım kalırsa satır atılır
  assert.equal(enforceSpokenTurkish('Bakan şöyle yazmış: “Yarın sabah itibarıyla tüm hatlarda yeni tarife uygulanacak ve vatandaşlarımızın bu düzenlemeyi dikkate almasını rica ediyoruz”'), null);
  assert.equal(languageIssue('Tesla CEO’su yeni modeli tanıttı.'), null);
});

test('senaryo doğrulama yabancı dil satırlarını atar ve sayar', () => {
  const s = validateScript({
    title: 'x', music_mood: 'chill', memory_note: '', covered_story_ids: [],
    lines: [
      { speaker: 'A', text: 'Reuters\'ın haberine göre petrol fiyatları yükseldi.' },
      { speaker: 'B', text: 'Bakın ne yazmışlar: “Oil prices surged as the market reacted to the news”' },
      { speaker: 'A', text: 'İsrail basını ise ממשלה ifadesini kullandı.' },
      { speaker: 'B', text: 'Yani akaryakıta zam kapıda.' },
    ],
  }, { settings });
  assert.equal(s.lines.length, 2);
  assert.equal(s.dropped.length, 2);
});

test('yazar ve triyaj istemleri tweet okumayı ve son dakika enflasyonunu yasaklar', () => {
  const sys = buildWriterSystem(settings);
  assert.match(sys, /TWEET OKUMA YOK/);
  assert.match(sys, /YALNIZCA TÜRKÇE/);
  assert.match(TRIAGE_SYSTEM, /"SON DAKİKA"/);
  assert.match(TRIAGE_SYSTEM, /EN FAZLA BİR hikâye breaking/);
  const t = tw('Breaking: central bank surprises markets', { lang: 'en' });
  assert.match(buildTriagePrompt({ tweets: [t], storyIndex: [], now: NOW }), /dil: İngilizce/);
  const pkt = { id: 's1', headline: 'Merkez bankası sürpriz yaptı', summary: 'Faiz indirildi.', category: 'ekonomi', tone: 'neutral', importance: 8, breaking: false, status: 'yeni', coveredAt: null, authorsCount: 1, tweets: [t] };
  const p = buildWriterPrompt({ kind: 'regular', stories: [pkt], now: NOW, settings });
  assert.match(p, /OKUMA, alıntılama/);
  assert.match(p, /İngilizce — Türkçe diline çevirerek anlat/);
});

test('açılış: akış yüklenirken ya da X oturumu kapalıyken "haber yok" denmez', () => {
  const base = { kind: 'opener', stories: [], now: NOW, settings, firstEver: false, awayMinutes: 30 };
  assert.match(buildWriterPrompt({ ...base, feed: 'timeout' }), /henüz yükleniyor. "Haber yok" DEMEYİN/);
  assert.match(buildWriterPrompt({ ...base, feed: 'loggedOut' }), /oturum açılmamış/);
  const withNews = buildWriterPrompt({ ...base, feed: 'ok', stories: [{ id: 's1', headline: 'H', summary: '', category: 'gundem', tone: 'neutral', importance: 8, breaking: true, status: 'yeni', authorsCount: 1, tweets: [] }] });
  assert.match(withNews, /birikmiş haberlerdir: "son dakika" gibi sunmayın/);
  const local = writeLocalScript({ ...base, feed: 'timeout' });
  assert.ok(local.lines.some((l) => /tarıyoruz/.test(l.text)));
  assert.ok(!local.lines.some((l) => /pek bir şey olmamış/.test(l.text)));
});

test('yerel yazar tweet metni okumaz', () => {
  const t = tw('Belediye yarından itibaren tüm otobüs hatlarında yeni tarifeye geçileceğini açıkladı.');
  const pkt = { id: 's1', headline: 'Otobüslerde yeni tarife', summary: '', category: 'gundem', tone: 'neutral', importance: 7, status: 'yeni', authorsCount: 1, tweets: [t] };
  for (let i = 0; i < 10; i++) {
    const s = writeLocalScript({ kind: 'regular', stories: [pkt], now: NOW, settings });
    assert.ok(!s.lines.some((l) => l.text.includes('yarından itibaren tüm otobüs')), 'tweet metni okunmamalı');
    assert.ok(!s.lines.some((l) => /şöyle yazmış/.test(l.text)));
  }
});
