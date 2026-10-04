import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExpressive, toLegacyMarkup, captionParts, expressiveStats } from '../../extension/lib/expressive.js';
import { validateScript, buildWriterSystem, interactionTargets } from '../../extension/lib/prompts.js';
import { mergeSettings } from '../../extension/lib/config.js';
import { plainSpeech } from '../../extension/lib/textutil.js';

const settings = mergeSettings({});

test('hatalı etiket biçimleri Gemini 3.8 biçimine çevrilir', () => {
  assert.equal(normalizeExpressive('Bu çok komik [laughing] değil mi?'), 'Bu çok komik <laugh> değil mi?');
  assert.equal(normalizeExpressive('(güler) Tamam tamam.'), '<laugh> Tamam tamam.');
  assert.equal(normalizeExpressive('*iç çeker* Yine mi?'), '<sigh> Yine mi?');
  assert.equal(normalizeExpressive('<Laugh> Evet <SIGH> hayır'), '<laugh> Evet <sigh> hayır');
  assert.equal(normalizeExpressive('Dur <whisper> sır bu'), 'Dur <whispers> sır bu');
});

test('bilinmeyen etiketler silinir, yan yana etiketler teke iner', () => {
  assert.equal(normalizeExpressive('Merhaba <dance> dünya'), 'Merhaba dünya');
  assert.equal(normalizeExpressive('<laugh> <chuckle> Komik'), '<laugh> Komik');
  assert.equal(normalizeExpressive('Bekle <short pause> şimdi'), 'Bekle <short pause> şimdi');
});

test('araya giren tepkiler: sınır, uzunluk, eşleşmeyen çizgi', () => {
  assert.equal(normalizeExpressive('Faiz indi |vay| ve |hıı| piyasa |yok artık| şaşırdı'), 'Faiz indi |vay| ve |hıı| piyasa şaşırdı');
  assert.equal(normalizeExpressive('Çok uzun |bu tepki gerçekten çok çok uzun bir cümle oldu| bitti'), 'Çok uzun bitti');
  assert.equal(normalizeExpressive('Tek çizgi | kaldı'), 'Tek çizgi kaldı');
  assert.equal(normalizeExpressive('Tepki |<laugh> ha ha| içinde etiket'), 'Tepki |ha ha| içinde etiket');
});

test('ciddi bölümde gülmeler ayıklanır, iç çekme kalır', () => {
  const t = normalizeExpressive('<laugh> Deprem haberi |ha ha| geldi <sigh> |hıı| geçmiş olsun', { serious: true });
  assert.ok(!/<laugh>/.test(t));
  assert.ok(!/ha ha/.test(t));
  assert.match(t, /<sigh>/);
  assert.match(t, /\|hıı\|/);
});

test('eski model biçimi ve düz metin', () => {
  assert.equal(toLegacyMarkup('<laugh> Komik |hah| <sigh> neyse'), '[laughing] Komik [sigh] neyse');
  assert.equal(plainSpeech('<chuckle> Komik |hah| değil mi'), 'Komik değil mi');
});

test('altyazı parçaları: etiket Türkçe, tepki ayrı', () => {
  const p = captionParts('<laugh> Faiz indi |yok artık| ve <short pause> bitti');
  assert.deepEqual(p.map((x) => x.type), ['tag', 'text', 'back', 'text', 'text', 'text']);
  assert.equal(p[0].value, 'güler');
  assert.equal(p[2].value, 'yok artık');
});

test('senaryo doğrulama ifadeleri normalleştirir; son dakikada gülme yok', () => {
  const json = {
    title: 'x', music_mood: 'chill', memory_note: '', covered_story_ids: [],
    lines: [
      { speaker: 'A', text: 'Şaka gibi [laughing] ama gerçek |vay|', style: 'gülerek' },
      { speaker: 'B', text: '<laugh> İnanamıyorum!', style: '' },
      { speaker: 'A', text: 'Asıl mesele şu—', style: 'heyecanlı' },
      { speaker: 'B', text: '—faiz mi?', style: 'hızlı' },
    ],
  };
  const normal = validateScript(json, { settings });
  assert.equal(normal.lines[0].text, 'Şaka gibi <laugh> ama gerçek |vay|');
  const st = expressiveStats(normal.lines);
  assert.equal(st.laughs, 2);
  assert.equal(st.backs, 1);
  assert.equal(st.interrupts, 2);
  const serious = validateScript(json, { settings, serious: true });
  assert.ok(serious.lines.every((l) => !/<laugh>/.test(l.text)));
  assert.equal(serious.lines[0].style, 'ciddi, sakin');
});

test('etkileşim hedefleri mizah ayarına ve bölüm türüne göre değişir', () => {
  const hi = interactionTargets('regular', 0.9);
  assert.match(hi, /en az 5 çok kısa/);
  assert.match(hi, /en az 6 araya giren/);
  assert.match(hi, /3-4 gülme/);
  assert.match(interactionTargets('regular', 0.1), /0 gülme/);
  assert.match(interactionTargets('breaking', 0.9), /Gülme ve şaka yok/);
});

test('yazar istemi etkileşim kurallarını ve biçim örneğini içerir', () => {
  const sys = buildWriterSystem(mergeSettings({ humor: 0.8 }));
  assert.match(sys, /ETKİLEŞİM/);
  assert.match(sys, /DİNLEYEN DJ/);
  assert.match(sys, /<laugh>/);
  assert.match(sys, /İNGİLİZCE/);
  assert.match(sys, /BİÇİM ÖRNEĞİ/);
  assert.match(sys, /hızlı atışmalar/);
  const calm = buildWriterSystem(mergeSettings({ humor: 0.1 }));
  assert.match(calm, /gülme neredeyse hiç/);
});
