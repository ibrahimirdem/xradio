import { bg, cmd, onStationEvent, getSettings, saveSettings, backgroundIsStale, $, $$, h, toast, relTime, clock, cleanTitle, phaseText, connectViz, makeBars, captionNodes, kindLabel, categoryLabel, applyTheme, setButton, tag, noticeBox } from './common.js';
import { t, setUiLang, applyI18n, uiLocale } from './i18n.js';
import { applyIcons, iconSvg, icon } from './icons.js';
import { initLibrary, refreshLibrary, libraryNowPlaying } from './library.js';
import { GEMINI_VOICES, MUSIC_STYLES, DEFAULT_SETTINGS, LANGUAGES, mergeSettings, langInfo, personasFor, DEFAULT_PERSONAS, DEFAULT_PERSONAS_EN } from '../lib/config.js';
import { YT_PRESETS, parseYouTubeUrl, embedUrl } from '../lib/youtube.js';
import { GeminiClient, pickModels } from '../lib/gemini.js';
import { BrowserVoice } from '../lib/voice.js';
import { logList, kvGet, inboxCount } from '../lib/db.js';

let settings = null;
let state = null;
let lastSegId = null;
const setBars = makeBars($('#bars'), 28);

// ------------------------------------------------------------------ Sekmeler
function showTab() {
  const tab = (location.hash || '#yayin').slice(1);
  const valid = ['yayin', 'muzik', 'masa', 'gecmis', 'ayarlar', 'test', 'hosgeldin'];
  const cur = valid.includes(tab) ? tab : 'yayin';
  $$('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + cur));
  // Etkin sekmenin ikonu dolu (fill), diğerleri normal (regular) çizilir
  $$('#nav a').forEach((a) => {
    const active = a.dataset.tab === cur;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    a.querySelector('.nav-ic').innerHTML = iconSvg(active ? a.dataset.ic + '-fill' : a.dataset.ic, { size: 18 });
  });
  if (cur === 'masa') renderBoard();
  if (cur === 'gecmis') renderHistory();
  if (cur === 'ayarlar') renderSettings();
}
window.addEventListener('hashchange', showTab);

// ------------------------------------------------------------------ Dil
function languageSelect(onPick) {
  const sel = h('select', {}, ...LANGUAGES.map((l) => h('option', { value: l.code }, `${l.native}${l.native !== l.english ? ' — ' + l.english : ''}${l.local ? '' : ' ✦'}`)));
  sel.value = settings.language;
  sel.addEventListener('change', () => onPick(sel.value));
  return sel;
}

/** Dili değiştirir: varsayılan kişilikler yeni dile uyarlanır, sayfa yeni arayüz diliyle yeniden yüklenir. */
async function changeLanguage(code) {
  const isDefault = (p, which) => p === DEFAULT_PERSONAS[which] || p === DEFAULT_PERSONAS_EN[which];
  const P = personasFor(code);
  const patch = { language: code, languageConfirmed: true };
  if (isDefault(settings.hostA.persona, 'A')) patch.hostA = { ...settings.hostA, persona: P.A };
  if (isDefault(settings.hostB.persona, 'B')) patch.hostB = { ...settings.hostB, persona: P.B };
  await saveSettings(patch);
  location.reload();
}

// ------------------------------------------------------------------ Canlı yayın
function renderHosts() {
  const A = settings.hostA; const B = settings.hostB;
  $('#dj-a .ini').textContent = (A.name || 'A')[0].toLocaleUpperCase(uiLocale());
  $('#dj-b .ini').textContent = (B.name || 'B')[0].toLocaleUpperCase(uiLocale());
  $('#dj-a .djname').textContent = A.name;
  $('#dj-b .djname').textContent = B.name;
  $('#station-name').textContent = settings.stationName || 'XRadio';
  document.title = `${settings.stationName || 'XRadio'} ${t('Stüdyo')}`;
}

/** Var olan etiketin içeriğini (ikon + metin) ve türünü günceller. */
function setTag(el, text, kind = '', iconName = '') {
  el.className = 'tag' + (kind ? ' ' + kind : '') + (el.classList.contains('hidden') ? ' hidden' : '');
  el.innerHTML = iconName ? iconSvg(iconName, { size: 12 }) : '';
  el.append(text);
}

let lastToggle = '';
function renderToggle(on) {
  const want = on ? 'stop' : 'play';
  if (want === lastToggle) return;
  lastToggle = want;
  const tg = $('#toggle');
  setButton(tg, on ? 'stop-fill' : 'play-fill', on ? t('Yayını durdur') : t('Yayını başlat'));
  tg.className = 'lg ' + (on ? 'live-stop' : 'primary');
}

function renderLive() {
  const st = state || {};
  const on = !!st.on;
  const talking = st.phase === 'talking';
  const breaking = talking && st.segment?.kind === 'breaking';
  $('#onair').className = 'onair' + (breaking ? ' breaking' : talking ? ' live' : on ? ' music' : '');
  $('#onair-text').textContent = talking ? (breaking ? t('SON DAKİKA') : t('CANLI')) : on ? t('YAYINDA') : t('KAPALI');
  $('#phase').textContent = phaseText(st);
  $('#phase-sub').textContent = talking && st.segment ? `${kindLabel(st.segment.kind)}: ${st.segment.title || ''}` : on ? (st.time || '') : t('X akışını senin yerine dinleyip önemli gelişmeleri iki DJ\'in sohbetiyle anlatır.');
  renderToggle(on);

  setTag($('#chip-engine'), st.engine === 'gemini' ? `Gemini · ${st.models?.text || ''}` : t('Yerel zekâ (API anahtarı yok)'), st.engine === 'gemini' ? 'accent' : '', st.engine === 'gemini' ? 'brain' : 'cpu');
  setTag($('#chip-voice'), st.voiceMode === 'gemini' ? `Gemini TTS · ${st.models?.tts || ''}` : `${t('Tarayıcı sesi')}${st.browserVoices ? ' · ' + st.browserVoices.A.replace(/Microsoft |Online |\(Natural\)| - .*$/g, '') : ''}`, '', 'waveform');
  setTag($('#chip-lang'), langInfo(settings.language).native, '', 'globe-simple');
  setTag($('#chip-demo'), 'Demo', 'warn', 'flask');
  $('#chip-demo').classList.toggle('hidden', !st.demo);
  const c = st.collector;
  const cx = $('#chip-x');
  if (st.demo) setTag(cx, t('X: demo akışı'), 'warn', 'x-logo');
  else if (c?.loggedIn === false) setTag(cx, t('X: giriş yapılmamış!'), 'danger', 'x-logo');
  else if (c?.lastAt) setTag(cx, t('X ✓ son veri {when} · {n} paylaşım', { when: relTime(c.lastAt), n: c.total || 0 }), 'ok', 'x-logo');
  else setTag(cx, on ? t('X: ilk veri bekleniyor…') : t('X toplayıcı: beklemede'), '', 'x-logo');

  const voiceName = (id) => { const v = GEMINI_VOICES.find((x) => x.id === id); return v ? `${v.id} · ${t(v.desc)}` : id; };
  $('#voice-a').textContent = st.voiceMode === 'gemini' ? voiceName(settings.hostA.voice) : '';
  $('#voice-b').textContent = st.voiceMode === 'gemini' ? voiceName(settings.hostB.voice) : '';

  const np = st.nowPlaying;
  $('#np-title').textContent = on ? (np ? cleanTitle(np.title) : (st.musicStatus?.text || t('Müzik yükleniyor…'))) : t('Müzik bekleniyor');
  $('#np-sub').textContent = on && np ? [np.artist, np.queue ? `${np.queue.name || t('Listem')} ${np.queue.index}/${np.queue.total}` : np.styleLabel, np.mode === 'tab' ? t('sekme modu') : ''].filter(Boolean).join(' · ') : '';
  libraryNowPlaying(np, on);
  $('#music-status').textContent = st.musicStatus?.text ? `${t('Durum')}: ${st.musicStatus.text}` : '';

  const notice = $('#notice');
  const lastErr = st.errors?.at(-1);
  const showNotice = (content, error = false) => { notice.className = ''; notice.replaceChildren(noticeBox(content, error)); };
  if (st.audioBlocked) showNotice(t('Tarayıcı sesi başlatmayı engelledi. Bu sayfada "Yayını başlat"a bir kez daha tıkla.'));
  else if (c?.loggedIn === false && !st.demo) showNotice(h('span', {}, t('X oturumun açık görünmüyor.') + ' ', h('a', { href: 'https://x.com/login', target: '_blank' }, t('X\'e giriş yap')), ' ' + t('ya da Ayarlar\'dan demo modunu dene.')), true);
  else if (lastErr && Date.now() - lastErr.ts < 120e3) showNotice(`${t('Son uyarı')}: ${lastErr.msg}`);
  else notice.className = 'hidden';

  const s = st.stats || {};
  const u = st.usage || {};
  $('#stats').innerHTML = '';
  $('#stats').append(
    stat(st.inbox != null ? (s.tweets || 0) + (st.inbox || 0) : s.tweets || 0, t('paylaşım toplandı')),
    stat(s.stories || 0, t('hikâyeye ayrıldı')),
    stat(s.covered || 0, t('anlatıldı')),
    stat(s.pending || 0, t('sırada bekliyor')),
    stat(u.calls || 0, t('API çağrısı (bugün)')),
    stat(u.input || u.output ? `${Math.round(((u.input || 0) + (u.output || 0)) / 1000)}K` : '0', t('token (bugün)')),
  );
  const q = $('#queue');
  q.innerHTML = '';
  if (!on) q.textContent = '—';
  else {
    const items = [];
    const item = (ic, text, cls = '') => { const d = h('div', { class: 'q ' + cls }); d.insertAdjacentHTML('beforeend', iconSvg(ic, { size: 15 })); d.append(h('span', {}, text)); return d; };
    if (st.waitingFeed) items.push(item('cell-signal-medium', t('X akışından ilk veri bekleniyor')));
    if (st.preparing?.length) items.push(...st.preparing.filter((k) => k !== 'triage').map((k) => item('hourglass-medium', `${t('Hazırlanıyor')}: ${kindLabel(k)}`)));
    if (st.preparing?.includes('triage')) items.push(item('stack-simple', t('Yeni paylaşımlar sınıflandırılıyor')));
    if (st.queue?.length) items.push(...st.queue.map((x) => item('check-circle-fill', `${t('Hazır')}: ${kindLabel(x.kind)} — ${x.title}`, 'ready')));
    if (st.nextTalkAt && !talking) items.push(item('clock', t('Sonraki ara: ~{m} dk', { m: Math.max(0, Math.round((st.nextTalkAt - Date.now()) / 60000)) })));
    if (!items.length) items.push(item('music-notes', t('Müzik çalıyor.')));
    q.append(...items);
  }
}

function stat(v, k) { return h('div', { class: 'stat' }, h('div', { class: 'v' }, String(v)), h('div', { class: 'k' }, k)); }

function addSegmentHeader(data) {
  const box = $('#transcript');
  box.querySelector('.empty')?.remove();
  box.append(h('div', { class: 'seg-head' + (data.kind === 'breaking' ? ' breaking' : '') },
    h('span', {}, `${clock(data.ts || Date.now())} · ${kindLabel(data.kind)}`),
    data.title ? h('span', { class: 'seg-title' }, data.title) : null,
    data.voice ? tag(data.voice === 'gemini' ? 'Gemini' : t('tarayıcı'), '', 'waveform') : null));
  box.scrollTop = box.scrollHeight;
  $('#seg-title').textContent = data.title || '';
}

function addLine(c) {
  const box = $('#transcript');
  box.querySelector('.empty')?.remove();
  const listener = c.speaker === 'A' ? settings.hostB.name : settings.hostA.name;
  box.append(h('div', { class: 'line' + (c.speaker === 'B' ? ' b' : '') },
    h('div', { class: 'who' }, c.name),
    h('div', { class: 'said' }, ...captionNodes(c.text, listener))));
  while (box.children.length > 160) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

// ------------------------------------------------------------------ Mikser (canlı ses ayarları)
// Açılır penceredeki sürgülerle aynı ayarları yazar; istasyon ayar değişikliğini anında uygular.
const MIX = [
  { key: 'masterVolume', icon: 'speaker-high', label: 'Ana ses', max: 1 },
  { key: 'musicVolume', icon: 'music-notes', label: 'Müzik', max: 1 },
  { key: 'voiceVolume', icon: 'microphone', label: 'DJ sesi', max: 1.5 },
  { key: 'duckLevel', icon: 'waveform', label: 'Konuşurken müzik', max: 0.6 },
];
const pct = (v) => `${Math.round(v * 100)}%`;
let mixTimer = null;
let mixPending = {};

function saveMix(patch) {
  Object.assign(settings, patch);
  mixPending = { ...mixPending, ...patch };
  clearTimeout(mixTimer);
  mixTimer = setTimeout(() => { const p = mixPending; mixPending = {}; saveSettings(p); }, 200);
}

function renderMixer() {
  const box = $('#mixer');
  box.innerHTML = '';
  for (const m of MIX) {
    const out = h('output', { for: 'mix-' + m.key }, pct(settings[m.key]));
    const r = h('input', { type: 'range', id: 'mix-' + m.key, min: 0, max: m.max, step: 0.01, 'aria-label': t(m.label) });
    r.value = settings[m.key];
    r.addEventListener('input', () => { out.textContent = pct(+r.value); saveMix({ [m.key]: +r.value }); if (m.key === 'masterVolume') renderMute(); });
    const label = h('label', { for: 'mix-' + m.key });
    label.innerHTML = iconSvg(m.icon, { size: 15 });
    label.append(h('span', {}, t(m.label)));
    box.append(h('div', { class: 'mix-row' }, label, r, out));
  }
  renderMute();
}

/** Başka bir yerden (açılır pencere, Ayarlar) değişen değerleri sürgülere yansıtır; sürüklenen sürgüye dokunmaz. */
function syncMixer() {
  for (const m of MIX) {
    const r = $('#mix-' + m.key);
    if (!r || document.activeElement === r) continue;
    r.value = settings[m.key];
    r.nextElementSibling.textContent = pct(settings[m.key]);
  }
  renderMute();
}

let mutedFrom = null; // sessize almadan önceki ana ses
function renderMute() {
  const muted = (settings.masterVolume || 0) === 0;
  const b = $('#mix-mute');
  b.innerHTML = iconSvg(muted ? 'speaker-slash' : 'speaker-high', { size: 16 });
  b.title = muted ? t('Sesi aç') : t('Sessize al');
  b.setAttribute('aria-label', b.title);
  b.classList.toggle('on', muted);
}

function toggleMute() {
  const muted = (settings.masterVolume || 0) === 0;
  const v = muted ? (mutedFrom > 0 ? mutedFrom : 0.9) : 0;
  if (!muted) mutedFrom = settings.masterVolume;
  saveMix({ masterVolume: v });
  syncMixer();
}

function setSpeaking(sp) {
  $('#dj-a').classList.toggle('speaking', sp === 'A');
  $('#dj-b').classList.toggle('speaking', sp === 'B');
}

async function refresh() {
  state = await bg('getState');
  renderLive();
}

async function seedTranscript() {
  const logs = await logList({ since: Date.now() - 3 * 3600e3, limit: 3 }).catch(() => []);
  for (const l of logs.reverse()) {
    addSegmentHeader({ kind: l.kind, title: l.title, voice: l.voice, ts: l.ts });
    for (const ln of l.lines) addLine({ speaker: ln.speaker, name: ln.speaker === 'A' ? l.hosts?.A : l.hosts?.B, text: ln.text });
  }
}

function fillMusicSelect(sel, current) {
  sel.innerHTML = '';
  const groups = {};
  for (const p of YT_PRESETS) (groups[p.group] ||= []).push(p);
  for (const [g, list] of Object.entries(groups)) {
    const og = h('optgroup', { label: 'YouTube · ' + t(g) });
    for (const p of list) og.append(h('option', { value: 'yt:' + p.url }, p.label.replace('(canlı)', `(${t('canlı')})`).replace('(liste)', `(${t('liste')})`)));
    sel.append(og);
  }
  // Kişisel liste en üstte (Müzik sekmesinden oluşturulur)
  if (settings.myList?.length) sel.prepend(h('optgroup', { label: t('Listem') }, h('option', { value: 'mylist' }, t('Listem ({n} parça)', { n: settings.myList.length }))));
  const custom = YT_PRESETS.some((p) => p.url === settings.youtubeUrl) ? null : settings.youtubeUrl;
  if (custom) sel.append(h('optgroup', { label: t('Senin seçimin') }, h('option', { value: 'yt:' + custom }, t('Özel YouTube bağlantısı'))));
  sel.append(h('optgroup', { label: t('Diğer') },
    h('option', { value: 'generative' }, t('Yerleşik müzik (internetsiz yedek)')),
    h('option', { value: 'none' }, t('Müziksiz — sadece DJ\'ler'))));
  sel.value = current;
}

function musicValue() {
  if (settings.musicSource === 'youtube') return 'yt:' + settings.youtubeUrl;
  return settings.musicSource;
}

async function applyMusicValue(v) {
  if (v.startsWith('yt:')) await saveAndApply({ musicSource: 'youtube', youtubeUrl: v.slice(3) });
  else await saveAndApply({ musicSource: v });
  toast(t('Müzik değişti'));
}

// ------------------------------------------------------------------ Haber masası
async function renderBoard() {
  const b = await bg('getBoard');
  const stories = b?.stories || [];
  const st = b?.stats || {};
  $('#board-stats').textContent = t('{a} paylaşım · {b} hikâye · {c} bekleyen', { a: st.tweets || 0, b: st.stories || 0, c: st.pending || 0 });
  const pend = $('#board-pending'); const cov = $('#board-covered');
  pend.innerHTML = ''; cov.innerHTML = '';
  const minImp = settings.minImportance ?? 4;
  const p = stories.filter((s) => !s.coveredAt);
  const c = stories.filter((s) => s.coveredAt).sort((a, b2) => b2.coveredAt - a.coveredAt);
  if (!p.length) pend.append(h('div', { class: 'empty-box' }, t('Bekleyen hikâye yok.')));
  if (!c.length) cov.append(h('div', { class: 'empty-box' }, t('Henüz anlatılan yok.')));
  for (const s of p) pend.append(storyCard(s, s.importance < minImp));
  for (const s of c) cov.append(storyCard(s));
}

function storyCard(s, low = false) {
  const imp = h('span', { class: 'imp', title: t('Önem {n}/10', { n: s.importance }), 'aria-label': t('Önem {n}/10', { n: s.importance }) }, ...Array.from({ length: 10 }, (_, i) => h('i', { class: i < s.importance ? 'on' : '' })));
  const mute = h('button', { class: 'sm ghost', onclick: async () => { await cmd('muteStory', { id: s.id }); toast(t('Bu konu susturuldu')); renderBoard(); } });
  setButton(mute, 'speaker-slash', t('Bu konuyu sustur'), { size: 14 });
  return h('article', { class: 'card' + (s.breaking ? ' breaking' : '') + (low ? ' low' : '') },
    h('div', { class: 'meta' },
      s.breaking ? tag(t('SON DAKİKA'), 'danger', 'lightning-fill') : null,
      tag(categoryLabel(s.category)),
      s.tone === 'serious' ? tag(t('ciddi')) : null,
      s.development ? tag(t('yeni gelişme'), 'warn') : null,
      s.reserved ? tag(t('hazırlanıyor'), 'accent') : null,
      s.authors > 1 ? tag(t('{n} hesap', { n: s.authors }), '', 'users-three') : null,
      imp,
      h('span', { class: 'when' }, s.coveredAt ? t('anlatıldı {when}', { when: relTime(s.coveredAt) }) : relTime(s.lastUpdate))),
    h('div', { class: 'hl' }, s.headline),
    s.summary ? h('div', { class: 'sum' }, s.summary) : null,
    low ? h('div', { class: 'dim small mt6' }, t('(önem eşiğinin altında)')) : null,
    h('details', {}, h('summary', {}, t('Kaynak paylaşımlar ({n})', { n: s.tweets.length })),
      ...s.tweets.map((tw) => {
        const open = h('a', { href: tw.url, target: '_blank' }, t('X\'te aç'));
        open.insertAdjacentHTML('beforeend', iconSvg('arrow-square-out', { size: 12 }));
        return h('div', { class: 'tw' }, h('div', { class: 'by' }, `${tw.name || ''} @${tw.handle || ''} · ${relTime(tw.createdAt)}`), tw.text, ' ', open);
      })),
    h('div', { class: 'actions' }, mute));
}

// ------------------------------------------------------------------ Geçmiş
async function renderHistory() {
  const hours = +$('#hist-range').value;
  const logs = await logList({ since: Date.now() - hours * 3600e3, limit: 300 }).catch(() => []);
  const box = $('#history');
  box.innerHTML = '';
  if (!logs.length) { box.append(h('div', { class: 'empty-box' }, t('Bu aralıkta yayın kaydı yok.'))); return; }
  let day = '';
  for (const l of logs) {
    const d = new Date(l.ts).toLocaleDateString(uiLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
    if (d !== day) { day = d; box.append(h('h3', {}, d)); }
    const srcs = (l.stories || []).flatMap((s) => (s.tweets || []).slice(0, 2).map((tw) => {
      const a = h('a', { href: tw.url, target: '_blank', title: tw.text }, `@${tw.handle || '?'}`);
      a.insertAdjacentHTML('beforeend', iconSvg('arrow-square-out', { size: 11 }));
      return a;
    }));
    box.append(h('div', { class: 'hist' },
      h('span', { class: 'time' }, clock(l.ts)),
      h('div', { class: 'hh' }, tag(kindLabel(l.kind), l.kind === 'breaking' ? 'danger' : ''), h('span', { class: 'title' }, l.title),
        h('span', { class: 'via' }, `${l.writer === 'gemini' ? 'Gemini' : t('yerel')} · ${l.voice === 'gemini' ? t('Gemini sesi') : t('tarayıcı sesi')}`)),
      (l.stories || []).length ? h('div', { class: 'heads' }, (l.stories || []).map((s) => s.headline).join(' · ')) : null,
      srcs.length ? h('div', { class: 'src' }, ...srcs) : null,
      h('details', {}, h('summary', {}, t('Transkript')),
        ...l.lines.map((ln) => h('div', { class: 'tl' + (ln.speaker === 'B' ? ' b' : '') }, h('b', {}, (ln.speaker === 'A' ? l.hosts?.A : l.hosts?.B) + ': '), ...captionNodes(ln.text, ln.speaker === 'A' ? l.hosts?.B : l.hosts?.A))))));
  }
}

async function exportHistory() {
  const logs = await logList({ since: 0, limit: 5000 });
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `xradio-history-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
}

// ------------------------------------------------------------------ Ayarlar
let saveTimer = null;
let pending = {};
async function saveAndApply(patch) {
  Object.assign(settings, patch);
  pending = { ...pending, ...patch };
  clearTimeout(saveTimer);
  return new Promise((resolve) => {
    saveTimer = setTimeout(async () => {
      const p = pending; pending = {};
      const r = await saveSettings(p);
      if (r?.settings) settings = r.settings;
      $('#saved-hint').textContent = `${t('Kaydedildi')} · ${clock(Date.now())}`;
      renderHosts();
      resolve(r);
    }, 350);
  });
}

function field(label, input, help) {
  return h('div', { class: 'field' }, h('label', {}, label), input, help ? h('div', { class: 'help' }, help) : null);
}
function inlineField(label, input, help) {
  return h('div', { class: 'field inline' }, h('label', {}, label, help ? h('div', { class: 'help' }, help) : null), input);
}
function text(key, placeholder = '', type = 'text') {
  const i = h('input', { type, value: settings[key] ?? '', placeholder });
  i.addEventListener('change', () => saveAndApply({ [key]: type === 'number' ? +i.value : i.value.trim() }));
  return i;
}
function select(key, options, onchange) {
  const s = h('select', {}, ...options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = String(settings[key]);
  s.addEventListener('change', () => { const v = s.value; saveAndApply({ [key]: /^\d+$/.test(v) ? +v : v }); onchange?.(v); });
  return s;
}
function check(key) {
  const c = h('input', { type: 'checkbox' });
  c.checked = !!settings[key];
  c.addEventListener('change', () => saveAndApply({ [key]: c.checked }));
  return c;
}
function range(key, min, max, step, fmt = (v) => v) {
  const out = h('output', {}, fmt(settings[key]));
  const r = h('input', { type: 'range', min, max, step, value: settings[key] });
  r.addEventListener('input', () => { out.textContent = fmt(+r.value); });
  r.addEventListener('change', () => saveAndApply({ [key]: +r.value }));
  return h('div', { class: 'range-row' }, r, out);
}
function list(key, placeholder) {
  const ta = h('textarea', { placeholder });
  ta.value = (settings[key] || []).join('\n');
  ta.addEventListener('change', () => saveAndApply({ [key]: ta.value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) }));
  return ta;
}

function hostCard(which) {
  const key = which === 'A' ? 'hostA' : 'hostB';
  const host = settings[key];
  const name = h('input', { value: host.name });
  const voices = [...GEMINI_VOICES].sort((a, b) => (a.gender === (which === 'A' ? 'f' : 'm') ? -1 : 1) - (b.gender === (which === 'A' ? 'f' : 'm') ? -1 : 1));
  const voice = h('select', {}, ...voices.map((v) => h('option', { value: v.id }, `${v.id} — ${t(v.desc)} (${v.gender === 'f' ? t('kadın') : t('erkek')})`)));
  voice.value = host.voice;
  const persona = h('textarea', {}, host.persona);
  const save = () => saveAndApply({ [key]: { ...settings[key], name: name.value.trim() || (which === 'A' ? 'Defne' : 'Kaan'), voice: voice.value, persona: persona.value.trim() || personasFor(settings.language)[which] } });
  name.addEventListener('change', save); voice.addEventListener('change', save); persona.addEventListener('change', save);
  const preview = h('button', { onclick: () => previewVoice(which, preview) });
  setButton(preview, 'play-fill', t('Sesi dinle'), { size: 14 });
  return h('div', { class: 'host-card' + (which === 'B' ? ' b' : '') },
    h('div', { class: 'host-title' }, h('span', { class: 'swatch' }), host.name),
    h('div', { class: 'row' }, field(which === 'A' ? t('Kadın DJ adı') : t('Erkek DJ adı'), name), field(t('Gemini sesi'), voice), preview),
    field(t('Kişilik'), persona, t('Yazar bu tarifi kullanır. Mizah, merak alanları, konuşma tarzı…')));
}

/** Ses denemesi için yayın dilinde kısa bir cümle. */
function previewLine(which, host) {
  const name = settings.listenerName ? ' ' + settings.listenerName : '';
  if (settings.language === 'tr') {
    return which === 'A'
      ? `Merhaba${name}! Ben ${host.name}. Gündemi senin için takip ediyorum; sen işine bak, önemli bir şey olursa ilk ben söylerim.`
      : `Selam! Ben de ${host.name}. Timeline'ı biz okuyoruz, sen sadece kahveni iç. <laugh>`;
  }
  return which === 'A'
    ? `Hi${name}! I'm ${host.name}. I'm keeping an eye on the news for you — get on with your work, and if something important happens, you'll hear it from me first.`
    : `Hey! And I'm ${host.name}. We read the timeline, you just enjoy your coffee. <laugh>`;
}

async function previewVoice(which, btn) {
  const host = which === 'A' ? settings.hostA : settings.hostB;
  const line = previewLine(which, host);
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${t('Hazırlanıyor')}`;
  try {
    if (settings.apiKey) {
      const client = new GeminiClient({ apiKey: settings.apiKey, base: settings.apiBase });
      const models = (await kvGet('models').catch(() => null))?.models;
      const model = settings.autoModels && models?.tts ? models.tts : settings.ttsModel;
      const { bytes } = await client.tts({ model, lines: [{ speaker: host.name, text: line, style: which === 'A' ? 'warm, energetic radio host' : 'cheerful, friendly radio host' }], speakers: [{ speaker: host.name, voice: host.voice }], settings, language: langInfo(settings.language).bcp47 });
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
      toast(t('Gemini sesi: {v} ({m})', { v: host.voice, m: model }));
    } else {
      const bv = new BrowserVoice();
      await bv.ready;
      const p = bv.pick(settings.language);
      toast(t('Tarayıcı sesi: {v}', { v: which === 'A' ? p.names.A : p.names.B }));
      await bv.speak([{ speaker: which, text: line }], { lang: settings.language, bcp47: langInfo(settings.language).bcp47 });
    }
  } catch (e) {
    toast(`${t('Ses denemesi başarısız')}: ${e.message}`, 5000);
  } finally {
    btn.disabled = false; setButton(btn, 'play-fill', t('Sesi dinle'), { size: 14 });
  }
}

async function testKey(key, out) {
  out.textContent = t('Deneniyor…');
  try {
    const client = new GeminiClient({ apiKey: key, base: settings.apiBase });
    const t0 = performance.now();
    const list = await client.listModels();
    const picked = pickModels(list);
    out.textContent = t('✓ Anahtar geçerli ({ms} ms). {n} model erişilebilir.', { ms: Math.round(performance.now() - t0), n: list.length })
      + `\n${t('Metin')}: ${picked.text || '-'} · ${t('Triyaj')}: ${picked.triage || '-'} · ${t('Ses')}: ${picked.tts || '-'}`;
    return true;
  } catch (e) {
    out.textContent = '✗ ' + (e.status === 400 || e.status === 403 ? t('Anahtar reddedildi') : t('Hata')) + ': ' + e.message;
    return false;
  }
}

function dangerZone() {
  const clear = h('button', { class: 'danger', onclick: async () => { if (confirm(t('Toplanan paylaşımlar, hikâye hafızası ve yayın geçmişi silinsin mi?'))) { await cmd('resetMemory'); toast(t('Hafıza temizlendi')); refresh(); } } });
  setButton(clear, 'trash', t('Hafızayı temizle'), { size: 15 });
  const reset = h('button', { onclick: () => { if (confirm(t('Tüm ayarlar varsayılana dönsün mü? (API anahtarı ve dil korunur)'))) saveAndApply({ ...DEFAULT_SETTINGS, apiKey: settings.apiKey, language: settings.language, languageConfirmed: true, theme: settings.theme }).then(renderSettings); } });
  setButton(reset, 'arrow-counter-clockwise', t('Varsayılanlar'), { size: 15 });
  return h('div', { class: 'danger-zone' }, clear, reset);
}

function groupHead(iconName, title) {
  const box = h('div', { class: 'ic-box' });
  box.innerHTML = iconSvg(iconName, { size: 17 });
  return h('div', { class: 'sgroup-head' }, box, h('h2', {}, title));
}

function renderSettings() {
  const root = $('#settings');
  root.innerHTML = '';
  const S = settings;

  // Dil
  const L = langInfo(S.language);
  root.append(h('div', { class: 'panel sgroup' },
    groupHead('globe-simple', t('Dil')),
    h('p', {}, t('DJ\'lerin konuştuğu dil, haber başlıkları ve arayüz. ✦ işaretli diller Gemini anahtarı gerektirir (yerel mod Türkçe ve İngilizce destekler).')),
    field(t('Yayın dili'), languageSelect(changeLanguage), L.local ? null : t('Arayüz bu dilde İngilizce görünür; DJ\'ler {lang} konuşur.', { lang: L.native })),
  ));

  // Görünüm
  root.append(h('div', { class: 'panel sgroup' },
    groupHead('circle-half', t('Görünüm')),
    h('p', {}, t('Arayüzün açık ya da koyu görünümü.')),
    field(t('Tema'), select('theme', [['system', t('Sistemle aynı')], ['light', t('Açık')], ['dark', t('Koyu')]], (v) => applyTheme(v))),
  ));

  // Yapay zekâ
  const keyIn = h('input', { type: 'password', value: S.apiKey, placeholder: t('AI Studio anahtarı (AQ.…)'), autocomplete: 'off' });
  const keyOut = h('div', { class: 'help', style: { whiteSpace: 'pre-wrap' } });
  keyIn.addEventListener('change', () => saveAndApply({ apiKey: keyIn.value.trim() }));
  const showBtn = h('button', { type: 'button', class: 'icon', title: t('Anahtarı göster / gizle'), 'aria-label': t('Anahtarı göster / gizle') });
  showBtn.innerHTML = iconSvg('eye', { size: 16 });
  showBtn.addEventListener('click', () => { const hidden = keyIn.type === 'password'; keyIn.type = hidden ? 'text' : 'password'; showBtn.innerHTML = iconSvg(hidden ? 'eye-slash' : 'eye', { size: 16 }); });
  const testBtn = h('button', { type: 'button', onclick: () => testKey(keyIn.value.trim(), keyOut) });
  setButton(testBtn, 'key', t('Anahtarı dene'), { size: 15 });
  root.append(h('div', { class: 'panel sgroup' },
    groupHead('brain', t('Yapay zekâ (Gemini)')),
    h('p', {}, t('Gerçekçi iki kişilik DJ sohbeti Gemini\'nin çok konuşmacılı ses modeliyle seslendirilir. Anahtar yoksa ücretsiz yerel mod (şablon senaryo + tarayıcının sesleri) çalışır.')),
    field(t('API anahtarı'), h('div', { class: 'row' }, keyIn, showBtn, testBtn), h('span', {}, t('Anahtar al') + ': ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank' }, 'aistudio.google.com/apikey'), ' · ' + t('Sadece bu tarayıcıda (chrome.storage.local) saklanır.'))),
    keyOut,
    field(t('Zekâ motoru'), select('engine', [['auto', t('Otomatik (anahtar varsa Gemini)')], ['gemini', 'Gemini'], ['local', t('Yerel (ücretsiz, çevrimdışı)')]])),
    inlineField(t('En yeni modelleri otomatik seç'), check('autoModels'), t('Hesabındaki en yeni Flash metin ve TTS modelleri bulunur.')),
    field(t('Metin modeli (yedek/elle)'), text('textModel', DEFAULT_SETTINGS.textModel)),
    field(t('Triyaj modeli'), text('triageModel', DEFAULT_SETTINGS.triageModel)),
    field(t('Ses (TTS) modeli'), text('ttsModel', DEFAULT_SETTINGS.ttsModel)),
  ));

  // Sunucular
  root.append(h('div', { class: 'panel sgroup' },
    groupHead('users-three', t('Sunucular ve program')),
    h('p', {}, t('İki DJ\'in adı, sesi ve kişiliği. "Sesi dinle" ile anında dene.')),
    hostCard('A'), hostCard('B'),
    field(t('Radyo adı'), text('stationName', 'XRadio')),
    field(t('Senin adın'), text('listenerName', t('DJ\'ler sana adınla seslensin'))),
    field(t('Şehir (hava durumu için)'), text('city', t('ör. İstanbul'))),
    field(t('Mizah seviyesi'), range('humor', 0, 1, 0.05, (v) => [t('ciddi'), t('ölçülü'), t('esprili'), t('çok esprili')][Math.min(3, Math.floor(v * 4))])),
    field(t('Konuşma sıklığı'), select('talkiness', [['az', t('Az (≈12 dk\'da bir)')], ['normal', t('Normal (≈7 dk\'da bir)')], ['cok', t('Sık (≈4 dk\'da bir)')]])),
    field(t('Ara uzunluğu'), select('segmentLength', [['kisa', t('Kısa (≈1 dk)')], ['normal', t('Normal (≈1,5 dk)')], ['uzun', t('Uzun (≈2,5 dk)')]])),
    inlineField(t('X\'e girme denemelerime takılabilirler'), check('teaseFocusShield')),
  ));

  // Müzik
  const ms = h('select');
  fillMusicSelect(ms, musicValue());
  ms.addEventListener('change', () => applyMusicValue(ms.value).then(() => renderSettings()));
  const urlIn = h('input', { value: S.musicSource === 'youtube' ? S.youtubeUrl : '', placeholder: t('https://www.youtube.com/watch?v=… veya playlist?list=…') });
  const urlOut = h('div', { class: 'help' });
  urlIn.addEventListener('change', () => {
    const p = parseYouTubeUrl(urlIn.value);
    if (!p) { urlOut.textContent = t('✗ Geçerli bir YouTube bağlantısı değil'); return; }
    urlOut.textContent = embedUrl(p) ? t('✓ Kaydedildi — gömülü oynatıcıyla çalınacak') : t('✓ Kaydedildi — kanal sayfası olduğu için YouTube sekmesinde açılacak');
    saveAndApply({ musicSource: 'youtube', youtubeUrl: urlIn.value.trim() });
  });
  root.append(h('div', { class: 'panel sgroup' },
    groupHead('music-notes', t('Müzik')),
    h('p', {}, t('Arka planda YouTube canlı yayını ya da oynatma listesi çalar; DJ\'ler konuşurken ses otomatik kısılır.')),
    field(t('Müzik'), ms, h('span', {}, t('Şarkı aramak ve kendi listeni oluşturmak için:') + ' ', h('a', { href: '#muzik' }, t('Müzik sekmesi')))),
    field(t('Kendi YouTube bağlantın'), urlIn, t('Canlı yayın, video, oynatma listesi veya YouTube Music bağlantısı yapıştır.')),
    urlOut,
    field(t('YouTube oynatma yöntemi'), select('youtubeMode', [['auto', t('Otomatik (sekmesiz; gerekirse sekme)')], ['embed', t('Sadece gömülü (sekmesiz)')], ['tab', t('YouTube sekmesinde (Premium hesabınla reklamsız)')]])),
    inlineField(t('DJ\'lerin müzik önerilerine göre yayın değiştir'), check('youtubeFollowMood'), t('Ör. dinleyici "caz çalın" derse caz yayınına geçer.')),
    field(t('İnternet radyosu adresi (isteğe bağlı)'), text('streamUrl', 'https://…/stream.mp3'), t('Müzik kaynağı "İnternet radyosu" seçilirse kullanılır.')),
    field(t('Yerleşik yedek müzik tarzı'), select('musicStyle', MUSIC_STYLES.map((m) => [m.id, t(m.label)]))),
    field(t('Ana ses'), range('masterVolume', 0, 1, 0.01, (v) => Math.round(v * 100) + '%')),
    field(t('Müzik sesi'), range('musicVolume', 0, 1, 0.01, (v) => Math.round(v * 100) + '%')),
    field(t('DJ sesi'), range('voiceVolume', 0, 1.5, 0.01, (v) => Math.round(v * 100) + '%')),
    field(t('Konuşurken müzik seviyesi'), range('duckLevel', 0, 0.6, 0.01, (v) => Math.round(v * 100) + '%')),
  ));

  // X
  root.append(h('div', { class: 'panel sgroup' },
    groupHead('x-logo', t('Akış toplayıcı')),
    h('p', {}, t('Radyo, X oturumunun açık olduğu bu tarayıcıda küçük bir sabitlenmiş sekmede ana akışını okur. Hiçbir şey paylaşmaz, beğenmez, yazmaz.')),
    field(t('Hangi akış?'), select('feed', [['following', t('Takip edilenler (kronolojik)')], ['foryou', t('Sana özel')]])),
    field(t('Yenileme aralığı'), select('refreshMinutes', [2, 3, 4, 6, 10].map((m) => [m, t('{n} dakika', { n: m })]))),
    field(t('Toplayıcı sekme'), select('collectorMode', [['pinned', t('Sabitlenmiş sekme')], ['window', t('Küçültülmüş ayrı pencere')]])),
    inlineField(t('Radyo durunca toplayıcı sekmeyi kapat'), check('closeCollectorOnStop')),
    inlineField(t('Demo modu (X yerine kurgusal örnek akış)'), check('demoMode')),
  ));

  // Filtreler
  root.append(h('div', { class: 'panel sgroup' },
    groupHead('funnel', t('Filtreler ve öncelikler')),
    h('p', {}, t('Neyin haber olacağına ve neyin yayını keseceğine sen karar ver.')),
    field(t('Son dakika eşiği (yayını kesme)'), range('breakingThreshold', 5, 10, 1, (v) => `${v}/10`)),
    field(t('Anlatılacak en düşük önem'), range('minImportance', 1, 8, 1, (v) => `${v}/10`)),
    field(t('Sessize alınan kelimeler / hesaplar'), list('muteWords', t('Her satıra bir tane: kripto, bahis, @hesap'))),
    field(t('Öncelikli hesaplar'), list('priorityAccounts', '@hesap1\n@hesap2')),
    field(t('Öncelikli kelimeler'), list('priorityWords', t('deprem\nyapay zekâ'))),
  ));

  root.append(h('div', { class: 'panel sgroup' },
    groupHead('shield-check', t('Odak kalkanı ve diğerleri')),
    h('p', {}, t('X\'i kendin açtığında akış yerine radyonun durumunu gösteren nazik bir ekran çıkar. Belirli bir paylaşım bağlantısı açarsan araya girmez.')),
    inlineField(t('Odak kalkanını aç'), check('focusShield')),
    inlineField(t("X'te radyo düğmesini göster"), check('xDock')),
    field(t('"Bakmam lazım" erteleme süresi'), select('shieldSnoozeMinutes', [2, 5, 10, 15].map((m) => [m, t('{n} dakika', { n: m })]))),
    inlineField(t('Son dakikada masaüstü bildirimi'), check('notifyBreaking')),
    inlineField(t('Tarayıcı açılınca radyoyu başlat'), check('autoStartOnBrowserOpen')),
    dangerZone(),
  ));
}

// ------------------------------------------------------------------ Sistem testi
let report = [];
const TEST_ICON = { ok: 'check-circle-fill', warn: 'warning-fill', fail: 'x-circle-fill', info: 'info-fill' };
const TEST_MARK = { ok: '✓', warn: '!', fail: '✗', info: 'i' };
/** Test satırı. status: ok | warn | fail | info */
function testRow(status, name, det) {
  report.push({ status, name, det });
  const st = h('div', { class: 'st ' + status });
  st.innerHTML = iconSvg(TEST_ICON[status] || TEST_ICON.info, { size: 18, label: status });
  $('#tests').append(h('div', { class: 'test' }, st, h('div', {}, h('div', { class: 'name' }, name), det ? h('div', { class: 'det' }, det) : null)));
}

async function runTests() {
  report = [];
  $('#tests').innerHTML = '';
  const btn = $('#run-tests');
  btn.disabled = true;
  try {
    const brands = navigator.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`).join(', ') || navigator.userAgent;
    const isEdge = /Edge/i.test(brands) || /Edg\//.test(navigator.userAgent);
    testRow(isEdge ? 'ok' : 'info', t('Tarayıcı'), `${brands}\n${t('Eklenti sürümü')} ${chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version} ·${t('Yayın dili')}: ${langInfo(settings.language).native}`);

    const perms = await chrome.permissions.contains({ origins: ['https://x.com/*', 'https://www.youtube.com/*', 'https://generativelanguage.googleapis.com/*'] });
    testRow(perms ? 'ok' : 'fail', t('Site izinleri (X, YouTube, Gemini)'), perms ? t('Tamam') : t('Eksik — eklentiyi yeniden yükle'));

    const diag = await cmd('diagnostics');
    if (!diag || diag.error) testRow('fail', t('Ses motoru (arka plan belgesi)'), diag?.error || t('Yanıt yok'));
    else {
      testRow(['running', 'suspended', 'yok'].includes(diag.audioContext) ? 'ok' : 'warn', t('Ses motoru'), `AudioContext: ${diag.audioContext}${diag.sampleRate ? ' · ' + diag.sampleRate + ' Hz' : ''}`);
      const bv = diag.browserVoices || {};
      const langName = langInfo(settings.language).native;
      testRow(bv.native ? 'ok' : 'warn', t('Tarayıcının {lang} sesleri (yedek mod)', { lang: langName }), bv.native
        ? `${t('Kadın')}: ${bv.A}\n${t('Erkek')}: ${bv.B}\n${t('Toplam ses')}: ${bv.count}`
        : t('{lang} ses bulunamadı ({n} ses). Windows ayarlarından konuşma paketi ekleyebilirsin; Edge\'in "Online (Natural)" sesleri internetle çalışır.', { lang: langName, n: bv.count || 0 }));
      const m = diag.music || {};
      if (m.status?.state === 'playing' || m.nowPlaying) testRow('ok', t('Müzik'), `${m.source} · ${cleanTitle(m.nowPlaying?.title || '')} ${m.nowPlaying?.mode ? '(' + m.nowPlaying.mode + ')' : ''}\n${m.status?.text || ''}`);
      else testRow('info', t('Müzik'), `${t('Kaynak')}: ${m.source}. ${t('Radyo çalarken bu testi tekrar çalıştırırsan YouTube oynatıcısının durumu da görünür.')}${m.status?.text ? `\n${t('Durum')}: ${m.status.text}` : ''}`);
      if (diag.errors?.length) testRow('warn', t('Son hatalar'), diag.errors.map((e) => `${clock(e.ts)} ${e.msg}`).join('\n'));
    }

    const st = await bg('getState');
    const c = st?.collector;
    if (settings.demoMode) testRow('info', t('X toplayıcı'), t('Demo modu açık — gerçek akış okunmuyor.'));
    else if (!c) testRow('info', t('X toplayıcı'), t('Henüz veri yok. Radyoyu başlat; sabitlenmiş X sekmesi açılır ve 1-2 dakika içinde veri gelir.'));
    else if (c.loggedIn === false) testRow('fail', t('X toplayıcı'), t('X oturumu açık değil. x.com\'a giriş yapıp radyoyu yeniden başlat.'));
    else testRow('ok', t('X toplayıcı'), `${t('Son veri')}: ${relTime(c.lastAt)} (${c.lastSource === 'json' ? t('uygulama verisi') : c.lastSource === 'dom' ? t('sayfa yapısı') : c.lastSource})\n${t('Son parti')}: ${c.lastBatch || 0} · ${t('Toplam yeni')}: ${c.total || 0}`);

    if (!settings.apiKey) testRow('info', 'Gemini', t('API anahtarı girilmemiş — yerel mod kullanılıyor.'));
    else {
      const client = new GeminiClient({ apiKey: settings.apiKey, base: settings.apiBase });
      let picked = null;
      try {
        const t0 = performance.now();
        const list = await client.listModels();
        picked = pickModels(list);
        testRow('ok', t('Gemini anahtarı ve modeller'), `${list.length} model · ${Math.round(performance.now() - t0)} ms\n${t('Metin')}: ${picked.text} · ${t('Triyaj')}: ${picked.triage} · ${t('Ses')}: ${picked.tts}`);
      } catch (e) { testRow('fail', t('Gemini anahtarı'), e.message); }
      if (picked) {
        const L = langInfo(settings.language);
        const textModel = settings.autoModels ? picked.text || settings.textModel : settings.textModel;
        try {
          const t0 = performance.now();
          const j = await client.generateJson({ model: textModel, system: `Answer briefly in ${L.english}.`, prompt: `Greet the listener in one sentence like a radio DJ, in ${L.english}. JSON: {"greeting": "..."}`, schema: { type: 'object', properties: { greeting: { type: 'string' } }, required: ['greeting'] }, temperature: 0.8, thinking: 'minimal', maxTokens: 300 });
          testRow('ok', t('Gemini metin üretimi'), `${textModel} · ${Math.round(performance.now() - t0)} ms (${client.mode.get(textModel)} API)\n"${j.greeting}"`);
        } catch (e) { testRow('fail', t('Gemini metin üretimi'), `${textModel}: ${e.message}`); }
        const ttsModel = settings.autoModels ? picked.tts || settings.ttsModel : settings.ttsModel;
        try {
          const t0 = performance.now();
          const sample = settings.language === 'tr' ? ['Test bir, iki.', 'Ses geliyor, harika!'] : ['Testing, one, two.', 'Sound is coming through, great!'];
          const { bytes } = await client.tts({ model: ttsModel, lines: [{ speaker: settings.hostA.name, text: sample[0] }, { speaker: settings.hostB.name, text: sample[1] }], speakers: [{ speaker: settings.hostA.name, voice: settings.hostA.voice }, { speaker: settings.hostB.name, voice: settings.hostB.voice }], settings, language: L.bcp47 });
          const ctx = new AudioContext();
          const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
          const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
          testRow('ok', t('Gemini çok konuşmacılı ses'), t('{model} · {ms} ms · {sec} sn ses ({api} API) — şu an çalıyor', { model: ttsModel, ms: Math.round(performance.now() - t0), sec: buf.duration.toFixed(1), api: client.mode.get('tts:' + ttsModel) }));
        } catch (e) { testRow('fail', t('Gemini ses (TTS)'), `${ttsModel}: ${e.message}`); }
      }
    }

    const logs = await logList({ since: Date.now() - 24 * 3600e3, limit: 1000 }).catch(() => []);
    const inbox = await inboxCount().catch(() => '?');
    testRow('ok', t('Veritabanı'), t('Son 24 saatte {a} yayın bölümü · gelen kutusunda {b} paylaşım', { a: logs.length, b: inbox }));
  } catch (e) {
    testRow('fail', t('Test çalıştırılamadı'), e.message);
  } finally {
    btn.disabled = false;
  }
}

function copyReport() {
  const lines = report.map((r) => `[${TEST_MARK[r.status] || '?'}] ${r.name}${r.det ? '\n    ' + r.det.replace(/\n/g, '\n    ') : ''}`);
  navigator.clipboard.writeText(`${t('XRadio sistem testi')} — ${new Date().toLocaleString(uiLocale())}\n\n${lines.join('\n')}`).then(() => toast(t('Rapor panoya kopyalandı')));
}

// ------------------------------------------------------------------ Hoş geldin
function initWelcome() {
  const slot = $('#w-lang');
  slot.innerHTML = '';
  slot.append(languageSelect(changeLanguage));
  $('#w-lang-note').textContent = settings.languageConfirmed
    ? t('Seçili dil: {lang}', { lang: langInfo(settings.language).native })
    : t('Tarayıcının dilinden algılandı: {lang}. İstersen değiştir.', { lang: langInfo(settings.language).native });
  $('#w-name').value = settings.listenerName || '';
  $('#w-key').value = settings.apiKey || '';
  fillMusicSelect($('#w-music'), musicValue());
  $('#w-name').addEventListener('change', () => saveAndApply({ listenerName: $('#w-name').value.trim() }));
  $('#w-key').addEventListener('change', () => saveAndApply({ apiKey: $('#w-key').value.trim() }));
  $('#w-music').addEventListener('change', () => applyMusicValue($('#w-music').value));
  $('#w-key-test').addEventListener('click', async () => {
    const out = h('div', { class: 'help mt6', style: { whiteSpace: 'pre-wrap' } });
    $('#w-key-test').parentElement.after(out);
    await testKey($('#w-key').value.trim(), out);
  });
  const go = async (demo) => {
    await saveAndApply({ demoMode: demo, languageConfirmed: true, listenerName: $('#w-name').value.trim(), apiKey: $('#w-key').value.trim() });
    location.hash = '#yayin';
    await start();
  };
  $('#w-start').addEventListener('click', () => go(false));
  $('#w-demo').addEventListener('click', () => go(true));
}

async function start() {
  const tg = $('#toggle');
  tg.disabled = true;
  tg.innerHTML = `<span class="spinner"></span> ${t('Başlıyor')}`;
  lastToggle = '';
  const r = await cmd('start');
  tg.disabled = false;
  if (r?.error) toast(r.error, 4000);
  await refresh();
}

// ------------------------------------------------------------------ Başlat
/** Kurulum adımı: hata verirse konsola yazılır, sayfanın geri kalanı çalışmaya devam eder. */
async function safe(label, fn) {
  try { return await fn(); } catch (e) { console.error(`[XRadio] ${label}:`, e); return undefined; }
}

/** Eklenti dosyaları güncellenip eklenti yeniden yüklenmediyse arka plan eski sürümde kalır: kullanıcıyı uyar. */
function showStaleBanner() {
  if ($('#stale-bar')) return;
  const bar = h('div', { class: 'stale-bar', id: 'stale-bar', role: 'alert' });
  bar.insertAdjacentHTML('beforeend', iconSvg('warning-fill', { size: 16 }));
  bar.append(h('span', {}, t('Eklenti dosyaları güncellendi ama arka plan hâlâ eski sürümde çalışıyor. Her şeyin düzgün çalışması için eklentiyi yeniden yükle (stüdyo kapanır, yeniden açman gerekir).')));
  const b = h('button', { class: 'sm primary', onclick: () => chrome.runtime.reload() });
  setButton(b, 'arrow-counter-clockwise', t('Şimdi yeniden yükle'), { size: 14 });
  bar.append(b);
  $('main').prepend(bar);
}

async function init() {
  settings = await getSettings();
  await safe('tema', () => applyTheme(settings.theme));
  setUiLang(settings.language);
  await safe('çeviri', () => applyI18n(document));
  await safe('ikonlar', () => applyIcons(document));
  const mf = chrome.runtime.getManifest();
  $('#version').textContent = `XRadio v${mf.version_name || mf.version}`;
  // Dil hiç onaylanmadıysa Başlangıç ekranını (dil seçimiyle) bir kez kendiliğinden göster;
  // sonrasında açılır penceredeki dil şeridi onaylanana kadar hatırlatır.
  if (!settings.languageConfirmed) {
    const { langPromptShown } = await chrome.storage.local.get('langPromptShown');
    if (!langPromptShown && !location.hash) location.hash = '#hosgeldin';
    if (location.hash === '#hosgeldin') chrome.storage.local.set({ langPromptShown: true });
  }
  // Sekme ve menü ikonları en başta: aşağıdaki bölümlerden biri hata verse de sayfa kullanılabilir kalır
  await safe('sekmeler', showTab);
  await safe('sunucular', renderHosts);
  await safe('müzik seçimi', () => {
    fillMusicSelect($('#quick-music'), musicValue());
    $('#quick-music').addEventListener('change', () => applyMusicValue($('#quick-music').value));
  });
  await safe('mikser', () => { renderMixer(); $('#mix-mute').addEventListener('click', toggleMute); });
  await safe('müzik sekmesi', () => initLibrary({
    settings: () => settings,
    // Kütüphane değişiklikleri hemen kaydedilir (gecikmeli kayıt yok): ardından "şimdi çal" komutu güncel listeyi görür
    save: async (patch) => {
      Object.assign(settings, patch);
      const r = await saveSettings(patch);
      if (r?.settings) settings = r.settings;
      safe('müzik seçimi', () => fillMusicSelect($('#quick-music'), musicValue()));
      return r;
    },
  }));
  await safe('durum', refresh);
  safe('transkript', seedTranscript);
  await safe('başlangıç', initWelcome);
  backgroundIsStale().then((stale) => { if (stale) showStaleBanner(); }).catch(() => {});

  $('#toggle').addEventListener('click', async () => {
    if (state?.on) { await cmd('stop'); await refresh(); } else await start();
  });
  $('#talk').addEventListener('click', async () => { const r = await cmd('talkNow'); toast(r?.text || t('Hazırlanıyor…')); refresh(); });
  $('#skip').addEventListener('click', async () => { const r = await cmd('skip'); toast(r?.text || t('Atlandı')); });
  $('#msg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#msg-input').value.trim();
    if (!v) return;
    $('#msg-input').value = '';
    const r = await cmd('listener', { text: v });
    toast(r?.text || t('Mesaj iletildi'));
  });
  $('#hist-range').addEventListener('change', renderHistory);
  $('#hist-export').addEventListener('click', exportHistory);
  $('#run-tests').addEventListener('click', runTests);
  $('#copy-report').addEventListener('click', copyReport);

  onStationEvent((event, data) => {
    if (event === 'state') { state = { ...state, ...data }; renderLive(); }
    else if (event === 'caption') { addLine(data); setSpeaking(data.speaker); }
    else if (event === 'segment') {
      if (data.state === 'start' && data.id !== lastSegId) { lastSegId = data.id; addSegmentHeader(data); }
      if (data.state === 'end') { setSpeaking(null); if ($('#tab-masa').classList.contains('active')) renderBoard(); }
    } else if (event === 'board') { if ($('#tab-masa').classList.contains('active')) renderBoard(); }
    else if (event === 'notice') toast(data.text, 5000);
    else if (event === 'track') refresh();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !ch.settings) return;
    const prevLang = settings.language;
    settings = mergeSettings({ ...settings, ...ch.settings.newValue });
    if (ch.settings.newValue?.language && ch.settings.newValue.language !== prevLang) location.reload();
    else { renderHosts(); applyTheme(settings.theme); syncMixer(); refreshLibrary(); }
  });
  connectViz((d) => { setBars(d.bands); if (d.talking) setSpeaking(d.speaker); else setSpeaking(null); });
  setInterval(refresh, 5000);
  setInterval(() => { $('#clock').textContent = new Date().toLocaleString(uiLocale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }); }, 1000);
}

init();
