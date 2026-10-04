// Eklentiyi dağıtım için dist/xradio-<sürüm>.zip olarak paketler (Windows: PowerShell Compress-Archive).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const { version } = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const out = path.join(dist, `xradio-${version}.zip`);
if (fs.existsSync(out)) fs.rmSync(out);

if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${ext}\\*' -DestinationPath '${out}' -Force`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-q', out, '.'], { cwd: ext, stdio: 'inherit' });
}
console.log('Paket:', out);
