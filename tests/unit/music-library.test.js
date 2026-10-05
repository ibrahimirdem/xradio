// Müzik sekmesi: YouTube / YouTube Music arama ayrıştırıcıları (gerçek yanıtlardan sadeleştirilmiş örneklerle),
// kişisel liste doğrulaması ve oynatıcı kuyruğu (sıra, karıştırma, atlama, liste düzenleme).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseMusicSongs, parseVideoSearch, parsePlaylistSearch, parsePlaylistItems,
  durationToSeconds, formatDuration, toTrack, ytSearch,
} from '../../extension/lib/ytsearch.js';
import { mergeSettings } from '../../extension/lib/config.js';
import { YouTubeMusic } from '../../extension/audio/youtube-player.js';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`../fixtures/youtube/${n}`, import.meta.url), 'utf8'));
const ID = /^[A-Za-z0-9_-]{11}$/;

test('süre dönüşümleri', () => {
  assert.equal(durationToSeconds('3:56'), 236);
  assert.equal(durationToSeconds('1:02:03'), 3723);
  assert.equal(durationToSeconds('CANLI'), 0);
  assert.equal(formatDuration(236), '3:56');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(0), '');
});

test('YouTube Music şarkı araması: başlık, sanatçı, albüm, süre, kare kapak', () => {
  const songs = parseMusicSongs(fx('music-songs.json'));
  assert.ok(songs.length >= 8, `${songs.length} şarkı`);
  for (const s of songs) {
    assert.equal(s.kind, 'song');
    assert.match(s.id, ID);
    assert.ok(s.title && s.artist, JSON.stringify(s));
    assert.ok(s.duration > 30 && s.duration < 3600, `süre ${s.duration}`);
    assert.match(s.thumb, /^https:\/\//);
  }
  assert.ok(songs.some((s) => /tarkan/i.test(s.artist)));
  assert.equal(new Set(songs.map((s) => s.id)).size, songs.length, 'tekrar yok');
});

test('YouTube canlı yayın ve video aramaları ayrışır', () => {
  const live = parseVideoSearch(fx('live.json'));
  assert.ok(live.filter((x) => x.live).length >= 5, 'canlı yayınlar tanınmalı');
  assert.ok(live.filter((x) => x.live).every((x) => x.duration === 0));
  const videos = parseVideoSearch(fx('videos.json'));
  assert.ok(videos.length >= 8);
  assert.ok(videos.filter((x) => !x.live).every((x) => x.duration > 0 && ID.test(x.id) && x.title && x.artist));
});

test('çalma listesi araması ve çalma listesi içeriği (yeni lockup biçimi)', () => {
  const pls = parsePlaylistSearch(fx('playlists.json'));
  assert.ok(pls.length >= 8);
  for (const p of pls) { assert.equal(p.kind, 'playlist'); assert.ok(p.listId && p.title); }
  assert.ok(pls.some((p) => p.count > 0), 'parça sayısı okunmalı');
  const page = parsePlaylistItems(fx('playlist-page.json'));
  assert.ok(page.items.length >= 8);
  assert.ok(page.items.every((x) => ID.test(x.id) && x.title && x.duration > 0));
});

test('bilinmeyen yanıt yapısı çökmez, boş liste döner', () => {
  for (const fn of [parseMusicSongs, parseVideoSearch, parsePlaylistSearch]) {
    assert.deepEqual(fn({}), []);
    assert.deepEqual(fn(null), []);
  }
  assert.deepEqual(parsePlaylistItems({}).items, []);
});

test('arama: şarkı araması boşsa video aramasına düşer; boş sorgu istek atmaz', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push(url);
    const body = JSON.parse(init.body);
    const json = url.includes('music.youtube.com') ? {} : fx('videos.json');
    assert.ok(body.context.client.clientName);
    return { ok: true, json: async () => json };
  };
  const r = await ytSearch('jazz', 'songs', { fetchFn });
  assert.ok(r.length > 0 && r[0].kind === 'video');
  assert.equal(calls.length, 2);
  assert.deepEqual(await ytSearch('   ', 'songs', { fetchFn }), []);
  assert.equal(calls.length, 2);
});

test('kişisel liste: geçersiz kayıtlar ayıklanır, tekrar yok, en fazla 500 parça', () => {
  const t = (i) => ({ id: ('v' + String(i).padStart(10, '0')).slice(0, 11), title: 'Şarkı ' + i, artist: 'Sanatçı', duration: 200 });
  const s = mergeSettings({ musicSource: 'mylist', myList: [t(1), t(1), { id: 'kötü', title: 'x' }, null, t(2), ...Array.from({ length: 600 }, (_, i) => t(i + 3))] });
  assert.equal(s.musicSource, 'mylist');
  assert.equal(s.myList.length, 500);
  assert.equal(new Set(s.myList.map((x) => x.id)).size, 500);
  assert.equal(s.myList[0].title, 'Şarkı 1');
  assert.equal(mergeSettings({ musicSource: 'spotify' }).musicSource, 'youtube');
  assert.equal(toTrack({ id: 'abc' }), null);
  assert.deepEqual(Object.keys(toTrack({ id: 'dQw4w9WgXcQ', title: 'T', artist: 'A', duration: 5, album: 'x', kind: 'song' })).sort(), ['artist', 'duration', 'id', 'thumb', 'title']);
});

// ---------------------------------------------------------------- oynatıcı kuyruğu (DOM'suz sahte motor ile)
function fakePlayer(queue, opts = {}) {
  const engine = { onLevels: () => () => {}, musicLevel: 0.7, duckValue: 1, masterLevel: 0.9 };
  const tracks = [];
  const yt = new YouTubeMusic(engine, { queue, onTrack: (m) => tracks.push(m), ...opts });
  yt.note = () => {};
  const posts = [];
  yt.iframe = { remove() {}, contentWindow: {} };
  yt.ready = true;
  yt.post = (o) => posts.push(o);
  yt.startEmbed = () => { yt.active = 'embed'; };
  yt.checkStarted = () => {}; // gerçek oynatıcı yok: "çalma başladı mı" bekçisi Node'da çalışmasın
  return { yt, posts, tracks };
}
const Q = ['aaaaaaaaaa1', 'bbbbbbbbbb2', 'cccccccccc3', 'dddddddddd4'].map((id, i) => ({ id, title: 'Parça ' + (i + 1), artist: 'Sanatçı', duration: 180 }));

test('kuyruk: sırayla çalar, biten parçadan sonrakine geçer, sona gelince başa döner', async () => {
  const { yt, posts } = fakePlayer(Q);
  await yt.start();
  assert.equal(yt.currentTrack().id, Q[0].id);
  yt.state = 1;
  yt.setState(0); // parça bitti
  assert.equal(yt.currentTrack().id, Q[1].id);
  assert.deepEqual(posts.at(-2)?.func === 'loadVideoById' ? posts.at(-2).args[0].videoId : posts.find((p) => p.func === 'loadVideoById')?.args[0].videoId, Q[1].id);
  await yt.skip(); await yt.skip(); await yt.skip();
  assert.equal(yt.currentTrack().id, Q[0].id, 'liste başa döner');
  const np = yt.nowPlaying();
  assert.equal(np.trackId, Q[0].id);
  assert.equal(np.title, 'Parça 1');
  assert.deepEqual(np.queue, { index: 1, total: 4, shuffle: false, name: '' });
});

test('kuyruk: çalınamayan parça atlanır; hepsi çalınamazsa liste modundan çıkılır', async () => {
  const { yt } = fakePlayer(Q);
  const statuses = [];
  yt.onStatus = (s) => statuses.push(s);
  await yt.start();
  yt.onPlayerError(150);
  assert.equal(yt.currentTrack().id, Q[1].id);
  yt.onPlayerError(150); yt.onPlayerError(150);
  assert.equal(yt.currentTrack().id, Q[3].id);
  let switched = null;
  yt.switchTo = async (url) => { switched = url; };
  yt.onPlayerError(150);
  assert.equal(yt.queue, null, 'liste modu bırakıldı');
  assert.ok(switched, 'hazır yayına geçildi');
});

test('kuyruk: "şimdi çal", karıştırma ve liste düzenleme çalan parçayı kesmez', async () => {
  const { yt } = fakePlayer(Q, { startId: Q[2].id });
  await yt.start();
  assert.equal(yt.currentTrack().id, Q[2].id, 'startId ile başlar');
  assert.ok(yt.playId(Q[3].id));
  assert.equal(yt.currentTrack().id, Q[3].id);
  assert.equal(yt.playId('yokyokyokyo'), false);
  // Listeye ekleme + sıralama değişikliği: çalan parça aynı kalır
  const edited = [Q[3], Q[0], Q[1], { id: 'eeeeeeeeee5', title: 'Yeni', artist: 'A', duration: 100 }];
  assert.ok(yt.updateQueue(edited, false));
  assert.equal(yt.currentTrack().id, Q[3].id);
  await yt.skip();
  assert.equal(yt.currentTrack().id, Q[0].id, 'yeni sıraya göre devam eder');
  // Karıştırma açıldı: çalan parça başta kalır, tüm parçalar sırada bir kez yer alır
  assert.ok(yt.updateQueue(edited, true));
  assert.equal(yt.currentTrack().id, Q[0].id);
  assert.equal(new Set(yt.order).size, edited.length);
});

test('hazır çalma listesi bağlantısı parça kuyruğuna dönüşür; okunamazsa gömülü liste moduna düşer', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => fx('playlist-page.json') });
    const { yt } = fakePlayer(null, { url: 'https://www.youtube.com/playlist?list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ' });
    let embedded = 0;
    yt.startEmbed = () => { embedded++; yt.active = 'embed'; };
    await yt.start();
    assert.ok(yt.queue && yt.queue.length >= 8, 'kuyruk kuruldu');
    assert.equal(yt.isMyList, false);
    assert.equal(embedded, 1);
    assert.equal(yt.parsed.videoId, yt.currentTrack().id, 'tek tek video çalınır (videoseries değil)');
    const np = yt.nowPlaying();
    assert.ok(np.queue.total >= 8 && np.queue.name !== undefined);
    assert.equal(np.url, 'https://www.youtube.com/playlist?list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ');
    assert.equal(yt.currentGroup(), 'Lo-fi', 'hazır grup çalma listesi adresinden bulunur');

    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const b = fakePlayer(null, { url: 'https://www.youtube.com/playlist?list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ' }).yt;
    let started = false;
    b.startEmbed = () => { started = true; };
    await b.start();
    assert.equal(b.queue, null);
    assert.ok(started && b.parsed.listId && !b.parsed.videoId, 'eski gömülü liste moduna düştü');
  } finally {
    globalThis.fetch = realFetch;
  }
});
