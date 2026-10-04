import test from 'node:test';
import assert from 'node:assert/strict';
import { NewsDesk, localImportance, hasBreakingKeyword, guessCategory } from '../../extension/lib/newsdesk.js';
import { mergeSettings } from '../../extension/lib/config.js';
import { demoWave } from '../../extension/lib/demo-tweets.js';

let clock = Date.parse('2026-10-04T12:00:00Z');
const now = () => clock;
const settings = mergeSettings({ minImportance: 4, breakingThreshold: 8 });
let n = 0;
function tw(text, { handle = 'a' + (++n), likes = 300, rts = 50, minutesAgo = 5, id } = {}) {
  return {
    id: id || String(1790000000000000000n + BigInt(++n)),
    text, author: { name: handle, handle }, createdAt: clock - minutesAgo * 60e3,
    metrics: { likes, retweets: rts, replies: 5, quotes: 1, views: 10000 }, retweetedBy: [], seenAt: clock,
  };
}

test('aynı tweet iki kez gelirse tek kayıt, metrikler güncellenir', () => {
  const d = new NewsDesk({ settings, now });
  const t = tw('Merkez Bankası faiz kararını açıkladı, politika faizi yüzde 30');
  assert.equal(d.ingest([t]).fresh.length, 1);
  const again = { ...t, metrics: { ...t.metrics, likes: 999 }, retweetedBy: [{ name: 'B', handle: 'b' }] };
  const r = d.ingest([again]);
  assert.equal(r.fresh.length, 0);
  assert.equal(d.tweets.get(t.id).metrics.likes, 999);
  assert.equal(d.tweets.get(t.id).retweetedBy.length, 1);
});

test('farklı hesaplardan aynı olay tek hikâyede toplanır (yerel)', () => {
  const d = new NewsDesk({ settings, now });
  const a = tw('Merkez Bankası faiz kararını açıkladı: politika faizi yüzde 32\'den yüzde 30\'a indirildi.', { likes: 4000, rts: 1200 });
  const b = tw('Merkez Bankası politika faizini yüzde 30\'a indirdi, piyasa beklentisinin üzerinde bir indirim.', { likes: 800 });
  const c = tw('Milli takım aday kadrosu açıklandı, listede 4 yeni isim var.', { likes: 2000 });
  d.ingest([a, b, c]);
  d.triageLocal();
  const sa = d.tweets.get(a.id).storyId;
  const sb = d.tweets.get(b.id).storyId;
  const sc = d.tweets.get(c.id).storyId;
  assert.equal(sa, sb, 'faiz haberleri aynı hikâye olmalı');
  assert.notEqual(sa, sc);
  assert.equal(d.stories.get(sa).authors.length, 2);
});

test('anlatılan hikâye tekrar bekleyenlere düşmez; sadece yeni gelişme düşer', () => {
  const d = new NewsDesk({ settings, now });
  const a = tw('Marmara Denizi\'nde 4,9 büyüklüğünde deprem meydana geldi, AFAD açıklama yaptı.', { likes: 9000, rts: 4000 });
  d.ingest([a]);
  d.applyTriage([{ tweet_id: a.id, story_id: 'yeni:deprem', headline: 'Marmara\'da 4,9 deprem', summary: 'Deprem oldu.', category: 'gundem', importance: 9, breaking: true, new_development: false, tone: 'serious', skip: false }]);
  const sid = d.tweets.get(a.id).storyId;
  assert.equal(d.breakingStories().length, 1);
  assert.equal(d.pendingStories()[0].id, sid);
  d.markCovered([sid]);
  assert.equal(d.pendingStories().length, 0);
  assert.equal(d.breakingStories().length, 0);

  // Aynı konuda tekrar (yeni bilgi yok)
  const b = tw('Az önce deprem oldu, herkes iyi mi?', { likes: 50 });
  d.ingest([b]);
  d.applyTriage([{ tweet_id: b.id, story_id: sid, headline: '', summary: '', category: 'gundem', importance: 5, breaking: false, new_development: false, tone: 'serious', skip: false }]);
  assert.equal(d.pendingStories().length, 0, 'tekrar eden haber anlatılmamalı');

  // Gerçek gelişme ama bekleme süresi dolmadı
  const c = tw('AFAD: 3 artçı sarsıntı kaydedildi, can kaybı yok.', { likes: 3000 });
  d.ingest([c]);
  d.applyTriage([{ tweet_id: c.id, story_id: sid, headline: '', summary: 'Artçılar oldu, kayıp yok.', category: 'gundem', importance: 7, breaking: false, new_development: true, tone: 'serious', skip: false }]);
  assert.equal(d.pendingStories().length, 0, 'bekleme süresi dolmadan gelişme anlatılmaz');
  clock += 30 * 60e3;
  const p = d.pendingStories();
  assert.equal(p.length, 1);
  const pkt = d.storyPacket(p[0]);
  assert.equal(pkt.status, 'gelisme');
  assert.deepEqual(pkt.tweets.map((t) => t.id), [c.id], 'pakette sadece yeni bilgi olmalı');
});

test('yapay zekâ "yeni" dese de çok benzer hikâye varsa birleştirilir', () => {
  const d = new NewsDesk({ settings, now });
  const a = tw('Yerli elektrikli otomobilin yeni kompakt modeli 620 km menzille geliyor, ön sipariş cuma başlıyor.');
  const b = tw('Yerli elektrikli otomobil yeni kompakt modelinde 620 km menzil sunacak; ön siparişler cuma.');
  d.ingest([a]);
  d.applyTriage([{ tweet_id: a.id, story_id: 'yeni:otomobil', headline: 'Yeni elektrikli otomobil', importance: 6 }]);
  d.ingest([b]);
  d.applyTriage([{ tweet_id: b.id, story_id: 'yeni:baska-ad', headline: 'Elektrikli araç menzili', importance: 6 }]);
  assert.equal(d.tweets.get(a.id).storyId, d.tweets.get(b.id).storyId);
});

test('neredeyse kopya tweet işaretlenir; sessize alınan kelimeler alınmaz', () => {
  const d = new NewsDesk({ settings: mergeSettings({ muteWords: ['kripto'] }), now });
  const a = tw('Son dakika: Belediye yarın tüm hatlarda ücretsiz ulaşım olacağını duyurdu.');
  const b = tw('Son dakika: Belediye yarın tüm hatlarda ücretsiz ulaşım olacağını duyurdu!!');
  const m = tw('Kripto piyasasında büyük hareket');
  const r = d.ingest([a, b, m]);
  assert.equal(d.tweets.get(b.id).dupOf, a.id);
  assert.equal(r.fresh.length, 2, 'sessize alınan hariç');
});

test('yerel önem puanı mantıklı sıralar', () => {
  const big = localImportance(tw('SON DAKİKA: büyük deprem', { likes: 20000, rts: 8000, minutesAgo: 10 }), { now: clock });
  const gm = localImportance(tw('günaydın', { likes: 3, rts: 0 }), { now: clock });
  const ad = localImportance(tw('Çekiliş! Hemen katıl, indirim kodu burada', { likes: 50 }), { now: clock });
  assert.ok(big >= 8, `büyük: ${big}`);
  assert.ok(gm <= 2, `gm: ${gm}`);
  assert.ok(ad < 3, `reklam: ${ad}`);
  assert.ok(hasBreakingKeyword('FLAŞ gelişme'));
  assert.equal(guessCategory('Galatasaray derbide 2 gol attı'), 'spor');
  assert.equal(guessCategory('Dolar rekor kırdı, borsa düştü'), 'ekonomi');
});

test('rezervasyon: hazırlanan hikâye ikinci bölüme verilmez', () => {
  const d = new NewsDesk({ settings, now });
  const a = tw('Yeni bir bilimsel keşif: gezegende su buharı bulundu, makale yayımlandı.', { likes: 3000 });
  d.ingest([a]); d.triageLocal();
  const s = d.pendingStories()[0];
  d.reserve([s.id], 'seg1');
  assert.equal(d.pendingStories().length, 0);
  d.release('seg1');
  assert.equal(d.pendingStories().length, 1);
});

test('kalıcılık: JSON\'a yazıp geri okuma', () => {
  const d = new NewsDesk({ settings, now });
  d.ingest(demoWave(0, clock));
  d.triageLocal();
  const json = JSON.parse(JSON.stringify(d.toJSON()));
  const d2 = NewsDesk.fromJSON(json, { settings, now });
  assert.equal(d2.tweets.size, d.tweets.size);
  assert.equal(d2.stories.size, d.stories.size);
  assert.ok(d2.board().stories.length > 0);
});

test('demo akışı: faiz haberleri birleşir, "günaydın" atlanır, deprem son dakika olur', () => {
  const d = new NewsDesk({ settings, now });
  d.ingest(demoWave(0, clock));
  d.triageLocal();
  const faiz = [...d.stories.values()].filter((s) => /faiz/i.test(s.headline + s.summary));
  assert.equal(faiz.length, 1, 'faiz tek hikâye: ' + faiz.map((s) => s.headline).join(' | '));
  assert.ok(faiz[0].authors.length >= 2);
  const pend = d.pendingStories({ limit: 20 });
  assert.ok(!pend.some((s) => /^günaydın/i.test(s.headline)));
  d.ingest(demoWave(2, clock));
  d.triageLocal();
  assert.equal(d.breakingStories().length, 1, 'deprem son dakika');
});
