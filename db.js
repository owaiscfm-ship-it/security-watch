/* SecureWatch — data layer
 * IndexedDB is the primary store. Records are cached in memory for fast rendering;
 * media (photos, video, audio) stays in IndexedDB as Blobs and is only loaded on demand.
 * If IndexedDB is unavailable, records fall back to localStorage (media cannot be stored).
 */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = SW.util;

  const DB_NAME = 'securewatch';
  const DB_VERSION = 1;
  const STORES = [
    'users', 'guards', 'sites', 'patrolRoutes', 'checkpoints', 'shifts', 'patrols',
    'checkpointScans', 'incidents', 'welfareChecks', 'siteInstructions', 'instructionAcks',
    'attendance', 'sosEvents', 'auditLogs', 'settings', 'syncQueue',
  ];
  const MEDIA = 'media';

  const data = {};
  STORES.forEach((s) => (data[s] = []));

  let idb = null;
  const remoteOn = () => !!(SW.remote && SW.remote.enabled && SW.session && SW.session.remote && SW.session.role !== 'client'); // clients are read-only
  let mode = 'indexeddb';

  function openIDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB not supported'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        STORES.concat([MEDIA]).forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database blocked by another tab'));
    });
  }
  function tx(store, rw) { return idb.transaction(store, rw ? 'readwrite' : 'readonly').objectStore(store); }
  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  const db = (SW.db = {
    data,
    STORES,
    get mode() { return mode; },

    async init() {
      try {
        idb = await openIDB();
        for (const s of STORES) data[s] = await reqP(tx(s).getAll());
      } catch (e) {
        console.warn('IndexedDB unavailable, using localStorage fallback', e);
        mode = 'localstorage';
        for (const s of STORES) {
          try { data[s] = JSON.parse(localStorage.getItem('sw_' + s) || '[]'); } catch (_) { data[s] = []; }
        }
      }
    },

    all(store) { return data[store] || []; },
    get(store, id) { return (data[store] || []).find((r) => r.id === id) || null; },
    where(store, fn) { return (data[store] || []).filter(fn); },

    async put(store, rec) {
      if (!rec.id) rec.id = U.uid(store.slice(0, 3));
      rec.updatedAt = new Date().toISOString();
      if (!rec.createdAt) rec.createdAt = rec.updatedAt;
      const arr = data[store];
      const i = arr.findIndex((r) => r.id === rec.id);
      if (i >= 0) arr[i] = rec; else arr.push(rec);
      if (mode === 'indexeddb') await reqP(tx(store, true).put(rec));
      else localStorage.setItem('sw_' + store, JSON.stringify(arr));
      if (remoteOn() && !SW.remote.LOCAL_ONLY.has(store)) await db.queueUp(store, rec.id, 'upsert');
      return rec;
    },

    /* write a record received from the server (no timestamps changed, not re-uploaded) */
    async putRaw(store, rec) {
      const arr = data[store];
      const i = arr.findIndex((r) => r.id === rec.id);
      if (i >= 0) arr[i] = rec; else arr.push(rec);
      if (mode === 'indexeddb') await reqP(tx(store, true).put(rec));
      else localStorage.setItem('sw_' + store, JSON.stringify(arr));
    },
    async removeRaw(store, id) {
      data[store] = data[store].filter((r) => r.id !== id);
      if (mode === 'indexeddb') await reqP(tx(store, true).delete(id));
      else localStorage.setItem('sw_' + store, JSON.stringify(data[store]));
    },
    async queueUp(store, recordId, op, snapshot) {
      const q = { id: 'Q|' + store + '|' + recordId, store, recordId, op, snapshot: snapshot || null, queuedAt: new Date().toISOString(), offline: !navigator.onLine, v: U.token(8), synced: false };
      const arr = data.syncQueue;
      const i = arr.findIndex((r) => r.id === q.id);
      if (i >= 0) arr[i] = q; else arr.push(q);
      if (mode === 'indexeddb') await reqP(tx('syncQueue', true).put(q));
      else localStorage.setItem('sw_syncQueue', JSON.stringify(arr));
    },

    async putMany(store, recs) {
      for (const r of recs) {
        if (!r.id) r.id = U.uid(store.slice(0, 3));
        r.createdAt = r.createdAt || new Date().toISOString();
        r.updatedAt = r.updatedAt || r.createdAt;
        data[store].push(r);
      }
      if (mode === 'indexeddb') {
        await new Promise((res, rej) => {
          const t = idb.transaction(store, 'readwrite');
          const os = t.objectStore(store);
          recs.forEach((r) => os.put(r));
          t.oncomplete = res; t.onerror = () => rej(t.error);
        });
      } else localStorage.setItem('sw_' + store, JSON.stringify(data[store]));
    },

    async remove(store, id) {
      const gone = data[store].find((r) => r.id === id);
      if (remoteOn() && !SW.remote.LOCAL_ONLY.has(store) && gone) await db.queueUp(store, id, 'delete', { siteId: gone.siteId || null, guardId: gone.guardId || null });
      data[store] = data[store].filter((r) => r.id !== id);
      if (mode === 'indexeddb') await reqP(tx(store, true).delete(id));
      else localStorage.setItem('sw_' + store, JSON.stringify(data[store]));
    },

    async clearAll() {
      for (const s of STORES) {
        data[s] = [];
        if (mode === 'indexeddb') await reqP(tx(s, true).clear());
        else localStorage.removeItem('sw_' + s);
      }
      if (mode === 'indexeddb') await reqP(tx(MEDIA, true).clear());
    },

    /* ---- Media blobs ---- */
    async putMedia(blob, meta) {
      if (mode !== 'indexeddb') throw new Error('Media storage needs IndexedDB, which this browser has disabled.');
      const rec = Object.assign({ id: U.uid('MED'), blob, type: blob.type, size: blob.size, createdAt: new Date().toISOString() }, meta || {});
      await reqP(tx(MEDIA, true).put(rec));
      return { id: rec.id, kind: rec.kind, name: rec.name, type: rec.type, size: rec.size };
    },
    async getMedia(id) {
      if (mode !== 'indexeddb') return null;
      return reqP(tx(MEDIA).get(id));
    },

    /* ---- Settings ---- */
    settings() {
      return Object.assign(
        { id: 'app', welfareInterval: 60, welfareGrace: 10, patrolFrequency: 120, gpsRadius: 75, licenceWarnDays: 60, demoMode: false, companyName: 'Crystal Facilities Management Ltd' },
        db.get('settings', 'app') || {}
      );
    },
    async saveSettings(patch) { return db.put('settings', Object.assign(db.settings(), patch)); },

    /* ---- Audit ---- */
    async audit(action, opts) {
      opts = opts || {};
      const s = SW.session || {};
      return db.put('auditLogs', {
        id: U.uid('AUD'),
        at: opts.at || new Date().toISOString(),
        user: opts.user || s.displayName || 'System',
        role: opts.role || s.role || 'system',
        action,
        guardId: s.guardId || null,
        siteId: opts.siteId || null,
        subject: opts.subject || '',
        related: opts.related || '',
        source: opts.source || 'device',
      });
    },

    /* ---- Offline sync queue ----
     * Operational records written while the device is offline are queued.
     * When the browser reports it is back online the queue is processed by the active
     * sync adapter. The default adapter is LOCAL ONLY: there is no server on GitHub Pages,
     * so "synced" means "committed to this device's database" — nothing leaves the phone.
     */
    async queue(store, recordId) {
      if (remoteOn() || navigator.onLine) return; // with a server, every write is queued by put()
      await db.put('syncQueue', { id: U.uid('SYNC'), store, recordId, queuedAt: new Date().toISOString(), synced: false });
    },
    pending() { return data.syncQueue.filter((q) => !q.synced); },
  });

  /* Pluggable sync adapter. Replace with a Supabase/Firebase adapter later (see README). */
  SW.syncAdapter = {
    name: 'Local device only',
    remote: false,
    async push(items) { await U.sleep(900); return items.map((i) => i.id); },
  };
})();
