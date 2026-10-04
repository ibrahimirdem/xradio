import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTweets, normalizeTweet, snowflakeTime, sanitizeDomTweet } from '../../extension/lib/xparser.js';
import { timelineFixture, IDS, NOW } from '../fixtures/x-fixtures.js';

test('zaman tünelinden tweetler çıkarılır, reklam ve silinmişler atlanır', () => {
  const tweets = extractTweets(timelineFixture(), { now: NOW });
  const ids = tweets.map((t) => t.id);
  assert.ok(ids.includes(IDS.normal));
  assert.ok(ids.includes(IDS.newUser));
  assert.ok(ids.includes(IDS.module1), 'konuşma modülündeki tweet');
  assert.ok(!ids.includes(IDS.promo), 'reklam atlanmalı');
  assert.ok(!ids.includes(IDS.rtOuter), 'retweet kabuğu değil asıl tweet gelmeli');
  assert.ok(ids.includes(IDS.rtInner));
  assert.equal(tweets.length, 7);
});

test('eski ve yeni kullanıcı yapısı, metrikler ve bağlantı temizliği', () => {
  const tweets = extractTweets(timelineFixture(), { now: NOW });
  const t = tweets.find((x) => x.id === IDS.normal);
  assert.equal(t.author.handle, 'ekonomimasasi');
  assert.equal(t.author.name, 'Ekonomi Masası');
  assert.equal(t.metrics.likes, 4200);
  assert.equal(t.metrics.views, 15000);
  assert.ok(!t.text.includes('t.co'), 't.co bağlantısı kalmamalı');
  assert.ok(t.text.includes('tcmb.gov.tr/karar'));
  assert.ok(t.text.includes('&') && !t.text.includes('&amp;'));
  assert.equal(t.url, `https://x.com/ekonomimasasi/status/${IDS.normal}`);
  const n = tweets.find((x) => x.id === IDS.newUser);
  assert.equal(n.author.handle, 'teknogunluk');
  assert.equal(n.author.followers, 52000);
  assert.equal(n.media[0].type, 'photo');
  assert.equal(n.media[0].alt, 'Kırmızı araba');
});

test('retweet eden, alıntı, uzun tweet ve yanıt aralığı', () => {
  const tweets = extractTweets(timelineFixture(), { now: NOW });
  const rt = tweets.find((x) => x.id === IDS.rtInner);
  assert.deepEqual(rt.retweetedBy.map((r) => r.handle), ['ayse']);
  assert.equal(rt.author.handle, 'tribun');
  const q = tweets.find((x) => x.id === IDS.quote);
  assert.match(q.quoted.text, /su buharı/);
  assert.equal(q.quoted.author.handle, 'bilimkapsulu');
  const note = tweets.find((x) => x.id === IDS.note);
  assert.ok(note.text.length > 300, 'note_tweet tam metni kullanılmalı');
  const vis = tweets.find((x) => x.id === IDS.vis);
  assert.equal(vis.text, 'Yanıt metni burada');
  assert.equal(vis.isReply, true);
});

test('snowflake zamanı ve tarih ayrıştırma', () => {
  const t = snowflakeTime(IDS.normal);
  assert.ok(Math.abs(t - (NOW - 20 * 60e3)) < 5);
  const tw = extractTweets(timelineFixture(), { now: NOW }).find((x) => x.id === IDS.normal);
  assert.equal(tw.createdAt, Date.parse('2026-10-04T11:40:00Z'));
  assert.equal(snowflakeTime('abc'), null);
});

test('bilinmeyen yapıdaki tweet benzeri nesneler de bulunur', () => {
  const weird = { foo: [{ bar: { rest_id: '1790000000000000000', legacy: { full_text: 'Garip yapı ama tweet', favorite_count: 3 }, core: { user_results: { result: { core: { name: 'X', screen_name: 'x' } } } } } }] };
  const tw = extractTweets(weird);
  assert.equal(tw.length, 1);
  assert.equal(tw[0].text, 'Garip yapı ama tweet');
});

test('DOM tweeti doğrulanır', () => {
  assert.equal(sanitizeDomTweet({ id: 'abc', text: 'x' }), null);
  const t = sanitizeDomTweet({ id: '1790000000000000001', text: 'Merhaba &amp; dünya', author: { name: 'A', handle: '@aa' }, metrics: { likes: '12' } });
  assert.equal(t.text, 'Merhaba & dünya');
  assert.equal(t.author.handle, 'aa');
  assert.equal(t.metrics.likes, 12);
  assert.equal(normalizeTweet(null), null);
});
