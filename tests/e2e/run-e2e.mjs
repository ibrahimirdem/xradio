// XRadio uçtan uca testleri: eklentiyi gerçek Chromium'a yükler, sahte Gemini sunucusu ve sahte x.com sayfasıyla
// tüm yayın akışını çalıştırır.
//   node tests/e2e/run-e2e.mjs            (Playwright Chromium, görünmez)
//   HEADED=1 node tests/e2e/run-e2e.mjs   (pencereli)
//   ONLY=gemini,collector node tests/e2e/run-e2e.mjs

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startMock } from '../mock/gemini-mock.mjs';
import { timelineFixture } from '../fixtures/x-fixtures.js';
import { xHomeHtml } from '../fixtures/x-home.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '../../extension');
const OUT = path.resolve(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
  return !!cond;
}

/** Bir tarayıcı çağrısını zaman sınırıyla çalıştırır (takılmaları önler). */
function T(promise, ms = 20000, label = 'çağrı') {
  let timer;
  return Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} ${ms} ms içinde dönmedi`)), ms); })]).finally(() => clearTimeout(timer));
}

/** Ekran görüntüsü: sekmeyi öne getir, görünür alanı al; başarısızsa testi düşürme. */
async function snap(page, name) {
  try {
    await page.bringToFront().catch(() => {});
    await page.screenshot({ path: path.join(OUT, name), timeout: 20000, animations: 'disabled' });
  } catch (e) { console.log(`    (ekran görüntüsü alınamadı: ${name} — ${e.message.split(/\r?\n/)[0]})`); }
}

async function waitFor(fn, { timeout = 60000, interval = 1000, label = '' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(interval);
  }
  console.log(`  ⏱ zaman aşımı: ${label}`, last instanceof Error ? last.message : '');
  try {
    const s = await globalThis.__diagState?.();
    if (s) console.log('    durum:', JSON.stringify({ on: s.on, phase: s.phase, preparing: s.preparing, queue: s.queue, errors: (s.errors || []).map((e) => e.msg), audioBlocked: s.audioBlocked, music: s.musicStatus }));
  } catch { /* */ }
  return null;
}

const mock = await startMock(8787, { latency: 200 });
console.log('Sahte Gemini:', mock.url);

// Tarayıcı: varsayılan Playwright Chromium; BROWSER=chrome ya da BROWSER=edge ile bilgisayardaki gerçek tarayıcı,
// ayrı ve geçici bir profille (kullanıcının kendi oturumuna dokunulmaz). Chrome 137+ komut satırından eklenti
// yüklemeyi kapattığı için DevTools protokolüyle Extensions.loadUnpacked kullanılır.
const REAL = {
  chrome: { name: 'Google Chrome', exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
  edge: { name: 'Microsoft Edge', exe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
};
let ctx; let chromeProc = null; let browser = null; let extIdFromCdp = null;
if (REAL[process.env.BROWSER]) {
  const { spawn } = await import('node:child_process');
  const real = REAL[process.env.BROWSER];
  const exe = process.env.CHROME_EXE || real.exe;
  const profile = fs.mkdtempSync(path.join(OUT, `${process.env.BROWSER}-profile-`));
  const port = process.env.BROWSER === 'edge' ? 9340 : 9339;
  chromeProc = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--mute-audio', '--window-size=1360,900', ...(process.env.HEADED ? [] : ['--headless=new']), 'about:blank'], { stdio: 'ignore' });
  // Betik hata verip yarıda kalsa da başlatılan test tarayıcısı açık kalmasın
  process.on('exit', () => { try { chromeProc.kill(); } catch { /* */ } });
  for (let i = 0; i < 40 && !browser; i++) { await sleep(500); browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null); }
  const cdp = await browser.newBrowserCDPSession();
  extIdFromCdp = (await cdp.send('Extensions.loadUnpacked', { path: EXT })).id;
  ctx = browser.contexts()[0];
  console.log('Tarayıcı:', real.name, browser.version());
} else {
  ctx = await chromium.launchPersistentContext('', {
    headless: !process.env.HEADED,
    channel: process.env.HEADED ? undefined : 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--mute-audio'],
    viewport: { width: 1360, height: 900 },
  });
  console.log('Tarayıcı: Playwright Chromium');
}

// Sahte x.com (toplayıcı ve odak kalkanı testleri için)
await ctx.route(/^https:\/\/x\.com\/.*/, async (route) => {
  const url = route.request().url();
  if (url.includes('/i/api/graphql/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(timelineFixture(Date.now())) });
  }
  if (/x\.com\/(home)?(\?.*)?$/.test(url)) return route.fulfill({ status: 200, contentType: 'text/html', body: xHomeHtml(Date.now()) });
  return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>X sayfası</body></html>' });
});

const findSw = () => ctx.serviceWorkers().find((w) => !extIdFromCdp || w.url().includes(extIdFromCdp));
let sw = findSw() || await ctx.waitForEvent('serviceworker', { predicate: (w) => !extIdFromCdp || w.url().includes(extIdFromCdp) });
const extId = sw.url().split('/')[2];
const extUrl = (p) => `chrome-extension://${extId}/${p}`;
console.log('Eklenti:', extId);

const studio = await ctx.newPage();
const consoleErrors = [];
studio.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('studio: ' + m.text()); });
studio.on('pageerror', (e) => consoleErrors.push('studio pageerror: ' + e.message));
studio.setDefaultTimeout(15000);
await studio.goto(extUrl('studio.html#yayin'));

// Arka plan betiği (MV3 servis çalışanı) boşta kalınca tarayıcı onu askıya alabilir (Edge'de sık); Playwright'ın
// elindeki eski bağlantı o zaman yanıt vermez. Bu durumda betik bir eklenti mesajıyla uyandırılır ve yeniden bağlanılır.
const latestSw = () => ctx.serviceWorkers().filter((w) => w.url().includes(extId)).at(-1);
const wakeSw = async () => {
  const page = ctx.pages().find((p) => p.url().startsWith(`chrome-extension://${extId}/`));
  if (page) await T(page.evaluate(() => chrome.runtime.sendMessage({ to: 'bg', type: 'getSettings' })).catch(() => null), 10000, 'uyandırma').catch(() => null);
  for (let i = 0; i < 20; i++) { const w = latestSw(); if (w && w !== sw) return w; await sleep(250); }
  return latestSw() || sw;
};
const swEval = async (fn, arg) => {
  sw = latestSw() || sw;
  try {
    return await T(sw.evaluate(fn, arg), 12000, 'servis çalışanı');
  } catch (e) {
    if (!/dönmedi|Target|closed|destroyed/i.test(e.message)) throw e;
    sw = await wakeSw();
    return T(sw.evaluate(fn, arg), 25000, 'servis çalışanı (yeniden)');
  }
};
const getState = () => swEval(() => self.xradio.getState());
globalThis.__diagState = getState;
const logs = () => T(studio.evaluate(async () => (await import('./lib/db.js')).logList({ since: 0, limit: 500 })), 15000, 'geçmiş okuma');
// Senaryolar Türkçe yayın varsayar (aksi açıkça istenmedikçe); test tarayıcısının dili farklı olabilir.
const setSettings = (patch) => swEval(async (p) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, language: 'tr', languageConfirmed: true, ...p } });
}, patch);
const readSettings = () => swEval(async () => (await chrome.storage.local.get('settings')).settings);
const resetAll = async () => {
  // Temiz başlangıç: radyoyu durdur, hafızayı sıfırla, ses belgesini kapat (bir sonraki senaryo yeni istasyonla başlasın)
  await swEval(() => self.xradio.command('resetMemory'));
  await swEval(async () => { if (await chrome.offscreen.hasDocument?.()) await chrome.offscreen.closeDocument(); }).catch(() => {});
  await sleep(500);
  await T(studio.evaluate(async () => (await import('./lib/db.js')).clearAll()), 15000, 'veritabanı temizliği');
  await swEval(() => chrome.storage.local.remove('shield'));
  await swEval(() => chrome.storage.session.clear());
  await fetch(mock.url + '/__reset');
  await fetch(mock.url + '/__config', { method: 'POST', body: JSON.stringify({ failTts: false, failText: false, failInteractions: false }) });
};
const run = (name) => !ONLY.length || ONLY.includes(name);

// ====================================================================== 0) Dil: ilk kurulumda tarayıcı dili, Başlangıç'ta seçim
if (run('dil')) {
  console.log('\n▶ Senaryo 0: ilk kurulum dili ve dil seçimi');
  const { detectLanguage } = await import('../../extension/lib/config.js');
  const first = await swEval(async () => ({ ui: chrome.i18n.getUILanguage(), s: (await chrome.storage.local.get('settings')).settings }));
  check('İlk kurulumda yayın dili tarayıcı dilinden geldi', first.s.language === detectLanguage(first.ui) && first.s.languageConfirmed === false, `${first.ui} → ${first.s.language}`);

  // İngilizce, onaylanmamış: stüdyo kendiliğinden Başlangıç'a gider ve arayüz İngilizce olur.
  // (Açık stüdyo dil değişince kendini yenilediğinden, gezinmeyle yarışmasın diye önce boş sayfaya geçilir.)
  // Kurulumda kendiliğinden açılan Başlangıç sekmesi de dil değişince yenilenip "gösterildi" bayrağını yazar; kapat.
  for (const p of ctx.pages()) if (p !== studio && p.url().includes('studio.html')) await p.close();
  await studio.goto('about:blank');
  await swEval(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, language: 'en', languageConfirmed: false } });
    await chrome.storage.local.remove('langPromptShown');
  });
  await studio.goto(extUrl('studio.html'));
  await waitFor(() => studio.evaluate(() => location.hash === '#hosgeldin'), { timeout: 8000, label: 'başlangıç ekranı' });
  check('Dil onaylanmamışken stüdyo Başlangıç ekranını açtı', await studio.evaluate(() => location.hash === '#hosgeldin'));
  const enNav = await studio.locator('#nav a[data-tab="yayin"]').textContent();
  const enNote = await studio.locator('#w-lang-note').textContent();
  check('Arayüz İngilizce', /Live/.test(enNav) && /Detected from your browser/.test(enNote), `${enNav} · ${enNote}`);
  check('Dil seçicisi 15 dil sunuyor', (await studio.locator('#w-lang select option').count()) === 15);

  // Popup: onaylanmamış dil için şerit görünür
  const pop = await ctx.newPage();
  await pop.goto(extUrl('popup.html'));
  await waitFor(() => pop.locator('#lang-banner:not(.hidden)').count(), { timeout: 8000, label: 'dil şeridi' });
  check('Açılır pencerede dil şeridi görünüyor', /English/.test(await pop.locator('#lang-banner').textContent()), (await pop.locator('#lang-banner').textContent()).trim());
  await pop.close();

  // Türkçe seç → ayar kaydedilir, sayfa Türkçe yenilenir, varsayılan kişilikler Türkçe olur
  await studio.selectOption('#w-lang select', 'tr');
  const s2 = await waitFor(async () => { const s = await readSettings(); return s.language === 'tr' && s.languageConfirmed && s; }, { timeout: 8000, label: 'dil kaydı' });
  check('Seçilen dil kaydedildi ve onaylandı', !!s2);
  await waitFor(async () => /Canlı yayın/.test(await studio.locator('#nav a[data-tab="yayin"]').textContent().catch(() => '')), { timeout: 8000, label: 'Türkçe arayüz' });
  check('Arayüz Türkçe\'ye döndü', /Canlı yayın/.test(await studio.locator('#nav a[data-tab="yayin"]').textContent()));
  check('Kişilik tarifi dile uyarlandı', /[çğışü]/.test(s2?.hostA?.persona || ''), (s2?.hostA?.persona || '').slice(0, 60));

  // Onaylıyken stüdyo artık Başlangıç'a zorlamaz
  await studio.goto(extUrl('studio.html#yayin'));
  check('Onaydan sonra stüdyo doğrudan açılıyor', await studio.evaluate(() => location.hash === '#yayin'));

  // Eklenti dosyaları güncellenip arka plan betiği eski sürümde kalmışsa (yeni ayar alanlarını bilmiyorsa)
  // stüdyo yine eksiksiz açılmalı ve kullanıcıyı yeniden yüklemeye yönlendirmeli.
  const stalePage = await ctx.newPage();
  await stalePage.addInitScript(() => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (msg, ...rest) => {
      const r = await orig(msg, ...rest);
      if (msg?.type === 'getSettings' && r) { delete r.myList; delete r.myListShuffle; delete r.theme; }
      return r;
    };
  });
  await stalePage.goto(extUrl('studio.html'));
  await waitFor(() => stalePage.evaluate(() => !!document.querySelector('#stale-bar')), { timeout: 8000, label: 'eski arka plan uyarısı' });
  const st0 = await stalePage.evaluate(() => ({ tab: document.querySelector('.tab.active')?.id, nav: document.querySelectorAll('#nav .nav-ic svg').length, toggle: document.querySelector('#toggle')?.textContent.trim(), bar: !!document.querySelector('#stale-bar') }));
  check('Arka plan eski sürümdeyken stüdyo yine açıldı (sekme, menü ikonları, düğmeler)', st0.tab === 'tab-yayin' && st0.nav === 7 && !!st0.toggle, JSON.stringify(st0));
  check('Eski arka plan için yeniden yükleme uyarısı gösterildi', st0.bar);
  await stalePage.close();
}

// ====================================================================== 1) Gemini modu + demo akışı
if (run('gemini')) {
  console.log('\n▶ Senaryo 1: Gemini (sahte) + demo akışı + yerleşik müzik');
  await resetAll();
  await setSettings({ apiKey: 'test-key', apiBase: mock.url, demoMode: true, musicSource: 'generative', talkiness: 'cok', listenerName: 'Deniz', city: '', engine: 'auto', autoModels: true });
  await studio.reload();
  await studio.click('#toggle');
  const st = await waitFor(async () => { const s = await getState(); return s.on && s; }, { timeout: 20000, label: 'radyo açıldı' });
  check('Radyo açıldı', st?.on);
  check('Zekâ motoru Gemini', st?.engine === 'gemini', st?.engine);
  const opener = await waitFor(async () => (await logs()).find((l) => l.kind === 'opener'), { timeout: 90000, label: 'açılış bölümü' });
  check('Açılış bölümü yayınlandı', !!opener, opener?.title);
  check('Açılış Gemini ile yazıldı ve seslendirildi', opener?.writer === 'gemini' && opener?.voice === 'gemini', `${opener?.writer}/${opener?.voice}`);
  check('Açılışta demo haberleri anlatıldı', (opener?.stories || []).length > 0, (opener?.stories || []).map((s) => s.headline).join(' | '));
  const mlog = await (await fetch(mock.url + '/__log')).json();
  check('Model listesi, triyaj, yazar ve TTS çağrıları yapıldı', ['models', 'triage', 'writer', 'tts'].every((t) => mlog.some((x) => x.type === t)), [...new Set(mlog.map((x) => x.type))].join(','));
  const ttsReq = mlog.find((x) => x.type === 'tts' && x.lines > 6);
  check('Seslendirme isteği sohbet modunda, gülme etiketi ve araya giren tepkilerle gitti',
    !!ttsReq && ttsReq.mode === 'conversational' && /<laugh>/.test(ttsReq.text) && /\|[^|]+\|/.test(ttsReq.text) && !/\[laughing\]/.test(ttsReq.text),
    ttsReq ? `${ttsReq.lines} satır tek parça · ton: ${[...new Set(ttsReq.styles)].join(', ')}` : 'istek yok');
  const writerReq = mlog.find((x) => x.type === 'writer');
  check('Yazar istemi dinleyici adını ve demo notunu içeriyor', /Deniz/.test(writerReq?.prompt || '') && /DEMO/.test(writerReq?.prompt || ''));
  const lines = await studio.locator('#transcript .line').count();
  check('Stüdyoda canlı altyazı satırları göründü', lines > 0, `${lines} satır`);
  const s2 = await getState();
  check('Yerleşik müzik çalıyor (parça adı var)', !!s2.nowPlaying?.title, s2.nowPlaying?.title);
  const peak = await studio.evaluate(() => new Promise((res) => {
    const port = chrome.runtime.connect({ name: 'viz' });
    let max = 0;
    port.onMessage.addListener((d) => { if (d.bands) max = Math.max(max, ...d.bands); });
    setTimeout(() => { port.disconnect(); res(max); }, 2500);
  }));
  check('Ses seviyesi ölçülüyor (görselleştirici)', peak > 0.01, `tepe ${peak.toFixed(2)}`);
  await snap(studio, '1-studio-canli.png');

  // Son dakika
  console.log('  → deprem dalgası gönderiliyor (son dakika)');
  await swEval(() => self.xradio.demoTick());
  await swEval(() => self.xradio.demoTick());
  let duckSeen = 1;
  const breaking = await waitFor(async () => {
    const s = await getState();
    if (s.phase === 'talking') duckSeen = Math.min(duckSeen, s.duck);
    return (await logs()).find((l) => l.kind === 'breaking');
  }, { timeout: 90000, interval: 500, label: 'son dakika' });
  check('Son dakika bölümü yayını kesti', !!breaking, breaking?.title);
  check('Konuşurken müzik kısıldı', duckSeen < 0.5, `duck=${duckSeen}`);
  check('Son dakika bölümü depremle ilgili', /deprem/i.test(JSON.stringify(breaking?.stories || [])));

  // Tekrar önleme: aynı olay yeniden gelirse yeniden anlatılmaz
  const before = (await logs()).filter((l) => l.kind === 'breaking').length;
  await swEval(() => self.xradio.ingest([
    { id: '1999999999999999001', text: 'SON DAKİKA: Marmara Denizi\'nde 4,9 büyüklüğünde deprem. AFAD açıklama yaptı.', author: { name: 'Başka Ajans', handle: 'baskaajans' }, createdAt: Date.now() - 60e3, metrics: { likes: 9000, retweets: 4000 }, retweetedBy: [], seenAt: Date.now() },
    { id: '1999999999999999002', text: 'Deprem çok korkuttu, herkes iyi mi?', author: { name: 'Biri', handle: 'biri' }, createdAt: Date.now() - 30e3, metrics: { likes: 50, retweets: 1 }, retweetedBy: [], seenAt: Date.now() },
  ], 'test'));
  await sleep(25000);
  const after = (await logs()).filter((l) => l.kind === 'breaking').length;
  check('Aynı deprem haberi tekrar son dakika olarak verilmedi', after === before, `${before} → ${after}`);
  const board = await swEval(() => self.xradio.getBoard());
  const quake = board.stories.filter((s) => /deprem/i.test(s.headline));
  check('Deprem paylaşımları tek hikâyede toplandı', quake.length === 1, quake.map((s) => `${s.headline} (${s.authors})`).join(' | '));

  // Şimdi anlat + dinleyici mesajı
  const n0 = (await logs()).length;
  await studio.click('#talk', { timeout: 10000 }).catch(async (e) => { console.log('    (düğme tıklanamadı, komutla devam)', e.message.slice(0, 80)); await swEval(() => self.xradio.command('talkNow')); });
  const talked = await waitFor(async () => (await logs()).length > n0, { timeout: 90000, label: 'şimdi anlat' });
  check('"Gündemi şimdi anlat" bir bölüm yayınladı', !!talked);
  await studio.fill('#msg-input', 'Deprem hakkında son durum ne? Bir de biraz caz çalın.');
  await studio.click('#msg-form button[type=submit]');
  const listener = await waitFor(async () => (await logs()).find((l) => l.kind === 'listener'), { timeout: 90000, label: 'dinleyici mesajı' });
  check('Dinleyici mesajı canlı yayında cevaplandı', !!listener, listener?.title);

  // Açılır pencere
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 380, height: 640 });
  await popup.goto(extUrl('popup.html'));
  await sleep(1500);
  const onair = await popup.textContent('#onair-text');
  check('Açılır pencere yayın durumunu gösteriyor', ['YAYINDA', 'CANLI', 'SON DAKİKA'].includes(onair), onair);
  await snap(popup, '2-popup.png');
  await popup.close();

  for (const tab of ['masa', 'gecmis', 'ayarlar']) {
    await studio.goto(extUrl('studio.html#' + tab));
    await sleep(1200);
    await snap(studio, `3-studio-${tab}.png`);
  }
  const cards = await studio.goto(extUrl('studio.html#masa')).then(() => sleep(1000)).then(() => studio.locator('.card').count());
  check('Haber masası hikâye kartlarını gösteriyor', cards > 3, `${cards} kart`);
  await studio.goto(extUrl('studio.html#yayin'));

  // Stüdyo mikseri: sürgü ayarı yazar, istasyon sesi anında uygular; sessize alma düğmesi ana sesi kapatıp geri açar
  const slide = (id, v) => studio.evaluate(([id, v]) => { const r = document.getElementById(id); r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
  const levels = async () => (await swEval(() => self.xradio.command('diagnostics')))?.levels;
  await studio.waitForSelector('#mix-musicVolume');
  check('Stüdyoda mikser var (ana ses, müzik, DJ sesi, konuşurken müzik)', (await studio.locator('#mixer .mix-row').count()) === 4);
  await slide('mix-musicVolume', 0.33);
  await slide('mix-voiceVolume', 1.2);
  const lv = await waitFor(async () => { const l = await levels(); return l && Math.abs(l.music - 0.33) < 0.005 && Math.abs(l.voice - 1.2) < 0.005 && l; }, { timeout: 8000, label: 'mikser seviyeleri' });
  check('Mikserdeki müzik ve DJ sesi istasyona anında uygulandı', !!lv, JSON.stringify(lv));
  check('Mikser değeri yüzde olarak gösteriliyor', (await studio.locator('#mix-musicVolume + output').textContent()) === '33%');
  await studio.click('#mix-mute');
  const muted = await waitFor(async () => (await levels())?.master === 0, { timeout: 8000, label: 'sessize alma' });
  await studio.click('#mix-mute');
  const unmuted = await waitFor(async () => (await levels())?.master > 0, { timeout: 8000, label: 'sesi açma' });
  check('Sessize al / sesi aç düğmesi ana sesi kapatıp geri açtı', !!muted && !!unmuted, `→ ${(await levels())?.master}`);
}

// ====================================================================== 2) TTS hatası → tarayıcı sesi, geçersiz anahtar → yerel
if (run('fallback')) {
  console.log('\n▶ Senaryo 2: TTS hatasında yedek ses, geçersiz anahtarda yerel mod');
  await resetAll();
  await fetch(mock.url + '/__config', { method: 'POST', body: JSON.stringify({ failTts: true }) });
  await setSettings({ apiKey: 'test-key', apiBase: mock.url, demoMode: true, musicSource: 'none', talkiness: 'cok' });
  await swEval(() => self.xradio.startRadio());
  const op = await waitFor(async () => (await logs()).find((l) => l.kind === 'opener'), { timeout: 120000, label: 'açılış (TTS hatalı)' });
  check('TTS çökünce bölüm tarayıcı sesiyle yayınlandı', op?.voice === 'browser' && op?.writer === 'gemini', `${op?.writer}/${op?.voice}`);
  await swEval(() => self.xradio.stopRadio());
  await sleep(800);
  await studio.evaluate(async () => (await import('./lib/db.js')).clearAll());
  await fetch(mock.url + '/__config', { method: 'POST', body: JSON.stringify({ failTts: false }) });
  await setSettings({ apiKey: 'bad-key' });
  await swEval(() => self.xradio.startRadio());
  // Yerel açılış başsız tarayıcıda tahmini konuşma süreleriyle okunur (~1,5 dk); bekleme süresi buna göre
  const op2 = await waitFor(async () => (await logs()).find((l) => l.kind === 'opener'), { timeout: 150000, label: 'açılış (geçersiz anahtar)' });
  const st = await getState();
  check('Geçersiz anahtarda yerel moda düşüldü ve yayın sürdü', !!op2 && op2.writer === 'local' && st.engine === 'local', `${op2?.writer} · motor=${st.engine}`);
  check('Kullanıcıya anahtar hatası bildirildi', (st.errors || []).some((e) => /anahtar/i.test(e.msg)), (st.errors || []).map((e) => e.msg).join(' | ').slice(0, 160));
}

// ====================================================================== 3) Yerel mod (anahtarsız)
if (run('local')) {
  console.log('\n▶ Senaryo 3: Anahtarsız yerel mod');
  await resetAll();
  await setSettings({ apiKey: '', demoMode: true, musicSource: 'generative', talkiness: 'cok' });
  await swEval(() => self.xradio.startRadio());
  const op = await waitFor(async () => (await logs()).find((l) => l.kind === 'opener'), { timeout: 120000, label: 'yerel açılış' });
  check('Yerel yazar + tarayıcı sesiyle açılış yayınlandı', op?.writer === 'local' && op?.voice === 'browser', `${op?.writer}/${op?.voice} · ${op?.lines?.length} satır`);
  const diag = await swEval(() => self.xradio.command('diagnostics'));
  console.log('    tarayıcı sesleri:', JSON.stringify(diag?.browserVoices));
}

// ====================================================================== 4) X toplayıcı + odak kalkanı (sahte x.com)
if (run('collector')) {
  console.log('\n▶ Senaryo 4: X toplayıcı (sahte x.com) ve odak kalkanı');
  await resetAll();
  await setSettings({ apiKey: '', demoMode: false, musicSource: 'none', feed: 'following', focusShield: true, closeCollectorOnStop: true });
  await swEval(() => self.xradio.startRadio());
  // Test aracı sınırı: eklentinin açtığı sekmenin ilk yüklemesi sahte x.com yönlendirmesinden geçmiyor (hata sayfası).
  // Sekmeyi Playwright üzerinden yeniden yükleyerek sahte sayfaya alıyoruz; gerçek tarayıcıda bu adıma gerek yok.
  const collPage = await waitFor(async () => ctx.pages().find((p) => /^chrome-error:|^https:\/\/x\.com/.test(p.url())), { timeout: 15000, label: 'toplayıcı sekmesi' });
  if (collPage) await T(collPage.goto('https://x.com/home'), 20000, 'toplayıcı yükleme').catch((e) => console.log('    ', e.message));
  const coll = await waitFor(async () => { const s = await getState(); return s.collector?.total > 0 && s.collector; }, { timeout: 40000, label: 'toplayıcı verisi' });
  check('Toplayıcı sekmesi açıldı ve paylaşım topladı', !!coll, coll ? `${coll.total} yeni · kaynak ${coll.lastSource}` : '');
  if (!coll) {
    const all = await swEval(() => chrome.tabs.query({})).catch(() => []);
    console.log('    sekmeler:', all.map((t) => `${t.pinned ? '📌' : ''}${t.url}`).join(' | '));
    console.log('    Playwright sayfaları:', ctx.pages().map((p) => p.url()).join(' | '));
    console.log('    toplayıcı durumu:', JSON.stringify((await getState()).collector));
  }
  const tabs = await swEval(() => chrome.tabs.query({ url: 'https://x.com/*' }));
  const collTab = tabs.find((t) => t.pinned);
  check('Toplayıcı sabitlenmiş ve sessiz', !!collTab && collTab.mutedInfo?.muted, collTab ? `pinned=${collTab.pinned}` : 'yok');
  const xPage = ctx.pages().find((p) => p.url().startsWith('https://x.com'));
  if (xPage) {
    const clicked = await waitFor(() => xPage.evaluate(() => window.__followingClicked === true), { timeout: 15000, label: 'takip edilenler sekmesi' });
    check('"Takip edilenler" akışı seçildi', !!clicked);
    const shieldOnCollector = await xPage.evaluate(() => !!document.querySelector('xradio-shield'));
    check('Toplayıcı sekmesinde "dinleme noktası" ekranı var', shieldOnCollector);
  }
  const board = await waitFor(async () => { const b = await swEval(() => self.xradio.getBoard()); return b.stories.length >= 5 && b; }, { timeout: 30000, label: 'hikâyeler' });
  const heads = (board?.stories || []).map((s) => s.headline);
  check('JSON ve sayfa yapısından gelen paylaşımlar hikâyelere ayrıldı', heads.length >= 5, heads.slice(0, 8).join(' | '));
  check('Reklam paylaşımı alınmadı', !heads.some((x) => /Hemen indir|reklam/i.test(x)));
  check('Retweet\'ler ve sayfadaki kadro haberi tek hikâye', heads.filter((x) => /kadro/i.test(x)).length === 1);
  // Kullanıcının kendisi X'i açarsa
  const own = await ctx.newPage();
  await own.goto('https://x.com/home');
  await sleep(2500);
  const shield = await own.evaluate(() => !!document.querySelector('xradio-shield'));
  check('Kullanıcı X\'i açınca odak kalkanı göründü', shield);
  await snap(own, '4-odak-kalkani.png');
  const cnt = await swEval(async () => (await chrome.storage.local.get('shield')).shield?.count);
  check('X\'e girme denemesi sayıldı', cnt >= 1, `sayaç=${cnt}`);
  await own.goto('https://x.com/kullanici/status/1790000000000000000');
  await sleep(1500);
  const shieldOnStatus = await own.evaluate(() => !!document.querySelector('xradio-shield'));
  check('Tek bir paylaşım bağlantısında kalkan araya girmedi', !shieldOnStatus);
  await own.close();
  await swEval(() => self.xradio.stopRadio());
  await sleep(1500);
  const tabsAfter = await swEval(() => chrome.tabs.query({ url: 'https://x.com/*' }));
  check('Radyo durunca toplayıcı sekme kapandı', !tabsAfter.some((t) => t.pinned));
}

// ====================================================================== 5) YouTube (internet gerekir)
if (run('youtube')) {
  console.log('\n▶ Senaryo 5: YouTube oynatma listesi (gömülü, sekmesiz)');
  await resetAll();
  await setSettings({ apiKey: 'test-key', apiBase: mock.url, demoMode: true, musicSource: 'youtube', youtubeUrl: process.env.YT_URL || 'https://www.youtube.com/playlist?list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ', youtubeMode: 'embed', talkiness: 'cok' });
  // Gerçek kullanımdaki gibi kullanıcı tıklamasıyla başlat (otomatik oynatma politikası tıklamaya bağlı)
  await studio.goto(extUrl('studio.html#yayin'));
  await studio.click('#toggle', { timeout: 10000 }).catch(() => swEval(() => self.xradio.startRadio()));
  const playing = await waitFor(async () => { const s = await getState(); return s.musicStatus?.state === 'playing' && s.nowPlaying?.title && s; }, { timeout: 45000, label: 'YouTube çalıyor' });
  check('YouTube oynatma listesi ses belgesinde çalıyor', !!playing, playing ? `${playing.nowPlaying.title} · ${playing.nowPlaying.artist}` : JSON.stringify((await getState()).musicStatus));
  const ytDiag = (await swEval(() => self.xradio.command('diagnostics')).catch(() => null))?.music?.youtube;
  if (ytDiag) console.log('    YouTube olayları:\n      ' + (ytDiag.events || []).join('\n      '));
  let minVol = 100; let maxVol = 0;
  const sample = async () => { const s = await getState(); if (typeof s.musicVolumeNow === 'number' && s.musicVolumeNow >= 0) { minVol = Math.min(minVol, s.musicVolumeNow); maxVol = Math.max(maxVol, s.musicVolumeNow); } return s; };
  const opened = await waitFor(async () => { await sample(); return (await logs()).find((l) => l.kind === 'opener'); }, { timeout: 90000, interval: 400, label: 'açılış' });
  check('YouTube eşliğinde açılış yayınlandı', !!opened, opened?.title);
  // Müzik çalarken "şimdi anlat" ile bir ara tetikle ve ses seviyesini ölç
  const n0 = (await logs()).length;
  await swEval(() => self.xradio.command('talkNow'));
  const talked = await waitFor(async () => { await sample(); return (await logs()).length > n0; }, { timeout: 90000, interval: 300, label: 'YouTube üstünde konuşma' });
  check('DJ konuşurken YouTube sesi kısıldı', !!talked && minVol < maxVol * 0.5, `ses ${maxVol} → ${minVol}`);
  const after = await waitFor(async () => { const s = await sample(); return s.musicVolumeNow >= maxVol * 0.9 && s; }, { timeout: 15000, interval: 500, label: 'ses geri açıldı' });
  check('Konuşma bitince YouTube sesi geri açıldı', !!after, after ? `ses ${after.musicVolumeNow}` : '');
  const writerReq = (await (await fetch(mock.url + '/__log')).json()).find((x) => x.type === 'writer');
  check('Yazar çalan YouTube parçasını biliyor', /YouTube'dan/.test(writerReq?.prompt || ''));
  const tabs = await swEval(() => chrome.tabs.query({ url: 'https://www.youtube.com/*' }));
  check('Gömülü modda ek sekme açılmadı', tabs.length === 0);
}

// ====================================================================== 6) Müzik sekmesi: arama + kişisel liste (oynatma internet gerekir)
if (run('muzik')) {
  console.log('\n▶ Senaryo 6: Müzik sekmesi — arama, Listem, kuyruk');
  await resetAll();
  await setSettings({ apiKey: 'test-key', apiBase: mock.url, demoMode: true, musicSource: 'youtube', youtubeMode: 'embed', talkiness: 'az', myList: [], myListShuffle: false });
  // Arama yanıtları sabit örneklerden gelir (gerçek YouTube yanıtlarından sadeleştirilmiş); oynatma gerçek YouTube'dan
  const FX = path.resolve(__dirname, '../fixtures/youtube');
  const searchHits = [];
  await ctx.route(/^https:\/\/(www|music)\.youtube\.com\/youtubei\/v1\/search/, async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    searchHits.push({ url: req.url(), origin: (await req.allHeaders()).origin });
    const file = req.url().includes('music.youtube.com') ? 'music-songs.json' : body.params === 'EgJAAQ==' ? 'live.json' : body.params === 'EgIQAw==' ? 'playlists.json' : 'videos.json';
    await route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(path.join(FX, file), 'utf8') });
  });
  await studio.goto(extUrl('studio.html#muzik'));
  await studio.waitForSelector('#lib-q');
  const rowsIn = (sel) => studio.locator(`${sel} .row-item`).count();
  const waitRows = (sel, n = 1) => waitFor(async () => (await rowsIn(sel)) >= n, { timeout: 15000, interval: 300, label: 'arama sonuçları' });
  await studio.fill('#lib-q', 'tarkan');
  await studio.click('#lib-form button[type="submit"]');
  await waitRows('#lib-results', 5);
  const songRows = await rowsIn('#lib-results');
  check('Şarkı araması sonuç listeledi (YouTube Music)', songRows >= 8 && searchHits.some((h) => h.url.includes('music.youtube.com')), `${songRows} sonuç`);
  const first = await studio.locator('#lib-results .row-item .title').first().textContent();
  check('Sonuçlarda başlık, sanatçı ve süre görünüyor', !!first && /\d:\d\d/.test(await studio.locator('#lib-results .row-item .dur').first().textContent()), first);
  await studio.click('#lib-kinds [data-kind="live"]');
  await waitFor(async () => searchHits.some((h) => !h.url.includes('music')), { timeout: 10000, label: 'canlı arama' });
  await waitRows('#lib-results', 3);
  check('Canlı yayın aramasında "CANLI" etiketi var', (await studio.locator('#lib-results .row-item .tag.danger').count()) >= 3);
  await studio.click('#lib-kinds [data-kind="songs"]');
  await waitFor(async () => /\d:\d\d/.test(await studio.locator('#lib-results .row-item .dur').first().textContent().catch(() => '')), { timeout: 10000, label: 'şarkılara dönüş' });
  // İlk üç şarkıyı listeye ekle
  for (let i = 0; i < 3; i++) {
    await studio.locator('#lib-results .row-item .acts button').nth(i).click();
    await waitFor(async () => (await readSettings()).myList.length === i + 1, { timeout: 5000, label: 'listeye ekleme' });
  }
  const s1 = await readSettings();
  check('Üç parça Listem\'e eklendi', s1.myList.length === 3 && s1.myList.every((x) => x.id && x.title && x.thumb), s1.myList.map((x) => x.title).join(' | '));
  check('Listem paneli parçaları gösteriyor', (await rowsIn('#lib-tracks')) === 3);
  // Listemi çal → radyo açılır, istasyon kişisel kuyruğu çalar
  await studio.click('#lib-play');
  const q = await waitFor(async () => { const s = await getState(); return s.on && s.nowPlaying?.queue && s; }, { timeout: 30000, label: 'kuyruk çalıyor' });
  check('"Listemi çal" radyoyu açtı ve kuyruğu yükledi', !!q && (await readSettings()).musicSource === 'mylist', q ? `${q.nowPlaying.title} · ${q.nowPlaying.queue.index}/${q.nowPlaying.queue.total}` : JSON.stringify((await getState()).musicStatus));
  const firstId = q?.nowPlaying?.trackId;
  check('Çalan parça listede vurgulandı', await waitFor(async () => (await studio.locator(`#lib-tracks li.playing[data-id="${firstId}"]`).count()) === 1, { timeout: 8000, label: 'vurgu' }));
  const audible = await waitFor(async () => { const s = await getState(); return s.musicStatus?.state === 'playing' && s; }, { timeout: 40000, label: 'parça sesi' });
  check('Listedeki parça gerçekten çalıyor (YouTube)', !!audible, audible ? audible.nowPlaying?.title : JSON.stringify((await getState()).musicStatus));
  if (!audible || process.env.DEBUG_YT) {
    const yd = (await swEval(() => self.xradio.command('diagnostics')).catch(() => null))?.music?.youtube;
    if (yd) console.log('    YouTube olayları:\n      ' + (yd.events || []).join('\n      '));
  }
  // Sıralama değişikliği çalan parçayı kesmez
  await studio.locator(`#lib-tracks li[data-id="${s1.myList[2].id}"] .mv-up`).click({ force: true });
  await waitFor(async () => (await readSettings()).myList[1].id === s1.myList[2].id, { timeout: 5000, label: 'sıralama' });
  await sleep(1200);
  check('Sıralama değişti, çalan parça kesilmedi', (await getState()).nowPlaying?.trackId === firstId);
  // Atla → sıradaki parça (DJ'ler konuşurken "Atla" konuşmayı atlar; bu yüzden konuşmanın bitmesi beklenir)
  await waitFor(async () => (await getState()).phase !== 'talking', { timeout: 90000, interval: 500, label: 'konuşma bitti' });
  await swEval(() => self.xradio.command('skip'));
  const skipped = await waitFor(async () => { const s = await getState(); return s.nowPlaying?.trackId && s.nowPlaying.trackId !== firstId && s; }, { timeout: 10000, label: 'atlama' });
  check('Atla kuyruktaki sonraki parçaya geçti', !!skipped, skipped?.nowPlaying?.title);
  // Listeden çıkar
  await studio.locator(`#lib-tracks li[data-id="${s1.myList[0].id}"] .rm`).click({ force: true });
  check('Parça listeden çıkarıldı', await waitFor(async () => (await readSettings()).myList.length === 2, { timeout: 5000, label: 'silme' }));
  check('Hızlı müzik seçiminde "Listem" seçeneği var', (await studio.locator('#quick-music option[value="mylist"]').count()) === 1);
  await ctx.unroute(/^https:\/\/(www|music)\.youtube\.com\/youtubei\/v1\/search/);
}

await swEval(() => self.xradio.stopRadio()).catch(() => {});
const failed = results.filter((r) => !r.ok);
console.log(`\nSonuç: ${results.length - failed.length}/${results.length} kontrol geçti.`);
if (consoleErrors.length) console.log('Konsol hataları:\n  ' + [...new Set(consoleErrors)].slice(0, 10).join('\n  '));
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, consoleErrors }, null, 2));
if (browser) { await browser.close().catch(() => {}); chromeProc?.kill(); } else await ctx.close();
mock.server.close();
process.exit(failed.length ? 1 : 0);
