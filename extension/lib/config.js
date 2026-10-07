// XRadio — ortak ayarlar ve sabitler.
// Bu modül hem eklenti bağlamlarında hem de Node testlerinde kullanılır; tarayıcıya özgü API içermez.

export const STATION_DEFAULT_NAME = 'XRadio';

export const DEFAULT_MODELS = {
  text: 'gemini-3.8-flash',
  triage: 'gemini-3.8-flash',
  tts: 'gemini-3.8-flash-tts',
  // Eski (generateContent) API için yedek modeller
  legacyText: 'gemini-flash-latest',
  legacyTts: 'gemini-2.5-flash-preview-tts',
};

// Gemini TTS hazır sesleri (Google belgelerindeki 30 ses).
export const GEMINI_VOICES = [
  { id: 'Zephyr', gender: 'f', desc: 'Parlak' },
  { id: 'Puck', gender: 'm', desc: 'Neşeli' },
  { id: 'Charon', gender: 'm', desc: 'Bilgilendirici' },
  { id: 'Kore', gender: 'f', desc: 'Kararlı' },
  { id: 'Fenrir', gender: 'm', desc: 'Heyecanlı' },
  { id: 'Leda', gender: 'f', desc: 'Genç' },
  { id: 'Orus', gender: 'm', desc: 'Kararlı' },
  { id: 'Aoede', gender: 'f', desc: 'Ferah' },
  { id: 'Callirrhoe', gender: 'f', desc: 'Rahat' },
  { id: 'Autonoe', gender: 'f', desc: 'Parlak' },
  { id: 'Enceladus', gender: 'm', desc: 'Nefesli' },
  { id: 'Iapetus', gender: 'm', desc: 'Net' },
  { id: 'Umbriel', gender: 'm', desc: 'Rahat' },
  { id: 'Algieba', gender: 'm', desc: 'Pürüzsüz' },
  { id: 'Despina', gender: 'f', desc: 'Pürüzsüz' },
  { id: 'Erinome', gender: 'f', desc: 'Net' },
  { id: 'Algenib', gender: 'm', desc: 'Pürüzlü' },
  { id: 'Rasalgethi', gender: 'm', desc: 'Bilgilendirici' },
  { id: 'Laomedeia', gender: 'f', desc: 'Neşeli' },
  { id: 'Achernar', gender: 'f', desc: 'Yumuşak' },
  { id: 'Alnilam', gender: 'm', desc: 'Kararlı' },
  { id: 'Schedar', gender: 'm', desc: 'Dengeli' },
  { id: 'Gacrux', gender: 'f', desc: 'Olgun' },
  { id: 'Pulcherrima', gender: 'f', desc: 'Atak' },
  { id: 'Achird', gender: 'm', desc: 'Samimi' },
  { id: 'Zubenelgenubi', gender: 'm', desc: 'Gündelik' },
  { id: 'Vindemiatrix', gender: 'f', desc: 'Nazik' },
  { id: 'Sadachbia', gender: 'm', desc: 'Canlı' },
  { id: 'Sadaltager', gender: 'm', desc: 'Bilgili' },
  { id: 'Sulafat', gender: 'f', desc: 'Sıcak' },
];

export const DEFAULT_PERSONAS = {
  A: 'Keskin zekâlı, hızlı düşünen eski bir haber editörü. Kuru ve ince esprileri var, ironiyi sever, '
    + 'bilgiyi bağlama oturtmakta ustadır. Partnerinin abartılarını tek cümleyle yere indirir. '
    + 'Ciddi haberlerde sakin, net ve güven verici konuşur.',
  B: 'Enerjik, sıcakkanlı; teknoloji, futbol ve yemek meraklısı. Kelime oyunlarına ve baba şakalarına bayılır, '
    + 'bazen konuyu abartıp partnerinden laf yer. Dinleyiciyle samimi konuşur. Ciddi anlarda espriyi bırakıp '
    + 'empatiyle konuşur.',
};

export const DEFAULT_PERSONAS_EN = {
  A: 'A sharp, quick-thinking former news editor. Dry, subtle wit and a love of irony; great at putting facts in '
    + 'context. Brings her co-host back down to earth with a single line. Calm, clear and reassuring on serious news.',
  B: 'Energetic and warm; into tech, football and food. Loves puns and dad jokes, sometimes exaggerates and gets '
    + 'teased for it. Talks to the listener like a friend. Drops the jokes and speaks with empathy when it matters.',
};

// ------------------------------------------------------------------ Diller
// Yayın dili: DJ'lerin konuşması, haber başlıkları, seslendirme. Arayüz yalnızca Türkçe/İngilizce (diğerleri İngilizce).
// local: yapay zekâsız yerel modda şablon desteği olan diller.
export const LANGUAGES = [
  { code: 'tr', native: 'Türkçe', english: 'Turkish', trName: 'Türkçe', bcp47: 'tr-TR', script: 'latin', local: true },
  { code: 'en', native: 'English', english: 'English', trName: 'İngilizce', bcp47: 'en-US', script: 'latin', local: true },
  { code: 'de', native: 'Deutsch', english: 'German', trName: 'Almanca', bcp47: 'de-DE', script: 'latin' },
  { code: 'fr', native: 'Français', english: 'French', trName: 'Fransızca', bcp47: 'fr-FR', script: 'latin' },
  { code: 'es', native: 'Español', english: 'Spanish', trName: 'İspanyolca', bcp47: 'es-ES', script: 'latin' },
  { code: 'it', native: 'Italiano', english: 'Italian', trName: 'İtalyanca', bcp47: 'it-IT', script: 'latin' },
  { code: 'pt', native: 'Português', english: 'Portuguese', trName: 'Portekizce', bcp47: 'pt-BR', script: 'latin' },
  { code: 'nl', native: 'Nederlands', english: 'Dutch', trName: 'Felemenkçe', bcp47: 'nl-NL', script: 'latin' },
  { code: 'az', native: 'Azərbaycanca', english: 'Azerbaijani', trName: 'Azerbaycan Türkçesi', bcp47: 'az-AZ', script: 'latin' },
  { code: 'ru', native: 'Русский', english: 'Russian', trName: 'Rusça', bcp47: 'ru-RU', script: 'cyrillic' },
  { code: 'uk', native: 'Українська', english: 'Ukrainian', trName: 'Ukraynaca', bcp47: 'uk-UA', script: 'cyrillic' },
  { code: 'ar', native: 'العربية', english: 'Arabic', trName: 'Arapça', bcp47: 'ar-EG', script: 'arabic' },
  { code: 'fa', native: 'فارسی', english: 'Persian', trName: 'Farsça', bcp47: 'fa-IR', script: 'arabic' },
  { code: 'ja', native: '日本語', english: 'Japanese', trName: 'Japonca', bcp47: 'ja-JP', script: 'cjk' },
  { code: 'ko', native: '한국어', english: 'Korean', trName: 'Korece', bcp47: 'ko-KR', script: 'hangul' },
];

export function langInfo(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

/** Tarayıcı arayüz dilinden ("tr", "en-US", "de-DE") desteklenen yayın diline; yoksa İngilizce. */
export function detectLanguage(uiLanguage) {
  const c = String(uiLanguage || '').toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.some((l) => l.code === c) ? c : 'en';
}

/** Arayüz dili: Türkçe ya da İngilizce. */
export function uiLangOf(code) { return code === 'tr' ? 'tr' : 'en'; }

/** Dile göre varsayılan DJ kişilikleri (Türkçe dışı yayınlarda İngilizce tarif modele daha uygun). */
export function personasFor(code) { return code === 'tr' ? DEFAULT_PERSONAS : DEFAULT_PERSONAS_EN; }

export const MUSIC_STYLES = [
  { id: 'lofi', label: 'Lo-fi / Chillhop' },
  { id: 'jazz', label: 'Caz Kafe' },
  { id: 'house', label: 'Deep House' },
  { id: 'synthwave', label: 'Synthwave' },
  { id: 'ambient', label: 'Ambient / Odak' },
  { id: 'auto', label: 'Otomatik (saate ve gündeme göre)' },
];

export const MUSIC_MOODS = ['chill', 'upbeat', 'dreamy', 'groovy', 'tense', 'night'];

export const TALK_INTERVALS = { az: 12, normal: 7, cok: 4 }; // dakika

export const DEFAULT_SETTINGS = {
  // Yapay zekâ
  apiKey: '',
  engine: 'auto',               // 'auto' | 'gemini' | 'local'
  apiBase: 'https://generativelanguage.googleapis.com',
  textModel: DEFAULT_MODELS.text,
  triageModel: DEFAULT_MODELS.triage,
  ttsModel: DEFAULT_MODELS.tts,
  autoModels: true,

  // Dil: kurulumda tarayıcı dilinden algılanır, Başlangıç ekranında değiştirilebilir
  language: 'tr',
  languageConfirmed: false,
  theme: 'system',          // arayüz teması: system | light | dark

  // İstasyon & sunucular
  stationName: STATION_DEFAULT_NAME,
  listenerName: '',
  hostA: { name: 'Defne', voice: 'Zephyr', persona: DEFAULT_PERSONAS.A },
  hostB: { name: 'Kaan', voice: 'Puck', persona: DEFAULT_PERSONAS.B },
  humor: 0.6,                   // 0 (ciddi) .. 1 (çok esprili)
  talkiness: 'normal',          // 'az' | 'normal' | 'cok'
  segmentLength: 'normal',      // 'kisa' | 'normal' | 'uzun'
  breakingThreshold: 8,         // 1..10 — bu önemin üstü yayını keser
  minImportance: 4,             // bu önemin altındaki haberler anlatılmaz
  teaseFocusShield: true,       // DJ'ler X'e girme denemelerine takılabilir
  city: '',

  // Müzik
  musicSource: 'youtube',       // 'youtube' | 'mylist' (kişisel liste) | 'generative' (internetsiz yedek) | 'stream' | 'none'
  youtubeUrl: 'https://www.youtube.com/watch?v=rFZHOHl-L8A',
  youtubeMode: 'auto',          // 'auto' (gömülü, olmazsa sekme) | 'embed' | 'tab'
  youtubeFollowMood: false,     // DJ'lerin müzik önerisine göre hazır yayınlar arasında geçiş
  myList: [],                   // kişisel liste: [{ id, title, artist, duration, thumb }] (Müzik sekmesinden aranıp eklenir)
  myListShuffle: false,
  musicStyle: 'auto',           // yerleşik yedek motor için
  streamUrl: '',
  masterVolume: 0.9,
  musicVolume: 0.7,
  voiceVolume: 1.0,
  duckLevel: 0.2,

  // X toplayıcı
  feed: 'following',            // 'following' | 'foryou'
  refreshMinutes: 4,
  collectorMode: 'pinned',      // 'pinned' | 'window'
  closeCollectorOnStop: true,
  demoMode: false,

  // Odak kalkanı
  focusShield: true,
  shieldSnoozeMinutes: 5,
  xDock: true,                  // X'te sağ altta radyo düğmesi (Grok ve Sohbet'in üstünde)

  // Filtreler
  muteWords: [],
  priorityAccounts: [],
  priorityWords: [],

  notifyBreaking: false,
  autoStartOnBrowserOpen: false,
};

// Aciliyet sözcükleri: Türk haber hesapları bunları neredeyse her paylaşımda kullanır,
// bu yüzden TEK BAŞINA son dakika sayılmaz (sadece önemi biraz artırır).
export const URGENCY_KEYWORDS = ['son dakika', 'sondakika', 'flaş', 'flas', 'acil', 'breaking', 'urgent', 'just in', 'önemli gelişme'];

// Ağır olaylar: afet, şiddet, can kaybı. Bunlar yayını kesebilir ve ciddi tonla (şakasız) anlatılır.
export const GRAVE_KEYWORDS = [
  'deprem', 'tsunami', 'patlama', 'saldırı', 'saldiri', 'terör', 'teror', 'çatışma', 'catisma',
  'hayatını kaybetti', 'hayatini kaybetti', 'öldü', 'yaralı', 'tahliye', 'yangın', 'sel felaketi', 'heyelan',
  'darbe', 'savaş', 'savas', 'ateşkes', 'ateskes', 'olağanüstü hal', 'sokağa çıkma', 'uçak düştü', 'kaza kırım',
  // İngilizce (kelime başı boşlukla: "war" → "software" eşleşmesin)
  ' earthquake', ' tsunami', ' explosion', ' attack', ' terror', ' killed', ' injured', ' evacuat', ' wildfire',
  ' flood', ' landslide', ' coup ', ' war ', ' ceasefire', 'state of emergency', ' curfew', 'plane crash',
];

// Olay sözcükleri: gerçekten yayını kesmeyi gerektirebilecek ani ve geniş etkili olaylar
// (ağır olaylar + piyasayı/siyaseti bir anda değiştiren kararlar; bu ikinciler ciddi ton gerektirmez).
export const EVENT_KEYWORDS = [...GRAVE_KEYWORDS, 'faiz kararı', 'faiz karari', 'seçim sonuç', 'rate decision', 'election result'];

export const BREAKING_KEYWORDS = [...URGENCY_KEYWORDS, ...EVENT_KEYWORDS];

export const CATEGORY_LABELS = {
  gundem: 'Gündem', siyaset: 'Siyaset', ekonomi: 'Ekonomi', dunya: 'Dünya', spor: 'Spor',
  teknoloji: 'Teknoloji', bilim: 'Bilim', kultur: 'Kültür-Sanat', magazin: 'Magazin',
  saglik: 'Sağlık', yasam: 'Yaşam', kisisel: 'Kişisel', diger: 'Diğer',
};

export function mergeSettings(stored) {
  const s = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  s.hostA = { ...DEFAULT_SETTINGS.hostA, ...((stored && stored.hostA) || {}) };
  s.hostB = { ...DEFAULT_SETTINGS.hostB, ...((stored && stored.hostB) || {}) };
  if (!LANGUAGES.some((l) => l.code === s.language)) s.language = 'tr';
  if (!['system', 'light', 'dark'].includes(s.theme)) s.theme = 'system';
  if (!['youtube', 'mylist', 'generative', 'stream', 'none'].includes(s.musicSource)) s.musicSource = 'youtube';
  // Kişisel liste: geçerli video kimlikleri, tekrar yok, en fazla 500 parça
  const seen = new Set();
  s.myList = (Array.isArray(s.myList) ? s.myList : [])
    .filter((t) => t && /^[A-Za-z0-9_-]{11}$/.test(t.id) && !seen.has(t.id) && seen.add(t.id))
    .slice(0, 500)
    .map((t) => ({ id: t.id, title: String(t.title || '').slice(0, 200), artist: String(t.artist || '').slice(0, 120), duration: Number(t.duration) || 0, thumb: String(t.thumb || ''), ...(t.live ? { live: true } : {}) }));
  s.myListShuffle = !!s.myListShuffle;
  for (const k of ['muteWords', 'priorityAccounts', 'priorityWords']) {
    if (typeof s[k] === 'string') s[k] = s[k].split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    if (!Array.isArray(s[k])) s[k] = [];
  }
  return s;
}

/** Hangi zekâ motoru kullanılacak? */
export function resolveEngine(settings) {
  if (settings.engine === 'local') return 'local';
  if (settings.engine === 'gemini') return settings.apiKey ? 'gemini' : 'local';
  return settings.apiKey ? 'gemini' : 'local';
}
