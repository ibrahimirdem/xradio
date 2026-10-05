// XRadio — X içerik betiği (izole dünya).
// 1) Toplayıcı: ana akıştaki paylaşımları (JSON yanıtları + sayfa yapısı) arka plana iletir.
// 2) Odak kalkanı: kullanıcı X'i kendisi açtığında akış yerine nazik bir "radyo seni bekliyor" ekranı gösterir.
(() => {
  if (window.__xradioCollector) return;
  window.__xradioCollector = true;

  const send = (msg) => {
    try { return chrome.runtime.sendMessage({ to: 'bg', ...msg }).catch(() => null); } catch { return Promise.resolve(null); }
  };
  const SHIELD_PATHS = /^\/(home|explore|notifications|search|i\/trending|i\/topics|i\/lists)?\/?$/;
  let role = null;
  const seenDom = new Set();
  let domBatch = [];
  let domTimer = null;

  // ---------------------------------------------------------------- Rol
  async function hello() {
    role = await send({ type: 'collector:hello' });
    if (!role) return;
    if (role.collector) document.documentElement.dataset.xradioCollector = '1';
    evaluateShield();
  }

  const collecting = () => !!role && (role.collector || location.pathname === '/home');

  // ---------------------------------------------------------------- JSON yanıtları (x-hook.js'den)
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__xradio !== 1 || e.data.kind !== 'json') return;
    if (!collecting()) return;
    const body = e.data.body;
    if (typeof body !== 'string' || body.length < 200) return;
    if (!/"(full_text|tweet_results|rest_id)"/.test(body)) return;
    send({ type: 'tweets:json', url: e.data.url, body });
  });

  // ---------------------------------------------------------------- Sayfa yapısından (yedek yol)
  function num(label) {
    if (!label) return 0;
    const m = String(label).replace(/ /g, ' ').match(/([\d.,]+)\s*(B|Bn|K|Mn|M|Milyon|Bin)?/i);
    if (!m) return 0;
    let v = m[1];
    const unit = (m[2] || '').toLowerCase();
    if (unit) v = parseFloat(v.replace(',', '.'));
    else v = parseFloat(v.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
    if (unit === 'k' || unit === 'b' || unit === 'bin' || unit === 'bn') v *= 1e3;
    if (unit === 'm' || unit === 'mn' || unit === 'milyon') v *= 1e6;
    return Math.round(v) || 0;
  }

  function metric(article, testid) {
    const el = article.querySelector(`[data-testid="${testid}"], [data-testid="un${testid}"]`);
    return num(el?.getAttribute('aria-label') || el?.innerText || '');
  }

  function scrapeArticle(a) {
    const timeEl = a.querySelector('time[datetime]');
    const link = timeEl?.closest('a[href*="/status/"]');
    if (!link) return null; // reklamların zaman damgası yoktur
    const m = link.getAttribute('href').match(/\/([^/]+)\/status\/(\d+)/);
    if (!m) return null;
    const [, handle, id] = m;
    if (seenDom.has(id)) return null;
    const texts = [...a.querySelectorAll('[data-testid="tweetText"]')];
    const mainEl = texts.find((t) => !t.closest('div[role="link"]')) || null;
    const quotedEl = texts.find((t) => t.closest('div[role="link"]')) || null;
    const nameBlock = a.querySelector('[data-testid="User-Name"]');
    const name = nameBlock?.querySelector('span')?.innerText?.trim() || handle;
    const social = a.querySelector('[data-testid="socialContext"]')?.innerText || '';
    const retweetedBy = /repost|yeniden|retweet/i.test(social)
      ? [{ name: social.replace(/\s*(reposted|yeniden gönderi yayınladı|yeniden yayınladı|Retweetledi|retweeted).*/i, '').trim(), handle: '' }]
      : [];
    const views = a.querySelector('a[href$="/analytics"]');
    const media = [];
    a.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((img) => media.push({ type: 'photo', alt: img.alt && !/^(Image|Görsel|Resim)$/i.test(img.alt) ? img.alt : '' }));
    if (a.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"]')) media.push({ type: 'video', alt: '' });
    const quotedAuthor = quotedEl?.closest('div[role="link"]')?.querySelector('[data-testid="User-Name"] span')?.innerText || '';
    return {
      id,
      url: `https://x.com/${handle}/status/${id}`,
      text: mainEl ? mainEl.innerText : '',
      lang: mainEl?.getAttribute('lang') || '',
      createdAt: Date.parse(timeEl.getAttribute('datetime')) || 0,
      author: { name, handle },
      metrics: { likes: metric(a, 'like'), retweets: metric(a, 'retweet'), replies: metric(a, 'reply'), bookmarks: metric(a, 'bookmark'), views: num(views?.getAttribute('aria-label')) },
      quoted: quotedEl ? { text: quotedEl.innerText, author: { name: quotedAuthor } } : null,
      media: media.slice(0, 4),
      retweetedBy,
      isReply: false,
    };
  }

  function scanDom() {
    if (!collecting()) return;
    const arts = document.querySelectorAll('article[data-testid="tweet"], article[role="article"]');
    for (const a of arts) {
      try {
        const t = scrapeArticle(a);
        if (t && (t.text || t.quoted)) { seenDom.add(t.id); domBatch.push(t); }
      } catch { /* */ }
    }
    if (domBatch.length) {
      clearTimeout(domTimer);
      domTimer = setTimeout(() => { const b = domBatch; domBatch = []; send({ type: 'tweets:dom', tweets: b }); }, 1200);
      send({ type: 'x:status', loggedIn: true });
    }
  }

  // ---------------------------------------------------------------- Akış sekmesi (Takip edilenler / Sana özel)
  let feedTries = 0;
  function selectFeed() {
    if (!role?.collector || location.pathname !== '/home') return;
    const list = document.querySelector('[data-testid="primaryColumn"] [role="tablist"]') || document.querySelector('[role="tablist"]');
    const tabs = list ? [...list.querySelectorAll('[role="tab"]')] : [];
    if (tabs.length >= 2) {
      const want = role.feed === 'foryou' ? tabs[0] : tabs[1];
      if (want.getAttribute('aria-selected') !== 'true') want.click();
      return;
    }
    if (++feedTries < 30) setTimeout(selectFeed, 700);
  }

  // ---------------------------------------------------------------- Giriş kontrolü
  function checkLogin() {
    const path = location.pathname;
    // 2026'da X giriş akışı /i/jf/onboarding/web?redirect_after_login=… adresine taşındı
    const loginPage = /^\/(i\/flow\/|i\/jf\/|login|signup|logout)/.test(path) || /redirect_after_login/.test(location.search);
    const loginBtn = document.querySelector('[data-testid="loginButton"], a[href="/login"]');
    const timeline = document.querySelector('[data-testid="primaryColumn"] article, [data-testid="primaryColumn"] [role="tablist"]');
    if (role?.collector && (loginPage || (loginBtn && !timeline))) {
      send({ type: 'x:status', loggedIn: false, note: 'X oturumu açık değil' });
    }
  }

  // ---------------------------------------------------------------- Odak kalkanı
  let shieldHost = null;
  let lastShieldPath = null;

  function evaluateShield() {
    if (!role) return;
    const path = location.pathname;
    if (role.collector) { showShield('collector'); return; }
    const want = role.shield?.enabled && !role.shield?.snoozed && SHIELD_PATHS.test(path);
    if (want) {
      if (lastShieldPath !== path) {
        lastShieldPath = path;
        send({ type: 'shield:hit' }).then((info) => showShield('focus', info || {}));
      }
    } else {
      lastShieldPath = null;
      hideShield();
    }
  }

  function hideShield() {
    if (shieldHost) { shieldHost.remove(); shieldHost = null; }
    document.documentElement.style.removeProperty('overflow');
  }

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }

  // Yerel append() null'u "null" yazısına çevirir; boş öğeleri atla
  const put = (parent, ...kids) => parent.append(...kids.filter((k) => k != null && k !== false));

  function showShield(kind, info = {}) {
    hideShield();
    shieldHost = document.createElement('xradio-shield');
    shieldHost.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:block;';
    const root = shieldHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    // Eklentinin "yayın konsolu" tasarımıyla aynı palet (sıcak koyu yüzey, tek vurgu: sinyal turuncusu)
    style.textContent = `
      :host{all:initial}
      .wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#121110;
        color:#ede9e3;font:15px/1.55 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;overflow:auto;-webkit-font-smoothing:antialiased}
      .card{max-width:560px;width:100%;background:#1a1917;border:1px solid #2f2c29;border-radius:14px;overflow:hidden}
      .head{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #2f2c29}
      .brand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:14px}
      .mark{width:26px;height:26px;border-radius:6px;display:grid;place-items:center;background:#ff5a1f;color:#1b0d05}
      .body{padding:24px 22px 22px}
      .onair{display:inline-flex;align-items:center;gap:7px;font:700 11px/1 "Cascadia Mono","SF Mono",ui-monospace,Menlo,Consolas,monospace;
        letter-spacing:.14em;text-transform:uppercase;height:26px;padding:0 10px;border-radius:4px;border:1px solid #3d3935;color:#7c766e}
      .onair.live{background:#ff5a1f;border-color:#ff5a1f;color:#1b0d05}
      .dot{width:7px;height:7px;border-radius:50%;background:currentColor}
      .onair.live .dot{animation:p 1.2s ease-in-out infinite}
      @keyframes p{50%{opacity:.25}}
      h1{font:650 25px/1.2 "Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 8px}
      p{margin:6px 0;color:#b0aaa1}
      .eyebrow{font:600 11px/1.2 "Cascadia Mono","SF Mono",ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em;text-transform:uppercase;color:#7c766e;margin:20px 0 6px}
      ul{list-style:none;padding:0;margin:0;border-top:1px solid #2f2c29}
      li{padding:9px 0;border-bottom:1px solid #2f2c29;font-size:14px;color:#ede9e3}
      .count{display:flex;align-items:center;gap:6px;font:500 12px/1.4 "Cascadia Mono","SF Mono",ui-monospace,Menlo,Consolas,monospace;color:#7c766e;margin-top:14px}
      .btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
      button{display:inline-flex;align-items:center;gap:7px;font:600 13.5px/1 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;height:38px;padding:0 14px;
        border-radius:6px;cursor:pointer;color:#ede9e3;background:#22201e;border:1px solid #3d3935}
      button:hover{background:#2b2926}
      button.primary{background:#ff5a1f;border-color:#ff5a1f;color:#1b0d05}
      button.primary:hover{background:#ff7341}
      button:focus-visible{outline:2px solid #ff8a5c;outline-offset:2px}
      svg{display:block;flex:none}
      .small{font-size:12px;color:#7c766e;margin-top:16px}
    `;
    root.append(style);
    const ICONS = globalThis.__xradioIcons || {};
    const ic = (name, size = 16) => {
      const s = document.createElement('span');
      s.style.cssText = 'display:inline-flex;line-height:0';
      s.innerHTML = ICONS[name] ? `<svg viewBox="0 0 256 256" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${ICONS[name]}</svg>` : '';
      return s;
    };
    const body = el('div', { class: 'body' });
    const card = el('div', { class: 'card' },
      el('div', { class: 'head' }, el('div', { class: 'brand' }, el('span', { class: 'mark' }, ic('broadcast-fill', 15)), 'XRadio')),
      body);
    const wrap = el('div', { class: 'wrap' }, card);
    root.append(wrap);
    const hosts = role?.hosts || ['Defne', 'Kaan'];
    // Metinler arka plandan yayın diline göre gelir; gelmezse Türkçe yedek
    const fallback = {
      shCollectorBadge: 'XRADIO DİNLEME NOKTASI', shCollectorTitle: 'Bu sekme senin yerine X\'i dinliyor',
      shCollectorText: `${hosts[0]} ve ${hosts[1]} gündemi buradan topluyor. Sekmeyi kapatma; akışa bakmana gerek yok.`,
      shOpenStudio: 'Stüdyoyu aç', shCollectorNote: 'Sekme birkaç dakikada bir kendini yeniler. Radyoyu durdurduğunda otomatik kapanır.',
      shOnAir: 'YAYINDA', shOff: 'RADYO KAPALI', shTitleOn: 'Gündemi senin için biz takip ediyoruz', shTitleOff: 'X\'e bakmak yerine radyoyu aç',
      shTextOn: `${hosts[0]} ve ${hosts[1]} akışını dinliyor; önemli bir şey olursa müziği kısıp söyleyecekler.`,
      shTextOff: 'XRadio akışındaki önemli gelişmeleri iki DJ\'in sohbetiyle anlatır; sen de işine odaklanırsın.',
      shRecent: 'Bugün konuşulanlar',
      shCount: 'Bugün X\'i açma denemen: {n}', shTalkNow: 'Gündemi şimdi anlatın', shStart: 'Radyoyu başlat',
      shClose: 'Sekmeyi kapat', shSnooze: '5 dk bakmam lazım', shNote: 'Belirli bir paylaşımın bağlantısını açarsan kalkan araya girmez. Ayarlardan kapatabilirsin.',
    };
    const S = (k) => (role?.ui && role.ui[k]) || fallback[k];

    if (kind === 'collector') {
      put(body,
        el('div', { class: 'onair live' }, el('span', { class: 'dot' }), S('shCollectorBadge')),
        el('h1', { style: 'margin-top:16px' }, S('shCollectorTitle')),
        el('p', {}, S('shCollectorText')),
        el('div', { class: 'btns' },
          el('button', { class: 'primary', onclick: () => send({ type: 'openStudio' }) }, ic('app-window'), S('shOpenStudio')),
        ),
        el('p', { class: 'small' }, S('shCollectorNote')),
      );
    } else {
      const heads = (info.headlines || []).slice(0, 4);
      put(body,
        el('div', { class: 'onair' + (info.radioOn ? ' live' : '') }, el('span', { class: 'dot' }), info.radioOn ? S('shOnAir') : S('shOff')),
        el('h1', { style: 'margin-top:16px' }, info.radioOn ? S('shTitleOn') : S('shTitleOff')),
        el('p', {}, info.radioOn ? S('shTextOn') : S('shTextOff')),
        heads.length ? el('div', { class: 'eyebrow' }, S('shRecent')) : null,
        heads.length ? el('ul', {}, ...heads.map((h) => el('li', {}, h.headline))) : null,
        el('div', { class: 'count' }, ic('clock-counter-clockwise', 14), S('shCount').replace('{n}', String(info.count || 1))),
        el('div', { class: 'btns' },
          info.radioOn
            ? el('button', { class: 'primary', onclick: () => { send({ type: 'cmd', cmd: 'talkNow' }); send({ type: 'closeMe' }); } }, ic('microphone-fill'), S('shTalkNow'))
            : el('button', { class: 'primary', onclick: () => { send({ type: 'cmd', cmd: 'start' }); send({ type: 'closeMe' }); } }, ic('play-fill'), S('shStart')),
          el('button', { onclick: () => send({ type: 'closeMe' }) }, S('shClose')),
          el('button', { onclick: async () => { await send({ type: 'shield:snooze' }); role.shield.snoozed = true; hideShield(); } }, S('shSnooze')),
        ),
        el('p', { class: 'small' }, S('shNote')),
      );
    }
    (document.body || document.documentElement).append(shieldHost);
    if (kind !== 'collector') document.documentElement.style.setProperty('overflow', 'hidden');
  }

  // ---------------------------------------------------------------- Döngü
  let lastPath = location.pathname;
  function onReady() {
    hello().then(() => { selectFeed(); });
    const obs = new MutationObserver(() => {
      if (!collecting()) return;
      clearTimeout(obs.t);
      obs.t = setTimeout(scanDom, 800);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(() => {
      if (location.pathname !== lastPath) { lastPath = location.pathname; evaluateShield(); selectFeed(); checkLogin(); }
      scanDom();
    }, 10000);
    setTimeout(checkLogin, 12000);
    // Kalkan, gövde yeniden çizilince kaybolursa geri koy
    setInterval(() => { if (shieldHost && !shieldHost.isConnected) (document.body || document.documentElement).append(shieldHost); }, 1500);
  }

  // Kalkanı mümkün olan en erken anda göster (akış görünmeden)
  hello();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
  else onReady();
})();
