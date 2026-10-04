// Metin yardımcıları: Türkçe normalizasyon, benzerlik ölçümü, konuşma için temizlik.

const TR_MAP = { 'ı': 'i', 'İ': 'i', 'ş': 's', 'Ş': 's', 'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u', 'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' };

export const STOPWORDS = new Set((
  // Türkçe
  've veya ile ama fakat ancak ki de da bu şu o bir iki için gibi kadar daha çok en mi mı mu mü '
  + 'ne neden nasıl hem ya yani diye olan olarak olduğu oldu olur olsun var yok her şey ise değil '
  + 'sonra önce şimdi artık hep bile sadece zaten hiç biz siz onlar ben sen onu bunu şunu bunun '
  + 'onun benim senin bizim sizin icin cok gore göre den dan ten tan nin nın nun nün in ın un ün '
  + 'mı mi bi az ki kim kime hangi şöyle böyle öyle burada orada bugün dün yarın '
  // İngilizce
  + 'the a an and or but of to in on at for with by from is are was were be been it this that '
  + 'these those as has have had not no yes you we they he she i my your our their its rt via amp'
).split(/\s+/).filter(Boolean).map(foldTr));

/** Türkçe karakterleri ASCII'ye katlar ve küçük harfe çevirir. */
export function foldTr(s) {
  return String(s || '')
    .replace(/[ıİşŞğĞüÜöÖçÇâîû]/g, (c) => TR_MAP[c] || c)
    .toLowerCase();
}

export function stripUrls(s) {
  return String(s || '').replace(/https?:\/\/\S+/gi, ' ').replace(/\bpic\.twitter\.com\/\S+/gi, ' ');
}

/** Benzerlik karşılaştırması için temiz kelime listesi. */
export function tokens(text) {
  const t = foldTr(stripUrls(text))
    .replace(/@\w+/g, ' ')
    .replace(/#/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ');
  return t.split(/\s+/).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// Yaygın Türkçe hâl/iyelik ekleri (katlanmış biçimde). Kök en az 4 harf kalacak şekilde en fazla iki kez soyulur.
const SUFFIXES = ['lerin', 'larin', 'leri', 'lari', 'ler', 'lar', 'nin', 'nun', 'den', 'dan', 'ten', 'tan', 'sini', 'sina', 'si', 'su',
  'in', 'un', 'de', 'da', 'te', 'ta', 'ye', 'ya', 'yi', 'yu', 'i', 'u', 'a', 'e'];

export function stripSuffix(w) {
  if (/^\d/.test(w)) return w;
  for (let round = 0; round < 2; round++) {
    const s = SUFFIXES.find((x) => (round === 0 || x.length > 1) && w.endsWith(x) && w.length - x.length >= 4);
    if (!s) break;
    w = w.slice(0, -s.length);
  }
  return w;
}

/** Türkçe için basit ve etkili kök bulma: ek soyma + ilk 5 karakter (F5 stemming). */
export function stems(text) {
  return tokens(text).map((w) => {
    if (/^\d+$/.test(w)) return w;
    const r = stripSuffix(w);
    return r.length > 5 ? r.slice(0, 5) : r;
  });
}

const WEAK = new Set(['yuzde', 'yeni', 'dakik', 'acikl', 'oldu', 'geldi', 'ilk', 'buyuk', 'bugun', 'yarin', 'sonra', 'once', 'gore',
  'kadar', 'sonra', 'olarak', 'olan', 'icin', 'ancak', 'hala', 'daha', 'cok', 'tum', 'butun', 'bile', 'demo', 'arti', 'sirad']);

/** Konu eşleştirmede ayırt edici kökler (en az 4 harf, sayı ve zayıf sözcükler hariç). */
export function salientStems(text) {
  return new Set(stems(text).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !WEAK.has(w)));
}

// Olay sözcükleri: iki paylaşım aynı olay türünden söz ediyorsa (ör. ikisi de "deprem") büyük olasılıkla aynı haberdir.
const EVENT_WORDS = ['deprem', 'yangin', 'patlama', 'tsunami', 'saldiri', 'heyelan', 'firtina', 'kasirga', 'sel felaketi', 'tahliye', 'catisma', 'ateskes'];

/** Aynı olay/hikâye benzerliği: konu benzerliği + ortak ayırt edici kök sayısı + olay sözcüğü. */
export function storySimilarity(a, b) {
  const fa = foldTr(a); const fb = foldTr(b);
  if (EVENT_WORDS.some((w) => fa.includes(w) && fb.includes(w))) return 0.6;
  const base = topicSimilarity(a, b);
  const A = salientStems(a); const B = salientStems(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const kw = inter >= 3 ? Math.min(0.75, 0.5 + 0.05 * (inter - 3)) : inter === 2 ? 0.34 : 0;
  return Math.max(base, kw);
}

export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Küçük kümeye göre örtüşme oranı — kısa tweet uzun tweet'in içindeyse yüksek çıkar. */
export function overlap(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

export function charShingles(text, n = 3) {
  const t = foldTr(stripUrls(text)).replace(/[^a-z0-9]+/g, ' ').trim();
  const out = new Set();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
  return out;
}

/** İki metnin aynı içerik (neredeyse kopya) olup olmadığına dair 0..1 skor. */
export function nearDuplicateScore(a, b) {
  return jaccard(charShingles(a), charShingles(b));
}

/** Aynı konu/olay benzerliği (0..1): kök örtüşmesi + karakter benzerliği karışımı. */
export function topicSimilarity(a, b) {
  const sa = new Set(stems(a));
  const sb = new Set(stems(b));
  const j = jaccard(sa, sb);
  const o = sa.size >= 3 && sb.size >= 3 ? overlap(sa, sb) : 0;
  return Math.max(j, o * 0.85, nearDuplicateScore(a, b));
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

/** Tweet metnini prompt'a koymadan önce sadeleştirir. */
export function cleanTweetText(s, max = 600) {
  let t = decodeEntities(s).replace(/https?:\/\/t\.co\/\w+/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max - 1).trimEnd() + '…';
  return t;
}

/** TTS'e gitmeyecek işaretleri temizler (tarayıcı sesi / eski TTS için). */
export function plainSpeech(text) {
  return String(text || '')
    .replace(/<[^>]{1,24}>/g, ' ')        // <laugh>, <short pause>
    .replace(/\|[^|]{1,40}\|/g, ' ')        // |hıı| tepkileri
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#*_~`]/g, '')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Eski TTS modelleri açılı etiketleri okuyabilir; parantezli tarife çevir. */
export function legacySpeech(text) {
  const map = { laugh: '(güler)', sigh: '(iç çeker)', 'short pause': '...', 'long pause': '... ...', breath: '', cough: '' };
  return String(text || '')
    .replace(/<([^>]{1,24})>/g, (_, tag) => (map[tag.trim().toLowerCase()] ?? ''))
    .replace(/\|[^|]{1,40}\|/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

export function slugify(s) {
  return foldTr(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'konu';
}

export function formatCount(n) {
  if (n == null || Number.isNaN(n)) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' Mn';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.', ',') + ' B';
  return String(n);
}

/** "12 dk önce" gibi göreli süre. */
export function relTime(ms, now = Date.now()) {
  const d = Math.max(0, Math.round((now - ms) / 60000));
  if (d < 1) return 'az önce';
  if (d < 60) return `${d} dk önce`;
  const h = Math.floor(d / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

/** Görüntülenme sayısı gibi "12,3 B" metinlerini sayıya çevirir. */
export function parseCount(s) {
  if (s == null) return 0;
  if (typeof s === 'number') return s;
  const m = String(s).replace(/\s/g, '').match(/([\d.,]+)\s*([KkMmBb]|B|Mn|Bin|Milyon)?/);
  if (!m) return 0;
  let num = m[1];
  const unit = (m[2] || '').toLowerCase();
  if (unit) num = num.replace(',', '.');
  else num = num.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
  let v = parseFloat(num);
  if (Number.isNaN(v)) return 0;
  if (unit === 'k' || unit === 'b' || unit === 'bin') v *= 1e3;
  else if (unit === 'm' || unit === 'mn' || unit === 'milyon') v *= 1e6;
  return Math.round(v);
}
