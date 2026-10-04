// README ekran görüntüleri: eklentiyi Playwright Chromium'a yükler, anahtarsız yerel modda
// İngilizce demo yayını başlatır ve docs/screenshots/ altına görüntü alır.  npm run screenshots
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(root, 'extension');
const OUT = path.join(root, 'docs', 'screenshots');
const LANG = process.env.LANG_CODE || 'en';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const ctx = await chromium.launchPersistentContext('', {
  headless: !process.env.HEADED, channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--mute-audio'],
  viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1,
});
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
const url = (p) => `chrome-extension://${id}/${p}`;
await sleep(1500);
for (const p of ctx.pages()) if (p.url().includes('studio.html')) await p.close();

// Playwright'ın sayfa görüntüsü hareketli sayfalarda takılabildiğinden doğrudan DevTools protokolü kullanılır
async function snap(page, file, { body = false } = {}) {
  const cdp = await page.context().newCDPSession(page);
  // body: yalnızca sayfa gövdesini al (açılır pencere 380 px; görünüm alanı daha geniş olabilir)
  const clip = body ? await page.evaluate(() => { const r = document.body.getBoundingClientRect(); const bottom = Math.max(...[...document.body.children].filter((e) => e.offsetHeight > 0 && e.innerText.trim()).map((e) => e.getBoundingClientRect().bottom)); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(bottom + 14), scale: 1 }; }) : undefined;
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'));
  log('görüntü', file);
}

await sw.evaluate(async (lang) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, language: lang, languageConfirmed: false, demoMode: true, apiKey: '', engine: 'local', musicSource: 'generative', talkiness: 'cok', listenerName: 'Alex' } });
  await chrome.storage.local.remove('langPromptShown');
}, LANG);

const studio = await ctx.newPage();
await studio.goto(url('studio.html'));
await sleep(1500);
await snap(studio, 'welcome.png');

await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, languageConfirmed: true } });
});
await studio.goto(url('studio.html#yayin'));
await sleep(1000);
await studio.click('#toggle');
log('yayın başladı, konuşma bekleniyor');
for (let i = 0; i < 120; i++) {
  if ((await studio.locator('#transcript .line').count()) >= 7) break;
  await sleep(1000);
}
await snap(studio, 'studio-live.png');

await studio.goto(url('studio.html#masa'));
await sleep(2000);
await snap(studio, 'news-desk.png');

await studio.goto(url('studio.html#yayin'));
const pop = await ctx.newPage();
await pop.setViewportSize({ width: 380, height: 640 });
await pop.goto(url('popup.html'));
await pop.waitForSelector('#recent li', { timeout: 10000 }).catch(() => {});
await sleep(1500);
if (process.env.DEBUG_POPUP) {
  console.log(await pop.evaluate(() => [...document.body.children]
    .map((e) => `${e.tagName}.${e.className} h=${e.offsetHeight} top=${Math.round(e.getBoundingClientRect().top)} ${getComputedStyle(e).display}/${getComputedStyle(e).opacity} "${e.innerText.slice(0, 30).replace(/\s+/g, ' ')}"`)
    .concat([`vh=${innerHeight} vw=${innerWidth} dpr=${devicePixelRatio} body=${document.body.offsetHeight}`]).join('\n')));
}
await snap(pop, 'popup.png', { body: true });
await pop.close();

await sw.evaluate(() => self.xradio.stopRadio()).catch(() => {});
await ctx.close();
log('bitti →', path.relative(root, OUT));
