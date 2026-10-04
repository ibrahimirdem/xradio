// Dil ekranlarını denetler: İngilizce arayüzde Başlangıç + açılır pencere görüntüsü alır ve
// tüm stüdyo sekmelerinde Türkçe kalmış metin arar. Görsel/elle kontrol içindir.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXT = path.join(root, 'extension');
const OUT = path.join(root, 'tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const ctx = await chromium.launchPersistentContext('', { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--mute-audio'], viewport: { width: 1360, height: 900 } });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
await new Promise((r) => setTimeout(r, 1500));
for (const p of ctx.pages()) if (p.url().includes('studio.html')) await p.close();
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, language: 'en', languageConfirmed: false } });
  await chrome.storage.local.remove('langPromptShown');
});
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const snap = async (page, file) => {
  log('görüntü', file);
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'));
};
const page = await ctx.newPage();
await page.goto(`chrome-extension://${id}/studio.html`);
await page.waitForTimeout(1500);
await snap(page, 'lang-welcome-en.png');
const pop = await ctx.newPage();
await pop.setViewportSize({ width: 380, height: 640 });
await pop.goto(`chrome-extension://${id}/popup.html`);
await pop.waitForTimeout(1200);
await snap(pop, 'lang-popup-en.png');
const TR = /[çğışÇĞİŞ]|\b(ve|bir|için|ile)\b/;
const leftovers = new Set();
const scan = (where, text) => { for (const line of text.split('\n')) if (TR.test(line)) leftovers.add(`${where}: ${line.trim().slice(0, 120)}`); };
scan('popup', await pop.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('[title],[placeholder]')].map((e) => e.title || e.placeholder).join('\n')));
await pop.close();
for (const tab of ['yayin', 'masa', 'gecmis', 'ayarlar', 'test', 'hosgeldin']) {
  log('sekme', tab);
  await page.goto(`chrome-extension://${id}/studio.html#${tab}`);
  await page.waitForTimeout(1200);
  scan(tab, await page.evaluate(() => {
    const vis = document.querySelector('.tab.active')?.innerText || '';
    const attrs = [...document.querySelectorAll('.tab.active [title], .tab.active [placeholder], .tab.active option, .tab.active optgroup')].map((e) => e.title || e.placeholder || e.label || e.textContent).join('\n');
    return vis + '\n' + attrs + '\n' + document.querySelector('.side').innerText;
  }));
}
console.log(leftovers.size ? [...leftovers].join('\n') : 'Türkçe kalıntı yok');
await ctx.close();
