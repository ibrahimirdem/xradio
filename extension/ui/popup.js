import { bg, cmd, onStationEvent, getSettings, saveSettings, $, h, toast, clock, cleanTitle, phaseText, connectViz, makeBars, captionNodes, kindLabel, applyTheme, setButton, tag, noticeBox } from './common.js';
import { t, setUiLang, applyI18n, uiLocale } from './i18n.js';
import { applyIcons, iconSvg } from './icons.js';
import { langInfo } from '../lib/config.js';

let state = null;
let settings = null;
const setBars = makeBars($('#bars'), 26);

// X sayfasının içinde açıldıysa (content/x-dock.js): pencere kapatmak yerine çerçeveye haber verilir
const params = new URLSearchParams(location.search);
const EMBED = params.has('embed') && window.top !== window;
const XTHEME = ['dark', 'light'].includes(params.get('xtheme')) ? params.get('xtheme') : '';
const parentOrigin = (() => {
  const o = location.ancestorOrigins?.[0] || '';
  return /^https:\/\/(x|twitter)\.com$/.test(o) ? o : '*';
})();
const toParent = (msg) => { try { window.parent.postMessage({ ...msg }, parentOrigin); } catch { /* */ } };
function closeUi() {
  if (EMBED) toParent({ xradio: 'close' });
  else window.close();
}

/** Çerçeve yüksekliği içeriğe göre ayarlansın diye boyut bildirilir. */
function reportSize() {
  if (!EMBED) return;
  let last = 0;
  const post = () => {
    const h = Math.ceil(document.body.getBoundingClientRect().height);
    if (h && Math.abs(h - last) > 1) { last = h; toParent({ xradio: 'size', h }); }
  };
  new ResizeObserver(post).observe(document.body);
  post();
}

function renderHosts() {
  const A = settings.hostA; const B = settings.hostB;
  $('#dj-a .ini').textContent = (A.name || 'A')[0].toLocaleUpperCase(uiLocale());
  $('#dj-b .ini').textContent = (B.name || 'B')[0].toLocaleUpperCase(uiLocale());
  $('#dj-a .djname').textContent = A.name;
  $('#dj-b .djname').textContent = B.name;
  $('#station-name').textContent = settings.stationName || 'XRadio';
}

/** Dil henüz onaylanmadıysa: "Yayın dili: Türkçe · Değiştir · Tamam" şeridi. */
function renderLangBanner() {
  const box = $('#lang-banner');
  if (settings.languageConfirmed) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = '';
  const text = h('span', { class: 'text' }, `${t('Yayın dili')}: `, h('b', {}, langInfo(settings.language).native));
  text.insertAdjacentHTML('afterbegin', iconSvg('globe-simple', { size: 15 }));
  box.append(
    text,
    h('button', { class: 'ghost sm', onclick: () => { bg('openStudio', { hash: '#hosgeldin' }); closeUi(); } }, t('Değiştir')),
    h('button', { class: 'sm', onclick: async () => { await saveSettings({ languageConfirmed: true }); settings.languageConfirmed = true; renderLangBanner(); } }, t('Tamam')),
  );
}

let lastToggle = '';
function render() {
  const st = state || {};
  const on = !!st.on;
  const talking = st.phase === 'talking';
  const breaking = talking && st.segment?.kind === 'breaking';
  $('#onair').className = 'onair' + (breaking ? ' breaking' : talking ? ' live' : on ? ' music' : '');
  $('#onair-text').textContent = talking ? (breaking ? t('SON DAKİKA') : t('CANLI')) : on ? t('YAYINDA') : t('KAPALI');
  const tg = $('#toggle');
  const want = on ? 'stop' : 'play';
  if (lastToggle !== want) {
    lastToggle = want;
    setButton(tg, on ? 'stop-fill' : 'play-fill', on ? t('Yayını durdur') : t('Yayını başlat'));
    tg.className = 'lg ' + (on ? 'live-stop' : 'primary');
  }
  $('#phase').textContent = phaseText(st);

  const np = st.nowPlaying;
  if (np && on) {
    $('#np-title').textContent = cleanTitle(np.title) || t('Müzik');
    $('#np-sub').textContent = [np.artist, np.queue ? `${np.queue.name || t('Listem')} ${np.queue.index}/${np.queue.total}` : np.styleLabel].filter(Boolean).join(' · ');
  } else {
    $('#np-title').textContent = on ? (st.musicStatus?.text || t('Müzik yükleniyor…')) : t('Müzik bekleniyor');
    $('#np-sub').textContent = on ? '' : t('YouTube canlı yayını / oynatma listesi');
  }

  const caps = st.captions || [];
  const box = $('#captions');
  if (caps.length) {
    box.innerHTML = '';
    caps.slice(-3).forEach((c, i, arr) => box.append(h('div', { class: `caption ${c.speaker === 'B' ? 'b-speaker' : ''} ${i < arr.length - 1 ? 'old' : ''}` }, h('b', {}, c.name + ' '), ...captionNodes(c.text, c.speaker === 'A' ? settings.hostB.name : settings.hostA.name))));
  }

  const status = $('#status');
  status.innerHTML = '';
  const tags = [];
  tags.push(st.engine === 'gemini' ? tag('Gemini', 'accent', 'brain') : tag(t('Yerel zekâ'), '', 'cpu'));
  tags.push(tag(st.voiceMode === 'gemini' ? t('Gemini sesi') : t('Tarayıcı sesi'), '', 'waveform'));
  tags.push(tag(langInfo(settings.language).native, '', 'globe-simple'));
  if (st.demo) tags.push(tag('Demo', 'warn', 'flask'));
  const c = st.collector;
  if (c?.loggedIn === false) tags.push(tag(t('X girişi gerekli'), 'danger', 'x-logo'));
  else if (c?.lastAt) tags.push(tag(clock(c.lastAt), 'ok', 'x-logo'));
  if (st.stats) tags.push(tag(t('{a} bekleyen · {b} anlatıldı', { a: st.stats.pending || 0, b: st.stats.covered || 0 }), '', 'stack-simple'));
  status.append(...tags);
  if (st.audioBlocked) status.prepend(noticeBox(t('Ses başlatılamadı — Stüdyo sayfasından "Başlat"a tıkla.'), true));
}

function setSpeaking(speaker) {
  $('#dj-a').classList.toggle('speaking', speaker === 'A');
  $('#dj-b').classList.toggle('speaking', speaker === 'B');
}

async function refresh() {
  state = await bg('getState');
  render();
}

async function loadRecent() {
  const board = await bg('getBoard');
  const covered = (board?.stories || []).filter((s) => s.coveredAt).sort((a, b) => b.coveredAt - a.coveredAt).slice(0, 4);
  const ul = $('#recent');
  ul.innerHTML = '';
  if (!covered.length) { ul.append(h('li', { class: 'dim' }, t('Henüz bir şey konuşulmadı.'))); return; }
  for (const s of covered) {
    const link = s.tweets?.[0]?.url;
    ul.append(h('li', {}, h('span', { class: 't' }, clock(s.coveredAt)), link ? h('a', { href: link, target: '_blank', title: t('Kaynağı X\'te aç') }, s.headline) : h('span', {}, s.headline)));
  }
}

async function init() {
  if (EMBED) {
    document.documentElement.classList.add('embed');
    $('#close-embed').classList.remove('hidden');
    $('#close-embed').addEventListener('click', closeUi);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeUi(); });
  }
  settings = await getSettings();
  // X'in içinde ve tema "sistem" ise X'in temasına uy
  applyTheme(EMBED && settings.theme === 'system' && XTHEME ? XTHEME : settings.theme);
  setUiLang(settings.language);
  applyI18n(document);
  applyIcons(document);
  renderHosts();
  renderLangBanner();
  $('#vol-music').value = settings.musicVolume;
  $('#vol-voice').value = settings.voiceVolume;
  await refresh();
  loadRecent();
  reportSize();

  $('#toggle').addEventListener('click', async () => {
    $('#toggle').disabled = true;
    const r = await cmd(state?.on ? 'stop' : 'start');
    $('#toggle').disabled = false;
    if (r?.error) toast(r.error);
    await refresh();
  });
  $('#talk').addEventListener('click', async () => {
    const r = await cmd('talkNow');
    toast(r?.text || t('DJ\'ler hazırlanıyor…'));
    refresh();
  });
  $('#skip').addEventListener('click', async () => { const r = await cmd('skip'); toast(r?.text || t('Atlandı')); });
  $('#open-studio').addEventListener('click', () => { bg('openStudio'); closeUi(); });
  let volTimer;
  const onVol = () => {
    clearTimeout(volTimer);
    volTimer = setTimeout(() => saveSettings({ musicVolume: +$('#vol-music').value, voiceVolume: +$('#vol-voice').value }), 250);
  };
  $('#vol-music').addEventListener('input', onVol);
  $('#vol-voice').addEventListener('input', onVol);

  onStationEvent((event, data) => {
    if (event === 'state') { state = { ...state, ...data }; render(); }
    else if (event === 'caption') {
      state = state || {};
      state.captions = [...(state.captions || []), data].slice(-12);
      setSpeaking(data.speaker);
      render();
    } else if (event === 'segment') {
      if (data.state === 'end') { setSpeaking(null); loadRecent(); }
      if (data.state === 'start') toast(`${kindLabel(data.kind)}: ${data.title || ''}`);
    } else if (event === 'track') refresh();
    else if (event === 'notice') toast(data.text, 4000);
  });

  connectViz((d) => {
    setBars(d.bands);
    if (d.talking) setSpeaking(d.speaker); else setSpeaking(null);
  });
  setInterval(refresh, 5000);
}

init();
