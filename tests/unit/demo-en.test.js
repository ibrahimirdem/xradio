// İngilizce (Türkçe dışı) yayın için demo akışı ve yerel haber masası
import test from 'node:test';
import assert from 'node:assert/strict';
import { NewsDesk, guessCategory, shortHeadline, hasEventWord } from '../../extension/lib/newsdesk.js';
import { mergeSettings } from '../../extension/lib/config.js';
import { demoWave, DEMO_WAVES } from '../../extension/lib/demo-tweets.js';
import { writeLocalScript } from '../../extension/lib/localwriter.js';

test('demo akışı yayın diline göre: Türkçe yayında Türkçe, diğerlerinde İngilizce', () => {
  assert.ok(demoWave(0, Date.now()).every((t) => t.lang === 'tr'));
  for (const lang of ['en', 'de', 'ja']) assert.ok(demoWave(0, Date.now(), lang).every((t) => t.lang === 'en'));
  for (let i = 0; i < DEMO_WAVES; i++) assert.ok(demoWave(i, Date.now(), 'en').length > 0);
});

test('İngilizce demo: deprem son dakika olur ve güncellemesi aynı hikâyeye katılır; faiz haberleri tek hikâye', () => {
  const settings = mergeSettings({ language: 'en', languageConfirmed: true });
  let now = Date.parse('2026-10-04T18:00:00Z');
  const d = new NewsDesk({ settings, now: () => now });
  const breakingPerWave = [];
  for (let w = 0; w < DEMO_WAVES; w++) {
    d.ingest(demoWave(w, now, 'en')); d.triageLocal();
    breakingPerWave.push(d.breakingStories().map((s) => s.headline));
    now += 90e3;
  }
  assert.deepEqual(breakingPerWave.slice(0, 2), [[], []], 'ilk dalgalarda son dakika yok');
  assert.match(breakingPerWave[2].join(), /earthquake/);
  assert.ok(breakingPerWave.every((b) => b.length <= 1));
  const stories = [...d.stories.values()];
  assert.equal(stories.filter((s) => /earthquake/i.test(s.headline)).length, 1, 'deprem tek hikâye');
  assert.equal(stories.filter((s) => s.category === 'ekonomi' && /rate/i.test(s.headline)).length, 1, 'faiz tek hikâye');
  assert.equal(stories.find((s) => /Astronomers/.test(s.headline))?.category, 'bilim');
});

test('İngilizce kategori ve olay sözcükleri; "software" savaş sayılmaz', () => {
  assert.equal(guessCategory('Astronomers found water vapor on a planet 40 light-years away'), 'bilim');
  assert.equal(guessCategory('The national team squad is out'), 'spor');
  assert.equal(guessCategory('Merkez Bankası faizi indirdi'), 'ekonomi');
  assert.ok(hasEventWord('A strong earthquake hit the coast'));
  assert.ok(!hasEventWord('New software update ships today'));
});

test('uzun başlık yan cümle sınırından kesilir, yerel yazar çift nokta koymaz', () => {
  const h = shortHeadline('The central bank just announced its rate decision: the policy rate is cut from 5.25% to 4.75%. Markets expected less.', 90);
  assert.equal(h, 'The central bank just announced its rate decision');
  const settings = mergeSettings({ language: 'en', languageConfirmed: true });
  const now = Date.now();
  const d = new NewsDesk({ settings, now: () => now });
  d.ingest(demoWave(0, now, 'en')); d.triageLocal();
  const packets = d.pendingStories({ limit: 3 }).map((s) => d.storyPacket(s));
  for (let i = 0; i < 5; i++) {
    const sc = writeLocalScript({ kind: 'regular', stories: packets, now, settings, feed: 'ok' });
    for (const l of sc.lines) {
      assert.ok(!/\.\.|…\./.test(l.text), `çift noktalama: ${l.text}`);
      assert.ok(!/another language/.test(l.text), 'İngilizce demo paylaşımları yabancı sayılmamalı');
    }
  }
});
