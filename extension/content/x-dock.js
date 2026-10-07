// XRadio — X üzerinde radyo düğmesi (izole dünya).
// Sağ alttaki Grok ve Sohbet düğmelerinin üstüne, onlarla aynı görünümde bir radyo düğmesi koyar. Tıklanınca
// eklenti açılır penceresi (popup.html?embed=1) sayfanın içinde bir panelde açılır. Ses arka plandaki ekran dışı
// belgede çaldığı için sayfa yenilense de yayın kesilmez; bu betik yalnızca kumandadır.
(() => {
  if (window.top !== window || window.__xradioDock) return;
  window.__xradioDock = true;

  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const send = (msg) => {
    if (!alive()) return Promise.resolve(null);
    try { return chrome.runtime.sendMessage({ to: 'bg', ...msg }).catch(() => null); } catch { return Promise.resolve(null); }
  };

  const SIZE = 55;        // X'in Grok/Sohbet düğmeleriyle aynı
  const GAP = 12;         // X'in iki düğmesi arasındaki boşluk
  const PANEL_W = 380;    // açılır pencerenin genişliği
  const OPEN_KEY = 'xradio-dock-open';
  const ANCHORS = ['[data-testid="GrokDrawerHeader"]', '[data-testid="chat-drawer-main"]'];
  const DRAWERS = ['[data-testid="GrokDrawer"]', '[data-testid="chat-drawer-root"]'];

  let host = null; let root = null; let btn = null; let panel = null; let frame = null;
  let info = null;        // dock:hello yanıtı
  let state = { on: false, phase: 'off' };
  let frameH = 560;
  let pos = { right: 35, bottom: GAP + 2 * (SIZE + GAP) };
  const timers = [];

  // ---------------------------------------------------------------- Görünüm (X'in kendi düğmesinden kopyalanır)
  // X'in temaları (Varsayılan / Loş / Işıklar kapalı) değişebildiği için stil her seferinde canlı düğmeden okunur.
  const DARK = {
    background: 'rgba(0, 0, 0, 0.65)', border: '1px solid rgb(75, 78, 82)', color: 'rgb(231, 233, 234)', backdropFilter: 'blur(12px)',
    boxShadow: 'rgba(255, 255, 255, 0.2) 0px 0px 15px 0px, rgba(255, 255, 255, 0.15) 0px 0px 3px 1px',
  };
  const LIGHT = {
    background: 'rgba(255, 255, 255, 0.85)', border: '1px solid rgb(207, 217, 222)', color: 'rgb(15, 20, 25)', backdropFilter: 'blur(12px)',
    boxShadow: 'rgba(101, 119, 134, 0.2) 0px 0px 15px 0px, rgba(101, 119, 134, 0.15) 0px 0px 3px 1px',
  };
  function pageIsDark() {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
    if (!m) return true;
    const [r, g, b] = m.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  }
  function look(anchor) {
    if (anchor) {
      const cs = getComputedStyle(anchor);
      return { background: cs.backgroundColor, border: cs.border, color: cs.color, backdropFilter: cs.backdropFilter, boxShadow: cs.boxShadow, page: getComputedStyle(document.body).backgroundColor };
    }
    return { ...(pageIsDark() ? DARK : LIGHT), page: getComputedStyle(document.body).backgroundColor };
  }

  const CSS = `
    :host{all:initial}
    *{box-sizing:border-box}
    .btn{position:fixed;width:${SIZE}px;height:${SIZE}px;border-radius:16px;display:grid;place-items:center;cursor:pointer;padding:0;margin:0;
      font:inherit;outline:none;-webkit-tap-highlight-color:transparent;transition:background-color .2s,box-shadow .2s,opacity .15s,transform .15s;
      background:var(--bg);border:var(--border);color:var(--fg);box-shadow:var(--shadow);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}
    .btn:not(.ready),.btn:not(.ready)::before{transition:none}
    .btn::before{content:"";position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;transition:opacity .2s}
    .btn:hover::before{opacity:.1}
    .btn:active{transform:scale(.96)}
    .btn:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px}
    .btn[aria-expanded="true"]{box-shadow:var(--shadow),0 0 0 2px #ff5a1f inset}
    .btn svg{display:block;position:relative}
    .dot{position:absolute;top:7px;right:7px;width:10px;height:10px;border-radius:50%;background:#ff5a1f;box-shadow:0 0 0 2px var(--page);opacity:0;transform:scale(.4);transition:opacity .2s,transform .2s}
    .btn.on .dot{opacity:1;transform:none}
    .btn.talking .dot{animation:pulse 1.2s ease-in-out infinite}
    @keyframes pulse{50%{opacity:.35}}
    .btn.hide{opacity:0;pointer-events:none;transform:scale(.9)}
    .panel{position:fixed;width:${PANEL_W}px;border-radius:16px;overflow:hidden;background:var(--page);border:var(--border);
      box-shadow:var(--shadow),0 12px 32px rgba(0,0,0,.35);opacity:0;transform:translateY(8px) scale(.98);transform-origin:100% 100%;
      transition:opacity .16s ease,transform .16s ease}
    .panel.show{opacity:1;transform:none}
    .panel iframe{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal}
    @media (prefers-reduced-motion:reduce){.btn,.panel,.dot,.btn::before{transition:none!important;animation:none!important}}
  `;

  function svg(name, size) {
    const body = (globalThis.__xradioIcons || {})[name];
    return body ? `<svg viewBox="0 0 256 256" width="${size}" height="${size}" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>` : '';
  }

  function build() {
    host = document.createElement('xradio-dock');
    // Odak kalkanının (en üst katman) altında, X'in katmanlarının üstünde
    host.style.cssText = 'position:fixed;z-index:2147483000;top:0;left:0;width:0;height:0;display:block;';
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = svg('broadcast', 30) + '<span class="dot"></span>';
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    root.append(style, btn);
    mount();
    updateLabel();
    // İlk yerleşimden sonra geçişleri aç (ilk çizimde gölge/renk "belirerek" gelmesin)
    setTimeout(() => btn?.classList.add('ready'), 300);
  }

  function mount() {
    if (host && !host.isConnected) (document.body || document.documentElement).append(host);
  }

  function updateLabel() {
    if (!btn) return;
    const ui = info?.ui || {};
    const label = state.on ? (ui.shDockOn || 'XRadio · Yayında') : (ui.shDockOff || 'XRadio · Radyo kapalı');
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.classList.toggle('on', !!state.on);
    btn.classList.toggle('talking', state.phase === 'talking');
  }

  // ---------------------------------------------------------------- Yerleşim
  // Sabit konum, kaydırma çubuğu hariç görünür alana göredir: innerWidth değil clientWidth (Windows'ta çubuk ~15 px)
  const vw = () => document.documentElement.clientWidth || innerWidth;
  const vh = () => document.documentElement.clientHeight || innerHeight;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };

  /** Sabit konumlu bir X öğesi (ör. mobil düzende yazma düğmesi) bu noktayı kaplıyor mu? */
  function blockedAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === host || el === document.body || el === document.documentElement) continue;
      const hit = el.closest('a,button,[role="button"]');
      if (!hit) return false;
      for (let p = hit; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).position === 'fixed') return true;
      }
      return false;
    }
    return false;
  }

  function layout() {
    if (!btn) return;
    mount();
    const anchors = ANCHORS.map((s) => document.querySelector(s)).filter(Boolean).map((el) => ({ el, r: visible(el) })).filter((a) => a.r);
    const collapsed = anchors.filter((a) => a.r.height <= 80);
    const drawers = DRAWERS.map((s) => document.querySelector(s)).map((el) => el && visible(el)).filter((r) => r && r.height > 120);
    // X'te bir pencere (fotoğraf, yazma…) açıksa çekil
    let hide = [...document.querySelectorAll('[aria-modal="true"]')].some((m) => visible(m));
    let ref = null;
    if (collapsed.length) {
      // En üstteki X düğmesinin hemen üstü
      ref = collapsed.reduce((a, b) => (b.r.top < a.r.top ? b : a));
      pos = { right: Math.round(vw() - ref.r.right), bottom: Math.round(vh() - ref.r.top + GAP) };
    } else if (anchors.length) {
      hide = true; // X'in çekmeceleri açık: araya girme
    } else {
      // X düğmeleri yok (oturum kapalı, dar ekran…): sağ alt köşe, sabit bir X öğesiyle çakışmayacak yükseklikte
      pos = { right: 24, bottom: 24 };
      for (let i = 0; i < 4 && blockedAt(vw() - pos.right - SIZE / 2, vh() - pos.bottom - SIZE / 2); i++) pos.bottom += SIZE + GAP;
    }
    // Açık bir çekmeceyle çakışıyorsa gizle
    const me = { left: vw() - pos.right - SIZE, right: vw() - pos.right, top: vh() - pos.bottom - SIZE, bottom: vh() - pos.bottom };
    if (drawers.some((r) => r.left < me.right && r.right > me.left && r.top < me.bottom && r.bottom > me.top)) hide = true;

    const s = look(ref?.el);
    btn.style.setProperty('--bg', s.background);
    btn.style.setProperty('--border', s.border);
    btn.style.setProperty('--fg', s.color);
    btn.style.setProperty('--shadow', s.boxShadow === 'none' ? 'none' : s.boxShadow);
    btn.style.setProperty('--blur', s.backdropFilter && s.backdropFilter !== 'none' ? s.backdropFilter : 'none');
    btn.style.setProperty('--page', s.page);
    btn.style.right = pos.right + 'px';
    btn.style.bottom = pos.bottom + 'px';
    btn.classList.toggle('hide', hide && !panel);
    if (panel) placePanel(s);
  }

  function placePanel(s = look(null)) {
    panel.style.setProperty('--page', s.page);
    panel.style.setProperty('--border', s.border);
    panel.style.setProperty('--shadow', s.boxShadow === 'none' ? '0 0 0 transparent' : s.boxShadow);
    const narrow = vw() < PANEL_W + SIZE + pos.right + GAP * 3;
    let right; let bottom;
    if (narrow) {
      // Dar pencerede düğmenin üstüne
      right = Math.max(8, Math.min(pos.right, vw() - PANEL_W - 8));
      bottom = pos.bottom + SIZE + GAP;
    } else {
      // Geniş pencerede düğme sütununun soluna, X'in en alttaki düğmesiyle aynı hizada
      right = pos.right + SIZE + GAP;
      bottom = GAP;
    }
    const maxH = Math.max(240, vh() - bottom - GAP);
    panel.style.right = right + 'px';
    panel.style.bottom = bottom + 'px';
    panel.style.width = Math.min(PANEL_W, vw() - 16) + 'px';
    panel.style.height = Math.min(frameH, maxH) + 'px';
  }

  // ---------------------------------------------------------------- Panel
  function open() {
    if (panel || !alive()) return;
    panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'XRadio');
    frame = document.createElement('iframe');
    // Tema "sistem" ise panel X'in o anki temasına uyar (koyu X'te koyu, açık X'te açık)
    frame.src = chrome.runtime.getURL('popup.html') + '?embed=1&xtheme=' + (pageIsDark() ? 'dark' : 'light');
    frame.title = 'XRadio';
    frame.setAttribute('allow', 'autoplay');
    panel.append(frame);
    root.append(panel);
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.remove('hide');
    layout();
    requestAnimationFrame(() => requestAnimationFrame(() => panel?.classList.add('show')));
    frame.addEventListener('load', () => { try { frame.focus(); } catch { /* */ } }, { once: true });
    try { sessionStorage.setItem(OPEN_KEY, '1'); } catch { /* */ }
  }

  function close({ remember = true } = {}) {
    if (!panel) return;
    const p = panel;
    panel = null; frame = null;
    p.classList.remove('show');
    setTimeout(() => p.remove(), 170);
    btn.setAttribute('aria-expanded', 'false');
    if (remember) { try { sessionStorage.removeItem(OPEN_KEY); } catch { /* */ } }
    poll();
    layout();
  }

  const toggle = () => (panel ? close() : open());

  // Panel içinden gelen iletiler: boyut ve kapatma. Yalnızca kendi çerçevemizden kabul edilir.
  window.addEventListener('message', (e) => {
    if (!frame || e.source !== frame.contentWindow || !e.data || typeof e.data.xradio !== 'string') return;
    if (e.data.xradio === 'size' && Number.isFinite(e.data.h)) { frameH = Math.max(200, Math.ceil(e.data.h)); placePanel(); }
    else if (e.data.xradio === 'close') { close(); btn?.focus(); }
  });

  // Dışarı tıklayınca veya Esc ile kapanır (çerçevenin içindeki tıklamalar buraya gelmez)
  document.addEventListener('pointerdown', (e) => { if (panel && !e.composedPath().includes(host)) close(); }, true);
  document.addEventListener('keydown', (e) => { if (panel && e.key === 'Escape') { close(); btn?.focus(); } }, true);

  // ---------------------------------------------------------------- Durum
  async function poll() {
    if (!btn || document.hidden) return;
    const r = await send({ type: 'dock:state' });
    if (!r || r.error) return;
    state = r;
    updateLabel();
  }

  function teardown() {
    timers.splice(0).forEach(clearInterval);
    close({ remember: false });
    host?.remove();
    host = root = btn = null;
  }

  async function start() {
    if (!alive()) return;
    info = await send({ type: 'dock:hello' });
    if (!info || info.error || info.collector || !info.enabled) { teardown(); return; }
    if (!host) {
      build();
      timers.push(setInterval(() => { if (!alive()) { teardown(); return; } layout(); }, 1000));
      timers.push(setInterval(poll, 4000));
      addEventListener('resize', layout);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); layout(); } });
    }
    state = info.state || state;
    updateLabel();
    layout();
    poll();
    // Sayfa yenilendiğinde panel açıktıysa yeniden aç (yayın zaten sürüyor)
    try { if (sessionStorage.getItem(OPEN_KEY) === '1') open(); } catch { /* */ }
  }

  // Ayarlardan açılıp kapatılabilir
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      const was = changes.settings.oldValue?.xDock !== false;
      const now = changes.settings.newValue?.xDock !== false;
      const langChanged = changes.settings.oldValue?.language !== changes.settings.newValue?.language;
      if (was !== now || langChanged) start();
    });
  } catch { /* */ }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
