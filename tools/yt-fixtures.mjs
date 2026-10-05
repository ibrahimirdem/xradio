// YouTube arama ayrıştırıcıları için gerçek yanıtlardan sade test örnekleri üretir ve canlı denemeyi yazdırır.
// Kullanım: node tools/yt-fixtures.mjs  (internet gerekir; birim testleri kaydedilen örneklerle çevrimdışı çalışır)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ytSearch, ytPlaylist, parseMusicSongs, parseVideoSearch, parsePlaylistSearch, parsePlaylistItems, formatDuration } from '../extension/lib/ytsearch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'tests', 'fixtures', 'youtube');
fs.mkdirSync(OUT, { recursive: true });

// Yanıtı kaydetmek için fetch'i sar: ham JSON'u da yakala
let last = null;
const fetchFn = async (url, init) => {
  const r = await fetch(url, init);
  const j = await r.clone().json().catch(() => null);
  last = j;
  return r;
};
// Takip/erişilebilirlik gibi gereksiz dalları at, dizileri kısalt
const DROP = /tracking|accessibility|loggingDirectives|commandMetadata|clickTracking|onTap|rendererContext|menu|serviceEndpoint|responseContext|topbar|frameworkUpdates|onCreateListCommand|a11y/i;
function prune(o, depth = 0) {
  if (Array.isArray(o)) return o.slice(0, 12).map((x) => prune(x, depth + 1));
  if (!o || typeof o !== 'object') return o;
  const r = {};
  for (const [k, v] of Object.entries(o)) if (!DROP.test(k)) r[k] = prune(v, depth + 1);
  return r;
}
const save = (name, json) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(prune(json)));

const show = (label, list) => {
  console.log(`\n${label}: ${list.length}`);
  for (const x of list.slice(0, 4)) console.log('  ', x.kind, x.id || x.listId, '|', x.title, '|', x.artist, '|', x.duration ? formatDuration(x.duration) : x.count ? x.count + ' parça' : '');
};

show('Şarkılar (YouTube Music)', await ytSearch('tarkan şımarık', 'songs', { fetchFn }));
save('music-songs.json', last);
show('Canlı', await ytSearch('lofi radio', 'live', { fetchFn }));
save('live.json', last);
show('Çalma listeleri', await ytSearch('lofi playlist', 'playlists', { fetchFn }));
save('playlists.json', last);
show('Videolar', await ytSearch('jazz cafe music', 'videos', { fetchFn }));
save('videos.json', last);
const pl = await ytPlaylist('PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ', { fetchFn });
console.log(`\nÇalma listesi "${pl.title}": ${pl.items.length} parça`);
show('ilk parçalar', pl.items);

// Kaydedilen sade örneklerin hâlâ aynı sonucu verdiğini doğrula
const load = (n) => JSON.parse(fs.readFileSync(path.join(OUT, n), 'utf8'));
console.log('\nÖrnek dosyalar:', {
  songs: parseMusicSongs(load('music-songs.json')).length,
  live: parseVideoSearch(load('live.json')).length,
  playlists: parsePlaylistSearch(load('playlists.json')).length,
  videos: parseVideoSearch(load('videos.json')).length,
});
const b = await (await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { client: { hl: 'tr', gl: 'TR', clientName: 'WEB', clientVersion: '2.20260930.01.00' } }, browseId: 'VLPLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ' }) })).json();
save('playlist-page.json', b);
console.log('playlist-page:', parsePlaylistItems(load('playlist-page.json')).items.length, 'parça');
for (const f of fs.readdirSync(OUT)) console.log('  ', f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' KB');
