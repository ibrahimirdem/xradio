// YouTube / YouTube Music araması ve çalma listesi içe aktarma (API anahtarı gerektirmez).
// YouTube'un kendi web arayüzünün kullandığı "youtubei" uç noktalarına istek atılır; eklentinin site izni
// (www.youtube.com, music.youtube.com) sayesinde CORS sorunu olmaz. Ayrıştırıcılar saf JS'dir, Node'da test edilir.
// YouTube yanıt yapısını zaman zaman değiştirir: ayrıştırıcılar hem eski (…Renderer) hem yeni (lockupViewModel)
// biçimleri tanır; hiçbir şey bulunamazsa boş liste döner, çağıran taraf kullanıcıya bunu söyler.

const CLIENTS = {
  web: { host: 'www.youtube.com', client: { clientName: 'WEB', clientVersion: '2.20260930.01.00' } },
  music: { host: 'music.youtube.com', client: { clientName: 'WEB_REMIX', clientVersion: '1.20260930.01.00' } },
};

// Arama filtreleri (YouTube'un kendi "params" değerleri)
const PARAMS = {
  songs: 'EgWKAQIIAWoKEAkQBRAKEAMQBA==', // YouTube Music → yalnızca şarkılar (görüntüsüz resmî ses kayıtları)
  videos: 'EgIQAQ==',                    // YouTube → videolar
  live: 'EgJAAQ==',                      // YouTube → şu an canlı
  playlists: 'EgIQAw==',                 // YouTube → çalma listeleri
};

export const SEARCH_KINDS = ['songs', 'live', 'playlists', 'videos'];
export const MAX_LIST = 500; // kişisel listedeki en fazla parça

// ------------------------------------------------------------------ yardımcılar
function walk(o, key, out = []) {
  if (!o || typeof o !== 'object') return out;
  if (Array.isArray(o)) { for (const v of o) walk(v, key, out); return out; }
  for (const [k, v] of Object.entries(o)) {
    if (k === key) out.push(v);
    else walk(v, key, out);
  }
  return out;
}
const runs = (t) => (t?.runs ? t.runs.map((r) => r.text).join('') : t?.simpleText || t?.content || '');
const DURATION_RE = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;

/** "3:56" / "1:02:03" → saniye */
export function durationToSeconds(s) {
  if (!s || !DURATION_RE.test(String(s).trim())) return 0;
  return String(s).trim().split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
}

/** saniye → "3:56" / "1:02:03" */
export function formatDuration(sec) {
  sec = Math.round(Number(sec) || 0);
  if (!sec) return '';
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0');
}

export const videoThumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Parça nesnesini kalıcı listede saklanacak sade biçime indirger. */
export function toTrack(x) {
  if (!x || !ID_RE.test(x.id || '')) return null;
  return {
    id: x.id,
    title: String(x.title || '').slice(0, 200),
    artist: String(x.artist || '').slice(0, 120),
    duration: Number(x.duration) || 0,
    thumb: x.thumb || videoThumb(x.id),
    ...(x.live ? { live: true } : {}),
  };
}

// ------------------------------------------------------------------ ayrıştırıcılar
/** YouTube Music şarkı araması. */
export function parseMusicSongs(json) {
  const out = [];
  for (const it of walk(json, 'musicResponsiveListItemRenderer')) {
    const id = it.playlistItemData?.videoId
      || walk(it.overlay, 'watchEndpoint').map((w) => w.videoId).find(Boolean)
      || walk(it.flexColumns, 'watchEndpoint').map((w) => w.videoId).find(Boolean);
    if (!id || !ID_RE.test(id)) continue;
    const cols = (it.flexColumns || []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []);
    const title = (cols[0] || []).map((r) => r.text).join('').trim();
    // ikinci sütun: "Sanatçı • Albüm • 3:56" (ayraçlar ayrı run'lar)
    const parts = (cols[1] || []).map((r) => r.text).join('').split(/\s+•\s+/).map((p) => p.trim()).filter(Boolean);
    const duration = durationToSeconds(parts.find((p) => DURATION_RE.test(p)));
    const meta = parts.filter((p) => !DURATION_RE.test(p));
    const thumbs = it.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    const thumb = thumbs.length ? thumbs[thumbs.length - 1].url.replace(/=w\d+-h\d+/, '=w120-h120') : videoThumb(id);
    if (!title) continue;
    out.push({ kind: 'song', id, title, artist: meta[0] || '', album: meta[1] || '', duration, thumb });
  }
  return dedupe(out);
}

/** YouTube video / canlı yayın araması (eski videoRenderer ve yeni lockupViewModel). */
export function parseVideoSearch(json) {
  const out = [];
  for (const v of walk(json, 'videoRenderer')) {
    if (!ID_RE.test(v.videoId || '')) continue;
    const badges = JSON.stringify(v.badges || []) + JSON.stringify(v.thumbnailOverlays || []);
    const live = /LIVE_NOW|"style":"LIVE"/.test(badges) || (!v.lengthText && /CANLI|LIVE/i.test(badges));
    out.push({
      kind: live ? 'live' : 'video', id: v.videoId, title: runs(v.title), artist: runs(v.ownerText) || runs(v.shortBylineText),
      duration: durationToSeconds(v.lengthText?.simpleText), thumb: videoThumb(v.videoId), live,
    });
  }
  for (const l of walk(json, 'lockupViewModel')) {
    if (l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !ID_RE.test(l.contentId || '')) continue;
    out.push(lockupVideo(l));
  }
  return dedupe(out.filter((x) => x.title));
}

function lockupMeta(l) {
  const m = l.metadata?.lockupMetadataViewModel || {};
  const rows = (m.metadata?.contentMetadataViewModel?.metadataRows || []).map((r) => (r.metadataParts || []).map((p) => p.text?.content || '').filter(Boolean));
  const badgeTexts = walk(l.contentImage, 'text').map((t) => (typeof t === 'string' ? t : t?.content)).filter(Boolean);
  return { title: m.title?.content || '', rows, badgeTexts };
}

function lockupVideo(l) {
  const { title, rows, badgeTexts } = lockupMeta(l);
  const dur = badgeTexts.find((t) => DURATION_RE.test(t));
  const live = !dur && badgeTexts.some((t) => /CANLI|LIVE/i.test(t));
  return { kind: live ? 'live' : 'video', id: l.contentId, title, artist: rows[0]?.[0] || '', duration: durationToSeconds(dur), thumb: videoThumb(l.contentId), live };
}

/** YouTube çalma listesi araması. */
export function parsePlaylistSearch(json) {
  const out = [];
  for (const l of walk(json, 'lockupViewModel')) {
    if (l.contentType !== 'LOCKUP_CONTENT_TYPE_PLAYLIST' || !l.contentId) continue;
    const { title, rows, badgeTexts } = lockupMeta(l);
    const count = Number((badgeTexts.find((t) => /\d/.test(t) && !DURATION_RE.test(t)) || '').replace(/\D/g, '')) || 0;
    const src = walk(l.contentImage, 'sources')[0] || [];
    out.push({ kind: 'playlist', listId: l.contentId, title, artist: rows[0]?.[0] || '', count, thumb: src[src.length - 1]?.url || src[0]?.url || '' });
  }
  for (const p of walk(json, 'playlistRenderer')) {
    if (!p.playlistId) continue;
    const th = p.thumbnails?.[0]?.thumbnails || [];
    out.push({ kind: 'playlist', listId: p.playlistId, title: runs(p.title), artist: runs(p.shortBylineText), count: Number(p.videoCount) || 0, thumb: th[th.length - 1]?.url || '' });
  }
  const seen = new Set();
  return out.filter((x) => x.title && !seen.has(x.listId) && seen.add(x.listId));
}

/** Çalma listesi sayfasındaki parçalar + sonraki sayfa belirteci. */
export function parsePlaylistItems(json) {
  const items = [];
  for (const v of walk(json, 'playlistVideoRenderer')) {
    if (!ID_RE.test(v.videoId || '') || v.isPlayable === false) continue;
    items.push({ kind: 'video', id: v.videoId, title: runs(v.title), artist: runs(v.shortBylineText), duration: Number(v.lengthSeconds) || durationToSeconds(v.lengthText?.simpleText), thumb: videoThumb(v.videoId) });
  }
  for (const l of walk(json, 'lockupViewModel')) {
    if (l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !ID_RE.test(l.contentId || '')) continue;
    items.push(lockupVideo(l));
  }
  const title = runs(json?.header?.playlistHeaderRenderer?.title) || json?.metadata?.playlistMetadataRenderer?.title
    || walk(json?.header, 'dynamicTextViewModel').map((d) => d.text?.content).find(Boolean) || '';
  const token = walk(json, 'continuationCommand').map((c) => c.token).find(Boolean) || null;
  return { title, items: dedupe(items.filter((x) => x.title)), continuation: token };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((x) => !seen.has(x.id) && seen.add(x.id));
}

// ------------------------------------------------------------------ ağ
async function youtubei(which, path, body, { hl = 'tr', gl = 'TR', fetchFn = fetch, signal } = {}) {
  const c = CLIENTS[which];
  const r = await fetchFn(`https://${c.host}/youtubei/v1/${path}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'omit',
    signal,
    body: JSON.stringify({ context: { client: { hl, gl, ...c.client } }, ...body }),
  });
  if (!r.ok) throw new Error(`YouTube ${r.status}`);
  return r.json();
}

/**
 * Arama. kind: songs (YouTube Music şarkıları) | live | playlists | videos.
 * Şarkı araması boş dönerse ya da başarısız olursa YouTube video aramasına düşülür.
 */
export async function ytSearch(query, kind = 'songs', opts = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (kind === 'songs') {
    try {
      const songs = parseMusicSongs(await youtubei('music', 'search', { query: q, params: PARAMS.songs }, opts));
      if (songs.length) return songs;
    } catch (e) { if (e.name === 'AbortError') throw e; }
    return parseVideoSearch(await youtubei('web', 'search', { query: q, params: PARAMS.videos }, opts));
  }
  const json = await youtubei('web', 'search', { query: q, params: PARAMS[kind] || PARAMS.videos }, opts);
  if (kind === 'playlists') return parsePlaylistSearch(json);
  const list = parseVideoSearch(json);
  return kind === 'live' ? list.filter((x) => x.live) : list.filter((x) => !x.live);
}

/** Çalma listesinin parçaları (en fazla `limit`; sayfalar takip edilir). */
export async function ytPlaylist(listId, { limit = 200, ...opts } = {}) {
  let page = parsePlaylistItems(await youtubei('web', 'browse', { browseId: listId.startsWith('VL') ? listId : 'VL' + listId }, opts));
  const title = page.title;
  const items = [...page.items];
  for (let i = 0; i < 8 && page.continuation && items.length < limit; i++) {
    page = parsePlaylistItems(await youtubei('web', 'browse', { continuation: page.continuation }, opts));
    if (!page.items.length) break;
    items.push(...page.items);
  }
  return { title, items: dedupe(items).slice(0, limit) };
}

/** Tek bir video bağlantısının başlığı/kanalı (oEmbed; süre vermez). */
export async function ytVideoInfo(videoId, { fetchFn = fetch, signal } = {}) {
  const r = await fetchFn(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}`, { credentials: 'omit', signal });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Bu video gömülemiyor' : `YouTube ${r.status}`);
  const j = await r.json();
  return { kind: 'video', id: videoId, title: j.title || videoId, artist: j.author_name || '', duration: 0, thumb: videoThumb(videoId) };
}
