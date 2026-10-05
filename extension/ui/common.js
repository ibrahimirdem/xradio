// Arayüz sayfaları için ortak yardımcılar.

import { captionParts } from '../lib/expressive.js';
import { t, getUiLang } from './i18n.js';
import { iconSvg } from './icons.js';

/**
 * Altyazı metnini DOM düğümlerine çevirir: duygu etiketleri "(güler)", araya giren tepkiler
 * dinleyen DJ'in adıyla küçük bir balon olarak gösterilir.
 */
export function captionNodes(text, listenerName = '') {
  const out = [];
  for (const p of captionParts(text, getUiLang())) {
    if (p.type === 'text') out.push(document.createTextNode(p.value));
    else if (p.type === 'tag') { const s = document.createElement('span'); s.className = 'cap-tag'; s.textContent = `(${p.value})`; out.push(s); }
    else { const s = document.createElement('span'); s.className = 'cap-back'; s.textContent = `${listenerName ? listenerName + ': ' : ''}${p.value}`; out.push(s); }
  }
  return out;
}

export const bg = (type, payload = {}) => chrome.runtime.sendMessage({ to: 'bg', type, ...payload }).catch((e) => ({ error: e.message }));
export const cmd = (name, payload = {}) => bg('cmd', { cmd: name, ...payload });

export function onStationEvent(fn) {
  const listener = (msg) => { if (msg && msg.to === 'ui' && msg.type === 'event') fn(msg.event, msg.data); };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export async function getSettings() { return bg('getSettings'); }
export async function saveSettings(patch) { return bg('saveSettings', { settings: patch }); }

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}

/** Tema: "system" ise işletim sisteminin tercihi, değilse açık/koyu zorlanır. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

/** Düğme içeriği: ikon + metin. */
export function setButton(btn, iconName, label, { size = 16 } = {}) {
  btn.innerHTML = '';
  if (iconName) btn.insertAdjacentHTML('beforeend', iconSvg(iconName, { size }));
  if (label) btn.append(h('span', {}, label));
}

/** Durum etiketi: tür ok | warn | danger | accent | '' ; isteğe bağlı ikon. */
export function tag(text, kind = '', iconName = '') {
  const e = h('span', { class: 'tag' + (kind ? ' ' + kind : '') });
  if (iconName) e.insertAdjacentHTML('beforeend', iconSvg(iconName, { size: 12 }));
  e.append(text);
  return e;
}

/** Uyarı kutusu (ikonlu). */
export function noticeBox(content, error = false) {
  const e = h('div', { class: 'notice' + (error ? ' error' : '') });
  e.insertAdjacentHTML('beforeend', iconSvg(error ? 'x-circle-fill' : 'warning-fill', { size: 16 }));
  e.append(h('div', {}, content));
  return e;
}

export function toast(text, ms = 2200) {
  let t = $('.toast');
  if (!t) { t = h('div', { class: 'toast' }); document.body.append(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}

export function relTime(ms) {
  if (!ms) return '';
  const d = Math.round((Date.now() - ms) / 60000);
  if (d < 1) return t('az önce');
  if (d < 60) return t('{n} dk önce', { n: d });
  const hh = Math.floor(d / 60);
  if (hh < 24) return t('{n} sa önce', { n: hh });
  return t('{n} gün önce', { n: Math.floor(hh / 24) });
}

export function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function cleanTitle(t) {
  return String(t || '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim();
}

export function kindLabel(k) { return KIND_LABEL[k] ? t(KIND_LABEL[k]) : (k || t('Ara')); }
export function categoryLabel(c) { return CATEGORY[c] ? t(CATEGORY[c]) : (c || ''); }

export const KIND_LABEL = {
  opener: 'Açılış', regular: 'Gündem arası', breaking: 'Son dakika', idle: 'Ara sohbet', recap: 'Özet', hourly: 'Saat başı', listener: 'Dinleyici mesajı',
};

export const CATEGORY = {
  gundem: 'Gündem', siyaset: 'Siyaset', ekonomi: 'Ekonomi', dunya: 'Dünya', spor: 'Spor', teknoloji: 'Teknoloji', bilim: 'Bilim',
  kultur: 'Kültür-Sanat', magazin: 'Magazin', saglik: 'Sağlık', yasam: 'Yaşam', kisisel: 'Kişisel', diger: 'Diğer',
};

/** Durum satırı: ne oluyor? */
export function phaseText(st) {
  if (!st || !st.on) return t('Radyo kapalı');
  if (st.waitingFeed) return t('X akışın yükleniyor · ilk haberler bekleniyor…');
  if (st.phase === 'talking') return st.segment?.kind === 'breaking' ? t('SON DAKİKA yayında') : t('{a} ve {b} konuşuyor', { a: st.hosts?.A?.name || 'DJ', b: st.hosts?.B?.name || 'DJ' });
  if (st.preparing?.some((k) => k !== 'triage')) return t('DJ\'ler bir sonraki arayı hazırlıyor…');
  if (st.queue?.length) return t('Sıradaki ara hazır, uygun anı bekliyor');
  if (st.nextTalkAt) {
    const m = Math.max(0, Math.round((st.nextTalkAt - Date.now()) / 60000));
    return m <= 0 ? t('Müzik çalıyor · ara yaklaşıyor') : t('Müzik çalıyor · sonraki ara ~{m} dk', { m });
  }
  return t('Müzik çalıyor');
}

/** Görselleştirici bağlantısı (ses belgesinden seviye verisi). */
export function connectViz(onData) {
  let port = null; let closed = false; let retry = null;
  const connect = () => {
    if (closed) return;
    try {
      port = chrome.runtime.connect({ name: 'viz' });
      port.onMessage.addListener(onData);
      port.onDisconnect.addListener(() => { void chrome.runtime.lastError; port = null; if (!closed) retry = setTimeout(connect, 2500); });
    } catch { retry = setTimeout(connect, 2500); }
  };
  connect();
  return () => { closed = true; clearTimeout(retry); try { port?.disconnect(); } catch { /* */ } };
}

export function makeBars(container, n = 24) {
  container.innerHTML = '';
  const spans = Array.from({ length: n }, () => { const s = document.createElement('span'); container.append(s); return s; });
  return (bands) => {
    if (!bands) { spans.forEach((s) => { s.style.height = '6%'; }); return; }
    spans.forEach((s, i) => { s.style.height = Math.max(6, Math.min(100, (bands[i] || 0) * 140)) + '%'; });
  };
}
