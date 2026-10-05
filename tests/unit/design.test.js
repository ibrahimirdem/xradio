// Tasarım kuralları: arayüzde emoji ikon yok, mor/gradyan yok, kullanılan her ikon gömülü sette var.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ICON_NAMES } from '../../extension/ui/icons.js';

const read = (p) => fs.readFileSync(new URL(`../../extension/${p}`, import.meta.url), 'utf8');
const UI_FILES = ['popup.html', 'studio.html', 'ui/popup.js', 'ui/studio.js', 'ui/common.js', 'ui/library.js', 'content/x-collector.js', 'lib/messages.js'];
// Emoji ve piktogram blokları (✓ ✗ ✦ gibi yazı simgeleri serbest)
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}\u{1D400}-\u{1D7FF}]/u;

test('arayüzde emoji ikon kullanılmaz (ikonlar SVG)', () => {
  for (const f of UI_FILES) {
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return; // yorum satırları
      assert.ok(!EMOJI.test(line), `${f}:${i + 1} emoji içeriyor → ${line.trim().slice(0, 90)}`);
    });
  }
});

test('tasarım sistemi: mor ve gradyan yok, tek vurgu rengi token olarak tanımlı', () => {
  const css = ['ui/base.css', 'ui/popup.css', 'ui/studio.css'].map(read).join('\n');
  assert.ok(!/#8b5cf6|#ec4899|violet|purple/i.test(css), 'mor tonlar kaldırılmalı');
  assert.ok(!/linear-gradient\(\s*\d+deg/.test(css), 'dekoratif gradyan olmamalı');
  assert.ok(!/backdrop-filter/.test(css), 'cam efekti olmamalı');
  assert.match(css, /--accent:\s*#ff5a1f/);
  assert.match(css, /prefers-color-scheme: light/, 'açık tema desteklenmeli');
});

test('kullanılan her ikon gömülü sette var', () => {
  const names = new Set(ICON_NAMES);
  const used = new Set();
  for (const f of ['popup.html', 'studio.html']) {
    const html = read(f);
    for (const m of html.matchAll(/data-icon="([a-z0-9-]+)"/g)) used.add(m[1]);
    for (const m of html.matchAll(/data-ic="([a-z0-9-]+)"/g)) { used.add(m[1]); used.add(m[1] + '-fill'); }
  }
  const js = ['ui/popup.js', 'ui/studio.js', 'ui/common.js', 'ui/library.js'].map(read).join('\n');
  const patterns = [
    /iconSvg\(\s*'([a-z0-9-]+)'/g,
    /setButton\([^,]+,\s*'([a-z0-9-]+)'/g,
    /groupHead\(\s*'([a-z0-9-]+)'/g,
    /item\(\s*'([a-z0-9-]+)'/g,
    /tag\([^()]*,\s*'[a-z]*',\s*'([a-z0-9-]+)'\)/g,
    /'(?:ok|warn|fail|info)': '([a-z0-9-]+)'/g,
    /iconBtn\(\s*'([a-z0-9-]+)'/g,
    /\bbtn\(\s*'([a-z0-9-]+)'/g,
  ];
  for (const re of patterns) for (const m of js.matchAll(re)) for (const g of m.slice(1)) if (g) used.add(g);
  // İkon çağrısı içeren satırlardaki koşullu ikon adları (ör. engine === 'gemini' ? 'brain' : 'cpu')
  for (const line of js.split('\n').filter((l) => /iconSvg\(|setButton\(|setTag\(/.test(l))) {
    for (const m of line.matchAll(/\? '([a-z0-9-]+)' : '([a-z0-9-]+)'/g)) {
      for (const g of m.slice(1)) if (/-(fill|bold)$/.test(g) || names.has(g) || /^[a-z]+-[a-z-]+$/.test(g)) used.add(g);
    }
  }
  const missing = [...used].filter((n) => !names.has(n) && !['accent', 'danger', 'primary', 'live-stop'].includes(n));
  assert.deepEqual(missing, [], 'eksik ikonlar: npm run icons ile ekle');
  assert.ok(used.size > 25);
});
