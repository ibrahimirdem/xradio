// Arayüzde çevrilecek tüm metin anahtarlarını çıkarır: t('…') çağrıları + data-i18n işaretli HTML öğeleri.
// Ayrıca KIND_LABEL / CATEGORY / ses tarifleri / müzik stilleri / hazır yayın grupları gibi t()'ye dolaylı giden değerleri ekler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');

function unescapeJs(s) { return s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n'); }

export async function collectKeys() {
  const keys = new Set();
  for (const f of ['ui/studio.js', 'ui/popup.js', 'ui/common.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(unescapeJs(m[1]));
  }
  for (const f of ['studio.html', 'popup.html']) {
    const html = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of html.matchAll(/<\w+\b[^>]*\sdata-i18n(?=[\s>])[^>]*>([^<]*)</g)) {
      const txt = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
      if (txt) keys.add(txt);
    }
    for (const m of html.matchAll(/data-i18n-ph[^>]*placeholder="([^"]*)"|placeholder="([^"]*)"[^>]*data-i18n-ph/g)) keys.add((m[1] ?? m[2]).replace(/&quot;/g, '"'));
    for (const m of html.matchAll(/title="([^"]*)"[^>]*data-i18n-title/g)) keys.add(m[1]);
  }
  const cfg = await import('file:///' + path.join(root, 'lib', 'config.js').replace(/\\/g, '/'));
  const yt = await import('file:///' + path.join(root, 'lib', 'youtube.js').replace(/\\/g, '/'));
  // common.js tarayıcı API'si kullandığından burada içe aktarılamayabilir: etiketleri kaynaktan oku
  const csrc = fs.readFileSync(path.join(root, 'ui', 'common.js'), 'utf8');
  for (const block of csrc.matchAll(/export const (KIND_LABEL|CATEGORY) = \{([\s\S]*?)\};/g)) {
    for (const m of block[2].matchAll(/:\s*'([^']+)'/g)) keys.add(m[1]);
  }
  for (const v of cfg.GEMINI_VOICES) keys.add(v.desc);
  for (const m of cfg.MUSIC_STYLES) keys.add(m.label);
  for (const p of yt.YT_PRESETS) keys.add(p.group);
  keys.add('canlı'); keys.add('liste');
  return [...keys].filter(Boolean);
}

if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) {
  const keys = await collectKeys();
  const { EN } = await import('file:///' + path.join(root, 'ui', 'i18n.js').replace(/\\/g, '/')).catch(() => ({ EN: {} }));
  const missing = keys.filter((k) => !(k in EN));
  console.log(`${keys.length} anahtar, ${missing.length} eksik`);
  for (const k of missing) console.log(JSON.stringify(k));
}
