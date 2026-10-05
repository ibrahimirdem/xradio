# 📻 XRadio — Ayrıntılı teknik belge (Türkçe)

> Kısa tanıtım ve kurulum için: [README](../README.md) · [Türkçe README](../README.tr.md)

**X'e girip durmadan gündemde kal.** XRadio, Edge (ve Chrome) için bir tarayıcı eklentisidir. X (Twitter) ana akışını senin yerine arka planda okur. Arkada YouTube'dan müzik çalarken iki yapay zekâ DJ'i — **Defne** ve **Kaan** — önemli bir gelişme gördüğünde müziği kısar ve konuyu gerçek bir radyo programındaki gibi, karşılıklı ve esprili bir sohbetle anlatır. Aynı haberi tekrar tekrar anlatmaz. Sen de işine bakarsın.

---

## Neler yapıyor?

| | |
|---|---|
| 🎙 **İki DJ, gerçek sohbet** | Gemini'nin çok konuşmacılı ses modeli (`gemini-3.8-flash-tts`) ile kadın ve erkek DJ tek akışta, doğal sırayla konuşur: lafı birbirinden kapar, güler, birbirine takılır. Kişilikleri, adları ve sesleri (30 ses) ayarlanabilir. |
| 🧠 **Haber masası** | Akıştan gelen paylaşımlar yapay zekâyla **hikâyelere** ayrılır. Aynı olayı anlatan farklı hesaplar tek hikâyede birleşir. Önem puanı (0–10), kategori ve ton (ciddi/hafif) belirlenir. Reklam, "günaydın", çekiliş gibi paylaşımlar elenir. |
| 🔁 **Tekrar yok** | Anlatılan hikâye hafızaya alınır. Ancak **gerçekten yeni bir gelişme** gelirse ve en az 25 dakika geçmişse kısaca güncellenir; DJ'ler eskisini tek cümleyle hatırlatır. |
| 🔴 **Son dakika** | Gerçekten acil ve geniş etkili bir olayda (deprem gibi) müzik kesilir, son dakika jeneriği çalar, DJ'ler ciddi ve sakin bir tonla yayına girer. Bu tür haberlerde espri yapılmaz. Sadece son 45 dakikadaki paylaşımlar son dakika olabilir. Aynı anda en fazla bir son dakika verilir ve iki son dakika arasında en az 10 dakika olur. Haber hesaplarının her paylaşıma yazdığı "SON DAKİKA" etiketi tek başına yetmez. |
| 🌐 **Tek yayın dili, tweet okuma yok** | DJ'ler paylaşımları okumaz ve alıntılamaz; haberi kendi cümleleriyle, seçtiğin yayın dilinde anlatır. Başka dildeki paylaşımlar (İngilizce, İbranice…) o dile çevrilerek özetlenir. Yabancı harf ya da başka dilde cümle içeren satırlar bir koruma süzgeciyle seslendirmeden önce ayıklanır. |
| 🗣 **15 dil** | İlk kurulumda yayın dili tarayıcının dilinden gelir (Türkçe tarayıcıda Türkçe). Başlangıç ekranında ya da Ayarlar → 🌐 Dil'den değiştirebilirsin: Türkçe, English, Deutsch, Français, Español, Italiano, Português, Nederlands, Azərbaycanca, Русский, Українська, العربية, فارسی, 日本語, 한국어. Arayüz Türkçe ya da İngilizce'dir. Yerel mod (anahtarsız) Türkçe ve İngilizce konuşur; diğer diller Gemini anahtarı ister (✦). |
| 🎬 **Doğru açılış** | Radyo açıldığında X'ten ilk veri gelene kadar müzik çalar (en fazla ~75 sn). Sonra birikmiş haberler "sen yokken neler oldu" diye tek seferde anlatılır. Akış hâlâ yükleniyorsa ya da X oturumu kapalıysa DJ'ler "haber yok" demez, durumu söyler. |
| 🎵 **YouTube müziği** | Canlı yayın (Lofi Girl, caz, synthwave, deep house…) ya da oynatma listesi, ek sekme açmadan arka planda çalar. Kendi YouTube bağlantını da verebilirsin. DJ konuşurken ses yumuşakça kısılır. |
| 🕐 **Radyo ritmi** | Açılışta "sen yokken neler oldu" özeti, belirli aralıklarla gündem araları, saat başı bip sesleri ve kısa toparlama, akış sessizse kısa bir ara sohbet (su içmeyi, mola vermeyi hatırlatırlar). |
| 💬 **Stüdyoya mesaj** | "Deprem hakkında son durum ne?" ya da "biraz caz çalın" yaz; DJ'ler mesajını canlı yayında okuyup cevaplar. |
| 🛡 **Odak kalkanı** | X'i kendin açarsan akış yerine radyonun durumu, bugün konuşulan başlıklar ve "bugün X'i açma denemen: 4" ekranı çıkar. DJ'ler de buna ara sıra tatlı tatlı takılır. Tek bir paylaşım bağlantısını açtığında kalkan araya girmez. |
| 🗂 **Stüdyo** | Canlı altyazı, haber masası (bekleyen/anlatılan hikâyeler, kaynak paylaşımlara bağlantılar), yayın geçmişi (transkriptler), ayarlar ve sistem testi. |
| 🆓 **Anahtarsız da çalışır** | Gemini anahtarı yoksa yerel mod devrededir: kurallarla haber kümeleme, şablonlu Türkçe ya da İngilizce diyaloglar ve Edge'in sesleri (ör. Emel / Ahmet). |

### DJ'ler nasıl bu kadar gerçekçi konuşuyor?

Gemini 3.8 Flash TTS'in ifade özellikleri kullanılıyor ([belgeler](https://ai.google.dev/gemini-api/docs/speech-generation)):

- **Birbirine tepki:** Biri konuşurken diğeri araya `|yok artık|`, `|hıı|`, `|ha ha ha|` gibi kısa tepkilerle girer. Bunlar dinleyen DJ'in sesiyle, **üst üste binerek** seslendirilir.
- **Gülme ve duygular:** Birinin esprisine diğeri `<laugh>` ya da `<chuckle>` ile gerçekten güler. `<sigh>`, `<gasp>`, `<whispers>`, `<tsk>`, `<phew>`, `<short pause>` gibi anlık sesler, Türkçe metin içinde **İngilizce ve açılı parantezle** yazılır; Google'ın önerdiği biçim budur. Eski köşeli biçim (`[laughing]`) yalnızca 2.5 modelleri içindir ve XRadio gerektiğinde otomatik çevirir.
- **Tonlama:** Gerektiğinde satıra kısa bir ton tarifi eklenir (`"alaycı"`, `"gülmeye çalışarak"`, `"ciddi, sakin"`).
- **Gerçek sohbet ritmi:** Kısa atışmalar ("Hadi ya?"), söz kesme ("Asıl mesele şu—" / "—dur tahmin edeyim!"), birbirine takılma, önceki esprilere geri dönme.
- **Tek parça seslendirme:** Bir gündem arası tek çağrıda seslendirilir; böylece konuşma sırası, gülmeler ve araya girmeler kesintisiz akar.
- **Sorumluluk:** Ölüm, afet gibi ciddi haberlerde gülme etiketleri otomatik ayıklanır, ton "ciddi, sakin"e çekilir.
- **Altyazı:** Stüdyoda etiketler "(güler)" olarak, araya giren tepkiler de dinleyen DJ'in adıyla küçük balonlarla gösterilir.

Mizah seviyesi ayarı bu etkileşimin yoğunluğunu da belirler: "ciddi"de neredeyse hiç gülme olmaz, "çok esprili"de hızlı atışmalar ve bol takılma olur.

---

## Kurulum (Microsoft Edge)

1. Edge'de adres çubuğuna `edge://extensions` yaz.
2. Sol alttaki **Geliştirici modu**nu aç.
3. **Paketlenmemiş öğe yükle**'ye tıkla ve bu projedeki **`extension`** klasörünü seç.
4. Araç çubuğundaki yapboz simgesinden XRadio'yu sabitle. Kurulumdan sonra **Başlangıç** sayfası kendiliğinden açılır.

> Chrome'da da aynı şekilde çalışır (`chrome://extensions`).

### İlk ayarlar

1. **🌐 Yayın dili:** Başlangıç ekranının ilk adımı. Tarayıcının dilinden algılanmış olarak gelir; istersen listeden başka bir dil seç (sayfa o dile göre yenilenir). Dili onaylamadan açılır pencereyi açarsan üstte "Yayın dili: … · Değiştir · Tamam" şeridi çıkar.
2. **X hesabın bu tarayıcıda açık olsun** (x.com'a bir kez giriş yapman yeterli).
3. **Gemini API anahtarı** (isteğe bağlı ama önerilir): [aistudio.google.com/apikey](https://aistudio.google.com/apikey) adresinden ücretsiz alıp Başlangıç ya da Ayarlar sayfasına yapıştır. **Anahtarı dene** düğmesi anahtarı doğrular ve hesabında açık olan en yeni modelleri gösterir.
4. **Müzik** seç: hazır yayınlardan birini ya da kendi YouTube bağlantını.
5. **▶ Yayını başlat**.

X hesabını bağlamadan denemek için **🧪 Demo yayınıyla dene** düğmesini kullan. Demo modunda haberler kurgusaldır ve DJ'ler bunu söyler.

---

## Kullanım

- **Açılır pencere** (araç çubuğu simgesi): başlat/durdur, "şimdi anlat", atla, ses ayarları, canlı altyazı, son konuşulanlar.
- **Stüdyo** (⚙ simgesi): tüm ayrıntılar.
- **Kısayollar:** `Alt+Shift+R` başlat/durdur · `Alt+Shift+G` gündemi şimdi anlat · `Alt+Shift+N` atla (konuşmayı ya da parçayı). Kısayolları `edge://extensions/shortcuts` sayfasından değiştirebilirsin.

Radyo çalışırken X'i okumak için **sabitlenmiş küçük bir x.com sekmesi** açılır ve birkaç dakikada bir yenilenir. O sekme bile seni radyoya yönlendiren bir "dinleme noktası" ekranı gösterir. Radyoyu durdurduğunda sekme kapanır.

> Toplayıcı, "Takip edilenler" akışını okumak için o sekmede **Takip ediliyor** sekmesine geçer. X son seçtiğin sekmeyi hatırladığı için X'i kendin açtığında da bu sekme seçili gelebilir.

**Gerçek X ile doğrulandı (4 Ekim 2026, Edge 154):** X'in web uygulaması zaman tünelini `HomeLatestTimeline` GraphQL isteğiyle (XHR) yüklüyor. XRadio bu yanıtı okuyarak tek seferde ~85 paylaşım çıkardı ve 12 reklamı eledi; retweet, alıntı ve uzun yazıları doğru işledi. Sayfa yapısından okuyan yedek yol da aynı akışta çalıştı.

### Önemli ayarlar

| Ayar | Ne işe yarar |
|---|---|
| Konuşma sıklığı | Az (≈12 dk) / Normal (≈7 dk) / Sık (≈4 dk) |
| Son dakika eşiği | Bu önemin üstündeki *yeni ve acil* olaylar yayını keser (varsayılan 8/10) |
| Anlatılacak en düşük önem | Bunun altındaki hikâyeler anlatılmaz (varsayılan 4/10) |
| Sessize alınan kelimeler | "kripto", "bahis", "@hesap"… bunları içeren paylaşımlar hiç alınmaz |
| Öncelikli hesaplar/kelimeler | Bunların paylaşımları daha önemli sayılır |
| Mizah seviyesi | Ciddi haber programından esprili sabah kuşağına |
| YouTube oynatma yöntemi | Otomatik (sekmesiz; gerekirse sekme) · Sadece gömülü · YouTube sekmesinde (Premium hesabınla reklamsız) |
| Şehir | DJ'ler hava durumundan bahseder (Open-Meteo, anahtarsız) |
| Yayın dili | DJ'lerin konuştuğu ve başlıkların yazıldığı dil; değiştirince varsayılan DJ kişilikleri de o dile uyarlanır |

---

## Nasıl çalışıyor?

```
 x.com (sabit sekme)                       Arka plan (servis çalışanı)              Gizli ses belgesi (offscreen)
 ┌──────────────────────┐  tweet JSON +    ┌───────────────────────────┐  gelen   ┌─────────────────────────────────────┐
 │ x-hook.js: uygulamanın│  sayfa yapısı    │ ayrıştır → IndexedDB       │  kutusu  │ İstasyon                              │
 │ kendi yanıtlarını okur│ ───────────────▶ │ toplayıcıyı yenile (alarm) │ ───────▶ │  Haber masası: triyaj (Gemini)        │
 │ x-collector.js: DOM + │                  │ YouTube Referer kuralı     │          │   → hikâye, önem, son dakika, hafıza  │
 │ odak kalkanı          │                  │ kısayollar, rozet          │          │  Yayın saati: ne zaman konuşulacak    │
 └──────────────────────┘                  └───────────────────────────┘          │  Yazar (Gemini) → iki DJ senaryosu    │
                                                                                    │  Ses (Gemini TTS, çok konuşmacılı)    │
   Açılır pencere / Stüdyo  ◀──── olaylar (durum, altyazı, pano) ─────────────────── │  Mikser: müzik kısma, limiter, jenerik│
                                                                                    │  YouTube oynatıcı (gömülü, sekmesiz)  │
                                                                                    └─────────────────────────────────────┘
```

- **Gemini API:** Google'ın 2026'da önerdiği **Interactions API** (`POST /v1beta/interactions`) kullanılır; hesap ya da model bunu desteklemezse otomatik olarak klasik `generateContent` API'sine geçilir. Metin modeli JSON şemalı çıktı üretir, TTS çok konuşmacılı tek çağrıda iki DJ'i seslendirir (`<laugh>`, `<short pause>`, `|hıı|` gibi doğal ses işaretleriyle). Gemini'ye ulaşılamazsa o bölüm yerel yazar ve tarayıcı sesiyle yayınlanır; radyo susmaz.
- **Modeller:** "En yeni modelleri otomatik seç" açıkken hesabındaki en yeni Flash metin/TTS modelleri bulunur (varsayılanlar: `gemini-3.8-flash`, `gemini-3.8-flash-tts`).
- **YouTube:** Eklenti sayfalarına gömülen YouTube oynatıcısı Referer başlığı olmadan "Hata 153" veriyor. XRadio yalnızca kendi ses belgesinin istekleri için bir `declarativeNetRequest` oturum kuralı ekleyerek bunu çözer; oynatıcı IFrame API'nin `postMessage` protokolüyle (harici betik yüklemeden) yönetilir. Gömmeye izin vermeyen bir bağlantıda otomatik olarak sabitlenmiş bir YouTube sekmesine geçilir.

### Gizlilik

- Her şey **senin tarayıcında** çalışır; XRadio'nun bir sunucusu yoktur.
- X'te hiçbir şey paylaşmaz, beğenmez, yazmaz; sadece ana akışında zaten gördüğün paylaşımları okur.
- Gemini anahtarı girdiysen, sınıflandırma ve senaryo için paylaşım metinleri **senin anahtarınla** Google Gemini API'sine gönderilir (`store: false`). Anahtarsız modda hiçbir veri dışarı çıkmaz.
- API anahtarı sadece bu tarayıcıda (`chrome.storage.local`) saklanır; senkronize edilmez, sistem testi raporuna girmez.
- Toplanan paylaşımlar en fazla ~30 saat, yayın geçmişi 7 gün tutulur. Ayarlar → **Hafızayı temizle** ile hepsini silebilirsin.

### Maliyet (Gemini)

Normal konuşma sıklığında saatte yaklaşık 8–10 ara, her ara için 1 senaryo + 2–3 TTS çağrısı ve yeni paylaşımlar için birkaç triyaj çağrısı yapılır. Stüdyo'daki istatistik kartları bugünkü çağrı ve token sayısını gösterir. Maliyeti azaltmak için konuşma sıklığını "Az" yap ya da ara uzunluğunu kısalt.

---

## Sorun giderme

Önce **Stüdyo → 🩺 Sistem testi → Testleri çalıştır**. Ses motoru, Türkçe sesler, müzik, X toplayıcı, Gemini anahtarı/metin/ses her biri yeşil-kırmızı raporlanır. **Raporu kopyala** ile paylaşabilirsin (anahtar içermez).

| Belirti | Çözüm |
|---|---|
| "X girişi gerekli" | x.com'a bu tarayıcıda giriş yap, radyoyu yeniden başlat. |
| Hiç haber gelmiyor | Sabitlenmiş x.com sekmesinin açık olduğunu kontrol et; Ayarlar'da yenileme aralığını kısalt. X arayüzü değişirse toplayıcı hem uygulama verisini hem sayfa yapısını dener. |
| YouTube çalmıyor | Bazı videolar gömülü oynatmaya kapalıdır. XRadio otomatik olarak sonraki hazır yayına ya da sekme moduna geçer. "YouTube oynatma yöntemi"ni "YouTube sekmesinde" yapabilirsin. Hiçbiri olmazsa yerleşik yedek müzik çalar. |
| DJ sesi robotik | Gemini anahtarı yoksa tarayıcı sesi kullanılır. Edge'in "Microsoft Emel/Ahmet Online (Natural)" sesleri internetle çalışır; Windows'ta Türkçe konuşma paketi eklemek de yardımcı olur. |
| "Ses başlatılamadı" | Stüdyo sayfasında "Yayını başlat"a bir kez daha tıkla. |

---

## Geliştirici notları

```bash
npm install           # yalnızca testler için (Playwright)
npm test              # birim testleri (Node)
npm run test:e2e      # uçtan uca: eklentiyi Chromium'a yükler, sahte Gemini + sahte x.com ile tüm yayını çalıştırır
npm run mock          # sahte Gemini sunucusu (http://127.0.0.1:8787)
npm run test:live     # gerçek Gemini'ye karşı küçük canlı test (aşağıya bak)
```

**Uçtan uca testi gerçek Google Chrome'da çalıştırmak:** `BROWSER=chrome npm run test:e2e`. Chrome 137+ komut satırından eklenti yüklemeyi kapattığı için betik, eklentiyi DevTools protokolüyle (`Extensions.loadUnpacked`) ayrı bir geçici profile yükler. Playwright'ın kendi Chromium'unda H.264 olmadığından YouTube canlı yayınları yalnızca gerçek Chrome/Edge'de çalar; `YT_URL=https://www.youtube.com/watch?v=rFZHOHl-L8A` ile canlı yayın denenebilir.

**Canlı Gemini testi:** Proje kökünde `.env.local` dosyası oluştur ve içine `GEMINI_API_KEY=...` satırını yaz (dosya git'e girmez). `npm run test:live` komutu model listesini çeker, kurgusal demo paylaşımlarını gerçek triyajdan geçirir, iki DJ'lik bir senaryo yazdırır ve ilk bölümleri çok konuşmacılı sesle `tests/e2e/out/live-dj-*.wav` dosyalarına kaydeder. Toplam 4-5 API çağrısı yapar. `LANG_CODE=en npm run test:live` ile başka bir yayın dilinde (ör. İngilizce) denenebilir. AI Studio Mayıs 2026'dan beri `AQ.…` ile başlayan yeni anahtarlar veriyor (eski `AIza…` anahtarları Eylül 2026'dan beri reddediliyor); XRadio anahtarı `x-goog-api-key` başlığıyla gönderdiği için yeni biçimle çalışır.

- `extension/` — eklentinin kendisi (derleme adımı yok, saf ES modülleri).
  - `background.js` servis çalışanı · `ui/offscreen.js` ses belgesi · `lib/station.js` yayın beyni
  - `lib/newsdesk.js` hikâye kümeleme ve tekrar önleme · `lib/prompts.js` DJ istemleri ve şemalar · `lib/gemini.js` API istemcisi
  - `audio/` mikser, jenerikler, YouTube oynatıcı, yerleşik yedek müzik motoru
  - `content/` X ve YouTube içerik betikleri
- `extension/ui/i18n.js` — arayüz çevirileri (anahtar Türkçe metnin kendisi; Türkçe dışındaki her dilde İngilizce arayüz). `node tools/i18n-keys.mjs` eksik çevirileri listeler; birim testi de aynı denetimi yapar.
- **Tasarım:** `extension/ui/base.css` tasarım token'larını (renk, yazı, köşe) ve bileşenleri tanımlar; "yayın konsolu" dili: sıcak nötr yüzeyler, tek vurgu rengi (sinyal turuncusu `--accent`), monospace etiketler, açık/koyu tema. İkonlar [Phosphor](https://phosphoricons.com) setinden (MIT) `npm run icons` ile `extension/ui/icons.js` ve `extension/content/shield-icons.js` dosyalarına gömülür; çalışma anında dış kaynak yüklenmez. `tests/unit/design.test.js` emoji ikon, mor renk ya da gradyan kullanılmadığını ve her ikonun sette bulunduğunu denetler.
- `tests/` — birim testleri, sahte Gemini sunucusu, sahte x.com sayfası, uçtan uca test.
- Ayarlar → "Metin/Triyaj/Ses modeli" alanlarına başka model adları yazabilirsin; gelişmiş testler için `apiBase` ayarı sahte sunucuya yönlendirilebilir.
