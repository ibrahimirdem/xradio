import { bg, cmd, onStationEvent, getSettings, saveSettings, $, h, toast, clock, cleanTitle, phaseText, connectViz, makeBars, captionNodes, kindLabel } from './common.js';
import { t, setUiLang, applyI18n, uiLocale } from './i18n.js';
import { langInfo } from '../lib/config.js';

let state = null;
let settings = null;
const setBars = makeBars($('#bars'), 22);

function renderHosts() {
  const A = settings.hostA; const B = settings.hostB;
  $('#dj-a .ini').textContent = (A.name || 'A')[0].toLocaleUpperCase(uiLocale());
  $('#dj-b .ini').textContent = (B.name || 'B')[0].toLocaleUpperCase(uiLocale());
  $('#dj-a .djname').textContent = A.name;
  $('#dj-b .djname').textContent = B.name;
  $('#station-name').textContent = settings.stationName || 'XRadio';
}

/** Dil henüz onaylanmadıysa: "Dil: Türkçe · Değiştir" şeridi. */
function renderLangBanner() {
  const box = $('#lang-banner');
  if (settings.languageConfirmed) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = '';
  box.append(
    h('span', {}, `🌐 ${t('Yayın dili')}: `, h('b', {}, langInfo(settings.language).native)),
    h('button', { class: 'ghost', onclick: () => { bg('openStudio', { hash: '#hosgeldin' }); window.close(); } }, t('Değiştir')),
    h('button', { class: 'ghost', onclick: async () => { await saveSettings({ languageConfirmed: true }); settings.languageConfirmed = true; renderLangBanner(); } }, t('Tamam')),
  );
}

function render() {
  const st = state || {};
  const on = !!st.on;
  const talking = st.phase === 'talking';
  const onair = $('#onair');
  onair.className = 'onair' + (talking ? ' live' : on ? ' music' : '');
  $('#onair-text').textContent = talking ? (st.segment?.kind === 'breaking' ? t('SON DAKİKA') : t('CANLI')) : on ? t('YAYINDA') : t('KAPALI');
  $('#toggle').textContent = on ? t('■ Yayını durdur') : t('▶ Yayını başlat');
  $('#toggle').classList.toggle('primary', !on);
  $('#toggle').classList.toggle('danger', on);
  $('#phase').textContent = phaseText(st);

  const np = st.nowPlaying;
  if (np && on) {
    $('#np-title').textContent = cleanTitle(np.title) || t('Müzik');
    $('#np-sub').textContent = [np.artist, np.styleLabel].filter(Boolean).join(' · ');
  } else {
    $('#np-title').textContent = on ? (st.musicStatus?.text || t('Müzik yükleniyor…')) : t('Müzik bekleniyor');
    $('#np-sub').textContent = on ? '' : t('YouTube canlı yayını / oynatma listesi');
  }

  const caps = st.captions || [];
  const box = $('#captions');
  if (caps.length) {
    box.innerHTML = '';
    caps.slice(-3).forEach((c, i, arr) => box.append(h('div', { class: `caption ${c.speaker === 'B' ? 'b-speaker' : ''} ${i < arr.length - 1 ? 'old' : ''}` }, h('b', {}, c.name + ': '), ...captionNodes(c.text, c.speaker === 'A' ? settings.hostB.name : settings.hostA.name))));
  }

  const status = $('#status');
  status.innerHTML = '';
  const chips = [];
  chips.push(h('span', { class: `chip ${st.engine === 'gemini' ? 'violet' : ''}` }, st.engine === 'gemini' ? '✦ Gemini' : t('Yerel zekâ')));
  chips.push(h('span', { class: 'chip' }, st.voiceMode === 'gemini' ? `🔊 ${t('Gemini sesi')}` : `🔊 ${t('Tarayıcı sesi')}`));
  chips.push(h('span', { class: 'chip' }, `🌐 ${langInfo(settings.language).native}`));
  if (st.demo) chips.push(h('span', { class: 'chip amber' }, 'DEMO'));
  const c = st.collector;
  if (c?.loggedIn === false) chips.push(h('span', { class: 'chip red' }, t('X girişi gerekli')));
  else if (c?.lastAt) chips.push(h('span', { class: 'chip green' }, `X ✓ ${clock(c.lastAt)}`));
  if (st.stats) chips.push(h('span', { class: 'chip' }, t('{a} bekleyen · {b} anlatıldı', { a: st.stats.pending || 0, b: st.stats.covered || 0 })));
  status.append(...chips);
  if (st.audioBlocked) status.prepend(h('div', { class: 'notice' }, t('Ses başlatılamadı — Stüdyo sayfasından "Başlat"a tıkla.')));
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
  settings = await getSettings();
  setUiLang(settings.language);
  applyI18n(document);
  renderHosts();
  renderLangBanner();
  $('#vol-music').value = settings.musicVolume;
  $('#vol-voice').value = settings.voiceVolume;
  await refresh();
  loadRecent();

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
  $('#open-studio').addEventListener('click', () => { bg('openStudio'); window.close(); });
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
