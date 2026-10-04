// İfade (duygu) işaretleri: Gemini TTS etiketleri ve araya giren dinleyici tepkileri.
//
// Gemini 3.8 Flash TTS (2026) belgelerine göre:
//  - Anlık sesler metnin içinde İNGİLİZCE ve açılı parantezle yazılır: <laugh>, <sigh>, <short pause>…
//    (Metin Türkçe olsa bile etiketler İngilizce kalmalı.)
//  - Dinleyen konuşmacının kısa tepkileri konuşanın satırına dikey çizgiyle eklenir: "… |yok artık| …"
//    Bunlar dinleyenin sesiyle, üst üste binerek seslendirilir.
//  - Eski 2.5 TTS modelleri köşeli parantezli etiketleri anlar: [laughing], [sigh], [short pause]…

/** Desteklenen etiketler → Türkçe altyazı karşılığı (null: altyazıda gösterme). */
export const TTS_TAGS = {
  laugh: 'güler', laughter: 'güler', chuckle: 'kıkırdar', chuckles: 'kıkırdar', giggle: 'kıkırdar', snicker: 'kıs kıs güler',
  cackle: 'kahkaha atar', sigh: 'iç çeker', sighs: 'iç çeker', gasp: 'şaşırır', whispers: 'fısıldar', whispering: 'fısıldar',
  breath: null, 'heavy breath': null, exhales: null, tsk: 'cık', phew: 'oh be', pff: 'pöf', 'throat-clearing': 'boğazını temizler',
  cheer: 'sevinçle bağırır', groan: 'homurdanır', yawn: 'esner', cough: null, sneeze: null,
  'short pause': '…', 'long pause': '…',
};

const LAUGHS = new Set(['laugh', 'laughter', 'chuckle', 'chuckles', 'giggle', 'snicker', 'cackle', 'cheer']);

// Modelin ya da yazarın yazabileceği hatalı biçimler → doğru etiket
const ALIASES = {
  laughing: 'laugh', laughs: 'laugh', 'laughs softly': 'chuckle', güler: 'laugh', gülüyor: 'laugh', gülerek: 'laugh', kahkaha: 'laugh',
  kıkırdar: 'chuckle', kikirdar: 'chuckle', 'iç çeker': 'sigh', 'ic ceker': 'sigh', sighing: 'sigh', fısıldar: 'whispers', whisper: 'whispers',
  gasps: 'gasp', 'kısa duraklama': 'short pause', 'uzun duraklama': 'long pause', duraklama: 'short pause', pause: 'short pause',
  'medium pause': 'short pause', breathes: 'breath', 'clears throat': 'throat-clearing', uhm: 'short pause', hmm: 'short pause',
};

function canonicalTag(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  // İngilizce etiketler için dil-bağımsız küçük harf (Türkçe yerelde "SIGH" → "sıgh" olmasın), sonra Türkçe
  for (const t of [s.toLowerCase(), s.toLocaleLowerCase('tr-TR')]) {
    if (Object.prototype.hasOwnProperty.call(TTS_TAGS, t)) return t;
    if (ALIASES[t]) return ALIASES[t];
  }
  return null;
}

/**
 * Bir satırı TTS için normalleştirir.
 * - [laughing], (güler), *güler* gibi biçimleri <laugh>'a çevirir; bilinmeyen etiketleri siler
 * - Yan yana etiketleri teke indirir, tepki (|…|) sayısını ve uzunluğunu sınırlar
 * - serious=true ise gülme etiketlerini ve gülme tepkilerini kaldırır
 */
export function normalizeExpressive(text, { serious = false, maxBackchannels = 2 } = {}) {
  let t = String(text || '');
  // Köşeli / yuvarlak parantezli ya da yıldızlı duygu ifadeleri
  t = t.replace(/\[([^\]]{1,24})\]/g, (m, inner) => { const c = canonicalTag(inner); return c ? `<${c}>` : ''; });
  t = t.replace(/\((güler|gülüyor|gülerek|kahkaha|kıkırdar|iç çeker|fısıldar|laughs?|sighs?)\)/gi, (m, inner) => { const c = canonicalTag(inner); return c ? `<${c}>` : ''; });
  t = t.replace(/\*(güler|gülüyor|kahkaha atar|kıkırdar|iç çeker|laughs?|sighs?)\*/gi, (m, inner) => { const c = canonicalTag(inner); return c ? `<${c}>` : ''; });
  // Açılı etiketler: bilinenleri koru, diğerlerini sil
  t = t.replace(/<\s*([^<>]{1,24}?)\s*>/g, (m, inner) => {
    const c = canonicalTag(inner);
    if (!c) return ' ';
    if (serious && LAUGHS.has(c)) return ' ';
    return `<${c}>`;
  });
  // Yan yana etiketler (araya sadece boşluk girmişse) → ilkini tut
  t = t.replace(/(<[^<>]+>)(\s*<[^<>]+>)+/g, '$1');
  // Tepkiler (backchannel)
  const pipes = (t.match(/\|/g) || []).length;
  if (pipes % 2 === 1) t = t.replace(/\|(?![^|]*\|)/, ''); // eşleşmeyen son çizgiyi at
  let count = 0;
  t = t.replace(/\|([^|]{0,60})\|/g, (m, inner) => {
    let r = inner.replace(/<[^<>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (!r || r.length > 28) return ' ';
    if (serious && /(ha\s*ha|hah|hi\s*hi|kah)/i.test(r)) return ' ';
    if (++count > maxBackchannels) return ' ';
    return ` |${r}| `;
  });
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?;:…])/g, '$1').trim();
}

/** Eski (2.5) TTS modelleri için: açılı etiketleri köşeli parantezlilere çevirir, tepkileri kaldırır. */
export function toLegacyMarkup(text) {
  const map = {
    laugh: '[laughing]', laughter: '[laughing]', chuckle: '[laughing]', chuckles: '[laughing]', giggle: '[laughing]', snicker: '[laughing]', cackle: '[laughing]',
    sigh: '[sigh]', sighs: '[sigh]', whispers: '[whispering]', whispering: '[whispering]', 'short pause': '[short pause]', 'long pause': '[long pause]',
    cheer: '[shouting]',
  };
  return String(text || '')
    .replace(/<([^<>]{1,24})>/g, (m, tag) => ` ${map[tag.trim().toLowerCase()] || ''} `)
    .replace(/\|[^|]{0,60}\|/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:…])/g, '$1')
    .trim();
}

/**
 * Altyazı için parçalara ayırır: [{ type: 'text'|'tag'|'back', value }]
 * 'tag' değeri Türkçe karşılıktır ("güler"); 'back' dinleyen DJ'in tepkisidir.
 */
const TAG_LABELS_EN = {
  laugh: 'laughs', laughter: 'laughs', chuckle: 'chuckles', chuckles: 'chuckles', giggle: 'giggles', snicker: 'snickers',
  cackle: 'cackles', sigh: 'sighs', sighs: 'sighs', gasp: 'gasps', whispers: 'whispers', whispering: 'whispers', tsk: 'tsk',
  phew: 'phew', pff: 'pff', 'throat-clearing': 'clears throat', cheer: 'cheers', groan: 'groans', yawn: 'yawns',
};

export function captionParts(text, uiLang = 'tr') {
  const parts = [];
  const re = /<([^<>]{1,24})>|\|([^|]{1,60})\|/g;
  let last = 0; let m;
  const s = String(text || '');
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ type: 'text', value: s.slice(last, m.index) });
    if (m[1] !== undefined) {
      const c = canonicalTag(m[1]);
      let label = c ? TTS_TAGS[c] : null;
      if (label && label !== '…' && uiLang === 'en') label = TAG_LABELS_EN[c] || null;
      if (label && label !== '…') parts.push({ type: 'tag', value: label });
      else if (label === '…') parts.push({ type: 'text', value: ' … ' });
    } else {
      parts.push({ type: 'back', value: m[2].trim() });
    }
    last = re.lastIndex;
  }
  if (last < s.length) parts.push({ type: 'text', value: s.slice(last) });
  return parts.map((p) => (p.type === 'text' ? { ...p, value: p.value.replace(/\s{2,}/g, ' ') } : p)).filter((p) => p.value && p.value.trim());
}

// ------------------------------------------------------------------ Yayın dili koruması

// Yazı sistemleri (harf aralıkları)
const SCRIPTS = {
  hebrew: /[֐-׿]/,
  arabic: /[؀-ۿݐ-ݿ]/,
  cyrillic: /[Ѐ-ӿ]/,
  greek: /[Ͱ-Ͽ]/,
  cjk: /[぀-ヿ一-鿿]/,
  hangul: /[가-힯]/,
};
// Yayın dillerinin yazı sistemi (config.LANGUAGES ile uyumlu; döngüsel içe aktarmayı önlemek için burada)
const LANG_SCRIPT = { ru: 'cyrillic', uk: 'cyrillic', ar: 'arabic', fa: 'arabic', ja: 'cjk', ko: 'hangul' };
// Varsayılan (Türkçe) yayın için: Latin dışındaki tüm yazı sistemleri yabancıdır
const FOREIGN_SCRIPT = /[֐-׿؀-ۿݐ-ݿЀ-ӿͰ-Ͽ぀-ヿ一-鿿가-힯]/;

/** Yayın dili için izin verilmeyen bir yazı sistemi var mı? */
function hasForeignScript(text, lang = 'tr') {
  const own = LANG_SCRIPT[lang];
  for (const [name, re] of Object.entries(SCRIPTS)) {
    if (name === own) continue;
    if (own === 'cjk' && name === 'hangul') continue;
    if (re.test(text)) return true;
  }
  return false;
}
// Türkçede kelime olarak geçmeyen İngilizce işlev sözcükleri ("on", "it", "at" gibi Türkçede de anlamı olanlar yok)
const EN_STOP = new Set(['the', 'and', 'of', 'to', 'is', 'are', 'was', 'were', 'for', 'with', 'this', 'that', 'you', 'we', 'they',
  'have', 'has', 'will', 'not', 'but', 'from', 'by', 'our', 'your', 'their', 'what', 'when', 'who', 'how', 'just', 'about',
  'there', 'would', 'could', 'should', 'been', 'being', 'which', 'these', 'those', 'here', 'into', 'than', 'them', 'his', 'her', 'its']);
const TR_HINT = /[çğıöşüÇĞİÖŞÜ]|\b(ve|bir|bu|da|de|için|ile|çok|ama|gibi|olan|diye|şu|ne|mi|mı)\b/i;
// Türkçe dışı yayında Türkçe cümle sızmasını yakalamak için başka dillerde pek geçmeyen Türkçe sözcükler
// (Fransızca, İspanyolca, Portekizce ile çakışan de/da/ne/en bilerek yok).
const TR_STOP = new Set(['ve', 'bir', 'bu', 'şu', 'çok', 'için', 'ile', 'ama', 'gibi', 'daha', 'olan', 'olarak', 'sonra', 'kadar',
  'diye', 'şimdi', 'bugün', 'yeni', 'değil', 'oldu', 'var', 'yok', 'herkes', 'gerçekten', 'biz', 'siz', 'onlar', 'ben', 'sen', 'mı', 'mu', 'mü', 'ki']);
function looksTurkish(plain) {
  const words = plain.toLocaleLowerCase('tr-TR').replace(/[^a-zçğıöşüâîû'\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  const stop = words.filter((w) => TR_STOP.has(w)).length;
  const letters = words.filter((w) => /[ğış]/.test(w)).length;
  return (stop >= 2 && stop / words.length > 0.12) || (letters >= 3 && letters / words.length > 0.25);
}

/**
 * Satır yayın diline uygun değilse nedeni ('foreign-script' | 'english' | 'turkish'), uygunsa null.
 * İngilizce kontrolü İngilizce olmayan Latin alfabeli yayınlarda, Türkçe kontrolü Türkçe (ve Azerice) dışı yayınlarda yapılır.
 */
export function languageIssue(text, lang = 'tr') {
  const plain = String(text || '').replace(/<[^<>]*>/g, ' ').replace(/\|[^|]*\|/g, ' ');
  if (hasForeignScript(plain, lang)) return 'foreign-script';
  // Azerice Türkçe ile aynı harf ve sözcükleri paylaştığından orada bu denetim yanıltır.
  if (lang !== 'tr' && lang !== 'az' && looksTurkish(plain)) return 'turkish';
  if (lang === 'en' || LANG_SCRIPT[lang]) return null;
  const words = plain.toLowerCase().replace(/[^a-zçğıöşüâîûäöüßéèêàçñ'\s]/gi, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 4) return null;
  const en = words.filter((w) => EN_STOP.has(w)).length;
  if (en >= 3 && en / words.length > 0.15) return 'english';
  if (lang === 'tr' && en >= 2 && !TR_HINT.test(plain)) return 'english';
  return null;
}

const QUOTE_RE = /“[^”]{2,}”|"[^"]{2,}"|‘[^’]{2,}’|‹[^›]{2,}›|«[^»]{2,}»/g;

/**
 * DJ'lerin tweet "okumasını" ve yabancı dilde konuşmasını engeller.
 * Uzun (14+ kelime) ya da yabancı dildeki alıntıları çıkarır; satır hâlâ uygun değilse ya da alıntı çıkınca
 * yarım kalıyorsa (ör. "… şöyle yazmış:") null döner → satır atılır.
 */
export function enforceBroadcastLanguage(text, lang = 'tr') {
  let t = String(text || '');
  let removed = false;
  t = t.replace(QUOTE_RE, (q) => {
    const inner = q.slice(1, -1);
    const long = inner.trim().split(/\s+/).length >= 14;
    if (long || languageIssue(inner, lang)) { removed = true; return ' '; }
    return q;
  });
  t = t.replace(/\s{2,}/g, ' ').trim();
  // yarım kalan aktarma ("… şöyle yazmış:" / "… wrote:")
  if (removed && /(:|yazmış|demiş|paylaşmış|diyor ki|şöyle|wrote|said|tweeted|posted)\s*[.!…]*\s*$/i.test(t)) return null;
  if (languageIssue(t, lang)) return null;
  return t;
}

/** Geriye dönük uyumluluk: Türkçe yayın koruması. */
export function enforceSpokenTurkish(text) { return enforceBroadcastLanguage(text, 'tr'); }

/** Bölümdeki ifade zenginliğini ölçer (testler ve istatistik için). */
export function expressiveStats(lines) {
  let tags = 0; let laughs = 0; let backs = 0; let interrupts = 0; let shortLines = 0; let styled = 0;
  for (const l of lines) {
    const t = l.text || '';
    for (const m of t.matchAll(/<([^<>]+)>/g)) { tags++; if (LAUGHS.has(m[1])) laughs++; }
    backs += (t.match(/\|[^|]+\|/g) || []).length;
    if (/[—–-]\s*$/.test(t) || /^\s*[—–]/.test(t)) interrupts++;
    if (t.replace(/<[^>]+>|\|[^|]+\|/g, '').trim().split(/\s+/).length <= 5) shortLines++;
    if (l.style) styled++;
  }
  return { tags, laughs, backs, interrupts, shortLines, styled, lines: lines.length };
}
