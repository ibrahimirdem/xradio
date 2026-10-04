// DEMO akışı: X hesabı bağlanmadan radyoyu denemek için KURGUSAL örnek paylaşımlar.
// Kişiler ve haberler hayalidir; DJ'ler demo yayında olduklarını söyler.

const A = (name, handle, verified = false) => ({ name, handle: handle + '_demo', verified, followers: 0 });

const ACC = {
  eko: A('Ekonomi Masası', 'ekonomimasasi', true),
  piyasa: A('Piyasa Notları', 'piyasanotlari'),
  tekno: A('Teknoloji Günlüğü', 'teknogunluk', true),
  dev: A('Selin Yazılımcı', 'selinkod'),
  spor: A('Tribün Muhabiri', 'tribunmuhabiri', true),
  futbol: A('Futbol Analiz', 'futbolanaliz'),
  bilim: A('Bilim Kapsülü', 'bilimkapsulu', true),
  sehir: A('Şehir Gündemi', 'sehirgundemi', true),
  kultur: A('Kültür Servisi', 'kulturservisi'),
  mizah: A('Ofis Halleri', 'ofishalleri'),
  haber: A('Son Dakika Ajansı', 'sondakikaajans', true),
  rnd: A('Ayşe Ekonomist', 'ayseekonomist'),
};

// Türkçe dışındaki yayın dilleri için İngilizce örnek akış (aynı kurgu, uluslararası hesaplar)
const ACC_EN = {
  eko: A('Markets Desk', 'marketsdesk', true),
  piyasa: A('Market Notes', 'marketnotes'),
  tekno: A('Tech Daily', 'techdaily', true),
  dev: A('Sarah Codes', 'sarahcodes'),
  spor: A('Sports Wire', 'sportswire', true),
  futbol: A('Football Analytics', 'footballanalytics'),
  bilim: A('Science Capsule', 'sciencecapsule', true),
  sehir: A('City Updates', 'cityupdates', true),
  kultur: A('Culture Feed', 'culturefeed'),
  mizah: A('Office Life', 'officelife'),
  haber: A('Breaking Wire', 'breakingwire', true),
  rnd: A('Maya the Economist', 'mayaeconomist'),
};

let seq = 0;
function tw(author, text, { likes = 120, rts = 20, replies = 10, views = 9000, minutesAgo = 10, media = [], lang = 'tr' } = {}, now = Date.now()) {
  seq++;
  const created = now - minutesAgo * 60e3;
  // Gerçekçi snowflake kimliği (oluşturma zamanından)
  const id = ((BigInt(created) - 1288834974657n) << 22n) + BigInt(seq * 4099 % 4194303);
  return {
    id: id.toString(),
    url: `https://x.com/${author.handle}/status/${id}`,
    text, lang, createdAt: created, author,
    metrics: { likes, retweets: rts, replies, quotes: Math.round(rts / 4), bookmarks: Math.round(likes / 10), views },
    isReply: false, replyTo: null, quoted: null, media, links: [], retweetedBy: [], source: 'demo', seenAt: now,
  };
}

/**
 * n. demo dalgası. İlk dalga "sen yokken" olanlar, sonrakiler yayın sırasında gelen gelişmeler.
 * Türkçe yayında Türkçe, diğer tüm dillerde İngilizce örnek paylaşımlar döner.
 */
export function demoWave(n, now = Date.now(), lang = 'tr') {
  const waves = lang === 'tr' ? wavesTr(now) : wavesEn(now);
  return n < waves.length ? waves[n]() : [];
}

function wavesTr(now) {
  return [
    () => [
      tw(ACC.eko, 'Merkez Bankası faiz kararını açıkladı: politika faizi yüzde 32\'den yüzde 30\'a indirildi. Piyasa beklentisi 150 baz puanlık indirimdi. (DEMO)', { likes: 4200, rts: 1300, views: 410000, minutesAgo: 48 }, now),
      tw(ACC.piyasa, 'Faiz kararı sonrası dolar/TL ilk tepkide yüzde 0,6 geriledi, Borsa İstanbul bankacılık endeksi yüzde 3 yükselişte. (DEMO)', { likes: 900, rts: 260, views: 88000, minutesAgo: 41 }, now),
      tw(ACC.rnd, 'Beklentiden sert gelen 200 baz puanlık indirim, enflasyondaki düşüşe güvenin işareti. Ama kira ve gıdada katılık sürüyor, dikkat. (DEMO)', { likes: 1500, rts: 310, views: 120000, minutesAgo: 39 }, now),
      tw(ACC.tekno, 'Yerli elektrikli otomobil üreticisi, yeni kompakt modelinin 620 km menzille geleceğini ve ön siparişlerin cuma başlayacağını duyurdu. (DEMO)', { likes: 2600, rts: 540, views: 230000, minutesAgo: 70, media: [{ type: 'photo', alt: 'Kırmızı kompakt elektrikli otomobil' }] }, now),
      tw(ACC.spor, 'Milli takımın aday kadrosu açıklandı: 26 isimlik listede 4 yeni yüz var. En dikkat çeken isim 19 yaşındaki orta saha. (DEMO)', { likes: 5100, rts: 820, views: 390000, minutesAgo: 62 }, now),
      tw(ACC.mizah, 'Toplantı "5 dakikalık hızlı bir sync" diye başladı, şu an 47. dakikadayız ve kimse sync olmadı. (DEMO)', { likes: 8800, rts: 1900, views: 600000, minutesAgo: 35 }, now),
      tw(ACC.bilim, 'Gökbilimciler, 40 ışık yılı uzaklıktaki bir gezegenin atmosferinde su buharı izlerine rastladı. Makale bugün yayımlandı. (DEMO)', { likes: 3300, rts: 700, views: 210000, minutesAgo: 95 }, now),
      tw(ACC.dev, 'günaydın ☕', { likes: 40, rts: 1, views: 900, minutesAgo: 30 }, now),
      tw(ACC.sehir, 'Metro hattında yarın 06.00-10.00 arası planlı bakım nedeniyle seferler 10 dakikada bir yapılacak. Alternatif güzergâhları planlayın. (DEMO)', { likes: 700, rts: 450, views: 95000, minutesAgo: 25 }, now),
      tw(ACC.kultur, 'Şehrin en eski sinemalarından biri restorasyonun ardından kapılarını yeniden açıyor; açılışta 1960\'lardan klasikler gösterilecek. (DEMO)', { likes: 1200, rts: 210, views: 60000, minutesAgo: 80 }, now),
    ],
    () => [
      tw(ACC.futbol, 'Aday kadroya giren 19 yaşındaki orta saha bu sezon ligde 6 asist yaptı; pas isabeti yüzde 91. Hak edilmiş bir çağrı. (DEMO)', { likes: 1400, rts: 190, views: 70000, minutesAgo: 6 }, now),
      tw(ACC.tekno, 'Popüler mesajlaşma uygulaması yapay zekâ destekli "akıllı özet" özelliğini Türkçe dahil 20 dilde kullanıma açtı. (DEMO)', { likes: 2100, rts: 400, views: 150000, minutesAgo: 4 }, now),
    ],
    () => [
      tw(ACC.haber, 'SON DAKİKA: Marmara Denizi\'nde 4,9 büyüklüğünde deprem. AFAD: Şu ana kadar olumsuz bir ihbar yok, saha taramaları sürüyor. (DEMO)', { likes: 12000, rts: 6100, replies: 2400, views: 1500000, minutesAgo: 2 }, now),
      tw(ACC.sehir, 'Deprem İstanbul\'da da hissedildi. Valilik: Okullarda ve hastanelerde kontrol yapılıyor, şu ana kadar hasar raporu yok. (DEMO)', { likes: 3400, rts: 1500, views: 300000, minutesAgo: 1 }, now),
    ],
    () => [
      tw(ACC.mizah, 'Kod incelemesinde "küçük bir değişiklik" yazan PR: 84 dosya, 3.200 satır. Küçük olan ne acaba, PR açıklaması mı? (DEMO)', { likes: 6200, rts: 1100, views: 400000, minutesAgo: 3 }, now),
      tw(ACC.piyasa, 'Faiz indirimi sonrası mevduat faizlerinde ilk düşüşler geldi; üç büyük banka 32 günlük vadede oranları 1,5 puan indirdi. (DEMO)', { likes: 800, rts: 220, views: 60000, minutesAgo: 5 }, now),
    ],
    () => [
      tw(ACC.haber, 'Marmara\'daki 4,9\'luk deprem sonrası AFAD açıklaması: 3 artçı sarsıntı kaydedildi, en büyüğü 3,1. Can kaybı ya da yaralı yok. (DEMO)', { likes: 5200, rts: 2100, views: 520000, minutesAgo: 2 }, now),
      tw(ACC.kultur, 'Yılın en çok beklenen yerli dizisinin fragmanı yayımlandı; 24 saatte 3 milyon izlenme. (DEMO)', { likes: 2900, rts: 330, views: 310000, minutesAgo: 8 }, now),
    ],
  ];
}

function wavesEn(now) {
  const C = ACC_EN;
  const e = (author, text, o = {}) => tw(author, text, { ...o, lang: 'en' }, now);
  return [
    () => [
      e(C.eko, 'The central bank just announced its rate decision: the policy rate is cut from 5.25% to 4.75%. Markets had expected a 25 basis point cut. (DEMO)', { likes: 4200, rts: 1300, views: 410000, minutesAgo: 48 }),
      e(C.piyasa, 'After the rate decision the dollar slipped 0.6% in early trading, while bank stocks jumped 3%. (DEMO)', { likes: 900, rts: 260, views: 88000, minutesAgo: 41 }),
      e(C.rnd, 'A 50 basis point cut, twice what was expected, signals confidence that inflation is cooling. But rent and food prices are still sticky, so watch those. (DEMO)', { likes: 1500, rts: 310, views: 120000, minutesAgo: 39 }),
      e(C.tekno, 'An electric carmaker says its new compact model will get a 620 km range, with pre-orders opening on Friday. (DEMO)', { likes: 2600, rts: 540, views: 230000, minutesAgo: 70, media: [{ type: 'photo', alt: 'Red compact electric car' }] }),
      e(C.spor, 'The national team squad is out: 4 new faces in the 26-player list. The headline name is a 19-year-old midfielder. (DEMO)', { likes: 5100, rts: 820, views: 390000, minutesAgo: 62 }),
      e(C.mizah, 'The meeting started as "a quick 5-minute sync". We are now at minute 47 and nobody is synced. (DEMO)', { likes: 8800, rts: 1900, views: 600000, minutesAgo: 35 }),
      e(C.bilim, 'Astronomers have found traces of water vapor in the atmosphere of a planet 40 light-years away. The paper came out today. (DEMO)', { likes: 3300, rts: 700, views: 210000, minutesAgo: 95 }),
      e(C.dev, 'good morning ☕', { likes: 40, rts: 1, views: 900, minutesAgo: 30 }),
      e(C.sehir, 'Subway trains will run every 10 minutes tomorrow from 6 to 10 a.m. because of planned maintenance. Plan an alternative route. (DEMO)', { likes: 700, rts: 450, views: 95000, minutesAgo: 25 }),
      e(C.kultur, 'One of the city’s oldest cinemas reopens after a full restoration, with classics from the 1960s on opening night. (DEMO)', { likes: 1200, rts: 210, views: 60000, minutesAgo: 80 }),
    ],
    () => [
      e(C.futbol, 'The 19-year-old midfielder called up to the national squad has 6 assists in the league this season and 91% pass accuracy. Well deserved. (DEMO)', { likes: 1400, rts: 190, views: 70000, minutesAgo: 6 }),
      e(C.tekno, 'A popular messaging app has rolled out its AI-powered "smart summary" feature in 20 languages. (DEMO)', { likes: 2100, rts: 400, views: 150000, minutesAgo: 4 }),
    ],
    () => [
      e(C.haber, 'BREAKING: A magnitude 4.9 earthquake has struck off the coast. Emergency services say there are no reports of damage so far; field checks are under way. (DEMO)', { likes: 12000, rts: 6100, replies: 2400, views: 1500000, minutesAgo: 2 }),
      e(C.sehir, 'The earthquake was also felt across the city. Officials: schools and hospitals are being checked, no damage reported so far. (DEMO)', { likes: 3400, rts: 1500, views: 300000, minutesAgo: 1 }),
    ],
    () => [
      e(C.mizah, 'A pull request titled "small change": 84 files, 3,200 lines. What exactly is small here, the description? (DEMO)', { likes: 6200, rts: 1100, views: 400000, minutesAgo: 3 }),
      e(C.piyasa, 'First savings rate cuts after the central bank’s move: three major banks lowered their one-month deposit rates by half a point. (DEMO)', { likes: 800, rts: 220, views: 60000, minutesAgo: 5 }),
    ],
    () => [
      e(C.haber, 'Update on the 4.9 earthquake off the coast: 3 aftershocks recorded, the largest a 3.1. No casualties or injuries reported. (DEMO)', { likes: 5200, rts: 2100, views: 520000, minutesAgo: 2 }),
      e(C.kultur, 'The trailer for the most anticipated series of the year is out: 3 million views in 24 hours. (DEMO)', { likes: 2900, rts: 330, views: 310000, minutesAgo: 8 }),
    ],
  ];
}

export const DEMO_WAVES = 5;
