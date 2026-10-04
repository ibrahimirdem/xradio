// Gizli (offscreen) belge: İstasyonu barındırır, arka plan ve arayüzden gelen komutları işler.

import { Station } from '../lib/station.js';

const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => undefined);

const bridge = {
  emit(event, data) { send({ to: 'ui', type: 'event', event, data }); },
  request(type, payload = {}) { return chrome.runtime.sendMessage({ to: 'bg', type, ...payload }); },
  tab: {
    open: (url, volume) => chrome.runtime.sendMessage({ to: 'bg', type: 'ytTab', op: 'open', url, volume }),
    command: (cmd, args) => chrome.runtime.sendMessage({ to: 'bg', type: 'ytTab', op: 'cmd', cmd, args }),
    close: () => chrome.runtime.sendMessage({ to: 'bg', type: 'ytTab', op: 'close' }),
  },
};

const station = new Station({ bridge });
self.station = station; // hata ayıklama ve testler için
let initP = null;

async function handle(msg) {
  switch (msg.type) {
    case 'ping': return { ok: true, on: station.on, inited: !!initP };
    case 'init':
      if (!initP) initP = station.init(msg.settings);
      else station.applySettings(msg.settings);
      await initP;
      return { ok: true };
    case 'settings': station.applySettings(msg.settings); return { ok: true };
    case 'start': await initP; return station.start();
    case 'stop': return station.stop();
    case 'state': return station.getState();
    case 'board': return station.getBoard();
    case 'inbox': { const n = await station.drainInbox(); if (n && station.on) station.tick().catch(() => {}); return { ok: true, fresh: n }; }
    case 'talkNow': return station.talkNow();
    case 'skip': return station.skip();
    case 'listener': return station.listenerMessage(msg.text);
    case 'muteStory': station.muteStory(msg.id); return { ok: true };
    case 'resetMemory': await initP; return station.resetMemory();
    case 'ytTabStatus': station.onTabStatus(msg.status); return { ok: true };
    case 'diagnostics': return station.diagnostics();
    case 'volumes': station.engine?.setVolumes(msg.volumes); return { ok: true };
    default: return { error: 'bilinmeyen komut: ' + msg.type };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.to !== 'station') return false;
  handle(msg).then((r) => sendResponse(r ?? { ok: true }), (e) => sendResponse({ error: e?.message || String(e) }));
  return true;
});

// Görselleştirici: stüdyo bağlandığında seviye verisi akıt
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'viz') return;
  const phase = Array.from({ length: 24 }, (_, i) => [0.6 + Math.random() * 1.6, Math.random() * 6.28, 0.35 + 0.5 * Math.exp(-i / 9)]);
  const timer = setInterval(() => {
    try {
      let bands = station.levels();
      // YouTube sesi çapraz kaynaklı olduğu için ölçülemez; müzik çalarken dekoratif, yumuşak bir dalga göster.
      const quiet = !bands || bands.every((b) => b < 0.04);
      if (quiet && station.on && station.music?.nowPlaying?.()) {
        const t = performance.now() / 1000;
        const duck = station.engine?.duckValue ?? 1;
        bands = phase.map(([sp, ph, amp]) => Math.round(amp * duck * (0.25 + 0.5 * Math.abs(Math.sin(t * sp + ph))) * 100) / 160);
      }
      port.postMessage({ bands, talking: station.talking, speaker: station.talking ? station.captions.at(-1)?.speaker || null : null });
    } catch { clearInterval(timer); }
  }, 66);
  port.onDisconnect.addListener(() => clearInterval(timer));
});

send({ to: 'bg', type: 'station:ready' });
