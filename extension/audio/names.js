// Üretilen parçalar için şiirsel adlar ve hayali sanatçılar: Türkçe yayında Türkçe, diğer dillerde İngilizce.

import { choice, chance } from './rng.js';

const NAMES = {
  tr: {
    places: ['Kadıköy', 'Moda', 'Karaköy', 'Cihangir', 'Galata', 'Kuzguncuk', 'Bebek', 'Ortaköy', 'Kordon', 'Alsancak',
      'Üsküdar', 'Balat', 'Arnavutköy', 'Kaş', 'Ayvalık', 'Bozcaada', 'Kapadokya', 'Tophane', 'Fener', 'Bostancı', 'Ankara Garı', 'Kızılay'],
    times: ['Gece Yarısı', 'Sabah Altı', 'Pazar Öğleden Sonra', 'Akşamüstü', 'Gün Doğumu', 'İkindi', 'Saat 03.00', 'Cuma Akşamı', 'Mesai Sonrası', 'Ezan Vakti Öncesi'],
    timeSuffix: ['', '', 'Bossa', 'Ninnisi', 'Şarkısı', 'Valsi'],
    things: ['Yağmuru', 'Vapuru', 'Martıları', 'Işıkları', 'Kahvesi', 'Rüzgârı', 'Sokakları', 'Çay Bahçesi', 'Pencereleri', 'Rıhtımı', 'Sisi', 'Tramvayı', 'Kedileri', 'Simitçisi'],
    moods: ['Mavi', 'Sessiz', 'Ilık', 'Yavaş', 'Uzak', 'Eski', 'Sıcak', 'Gümüş', 'Kadife', 'Yumuşak', 'Puslu'],
    nouns: ['Plak', 'Kaset', 'Pazar', 'Lodos', 'Poyraz', 'Liman', 'Ekran', 'Mektup', 'Telgraf', 'Fener', 'Balkon', 'Gölge'],
    themed: [
      'Bildirimsiz Saatler', "Timeline'sız Bir Gün", 'Odak Modu', 'Algoritma Dışı', 'Sekme Kapatma Dansı', 'Kahve ve Kod',
      'Deadline Bossa', 'Ekran Işığı', 'Sonsuz Kaydırma Yok', 'Gece Vardiyası', 'Mesai Sonu', 'Son Vapur', 'Sessize Alındı',
      'Okundu Bilgisi Kapalı', 'Uçak Modu', 'Derin Çalışma', 'Pomodoro Yirmi Beş', 'Klavye Yağmuru',
    ],
    artists: {
      lofi: ['Moda Lo-fi Kulübü', 'Gece Kuşları Kolektifi', 'Kod & Kahve', 'Plak Tozu', 'Sessiz Bildirim'],
      jazz: ['Karaköy Caz Üçlüsü', 'Galata Swing Grubu', 'Fener Kuarteti', 'Rıhtım Caz Kulübü'],
      house: ['Boğaz Deep Kolektif', 'Kordon Gece Kulübü', 'Derin Akış', 'Tophane Groove'],
      synthwave: ['Analog Rüya', 'Neon Kızılay', 'Kaset 1987', 'Retro Vapur'],
      ambient: ['Uzak Liman', 'Sis Orkestrası', 'Yavaş Dalgalar', 'Kapadokya Sessizliği'],
    },
    styleLabels: { jazz: 'caz' },
  },
  en: {
    places: ['Brooklyn', 'Soho', 'Shibuya', 'Kreuzberg', 'Montmartre', 'Harbor', 'Riverside', 'Downtown', 'Old Town', 'Seaside',
      'Midtown', 'Alfama', 'Gion', 'Venice Beach', 'Union Square', 'Northside'],
    times: ['Midnight', '6 AM', 'Sunday Afternoon', 'Golden Hour', 'Sunrise', 'Late Afternoon', '3 AM', 'Friday Night', 'After Hours', 'Blue Hour'],
    timeSuffix: ['', '', 'Bossa', 'Lullaby', 'Song', 'Waltz'],
    things: ['Rain', 'Ferry', 'Seagulls', 'Lights', 'Coffee', 'Wind', 'Streets', 'Rooftops', 'Windows', 'Pier', 'Fog', 'Tram', 'Cats', 'Bakery'],
    moods: ['Blue', 'Quiet', 'Warm', 'Slow', 'Distant', 'Old', 'Silver', 'Velvet', 'Soft', 'Hazy', 'Golden'],
    nouns: ['Vinyl', 'Cassette', 'Sunday', 'Harbor', 'Postcard', 'Letter', 'Telegram', 'Lighthouse', 'Balcony', 'Shadow', 'Screen', 'Breeze'],
    themed: [
      'Notification-Free Hours', 'A Day Without the Timeline', 'Focus Mode', 'Off the Algorithm', 'Tab Closing Dance', 'Coffee & Code',
      'Deadline Bossa', 'Screen Glow', 'No Infinite Scroll', 'Night Shift', 'End of Shift', 'Last Ferry', 'Muted',
      'Read Receipts Off', 'Airplane Mode', 'Deep Work', 'Pomodoro Twenty-Five', 'Keyboard Rain',
    ],
    artists: {
      lofi: ['Rooftop Lo-fi Club', 'Night Owls Collective', 'Code & Coffee', 'Vinyl Dust', 'Silent Notification'],
      jazz: ['Harbor Jazz Trio', 'Old Town Swing Band', 'Lighthouse Quartet', 'Pier Jazz Club'],
      house: ['Deep Harbor Collective', 'Riverside Night Club', 'Deep Flow', 'Midtown Groove'],
      synthwave: ['Analog Dream', 'Neon Boulevard', 'Cassette 1987', 'Retro Ferry'],
      ambient: ['Distant Harbor', 'Fog Orchestra', 'Slow Waves', 'Desert Silence'],
    },
    styleLabels: { jazz: 'jazz' },
  },
};

let N = NAMES.tr;

/** Parça adlarının dili: yayın dili Türkçe ise Türkçe, değilse İngilizce. */
export function setTrackLanguage(lang) { N = lang === 'tr' ? NAMES.tr : NAMES.en; }

export function trackTitle(rnd, style) {
  const r = rnd();
  if (r < 0.22) return choice(rnd, N.themed);
  if (r < 0.48) return `${choice(rnd, N.places)} ${choice(rnd, N.things)}`;
  if (r < 0.64) return `${choice(rnd, N.times)} ${choice(rnd, N.timeSuffix)}`.trim();
  if (r < 0.82) return `${choice(rnd, N.moods)} ${choice(rnd, N.nouns)}`;
  const base = `${choice(rnd, N.places)}, ${choice(rnd, N.times)}`;
  return style === 'synthwave' && chance(rnd, 0.5) ? `${base} '87` : base;
}

export function trackArtist(rnd, style) {
  return choice(rnd, N.artists[style] || N.artists.lofi);
}

/** Tarz etiketi (ör. "caz" / "jazz"); dile özgü olmayanlar olduğu gibi kalır. */
export function localStyleLabel(style, label) {
  return N.styleLabels[style] || label;
}
