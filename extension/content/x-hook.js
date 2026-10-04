// XRadio — X sayfasının ana dünyasında (MAIN world) çalışır.
// X web uygulamasının kendi API yanıtlarını (zaman tüneli JSON'u) okur ve içerik betiğine iletir.
// İstek göndermez, hiçbir şeyi değiştirmez; yalnızca uygulamanın zaten aldığı yanıtın bir kopyasını okur.
(() => {
  if (window.__xradioHook) return;
  window.__xradioHook = true;

  const API = /\/i\/api\/|\/graphql\/|api\.(x|twitter)\.com/;
  const onHome = () => location.pathname === '/home' || document.documentElement.dataset.xradioCollector === '1';
  const post = (url, body) => {
    try { window.postMessage({ __xradio: 1, kind: 'json', url: String(url).slice(0, 300), body }, location.origin); } catch { /* */ }
  };

  const origFetch = window.fetch;
  window.fetch = function xradioFetch(input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (API.test(url) && onHome()) {
        p.then((res) => {
          const ct = res.headers.get('content-type') || '';
          if (!res.ok || !ct.includes('json')) return;
          res.clone().text().then((t) => { if (t.length < 12e6) post(url, t); }).catch(() => {});
        }).catch(() => {});
      }
    } catch { /* */ }
    return p;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xradioUrl = String(url || '');
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__xradioUrl && API.test(this.__xradioUrl) && onHome()) {
      this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          if (this.responseType === '' || this.responseType === 'text') post(this.__xradioUrl, this.responseText);
          else if (this.responseType === 'json' && this.response) post(this.__xradioUrl, JSON.stringify(this.response));
        } catch { /* */ }
      });
    }
    return send.apply(this, arguments);
  };
})();
