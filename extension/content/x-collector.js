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

  function showShield(kind, info = {}) {
    hideShield();
    shieldHost = document.createElement('xradio-shield');
    shieldHost.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:block;';
    const root = shieldHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host{all:initial}
      .wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;
        background:radial-gradient(1200px 600px at 20% 10%,#3b1d6e 0%,transparent 60%),radial-gradient(900px 500px at 90% 90%,#7a1d3a 0%,transparent 55%),#0b0a12;
        color:#f4f1ff;font:15px/1.5 "Segoe UI Variable","Segoe UI",system-ui,sans-serif;overflow:auto}
      .card{max-width:560px;width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:22px;padding:30px 28px;
        box-shadow:0 30px 80px rgba(0,0,0,.45);backdrop-filter:blur(8px)}
      .onair{display:inline-flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.14em;font-size:12px;color:#ff5d7a;
        border:1px solid rgba(255,93,122,.5);padding:4px 10px;border-radius:999px}
      .dot{width:8px;height:8px;border-radius:50%;background:#ff3b5c;box-shadow:0 0 12px #ff3b5c;animation:p 1.4s infinite}
      @keyframes p{50%{opacity:.35}}
      h1{font-size:26px;line-height:1.25;margin:16px 0 8px;font-weight:750}
      p{margin:6px 0;color:#cfc8e8}
      .count{font-size:13px;color:#a99fd0;margin-top:10px}
      ul{list-style:none;padding:0;margin:16px 0 4px}
      li{padding:9px 12px;border-radius:12px;background:rgba(255,255,255,.05);margin:6px 0;font-size:14px}
      .btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
      button{font:600 14px/1 inherit;border:0;border-radius:12px;padding:12px 16px;cursor:pointer;color:#fff;background:rgba(255,255,255,.12)}
      button.primary{background:linear-gradient(135deg,#8b5cf6,#ec4899)}
      button:hover{filter:brightness(1.12)}
      .small{font-size:12px;color:#8f86b5;margin-top:14px}
    `;
    root.append(style);
    const card = el('div', { class: 'card' });
    const wrap = el('div', { class: 'wrap' }, card);
    root.append(wrap);
    const hosts = role?.hosts || ['Defne', 'Kaan'];
    // Metinler arka plandan yayın diline göre gelir; gelmezse Türkçe yedek
    const fallback = {
      shCollectorBadge: 'XRADIO DİNLEME NOKTASI', shCollectorTitle: 'Bu sekme senin yerine X\'i dinliyor 🎧',
      shCollectorText: `${hosts[0]} ve ${hosts[1]} gündemi buradan topluyor. Sekmeyi kapatma; akışa bakmana gerek yok.`,
      shOpenStudio: '📻 Stüdyoyu aç', shCollectorNote: 'Sekme birkaç dakikada bir kendini yeniler. Radyoyu durdurduğunda otomatik kapanır.',
      shOnAir: 'YAYINDA', shOff: 'RADYO KAPALI', shTitleOn: 'Gündemi senin için biz takip ediyoruz 📻', shTitleOff: 'X\'e bakmak yerine radyoyu aç 📻',
      shTextOn: `${hosts[0]} ve ${hosts[1]} akışını dinliyor; önemli bir şey olursa müziği kısıp söyleyecekler.`,
      shTextOff: 'XRadio akışındaki önemli gelişmeleri iki DJ\'in sohbetiyle anlatır; sen de işine odaklanırsın.',
      shCount: 'Bugün X\'i açma denemen: {n}', shTalkNow: '🎙 Gündemi şimdi anlatın', shStart: '▶ Radyoyu başlat',
      shClose: 'Sekmeyi kapat', shSnooze: '5 dk bakmam lazım', shNote: 'Belirli bir paylaşımın bağlantısını açarsan kalkan araya girmez. Ayarlardan kapatabilirsin.',
    };
    const S = (k) => (role?.ui && role.ui[k]) || fallback[k];

    if (kind === 'collector') {
      card.append(
        el('div', { class: 'onair' }, el('span', { class: 'dot' }), S('shCollectorBadge')),
        el('h1', {}, S('shCollectorTitle')),
        el('p', {}, S('shCollectorText')),
        el('div', { class: 'btns' },
          el('button', { class: 'primary', onclick: () => send({ type: 'openStudio' }) }, S('shOpenStudio')),
        ),
        el('p', { class: 'small' }, S('shCollectorNote')),
      );
    } else {
      const heads = (info.headlines || []).slice(0, 4);
      card.append(
        el('div', { class: 'onair' }, el('span', { class: 'dot' }), info.radioOn ? S('shOnAir') : S('shOff')),
        el('h1', {}, info.radioOn ? S('shTitleOn') : S('shTitleOff')),
        el('p', {}, info.radioOn ? S('shTextOn') : S('shTextOff')),
        heads.length ? el('ul', {}, ...heads.map((h) => el('li', {}, '• ' + h.headline))) : null,
        el('div', { class: 'count' }, S('shCount').replace('{n}', String(info.count || 1))),
        el('div', { class: 'btns' },
          info.radioOn
            ? el('button', { class: 'primary', onclick: () => { send({ type: 'cmd', cmd: 'talkNow' }); send({ type: 'closeMe' }); } }, S('shTalkNow'))
            : el('button', { class: 'primary', onclick: () => { send({ type: 'cmd', cmd: 'start' }); send({ type: 'closeMe' }); } }, S('shStart')),
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
