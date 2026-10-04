// XRadio — YouTube sekme modu denetleyicisi.
// Sadece XRadio'nun açtığı müzik sekmesinde etkindir: ses seviyesini (DJ konuşurken kısma) yönetir,
// çalan parçanın adını radyoya bildirir.
(() => {
  if (window.__xradioYt) return;
  window.__xradioYt = true;
  let active = false;
  let tween = null;
  let target = 0.5;

  const video = () => document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video') || document.querySelector('video');

  function setVolume(v, seconds = 0.6) {
    target = Math.max(0, Math.min(1, v));
    const el = video();
    if (!el) return;
    clearInterval(tween);
    const from = el.volume;
    const steps = Math.max(1, Math.round(seconds * 20));
    let i = 0;
    tween = setInterval(() => {
      i++;
      const cur = video();
      if (!cur) { clearInterval(tween); tween = null; return; }
      cur.volume = from + (target - from) * (i / steps);
      if (cur.muted && target > 0) cur.muted = false;
      if (i >= steps) { clearInterval(tween); tween = null; }
    }, 50);
  }

  function status() {
    const el = video();
    const md = navigator.mediaSession?.metadata;
    const title = md?.title || document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube( Music)?$/, '');
    const author = md?.artist || document.querySelector('#owner #channel-name a, ytd-channel-name a')?.textContent?.trim() || '';
    const live = !!document.querySelector('.ytp-live, .ytp-live-badge[disabled]') || (el && el.duration === Infinity);
    return {
      title, author, live,
      currentTime: el ? el.currentTime : 0,
      duration: el && Number.isFinite(el.duration) ? el.duration : 0,
      paused: el ? el.paused : true,
      needsGesture: !!(el && el.paused && el.currentTime === 0 && document.visibilityState === 'hidden'),
    };
  }

  function report() {
    if (!active) return;
    try { chrome.runtime.sendMessage({ to: 'station', type: 'ytTabStatus', status: status() }).catch(() => {}); } catch { /* */ }
  }

  function tryPlay() {
    const el = video();
    if (el && el.paused) el.play().catch(() => {});
  }

  chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
    if (!m || m.type !== 'yt:cmd' || !active) return false;
    const { cmd, args } = m;
    if (cmd === 'volume') setVolume((args.volume ?? 50) / 100, args.seconds ?? 0.6);
    else if (cmd === 'play') tryPlay();
    else if (cmd === 'pause') video()?.pause();
    else if (cmd === 'next') document.querySelector('.ytp-next-button, ytmusic-player-bar .next-button')?.click();
    sendResponse({ ok: true, status: status() });
    return false;
  });

  chrome.runtime.sendMessage({ to: 'bg', type: 'yt:hello' }).then((r) => {
    if (!r?.music) return;
    active = true;
    setVolume((r.volume ?? 50) / 100, 0);
    setInterval(report, 2000);
    setInterval(() => { const el = video(); if (el && Math.abs(el.volume - target) > 0.02 && !tween) el.volume = target; }, 3000);
    setTimeout(tryPlay, 1500);
    setTimeout(tryPlay, 5000);
  }).catch(() => {});
})();
