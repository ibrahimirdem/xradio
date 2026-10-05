// Stüdyo → Müzik sekmesi: YouTube / YouTube Music'te arama, kişisel liste ("Listem"), çalma listesi içe aktarma,
// hazır yayınlar. Liste ayarlarda (settings.myList) saklanır; istasyon onu görüntüsüz bir kuyruk olarak çalar.
import { h, $, toast, setButton, tag, cmd } from './common.js';
import { t } from './i18n.js';
import { iconSvg } from './icons.js';
import { ytSearch, ytPlaylist, ytVideoInfo, toTrack, formatDuration, MAX_LIST } from '../lib/ytsearch.js';
import { parseYouTubeUrl, YT_PRESETS } from '../lib/youtube.js';

let ctx = null;          // { settings(), save(patch) → Promise }
let kind = 'songs';
let query = '';
let ctrl = null;
let results = [];
let openList = null;     // açılmış çalma listesi { listId, title, items }
let nowId = null;        // çalan parçanın kimliği (Listem'de vurgulanır)

const S = () => ctx.settings();
const myList = () => (Array.isArray(S().myList) ? S().myList : []); // eski ayarlarda alan olmayabilir
const REGION = { tr: 'TR', en: 'US', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pt: 'BR', nl: 'NL', az: 'AZ', ru: 'RU', uk: 'UA', ar: 'SA', fa: 'IR', ja: 'JP', ko: 'KR' };
const region = () => ({ hl: S().language || 'tr', gl: REGION[S().language] || 'US' });
const SUGGEST = ['lofi', 'jazz', 'Tarkan', 'Sezen Aksu', 'synthwave', 'classical piano'];

function btn(iconName, label, onclick, cls = '') {
  const b = h('button', { type: 'button', class: cls, onclick });
  setButton(b, iconName, label, { size: 15 });
  return b;
}
function iconBtn(iconName, title, onclick, cls = '') {
  const b = h('button', { type: 'button', class: 'icon sm ghost ' + cls, title, 'aria-label': title, onclick });
  b.innerHTML = iconSvg(iconName, { size: 15 });
  return b;
}

// ------------------------------------------------------------------ başlat
export function initLibrary(c) {
  ctx = c;
  $('#lib-form').addEventListener('submit', (e) => { e.preventDefault(); search($('#lib-q').value); });
  for (const b of document.querySelectorAll('#lib-kinds button')) {
    b.addEventListener('click', () => {
      kind = b.dataset.kind;
      document.querySelectorAll('#lib-kinds button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      if (query) search(query);
    });
  }
  $('#lib-import').addEventListener('submit', (e) => { e.preventDefault(); importUrl($('#lib-import-url').value); });
  $('#lib-play').addEventListener('click', () => playList());
  $('#lib-shuffle').addEventListener('click', async () => { await ctx.save({ myListShuffle: !S().myListShuffle }); renderList(); });
  $('#lib-clear').addEventListener('click', async () => {
    if (!myList().length || !confirm(t('Listendeki tüm parçalar silinsin mi?'))) return;
    await ctx.save({ myList: [] });
    renderList();
  });
  renderSuggestions();
  renderList();
  renderPresets();
}

/** Ayarlar başka yerden değiştiyse (ör. başka sekme) listeyi tazele. */
export function refreshLibrary() {
  if (!ctx || dragging) return;
  renderList();
  renderPresets();
  if (results.length) renderResults();
}

/** Çalan parça değişti: Listem'de vurgula, sayfa başlığında göster. */
export function libraryNowPlaying(np, on) {
  const id = on && np?.trackId ? np.trackId : null;
  const box = $('#lib-now');
  if (box) {
    box.innerHTML = '';
    if (on && np) {
      box.insertAdjacentHTML('beforeend', iconSvg('music-notes', { size: 15 }));
      box.append(h('span', { class: 'np-t' }, np.title || ''), np.artist ? h('span', { class: 'dim' }, ' · ' + np.artist) : '');
      box.append(iconBtn('skip-forward-fill', t('Atla'), async () => { const r = await cmd('skip'); toast(r?.text || t('Atlandı')); }));
    }
  }
  if (id === nowId) return;
  nowId = id;
  for (const li of document.querySelectorAll('#lib-tracks li')) li.classList.toggle('playing', li.dataset.id === nowId);
}

// ------------------------------------------------------------------ arama
async function search(q) {
  query = String(q || '').trim();
  openList = null;
  if (!query) { results = []; renderSuggestions(); return; }
  ctrl?.abort();
  ctrl = new AbortController();
  const box = $('#lib-results');
  box.replaceChildren(h('div', { class: 'lib-state' }, h('span', { class: 'spinner' }), ' ', t('Aranıyor…')));
  try {
    // Bağlantı yapıştırıldıysa: video → tek sonuç, çalma listesi → içeriğini aç
    const parsed = parseYouTubeUrl(query);
    if (parsed?.listId && !parsed.videoId) { await showPlaylist({ listId: parsed.listId, title: '' }); return; }
    if (parsed?.videoId) results = [await ytVideoInfo(parsed.videoId, { signal: ctrl.signal })];
    else results = await ytSearch(query, kind, { ...region(), signal: ctrl.signal });
    renderResults();
  } catch (e) {
    if (e.name === 'AbortError') return;
    box.replaceChildren(h('div', { class: 'lib-state error' }, t('Arama yapılamadı: {e}', { e: e.message })));
  }
}

function renderSuggestions() {
  const box = $('#lib-results');
  const art = h('div', { class: 'lib-art' });
  art.innerHTML = iconSvg('vinyl-record', { size: 40 });
  box.replaceChildren(h('div', { class: 'lib-empty' }, art,
    h('div', { class: 'muted' }, t('Şarkı, sanatçı ya da yayın ara; bir YouTube bağlantısı da yapıştırabilirsin.')),
    h('div', { class: 'chips' }, ...SUGGEST.map((s) => h('button', { type: 'button', class: 'sm', onclick: () => { $('#lib-q').value = s; search(s); } }, s)))));
}

function renderResults() {
  const box = $('#lib-results');
  box.innerHTML = '';
  if (!results.length) { box.append(h('div', { class: 'lib-state' }, t('Sonuç bulunamadı.'))); return; }
  const inList = new Set(myList().map((x) => x.id));
  const ul = h('ul', { class: 'rows' });
  for (const x of results) ul.append(x.kind === 'playlist' ? playlistRow(x) : resultRow(x, inList.has(x.id)));
  box.append(ul);
}

function thumbEl(x, onPlay) {
  const wrap = h('div', { class: 'thumb' + (x.kind === 'song' ? ' sq' : '') });
  if (x.thumb) wrap.append(h('img', { src: x.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }));
  if (onPlay) {
    const p = h('button', { type: 'button', class: 'thumb-play', title: t('Şimdi çal'), 'aria-label': t('Şimdi çal'), onclick: onPlay });
    p.innerHTML = iconSvg('play-fill', { size: 16 });
    wrap.append(p);
  }
  return wrap;
}

function resultRow(x, added) {
  const sub = [x.artist, x.album].filter(Boolean).join(' · ');
  const add = iconBtn(added ? 'check-bold' : 'plus-bold', added ? t('Listende') : t('Listeye ekle'), async () => {
    if (added) return;
    await addTracks([x]);
    renderResults();
  }, added ? 'added' : '');
  return h('li', { class: 'row-item' },
    thumbEl(x, () => playNow(x)),
    h('div', { class: 'meta' }, h('div', { class: 'title', title: x.title }, x.title), h('div', { class: 'sub' }, x.live ? tag(t('CANLI'), 'danger') : null, sub)),
    h('span', { class: 'dur' }, x.live ? '' : formatDuration(x.duration)),
    h('div', { class: 'acts' }, add));
}

function playlistRow(x) {
  return h('li', { class: 'row-item' },
    thumbEl(x, null),
    h('div', { class: 'meta' }, h('div', { class: 'title', title: x.title }, x.title), h('div', { class: 'sub' }, [x.artist, x.count ? t('{n} parça', { n: x.count }) : ''].filter(Boolean).join(' · '))),
    h('span', { class: 'dur' }),
    h('div', { class: 'acts' },
      btn('list-plus', t('Aç'), () => showPlaylist(x), 'sm'),
      iconBtn('play-fill', t('Bu listeyi çal'), () => playYouTube(`https://www.youtube.com/playlist?list=${x.listId}`, x.title))));
}

/** Çalma listesinin içeriğini göster: tek tek ya da hepsini ekle, olduğu gibi çal. */
async function showPlaylist(x) {
  const box = $('#lib-results');
  box.replaceChildren(h('div', { class: 'lib-state' }, h('span', { class: 'spinner' }), ' ', t('Çalma listesi yükleniyor…')));
  try {
    const pl = await ytPlaylist(x.listId, { ...region(), limit: 200 });
    openList = { listId: x.listId, title: pl.title || x.title, items: pl.items };
    renderOpenList();
  } catch (e) {
    box.replaceChildren(h('div', { class: 'lib-state error' }, t('Çalma listesi açılamadı: {e}', { e: e.message })));
  }
}

function renderOpenList() {
  const box = $('#lib-results');
  const { listId, title, items } = openList;
  const inList = new Set(myList().map((x) => x.id));
  const back = iconBtn('arrow-left', t('Sonuçlara dön'), () => { openList = null; results.length ? renderResults() : renderSuggestions(); });
  box.replaceChildren(
    h('div', { class: 'pl-head' }, results.length ? back : null,
      h('div', { class: 'grow' }, h('div', { class: 'title' }, title || t('Çalma listesi')), h('div', { class: 'sub' }, t('{n} parça', { n: items.length }))),
      btn('list-plus', t('Hepsini listeme ekle'), async () => { await addTracks(items); renderOpenList(); }, 'sm'),
      btn('play-fill', t('Bu listeyi çal'), () => playYouTube(`https://www.youtube.com/playlist?list=${listId}`, title), 'sm primary')),
    items.length ? h('ul', { class: 'rows' }, ...items.map((x) => resultRow(x, inList.has(x.id)))) : h('div', { class: 'lib-state' }, t('Bu listede çalınabilir parça yok.')));
}

async function importUrl(url) {
  const p = parseYouTubeUrl(url);
  if (!p || (!p.listId && !p.videoId)) { toast(t('Geçerli bir YouTube bağlantısı değil')); return; }
  $('#lib-import-url').value = '';
  if (p.listId) {
    try {
      const pl = await ytPlaylist(p.listId, { ...region(), limit: 300 });
      if (!pl.items.length) { toast(t('Bu listede çalınabilir parça yok.')); return; }
      await addTracks(pl.items);
    } catch (e) { toast(t('Çalma listesi açılamadı: {e}', { e: e.message }), 4000); }
  } else {
    try { await addTracks([await ytVideoInfo(p.videoId)]); } catch (e) { toast(e.message, 4000); }
  }
}

// ------------------------------------------------------------------ liste işlemleri
async function addTracks(list) {
  const cur = myList();
  const have = new Set(cur.map((x) => x.id));
  const fresh = list.map(toTrack).filter((x) => x && !have.has(x.id) && have.add(x.id));
  if (!fresh.length) { toast(t('Bu parçalar zaten listende')); return 0; }
  const next = [...cur, ...fresh].slice(0, MAX_LIST);
  const added = next.length - cur.length;
  await ctx.save({ myList: next });
  renderList();
  toast(added < fresh.length ? t('{n} parça eklendi (liste en fazla {max} parça)', { n: added, max: MAX_LIST }) : t('{n} parça listene eklendi', { n: added }));
  return added;
}

/** Arama sonucunu hemen çal: canlı yayın doğrudan çalar, şarkı/video listeye eklenip oradan çalar. */
async function playNow(x) {
  if (x.live) { await playYouTube(`https://www.youtube.com/watch?v=${x.id}`, x.title); return; }
  // Liste ve kaynak tek kayıtta: istasyon bir kez güncellenir
  const patch = { musicSource: 'mylist' };
  const tr = toTrack(x);
  if (tr && !myList().some((y) => y.id === x.id)) patch.myList = [...myList(), tr].slice(0, MAX_LIST);
  await ctx.save(patch);
  renderList();
  const r = await cmd('playTrack', { id: x.id });
  if (r?.error) toast(r.error, 4000); else toast(t('Çalıyor: {title}', { title: x.title }));
}

async function playYouTube(url, title) {
  await ctx.save({ musicSource: 'youtube', youtubeUrl: url });
  renderPresets();
  toast(t('Çalıyor: {title}', { title: title || 'YouTube' }));
}

async function playList(startId = null) {
  const list = myList();
  if (!list.length) { toast(t('Önce listene parça ekle')); return; }
  await ctx.save({ musicSource: 'mylist' });
  const r = await cmd('playTrack', { id: startId || (nowId && list.some((x) => x.id === nowId) ? nowId : list[0].id) });
  if (r?.error) toast(r.error, 4000);
  renderList();
}

async function move(id, delta) {
  const list = myList().slice();
  const i = list.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await ctx.save({ myList: list });
  renderList();
  document.querySelector(`#lib-tracks li[data-id="${id}"] .mv-${delta < 0 ? 'up' : 'down'}`)?.focus();
}

async function remove(id) {
  await ctx.save({ myList: myList().filter((x) => x.id !== id) });
  renderList();
  if (results.length || openList) openList ? renderOpenList() : renderResults();
}

// ------------------------------------------------------------------ Listem
let dragging = null;
function renderList() {
  const list = myList();
  const total = list.reduce((a, x) => a + (x.duration || 0), 0);
  $('#lib-count').textContent = list.length ? `${t('{n} parça', { n: list.length })}${total ? ' · ' + formatDuration(total) : ''}` : '';
  const shuf = $('#lib-shuffle');
  shuf.classList.toggle('on', !!S().myListShuffle);
  shuf.setAttribute('aria-pressed', String(!!S().myListShuffle));
  $('#lib-play').disabled = !list.length;
  $('#lib-clear').disabled = !list.length;
  const active = S().musicSource === 'mylist';
  $('#lib-source').textContent = active ? t('Şu an müzik kaynağı: Listem') : list.length ? t('Müzik kaynağı şu an Listem değil') : '';
  $('#lib-source').classList.toggle('on', active);
  const ol = $('#lib-tracks');
  ol.innerHTML = '';
  if (!list.length) {
    const art = h('div', { class: 'lib-art' });
    art.innerHTML = iconSvg('playlist', { size: 36 });
    ol.append(h('li', { class: 'lib-empty' }, art, h('div', { class: 'muted' }, t('Listen boş. Arayıp beğendiğin parçaları ekle; bir YouTube çalma listesini de aşağıdan içe aktarabilirsin.'))));
    return;
  }
  list.forEach((x, i) => {
    const li = h('li', { class: 'row-item track' + (x.id === nowId ? ' playing' : ''), draggable: 'true', 'data-id': x.id },
      h('span', { class: 'grip', title: t('Sürükleyerek sırala') }),
      h('span', { class: 'idx' }, String(i + 1)),
      thumbEl(x, () => playList(x.id)),
      h('div', { class: 'meta' }, h('div', { class: 'title', title: x.title }, x.title), h('div', { class: 'sub' }, x.live ? tag(t('CANLI'), 'danger') : null, x.artist || '')),
      h('span', { class: 'dur' }, x.live ? '' : formatDuration(x.duration)),
      h('div', { class: 'acts' },
        iconBtn('caret-up-bold', t('Yukarı taşı'), () => move(x.id, -1), 'mv-up'),
        iconBtn('caret-down-bold', t('Aşağı taşı'), () => move(x.id, +1), 'mv-down'),
        iconBtn('x-bold', t('Listeden çıkar'), () => remove(x.id), 'rm')));
    li.querySelector('.grip').innerHTML = iconSvg('dots-six-vertical-bold', { size: 14 });
    li.querySelector('.idx').insertAdjacentHTML('beforeend', iconSvg('waveform', { size: 14 }));
    li.addEventListener('dragstart', (e) => { dragging = x.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.id); });
    li.addEventListener('dragend', () => { dragging = null; li.classList.remove('dragging'); ol.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after')); });
    li.addEventListener('dragover', (e) => {
      if (!dragging || dragging === x.id) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      li.classList.toggle('drop-after', after);
      li.classList.toggle('drop-before', !after);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      const after = li.classList.contains('drop-after');
      li.classList.remove('drop-before', 'drop-after');
      const from = dragging; dragging = null;
      if (!from || from === x.id) return;
      const arr = myList().slice();
      const item = arr.splice(arr.findIndex((y) => y.id === from), 1)[0];
      arr.splice(arr.findIndex((y) => y.id === x.id) + (after ? 1 : 0), 0, item);
      await ctx.save({ myList: arr });
      renderList();
    });
    ol.append(li);
  });
}

// ------------------------------------------------------------------ hazır yayınlar
function renderPresets() {
  const box = $('#lib-presets');
  if (!box) return;
  box.innerHTML = '';
  const cur = S().musicSource === 'youtube' ? S().youtubeUrl : null;
  for (const p of YT_PRESETS) {
    const live = /\(canlı\)/.test(p.label);
    const name = p.label.replace(/\s*\((canlı|liste)\)\s*$/, '');
    const card = h('button', { type: 'button', class: 'preset' + (p.url === cur ? ' on' : ''), onclick: () => playYouTube(p.url, name) },
      h('span', { class: 'p-ic' }),
      h('span', { class: 'p-meta' }, h('span', { class: 'p-name' }, name), h('span', { class: 'p-sub' }, `${t(p.group)} · ${live ? t('canlı') : t('liste')}`)));
    card.querySelector('.p-ic').innerHTML = iconSvg(p.url === cur ? 'music-notes-fill' : (live ? 'broadcast' : 'playlist'), { size: 16 });
    box.append(card);
  }
}
