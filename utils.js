/* SecureWatch — shared utilities (no dependencies) */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = (SW.util = {});

  /* ---------- Escaping / DOM ---------- */
  U.esc = function (v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  U.clean = function (v, max) {
    // trims, strips control characters, limits length
    return String(v == null ? '' : v)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
      .slice(0, max || 2000);
  };

  /* ---------- IDs ---------- */
  U.uid = function (prefix) {
    const r = (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 1e9, Math.random() * 1e9]);
    return (prefix ? prefix + '-' : '') + Date.now().toString(36) + '-' + Array.from(r).map((n) => (n >>> 0).toString(36)).join('').slice(0, 8);
  };
  U.token = function (len) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = crypto.getRandomValues(new Uint8Array(len || 8));
    return Array.from(a).map((n) => chars[n % chars.length]).join('');
  };

  /* ---------- Dates (UK formats, always shown in UK time) ----------
   * The site is in the UK, so every time is shown and entered in Europe/London time,
   * whatever time zone the viewing device is set to (e.g. a manager abroad). */
  const pad = (n) => String(n).padStart(2, '0');
  U.pad = pad;
  U.TZ = 'Europe/London';
  let fmtP = null;
  function parts(d) {
    if (!fmtP) fmtP = new Intl.DateTimeFormat('en-GB', { timeZone: U.TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const o = {};
    fmtP.formatToParts(d).forEach((x) => { if (x.type !== 'literal') o[x.type] = +x.value; });
    if (o.hour === 24) o.hour = 0;
    return o;
  }
  U.parts = parts;
  U.toDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);
  const ok = (d) => d && !isNaN(d);
  U.fmtTime = (v) => { const d = U.toDate(v); if (!ok(d)) return '—'; const p = parts(d); return pad(p.hour) + ':' + pad(p.minute); };
  U.fmtTimeSec = (v) => { const d = U.toDate(v); if (!ok(d)) return '—'; const p = parts(d); return pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second); };
  U.fmtDate = (v) => { const d = U.toDate(v); if (!ok(d)) return '—'; const p = parts(d); return pad(p.day) + '/' + pad(p.month) + '/' + p.year; };
  U.fmtDateTime = (v) => (v ? U.fmtDate(v) + ' ' + U.fmtTime(v) : '—');
  U.fmtLongDate = (v) => { const d = U.toDate(v); return ok(d) ? d.toLocaleDateString('en-GB', { timeZone: U.TZ, day: 'numeric', month: 'long', year: 'numeric' }) : '—'; };
  U.fmtShortDate = (v) => { const d = U.toDate(v); return ok(d) ? d.toLocaleDateString('en-GB', { timeZone: U.TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—'; };
  U.ymd = (v) => { const d = U.toDate(v) || new Date(); const p = parts(d); return p.year + '-' + pad(p.month) + '-' + pad(p.day); };
  U.today = () => U.ymd(new Date());
  U.ymdAdd = function (ymd, n) { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); };
  /* UK wall-clock date + time -> real instant (handles GMT/BST) */
  U.combine = function (ymd, hm) {
    const [y, m, d] = ymd.split('-').map(Number);
    const [h, mi] = (hm || '00:00').split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, h, mi);
    const off = (t) => { const p = parts(new Date(t)); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t; };
    let t = guess - off(guess);
    t = guess - off(t);
    return new Date(t);
  };
  U.addDays = (d, n) => new Date(U.toDate(d).getTime() + n * 86400000);
  U.duration = function (ms) {
    if (ms == null || isNaN(ms) || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(sec);
  };
  U.minsLabel = function (ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' h ' + (m % 60) + ' min ago';
    return Math.floor(h / 24) + ' d ago';
  };

  /* ---------- Licence ---------- */
  U.licenceStatus = function (expiry, warnDays) {
    if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return { key: 'unknown', label: 'No expiry date', cls: 'grey', icon: '⚪' };
    const exp = U.combine(expiry, '23:59');
    const now = new Date();
    const days = Math.ceil((exp - now) / 86400000);
    if (days < 0) return { key: 'expired', label: 'Expired', cls: 'red', icon: '🔴', days };
    if (days <= (warnDays || 60)) return { key: 'expiring', label: 'Expiring soon (' + days + ' d)', cls: 'amber', icon: '🟠', days };
    return { key: 'valid', label: 'In date', cls: 'green', icon: '🟢', days };
  };
  U.validSia = (n) => /^\d{16}$/.test(String(n || '').replace(/\s/g, ''));
  U.fmtSia = (n) => String(n || '').replace(/\s/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');
  U.validEmail = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  U.validPhone = (p) => !p || /^[+0-9 ()-]{7,20}$/.test(p);

  /* ---------- GPS ---------- */
  U.getGPS = function (opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        resolve({ ok: false, error: 'This browser does not support location.', code: 'unsupported' });
        return;
      }
      let done = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };
      const t = setTimeout(() => finish({ ok: false, error: 'Location timed out. Move near a window or outside and try again.', code: 'timeout' }), (opts.timeout || 15000) + 1500);
      navigator.geolocation.getCurrentPosition(
        (p) => {
          clearTimeout(t);
          finish({
            ok: true,
            lat: +p.coords.latitude.toFixed(6),
            lng: +p.coords.longitude.toFixed(6),
            accuracy: Math.round(p.coords.accuracy),
            at: new Date(p.timestamp || Date.now()).toISOString(),
          });
        },
        (err) => {
          clearTimeout(t);
          const map = {
            1: 'Location permission was denied. GPS verification could not be completed.',
            2: 'Location is unavailable on this device right now.',
            3: 'Location timed out. Move near a window or outside and try again.',
          };
          finish({ ok: false, error: map[err.code] || 'Unable to obtain location.', code: err.code === 1 ? 'denied' : 'error' });
        },
        { enableHighAccuracy: true, timeout: opts.timeout || 15000, maximumAge: opts.maxAge == null ? 10000 : opts.maxAge }
      );
    });
  };
  U.distance = function (a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const R = 6371000, toR = (x) => (x * Math.PI) / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(s)));
  };
  U.gpsLabel = function (g) {
    if (!g) return 'Not captured';
    if (!g.ok) return 'Not available';
    return g.lat.toFixed(5) + ', ' + g.lng.toFixed(5) + ' (±' + g.accuracy + ' m)';
  };
  U.mapLink = (g) => (g && g.ok ? 'https://www.openstreetmap.org/?mlat=' + g.lat + '&mlon=' + g.lng + '#map=18/' + g.lat + '/' + g.lng : null);
  U.deviceInfo = function () {
    const ua = navigator.userAgent || '';
    let browser = 'Browser';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/CriOS|Chrome\//.test(ua)) browser = 'Chrome';
    else if (/FxiOS|Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    let os = 'Unknown OS';
    if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    return { browser, os, standalone: !!standalone, online: navigator.onLine, screen: screen.width + '×' + screen.height };
  };

  /* ---------- Hashing (passwords are never stored in plain text) ---------- */
  U.hash = async function (text, salt) {
    const data = new TextEncoder().encode(salt + '::' + text);
    if (crypto.subtle && crypto.subtle.digest) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback for insecure contexts (e.g. plain http on a LAN). Not cryptographically strong.
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < data.length; i++) {
      h1 = Math.imul(h1 ^ data[i], 2654435761);
      h2 = Math.imul(h2 ^ data[i], 1597334677);
    }
    return 'weak-' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  };

  U.pbkdf2 = async function (password, salt, iterations) {
    if (!(crypto.subtle && crypto.subtle.importKey)) throw new Error('Sign-in needs a secure (https) connection.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: iterations || 150000 }, key, 256);
    return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  /* ---------- CSV / downloads ---------- */
  U.csv = function (rows, columns) {
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // guard against spreadsheet formula injection
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = columns.map((c) => cell(c.label)).join(',');
    const body = rows.map((r) => columns.map((c) => cell(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','));
    return '\uFEFF' + [head].concat(body).join('\r\n');
  };
  U.download = function (filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  };

  /* ---------- Toasts ---------- */
  U.toast = function (msg, kind, ms) {
    let host = document.getElementById('toasts');
    if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'toast toast-' + (kind || 'info');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms || 3200);
  };

  /* ---------- Modal / confirm ---------- */
  U.modal = function (opts) {
    // opts: { title, body (html), actions: [{label, cls, value, onClick}], wide, onOpen, dismissable }
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML =
        '<div class="modal' + (opts.wide ? ' modal-wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="mdl-title">' +
        '<div class="modal-head"><h2 id="mdl-title">' + U.esc(opts.title || '') + '</h2>' +
        (opts.dismissable === false ? '' : '<button class="icon-btn mdl-x" aria-label="Close">✕</button>') + '</div>' +
        '<div class="modal-body">' + (opts.body || '') + '</div>' +
        (opts.actions && opts.actions.length ? '<div class="modal-foot"></div>' : '') +
        '</div>';
      const prevFocus = document.activeElement;
      const close = (val) => { wrap.remove(); document.removeEventListener('keydown', onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); resolve(val); };
      const onKey = (e) => { if (e.key === 'Escape' && opts.dismissable !== false) close(null); };
      document.addEventListener('keydown', onKey);
      const x = wrap.querySelector('.mdl-x');
      if (x) x.onclick = () => close(null);
      if (opts.dismissable !== false) wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(null); });
      const foot = wrap.querySelector('.modal-foot');
      (opts.actions || []).forEach((a) => {
        const b = document.createElement('button');
        b.className = 'btn ' + (a.cls || 'btn-secondary');
        b.textContent = a.label;
        b.onclick = async () => {
          if (a.onClick) {
            const r = await a.onClick(wrap.querySelector('.modal'));
            if (r === false) return; // keep open (validation failed)
            close(r === undefined ? a.value : r);
          } else close(a.value);
        };
        foot.appendChild(b);
      });
      document.body.appendChild(wrap);
      const first = wrap.querySelector('input,select,textarea,.modal-foot .btn-primary,.modal-foot .btn');
      if (first) setTimeout(() => first.focus(), 30);
      if (opts.onOpen) opts.onOpen(wrap.querySelector('.modal'), close);
    });
  };
  U.confirm = function (title, message, okLabel, danger) {
    return U.modal({
      title,
      body: '<p>' + U.esc(message) + '</p>',
      actions: [
        { label: 'Cancel', cls: 'btn-secondary', value: false },
        { label: okLabel || 'Confirm', cls: danger ? 'btn-danger' : 'btn-primary', value: true },
      ],
    }).then((v) => v === true);
  };

  /* ---------- Misc ---------- */
  U.debounce = function (fn, ms) { let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms); }; };
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  U.badge = (text, cls) => '<span class="badge badge-' + (cls || 'grey') + '">' + U.esc(text) + '</span>';
  U.statusCls = function (s) {
    return ({
      'Complete': 'green', 'Completed': 'green', 'Confirmed': 'green', 'Resolved': 'green', 'Valid': 'green', 'Verified': 'green', 'On duty': 'green', 'Active': 'blue',
      'Incomplete': 'amber', 'Under Review': 'amber', 'Paused': 'amber', 'Out of range': 'amber', 'Duplicate': 'amber', 'Acknowledged': 'amber', 'Scheduled': 'grey',
      'Missed': 'red', 'Open': 'red', 'Invalid': 'red', 'Critical': 'red', 'High': 'red', 'Medium': 'amber', 'Low': 'grey', 'No GPS': 'grey',
    })[s] || 'grey';
  };
  U.fileSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
})();
