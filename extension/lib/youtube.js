// YouTube bağlantılarını çözümleme ve hazır müzik seçenekleri (saf JS, Node'da test edilir).

/**
 * Hazır seçenekler. 4 Ekim 2026'da eklenti içindeki gömülü oynatıcıda tek tek denenip çalıştığı doğrulandı.
 * Canlı yayın kimlikleri zamanla değişebilir; bu yüzden her kategori bir yedek zinciri olarak kullanılır.
 */
export const YT_PRESETS = [
  { id: 'lofi-girl', group: 'Lo-fi', label: 'Lofi Girl — lofi hip hop radio (canlı)', url: 'https://www.youtube.com/watch?v=rFZHOHl-L8A', live: true },
  { id: 'cozy-lofi', group: 'Lo-fi', label: 'Cozy Lofi Room Radio (canlı)', url: 'https://www.youtube.com/watch?v=7oHxpusmRfU', live: true },
  { id: 'lofi-1h', group: 'Lo-fi', label: '1 Hour of Lofi Hip Hop (liste)', url: 'https://www.youtube.com/playlist?list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ' },
  { id: 'lofi-coffee', group: 'Lo-fi', label: 'Lofi / Coffee shop vibes (liste)', url: 'https://www.youtube.com/playlist?list=PLPxJzx2gifedq2TOIDOq_P7MmA1gbUWPI' },
  { id: 'jazz-lofi', group: 'Caz', label: 'Lofi Girl — jazz lofi radio (canlı)', url: 'https://www.youtube.com/watch?v=E2vONfzoyRI', live: true },
  { id: 'relax-jazz', group: 'Caz', label: 'Lofi Girl — relaxing jazz music (canlı)', url: 'https://www.youtube.com/watch?v=A8jDx9TLMQc', live: true },
  { id: 'coffee-jazz', group: 'Caz', label: 'Coffee Jazz — Lounge Jazz Radio (canlı)', url: 'https://www.youtube.com/watch?v=fEvM-OUbaKs', live: true },
  { id: 'work-jazz', group: 'Caz', label: 'WORK JAZZ (liste)', url: 'https://www.youtube.com/playlist?list=PLYyJCobshLZnDDpfbVMQJuKfBgv7DyC-R' },
  { id: 'synth-rain', group: 'Synthwave', label: 'Synthwave Radio — Rainy Nights (canlı)', url: 'https://www.youtube.com/watch?v=GeGrAbquBH8', live: true },
  { id: 'synth-1015', group: 'Synthwave', label: '101.5 Synthwave Radio (canlı)', url: 'https://www.youtube.com/watch?v=WPXlsahEUNU', live: true },
  { id: 'spacesynth', group: 'Synthwave', label: 'Nightride FM — Spacesynth (canlı)', url: 'https://www.youtube.com/watch?v=wpKPp8hwEbE', live: true },
  { id: 'deep-gentleman', group: 'Deep House', label: 'Gentleman Radio — Deep House (canlı)', url: 'https://www.youtube.com/watch?v=nBQaYt1FjZs', live: true },
  { id: 'deep-grand', group: 'Deep House', label: 'The Grand Sound — Deep House (canlı)', url: 'https://www.youtube.com/watch?v=Ihm9OQWmibA', live: true },
  { id: 'good-life', group: 'Deep House', label: 'The Good Life Radio (canlı)', url: 'https://www.youtube.com/watch?v=QjalS1AMSkU', live: true },
  { id: 'deep-list', group: 'Deep House', label: 'Best Deep House (liste)', url: 'https://www.youtube.com/playlist?list=PL6IsV4LCPZE-ZNJijNTTZ3YUXqyy9DpBR' },
];

/** Bir müzik havasına uygun hazır grup. */
export const MOOD_TO_GROUP = { chill: 'Lo-fi', night: 'Lo-fi', dreamy: 'Lo-fi', groovy: 'Caz', upbeat: 'Deep House', tense: 'Synthwave' };

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const LIST_RE = /^[A-Za-z0-9_-]{10,64}$/;
const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * YouTube bağlantısını çözümler.
 * Dönüş: { videoId, listId, channelId, handle, music } ya da null.
 */
export function parseYouTubeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (ID_RE.test(raw)) return { videoId: raw, listId: null, channelId: null, handle: null, music: false };
  if (/^(PL|OL|RD|UU|FL|LL)[A-Za-z0-9_-]{8,}$/.test(raw)) return { videoId: null, listId: raw, channelId: null, handle: null, music: false };
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { return null; }
  const host = u.hostname.replace(/^(www|m)\./, '');
  if (!/^(youtube\.com|music\.youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host)) return null;
  const out = { videoId: null, listId: null, channelId: null, handle: null, music: host === 'music.youtube.com' };
  const list = u.searchParams.get('list');
  if (list && LIST_RE.test(list)) out.listId = list;
  const v = u.searchParams.get('v');
  if (v && ID_RE.test(v)) out.videoId = v;
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be' && parts[0] && ID_RE.test(parts[0])) out.videoId = parts[0];
  if (['embed', 'live', 'shorts', 'v'].includes(parts[0]) && parts[1] && ID_RE.test(parts[1])) out.videoId = parts[1];
  if (parts[0] === 'embed' && parts[1] === 'live_stream') {
    const ch = u.searchParams.get('channel');
    if (ch && CHANNEL_RE.test(ch)) out.channelId = ch;
  }
  if (parts[0] === 'channel' && CHANNEL_RE.test(parts[1] || '')) out.channelId = parts[1];
  if (parts[0] && parts[0].startsWith('@')) out.handle = parts[0];
  if (!out.videoId && !out.listId && !out.channelId && !out.handle) return null;
  return out;
}

/** Gömülü oynatıcı adresi. Kanal "handle"ı (@ad) gömülemez → null (sekme moduna geçilir). */
export function embedUrl(parsed, { origin = '', shuffle = false } = {}) {
  if (!parsed) return null;
  const params = new URLSearchParams({ enablejsapi: '1', autoplay: '1', playsinline: '1', rel: '0', controls: '1', iv_load_policy: '3' });
  if (origin) params.set('origin', origin);
  let path;
  if (parsed.videoId) {
    path = parsed.videoId;
    if (parsed.listId) params.set('list', parsed.listId);
  } else if (parsed.listId) {
    path = 'videoseries';
    params.set('list', parsed.listId);
  } else if (parsed.channelId) {
    path = 'live_stream';
    params.set('channel', parsed.channelId);
  } else return null;
  if (shuffle) params.set('shuffle', '1');
  return `https://www.youtube.com/embed/${path}?${params.toString()}`;
}

/** Sekme modu için normal izleme adresi. */
export function watchUrl(parsed) {
  if (!parsed) return null;
  const base = parsed.music ? 'https://music.youtube.com' : 'https://www.youtube.com';
  if (parsed.videoId) return `${base}/watch?v=${parsed.videoId}${parsed.listId ? '&list=' + parsed.listId : ''}`;
  if (parsed.listId) return `${base}/playlist?list=${parsed.listId}`;
  if (parsed.channelId) return `https://www.youtube.com/channel/${parsed.channelId}/live`;
  if (parsed.handle) return `https://www.youtube.com/${parsed.handle}/live`;
  return null;
}

/** Gömme hatası kodları: 100 bulunamadı, 101/150 gömme kapalı, 152/153 yapılandırma/referer. */
export function ytErrorText(code) {
  const c = Number(code);
  if (c === 2) return 'Geçersiz video kimliği';
  if (c === 5) return 'Oynatıcı hatası (HTML5)';
  if (c === 100) return 'Video bulunamadı veya kaldırılmış';
  if (c === 101 || c === 150) return 'Sahibi gömülü oynatmaya izin vermiyor';
  if (c === 152 || c === 153) return 'Oynatıcı yapılandırma hatası';
  return `YouTube hatası ${code}`;
}

export function isUnembeddable(code) { return [101, 150, 152, 153].includes(Number(code)); }
