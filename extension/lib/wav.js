// PCM / WAV yardımcıları (tarayıcı ve Node'da çalışır).

export function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function bytesToBase64(bytes) {
  if (typeof btoa === 'function') {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
}

/** 16-bit LE PCM'i WAV dosyasına sarar. */
export function pcm16ToWav(pcm, sampleRate = 24000, channels = 1) {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const byteRate = sampleRate * channels * 2;
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

export function isWav(bytes) {
  return bytes && bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
}

/** WAV başlığından süre/biçim bilgisi. */
export function wavInfo(bytes) {
  if (!isWav(bytes)) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12; let fmt = null; let dataLen = 0;
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    const size = v.getUint32(off + 4, true);
    if (id === 'fmt ') fmt = { channels: v.getUint16(off + 10, true), sampleRate: v.getUint32(off + 12, true), bits: v.getUint16(off + 22, true) };
    if (id === 'data') { dataLen = Math.min(size, bytes.length - off - 8); break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt) return null;
  return { ...fmt, duration: dataLen / (fmt.sampleRate * fmt.channels * (fmt.bits / 8)) };
}

/** MIME türünden örnekleme hızı ("audio/L16;codec=pcm;rate=24000"). */
export function rateFromMime(mime, fallback = 24000) {
  const m = /rate=(\d+)/i.exec(mime || '');
  return m ? parseInt(m[1], 10) : fallback;
}

/** Ham baytları WebAudio'nun çözebileceği bir WAV'a dönüştürür. */
export function ensureWav(bytes, mime = '') {
  if (isWav(bytes)) return bytes;
  if (/l16|pcm/i.test(mime) || !mime) return pcm16ToWav(bytes, rateFromMime(mime, 24000), /channels=2/.test(mime) ? 2 : 1);
  return bytes; // mp3/ogg vb. doğrudan çözülebilir
}

/** 16-bit LE PCM'den Float32 kanallara (Lyria akışı için). */
export function pcm16ToFloat32(bytes, channels = 2) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = Math.floor(bytes.byteLength / (2 * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) out[c][i] = v.getInt16((i * channels + c) * 2, true) / 32768;
  }
  return out;
}
