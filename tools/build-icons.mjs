// Kullanılan Phosphor ikonlarını (MIT, https://phosphoricons.com) eklentiye gömer.
// Çalışma anında paket yok: yalnızca gereken SVG yolları iki küçük dosyaya yazılır.
//   extension/ui/icons.js          → arayüz sayfaları (ES modülü)
//   extension/content/shield-icons.js → X üzerindeki odak kalkanı (içerik betiği)
// Kullanım: npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'node_modules', '@phosphor-icons', 'core', 'assets');

// ad → kullanılacak ağırlıklar. Arayüz normalde "regular", etkin/önemli durumlarda "fill" kullanır.
const UI_ICONS = {
  broadcast: ['regular', 'fill'],
  newspaper: ['regular', 'fill'],
  'clock-counter-clockwise': ['regular', 'fill'],
  'sliders-horizontal': ['regular', 'fill'],
  heartbeat: ['regular', 'fill'],
  compass: ['regular', 'fill'],
  play: ['fill'],
  stop: ['fill'],
  microphone: ['regular', 'fill'],
  'skip-forward': ['fill'],
  'paper-plane-right': ['fill'],
  'download-simple': ['regular'],
  copy: ['regular'],
  'speaker-slash': ['regular'],
  'speaker-high': ['regular'],
  'music-notes': ['regular', 'fill'],
  'globe-simple': ['regular'],
  'arrow-square-out': ['regular'],
  eye: ['regular'],
  'eye-slash': ['regular'],
  key: ['regular'],
  'arrow-counter-clockwise': ['regular'],
  trash: ['regular'],
  'app-window': ['regular'],
  cpu: ['regular'],
  brain: ['regular'],
  waveform: ['regular'],
  flask: ['regular'],
  'shield-check': ['regular'],
  funnel: ['regular'],
  'users-three': ['regular'],
  'x-logo': ['regular'],
  'check-circle': ['fill'],
  warning: ['fill'],
  'x-circle': ['fill'],
  info: ['fill'],
  'hourglass-medium': ['regular'],
  'check': ['bold'],
  clock: ['regular'],
  'cell-signal-medium': ['regular'],
  lightning: ['fill'],
  'stack-simple': ['regular'],
  'chat-circle-dots': ['regular'],
  'arrow-right': ['regular'],
  'circle-half': ['regular'],
  'user-circle': ['regular'],
  'list-checks': ['regular'],
  // Müzik sekmesi (arama, liste)
  'magnifying-glass': ['regular'],
  plus: ['bold'],
  shuffle: ['regular', 'bold'],
  'dots-six-vertical': ['bold'],
  'caret-up': ['bold'],
  'caret-down': ['bold'],
  x: ['bold'],
  playlist: ['regular', 'fill'],
  'list-plus': ['regular'],
  'link-simple': ['regular'],
  'vinyl-record': ['regular'],
  'arrow-left': ['regular'],
  queue: ['regular'],
};

// Odak kalkanı için yalnızca birkaç ikon (içerik betikleri modül içe aktaramaz)
const SHIELD_ICONS = { broadcast: ['regular', 'fill'], microphone: ['fill'], play: ['fill'], 'clock-counter-clockwise': ['regular'], 'app-window': ['regular'], x: ['bold'] };

function inner(name, weight) {
  const file = path.join(SRC, weight, weight === 'regular' ? `${name}.svg` : `${name}-${weight}.svg`);
  if (!fs.existsSync(file)) throw new Error(`İkon yok: ${weight}/${name}`);
  const svg = fs.readFileSync(file, 'utf8');
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
}

function collect(spec) {
  const out = {};
  for (const [name, weights] of Object.entries(spec)) {
    for (const w of weights) out[w === 'regular' ? name : `${name}-${w}`] = inner(name, w);
  }
  return out;
}

const ui = collect(UI_ICONS);
fs.writeFileSync(path.join(root, 'extension', 'ui', 'icons.js'), `// Phosphor Icons (MIT) — https://phosphoricons.com
// tools/build-icons.mjs ile üretildi; elle düzenleme, betiği çalıştır (npm run icons).
const P = ${JSON.stringify(ui, null, 0).replace(/","/g, '",\n  "').replace(/^\{/, '{\n  ').replace(/\}$/, ',\n}')};

/** Bir ikonun SVG kaynağı. Yoksa boş döner (sessizce). */
export function iconSvg(name, { size = 18, label = '' } = {}) {
  const body = P[name];
  if (!body) return '';
  const a11y = label ? \`role="img" aria-label="\${label.replace(/"/g, '&quot;')}"\` : 'aria-hidden="true"';
  return \`<svg class="ic" viewBox="0 0 256 256" width="\${size}" height="\${size}" fill="currentColor" focusable="false" \${a11y}>\${body}</svg>\`;
}

/** İkon öğesi (span içinde SVG); h() ile birlikte kullanılır. */
export function icon(name, opts = {}) {
  const s = document.createElement('span');
  s.className = 'ic-wrap' + (opts.cls ? ' ' + opts.cls : '');
  s.innerHTML = iconSvg(name, opts);
  return s;
}

/** HTML'deki <i data-icon="ad" data-size="16"></i> yer tutucularını SVG ile doldurur. */
export function applyIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.innerHTML = iconSvg(el.dataset.icon, { size: +(el.dataset.size || 18) });
    el.classList.add('ic-wrap');
  }
}

export const ICON_NAMES = Object.keys(P);
`);

const shield = collect(SHIELD_ICONS);
fs.writeFileSync(path.join(root, 'extension', 'content', 'shield-icons.js'), `// Phosphor Icons (MIT) — odak kalkanı için. tools/build-icons.mjs ile üretildi.
globalThis.__xradioIcons = ${JSON.stringify(shield)};
`);
console.log(`arayüz: ${Object.keys(ui).length} ikon, kalkan: ${Object.keys(shield).length} ikon`);
