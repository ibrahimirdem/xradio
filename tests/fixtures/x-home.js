// Sahte x.com/home sayfası (test). Gerçek X'in kullandığı data-testid yapısını taklit eder ve
// yüklendikten sonra uygulamanın yaptığı gibi bir GraphQL zaman tüneli isteği atar.

function snow(ms, salt) {
  return (((BigInt(ms) - 1288834974657n) << 22n) + BigInt(salt)).toString();
}

export function xHomeHtml(now = Date.now()) {
  const t1 = now - 7 * 60e3;
  const t2 = now - 3 * 60e3;
  const id1 = snow(t1, 501);
  const id2 = snow(t2, 502);
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Ana Sayfa / X</title></head>
<body>
<div data-testid="primaryColumn">
  <div role="tablist">
    <div role="tab" aria-selected="true" id="tab-foryou">Sana özel</div>
    <div role="tab" aria-selected="false" id="tab-following">Takip edilenler</div>
  </div>
  <section id="timeline">
    <article data-testid="tweet" role="article">
      <div data-testid="socialContext">Ayşe yeniden gönderi yayınladı</div>
      <div data-testid="User-Name"><a href="/sporhaber"><span>Spor Haber</span></a><a href="/sporhaber"><span>@sporhaber</span></a>
        <a href="/sporhaber/status/${id1}"><time datetime="${new Date(t1).toISOString()}">7 dk</time></a></div>
      <div data-testid="tweetText" lang="tr">Milli takım aday kadrosu açıklandı: 26 isimlik listede 4 yeni isim var.</div>
      <div role="group">
        <button data-testid="reply" aria-label="12 Yanıt"></button>
        <button data-testid="retweet" aria-label="1.234 yeniden gönderi"></button>
        <button data-testid="like" aria-label="5,1 B Beğeni"></button>
        <a href="/sporhaber/status/${id1}/analytics" aria-label="390 B görüntülenme"></a>
      </div>
    </article>
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><a href="/bilimci"><span>Bilim İnsanı</span></a><a href="/bilimci/status/${id2}"><time datetime="${new Date(t2).toISOString()}">3 dk</time></a></div>
      <div data-testid="tweetText" lang="tr">Bu harika bir keşif!</div>
      <div role="link" tabindex="0"><div data-testid="User-Name"><span>Bilim Kapsülü</span></div><div data-testid="tweetText">Gökbilimciler bir gezegenin atmosferinde su buharı buldu.</div></div>
      <div data-testid="tweetPhoto"><img alt="Gezegen çizimi" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>
      <div role="group"><button data-testid="like" aria-label="800 Beğeni"></button></div>
    </article>
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><a href="/reklamci"><span>Reklam Şirketi</span></a><span>Reklam</span></div>
      <div data-testid="tweetText">Hemen indir! (reklam — zaman damgası yok, atlanmalı)</div>
    </article>
  </section>
</div>
<script>
  window.__xFetches = 0;
  function load(kind) {
    fetch('/i/api/graphql/abc123/' + kind + '?variables=%7B%22count%22%3A20%7D', { headers: { 'content-type': 'application/json' } })
      .then((r) => r.json()).then(() => { window.__xFetches++; });
  }
  document.getElementById('tab-following').addEventListener('click', () => {
    document.getElementById('tab-foryou').setAttribute('aria-selected', 'false');
    document.getElementById('tab-following').setAttribute('aria-selected', 'true');
    window.__followingClicked = true;
    load('HomeLatestTimeline');
  });
  setTimeout(() => load('HomeTimeline'), 400);
</script>
</body></html>`;
}
