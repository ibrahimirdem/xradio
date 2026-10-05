// XRadio arka plan servis çalışanı (MV3).
// Görevler: ses belgesini (offscreen) yönetmek, X toplayıcı sekmesini yenilemek, içerik betiklerinden gelen
// tweet'leri ayrıştırıp gelen kutusuna yazmak, YouTube sekme modunu yönetmek, odak kalkanı sayacı,
// klavye kısayolları ve araç çubuğu rozeti.

import { DEFAULT_SETTINGS, mergeSettings, detectLanguage, personasFor } from './lib/config.js';
import { msg, shieldStrings } from './lib/messages.js';
import { extractTweets, sanitizeDomTweet } from './lib/xparser.js';
import { inboxPut, inboxPrune, inboxCount, logList, logPrune, kvGet, clearAll } from './lib/db.js';
import { NewsDesk } from './lib/newsdesk.js';
import { demoWave, DEMO_WAVES } from './lib/demo-tweets.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X_HOME = 'https://x.com/home';

// ------------------------------------------------------------------ Ayarlar
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return mergeSettings(settings);
}

async function session(key, value) {
  if (value === undefined) return (await chrome.storage.session.get(key))[key];
  await chrome.storage.session.set({ [key]: value });
  return value;
}

// ------------------------------------------------------------------ YouTube gömme için Referer kuralı
// Eklenti sayfalarından gömülen YouTube oynatıcısı Referer başlığı olmadan "Hata 153" veriyor.
// Sadece sekmesiz bağlamlar (ses belgesi) için geçerli oturum kuralı ekliyoruz.
async function ensureYouTubeRule() {
  try {
    // Müzik araması: YouTube "youtubei" uç noktaları eklenti kaynağından (chrome-extension://) gelen istekleri
    // 403 ile reddeder. Yalnızca BU eklentinin başlattığı arama isteklerine sitenin kendi kaynak başlığı verilir;
    // YouTube'un kendi sayfalarının istekleri etkilenmez (initiatorDomains).
    const searchRule = (id, host) => ({
      id,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [
        { header: 'origin', operation: 'set', value: `https://${host}` },
        { header: 'referer', operation: 'set', value: `https://${host}/` },
      ] },
      condition: { urlFilter: `|https://${host}/youtubei/`, initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest'] },
    });
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1, 2, 3],
      addRules: [{
        id: 1,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: 'https://www.google.com/' }] },
        condition: { requestDomains: ['youtube.com', 'youtube-nocookie.com'], resourceTypes: ['sub_frame'], tabIds: [chrome.tabs.TAB_ID_NONE] },
      }, searchRule(2, 'www.youtube.com'), searchRule(3, 'music.youtube.com')],
    });
  } catch (e) { console.warn('YouTube kuralı eklenemedi', e); }
}
ensureYouTubeRule();

// ------------------------------------------------------------------ Ses belgesi (offscreen)
let creating = null;
let stationReady = null;
let stationReadyResolve = null;

async function hasOffscreen() {
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return ctx.length > 0;
  }
  return chrome.offscreen.hasDocument?.() ?? false;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return true;
  if (!creating) {
    stationReady = new Promise((r) => { stationReadyResolve = r; });
    creating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK', 'IFRAME_SCRIPTING'],
      justification: 'XRadio müziği (YouTube) ve DJ seslerini arka planda çalar.',
    }).then(async () => {
      await Promise.race([stationReady, sleep(4000)]);
      await toStation({ type: 'init', settings: await getSettings() });
    }).finally(() => { creating = null; });
  }
  await creating;
  return true;
}

async function toStation(msg, { ensure = false } = {}) {
  if (ensure) await ensureOffscreen();
  else if (!(await hasOffscreen())) return null;
  for (let i = 0; i < 3; i++) {
    try { return await chrome.runtime.sendMessage({ to: 'station', ...msg }); } catch (e) {
      if (i === 2) { console.warn('istasyona ulaşılamadı', msg.type, e.message); return null; }
      await sleep(200);
    }
  }
  return null;
}

// ------------------------------------------------------------------ Radyo komutları
async function startRadio() {
  const s = await getSettings();
  await session('radioOn', true);
  await ensureOffscreen();
  // Demo: ilk dalga yayın başlamadan gelsin ki açılış "sen yokken" özetini yapabilsin
  if (s.demoMode) await startDemo();
  else ensureCollector().catch((e) => console.warn('toplayıcı', e));
  const state = await toStation({ type: 'start' });
  scheduleAlarms(s);
  return state;
}

async function stopRadio() {
  await session('radioOn', false);
  const state = await toStation({ type: 'stop' });
  const s = await getSettings();
  if (s.closeCollectorOnStop) await closeCollector();
  await closeYouTubeTab();
  chrome.alarms.clear('demo');
  setTimeout(async () => {
    if (!(await session('radioOn')) && (await hasOffscreen())) chrome.offscreen.closeDocument().catch(() => {});
  }, 2500);
  setBadge('off');
  return state;
}

async function command(cmd, msg = {}) {
  switch (cmd) {
    case 'start': return startRadio();
    case 'stop': return stopRadio();
    case 'toggle': return (await session('radioOn')) ? stopRadio() : startRadio();
    case 'talkNow':
      if (!(await session('radioOn'))) await startRadio();
      return toStation({ type: 'talkNow' });
    case 'skip': return toStation({ type: 'skip' });
    case 'playTrack':
      if (!(await session('radioOn'))) await startRadio();
      return toStation({ type: 'playTrack', id: msg.id });
    case 'listener':
      if (!(await session('radioOn'))) await startRadio();
      return toStation({ type: 'listener', text: msg.text });
    case 'muteStory': return toStation({ type: 'muteStory', id: msg.id });
    case 'resetMemory': {
      await stopRadio();
      const r = await toStation({ type: 'resetMemory' });
      if (!r) await clearAll();
      await session('collectorStatus', null);
      return { ok: true };
    }
    case 'diagnostics': return toStation({ type: 'diagnostics' }, { ensure: true });
    default: return { error: 'bilinmeyen komut' };
  }
}

async function getState() {
  const st = await toStation({ type: 'state' });
  const collector = await session('collectorStatus');
  const inbox = await inboxCount().catch(() => 0);
  return { ...(st || { on: false, phase: 'off' }), radioOn: !!(await session('radioOn')), collector: collector || null, inbox };
}

async function getBoard() {
  const b = await toStation({ type: 'board' });
  if (b) return b;
  const saved = await kvGet('desk').catch(() => null);
  return saved ? NewsDesk.fromJSON(saved, { settings: await getSettings() }).board() : { stories: [], stats: {} };
}

// ------------------------------------------------------------------ X toplayıcı sekmesi
async function collectorTab() {
  const id = await session('collectorTabId');
  if (!id) return null;
  try { return await chrome.tabs.get(id); } catch { return null; }
}

async function ensureCollector() {
  const s = await getSettings();
  if (s.demoMode) return null;
  let tab = await collectorTab();
  if (tab) return tab;
  if (s.collectorMode === 'window') {
    const win = await chrome.windows.create({ url: X_HOME, focused: false, state: 'minimized' });
    tab = win.tabs[0];
  } else {
    tab = await chrome.tabs.create({ url: X_HOME, active: false, pinned: true, index: 0 });
  }
  await session('collectorTabId', tab.id);
  try { await chrome.tabs.update(tab.id, { muted: true, autoDiscardable: false }); } catch { /* */ }
  return tab;
}

async function refreshCollector() {
  const tab = await collectorTab();
  if (!tab) return ensureCollector();
  try { await chrome.tabs.reload(tab.id); } catch { await session('collectorTabId', null); return ensureCollector(); }
  return tab;
}

async function closeCollector() {
  const tab = await collectorTab();
  if (tab) {
    try { if (tab.pinned || tab.url?.includes('x.com')) await chrome.tabs.remove(tab.id); } catch { /* */ }
  }
  await session('collectorTabId', null);
}

// ------------------------------------------------------------------ YouTube sekme modu
async function ytTab(op, msg) {
  const id = await session('ytTabId');
  let tab = null;
  if (id) { try { tab = await chrome.tabs.get(id); } catch { tab = null; } }
  if (op === 'open') {
    await session('ytVolume', msg.volume ?? 50);
    if (tab) { await chrome.tabs.update(tab.id, { url: msg.url }); return { ok: true, tabId: tab.id }; }
    const prev = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    // Medya ertelemesini aşmak için sekme bir an öne getirilir, sonra önceki sekmeye dönülür
    tab = await chrome.tabs.create({ url: msg.url, active: true, pinned: true, index: 0 });
    await session('ytTabId', tab.id);
    try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch { /* */ }
    setTimeout(() => { if (prev?.id) chrome.tabs.update(prev.id, { active: true }).catch(() => {}); }, 2500);
    return { ok: true, tabId: tab.id };
  }
  if (op === 'cmd') {
    if (!tab) return { ok: false };
    if (msg.cmd === 'volume') await session('ytVolume', msg.args?.volume ?? 50);
    try { return await chrome.tabs.sendMessage(tab.id, { type: 'yt:cmd', cmd: msg.cmd, args: msg.args || {} }); } catch { return { ok: false }; }
  }
  if (op === 'close') { await closeYouTubeTab(); return { ok: true }; }
  return { ok: false };
}

async function closeYouTubeTab() {
  const id = await session('ytTabId');
  if (id) { try { await chrome.tabs.remove(id); } catch { /* */ } }
  await session('ytTabId', null);
}

// ------------------------------------------------------------------ Tweet alımı
async function ingest(tweets, source) {
  if (!tweets.length) return 0;
  const added = await inboxPut(tweets);
  const st = (await session('collectorStatus')) || {};
  st.lastAt = Date.now();
  st.lastSource = source;
  st.lastBatch = tweets.length;
  st.total = (st.total || 0) + added;
  st.loggedIn = true;
  await session('collectorStatus', st);
  if (await hasOffscreen()) toStation({ type: 'inbox' });
  return added;
}

// ------------------------------------------------------------------ Demo akışı
async function startDemo() {
  await session('demoStep', 0);
  await demoTick();
  chrome.alarms.create('demo', { periodInMinutes: 1.5 });
}

async function demoTick() {
  const step = (await session('demoStep')) || 0;
  if (step >= DEMO_WAVES) { chrome.alarms.clear('demo'); return; }
  await session('demoStep', step + 1);
  // Örnek akış yayın dilinde gelsin (Türkçe ya da İngilizce); yoksa DJ'ler her paylaşımı "başka dilde" sayar
  await ingest(demoWave(step, Date.now(), (await getSettings()).language), 'demo');
}

// ------------------------------------------------------------------ Odak kalkanı
async function shieldInfo() {
  const today = new Date().toDateString();
  let { shield } = await chrome.storage.local.get('shield');
  if (!shield || shield.day !== today) shield = { day: today, count: 0, snoozeUntil: 0 };
  return shield;
}

async function shieldHit() {
  const shield = await shieldInfo();
  shield.count++;
  await chrome.storage.local.set({ shield });
  return shield;
}

async function recentHeadlines() {
  const logs = await logList({ since: Date.now() - 6 * 3600e3, limit: 8 }).catch(() => []);
  const out = [];
  for (const l of logs) for (const st of l.stories || []) if (out.length < 4 && !out.some((h) => h.headline === st.headline)) out.push({ headline: st.headline, ts: l.ts });
  return out;
}

// ------------------------------------------------------------------ Alarmlar
function scheduleAlarms(s) {
  chrome.alarms.create('collect', { periodInMinutes: Math.max(1, Number(s.refreshMinutes) || 4) });
  chrome.alarms.create('maintenance', { periodInMinutes: 60 });
  chrome.alarms.create('watchdog', { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const on = await session('radioOn');
  if (alarm.name === 'collect') {
    const s = await getSettings();
    if (on && !s.demoMode) refreshCollector().catch(() => {});
  } else if (alarm.name === 'demo') {
    if (on) demoTick();
  } else if (alarm.name === 'maintenance') {
    inboxPrune().catch(() => {});
    logPrune(7).catch(() => {});
  } else if (alarm.name === 'watchdog') {
    // Ses belgesi beklenmedik şekilde kapandıysa yayını geri getir
    if (on && !(await hasOffscreen())) {
      await ensureOffscreen();
      await toStation({ type: 'start' });
    }
  }
});

// ------------------------------------------------------------------ Rozet
function setBadge(mode) {
  const map = { off: ['', '#000000'], music: ['ON', '#16a34a'], talking: ['●', '#dc2626'], breaking: ['!', '#dc2626'], prep: ['…', '#7c3aed'] };
  const [text, color] = map[mode] || map.off;
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

async function onStationEvent(event, data) {
  if (event === 'state') {
    if (!data.on) setBadge('off');
    else if (data.phase === 'talking') setBadge(data.segment?.kind === 'breaking' ? 'breaking' : 'talking');
    else setBadge('music');
  }
  if (event === 'segment' && data.state === 'start' && data.kind === 'breaking') {
    const s = await getSettings();
    if (s.notifyBreaking) {
      chrome.notifications.create('breaking-' + data.id, {
        type: 'basic', iconUrl: 'icons/icon128.png', title: msg(s.language, 'breakingTitle'), message: data.stories?.[0]?.headline || data.title || msg(s.language, 'breakingFallback'), priority: 2,
      });
    }
  }
}

// ------------------------------------------------------------------ Mesajlar
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.to === 'ui' && msg.type === 'event') { onStationEvent(msg.event, msg.data); return false; }
  if (msg.to !== 'bg') return false;
  handleBg(msg, sender).then((r) => sendResponse(r ?? { ok: true }), (e) => sendResponse({ error: e?.message || String(e) }));
  return true;
});

async function handleBg(msg, sender) {
  switch (msg.type) {
    case 'station:ready': stationReadyResolve?.(); return { ok: true };
    case 'cmd': return command(msg.cmd, msg);
    case 'getState': return getState();
    case 'getBoard': return getBoard();
    case 'getSettings': return getSettings();
    case 'saveSettings': {
      const merged = mergeSettings({ ...(await getSettings()), ...msg.settings });
      await chrome.storage.local.set({ settings: merged });
      return { ok: true, settings: merged };
    }
    case 'shieldCount': return { count: (await shieldInfo()).count };
    case 'collectorStatus': return (await session('collectorStatus')) || {};

    // --- X içerik betiği
    case 'collector:hello': {
      const s = await getSettings();
      const collectorId = await session('collectorTabId');
      const shield = await shieldInfo();
      return {
        collector: !!sender.tab && sender.tab.id === collectorId,
        feed: s.feed,
        shield: { enabled: s.focusShield, snoozed: shield.snoozeUntil > Date.now(), count: shield.count },
        radioOn: !!(await session('radioOn')),
        hosts: [s.hostA.name, s.hostB.name],
        lang: s.language,
        ui: shieldStrings(s.language, [s.hostA.name, s.hostB.name]),
      };
    }
    case 'tweets:json': {
      let json;
      try { json = JSON.parse(msg.body); } catch { return { ok: false }; }
      const tweets = extractTweets(json);
      const added = await ingest(tweets, 'json');
      return { ok: true, found: tweets.length, added };
    }
    case 'tweets:dom': {
      const now = Date.now();
      const tweets = (msg.tweets || []).map((t) => sanitizeDomTweet(t, now)).filter(Boolean);
      const added = await ingest(tweets, 'dom');
      return { ok: true, found: tweets.length, added };
    }
    case 'x:status': {
      const st = (await session('collectorStatus')) || {};
      Object.assign(st, { loggedIn: msg.loggedIn, statusAt: Date.now(), note: msg.note || '' });
      await session('collectorStatus', st);
      return { ok: true };
    }
    case 'shield:hit': {
      const shield = await shieldHit();
      return { count: shield.count, radioOn: !!(await session('radioOn')), headlines: await recentHeadlines() };
    }
    case 'shield:snooze': {
      const shield = await shieldInfo();
      const s = await getSettings();
      shield.snoozeUntil = Date.now() + (msg.minutes || s.shieldSnoozeMinutes || 5) * 60e3;
      await chrome.storage.local.set({ shield });
      return { ok: true, until: shield.snoozeUntil };
    }
    case 'closeMe': if (sender.tab) chrome.tabs.remove(sender.tab.id).catch(() => {}); return { ok: true };
    case 'openStudio': {
      const url = chrome.runtime.getURL('studio.html') + (msg.hash || '');
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('studio.html') + '*' });
      // Açık stüdyo sekmesi varsa ona geç; istenen bölüm (ör. #hosgeldin) varsa oraya götür
      if (tabs[0]) { await chrome.tabs.update(tabs[0].id, { active: true, ...(msg.hash ? { url } : {}) }); await chrome.windows.update(tabs[0].windowId, { focused: true }); } else await chrome.tabs.create({ url });
      return { ok: true };
    }

    // --- YouTube
    case 'ytTab': return ytTab(msg.op, msg);
    case 'yt:hello': {
      const id = await session('ytTabId');
      return { music: !!sender.tab && sender.tab.id === id, volume: (await session('ytVolume')) ?? 50 };
    }
    default: return { error: 'bilinmeyen mesaj: ' + msg.type };
  }
}

// ------------------------------------------------------------------ Kısayollar, kurulum, açılış
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'toggle-radio') command('toggle');
  else if (cmd === 'talk-now') command('talkNow');
  else if (cmd === 'skip-track') command('skip');
});

chrome.runtime.onInstalled.addListener(async (details) => {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = mergeSettings(settings || DEFAULT_SETTINGS);
  // Dil: ilk kurulumda (ya da dil hiç seçilmemişse) tarayıcının arayüz dilinden algıla.
  // Kullanıcı Başlangıç ekranında istediği dili seçebilir (languageConfirmed).
  if (!settings || (!settings.language && !settings.languageConfirmed)) {
    merged.language = detectLanguage(chrome.i18n.getUILanguage());
    if (merged.language !== 'tr') {
      const P = personasFor(merged.language);
      merged.hostA = { ...merged.hostA, persona: P.A };
      merged.hostB = { ...merged.hostB, persona: P.B };
    }
  }
  await chrome.storage.local.set({ settings: merged });
  ensureYouTubeRule();
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('studio.html#hosgeldin') });
});

chrome.runtime.onStartup.addListener(async () => {
  await session('radioOn', false);
  const s = await getSettings();
  if (s.autoStartOnBrowserOpen) startRadio().catch(() => {});
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const s = mergeSettings(changes.settings.newValue);
  toStation({ type: 'settings', settings: s });
  if (await session('radioOn')) scheduleAlarms(s);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === (await session('collectorTabId'))) await session('collectorTabId', null);
  if (tabId === (await session('ytTabId'))) await session('ytTabId', null);
});

// Test ve hata ayıklama için
self.xradio = { startRadio, stopRadio, command, getState, getBoard, ingest, ensureOffscreen, toStation, getSettings, demoTick };
