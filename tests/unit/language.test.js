// Dil seçimi: ilk kurulumda tarayıcı dilinden varsayılan, Başlangıç ekranında değiştirme,
// arayüz çevirilerinin eksiksiz olması ve İngilizce yayının Türkçe sızdırmaması.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, uiLangOf, personasFor, mergeSettings, DEFAULT_SETTINGS, DEFAULT_PERSONAS, DEFAULT_PERSONAS_EN, LANGUAGES } from '../../extension/lib/config.js';
import { t, setUiLang, getUiLang, uiLocale, EN } from '../../extension/ui/i18n.js';
import { collectKeys } from '../../tools/i18n-keys.mjs';
import { buildWriterSystem, buildTriageSystem, validateScript } from '../../extension/lib/prompts.js';
import { writeLocalScript } from '../../extension/lib/localwriter.js';
import { msg, shieldStrings } from '../../extension/lib/messages.js';

const NOW = Date.parse('2026-10-04T18:00:00Z');

test('tarayıcı dilinden yayın dili algılanır; desteklenmeyen dil İngilizce olur', () => {
  assert.equal(detectLanguage('tr'), 'tr');
  assert.equal(detectLanguage('tr-TR'), 'tr');
  assert.equal(detectLanguage('en-GB'), 'en');
  assert.equal(detectLanguage('de_DE'), 'de');
  assert.equal(detectLanguage('pt-BR'), 'pt');
  assert.equal(detectLanguage('zh-CN'), 'en');
  assert.equal(detectLanguage(''), 'en');
  assert.equal(detectLanguage(undefined), 'en');
});

test('dil ayarı: varsayılan onaysız, geçersiz dil Türkçe\'ye döner, kişilikler dile göre', () => {
  assert.equal(DEFAULT_SETTINGS.languageConfirmed, false);
  assert.equal(mergeSettings({ language: 'xx' }).language, 'tr');
  assert.equal(mergeSettings({ language: 'de', languageConfirmed: true }).language, 'de');
  assert.equal(personasFor('tr'), DEFAULT_PERSONAS);
  assert.equal(personasFor('ja'), DEFAULT_PERSONAS_EN);
  assert.equal(uiLangOf('tr'), 'tr');
  for (const l of LANGUAGES) if (l.code !== 'tr') assert.equal(uiLangOf(l.code), 'en');
  assert.ok(LANGUAGES.filter((l) => l.local).map((l) => l.code).sort().join() === 'en,tr', 'yerel mod yalnızca tr/en');
});

test('arayüzdeki her metnin İngilizce karşılığı var ve {değişkenler} korunuyor', async () => {
  const keys = await collectKeys();
  assert.ok(keys.length > 250, 'anahtar çıkarıcı çalışmalı');
  const missing = keys.filter((k) => !(k in EN));
  assert.deepEqual(missing, [], 'eksik çeviriler');
  for (const [k, v] of Object.entries(EN)) {
    const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(vars(v), vars(k), `değişkenler uyuşmuyor: ${k}`);
    assert.ok(!/[çğışÇĞİŞ]/.test(v), `İngilizce metinde Türkçe harf: ${v}`);
  }
});

test('t(): Türkçe arayüzde anahtar aynen, İngilizce arayüzde çeviri; değişkenler doldurulur', () => {
  setUiLang('tr');
  assert.equal(getUiLang(), 'tr');
  assert.equal(uiLocale(), 'tr-TR');
  assert.equal(t('{n} dk önce', { n: 5 }), '5 dk önce');
  setUiLang('de'); // Almanca yayın → arayüz İngilizce
  assert.equal(getUiLang(), 'en');
  assert.equal(uiLocale(), 'en-US');
  assert.equal(t('{n} dk önce', { n: 5 }), '5 min ago');
  assert.equal(t('Yayını başlat'), 'Start broadcast');
  assert.equal(t('bilinmeyen metin'), 'bilinmeyen metin', 'eksik anahtar Türkçe kalır, çökmez');
  setUiLang('tr');
});

test('arka plan mesajları ve odak kalkanı İngilizce de hazır', () => {
  assert.notEqual(msg('en', 'authFailed'), msg('tr', 'authFailed'));
  assert.ok(!/[çğışÇĞİŞ]/.test(msg('en', 'authFailed')));
  const tr = shieldStrings('tr', []); const en = shieldStrings('en', []);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(tr).sort(), 'kalkanda eksik İngilizce metin olmamalı');
});

test('İngilizce yayın: yazar ve triyaj talimatı İngilizce yayın ister', () => {
  const s = mergeSettings({ language: 'en', languageConfirmed: true, hostA: { name: 'Defne' }, hostB: { name: 'Kaan' } });
  assert.match(buildWriterSystem(s), /YAYIN DİLİ YALNIZCA İNGİLİZCE/);
  assert.match(buildTriageSystem('en'), /İngilizce/);
  assert.match(buildTriageSystem('tr'), /Türkçe/);
});

test('İngilizce yerel yazar Türkçe cümle kurmaz, tweet okumaz', () => {
  const s = mergeSettings({ language: 'en', languageConfirmed: true });
  const tweet = { id: '1', text: 'Belediye yarından itibaren tüm otobüs hatlarında yeni tarifeye geçileceğini açıkladı.', lang: 'tr', author: { name: 'Haber', handle: 'haber' }, createdAt: NOW - 5 * 60e3, metrics: { likes: 900 } };
  const pkt = { id: 's1', headline: 'New bus fares from tomorrow', summary: 'The city switches to new fares.', category: 'gundem', tone: 'neutral', importance: 7, status: 'yeni', authorsCount: 1, tweets: [tweet] };
  for (const kind of ['opener', 'regular', 'idle']) {
    for (let i = 0; i < 6; i++) {
      const out = writeLocalScript({ kind, stories: kind === 'idle' ? [] : [pkt], now: NOW, settings: s, feed: 'ok', firstEver: i === 0, awayMinutes: 30 });
      assert.ok(out.lines.length >= (kind === 'idle' ? 2 : 3), `${kind}: senaryo boş olmamalı`);
      for (const l of out.lines) {
        assert.ok(!/[ğışİŞĞ]/.test(l.text), `${kind}: Türkçe sızdı → ${l.text}`);
        assert.ok(!l.text.includes('yarından itibaren'), 'tweet metni okunmamalı');
      }
    }
  }
});

test('İngilizce yayında Türkçe/yabancı alıntı satırları ayıklanır', () => {
  const s = mergeSettings({ language: 'en', languageConfirmed: true });
  const json = { title: 'Test', lines: [
    { speaker: 'A', text: 'Big news on the bus fares tonight.' },
    { speaker: 'B', text: 'Bugün akşam saatlerinde belediye yeni tarifeyi açıkladı ve herkes çok şaşırdı gerçekten.' },
    { speaker: 'A', text: 'Fares go up from tomorrow, so plan ahead.' },
    { speaker: 'B', text: 'Good to know — thanks for the heads up! <laugh>' },
  ] };
  const out = validateScript(json, { settings: s, storyIds: [] });
  assert.ok(out.lines.every((l) => !/belediye/.test(l.text)), 'Türkçe satır İngilizce yayında kalmamalı');
  assert.ok(out.lines.length >= 3);
});

test('manifest: ad/açıklama/kısayollar her yerel dilde var, sürüm beta biçiminde', async () => {
  const fs = await import('node:fs');
  const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../extension/${p}`, import.meta.url), 'utf8'));
  const m = read('manifest.json');
  const keys = [...JSON.stringify(m).matchAll(/__MSG_(\w+)__/g)].map((x) => x[1]);
  assert.ok(keys.length >= 5);
  for (const loc of ['en', 'tr']) {
    const msgs = read(`_locales/${loc}/messages.json`);
    for (const k of keys) assert.ok(msgs[k]?.message, `${loc}: ${k} eksik`);
  }
  assert.match(m.version, /^0\.0\.\d+$/);
  assert.match(m.version_name, /beta/);
  assert.ok(m.default_locale === 'en');
});

test('odak kalkanı: deneme sayısı yer tutucusu kalkana kadar korunur', () => {
  for (const lang of ['tr', 'en']) {
    const s = shieldStrings(lang, ['Defne', 'Kaan']);
    assert.match(s.shCount, /\{n\}/);
    assert.match(s.shTextOn, /Defne/);
    assert.ok(s.shRecent);
  }
});
