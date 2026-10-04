// Haber Masası: tweet'leri hikâyelere (olaylara) kümeler, önem puanlar, neyin anlatıldığını hatırlar.
// Amaç: aynı haberi tekrar tekrar anlatmamak, sadece gerçekten yeni gelişmeleri yayına almak.

import { BREAKING_KEYWORDS, URGENCY_KEYWORDS, EVENT_KEYWORDS, GRAVE_KEYWORDS } from './config.js';
import { foldTr, storySimilarity, nearDuplicateScore, charShingles, jaccard, truncate, slugify, cleanTweetText } from './textutil.js';

const shingleCache = new WeakMap();
function shinglesOf(t) {
  let s = shingleCache.get(t);
  if (!s) { s = charShingles(t.text); shingleCache.set(t, s); }
  return s;
}

const HOUR = 3600e3;
const MIN = 60e3;

export const DESK_LIMITS = {
  tweetTtl: 30 * HOUR,          // ham tweet hafızası
  storyTtl: 36 * HOUR,          // hikâye hafızası (tekrar önleme için uzun)
  pendingMaxAge: 10 * HOUR,     // bundan eski, hiç anlatılmamış hikâye artık "haber" değildir
  updateCooldown: 25 * MIN,     // aynı hikâyenin gelişmesini en erken bu kadar sonra anlat
  similarity: 0.42,             // aynı hikâye sayılması için konu benzerliği eşiği
  duplicate: 0.72,              // neredeyse kopya tweet eşiği
};

const FOLDED_BREAKING = BREAKING_KEYWORDS.map(foldTr);
const FOLDED_URGENCY = URGENCY_KEYWORDS.map(foldTr);
const FOLDED_EVENTS = EVENT_KEYWORDS.map(foldTr);
const FOLDED_GRAVE = GRAVE_KEYWORDS.map(foldTr);

/** Son dakika sayılabilecek en uzak paylaşım yaşı. */
export const BREAKING_MAX_AGE = 45 * MIN;

export function hasBreakingKeyword(text) {
  const t = ' ' + foldTr(text) + ' ';
  return FOLDED_BREAKING.some((k) => t.includes(k));
}

export function hasUrgencyWord(text) {
  const t = ' ' + foldTr(text) + ' ';
  return FOLDED_URGENCY.some((k) => t.includes(k));
}

/** Gerçek bir olay sözcüğü (deprem, patlama…) var mı? "SON DAKİKA" etiketi tek başına yetmez. */
/** Afet, şiddet, can kaybı gibi ciddi ton gerektiren bir olay mı? (Faiz kararı olaydır ama ciddi değildir.) */
export function hasGraveWord(text) {
  const t = ' ' + foldTr(text) + ' ';
  return FOLDED_GRAVE.some((k) => t.includes(k));
}

export function hasEventWord(text) {
  const t = ' ' + foldTr(text) + ' ';
  return FOLDED_EVENTS.some((k) => t.includes(k));
}

/** Paylaşım dili yayın dilinden farklıysa (X'in verdiği dil kodu; 'iw' = İbranice) true. */
export function isForeign(tweet, lang = 'tr') {
  const l = String(tweet?.lang || '').toLowerCase();
  return !!l && l !== lang && !['und', 'zxx', 'qme', 'qht', 'qam', 'qst', 'art'].includes(l);
}

/** Basit (yapay zekâsız) önem puanı 0..10. */
export function localImportance(tweet, { now = Date.now(), settings = {}, spread = 1 } = {}) {
  const text = tweet.text || '';
  const folded = foldTr(text);
  let s = 3;
  const event = hasEventWord(text);
  const urgent = event || hasUrgencyWord(text);
  if (event) s += 2.5;
  else if (urgent) s += 0.8; // "SON DAKİKA" tek başına küçük bir artı
  const m = tweet.metrics || {};
  const ageMin = Math.max(3, (now - (tweet.createdAt || now)) / MIN);
  const eng = (m.likes || 0) + 2 * (m.retweets || 0) + 1.5 * (m.quotes || 0) + 0.5 * (m.replies || 0);
  const velocity = eng / ageMin;
  s += Math.min(2.5, Math.log10(1 + velocity) * 1.2);
  if ((m.views || 0) > 250000) s += 0.6;
  s += Math.min(1.8, (spread - 1) * 0.6);
  s += Math.min(1, (tweet.retweetedBy?.length || 0) * 0.35);
  const handle = foldTr(tweet.author?.handle || '');
  if ((settings.priorityAccounts || []).some((a) => foldTr(a).replace(/^@/, '') === handle)) s += 2;
  if ((settings.priorityWords || []).some((w) => w && folded.includes(foldTr(w)))) s += 1.5;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 5 && !urgent && !tweet.quoted && !tweet.media?.length) s -= 1.5;
  if (tweet.isReply) s -= 1;
  if (/^(gm|gn|günaydın|gunaydin|iyi geceler|good morning)\b/i.test(text.trim())) s -= 2.5;
  if (/(çekiliş|cekilis|giveaway|indirim kodu|promo|sponsor|reklam|#ad\b)/i.test(text)) s -= 2.5;
  return Math.max(0, Math.min(10, Math.round(s * 10) / 10));
}

export function isMuted(tweet, settings = {}) {
  const words = settings.muteWords || [];
  if (!words.length) return false;
  const t = foldTr(`${tweet.text} ${tweet.quoted?.text || ''} ${tweet.author?.handle || ''}`);
  return words.some((w) => w && t.includes(foldTr(w).replace(/^@/, '')));
}

let idCounter = 0;
function newStoryId(now) {
  idCounter = (idCounter + 1) % 1e6;
  return 's' + now.toString(36) + idCounter.toString(36);
}

export class NewsDesk {
  constructor({ settings = {}, now = () => Date.now() } = {}) {
    this.settings = settings;
    this.now = now;
    this.tweets = new Map();      // id -> tweet (+ storyId, importance, dupOf)
    this.stories = new Map();     // id -> story
    this.untriaged = new Set();   // yapay zekâ ile henüz sınıflandırılmamış tweet id'leri
  }

  setSettings(settings) { this.settings = settings || {}; }

  // ---------- Kalıcılık ----------
  toJSON() {
    return {
      v: 1,
      tweets: [...this.tweets.values()],
      stories: [...this.stories.values()],
      untriaged: [...this.untriaged],
    };
  }

  static fromJSON(data, opts) {
    const d = new NewsDesk(opts);
    if (data && data.v === 1) {
      for (const t of data.tweets || []) d.tweets.set(t.id, t);
      for (const s of data.stories || []) d.stories.set(s.id, s);
      for (const id of data.untriaged || []) if (d.tweets.has(id)) d.untriaged.add(id);
    }
    d.prune();
    return d;
  }

  // ---------- Alım ----------
  /**
   * Yeni tweet'leri alır. Dönen değer: { fresh: yeni tweet listesi, updated: metrikleri güncellenenler }
   * Retweet'ler asıl tweet kimliğiyle gelir; aynı tweet'i farklı kişilerin RT'lemesi "yayılma" sayılır.
   */
  ingest(list) {
    const now = this.now();
    const fresh = [];
    let updated = 0;
    for (const t of list || []) {
      if (!t || !t.id) continue;
      const prev = this.tweets.get(t.id);
      if (prev) {
        for (const k of Object.keys(t.metrics || {})) prev.metrics[k] = Math.max(prev.metrics[k] || 0, t.metrics[k] || 0);
        const handles = new Set((prev.retweetedBy || []).map((r) => r.handle));
        for (const r of t.retweetedBy || []) if (!handles.has(r.handle)) { prev.retweetedBy.push(r); handles.add(r.handle); }
        prev.lastSeenAt = now;
        updated++;
        continue;
      }
      if (now - (t.createdAt || now) > DESK_LIMITS.tweetTtl) continue;   // çok eski
      const tw = { ...t, metrics: { ...(t.metrics || {}) }, retweetedBy: [...(t.retweetedBy || [])], seenAt: t.seenAt || now };
      tw.muted = isMuted(tw, this.settings);
      // Neredeyse kopya (aynı metni başka hesap da atmış) → ayrı haber değil
      const mine = shinglesOf(tw);
      for (const other of this.recentTweets(3 * HOUR)) {
        if (other.id !== tw.id && jaccard(shinglesOf(other), mine) >= DESK_LIMITS.duplicate) {
          tw.dupOf = other.dupOf || other.id;
          break;
        }
      }
      this.tweets.set(tw.id, tw);
      if (!tw.muted) {
        fresh.push(tw);
        this.untriaged.add(tw.id);
      }
    }
    return { fresh, updated };
  }

  recentTweets(windowMs) {
    const now = this.now();
    const out = [];
    for (const t of this.tweets.values()) if (now - (t.seenAt || 0) <= windowMs) out.push(t);
    return out;
  }

  // ---------- Hikâye atama ----------
  /** Yapay zekâ olmadan: benzerliğe göre kümeleme + yerel önem puanı. */
  triageLocal(ids = [...this.untriaged]) {
    const now = this.now();
    const results = [];
    for (const id of ids) {
      const t = this.tweets.get(id);
      if (!t) { this.untriaged.delete(id); continue; }
      let story = t.dupOf ? this.storyOfTweet(t.dupOf) : null;
      if (!story) story = this.findSimilarStory(t);
      const fullText = `${t.text} ${t.quoted?.text || ''}`;
      const spread = story ? new Set([...story.authors, t.author?.handle]).size : 1;
      // Yapay zekâsız modda çeviri yapılamaz: Türkçe olmayan paylaşımların önemi düşürülür
      const foreign = isForeign(t, this.settings.language || 'tr');
      const importance = Math.max(0, localImportance(t, { now, settings: this.settings, spread }) - (foreign ? 2 : 0));
      const fresh = now - (t.createdAt || now) < 30 * MIN;
      // Yerel son dakika: taze + gerçek olay sözcüğü (deprem, patlama…) + yüksek önem. "SON DAKİKA" etiketi yetmez.
      const breaking = fresh && !foreign && hasEventWord(fullText) && importance >= (this.settings.breakingThreshold ?? 8);
      const item = {
        tweet_id: id,
        story_id: story ? story.id : 'yeni:' + slugify(t.text).slice(0, 24) + '-' + id.slice(-4),
        headline: story ? story.headline : headlineFrom(t),
        summary: truncate(cleanTweetText(t.text, 300), 220),
        category: guessCategory(fullText),
        importance,
        breaking,
        new_development: !!story && story.coveredAt != null && nearDuplicateScore(story.lastText || '', t.text) < 0.5 && importance >= (story.coveredImportance || 0),
        tone: hasGraveWord(fullText) ? 'serious' : 'neutral',
        skip: importance < 2,
        foreign,
      };
      results.push(item);
      this.applyTriageItem(item, 'local');
    }
    this.capBreaking();
    return results;
  }

  /** Yapay zekâ triyaj sonuçlarını uygular. */
  applyTriage(items, source = 'ai') {
    const created = new Map(); // "yeni:slug" -> gerçek id
    for (const it of items || []) this.applyTriageItem(it, source, created);
    this.capBreaking();
  }

  /**
   * Aynı anda birden çok "son dakika" olmasın: henüz anlatılmamış son dakika hikâyelerinden yalnızca en önemlisi
   * kalır, diğerleri önemli ama normal habere döner (sıradaki gündem arasında anlatılır).
   */
  capBreaking() {
    const list = [...this.stories.values()].filter((s) => s.breaking && !s.muted)
      .sort((a, b) => (b.importance || 0) - (a.importance || 0) || b.lastUpdate - a.lastUpdate);
    for (const s of list.slice(1)) s.breaking = false;
  }

  applyTriageItem(it, source, created = new Map()) {
    const now = this.now();
    const t = this.tweets.get(String(it.tweet_id));
    if (!t) return null;
    this.untriaged.delete(t.id);
    const imp = clamp(Number(it.importance), 0, 10);
    t.importance = Number.isFinite(imp) ? imp : localImportance(t, { now, settings: this.settings });
    t.triage = source;
    if (it.skip || t.muted) { t.skipped = true; return null; }

    let story = null;
    const sid = String(it.story_id || '');
    if (this.stories.has(sid)) story = this.stories.get(sid);
    else if (created.has(sid)) story = this.stories.get(created.get(sid));
    else if (t.dupOf && this.storyOfTweet(t.dupOf)) story = this.storyOfTweet(t.dupOf);
    else {
      // Yapay zekâ yeni dedi ama yerelde çok benzer bir hikâye varsa birleştir (tekrar önleme kemeri).
      story = this.findSimilarStory(t, 0.55);
    }
    if (!story) {
      story = {
        id: newStoryId(now),
        headline: truncate(it.headline || headlineFrom(t), 90),
        summary: truncate(it.summary || cleanTweetText(t.text, 260), 300),
        category: it.category || guessCategory(t.text),
        tone: it.tone || 'neutral',
        importance: t.importance,
        breaking: false,
        tweetIds: [],
        authors: [],
        firstSeen: now,
        lastUpdate: now,
        coveredAt: null,
        coveredImportance: null,
        coverCount: 0,
        newSinceCover: [],
        development: false,
        lastText: '',
        muted: false,
      };
      this.stories.set(story.id, story);
      if (sid) created.set(sid, story.id);
    }
    if (!story.tweetIds.includes(t.id)) story.tweetIds.push(t.id);
    const handle = t.author?.handle || t.author?.name || '?';
    if (!story.authors.includes(handle)) story.authors.push(handle);
    t.storyId = story.id;
    story.lastUpdate = now;
    story.lastText = t.text;
    if (it.headline && story.coveredAt == null && t.importance >= story.importance) story.headline = truncate(it.headline, 90);
    if (it.summary && (story.coveredAt == null || it.new_development)) story.summary = truncate(it.summary, 300);
    if (it.tone === 'serious') story.tone = 'serious';
    // Yayılma: farklı hesaplar aynı olayı konuşuyorsa önem artar
    const spreadBonus = Math.min(1.5, (story.authors.length - 1) * 0.4);
    story.importance = Math.min(10, Math.max(story.importance || 0, t.importance) + (source === 'local' ? 0 : spreadBonus * 0.5));
    // Son dakika yalnızca taze paylaşımlar için: geç gelen (birikmiş) paylaşımlar normal haber olarak anlatılır
    const freshEnough = now - (t.createdAt || now) <= BREAKING_MAX_AGE;
    if (it.breaking && freshEnough && t.importance >= (this.settings.breakingThreshold ?? 8)) story.breaking = true;
    if (it.foreign || isForeign(t, this.settings.language || 'tr')) story.foreign = true;
    if (story.coveredAt != null) {
      if (it.new_development) {
        story.newSinceCover.push(t.id);
        story.development = true;
      }
    }
    return story;
  }

  storyOfTweet(tweetId) {
    const t = this.tweets.get(tweetId);
    return t && t.storyId ? this.stories.get(t.storyId) || null : null;
  }

  findSimilarStory(t, threshold = DESK_LIMITS.similarity) {
    const now = this.now();
    let best = null;
    let bestScore = threshold;
    const text = `${t.text} ${t.quoted?.text || ''}`;
    for (const s of this.stories.values()) {
      if (now - s.lastUpdate > 12 * HOUR) continue;
      const ref = `${s.headline}. ${s.summary}`;
      let score = storySimilarity(text, ref);
      for (const tid of s.tweetIds.slice(-4)) {
        const o = this.tweets.get(tid);
        if (o) score = Math.max(score, storySimilarity(text, o.text));
      }
      if (score > bestScore) { best = s; bestScore = score; }
    }
    return best;
  }

  // ---------- Seçim ----------
  /** Anlatılmaya hazır hikâyeler, öncelik sırasıyla. */
  pendingStories({ limit = 5, minImportance = this.settings.minImportance ?? 4 } = {}) {
    const now = this.now();
    const out = [];
    for (const s of this.stories.values()) {
      if (s.muted || this.isReserved(s)) continue;
      if (s.coveredAt == null) {
        if (now - s.firstSeen > DESK_LIMITS.pendingMaxAge) continue;
        if ((s.importance || 0) < minImportance && !s.breaking) continue;
        out.push(s);
      } else if (s.development && s.newSinceCover.length) {
        if (now - s.coveredAt < DESK_LIMITS.updateCooldown && !s.breaking) continue;
        out.push(s);
      }
    }
    out.sort((a, b) => this.priority(b) - this.priority(a));
    return out.slice(0, limit);
  }

  priority(s) {
    const now = this.now();
    const ageH = (now - s.lastUpdate) / HOUR;
    let p = (s.importance || 0) * 10 + Math.min(8, s.authors.length * 2) - ageH * 4;
    if (s.breaking) p += 40;
    if (s.coveredAt != null) p -= 6; // gelişmeler yeni haberlerden biraz geride
    return p;
  }

  /** Yayını kesecek son dakika hikâyeleri. */
  breakingStories() {
    const now = this.now();
    return [...this.stories.values()].filter((s) => s.breaking && !s.muted && !this.isReserved(s)
      && (s.coveredAt == null || (s.development && s.newSinceCover.length && now - s.coveredAt > 10 * MIN))
      && now - s.lastUpdate < 2 * HOUR);
  }

  /** Hazırlanmakta olan bir bölüm için hikâyeyi ayırır (iki bölüm aynı haberi anlatmasın). */
  reserve(storyIds, segId) {
    const now = this.now();
    for (const id of storyIds || []) { const s = this.stories.get(id); if (s) { s.reservedBy = segId; s.reservedAt = now; } }
  }

  release(segId) {
    for (const s of this.stories.values()) if (s.reservedBy === segId) { s.reservedBy = null; s.reservedAt = null; }
  }

  isReserved(s) {
    return !!(s.reservedBy && this.now() - (s.reservedAt || 0) < 15 * MIN);
  }

  markCovered(storyIds) {
    const now = this.now();
    for (const id of storyIds || []) {
      const s = this.stories.get(id);
      if (!s) continue;
      s.coveredAt = now;
      s.coveredImportance = s.importance;
      s.coverCount = (s.coverCount || 0) + 1;
      s.newSinceCover = [];
      s.development = false;
      s.breaking = false; // bir kez kesildi; yeni gelişme yine AI ile işaretlenir
      s.reservedBy = null; s.reservedAt = null;
    }
  }

  muteStory(id, muted = true) {
    const s = this.stories.get(id);
    if (s) s.muted = muted;
  }

  /** Bir hikâyenin yazara gidecek ayrıntılı paketi. */
  storyPacket(s, { maxTweets = 4 } = {}) {
    const isUpdate = s.coveredAt != null;
    let ids = isUpdate && s.newSinceCover.length ? s.newSinceCover : s.tweetIds;
    const tweets = ids.map((id) => this.tweets.get(id)).filter(Boolean)
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .slice(0, maxTweets);
    return {
      id: s.id,
      headline: s.headline,
      summary: s.summary,
      category: s.category,
      tone: s.tone,
      importance: Math.round(s.importance || 0),
      breaking: !!s.breaking,
      status: isUpdate ? 'gelisme' : 'yeni',
      coveredAt: s.coveredAt,
      authorsCount: s.authors.length,
      foreign: !!s.foreign,
      tweets,
    };
  }

  /** Belirli bir zamandan sonra anlatılmış hikâyeler (özetler için). */
  coveredSince(ts) {
    return [...this.stories.values()].filter((s) => s.coveredAt && s.coveredAt >= ts)
      .sort((a, b) => b.coveredAt - a.coveredAt);
  }

  /** Triyaj istemine bağlam: açık/yakın zamanlı hikâyeler. */
  storyIndex(limit = 40) {
    const now = this.now();
    return [...this.stories.values()]
      .filter((s) => now - s.lastUpdate < 12 * HOUR)
      .sort((a, b) => b.lastUpdate - a.lastUpdate)
      .slice(0, limit)
      .map((s) => ({ id: s.id, headline: s.headline, covered: s.coveredAt != null, summary: truncate(s.summary, 140) }));
  }

  /** Stüdyo panosu için özet (bekleyenler önce). */
  board(limit = 60) {
    const stories = [...this.stories.values()]
      .filter((x) => !x.muted)
      .sort((a, b) => (a.coveredAt ? 1 : 0) - (b.coveredAt ? 1 : 0) || this.priority(b) - this.priority(a))
      .slice(0, limit)
      .map((x) => ({
        id: x.id, headline: x.headline, summary: x.summary, category: x.category, tone: x.tone,
        importance: Math.round(x.importance || 0), breaking: !!x.breaking, coveredAt: x.coveredAt,
        development: !!x.development, authors: x.authors.length, lastUpdate: x.lastUpdate, reserved: !!x.reservedBy,
        tweets: x.tweetIds.slice(-4).map((id) => this.tweets.get(id)).filter(Boolean)
          .map((t) => ({ url: t.url, name: t.author?.name, handle: t.author?.handle, text: truncate(t.text, 300), createdAt: t.createdAt, likes: t.metrics?.likes || 0 })),
      }));
    return { stories, stats: this.stats() };
  }

  stats() {
    let pending = 0; let covered = 0;
    for (const s of this.stories.values()) {
      if (s.coveredAt) covered++; else if ((s.importance || 0) >= (this.settings.minImportance ?? 4)) pending++;
    }
    return { tweets: this.tweets.size, stories: this.stories.size, pending, covered, untriaged: this.untriaged.size };
  }

  prune() {
    const now = this.now();
    for (const [id, t] of this.tweets) {
      if (now - (t.seenAt || 0) > DESK_LIMITS.tweetTtl) { this.tweets.delete(id); this.untriaged.delete(id); }
    }
    for (const [id, s] of this.stories) {
      if (now - s.lastUpdate > DESK_LIMITS.storyTtl) this.stories.delete(id);
    }
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function headlineFrom(t) {
  // Kısa bir yorumla alıntılanan paylaşımlarda asıl haber alıntılanan metindedir
  const own = cleanTweetText(t.text || '', 400);
  const base = own.length < 45 && t.quoted?.text ? t.quoted.text : (own || t.quoted?.text || '');
  const txt = cleanTweetText(base, 400).replace(/\n+/g, ' ');
  const first = txt.split(/(?<=[.!?…])\s/)[0] || txt;
  return shortHeadline(first.replace(/^(son dakika|flaş|breaking)\s*[:|-]?\s*/i, ''), 90);
}

/** Uzun başlığı kelime ortasından değil, ilk n karakterdeki son yan cümle sınırından (":", ";", ",", " — ") keser. */
export function shortHeadline(s, n = 90) {
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  const cuts = [...head.matchAll(/[:;,](?=\s)|\s[—–-]\s/g)].map((m) => m.index).filter((i) => i >= 30);
  return cuts.length ? head.slice(0, cuts[cuts.length - 1]).trim() : truncate(s, n);
}

const CATEGORY_HINTS = [
  ['spor', /(maç|mac|gol|lig|transfer|galatasaray|fenerbahçe|fenerbahce|beşiktaş|besiktas|trabzonspor|milli takım|derbi|teknik direktör|şampiyon|nba|uefa|fifa|formula)/],
  ['ekonomi', /(enflasyon|faiz|dolar|euro|borsa|bist|merkez bankası|tcmb|ekonomi|zam|asgari ücret|vergi|kur |altın|bitcoin|piyasa|ihracat|büyüme)/],
  ['teknoloji', /(yapay zek|ai |openai|google|apple|iphone|android|yazılım|uygulama|teknoloji|gemini|claude|chatgpt|çip|chip|nvidia|tesla|starlink|robot|siber)/],
  ['siyaset', /(meclis|bakan|cumhurbaşkan|seçim|secim|parti|milletvekili|chp|akp|ak parti|mhp|muhalefet|kabine|anayasa)/],
  ['dunya', /(abd|rusya|ukrayna|israil|gazze|avrupa|çin|nato|bm |beyaz saray|trump|putin|iran|suriye)/],
  ['bilim', /(nasa|uzay|bilim|araştırma|keşif|kesif|gezegen|iklim|deney)/],
  ['saglik', /(sağlık|saglik|hastane|aşı|asi |virüs|virus|salgın|doktor|tedavi)/],
  ['kultur', /(film|dizi|albüm|konser|kitap|sergi|festival|oscar|netflix|müzik)/],
  ['magazin', /(ünlü|unlu|aşk|evlendi|boşandı|magazin|şarkıcı|oyuncu)/],
  ['gundem', /(deprem|yangın|sel |kaza|patlama|saldırı|gözaltı|tutuklandı|valilik|afad)/],
];

// İngilizce paylaşımlar (yerel mod İngilizce yayında da kategori bulabilsin). Bunlar önce denenir:
// Türkçe kalıplar alt dize olduğundan İngilizce metinde yanılır ("light" içindeki "lig" → spor).
const CATEGORY_HINTS_EN = [
  ['spor', /\b(match|goal|league|squad|striker|midfielder|coach|world cup|champions|olympic)/],
  ['ekonomi', /\b(inflation|interest rate|rate decision|central bank|stocks?|markets?|dollar|economy|savings rate|deposit rate|tax)\b/],
  ['teknoloji', /\b(tech|software|app|electric car|carmaker|smartphone|startup|pull request)\b/],
  ['siyaset', /\b(parliament|minister|president|election|senate|congress|opposition)\b/],
  ['bilim', /\b(astronom\w*|planet|space|science|scientists|study|research|climate)\b/],
  ['saglik', /\b(health|hospital|vaccine|virus|outbreak|doctor)\b/],
  ['kultur', /\b(cinema|movie|film|series|trailer|album|concert|book|museum|festival)\b/],
  ['gundem', /\b(earthquake|wildfire|flood|crash|explosion|attack|subway|officials)\b/],
];

export function guessCategory(text) {
  const en = String(text || '').toLowerCase();
  for (const [cat, re] of CATEGORY_HINTS_EN) if (re.test(en)) return cat;
  const t = String(text || '').toLocaleLowerCase('tr-TR');
  for (const [cat, re] of CATEGORY_HINTS) if (re.test(t)) return cat;
  return 'diger';
}
