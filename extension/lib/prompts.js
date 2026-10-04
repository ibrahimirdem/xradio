// Yapay zekâ istemleri (prompt), JSON şemaları ve çıktı doğrulama.
// Program kalitesinin kalbi burası: iki DJ'in doğal, esprili ama sorumlu sohbeti.

import { CATEGORY_LABELS, MUSIC_MOODS, langInfo } from './config.js';
import { truncate, cleanTweetText, relTime, formatCount, plainSpeech } from './textutil.js';
import { normalizeExpressive, enforceBroadcastLanguage } from './expressive.js';

const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export function partOfDay(d) {
  const h = d.getHours();
  if (h < 5) return 'gece yarısından sonra';
  if (h < 11) return 'sabah';
  if (h < 13) return 'öğle';
  if (h < 17) return 'öğleden sonra';
  if (h < 21) return 'akşam';
  return 'gece';
}

export function describeTime(d) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, saat ${hh}:${mm} (${partOfDay(d)})`;
}

// ------------------------------------------------------------------ TRİYAJ

export const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tweet_id: { type: 'string' },
          story_id: { type: 'string', description: 'Mevcut hikâye kimliği ya da yeni hikâye için "yeni:kisa-ad"' },
          headline: { type: 'string' },
          summary: { type: 'string' },
          category: { type: 'string', enum: Object.keys(CATEGORY_LABELS) },
          importance: { type: 'integer', minimum: 0, maximum: 10 },
          breaking: { type: 'boolean' },
          new_development: { type: 'boolean' },
          tone: { type: 'string', enum: ['serious', 'neutral', 'light'] },
          skip: { type: 'boolean' },
        },
        required: ['tweet_id', 'story_id', 'headline', 'importance', 'breaking', 'new_development', 'tone', 'skip', 'category'],
      },
    },
  },
  required: ['items'],
};

export function buildTriageSystem(lang = 'tr') {
  const L = langInfo(lang);
  const T = L.trName.toLocaleUpperCase('tr-TR');
  return `Sen bir canlı radyo programının haber masası editörüsün. Bir dinleyicinin X (Twitter) ana akışından gelen YENİ paylaşımları ve daha önce açılmış "hikâye" dosyalarını görüyorsun. Görevin her paylaşımı sınıflandırmak.

Her paylaşım için:
- story_id: Paylaşım, listedeki mevcut bir hikâyeyle AYNI olay/konu ise o hikâyenin kimliğini yaz. Değilse yeni bir kimlik uydur: "yeni:" + 2-4 kelimelik kısa ad (ör. "yeni:faiz-karari"). Aynı partideki birden çok paylaşım aynı yeni olaya aitse hepsine aynı yeni kimliği ver. TEKRARI ÖNLEMEK EN ÖNEMLİ GÖREVİN: farklı kişiler aynı olayı paylaşıyorsa hepsi tek hikâyedir.
- headline: Hikâye için 4-9 kelimelik, tarafsız başlık; dili ${T} (radyonun yayın dili). Paylaşım başka bir dildeyse başlığı ${L.trName} diline çevirerek yaz; asla özgün dilde bırakma.
- summary: 1-2 cümlelik ${T} özet (başka dildeki paylaşımı ${L.trName} diline çevirerek özetle; paylaşımda olmayan bilgi ekleme).
- importance (0-10): 0-2 kişisel/önemsiz (günaydın, reklam, çekiliş, kendi aralarında sohbet, anlamsız şaka); 3-4 ilginç ama sıradan; 5-6 dikkate değer gündem; 7-8 geniş etkili önemli gelişme; 9-10 olağanüstü (büyük deprem/afet, savaş, devlet düzeyinde kritik karar, piyasaları sarsan gelişme).
- breaking: Radyo yayınını KESMEYİ hak eden çok nadir durumlar içindir. Sadece şu üç koşulun HEPSİ varsa true: (1) olay ani ve geniş etkili (büyük deprem/afet, büyük kaza veya saldırı, savaş/çatışma başlaması, devlet düzeyinde kritik ve beklenmedik karar, piyasaları sarsan şok); (2) paylaşım en fazla 45 dakika önce yapılmış; (3) önem 8 veya üstü. Türk haber hesapları neredeyse her paylaşıma "SON DAKİKA", "FLAŞ" yazar: bu etiket tek başına HİÇBİR ŞEY ifade etmez, içeriğe bak. Siyasi açıklama, demeç, spor sonucu, transfer, magazin, ekonomik veri beklentisi, yorum, analiz, tahmin ve eski haber asla breaking değildir. Bir partide EN FAZLA BİR hikâye breaking olabilir; çoğu partide hiç olmaz.
- new_development: Paylaşım, mevcut (daha önce anlatılmış) bir hikâyeye somut YENİ bilgi ekliyorsa true; yorum, tekrar ya da tepki ise false. Yeni hikâyelerde false.
- tone: Ölüm, afet, şiddet, hastalık, kişisel trajedi → "serious". Eğlenceli/hafif konular → "light". Diğerleri → "neutral".
- skip: Reklam, spam, sadece emoji/selamlaşma, bağlamı anlaşılmayan kısa yanıtlar → true.

Gerçekleri değiştirme, paylaşımda olmayanı ekleme. Sadece JSON döndür.`;
}

export const TRIAGE_SYSTEM = buildTriageSystem('tr');

const LANG_NAMES = { en: 'İngilizce', he: 'İbranice', iw: 'İbranice', ar: 'Arapça', fa: 'Farsça', ru: 'Rusça', uk: 'Ukraynaca', de: 'Almanca', fr: 'Fransızca', es: 'İspanyolca', it: 'İtalyanca', ja: 'Japonca', zh: 'Çince', ko: 'Korece', ku: 'Kürtçe', az: 'Azerice', el: 'Yunanca', pt: 'Portekizce', nl: 'Felemenkçe' };
export function langName(code) { const c = String(code || '').toLowerCase(); return LANG_NAMES[c] || (c ? `${c} dili` : 'bilinmeyen dil'); }

export function buildTriagePrompt({ tweets, storyIndex, now = Date.now() }) {
  const lines = [];
  lines.push('MEVCUT HİKÂYELER (son 12 saat):');
  if (!storyIndex.length) lines.push('(henüz yok)');
  for (const s of storyIndex) {
    lines.push(`- ${s.id} | ${s.covered ? 'ANLATILDI' : 'bekliyor'} | ${s.headline} — ${s.summary}`);
  }
  lines.push('');
  lines.push('YENİ PAYLAŞIMLAR:');
  for (const t of tweets) {
    const m = t.metrics || {};
    const parts = [
      `[${t.id}]`,
      `${t.author?.name || '?'} (@${t.author?.handle || '?'})${t.author?.verified ? ' ✓' : ''}`,
      relTime(t.createdAt, now),
      `${formatCount(m.likes)} beğeni, ${formatCount(m.retweets)} RT${m.views ? ', ' + formatCount(m.views) + ' görüntülenme' : ''}`,
    ];
    if (t.lang && t.lang !== 'tr') parts.push(`dil: ${langName(t.lang)}`);
    if (t.retweetedBy?.length) parts.push(`RT edenler: ${t.retweetedBy.map((r) => '@' + r.handle).join(', ')}`);
    if (t.isReply) parts.push(`yanıt: @${t.replyTo || '?'}`);
    lines.push(parts.join(' | '));
    lines.push(`  Metin: ${cleanTweetText(t.text, 500)}`);
    if (t.quoted) lines.push(`  Alıntıladığı (@${t.quoted.author?.handle || '?'}): ${cleanTweetText(t.quoted.text, 260)}`);
    if (t.media?.length) lines.push(`  Medya: ${t.media.map((x) => x.type + (x.alt ? ` (${truncate(x.alt, 80)})` : '')).join(', ')}`);
  }
  lines.push('');
  lines.push('Her YENİ PAYLAŞIM için items dizisine bir öğe ekle.');
  return lines.join('\n');
}

export function validateTriage(json, knownIds) {
  const items = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : [];
  const ok = [];
  for (const it of items) {
    if (!it || !knownIds.has(String(it.tweet_id))) continue;
    ok.push({
      tweet_id: String(it.tweet_id),
      story_id: String(it.story_id || ''),
      headline: String(it.headline || '').slice(0, 120),
      summary: String(it.summary || '').slice(0, 400),
      category: CATEGORY_LABELS[it.category] ? it.category : 'diger',
      importance: Math.max(0, Math.min(10, Math.round(Number(it.importance) || 0))),
      breaking: !!it.breaking,
      new_development: !!it.new_development,
      tone: ['serious', 'neutral', 'light'].includes(it.tone) ? it.tone : 'neutral',
      skip: !!it.skip,
    });
  }
  return ok;
}

// ------------------------------------------------------------------ YAZAR (DJ SENARYOSU)

export const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Bölümün kısa başlığı' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string', enum: ['A', 'B'] },
          text: { type: 'string', description: 'Konuşma metni; İngilizce açılı etiketler (<laugh>) ve dinleyen DJ tepkileri için |…| içerebilir' },
          style: { type: 'string', description: 'Kısa ses/duygu tarifi (Türkçe yayında Türkçe, diğer dillerde İngilizce) ya da boş' },
        },
        required: ['speaker', 'text'],
      },
    },
    covered_story_ids: { type: 'array', items: { type: 'string' } },
    music_mood: { type: 'string', enum: MUSIC_MOODS },
    memory_note: { type: 'string', description: 'Sonraki bölümler için kısa not: hangi espriler/göndermeler yapıldı' },
  },
  required: ['title', 'lines', 'covered_story_ids', 'music_mood', 'memory_note'],
};

function humorText(h) {
  if (h < 0.2) return 'Neredeyse hiç espri yok; ciddi, akıcı bir haber programı tonu.';
  if (h < 0.45) return 'Ölçülü mizah: ara sıra hafif bir gülümseten yorum.';
  if (h < 0.75) return 'Belirgin mizah: doğal takılmalar, zekice yorumlar, arada bir kelime oyunu. Ama haber önce gelir.';
  return 'Bol mizah: esprili, enerjik, birbirine takılan bir ikili; yine de haberin özü net anlaşılmalı.';
}

const LANG_EXAMPLES = {
  tr: {
    fillers: '"yani", "bak şimdi", "şey"',
    attribution: '"Ekonomist Ayşe Hanım\'ın paylaşımına göre…", "Reuters\'ın aktardığına göre…"',
    numbers: '"yüzde üç buçuk", "iki bin yirmi altı", "bin iki yüz lira"',
    short: '"Hadi ya?", "Dur dur dur…", "Ciddi misin?", "Aynen öyle.", "Yok artık!"',
    backs: '|hıı|, |evet evet|, |yok artık|, |vay|, |aynen|, |hah|, |ha ha ha|, |ciddi mi?|, |aa|',
  },
  en: {
    fillers: '"well", "I mean", "you know", "so"',
    attribution: '"According to economist Jane Doe…", "Reuters is reporting that…"',
    numbers: '"three and a half percent", "twenty twenty-six", "twelve hundred dollars"',
    short: '"No way?", "Wait, wait…", "Seriously?", "Exactly.", "Come on!"',
    backs: '|mm-hmm|, |right|, |no way|, |wow|, |exactly|, |hah|, |ha ha ha|, |really?|, |oh|',
  },
  de: {
    fillers: '"also", "naja", "weißt du"',
    attribution: '"Laut Ökonomin Anna Schmidt…", "Wie Reuters berichtet…"',
    numbers: '"dreieinhalb Prozent", "zweitausendsechsundzwanzig"',
    short: '"Echt jetzt?", "Moment mal…", "Genau.", "Nicht dein Ernst!"',
    backs: '|mhm|, |genau|, |echt?|, |wow|, |ha ha|, |ach so|',
  },
  default: {
    fillers: 'yayın dilindeki doğal dolgu sözcükleri',
    attribution: 'kaynağı yayın dilinde doğal biçimde an',
    numbers: 'yayın dilinde okunduğu gibi',
    short: 'yayın dilinde 1-5 kelimelik doğal tepkiler ("Gerçekten mi?", "Aynen." gibi)',
    backs: 'yayın dilinde kısa tepkiler (ör. "evet", "vay", "gerçekten mi?", "ha ha" karşılıkları)',
  },
};

// Ton tarifleri: Türkçe yayında Türkçe, diğer dillerde İngilizce (TTS yönetmen notlarını en iyi İngilizce anlar)
const STYLE_TEXT = {
  tr: { lang: 'Türkçe', examples: '"heyecanlı", "alaycı", "gülmeye çalışarak", "şaşkın", "fısıldayarak", "hızlı, coşkulu", "ciddi, sakin", "yumuşak, empatik"', serious: '"ciddi, sakin" / "yumuşak, empatik"', seriousBacks: '|evet|, |hıı|' },
  other: { lang: 'yayın dili ne olursa olsun İNGİLİZCE yaz', examples: '"excited", "teasing", "trying not to laugh", "surprised", "whispering", "fast, enthusiastic", "serious, calm", "soft, empathetic"', serious: '"serious, calm" / "soft, empathetic"', seriousBacks: 'yayın dilinde |evet|, |hıı| karşılıkları' },
};
export const SERIOUS_STYLE = { tr: 'ciddi, sakin', other: 'serious, calm' };

const FORMAT_EXAMPLE_TR = [
  '{"speaker":"A","text":"Ofisteki kahve makinesi yine bozulmuş |yok artık| ve resmen panik var.","style":"alaycı"}',
  '{"speaker":"B","text":"<laugh> Panik değil o, toplu kafein krizi!","style":""}',
  '{"speaker":"A","text":"Bu espriyi geçen hafta da yaptın ama.","style":""}',
  '{"speaker":"B","text":"İyi espri iki kere yapılır |hah| <chuckle> tamam, son kez.","style":""}',
  '{"speaker":"A","text":"Neyse, asıl mesele şu—","style":"heyecanlı"}',
  '{"speaker":"B","text":"—dur, tahmin edeyim: yine zam!","style":"hızlı"}',
  '{"speaker":"A","text":"<sigh> Maalesef bildin.","style":""}',
].join('\n');
const FORMAT_EXAMPLE_EN = [
  '{"speaker":"A","text":"The office coffee machine is broken again |no way| and people are genuinely panicking.","style":"teasing"}',
  '{"speaker":"B","text":"<laugh> That’s not panic, that’s a mass caffeine crisis!","style":""}',
  '{"speaker":"A","text":"You made that exact joke last week.","style":""}',
  '{"speaker":"B","text":"A good joke deserves a rerun |hah| <chuckle> okay, last time.","style":""}',
  '{"speaker":"A","text":"Anyway, the real story is—","style":"excited"}',
  '{"speaker":"B","text":"—let me guess: prices are up again!","style":"fast"}',
  '{"speaker":"A","text":"<sigh> Sadly, you nailed it.","style":""}',
].join('\n');

function interactionText(h) {
  if (h < 0.2) return 'Yine de iki kişi gibi konuşurlar: birbirine soru sorar, kısa tepkiler verir; gülme neredeyse hiç olmaz.';
  if (h < 0.45) return 'Etkileşim ölçülü: kısa tepkiler, sorular, ara sıra hafif bir gülümseme (<chuckle>).';
  if (h < 0.75) return 'Etkileşim belirgin: sık kısa karşılıklar, araya giren tepkiler, birbirine takılma ve yerinde gülmeler.';
  return 'Etkileşim çok canlı: hızlı atışmalar, bol takılma, birbirinin esprisine gerçekten gülme, ara ara söz kesme.';
}

export function buildWriterSystem(settings) {
  const A = settings.hostA; const B = settings.hostB;
  const L = langInfo(settings.language);
  const T = L.trName.toLocaleUpperCase('tr-TR');
  const ex = LANG_EXAMPLES[L.code] || LANG_EXAMPLES.default;
  const ST = L.code === 'tr' ? STYLE_TEXT.tr : STYLE_TEXT.other;
  const station = settings.stationName || 'XRadio';
  const listener = settings.listenerName ? settings.listenerName : 'dinleyici';
  return `Sen "${station}" adlı, ${L.trName} yayın yapan canlı bir radyo programının baş yazarı ve yapımcısısın. Program, dinleyicinin X (Twitter) hesabında takip ettiği kişilerin son paylaşımlarından çıkan gündemi, iki DJ'in doğal, bilgili ve esprili sohbetiyle anlatıyor. Dinleyici (${listener}) çalışırken arka planda dinliyor; programın varlık sebebi, onun sürekli X'e girip bakma ihtiyacını ortadan kaldırmak. Yani önemli olan hiçbir şeyi kaçırmamalı ama gereksiz tekrarla da yorulmamalı.

SUNUCULAR
- A = ${A.name} (kadın). ${A.persona}
- B = ${B.name} (erkek). ${B.persona}
Yıllardır birlikte yayın yapmanın verdiği rahat bir kimyaları var: lafı birbirinden kaparlar, birbirlerine takılırlar, küçük iç şakaları vardır. Birbirlerini sıkıcı biçimde onaylayıp durmazlar ("Kesinlikle!", "Çok doğru!" tekrarları yok). Birbirlerine adlarıyla hitap edebilirler.

GERÇEK BİR RADYO GİBİ
- Konuşma dili kullan: kısa cümleler, doğal duraksamalar (${ex.fillers}), virgül ve üç noktayla nefes, yarım kalan cümleler, araya girmeler. Yazı dili, madde işareti, başlık okuma yok.
- TWEET OKUMA YOK: Paylaşım metinlerini asla olduğu gibi okuma, tırnak içinde alıntılama ya da "şöyle yazmış:" diye aktarma. Her şeyi kendi cümlelerinle, bir haber spikeri gibi anlat: ne olmuş, kim söylemiş, neden önemli. Paketteki "Kaynak" metinleri senin bilgi kaynağındır, okunacak metin değildir.
- YAYIN DİLİ YALNIZCA ${T}: Tüm konuşma metinleri (text alanı) baştan sona ${L.trName} olmalı; bu talimatların Türkçe olması seni yanıltmasın. Paylaşım başka bir dildeyse içeriği ${L.trName} diline çevirerek özetle. Başka dilde cümle, ifade veya kelime söyleme (yalnızca kişi, kurum ve marka adları özgün kalabilir). ${L.script === 'latin' ? 'Latin alfabesi dışındaki harfleri (İbrani, Arap, Kiril vb.) asla yazma.' : 'Yayın dilinin kendi alfabesini kullan.'}
- Paylaşanı adıyla an (${ex.attribution}). Kullanıcı adını (@) okuma. Link, hashtag işareti, emoji okuma.
- Sayıları ${L.trName} konuşulduğu gibi yaz (${ex.numbers}).
- Paylaşımlar doğrulanmış haber değildir. Teyitsiz iddiaları "iddia ediliyor", "henüz resmi bir doğrulama yok" diye işaretle; kişisel görüşleri gerçek gibi sunma. Asla bilgi uydurma; paketin dışında bir ayrıntı ekleyeceksen bunun genel bilgi olduğu belli olsun.
- Mizah ayarı: ${humorText(settings.humor ?? 0.6)}
- Ölüm, afet, savaş, şiddet, hastalık, kişisel trajedi gibi konularda ASLA şaka yapma; sakin, empatik ve net ol. Ciddi bir haberden hafif bir konuya geçerken yumuşak bir geçiş yap.
- Tekrar etme: Önceki bölüm notlarındaki espri, kalıp ve açılışları kullanma. Her bölüme farklı gir. "Evet sevgili dinleyiciler", "Merhabalar" gibi klişelerle açma.
- Dinleyiciye arada bir adıyla, samimi biçimde seslen ama abartma.
- Müzik: Bölüm sonunda gerekirse çalacak parçanın adını doğal biçimde anons et ("…şimdi sizi 'Gece Vardiyası' ile baş başa bırakıyoruz"). Parça adını değiştirme.

ETKİLEŞİM: İKİ KİŞİ GERÇEKTEN SOHBET EDİYOR
Bu bir "sırayla metin okuma" değil; iki arkadaşın canlı, birbirine tepki veren sohbeti. ${interactionText(settings.humor ?? 0.6)}
- Ritim: Satırların çoğu TEK cümle olsun, hiçbiri iki cümleden uzun olmasın. Uzun bir bilgiyi iki kişi arasında paylaştır. Sık sık 1-5 kelimelik çok kısa karşılıklar kullan (${ex.short}). A ve B'yi katı bir sırayla konuşturma; gerektiğinde aynı kişi art arda iki satır konuşabilir.
- Hiçbir haber tek kişinin monoloğu olmasın: biri haberi açar, diğeri hemen soru sorar ya da ayrıntı ekler, ilki cevaplar, ikisi birlikte yorumlar. Bir önceki söze tepki ver, itiraz et, cümlesini tamamla, lafı kap. Birinin söylediği bir şeye birkaç satır sonra geri dön.
- Ciddi bir haberden sonraki en az iki satırda şaka ya da gülme olmaz; hafif konuya ancak yumuşak bir geçişle dönülür.
- Araya giren tepkiler (backchannel): Konuşanın satırının İÇİNE, dinleyen DJ'in kısa tepkisini dikey çizgiler arasında yaz: "Faiz yüzde otuza indi |vay| ve piyasa bunu hiç beklemiyordu |hıı| …". Çizgi içindeki söz konuşana değil, DİNLEYEN DJ'e aittir ve üst üste binerek seslendirilir. Örnek tepkiler: ${ex.backs}. Satır başına en fazla iki; bölüm boyunca 4-8 kez. Çizgilerin içine etiket koyma.
- Gülme ve şakalaşma: Biri espri yaptığında diğeri gerçekten güler: bir sonraki satırına <laugh> (komikse) ya da <chuckle> (hafif gülümseme) ile başlar veya dinlerken |ha ha ha| diye güler. Espriyi yapan bazen kendi esprisine <chuckle> eder. Birbirlerine takılırlar ("Bu espriyi geçen hafta da yapmıştın"), takılan karşılık verir. Gülmeler doğal ve yerinde olsun; bölüm başına genellikle 1-3 gülme.
- Söz kesme: Heyecanla araya girmek için cümle uzun çizgiyle yarım kalır ("Asıl ilginç olan şu—") ve diğer DJ'in satırı hemen devam eder ("—dur tahmin edeyim, yine faiz!"). Bölümde en fazla bir-iki kez.
- Duygu ve tonlama: "style" alanına satırın sesi için 1-4 kelimelik kısa tarif yaz (${ST.lang}): ${ST.examples}. Sadece gerçekten gereken satırlarda kullan; satırların çoğunda boş bırak. Kişinin yaşını, cinsiyetini, aksanını style'a yazma.
- Anlık sesler: Metnin içine, olduğu yere, İNGİLİZCE etiketlerle ve açılı parantezle ekle (yayın dili ne olursa olsun etiketler İngilizce kalır): <laugh>, <chuckle>, <giggle>, <snicker>, <sigh>, <gasp>, <whispers>, <breath>, <tsk>, <phew>, <throat-clearing>, <short pause>, <long pause>. Asla köşeli ya da Türkçe etiket yazma ([gülüyor], (güler) yok). İki etiketi yan yana koyma; etiketi kelimeler ya da noktalama ile ayır. Az ve yerinde kullan.
- Ciddi haberlerde (ölüm, afet, şiddet, hastalık) gülme etiketi ve şaka YOK. Bunun yerine <sigh>, <breath>, <short pause> ve ${ST.serious} tonu kullan; tepkiler de ciddi olsun (${ST.seriousBacks}).

BİÇİM ÖRNEĞİ (sadece biçimi göstermek için; içeriğini, kelimelerini ve esprisini KULLANMA${L.code === 'tr' || L.code === 'en' ? '' : `; örnek İngilizcedir, sen konuşmaları tamamen ${L.trName} yaz`}):
${L.code === 'tr' ? FORMAT_EXAMPLE_TR : FORMAT_EXAMPLE_EN}

ÇIKTI: Sadece istenen JSON. speaker alanı "A" (${A.name}) veya "B" (${B.name}). covered_story_ids'e gerçekten anlattığın hikâyelerin kimliklerini yaz. music_mood: konuşmadan sonra çalacak müziğin havası için öneri (${MUSIC_MOODS.join(', ')}). memory_note: bu bölümde yapılan esprileri/göndermeleri bir sonraki bölüm için tek cümleyle not et.`;
}

const LENGTHS = {
  kisa: { regular: '40-60 saniye (7-10 satır)', opener: '40-60 saniye (7-10 satır)' },
  normal: { regular: '70-100 saniye (11-16 satır)', opener: '60-90 saniye (10-14 satır)' },
  uzun: { regular: '110-150 saniye (16-22 satır)', opener: '90-120 saniye (14-18 satır)' },
};

function openerNewsBrief(c) {
  if (c.stories?.length) return 'Sonra "sen yokken neler oldu" diye aşağıdaki en önemli gelişmeleri hızlı ve akıcı biçimde, karşılıklı konuşarak anlatın. Bunlar birikmiş haberlerdir: "son dakika" gibi sunmayın; en önemlisiyle başlayın.';
  if (c.feed === 'loggedOut') return 'X hesabında oturum açılmamış görünüyor, bu yüzden akışı okuyamıyorsunuz. "Haber yok" DEMEYİN; dinleyiciye tarayıcıda x.com adresine giriş yapmasını nazikçe söyleyin, giriş yapınca gündemi anlatmaya başlayacağınızı belirtin.';
  if (c.feed === 'timeout') return 'X akışı henüz yükleniyor. "Haber yok" DEMEYİN; akışı taradığınızı, ilk gelişmeleri birazdan anlatacağınızı söyleyin ve kısa bir sohbetle müziğe geçin. Haber uydurmayın.';
  return 'Son zamanlarda takip edilen hesaplarda kayda değer yeni bir gelişme yok; bunu esprili ve kısa söyleyin, haber uydurmayın.';
}

const KIND_BRIEF = {
  opener: (c) => `BÖLÜM TÜRÜ: Yayın açılışı.\n${c.firstEver ? 'Bu programın İLK yayını: kendinizi ve programın fikrini (X\'e girmeden gündemi takip etmek) eğlenceli, kısa biçimde tanıtın.' : c.awayMinutes != null ? `Dinleyici ${c.awayMinutes > 120 ? 'uzun bir aradan' : 'kısa bir aradan'} sonra yeniden açtı (${c.awayMinutes} dakika). "Tekrar hoş geldin" havasında, farklı bir girişle başlayın.` : 'Yayına yeniden başlıyorsunuz.'} Saate ve güne uygun selamlayın. ${openerNewsBrief(c)} Uzunluk: ${c.len.opener}.`,
  regular: (c) => `BÖLÜM TÜRÜ: Gündem arası. Müzik kısıldı, yeni gelişmeleri anlatıyorsunuz. En önemli haberle başlayın, haberler arasında doğal geçişler yapın. Uzunluk: ${c.len.regular}.`,
  breaking: () => 'BÖLÜM TÜRÜ: SON DAKİKA! Müzik kesildi ve yayına acil giriyorsunuz. İlk satır doğrudan habere girsin ("Son dakika…" gibi). Ciddi, net ve sakin olun; kaynağı ve teyit durumunu belirtin; panik yaratmayın. Espri YOK. Kapanışta gelişmeleri takip edeceğinizi söyleyip müziğe dönün. Uzunluk: 25-45 saniye (5-8 satır).',
  idle: (c) => `BÖLÜM TÜRÜ: Ara sohbet. Son ${c.quietMinutes || 'birkaç'} dakikadır takip edilen hesaplarda kayda değer yeni bir şey yok. Bunu esprili bir dille söyleyin ve kısa, sıcak bir sohbet yapın: günün saati, hava, çalışan dinleyiciye küçük bir tavsiye (su içmek, mola, esneme), önceki konulara hafif bir gönderme. YENİ HABER UYDURMAYIN. Uzunluk: 20-40 saniye (4-7 satır).`,
  recap: () => 'BÖLÜM TÜRÜ: Gündem özeti. Dinleyici "neler oldu?" diye sordu ama yeni bir şey yok; son saatlerde anlatılan başlıkları hızlı bir tur halinde (her biri 1-2 cümle) özetleyin. Yeni bilgi uydurmayın. Uzunluk: 40-70 saniye.',
  hourly: () => 'BÖLÜM TÜRÜ: Saat başı özeti. Saat başı jeneriğinden sonra, son bir saatte konuşulan başlıkları 3-6 cümlede hızlıca toparlayın; ardından varsa aşağıdaki yeni haberlere geçin. Uzunluk: 40-70 saniye.',
  listener: (c) => `BÖLÜM TÜRÜ: Dinleyici mesajı. Dinleyici${c.listenerName ? ' ' + c.listenerName : ''} stüdyoya şu mesajı yazdı: "${truncate(c.message || '', 400)}". Mesajı canlı yayında okuyup içtenlikle cevap verin. Müzik isteğiyse music_mood alanını ona göre seçip "hemen geliyor" deyin. Haberlerle ilgili bir soruysa aşağıdaki bilgilere dayanarak cevap verin; bilmediğiniz şeyi uydurmayın, bilmiyorsanız açıkça söyleyin. Uzunluk: 25-60 saniye.`,
};

function storyBlock(p, i, now, L = langInfo('tr')) {
  const lines = [];
  const label = CATEGORY_LABELS[p.category] || p.category || '';
  const status = p.status === 'gelisme'
    ? `GELİŞME (bu hikâye ${p.coveredAt ? relTime(p.coveredAt, now) : 'daha önce'} anlatıldı; şimdi sadece YENİ bilgiyi anlat, eskisini tek cümleyle hatırlat)`
    : 'YENİ';
  lines.push(`[${p.id}] ${p.breaking ? '🔴 SON DAKİKA · ' : ''}${p.headline}`);
  lines.push(`  Önem: ${p.importance}/10 · ${label} · Ton: ${p.tone === 'serious' ? 'ciddi (espri yok)' : p.tone === 'light' ? 'hafif' : 'nötr'} · Durum: ${status}${p.authorsCount > 1 ? ` · ${p.authorsCount} farklı hesap paylaştı` : ''}`);
  if (p.summary) lines.push(`  Özet: ${p.summary}`);
  lines.push(`  Kaynaklar (sadece bilgi içindir; OKUMA, alıntılama, kendi cümlelerinle ${L.trName} anlat):`);
  for (const t of p.tweets) {
    const m = t.metrics || {};
    const who = `${t.author?.name || '?'}${t.author?.handle ? ' (@' + t.author.handle + ')' : ''}`;
    const meta = [relTime(t.createdAt, now), m.likes ? `${formatCount(m.likes)} beğeni` : '', t.retweetedBy?.length ? `RT: ${t.retweetedBy.map((r) => r.name || r.handle).slice(0, 3).join(', ')}` : '',
      t.lang && t.lang !== L.code && !['und', 'zxx', 'qme'].includes(t.lang) ? `${langName(t.lang)} — ${L.trName} diline çevirerek anlat` : '']
      .filter(Boolean).join(', ');
    lines.push(`   - ${who}, ${meta}: ‹${cleanTweetText(t.text, 480)}›`);
    if (t.quoted) lines.push(`     (alıntıladığı ${t.quoted.author?.name || '@' + (t.quoted.author?.handle || '?')} paylaşımı: ‹${cleanTweetText(t.quoted.text, 240)}›)`);
    if (t.media?.length) lines.push(`     (paylaşımda ${t.media.map((x) => (x.type === 'video' ? 'video' : x.type === 'gif' ? 'GIF' : 'fotoğraf') + (x.alt ? ': ' + truncate(x.alt, 80) : '')).join(', ')} var)`);
  }
  return lines.join('\n');
}

/**
 * Yazar istemini oluşturur.
 * ctx: { kind, stories(packets), now, settings, memory[], nextTrack, weather, shieldCount, quietMinutes,
 *        firstEver, awayMinutes, message, recentHeadlines[], demo }
 */
/** Bölüm türü ve mizah ayarına göre ölçülebilir etkileşim hedefi. */
export function interactionTargets(kind, humor = 0.6) {
  if (kind === 'breaking') return 'ETKİLEŞİM HEDEFİ: Ciddi ama yine iki kişilik: en az 2 kısa karşılık (ör. "Şu an bildiklerimiz şunlar."), 1-2 ciddi araya giren tepki (|evet|, |hıı|). Gülme ve şaka yok.';
  const h = Math.max(0, Math.min(1, humor));
  const short = h < 0.2 ? 2 : h < 0.45 ? 3 : h < 0.75 ? 4 : 5;
  const backs = h < 0.2 ? 2 : h < 0.45 ? 3 : h < 0.75 ? 5 : 6;
  const laughs = h < 0.2 ? '0' : h < 0.45 ? '1' : h < 0.75 ? '2-3' : '3-4';
  const cuts = h < 0.45 ? 'en fazla 1' : 'en az 1, en fazla 2';
  if (kind === 'idle') return `ETKİLEŞİM HEDEFİ: Bu kısa ara sohbetin neredeyse tamamı hızlı karşılıklardan oluşsun; ${Math.min(3, short)} kısa karşılık, ${Math.min(3, backs)} araya giren tepki, ${laughs === '0' ? 'gülme yok' : 'en az 1 gülme'}.`;
  return `ETKİLEŞİM HEDEFİ (bu bölüm için ölçülecek): en az ${short} çok kısa (1-5 kelime) karşılık satırı, en az ${backs} araya giren tepki (|…|), ${laughs} gülme (<laugh>/<chuckle>, sadece ciddi olmayan konularda), ${cuts} söz kesme (—). Satırların çoğu tek cümle.`;
}

export function buildWriterPrompt(ctx) {
  const now = ctx.now || Date.now();
  const s = ctx.settings;
  const len = LENGTHS[s.segmentLength] || LENGTHS.normal;
  const parts = [];
  parts.push((KIND_BRIEF[ctx.kind] || KIND_BRIEF.regular)({ ...ctx, len, listenerName: s.listenerName }));
  parts.push(interactionTargets(ctx.kind, s.humor ?? 0.6));
  parts.push('');
  parts.push(`ZAMAN: ${describeTime(new Date(now))}`);
  if (ctx.weather) parts.push(`HAVA: ${ctx.weather}`);
  if (s.listenerName) parts.push(`DİNLEYİCİ: ${s.listenerName}`);
  if (ctx.shieldCount && s.teaseFocusShield !== false && ctx.kind !== 'breaking') {
    parts.push(`KÜÇÜK DETAY: Dinleyici bugün ${ctx.shieldCount} kez X'i açmaya çalıştı ve odak kalkanı onu radyoya geri yolladı. Uygun düşerse (her bölümde değil!) bununla tatlı tatlı dalga geçebilirsiniz.`);
  }
  if (ctx.demo) parts.push('NOT: Şu an DEMO yayınındasınız; haberler kurgusal örnek paylaşımlardır. Bunu bölümün bir yerinde kısaca belirtin (ciddi bir haberin hemen ardından değil, hafif bir anda).');
  if (ctx.nextTrack?.kind === 'current') {
    parts.push(`MÜZİK: Arkada YouTube'dan "${cleanTitle(ctx.nextTrack.title)}"${ctx.nextTrack.artist ? ` (${ctx.nextTrack.artist})` : ''} çalıyor; konuşma bitince müzik kaldığı yerden devam edecek. Uygunsa kısaca an ama başlığı aynen okuma, doğal biçimde söyle.`);
  } else if (ctx.nextTrack) {
    parts.push(`MÜZİK: Konuşmanız bitince ${ctx.nextTrack.artist ? ctx.nextTrack.artist + ' imzalı ' : ''}"${ctx.nextTrack.title}" adlı ${ctx.nextTrack.styleLabel || ''} parça çalacak.`);
  }
  if (ctx.memory?.length) {
    parts.push('');
    parts.push('ÖNCEKİ BÖLÜMLERDEN NOTLAR (aynı espri/açılışları tekrar etme; uygunsa geri dönüş esprisi yapabilirsin):');
    for (const m of ctx.memory.slice(-6)) parts.push(`- ${m}`);
  }
  if (ctx.recentHeadlines?.length && ['recap', 'hourly', 'idle', 'listener', 'opener'].includes(ctx.kind)) {
    parts.push('');
    parts.push('DAHA ÖNCE ANLATILAN BAŞLIKLAR (tekrar haber gibi anlatma, sadece özet/gönderme için):');
    for (const h of ctx.recentHeadlines.slice(0, 10)) parts.push(`- ${h}`);
  }
  parts.push('');
  if (ctx.stories?.length) {
    parts.push('ANLATILACAK HİKÂYELER (önem sırasıyla; hepsini anlatmak zorunda değilsin, en önemlilerden başla):');
    ctx.stories.forEach((p, i) => parts.push(storyBlock(p, i, now, langInfo(s.language))));
  } else if (!['idle', 'recap', 'listener'].includes(ctx.kind)) {
    parts.push('YENİ HİKÂYE YOK. Haber uydurma.');
  }
  return parts.join('\n');
}

/** Yazar çıktısını doğrular ve normalleştirir. Geçersizse null döner. */
export function validateScript(json, { settings, storyIds = [], serious = false } = {}) {
  if (!json || typeof json !== 'object') return null;
  const raw = Array.isArray(json.lines) ? json.lines : Array.isArray(json.dialogue) ? json.dialogue : null;
  if (!raw) return null;
  const nameA = (settings?.hostA?.name || 'A').toLocaleLowerCase('tr-TR');
  const nameB = (settings?.hostB?.name || 'B').toLocaleLowerCase('tr-TR');
  const lines = [];
  const dropped = [];
  for (const l of raw) {
    if (!l) continue;
    let sp = String(l.speaker || l.host || '').trim();
    const spl = sp.toLocaleLowerCase('tr-TR');
    if (spl === 'a' || spl === nameA) sp = 'A';
    else if (spl === 'b' || spl === nameB) sp = 'B';
    else sp = lines.length && lines[lines.length - 1].speaker === 'A' ? 'B' : 'A';
    let text = String(l.text || l.line || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    // "Defne: ..." gibi isim öneklerini temizle
    text = text.replace(new RegExp(`^(${escapeRe(settings?.hostA?.name || 'A')}|${escapeRe(settings?.hostB?.name || 'B')})\\s*:\\s*`, 'i'), '');
    // Duygu etiketleri ve araya giren tepkiler: doğru biçime getir, ciddi bölümde gülmeleri kaldır
    text = normalizeExpressive(text, { serious });
    // Yayın dili koruması: tweet okuma / yabancı dilde konuşma yok
    const spoken = enforceBroadcastLanguage(text, settings?.language || 'tr');
    if (spoken == null) { dropped.push(text.slice(0, 120)); continue; }
    text = spoken;
    if (!plainSpeech(text)) continue;
    if (text.length > 700) text = text.slice(0, 700).replace(/[^.!?…]*$/, '') || text.slice(0, 700);
    let style = String(l.style || '').replace(/[<>|[\]]/g, '').trim().slice(0, 48);
    if (serious && /gül|kahkaha|laugh|neşe|şaka|joke|giggl|chuckl|amus|teas/i.test(style)) style = (settings?.language || 'tr') === 'tr' ? SERIOUS_STYLE.tr : SERIOUS_STYLE.other;
    lines.push({ speaker: sp, text, style });
  }
  if (!lines.length) return null;
  const known = new Set(storyIds);
  const covered = (Array.isArray(json.covered_story_ids) ? json.covered_story_ids : []).map(String).filter((id) => known.has(id));
  return {
    title: truncate(String(json.title || 'Gündem'), 80),
    lines: lines.slice(0, 40),
    covered,
    musicMood: MUSIC_MOODS.includes(json.music_mood) ? json.music_mood : null,
    memoryNote: truncate(String(json.memory_note || ''), 240),
    dropped,
  };
}

/** YouTube başlıklarındaki emoji ve gürültüyü temizler. */
export function cleanTitle(t) {
  return String(t || '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s*[|•·]\s*/g, ' — ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 90);
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Model çıktısından JSON'u güvenle ayıklar (kod blokları, ön/son metin). */
export function parseJsonLoose(text) {
  if (text == null) return null;
  if (typeof text === 'object') return text;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch { /* devam */ }
  const start = t.search(/[[{]/);
  if (start < 0) return null;
  const open = t[start]; const close = open === '{' ? '}' : ']';
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

/** TTS için konuşma transkripti (eski API ve tek çağrı için). */
export function transcriptFor(lines, settings) {
  return lines.map((l) => `${l.speaker === 'A' ? settings.hostA.name : settings.hostB.name}: ${l.text}`).join('\n');
}

/** TTS yönetmen notu (eski API için metnin başına eklenir). */
export function ttsDirectorNote(settings, kind) {
  const mood = kind === 'breaking' ? 'ciddi, net ve sakin bir son dakika anonsu' : 'enerjik, sıcak ve doğal bir radyo sohbeti';
  const L = langInfo(settings.language);
  return `Aşağıdaki ${L.trName} konuşmayı ${settings.hostA.name} (kadın radyo DJ'i) ve ${settings.hostB.name} (erkek radyo DJ'i) arasında ${mood} olarak seslendir. Doğal ${L.trName} telaffuz, canlı yayın ritmi:`;
}
