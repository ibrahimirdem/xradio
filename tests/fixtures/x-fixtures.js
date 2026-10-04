// X web uygulamasının zaman tüneli yanıtına benzeyen test verisi.
// Hem eski (legacy.screen_name) hem yeni (core.screen_name) kullanıcı yapısını, retweet, alıntı,
// uzun (note) tweet, görünürlük sarmalayıcısı ve reklam girdisini içerir.

export const NOW = Date.parse('2026-10-04T12:00:00Z');

function snow(msAgo, salt = 1) {
  const t = BigInt(NOW - msAgo);
  return (((t - 1288834974657n) << 22n) + BigInt(salt)).toString();
}

const userOld = (name, screen_name, followers = 1000) => ({ result: { __typename: 'User', rest_id: '1' + screen_name.length, is_blue_verified: true, legacy: { name, screen_name, followers_count: followers } } });
const userNew = (name, screen_name) => ({ result: { __typename: 'User', rest_id: '2' + screen_name.length, core: { name, screen_name }, legacy: {}, relationship_counts: { followers: 52000 } } });

let createdAtRef = null;
function tweet(id, user, full_text, extra = {}) {
  return {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: user },
    views: { count: extra.views || '15000', state: 'EnabledWithCount' },
    legacy: {
      id_str: id,
      full_text,
      created_at: extra.created_at || createdAtRef || 'Sun Oct 04 11:40:00 +0000 2026',
      favorite_count: extra.likes ?? 250,
      retweet_count: extra.rts ?? 40,
      reply_count: 12,
      quote_count: 3,
      bookmark_count: 5,
      lang: 'tr',
      display_text_range: extra.range || [0, full_text.length],
      entities: { urls: extra.urls || [], media: extra.media || [] },
      extended_entities: extra.media ? { media: extra.media } : undefined,
      retweeted_status_result: extra.rt,
      in_reply_to_status_id_str: extra.replyTo ? '123' : undefined,
      in_reply_to_screen_name: extra.replyTo,
    },
    ...(extra.note ? { note_tweet: { note_tweet_results: { result: { text: extra.note, entity_set: { urls: [] } } } } } : {}),
    ...(extra.quoted ? { quoted_status_result: { result: extra.quoted } } : {}),
  };
}

export const IDS = {
  normal: snow(20 * 60e3, 1),
  newUser: snow(15 * 60e3, 2),
  rtOuter: snow(10 * 60e3, 3),
  rtInner: snow(60 * 60e3, 4),
  quote: snow(8 * 60e3, 5),
  quoted: snow(90 * 60e3, 6),
  note: snow(5 * 60e3, 7),
  vis: snow(4 * 60e3, 8),
  promo: snow(3 * 60e3, 9),
  module1: snow(2 * 60e3, 10),
};

export function timelineFixture(now = null) {
  createdAtRef = now ? new Date(now - 20 * 60e3).toUTCString() : null;
  const entries = [
    {
      entryId: 'tweet-' + IDS.normal,
      content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: tweet(IDS.normal, userOld('Ekonomi Masası', 'ekonomimasasi'), 'Merkez Bankası faizi yüzde 30\'a indirdi &amp; piyasalar sert tepki verdi https://t.co/abc123', { urls: [{ url: 'https://t.co/abc123', display_url: 'tcmb.gov.tr/karar', expanded_url: 'https://tcmb.gov.tr/karar' }], likes: 4200, rts: 1300 }) } } },
    },
    {
      entryId: 'tweet-' + IDS.newUser,
      content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: tweet(IDS.newUser, userNew('Teknoloji Günlüğü', 'teknogunluk'), 'Yeni elektrikli otomobil 620 km menzille geliyor', { media: [{ type: 'photo', url: 'https://t.co/pic1', ext_alt_text: 'Kırmızı araba' }] }) } } },
    },
    {
      entryId: 'tweet-' + IDS.rtOuter,
      content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: tweet(IDS.rtOuter, userOld('Ayşe', 'ayse'), 'RT @spor: Milli takım kadrosu açıklandı', { rt: { result: tweet(IDS.rtInner, userOld('Tribün Muhabiri', 'tribun'), 'Milli takım kadrosu açıklandı: 26 isim, 4 yeni yüz.', { likes: 5100 }) } }) } } },
    },
    {
      entryId: 'tweet-' + IDS.quote,
      content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: tweet(IDS.quote, userOld('Selin', 'selinkod'), 'Bu çok iyi bir gelişme', { quoted: tweet(IDS.quoted, userOld('Bilim Kapsülü', 'bilimkapsulu'), 'Gezegen atmosferinde su buharı bulundu.') }) } } },
    },
    {
      entryId: 'tweet-' + IDS.note,
      content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: tweet(IDS.note, userOld('Uzun Yazar', 'uzunyazar'), 'Kısaltılmış metin…', { note: 'Bu çok uzun bir yazının tam metni. '.repeat(20) }) } } },
    },
    {
      entryId: 'tweet-' + IDS.vis,
      content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: { __typename: 'TweetWithVisibilityResults', tweet: tweet(IDS.vis, userOld('Kısıtlı', 'kisitli'), '@biri @digeri Yanıt metni burada', { range: [13, 31], replyTo: 'biri' }) } } } },
    },
    {
      entryId: 'promoted-tweet-' + IDS.promo,
      content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', promotedMetadata: { advertiser_results: {} }, tweet_results: { result: tweet(IDS.promo, userOld('Reklamcı', 'reklam'), 'Hemen indir, %50 indirim!') } } },
    },
    {
      entryId: 'home-conversation-1',
      content: { entryType: 'TimelineTimelineModule', items: [
        { entryId: 'home-conversation-1-tweet-' + IDS.module1, item: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: tweet(IDS.module1, userOld('Şehir Gündemi', 'sehirgundemi'), 'Metro hattında yarın planlı bakım var.') } } } },
        { entryId: 'tombstone', item: { itemContent: { tweet_results: { result: { __typename: 'TweetTombstone' } } } } },
      ] },
    },
    { entryId: 'cursor-top-1', content: { entryType: 'TimelineTimelineCursor', value: 'abc', cursorType: 'Top' } },
  ];
  return { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } };
}
