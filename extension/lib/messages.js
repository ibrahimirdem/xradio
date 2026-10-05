// İstasyon, arka plan ve odak kalkanı için kısa mesajlar (Türkçe / İngilizce).
// Arayüz sayfalarının çevirileri ui/i18n.js içindedir.

import { uiLangOf } from './config.js';

const M = {
  tr: {
    authFailed: 'Gemini API anahtarı reddedildi. Yerel moda geçildi — ayarlardan anahtarı kontrol et.',
    audioBlocked: 'Tarayıcı sesi başlatmayı engelledi. Radyo penceresinde bir kez "Başlat"a tıkla.',
    musicFallback: 'Müzik kaynağı çalışmadı ({reason}). Yerleşik yedek müziğe geçildi.',
    unknown: 'bilinmeyen',
    breakingTitle: 'XRadio — Son dakika',
    breakingFallback: 'Son dakika gelişmesi',
    // Odak kalkanı
    shCollectorBadge: 'XRADIO DİNLEME NOKTASI',
    shCollectorTitle: "Bu sekme senin yerine X'i dinliyor",
    shCollectorText: '{a} ve {b} gündemi buradan topluyor. Sekmeyi kapatma; akışa bakmana gerek yok.',
    shOpenStudio: 'Stüdyoyu aç',
    shCollectorNote: 'Sekme birkaç dakikada bir kendini yeniler. Radyoyu durdurduğunda otomatik kapanır.',
    shOnAir: 'YAYINDA',
    shOff: 'RADYO KAPALI',
    shTitleOn: 'Gündemi senin için biz takip ediyoruz',
    shTitleOff: "X'e bakmak yerine radyoyu aç",
    shTextOn: '{a} ve {b} akışını dinliyor; önemli bir şey olursa müziği kısıp söyleyecekler.',
    shTextOff: "XRadio akışındaki önemli gelişmeleri iki DJ'in sohbetiyle anlatır; sen de işine odaklanırsın.",
    shRecent: 'Bugün konuşulanlar',
    shCount: "Bugün X'i açma denemen: {n}",
    shTalkNow: 'Gündemi şimdi anlatın',
    shStart: 'Radyoyu başlat',
    shClose: 'Sekmeyi kapat',
    shSnooze: '5 dk bakmam lazım',
    shNote: 'Belirli bir paylaşımın bağlantısını açarsan kalkan araya girmez. Ayarlardan kapatabilirsin.',
  },
  en: {
    authFailed: 'The Gemini API key was rejected. Switched to local mode — check the key in Settings.',
    audioBlocked: 'The browser blocked audio. Click "Start" once in the radio window.',
    musicFallback: "The music source didn't work ({reason}). Switched to the built-in backup music.",
    unknown: 'unknown',
    breakingTitle: 'XRadio — Breaking news',
    breakingFallback: 'Breaking development',
    shCollectorBadge: 'XRADIO LISTENING POST',
    shCollectorTitle: 'This tab listens to X for you',
    shCollectorText: "{a} and {b} gather the news here. Keep this tab open — you don't need to look at the feed.",
    shOpenStudio: 'Open the studio',
    shCollectorNote: 'The tab refreshes itself every few minutes and closes automatically when you stop the radio.',
    shOnAir: 'ON AIR',
    shOff: 'RADIO OFF',
    shTitleOn: "We're watching the news for you",
    shTitleOff: 'Turn on the radio instead of scrolling X',
    shTextOn: "{a} and {b} are listening to your feed; if something important happens they'll turn the music down and tell you.",
    shTextOff: 'XRadio turns what matters in your feed into a chat between two DJs, so you can stay focused.',
    shRecent: 'Covered today',
    shCount: 'Attempts to open X today: {n}',
    shTalkNow: 'Tell me the news now',
    shStart: 'Start the radio',
    shClose: 'Close this tab',
    shSnooze: 'I need 5 minutes',
    shNote: "Opening a link to a specific post won't trigger the shield. You can turn it off in Settings.",
  },
};

export function msg(lang, key, vars = {}) {
  const dict = M[uiLangOf(lang)] || M.tr;
  return String(dict[key] ?? M.tr[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

/** Odak kalkanı ekranının tüm metinleri (içerik betiğine gönderilir). */
export function shieldStrings(lang, hosts = ['Defne', 'Kaan']) {
  const out = {};
  for (const k of Object.keys(M.tr)) if (k.startsWith('sh')) out[k] = msg(lang, k, { a: hosts[0], b: hosts[1], n: '{n}' }); // {n} kalkanda doldurulur
  return out;
}
