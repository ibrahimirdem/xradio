// IndexedDB sarmalayıcı. Eklentinin tüm bağlamları (arka plan, gizli belge, stüdyo) aynı kökeni paylaştığı
// için aynı veritabanını görür.
//   inbox: X'ten gelen ve henüz haber masasına alınmamış tweet'ler (radyo kapalıyken de birikir)
//   kv:    haber masası durumu, hafıza, istatistikler
//   log:   yayın geçmişi (bölümler, transkriptler, kaynak tweet bağlantıları)

const DB_NAME = 'xradio';
const DB_VERSION = 1;
let dbp = null;

export function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('inbox')) db.createObjectStore('inbox', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('log')) {
        const s = db.createObjectStore('log', { keyPath: 'id' });
        s.createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const req2p = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export async function kvGet(key) {
  const db = await openDb();
  return tx(db, 'kv', 'readonly', (s) => req2p(s.get(key)));
}

export async function kvSet(key, value) {
  const db = await openDb();
  return tx(db, 'kv', 'readwrite', (s) => { s.put(value, key); });
}

/** Tweet'leri gelen kutusuna ekler/günceller (metrikler birleştirilir). */
export async function inboxPut(tweets) {
  if (!tweets?.length) return 0;
  const db = await openDb();
  return tx(db, 'inbox', 'readwrite', async (s) => {
    let n = 0;
    for (const t of tweets) {
      const prev = await req2p(s.get(t.id));
      if (prev) {
        for (const k of Object.keys(t.metrics || {})) prev.metrics[k] = Math.max(prev.metrics?.[k] || 0, t.metrics[k] || 0);
        const h = new Set((prev.retweetedBy || []).map((r) => r.handle));
        for (const r of t.retweetedBy || []) if (!h.has(r.handle)) prev.retweetedBy.push(r);
        s.put(prev);
      } else { s.put(t); n++; }
    }
    return n;
  });
}

/** Gelen kutusunu boşaltır ve içeriği döndürür. */
export async function inboxDrain() {
  const db = await openDb();
  return tx(db, 'inbox', 'readwrite', async (s) => {
    const all = await req2p(s.getAll());
    s.clear();
    return all;
  });
}

export async function inboxCount() {
  const db = await openDb();
  return tx(db, 'inbox', 'readonly', (s) => req2p(s.count()));
}

/** Gelen kutusunu sınırlı tutar (en yeni N, en fazla maxAge). */
export async function inboxPrune(max = 800, maxAgeMs = 30 * 3600e3) {
  const db = await openDb();
  return tx(db, 'inbox', 'readwrite', async (s) => {
    const all = await req2p(s.getAll());
    const now = Date.now();
    const sorted = all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    sorted.forEach((t, i) => { if (i >= max || now - (t.createdAt || now) > maxAgeMs) s.delete(t.id); });
  });
}

export async function logAdd(entry) {
  const db = await openDb();
  return tx(db, 'log', 'readwrite', (s) => { s.put(entry); });
}

export async function logList({ since = 0, limit = 200 } = {}) {
  const db = await openDb();
  return tx(db, 'log', 'readonly', async (s) => {
    const all = await req2p(s.index('ts').getAll(IDBKeyRange.lowerBound(since)));
    return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
  });
}

export async function logPrune(keepDays = 7) {
  const db = await openDb();
  const cutoff = Date.now() - keepDays * 86400e3;
  return tx(db, 'log', 'readwrite', async (s) => {
    const old = await req2p(s.index('ts').getAllKeys(IDBKeyRange.upperBound(cutoff)));
    for (const k of old) s.delete(k);
  });
}

export async function clearAll() {
  const db = await openDb();
  for (const store of ['inbox', 'kv', 'log']) await tx(db, store, 'readwrite', (s) => { s.clear(); });
}
