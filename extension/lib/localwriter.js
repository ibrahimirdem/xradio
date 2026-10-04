// Yerel (yapay zekâsız) senaryo yazarı.
// API anahtarı yokken veya Gemini geçici olarak erişilemezken radyonun susmaması için şablon tabanlı
// ama çeşitlilik içeren DJ diyalogları üretir. Yerel modda Türkçe ve İngilizce desteklenir
// (diğer yayın dillerinde İngilizce şablonlar kullanılır).

import { partOfDay } from './prompts.js';
import { cleanTweetText, truncate } from './textutil.js';
import { isForeign } from './newsdesk.js';

const recent = new Map(); // şablon grubu -> son kullanılan indeksler

function pick(group, arr, rnd = Math.random) {
  const used = recent.get(group) || [];
  let choices = arr.map((_, i) => i).filter((i) => !used.includes(i));
  if (!choices.length) choices = arr.map((_, i) => i);
  const idx = choices[Math.floor(rnd() * choices.length)];
  used.push(idx);
  while (used.length > Math.max(1, Math.floor(arr.length / 2))) used.shift();
  recent.set(group, used);
  return arr[idx];
}

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

/** Başlığı cümle içine koyarken sondaki noktalamayı at ("…açıklarında." + "." çift nokta olmasın). */
function bare(h) {
  return String(h || '').replace(/[\s.!?…:;,]+$/u, '');
}

// ------------------------------------------------------------------ İfade kitapları
const PHRASES = {
  tr: {
    greet: {
      sabah: ['Günaydın', 'Güzel bir sabaha merhaba', 'Sabahın enerjisiyle merhaba'],
      öğle: ['Tünaydın', 'Öğle saatlerinden merhaba', 'Merhabalar, öğle arası yaklaşırken'],
      'öğleden sonra': ['İyi öğleden sonralar', 'Öğleden sonra mesaisine merhaba', 'Merhaba, günün ikinci yarısına hoş geldin'],
      akşam: ['İyi akşamlar', 'Akşam yayınına hoş geldin', 'Akşamın keyfine merhaba'],
      gece: ['İyi geceler', 'Gece kuşlarına merhaba', 'Gecenin bu saatinde merhaba'],
      'gece yarısından sonra': ['Gece yarısını geçtik', 'Uykusuzlar kulübüne merhaba', 'Gecenin en sessiz saatinden merhaba'],
    },
    catIntro: {
      ekonomi: ['Ekonomi cephesinde hareket var.', 'Cüzdanları ilgilendiren bir gelişme.', 'Piyasalardan haber var.'],
      spor: ['Spor dünyasından geliyoruz.', 'Sahalardan haber var.', 'Futbolseverler kulak versin.'],
      teknoloji: ['Teknoloji tarafında yeni bir şey var.', 'Teknoloji dünyası yine boş durmuyor.', 'Yapay zekâ ve teknoloji cephesinden geliyoruz.'],
      siyaset: ['Siyaset gündeminden bir başlık.', 'Ankara kulislerinden haber var.', 'Siyasette bugün konuşulan konu şu.'],
      dunya: ['Dünyadan bir haber.', 'Sınırların ötesine bakalım.', 'Dış haberlerde öne çıkan konu şu.'],
      bilim: ['Bilim dünyasından ilginç bir haber.', 'Meraklılar için bilim köşesi.'],
      saglik: ['Sağlıkla ilgili bir gelişme var.', 'Sağlık gündeminden bir başlık.'],
      kultur: ['Kültür-sanat tarafından bir haber.', 'Sanatseverlere bir haberimiz var.'],
      magazin: ['Biraz da hafif bir konu.', 'Magazin tarafında konuşulan şey şu.'],
      gundem: ['Gündemden önemli bir başlık.', 'Türkiye gündeminden bir haber.'],
      diger: ['Akıştan dikkatimizi çeken bir paylaşım var.', 'Takip ettiğin hesaplardan biri ilginç bir şey paylaşmış.', 'Şuna bir bakalım.'],
    },
    light: {
      ekonomi: ['Hesap makinesini çıkarın, ben çıkardım bile. |hıı| Tamam, hâlâ hesaplıyorum.', 'Bunu duyunca cüzdanım biraz içine kapandı.', 'Rakamlar konuşuyor, biz de tercüme ediyoruz.'],
      spor: ['Taraftar grupları şimdiden ikiye bölünmüştür eminim.', 'Bunu maç özeti gibi anlattım farkındaysan.', 'Ben bu haberi duyunca formamı giydim, yalan yok.'],
      teknoloji: ['Yapay zekâ da bizi dinliyor olabilir, selam yapay zekâ! <laugh>', 'Yine bir güncelleme, yine bir heyecan.', 'Teknoloji o kadar hızlı ki biz konuşurken yeni sürüm çıkmıştır.'],
      default: ['Bakalım bu konu nereye gidecek.', 'Gündem dediğin böyle olur.', 'Bunu da not ettik.', 'İlginç, gerçekten ilginç.', 'Bu haber kahve molası sohbetlerine malzeme olur.'],
    },
    serious: ['Gerçekten üzücü bir gelişme. Resmi açıklamaları takip ediyoruz.', 'Konu hassas; doğrulanmış bilgiler geldikçe aktaracağız.', 'Bu tür haberlerde resmi kaynakları beklemekte fayda var.', 'Etkilenen herkese geçmiş olsun diyoruz.'],
    curious: ['Hadi ya, ne olmuş?', 'Dur dur, anlat!', 'Ciddi misin?', 'Bunu ben de merak ettim.', 'Eee, sonra?', 'Hı hı, dinliyorum.'],
    laughReplies: ['<laugh> Ha ha! Sen de her şeyden bir espri çıkarıyorsun.', '<chuckle> Tamam, bu iyiydi, kabul ediyorum.', '<laugh> Bu espriyi not ettim, bir dahakine ben yapacağım.', '<chuckle> Yine başladı… Ama haklısın.', '<laugh> Dinleyicilerimiz şu an gözlerini deviriyor, eminim.'],
    unverified: ['Tabii bu şimdilik bir paylaşım; resmi doğrulama henüz yok.', 'Henüz teyit edilmiş bir bilgi değil, altını çizelim.', 'Resmi bir açıklama gelirse hemen aktaracağız.'],
    transitions: ['Gelelim bir sonraki konuya.', 'Bu arada başka bir şey daha var.', 'Başka neler var bakalım?', 'Şimdi biraz farklı bir konuya geçelim.', 'Sıradaki başlık şu.'],
    idle: [
      ['Timeline şu an tuhaf derecede sessiz.', 'Herkes çalışıyor galiba. Ya da hepsi aynı anda kahve molasında.'],
      ['Akışta yeni bir şey yok, bunu iyi haber sayıyorum.', 'Sessizlik de bir haberdir derler. Kim der? Ben dedim şimdi. <laugh>'],
      ['Bu sakinliği fırsat bil; bir bardak su iç, omuzlarını bir gevşet.', 'Biz buradayız, bir şey olursa ilk sen duyacaksın.'],
      ['Yeni bir gelişme yok; biz de müziğin keyfini çıkaralım.', 'Ekranına dön, odaklan. Gündemi biz bekliyoruz.'],
      ['Şu an X\'te herkes birbirine günaydın yazıyor sanki, kayda değer bir şey yok.', 'O zaman sözü müziğe bırakalım.'],
    ],
    tease: ['Bu arada{listener} bugün {n} kez X\'e girmeye çalışmışsın, gördük ha! <laugh>', 'Küçük bir itiraf: odak kalkanı{listener} seni bugün {n} kez yakaladı.', 'Bugün X\'i {n} kez açmaya çalıştın{listener}. Rahat ol, biz buradayız.'],
    outros: ['Şimdi sıra “{track}” parçasında.', 'Sizi “{track}” ile baş başa bırakıyoruz.', 'Müziğe dönüyoruz: “{track}”.', 'Arkada “{track}” başlıyor, keyfini çıkar.'],
    ytOutros: ['Müzik kaldığı yerden devam ediyor.', 'Biz susuyoruz, söz yeniden müzikte.', 'Şimdi yeniden müziğe dönüyoruz; bir şey olursa buradayız.', 'Kulaklar yine müzikte. Sen işine dön, gündemi biz bekliyoruz.'],
    regOpeners: ['{station}\'da gündem arası. Neler olmuş bakalım.', 'Müziği biraz kısıyoruz, akışta yeni şeyler var.', 'Kulaklar bizde{listener}, kısa bir gündem turu.', 'Takip ettiğin hesaplar boş durmamış, toparlayalım.'],
    someone: 'Takip ettiğin bir hesap',
    foreignPost: '{who} yabancı dilde bir paylaşım yapmış.',
    foreignNote: 'Çeviri için yapay zekâ modu gerekiyor; ayrıntısını stüdyodaki haber masasında bulabilirsin.',
    development: 'Daha önce konuştuğumuz “{h}” konusunda yeni bir gelişme var.',
    sourceLikes: 'Bu bilgiyi {who} paylaşmış; şimdiden {likes} beğeni almış.',
    source: 'Bu bilgiyi {who} paylaşmış.',
    spread: 'Bu konuyu {n} farklı hesap paylaşmış, yani akışında epey konuşuluyor.',
    titleOpener: 'Yayın açılışı', titleBreaking: 'Son dakika', titleIdle: 'Ara sohbet', titleHourly: 'Saat başı özeti', titleRecap: 'Gündem özeti', titleListener: 'Dinleyici mesajı', titleRegular: 'Gündem arası',
    firstA: '{g}{listener}! {station} yayında. Ben {A}.',
    firstB: 'Ben de {B}. Bugünden itibaren X\'i senin yerine biz okuyoruz. |hıı| Sen işine bak.',
    firstA2: 'Önemli bir şey olursa müziği kısıp haber vereceğiz; aynı haberi de iki kere anlatıp başını ağrıtmayacağız.',
    welcomeBack: '{g}{listener}! {station}\'ya tekrar hoş geldin.',
    welcomeBackAlt: '{g}{listener}! {station} yeniden yayında.',
    welcomeWord: /hoş geldin/i,
    whileAway: 'Sen yokken akış boş durmadı, hemen özetleyelim.',
    loggedOut: 'Yalnız X\'te oturum açık görünmüyor; tarayıcıda x.com adresine giriş yaparsan gündemi hemen anlatmaya başlarız.',
    loading: 'Akışını şu an tarıyoruz; ilk gelişmeleri birazdan anlatacağız.',
    quietAway: 'Sen yokken pek bir şey olmamış, rahat olabilirsin.',
    weather: 'Bu arada hava durumu: {w}.',
    demo: 'Küçük bir not: şu an demo yayınındayız, haberler örnek paylaşımlardan. <laugh>',
    breakingA: 'Son dakika! Müziği kısıyoruz. {h}.',
    breakingSource: 'Bilgiyi {who} paylaştı.',
    breakingSpread: 'Aynı konuyu {n} farklı hesap aktarıyor.',
    breakingClose: 'Gelişmeleri takip ediyoruz, yeni bir bilgi gelirse hemen buradayız.',
    hourlyA: 'Saat başı, kısa bir toparlama yapalım.', recapA: 'Hızlı bir gündem turu yapalım.',
    topHeadline: 'Öne çıkan başlık: ', noHeadlines: 'Son saatlerde kayda değer bir başlık yok; akış sakin.',
    listenerA: 'Stüdyoya bir mesaj düştü{listener}: “{m}”',
    listenerMusic: 'İsteğin emrimiz! Hemen müziği ona göre ayarlıyoruz.',
    listenerInfo: 'Bununla ilgili elimizdeki en güncel bilgi şu: {info}',
    listenerMore: 'Daha fazlası gelirse ilk sana söyleyeceğiz.',
    listenerThanks: 'Mesajın için teşekkürler! Şu an bu konuda yeni bir paylaşım yok ama takipteyiz.',
    likes: (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',').replace(',0', '')} milyon` : n >= 1e3 ? `${Math.round(n / 1e3)} bin` : String(n)),
    styles: { energetic: 'enerjik', cheerful: 'neşeli', warm: 'sıcak', serious: 'ciddi, sakin', curious: 'meraklı', smiling: 'gülümseyerek', laughing: 'gülerek', teasing: 'takılarak', calm: 'sakin', relaxed: 'rahat', friendly: 'samimi', urgent: 'ciddi, net', gravely: 'ciddi' },
  },
  en: {
    greet: {
      sabah: ['Good morning', 'Morning, everyone', 'Rise and shine'],
      öğle: ['Good afternoon', 'Hello from the lunchtime show', 'Hey there, lunch break is near'],
      'öğleden sonra': ['Good afternoon', 'Hello to the afternoon shift', 'Welcome to the second half of the day'],
      akşam: ['Good evening', 'Welcome to the evening show', 'Evening, everyone'],
      gece: ['Hello, night owls', 'Evening, everyone — the late edition', 'Hi there at this late hour'],
      'gece yarısından sonra': ['We’re past midnight', 'Welcome to the insomniacs club', 'Hello from the quietest hour of the night'],
    },
    catIntro: {
      ekonomi: ['Something is moving in the economy.', 'This one affects your wallet.', 'News from the markets.'],
      spor: ['Over to the world of sport.', 'News from the pitch.', 'Sports fans, listen up.'],
      teknoloji: ['Something new in tech.', 'The tech world never sleeps.', 'From the AI and tech desk.'],
      siyaset: ['A headline from politics.', 'News from the political corridors.', 'Here’s what politics is talking about today.'],
      dunya: ['A story from around the world.', 'Let’s look beyond the border.', 'The top story in world news.'],
      bilim: ['An interesting one from science.', 'The science corner for the curious.'],
      saglik: ['A health update.', 'A headline from the health desk.'],
      kultur: ['From arts and culture.', 'Something for the art lovers.'],
      magazin: ['Something a bit lighter.', 'Here’s the showbiz chatter.'],
      gundem: ['An important headline.', 'A story from the news agenda.'],
      diger: ['A post from your feed caught our eye.', 'One of the accounts you follow shared something interesting.', 'Let’s take a look at this.'],
    },
    light: {
      ekonomi: ['Get your calculators out — I already did. |mm-hmm| Still calculating.', 'My wallet just curled up in a corner.', 'The numbers are talking, we’re just translating.'],
      spor: ['I bet the fans are already split into two camps.', 'I told that like a match recap, did you notice?', 'I put my jersey on the second I heard this one.'],
      teknoloji: ['The AI might be listening to us right now — hi, AI! <laugh>', 'Another update, another round of excitement.', 'Tech moves so fast there’s probably a new version out already.'],
      default: ['Let’s see where this goes.', 'Now that’s what I call news.', 'Noted.', 'Interesting, really interesting.', 'Perfect coffee-break conversation material.'],
    },
    serious: ['That’s genuinely sad news. We’re following the official statements.', 'It’s a sensitive story; we’ll pass on verified information as it comes in.', 'With news like this it’s worth waiting for official sources.', 'Our thoughts are with everyone affected.'],
    curious: ['No way, what happened?', 'Wait, wait, tell me!', 'Seriously?', 'I was wondering about that too.', 'And then?', 'Mm-hmm, I’m listening.'],
    laughReplies: ['<laugh> Ha ha! You find a joke in everything.', '<chuckle> Okay, that one was good, I admit it.', '<laugh> I’m stealing that joke for next time.', '<chuckle> Here we go again… but fair enough.', '<laugh> Our listeners are rolling their eyes right now, I’m sure.'],
    unverified: ['Of course, for now this is just a post — no official confirmation yet.', 'This isn’t confirmed yet, let’s be clear about that.', 'If an official statement comes, we’ll pass it on right away.'],
    transitions: ['On to the next story.', 'Meanwhile, there’s something else.', 'What else do we have?', 'Let’s switch to something different.', 'Here’s the next headline.'],
    idle: [
      ['The timeline is weirdly quiet right now.', 'Everyone must be working. Or they’re all on a coffee break at the same time.'],
      ['Nothing new in the feed, and I count that as good news.', 'They say silence is news too. Who says? I just did. <laugh>'],
      ['Use this calm moment: drink some water, relax your shoulders.', 'We’re here; if anything happens, you’ll be the first to know.'],
      ['No new developments, so let’s enjoy the music.', 'Back to your screen, stay focused. We’ve got the news covered.'],
      ['Feels like everyone on X is just saying good morning, nothing worth reporting.', 'Then let the music do the talking.'],
    ],
    tease: ['By the way{listener}, you tried to open X {n} times today — we saw that! <laugh>', 'A small confession: the focus shield caught you {n} times today{listener}.', 'You tried to open X {n} times today{listener}. Relax, we’ve got it.'],
    outros: ['Up next: “{track}”.', 'We’ll leave you with “{track}”.', 'Back to the music: “{track}”.', '“{track}” is starting — enjoy.'],
    ytOutros: ['The music picks up right where it left off.', 'We’ll stop talking, the music takes over.', 'Back to the music now; we’re here if anything happens.', 'Ears back on the music. Get back to work, we’re watching the news.'],
    regOpeners: ['News break on {station}. Let’s see what happened.', 'We’re turning the music down a little, there’s news in the feed.', 'You’re with us{listener} — a quick news round.', 'The accounts you follow have been busy, let’s catch up.'],
    someone: 'One of the accounts you follow',
    foreignPost: '{who} posted something in another language.',
    foreignNote: 'Translation needs the AI mode; you can find the details on the news desk in the studio.',
    development: 'There’s a new development in the “{h}” story we talked about earlier.',
    sourceLikes: '{who} shared this, and it already has {likes} likes.',
    source: '{who} shared this.',
    spread: '{n} different accounts posted about this, so it’s a big topic in your feed.',
    titleOpener: 'Show opening', titleBreaking: 'Breaking news', titleIdle: 'Quick chat', titleHourly: 'Top of the hour', titleRecap: 'News recap', titleListener: 'Listener message', titleRegular: 'News break',
    firstA: '{g}{listener}! {station} is on air. I’m {A}.',
    firstB: 'And I’m {B}. From today on, we read X for you. |mm-hmm| You get on with your work.',
    firstA2: 'If something important happens we’ll turn the music down and tell you — and we’ll never tell you the same story twice.',
    welcomeBack: '{g}{listener}! Welcome back to {station}.',
    welcomeBackAlt: '{g}{listener}! {station} is back on air.',
    welcomeWord: /welcome/i,
    whileAway: 'The feed was busy while you were away, let’s catch up.',
    loggedOut: 'It looks like you’re not logged in to X; log in at x.com in this browser and we’ll start the news right away.',
    loading: 'We’re scanning your feed right now; the first stories are coming up shortly.',
    quietAway: 'Not much happened while you were away, you can relax.',
    weather: 'By the way, the weather: {w}.',
    demo: 'A quick note: this is a demo broadcast, the stories are sample posts. <laugh>',
    breakingA: 'Breaking news! We’re turning the music down. {h}.',
    breakingSource: 'The report was shared by {who}.',
    breakingSpread: '{n} different accounts are reporting the same thing.',
    breakingClose: 'We’re following the developments and we’ll be right back with any new information.',
    hourlyA: 'It’s the top of the hour, let’s do a quick round-up.', recapA: 'Let’s do a quick news round.',
    topHeadline: 'Top story: ', noHeadlines: 'Nothing major in the last few hours; the feed is calm.',
    listenerA: 'We have a message in the studio{listener}: “{m}”',
    listenerMusic: 'Your wish is our command! Adjusting the music right now.',
    listenerInfo: 'Here’s the latest we have on that: {info}',
    listenerMore: 'If we hear more, you’ll be the first to know.',
    listenerThanks: 'Thanks for the message! There’s nothing new on that right now, but we’re on it.',
    likes: (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.0', '')} million` : n >= 1e3 ? `${Math.round(n / 1e3)} thousand` : String(n)),
    styles: { energetic: 'energetic', cheerful: 'cheerful', warm: 'warm', serious: 'serious, calm', curious: 'curious', smiling: 'smiling', laughing: 'laughing', teasing: 'teasing', calm: 'calm', relaxed: 'relaxed', friendly: 'friendly', urgent: 'serious, clear', gravely: 'serious' },
  },
};

function moodFromMessage(msg) {
  const t = (msg || '').toLocaleLowerCase('tr-TR');
  if (/caz|jazz|swing/.test(t)) return 'groovy';
  if (/house|dans|dance|enerji|energy|hareketli|upbeat|coşku|cosku|tempo/.test(t)) return 'upbeat';
  if (/synth|80|retro|karanlık|dark|gerilim/.test(t)) return 'tense';
  if (/ambient|odak|focus|sessiz|quiet|sakin|calm|rahatla|relax/.test(t)) return 'dreamy';
  if (/lofi|lo-fi|chill|hafif/.test(t)) return 'chill';
  return null;
}

/** Yerel senaryo üretir. Dönüş biçimi validateScript çıktısıyla aynıdır. */
export function writeLocalScript(ctx) {
  const now = ctx.now || Date.now();
  const s = ctx.settings;
  const lang = s.language === 'tr' ? 'tr' : 'en';
  const P = PHRASES[lang];
  const ST = P.styles;
  const A = s.hostA.name; const B = s.hostB.name;
  const listener = s.listenerName ? `, ${s.listenerName}` : '';
  const lines = [];
  const say = (speaker, text, style = '') => lines.push({ speaker, text, style });
  const covered = [];
  let lead = Math.random() < 0.5 ? 'A' : 'B';
  const other = (x) => (x === 'A' ? 'B' : 'A');
  const humor = s.humor ?? 0.6;
  const station = s.stationName || 'XRadio';
  const g = (k) => `${lang}:${k}`; // şablon grubu anahtarı (dil başına ayrı tekrar hafızası)
  let title = P.titleRegular;
  let musicMood = null;

  const storyLines = (p, idx) => {
    const t0 = p.tweets[0];
    const second = other(lead);
    const who = t0?.author?.name || P.someone;
    if (idx > 0) say(lead, pick(g('trans'), P.transitions));
    // Yerel modda çeviri yapılamaz: yayın dilinden farklı dildeki paylaşım okunmaz
    if ((p.foreign && lang === 'tr') || (t0 && isForeign(t0, lang))) {
      say(lead, fill(P.foreignPost, { who }));
      say(second, P.foreignNote, ST.friendly);
      covered.push(p.id);
      lead = other(lead);
      return;
    }
    if (p.status === 'gelisme') say(lead, fill(P.development, { h: bare(p.headline) }), ST.curious);
    else say(lead, `${pick(g('cat-' + p.category), P.catIntro[p.category] || P.catIntro.diger)} ${bare(p.headline)}.`);
    if (t0) {
      // Ara sıra dinleyen DJ merakla araya girer (gerçek sohbet hissi)
      if (p.tone !== 'serious' && Math.random() < 0.35 + humor * 0.3) say(second, pick(g('curious'), P.curious), ST.curious);
      // Tweet okunmaz; sadece kaynak ve yayılma söylenir
      const likes = t0.metrics?.likes || 0;
      say(second, likes > 1000 ? fill(P.sourceLikes, { who, likes: P.likes(likes) }) : fill(P.source, { who }));
    }
    if (p.authorsCount > 2) say(lead, fill(P.spread, { n: p.authorsCount }));
    if (p.tone === 'serious') {
      say(second, pick(g('serious'), P.serious), ST.serious);
    } else {
      if (humor > 0.35) {
        say(second, pick(g('light-' + p.category), P.light[p.category] || P.light.default), ST.smiling);
        // Diğer DJ espriye güler ve takılır
        if (Math.random() < humor * 0.7) say(lead, pick(g('laugh'), P.laughReplies), ST.laughing);
      }
      if (p.importance >= 6 && Math.random() < 0.5) say(lead, pick(g('unv'), P.unverified));
    }
    covered.push(p.id);
    lead = other(lead);
  };

  const outro = () => {
    if (ctx.nextTrack?.kind === 'current') say(lead, pick(g('outro-yt'), P.ytOutros), ST.warm);
    else if (ctx.nextTrack?.title) say(lead, fill(pick(g('outro'), P.outros), { track: ctx.nextTrack.title }), ST.warm);
  };

  const maybeTease = () => {
    if (ctx.shieldCount >= 2 && s.teaseFocusShield !== false && Math.random() < 0.5) {
      say(other(lead), fill(pick(g('tease'), P.tease), { listener, n: ctx.shieldCount }), ST.teasing);
    }
  };

  switch (ctx.kind) {
    case 'opener': {
      title = P.titleOpener;
      const greet = pick(g('greet'), P.greet[partOfDay(new Date(now))] || P.greet.akşam);
      const vars = { g: greet, listener, station, A, B };
      if (ctx.firstEver) {
        say('A', fill(P.firstA, vars), ST.energetic);
        say('B', fill(P.firstB, vars), ST.cheerful);
        say('A', P.firstA2);
      } else {
        say('A', fill(P.welcomeWord.test(greet) ? P.welcomeBackAlt : P.welcomeBack, vars), ST.warm);
        if (ctx.stories?.length) say('B', P.whileAway);
      }
      // Haber yoksa nedenini doğru söyle: akış yükleniyor / X oturumu kapalı / gerçekten sakin
      if (!ctx.stories?.length) {
        if (ctx.feed === 'loggedOut') say('B', P.loggedOut, ST.friendly);
        else if (ctx.feed === 'timeout') say('B', P.loading, ST.calm);
        else say('B', P.quietAway);
      }
      if (ctx.weather) say('B', fill(P.weather, { w: ctx.weather }));
      if (ctx.demo) say('A', P.demo);
      lead = 'A';
      (ctx.stories || []).slice(0, 3).forEach(storyLines);
      maybeTease();
      outro();
      break;
    }
    case 'breaking': {
      title = P.titleBreaking;
      const p = ctx.stories?.[0];
      if (p) {
        say('A', fill(P.breakingA, { h: bare(p.headline) }), ST.urgent);
        const t0 = p.tweets[0];
        if (t0) say('B', fill(P.breakingSource, { who: t0.author?.name || P.someone }), ST.gravely);
        if (p.authorsCount > 1) say('A', fill(P.breakingSpread, { n: p.authorsCount }), ST.gravely);
        say('A', pick(g('unv'), P.unverified), ST.calm);
        say('B', P.breakingClose, ST.calm);
        covered.push(p.id);
      }
      musicMood = 'chill';
      break;
    }
    case 'idle': {
      title = P.titleIdle;
      const pair = pick(g('idle'), P.idle);
      say(lead, pair[0], ST.relaxed);
      say(other(lead), pair[1], ST.smiling);
      maybeTease();
      outro();
      break;
    }
    case 'recap':
    case 'hourly': {
      title = ctx.kind === 'hourly' ? P.titleHourly : P.titleRecap;
      say('A', ctx.kind === 'hourly' ? P.hourlyA : P.recapA, ST.energetic);
      const heads = (ctx.recentHeadlines || []).slice(0, 5);
      if (heads.length) heads.forEach((h, i) => say(i % 2 ? 'A' : 'B', `${i === 0 ? P.topHeadline : ''}${bare(h)}.`));
      else say('B', P.noHeadlines);
      (ctx.stories || []).slice(0, 2).forEach((p, i) => storyLines(p, i + 1));
      outro();
      break;
    }
    case 'listener': {
      title = P.titleListener;
      say('A', fill(P.listenerA, { listener, m: truncate(ctx.message || '', 200) }), ST.cheerful);
      musicMood = moodFromMessage(ctx.message);
      if (musicMood) {
        say('B', P.listenerMusic, ST.energetic);
      } else if (ctx.stories?.length) {
        const p = ctx.stories[0];
        say('B', fill(P.listenerInfo, { info: p.summary || p.headline }));
        say('A', P.listenerMore);
      } else {
        say('B', P.listenerThanks, ST.friendly);
      }
      outro();
      break;
    }
    default: {
      title = ctx.stories?.[0]?.headline ? truncate(ctx.stories[0].headline, 60) : P.titleRegular;
      say(lead, fill(pick(g('reg-open'), P.regOpeners), { station, listener }), ST.energetic);
      (ctx.stories || []).slice(0, 4).forEach(storyLines);
      maybeTease();
      outro();
    }
  }
  return { title, lines, covered, musicMood, memoryNote: '', local: true };
}

// Testler için
export { PHRASES, cleanTweetText };
