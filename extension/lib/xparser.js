// X (Twitter) web uygulamasının JSON yanıtlarından tweet çıkarma.
// X'in iç veri yapısı sık değiştiği için katı bir yol yerine ağacı dolaşıp "tweet'e benzeyen"
// nesneleri bulan dayanıklı bir yaklaşım kullanılır. Reklamlar (promoted) atlanır.

import { decodeEntities } from './textutil.js';

const TWITTER_EPOCH = 1288834974657n;

/** Snowflake kimliğinden oluşturulma zamanı (ms). */
export function snowflakeTime(id) {
  try {
    if (!/^\d{15,22}$/.test(String(id))) return null;
    return Number((BigInt(id) >> 22n) + TWITTER_EPOCH);
  } catch { return null; }
}

function num(v) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

function pickUser(u) {
  if (!u || typeof u !== 'object') return null;
  if (u.__typename === 'UserUnavailable') return null;
  const legacy = u.legacy || {};
  const core = u.core || {};
  const name = core.name ?? legacy.name ?? u.name;
  const handle = core.screen_name ?? legacy.screen_name ?? u.screen_name ?? u.username;
  if (!handle && !name) return null;
  return {
    name: name || handle,
    handle: handle || '',
    verified: !!(u.is_blue_verified || legacy.verified || u.verification?.verified || u.verified),
    followers: num(legacy.followers_count ?? u.relationship_counts?.followers ?? u.followers_count),
  };
}

function unwrapTweet(t) {
  let guard = 0;
  while (t && guard++ < 4) {
    if (t.__typename === 'TweetWithVisibilityResults' && t.tweet) { t = t.tweet; continue; }
    if (t.result && !t.legacy && !t.rest_id) { t = t.result; continue; }
    break;
  }
  if (!t || t.__typename === 'TweetTombstone' || t.__typename === 'TweetUnavailable') return null;
  return t;
}

function looksLikeTweet(o) {
  if (!o || typeof o !== 'object') return false;
  if (o.__typename === 'Tweet' || o.__typename === 'TweetWithVisibilityResults') return true;
  const legacy = o.legacy;
  return !!(o.rest_id && legacy && (typeof legacy.full_text === 'string' || typeof legacy.text === 'string'));
}

function tweetText(t) {
  const legacy = t.legacy || {};
  const note = t.note_tweet?.note_tweet_results?.result;
  let text = note?.text ?? legacy.full_text ?? legacy.text ?? t.text ?? '';
  // Yanıtlardaki baştaki @kullanıcı listesini at (display_text_range)
  if (!note && Array.isArray(legacy.display_text_range) && legacy.display_text_range[0] > 0) {
    const chars = Array.from(text);
    text = chars.slice(legacy.display_text_range[0]).join('');
  }
  // t.co bağlantılarını genişlet ya da kaldır
  const urls = (note?.entity_set?.urls || legacy.entities?.urls || []);
  for (const u of urls) {
    if (u.url) text = text.split(u.url).join(u.display_url ? ` ${u.display_url} ` : ' ');
  }
  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  for (const m of media) if (m.url) text = text.split(m.url).join(' ');
  text = decodeEntities(text).replace(/https?:\/\/t\.co\/\w+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return text;
}

function mediaOf(t) {
  const legacy = t.legacy || {};
  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  return media.map((m) => ({
    type: m.type === 'animated_gif' ? 'gif' : (m.type || 'photo'),
    alt: m.ext_alt_text || '',
  }));
}

function linksOf(t) {
  const legacy = t.legacy || {};
  const note = t.note_tweet?.note_tweet_results?.result;
  const urls = note?.entity_set?.urls || legacy.entities?.urls || [];
  return urls.filter((u) => u.expanded_url).map((u) => ({ display: u.display_url || '', url: u.expanded_url }));
}

/** Tek bir ham tweet nesnesini XRadio tweet biçimine çevirir. */
export function normalizeTweet(raw, { now = Date.now(), depth = 0 } = {}) {
  const t = unwrapTweet(raw);
  if (!t) return null;
  const legacy = t.legacy || {};
  const id = String(t.rest_id || legacy.id_str || t.id_str || t.id || '');
  if (!/^\d{5,22}$/.test(id)) return null;
  const author = pickUser(t.core?.user_results?.result || t.core?.user_result?.result || t.author || t.user);

  // Retweet: asıl tweet'i döndür, retweet edeni not al.
  const rtRaw = legacy.retweeted_status_result?.result || t.retweeted_status_result?.result;
  if (rtRaw && depth < 2) {
    const orig = normalizeTweet(rtRaw, { now, depth: depth + 1 });
    if (orig) {
      if (author) orig.retweetedBy = [{ name: author.name, handle: author.handle }];
      orig.seenVia = 'retweet';
      return orig;
    }
  }

  const created = Date.parse(legacy.created_at || t.created_at || '') || snowflakeTime(id) || now;
  const text = tweetText(t);
  let quoted = null;
  const qRaw = t.quoted_status_result?.result;
  if (qRaw && depth < 2) {
    const q = normalizeTweet(qRaw, { now, depth: depth + 1 });
    if (q) quoted = { id: q.id, author: q.author, text: q.text.slice(0, 400) };
  }
  const handle = author?.handle || 'i';
  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    text,
    lang: legacy.lang || t.lang || '',
    createdAt: created,
    author: author || { name: 'Bilinmeyen', handle: '', verified: false, followers: 0 },
    metrics: {
      likes: num(legacy.favorite_count),
      retweets: num(legacy.retweet_count),
      replies: num(legacy.reply_count),
      quotes: num(legacy.quote_count),
      bookmarks: num(legacy.bookmark_count),
      views: num(t.views?.count ?? t.view_count),
    },
    isReply: !!legacy.in_reply_to_status_id_str,
    replyTo: legacy.in_reply_to_screen_name || null,
    quoted,
    media: mediaOf(t),
    links: linksOf(t),
    retweetedBy: [],
    source: 'json',
    seenAt: now,
  };
}

/**
 * Herhangi bir X JSON yanıtından tweet listesi çıkarır.
 * Reklam (promoted) girdileri atlanır, kimliğe göre tekilleştirilir.
 */
export function extractTweets(json, { now = Date.now() } = {}) {
  const out = new Map();
  const seen = new WeakSet();

  function visit(node, promoted) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const x of node) visit(x, promoted); return; }

    let isPromoted = promoted;
    if (typeof node.entryId === 'string' && /^promoted|-promoted-|promotedTweet/i.test(node.entryId)) isPromoted = true;
    if (node.promotedMetadata || node.promoted_metadata) isPromoted = true;

    if (looksLikeTweet(node)) {
      if (!isPromoted) {
        const tw = normalizeTweet(node, { now });
        if (tw && tw.text) {
          const prev = out.get(tw.id);
          if (prev) mergeTweet(prev, tw); else out.set(tw.id, tw);
        }
      }
      return; // alıntı/retweet içleri normalizeTweet tarafından işlenir
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') visit(v, isPromoted);
    }
  }

  visit(json, false);
  return [...out.values()];
}

/** Aynı tweet'in iki görünümünü birleştirir (metrikler en güncel/büyük olan). */
export function mergeTweet(into, from) {
  for (const k of Object.keys(from.metrics || {})) {
    into.metrics[k] = Math.max(into.metrics[k] || 0, from.metrics[k] || 0);
  }
  const rts = new Map((into.retweetedBy || []).map((r) => [r.handle, r]));
  for (const r of from.retweetedBy || []) if (!rts.has(r.handle)) rts.set(r.handle, r);
  into.retweetedBy = [...rts.values()];
  if ((from.text || '').length > (into.text || '').length && from.source === 'json') into.text = from.text;
  if (!into.quoted && from.quoted) into.quoted = from.quoted;
  if (into.author?.name === 'Bilinmeyen' && from.author?.handle) into.author = from.author;
  into.seenAt = Math.max(into.seenAt || 0, from.seenAt || 0);
  into.lastSeenAt = Math.max(into.lastSeenAt || 0, from.seenAt || 0);
  return into;
}

/** DOM'dan gelen (içerik betiğinin çıkardığı) tweet'i doğrular. */
export function sanitizeDomTweet(t, now = Date.now()) {
  if (!t || !/^\d{5,22}$/.test(String(t.id || ''))) return null;
  const text = decodeEntities(String(t.text || '')).trim();
  if (!text && !(t.quoted && t.quoted.text)) return null;
  const handle = String(t.author?.handle || '').replace(/^@/, '');
  return {
    id: String(t.id),
    url: t.url || `https://x.com/${handle || 'i'}/status/${t.id}`,
    text: text.slice(0, 4000),
    lang: t.lang || '',
    createdAt: Number(t.createdAt) || snowflakeTime(t.id) || now,
    author: { name: String(t.author?.name || handle || 'Bilinmeyen').slice(0, 80), handle, verified: !!t.author?.verified, followers: 0 },
    metrics: {
      likes: num(t.metrics?.likes), retweets: num(t.metrics?.retweets), replies: num(t.metrics?.replies),
      quotes: 0, bookmarks: num(t.metrics?.bookmarks), views: num(t.metrics?.views),
    },
    isReply: !!t.isReply,
    replyTo: t.replyTo || null,
    quoted: t.quoted && t.quoted.text ? { id: t.quoted.id || '', author: t.quoted.author || null, text: String(t.quoted.text).slice(0, 400) } : null,
    media: Array.isArray(t.media) ? t.media.slice(0, 4) : [],
    links: [],
    retweetedBy: Array.isArray(t.retweetedBy) ? t.retweetedBy.slice(0, 5) : [],
    source: 'dom',
    seenAt: now,
  };
}
