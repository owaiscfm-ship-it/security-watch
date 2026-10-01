/* SecureWatch — domain logic (auth, operations, demo data) */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = SW.util;
  const db = SW.db;

  /* =========================================================
   * AUTH (prototype only — simulated in the browser)
   * Passwords are stored as salted SHA-256 hashes, never as text.
   * This is NOT secure authentication: anyone with access to the
   * device can read or change local data. Use a backend in production.
   * ========================================================= */
  const SESSION_KEY = 'sw_session';
  SW.session = null;

  SW.auth = {
    DEMO: [
      { username: 'manager', password: 'manager', role: 'manager', displayName: 'Ops Manager (demo)' },
      { username: 'guard', password: 'guard', role: 'guard', displayName: 'John Smith', guardId: 'G-001' },
      { username: 'client', password: 'client', role: 'client', displayName: 'Client viewer (demo)', siteIds: ['S-001'] },
    ],
    async ensureDemoUsers() {
      for (const d of SW.auth.DEMO) {
        if (db.all('users').some((u) => u.username === d.username)) continue;
        const salt = U.token(12);
        await db.put('users', {
          id: 'U-' + d.username,
          username: d.username,
          role: d.role,
          displayName: d.displayName,
          guardId: d.guardId || null,
          siteIds: d.siteIds || [],
          salt,
          hash: await U.hash(d.password, salt),
          demo: true,
        });
      }
    },
    async createUser(username, password, role, extra) {
      username = U.clean(username, 40).toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Username must be 3–40 letters, numbers, dots, dashes or underscores.');
      if (db.all('users').some((u) => u.username === username)) throw new Error('That username is already in use.');
      if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
      const salt = U.token(12);
      return db.put('users', Object.assign({ id: U.uid('U'), username, role, salt, hash: await U.hash(password, salt) }, extra || {}));
    },
    async login(username, password, role) {
      username = U.clean(username, 40).toLowerCase();
      const u = db.all('users').find((x) => x.username === username);
      if (!u) return { ok: false, error: 'Username or password is incorrect.' };
      const h = await U.hash(password || '', u.salt);
      if (h !== u.hash) return { ok: false, error: 'Username or password is incorrect.' };
      if (role && u.role !== role) return { ok: false, error: 'This account is not a ' + role + ' account.' };
      if (u.role === 'guard') {
        const g = db.get('guards', u.guardId);
        if (!g) return { ok: false, error: 'This login is not linked to a guard record.' };
        if (g.status !== 'Active') return { ok: false, error: 'This guard is marked ' + g.status + '. Contact your manager.' };
      }
      SW.session = { userId: u.id, username: u.username, role: u.role, displayName: u.role === 'guard' ? (db.get('guards', u.guardId) || {}).name : u.displayName, guardId: u.guardId || null, siteIds: u.siteIds || [], at: Date.now() };
      localStorage.setItem(SESSION_KEY, JSON.stringify(SW.session));
      await db.audit('Signed in', { subject: u.role });
      return { ok: true, session: SW.session };
    },
    restore() {
      try {
        const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        if (s && Date.now() - s.at < 16 * 3600 * 1000 && db.get('users', s.userId)) { SW.session = s; return s; }
      } catch (_) { /* ignore */ }
      localStorage.removeItem(SESSION_KEY);
      return null;
    },
    async logout() {
      if (SW.session) await db.audit('Signed out', { subject: SW.session.role });
      SW.session = null;
      localStorage.removeItem(SESSION_KEY);
    },
  };

  /* =========================================================
   * QUERIES
   * ========================================================= */
  const Q = (SW.q = {
    guard: (id) => db.get('guards', id),
    site: (id) => db.get('sites', id),
    guardName: (id) => (db.get('guards', id) || {}).name || 'Unknown guard',
    siteName: (id) => (db.get('sites', id) || {}).name || 'Unknown site',
    routesForSite: (siteId) => db.where('patrolRoutes', (r) => r.siteId === siteId).sort((a, b) => (a.name > b.name ? 1 : -1)),
    routeName: (id) => (db.get('patrolRoutes', id) || {}).name || 'Patrol',
    checkpointsForRoute: (routeId) => db.where('checkpoints', (c) => c.routeId === routeId).sort((a, b) => a.order - b.order),
    checkpointsForSite: (siteId) => db.where('checkpoints', (c) => c.siteId === siteId).sort((a, b) => (a.routeId === b.routeId ? a.order - b.order : a.routeId > b.routeId ? 1 : -1)),
    instructionsFor: (siteId) => db.all('siteInstructions').find((i) => i.siteId === siteId) || null,
    scansForPatrol: (pid) => db.where('checkpointScans', (s) => s.patrolId === pid && s.status === 'Valid'),
    activePatrol: (shiftId) => db.all('patrols').find((p) => p.shiftId === shiftId && (p.status === 'Active' || p.status === 'Paused')) || null,
    onDutyShifts: () => db.where('shifts', (s) => s.status === 'On duty'),
    shiftForGuard(guardId) {
      const now = Date.now();
      const mine = db.where('shifts', (s) => s.guardId === guardId);
      const onDuty = mine.find((s) => s.status === 'On duty');
      if (onDuty) return onDuty;
      const open = mine
        .filter((s) => s.status === 'Scheduled' && new Date(s.endAt).getTime() > now)
        .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
      return open[0] || null;
    },
    canStart(shift) {
      const early = 60 * 60000;
      const now = Date.now();
      return shift && shift.status === 'Scheduled' && now >= new Date(shift.startAt).getTime() - early && now < new Date(shift.endAt).getTime();
    },
    scheduledPatrols(shift) {
      const freq = shift.patrolFreq || db.settings().patrolFrequency;
      return Math.max(1, Math.floor((new Date(shift.endAt) - new Date(shift.startAt)) / (freq * 60000)));
    },
    scheduledWelfare(shift) {
      const freq = shift.welfareFreq || db.settings().welfareInterval;
      return Math.max(1, Math.floor((new Date(shift.endAt) - new Date(shift.startAt)) / (freq * 60000)));
    },
    patrolElapsed(p) {
      const end = p.endAt ? new Date(p.endAt).getTime() : Date.now();
      let paused = 0;
      (p.pauses || []).forEach((x) => { paused += (x.end ? new Date(x.end).getTime() : end) - new Date(x.start).getTime(); });
      return end - new Date(p.startAt).getTime() - paused;
    },
    patrolProgress(p) {
      const cps = Q.checkpointsForRoute(p.routeId);
      const scanned = new Set(Q.scansForPatrol(p.id).map((s) => s.checkpointId));
      return { cps, scanned, done: cps.filter((c) => scanned.has(c.id)).length, total: cps.length, next: cps.find((c) => !scanned.has(c.id)) || null };
    },
    lastScan(guardId) {
      return db.where('checkpointScans', (s) => s.guardId === guardId && s.status === 'Valid').sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;
    },
    lastWelfare(guardId) {
      return db.where('welfareChecks', (w) => w.guardId === guardId && w.status === 'Confirmed').sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;
    },
    lastGps(guardId) {
      const events = []
        .concat(db.where('attendance', (a) => a.guardId === guardId))
        .concat(db.where('checkpointScans', (a) => a.guardId === guardId))
        .concat(db.where('welfareChecks', (a) => a.guardId === guardId && a.status === 'Confirmed'))
        .concat(db.where('incidents', (a) => a.guardId === guardId))
        .concat(db.where('sosEvents', (a) => a.guardId === guardId))
        .filter((e) => e.gps && e.gps.ok)
        .sort((a, b) => (a.at < b.at ? 1 : -1));
      return events[0] || null;
    },
    shiftsOnDate(siteId, ymd) {
      return db.where('shifts', (s) => (!siteId || s.siteId === siteId) && s.date === ymd);
    },
  });

  /* =========================================================
   * OPERATIONS (guard actions)
   * ========================================================= */
  async function save(store, rec, auditAction, auditOpts) {
    await db.put(store, rec);
    await db.queue(store, rec.id);
    if (auditAction) await db.audit(auditAction, auditOpts || {});
    return rec;
  }
  function seq(store, prefix, year) {
    const re = new RegExp('^' + prefix + (year ? '-' + year : '') + '-(\\d+)$');
    let max = 0;
    db.all(store).forEach((r) => { const m = re.exec(r.id); if (m) max = Math.max(max, +m[1]); });
    return prefix + (year ? '-' + year : '') + '-' + String(max + 1).padStart(4, '0');
  }
  SW.seq = seq;

  SW.ops = {
    async startShift(shift) {
      const gps = await U.getGPS();
      const at = new Date().toISOString();
      const rec = { id: U.uid('ATT'), type: 'Clock in', shiftId: shift.id, guardId: shift.guardId, siteId: shift.siteId, at, gps, device: U.deviceInfo(), source: 'device' };
      const site = Q.site(shift.siteId);
      rec.distance = gps.ok && site && site.lat != null ? U.distance(gps, site) : null;
      await save('attendance', rec);
      shift.status = 'On duty';
      shift.actualStart = at;
      shift.clockInId = rec.id;
      await save('shifts', shift, 'Shift started', { siteId: shift.siteId, subject: gps.ok ? 'GPS ±' + gps.accuracy + ' m' : 'GPS not verified', related: shift.id });
      return { gps, rec };
    },

    async endShift(shift) {
      const gps = await U.getGPS();
      const at = new Date().toISOString();
      const rec = { id: U.uid('ATT'), type: 'Clock out', shiftId: shift.id, guardId: shift.guardId, siteId: shift.siteId, at, gps, device: U.deviceInfo(), source: 'device' };
      const site = Q.site(shift.siteId);
      rec.distance = gps.ok && site && site.lat != null ? U.distance(gps, site) : null;
      await save('attendance', rec);
      await SW.ops.evaluateWelfare(shift, new Date(at));
      shift.status = 'Completed';
      shift.actualEnd = at;
      shift.clockOutId = rec.id;
      await save('shifts', shift, 'Shift ended', { siteId: shift.siteId, subject: gps.ok ? 'GPS ±' + gps.accuracy + ' m' : 'GPS not verified', related: shift.id });
      return { gps, rec };
    },

    async startPatrol(shift, routeId) {
      const existing = Q.activePatrol(shift.id);
      if (existing) return existing;
      const p = {
        id: seq('patrols', 'PATROL'),
        shiftId: shift.id, routeId, siteId: shift.siteId, guardId: shift.guardId,
        startAt: new Date().toISOString(), endAt: null, status: 'Active', pauses: [],
        explanation: '', explanationAt: null, missed: [], source: 'device',
      };
      await save('patrols', p, 'Patrol started', { siteId: shift.siteId, subject: Q.routeName(routeId), related: p.id });
      return p;
    },

    async pausePatrol(p, reason) {
      if (p.status !== 'Active') return p;
      p.pauses = p.pauses || [];
      p.pauses.push({ start: new Date().toISOString(), end: null, reason: U.clean(reason, 300) });
      p.status = 'Paused';
      return save('patrols', p, 'Patrol paused', { siteId: p.siteId, subject: reason || '', related: p.id });
    },
    async resumePatrol(p) {
      if (p.status !== 'Paused') return p;
      const last = p.pauses[p.pauses.length - 1];
      if (last && !last.end) last.end = new Date().toISOString();
      p.status = 'Active';
      return save('patrols', p, 'Patrol resumed', { siteId: p.siteId, related: p.id });
    },

    /* Validate and record a checkpoint scan. Returns a result object for the UI. */
    async scan(shift, raw, method) {
      raw = U.clean(raw, 300);
      const at = new Date().toISOString();
      const cp = db.all('checkpoints').find((c) => c.qr === raw || (method === 'manual' && c.id.toUpperCase() === raw.toUpperCase()));
      const base = { id: U.uid('SCN'), guardId: shift.guardId, siteId: shift.siteId, at, raw, method, source: method === 'simulated' ? 'demo' : 'device' };

      if (!cp || cp.siteId !== shift.siteId) {
        const rec = Object.assign(base, { status: 'Invalid', checkpointId: cp ? cp.id : null, patrolId: (Q.activePatrol(shift.id) || {}).id || null, gps: null, locationStatus: '—' });
        await save('checkpointScans', rec, 'Invalid checkpoint scan', { siteId: shift.siteId, subject: cp ? 'Belongs to ' + Q.siteName(cp.siteId) : 'Unknown code', related: rec.id });
        return { ok: false, kind: 'invalid', message: cp ? 'This checkpoint belongs to another site.' : 'This QR code is not a checkpoint for this site.' };
      }

      let patrol = Q.activePatrol(shift.id);
      if (patrol && patrol.status === 'Paused') await SW.ops.resumePatrol(patrol);
      if (!patrol) patrol = await SW.ops.startPatrol(shift, cp.routeId);
      if (patrol.routeId !== cp.routeId) {
        return { ok: false, kind: 'wrong-route', message: cp.name + ' is on ' + Q.routeName(cp.routeId) + ', not the patrol in progress.', patrol };
      }
      if (Q.scansForPatrol(patrol.id).some((s) => s.checkpointId === cp.id)) {
        return { ok: false, kind: 'duplicate', message: cp.name + ' was already scanned on this patrol.', patrol, checkpoint: cp };
      }

      const gps = method === 'simulated' ? SW.demo.fakeGpsNear(cp) : await U.getGPS({ timeout: 10000 });
      let locationStatus = 'No GPS', distance = null;
      if (gps.ok) {
        if (cp.lat == null || cp.lng == null) locationStatus = 'Checkpoint location not set';
        else {
          distance = U.distance(gps, cp);
          const r = db.settings().gpsRadius + Math.min(gps.accuracy || 0, 100);
          locationStatus = distance <= r ? 'Verified' : 'Out of range';
        }
      }
      const rec = Object.assign(base, { status: 'Valid', checkpointId: cp.id, patrolId: patrol.id, routeId: cp.routeId, gps, distance, locationStatus });
      await save('checkpointScans', rec, 'Checkpoint scanned', { siteId: shift.siteId, subject: cp.name, related: patrol.id });

      const prog = Q.patrolProgress(patrol);
      const requiredLeft = prog.cps.filter((c) => c.required && !prog.scanned.has(c.id));
      const allDone = prog.done === prog.total;
      let completed = false;
      if (allDone) { await SW.ops.finishPatrol(patrol, ''); completed = true; }
      return { ok: true, kind: 'verified', checkpoint: cp, scan: rec, patrol, progress: prog, requiredLeft, completed };
    },

    async finishPatrol(p, explanation) {
      const prog = Q.patrolProgress(p);
      const missedReq = prog.cps.filter((c) => c.required && !prog.scanned.has(c.id));
      const last = (p.pauses || [])[p.pauses.length - 1];
      if (last && !last.end) last.end = new Date().toISOString();
      p.endAt = new Date().toISOString();
      p.total = prog.total;
      p.verified = prog.done;
      p.missed = prog.cps.filter((c) => !prog.scanned.has(c.id)).map((c) => ({ id: c.id, name: c.name, required: !!c.required }));
      p.status = missedReq.length ? 'Incomplete' : 'Complete';
      if (explanation) { p.explanation = U.clean(explanation, 1500); p.explanationAt = new Date().toISOString(); }
      await save('patrols', p, p.status === 'Complete' ? 'Patrol completed' : 'Patrol ended incomplete', { siteId: p.siteId, subject: prog.done + '/' + prog.total + ' checkpoints', related: p.id });
      return p;
    },

    async addExplanation(p, text) {
      p.explanation = U.clean(text, 1500);
      p.explanationAt = new Date().toISOString();
      return save('patrols', p, 'Missed checkpoint explanation added', { siteId: p.siteId, related: p.id });
    },

    async submitIncident(shift, form, mediaFiles, gps) {
      const at = new Date();
      const id = seq('incidents', 'INC', at.getFullYear());
      const media = [];
      for (const f of mediaFiles) media.push(await db.putMedia(f.blob, { kind: f.kind, name: f.name, incidentId: id }));
      const rec = {
        id, at: at.toISOString(), siteId: shift.siteId, guardId: shift.guardId, shiftId: shift.id,
        type: form.type, severity: form.severity, description: U.clean(form.description, 5000),
        locationNote: U.clean(form.locationNote, 200), gps, media, witness: U.clean(form.witness, 120),
        police: form.police, emergency: form.emergency, status: 'Open',
        statusHistory: [{ status: 'Open', at: at.toISOString(), by: SW.session ? SW.session.displayName : 'Guard' }],
        source: 'device',
      };
      await save('incidents', rec, 'Incident reported', { siteId: shift.siteId, subject: rec.type + ' (' + rec.severity + ')', related: id });
      return rec;
    },

    async setIncidentStatus(inc, status, note) {
      inc.status = status;
      inc.statusHistory = inc.statusHistory || [];
      inc.statusHistory.push({ status, at: new Date().toISOString(), by: SW.session.displayName, note: U.clean(note, 500) });
      await db.put('incidents', inc);
      await db.audit('Incident status changed', { siteId: inc.siteId, subject: status, related: inc.id });
    },

    /* Welfare: determine whether a check is due/overdue and record any missed checks. */
    async evaluateWelfare(shift, now) {
      if (!shift || !shift.actualStart) return { state: 'none' };
      now = now || new Date();
      const s = db.settings();
      const interval = (shift.welfareFreq || s.welfareInterval) * 60000;
      const grace = s.welfareGrace * 60000;
      const limit = shift.actualEnd ? new Date(shift.actualEnd) : now;
      const recs = db.where('welfareChecks', (w) => w.shiftId === shift.id).sort((a, b) => ((a.at || a.dueAt) < (b.at || b.dueAt) ? -1 : 1));
      const anchorOf = () => {
        let a = new Date(shift.actualStart).getTime();
        recs.forEach((w) => { const t = new Date(w.status === 'Confirmed' ? w.at : w.dueAt).getTime(); if (t > a) a = t; });
        return a;
      };
      let anchor = anchorOf();
      let due = anchor + interval;
      let guardLoop = 0;
      while (limit.getTime() > due + grace && guardLoop++ < 50) {
        const dueIso = new Date(due).toISOString();
        if (!recs.some((w) => w.dueAt === dueIso)) {
          const miss = { id: U.uid('WEL'), shiftId: shift.id, guardId: shift.guardId, siteId: shift.siteId, dueAt: dueIso, at: null, status: 'Missed', gps: null, source: 'device' };
          await db.put('welfareChecks', miss);
          recs.push(miss);
          await db.audit('Welfare check missed', { siteId: shift.siteId, user: 'System', role: 'system', subject: 'Due ' + U.fmtTime(dueIso), related: shift.id });
        }
        anchor = due;
        due = anchor + interval;
      }
      if (shift.actualEnd) return { state: 'ended' };
      const t = now.getTime();
      if (t >= due) return { state: 'due', dueAt: new Date(due), overdueAt: new Date(due + grace) };
      return { state: 'ok', nextAt: new Date(due) };
    },

    async confirmWelfare(shift) {
      const ev = await SW.ops.evaluateWelfare(shift);
      const gps = await U.getGPS({ timeout: 10000 });
      const rec = { id: U.uid('WEL'), shiftId: shift.id, guardId: shift.guardId, siteId: shift.siteId, dueAt: ev.dueAt ? ev.dueAt.toISOString() : null, at: new Date().toISOString(), status: 'Confirmed', gps, source: 'device' };
      await save('welfareChecks', rec, 'Welfare check confirmed', { siteId: shift.siteId, subject: gps.ok ? 'GPS ±' + gps.accuracy + ' m' : 'GPS not available', related: shift.id });
      return rec;
    },

    async activateSOS(shift) {
      const at = new Date().toISOString();
      const rec = { id: seq('sosEvents', 'SOS'), at, guardId: shift.guardId, siteId: shift.siteId, shiftId: shift.id, gps: { ok: false, error: 'Locating…' }, status: 'Active', source: 'device' };
      await save('sosEvents', rec, 'SOS activated', { siteId: shift.siteId, related: rec.id });
      // Save first, then try for a GPS fix so the alert is never lost while waiting for location.
      rec.gps = await U.getGPS({ timeout: 12000, maxAge: 0 });
      await db.put('sosEvents', rec);
      return rec;
    },
    async updateSOS(rec, status) {
      rec.status = status;
      if (status === 'Acknowledged') { rec.ackBy = SW.session.displayName; rec.ackAt = new Date().toISOString(); }
      if (status === 'Resolved') { rec.resolvedBy = SW.session.displayName; rec.resolvedAt = new Date().toISOString(); }
      await db.put('sosEvents', rec);
      await db.audit('SOS ' + status.toLowerCase(), { siteId: rec.siteId, related: rec.id });
    },

    async acknowledgeInstructions(shift) {
      const ins = Q.instructionsFor(shift.siteId);
      const rec = { id: U.uid('ACK'), siteId: shift.siteId, guardId: shift.guardId, version: ins ? ins.version : 0, at: new Date().toISOString(), source: 'device' };
      return save('instructionAcks', rec, 'Site instructions acknowledged', { siteId: shift.siteId, subject: 'Version ' + rec.version, related: shift.id });
    },
    ackFor(guardId, siteId) {
      const ins = Q.instructionsFor(siteId);
      const acks = db.where('instructionAcks', (a) => a.guardId === guardId && a.siteId === siteId).sort((a, b) => (a.at < b.at ? 1 : -1));
      const last = acks[0];
      return { last, current: !!(last && ins && last.version === ins.version) };
    },

    async processSync() {
      const items = db.pending();
      if (!items.length) return 0;
      const ids = await SW.syncAdapter.push(items);
      for (const q of items) if (ids.includes(q.id)) { q.synced = true; q.syncedAt = new Date().toISOString(); await db.put('syncQueue', q); }
      await db.audit('Offline records synced', { user: 'System', role: 'system', subject: ids.length + ' record(s) — ' + SW.syncAdapter.name });
      return ids.length;
    },
  };

  /* =========================================================
   * DEMO DATA — every record created here is tagged source:'demo'
   * ========================================================= */
  SW.demo = {
    SITE_GPS: { lat: 51.4816, lng: -3.1791 },
    fakeGpsNear(cp) {
      const j = () => (Math.random() - 0.5) * 0.00012;
      return { ok: true, lat: +((cp.lat || 51.4816) + j()).toFixed(6), lng: +((cp.lng || -3.1791) + j()).toFixed(6), accuracy: 6 + Math.round(Math.random() * 10), at: new Date().toISOString(), simulated: true };
    },

    async seed() {
      await db.clearAll();
      const now = new Date();
      const S = 'S-001', R = 'R-001', R2 = 'R-002';
      const base = SW.demo.SITE_GPS;
      const demo = { source: 'demo' };

      await db.put('settings', { id: 'app', welfareInterval: 60, welfareGrace: 10, patrolFrequency: 120, gpsRadius: 75, licenceWarnDays: 60, demoMode: true, companyName: 'SecureWatch Security Ltd' });

      const yr = now.getFullYear();
      const iso = (d) => U.ymd(d);
      await db.putMany('guards', [
        Object.assign({ id: 'G-001', name: 'John Smith', siaNumber: '1012345678901234', siaLicenceType: 'Security Guarding', siaExpiry: iso(U.addDays(now, 420)), siaCheckedAt: null, phone: '07700 900123', email: 'john.smith@example.com', status: 'Active' }, demo),
        Object.assign({ id: 'G-002', name: 'Priya Patel', siaNumber: '1012345678905678', siaLicenceType: 'Door Supervision', siaExpiry: iso(U.addDays(now, 34)), siaCheckedAt: null, phone: '07700 900456', email: 'priya.patel@example.com', status: 'Active' }, demo),
        Object.assign({ id: 'G-003', name: 'Mark Evans', siaNumber: '1012345678909012', siaLicenceType: 'Security Guarding', siaExpiry: iso(U.addDays(now, -12)), siaCheckedAt: null, phone: '07700 900789', email: 'mark.evans@example.com', status: 'Suspended' }, demo),
      ]);

      await db.put('sites', Object.assign({
        id: S, name: 'Cardiff Business Centre', address: 'Example Business Park, Cardiff CF10 (demo address)',
        client: 'Example Property Management Ltd', contactName: 'Facilities Manager (demo)', contactPhone: '029 2000 0000',
        emergencyContacts: 'Emergency services: 999\nPolice non-emergency: 101\nKeyholder (demo): 07700 900000\nOps control (demo): 07700 900111',
        lat: base.lat, lng: base.lng,
      }, demo));
      await db.put('siteInstructions', Object.assign({ id: 'INS-' + S, siteId: S, version: 1, updatedBy: 'Ops Manager (demo)', text:
        'Check all external doors during every patrol.\nReport suspicious persons immediately.\nFire exits must remain clear.\nNo unauthorised visitors after 22:00.\nCheck loading bay every patrol.\nReport maintenance issues with photographs.' }, demo));

      await db.putMany('patrolRoutes', [
        Object.assign({ id: R, siteId: S, name: 'Patrol 1 — Ground Floor', description: 'Full ground floor and external perimeter check.' }, demo),
        Object.assign({ id: R2, siteId: S, name: 'Patrol 2 — Upper Floors', description: 'Optional upper floor sweep (demo of a second route).' }, demo),
      ]);
      const cpDefs = [
        ['Main Entrance', 'Front doors and revolving door lock', 0, 0],
        ['Reception', 'Reception desk, visitor book and key cabinet', 0.00008, 0.0001],
        ['Fire Exit A', 'East stairwell fire door — must be closed and clear', 0.00025, 0.00032],
        ['Loading Bay', 'Roller shutters and goods-in door', 0.0004, -0.0001],
        ['Car Park', 'Barrier, CCTV column and perimeter fence', -0.0003, -0.0004],
        ['Rear Entrance', 'Staff entrance and bin store', 0.0002, -0.0005],
      ];
      const cps = cpDefs.map((d, i) => Object.assign({
        id: 'CP-00' + (i + 1), siteId: S, routeId: R, order: i + 1, name: d[0], description: d[1],
        lat: +(base.lat + d[2]).toFixed(6), lng: +(base.lng + d[3]).toFixed(6), qr: 'SECUREWATCH:' + S + ':CP-00' + (i + 1) + ':' + U.token(6), required: true,
      }, demo));
      cps.push(Object.assign({ id: 'CP-101', siteId: S, routeId: R2, order: 1, name: 'First Floor Lobby', description: 'Lift lobby and comms room door', lat: base.lat, lng: base.lng, qr: 'SECUREWATCH:' + S + ':CP-101:' + U.token(6), required: true }, demo));
      cps.push(Object.assign({ id: 'CP-102', siteId: S, routeId: R2, order: 2, name: 'Roof Access', description: 'Roof hatch locked', lat: base.lat, lng: base.lng, qr: 'SECUREWATCH:' + S + ':CP-102:' + U.token(6), required: false }, demo));
      await db.putMany('checkpoints', cps);
      const groundCps = cps.slice(0, 6);

      /* Current shift: starts ~30 min ago, 12 hours long, not yet started (so it can be demonstrated). */
      const curStart = new Date(now);
      curStart.setMinutes(Math.floor(curStart.getMinutes() / 15) * 15 - 30, 0, 0);
      const curEnd = new Date(curStart.getTime() + 12 * 3600000);
      const hm = (d) => U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
      const shifts = [];
      shifts.push(Object.assign({ id: 'SH-CURRENT', guardId: 'G-001', siteId: S, date: U.ymd(curStart), start: hm(curStart), end: hm(curEnd), startAt: curStart.toISOString(), endAt: curEnd.toISOString(), patrolFreq: 120, welfareFreq: 60, status: 'Scheduled' }, demo));

      /* Upcoming shifts */
      for (let k = 1; k <= 3; k++) {
        const st = U.combine(U.ymd(U.addDays(curStart, k)), '20:00');
        const en = new Date(st.getTime() + 12 * 3600000);
        shifts.push(Object.assign({ id: 'SH-NEXT-' + k, guardId: k === 2 ? 'G-002' : 'G-001', siteId: S, date: U.ymd(st), start: '20:00', end: '08:00', startAt: st.toISOString(), endAt: en.toISOString(), patrolFreq: 120, welfareFreq: 60, status: 'Scheduled' }, demo));
      }

      /* Three completed night shifts before the current one */
      let night = U.combine(U.ymd(U.addDays(curStart, -1)), '20:00');
      while (night.getTime() + 12 * 3600000 > curStart.getTime()) night = U.addDays(night, -1);
      const atts = [], patrols = [], scans = [], welfare = [], incidents = [], audits = [];
      let patrolNo = 0;
      const pid = () => 'PATROL-' + String(++patrolNo).padStart(4, '0');
      const gpsAt = (lat, lng) => ({ ok: true, lat: +(lat + (Math.random() - 0.5) * 0.0001).toFixed(6), lng: +(lng + (Math.random() - 0.5) * 0.0001).toFixed(6), accuracy: 5 + Math.round(Math.random() * 12) });
      const audit = (at, action, subject, related, user) => audits.push(Object.assign({ id: U.uid('AUD'), at: new Date(at).toISOString(), user: user || 'John Smith', role: 'guard', action, siteId: S, subject: subject || '', related: related || '' }, demo));

      for (let n = 2; n >= 0; n--) {
        const st = U.addDays(night, -n);
        const en = new Date(st.getTime() + 12 * 3600000);
        const shId = 'SH-PAST-' + (3 - n);
        const actualStart = new Date(st.getTime() - 4 * 60000);
        const actualEnd = new Date(en.getTime() + 3 * 60000);
        shifts.push(Object.assign({ id: shId, guardId: 'G-001', siteId: S, date: U.ymd(st), start: '20:00', end: '08:00', startAt: st.toISOString(), endAt: en.toISOString(), patrolFreq: 120, welfareFreq: 60, status: 'Completed', actualStart: actualStart.toISOString(), actualEnd: actualEnd.toISOString() }, demo));
        atts.push(Object.assign({ id: U.uid('ATT'), type: 'Clock in', shiftId: shId, guardId: 'G-001', siteId: S, at: actualStart.toISOString(), gps: gpsAt(base.lat, base.lng), distance: 9, device: { browser: 'Chrome', os: 'Android', standalone: true } }, demo));
        atts.push(Object.assign({ id: U.uid('ATT'), type: 'Clock out', shiftId: shId, guardId: 'G-001', siteId: S, at: actualEnd.toISOString(), gps: gpsAt(base.lat, base.lng), distance: 12, device: { browser: 'Chrome', os: 'Android', standalone: true } }, demo));
        audit(actualStart, 'Shift started', 'GPS ±9 m', shId);
        audit(actualEnd, 'Shift ended', 'GPS ±11 m', shId);

        for (let p = 0; p < 6; p++) {
          const pStart = new Date(st.getTime() + p * 2 * 3600000 + 2 * 60000);
          const id = pid();
          const incomplete = n === 1 && p === 3;
          let t = pStart.getTime();
          const done = incomplete ? groundCps.slice(0, 4) : groundCps;
          done.forEach((cp) => {
            t += (3 + Math.round(Math.random() * 3)) * 60000;
            scans.push(Object.assign({ id: U.uid('SCN'), patrolId: id, routeId: R, checkpointId: cp.id, siteId: S, guardId: 'G-001', at: new Date(t).toISOString(), gps: gpsAt(cp.lat, cp.lng), distance: 6, locationStatus: 'Verified', status: 'Valid', method: 'camera' }, demo));
          });
          const pEnd = new Date(t + 2 * 60000);
          patrols.push(Object.assign({
            id, shiftId: shId, routeId: R, siteId: S, guardId: 'G-001', startAt: pStart.toISOString(), endAt: pEnd.toISOString(),
            status: incomplete ? 'Incomplete' : 'Complete', pauses: [], total: 6, verified: done.length,
            missed: incomplete ? groundCps.slice(4).map((c) => ({ id: c.id, name: c.name, required: true })) : [],
            explanation: incomplete ? 'Car park barrier jammed and gate to rear entrance locked by client contractor. Reported to keyholder.' : '',
            explanationAt: incomplete ? pEnd.toISOString() : null,
          }, demo));
          audit(pStart, 'Patrol started', 'Patrol 1 — Ground Floor', id);
          audit(pEnd, incomplete ? 'Patrol ended incomplete' : 'Patrol completed', done.length + '/6 checkpoints', id);
        }
        for (let w = 1; w <= 12; w++) {
          const due = new Date(actualStart.getTime() + w * 3600000);
          if (due > actualEnd) break;
          const missed = n === 0 && w === 7;
          welfare.push(Object.assign({ id: U.uid('WEL'), shiftId: shId, guardId: 'G-001', siteId: S, dueAt: due.toISOString(), at: missed ? null : new Date(due.getTime() + (1 + Math.round(Math.random() * 4)) * 60000).toISOString(), status: missed ? 'Missed' : 'Confirmed', gps: missed ? null : gpsAt(base.lat, base.lng) }, demo));
        }
      }
      const latest = U.addDays(night, 0);
      const i1 = new Date(latest.getTime() + (2 * 60 + 14) * 60000);
      const i2 = new Date(latest.getTime() + (6 * 60 + 35) * 60000);
      const i3 = new Date(U.addDays(latest, -1).getTime() + (4 * 60 + 5) * 60000);
      incidents.push(Object.assign({ id: 'INC-' + yr + '-0001', at: i3.toISOString(), siteId: S, guardId: 'G-001', shiftId: 'SH-PAST-2', type: 'Alarm', severity: 'High', description: 'Intruder alarm activated in Zone 3 (loading bay). Area checked with torch, no sign of forced entry. Alarm reset with ARC. Keyholder informed.', locationNote: 'Loading Bay', gps: gpsAt(base.lat + 0.0004, base.lng - 0.0001), media: [], witness: '', police: 'No', emergency: 'No', status: 'Resolved', statusHistory: [{ status: 'Open', at: i3.toISOString(), by: 'John Smith' }, { status: 'Resolved', at: new Date(i3.getTime() + 9 * 3600000).toISOString(), by: 'Ops Manager (demo)', note: 'False alarm — sensor fault logged with maintenance.' }] }, demo));
      incidents.push(Object.assign({ id: 'INC-' + yr + '-0002', at: i1.toISOString(), siteId: S, guardId: 'G-001', shiftId: 'SH-PAST-3', type: 'Unauthorised Access', severity: 'Medium', description: 'Male found in reception claiming to be a contractor, not on the visitor list. Asked to leave and escorted off site without incident. Description recorded.', locationNote: 'Reception', gps: gpsAt(base.lat + 0.00008, base.lng + 0.0001), media: [], witness: 'Cleaner on site (name withheld)', police: 'No', emergency: 'No', status: 'Under Review', statusHistory: [{ status: 'Open', at: i1.toISOString(), by: 'John Smith' }, { status: 'Under Review', at: new Date(i1.getTime() + 3600000).toISOString(), by: 'Ops Manager (demo)' }] }, demo));
      incidents.push(Object.assign({ id: 'INC-' + yr + '-0003', at: i2.toISOString(), siteId: S, guardId: 'G-001', shiftId: 'SH-PAST-3', type: 'Maintenance Issue', severity: 'Low', description: 'Emergency light above Fire Exit A not working. Exit itself clear and door closes correctly.', locationNote: 'Fire Exit A', gps: gpsAt(base.lat + 0.00025, base.lng + 0.00032), media: [], witness: '', police: 'No', emergency: 'No', status: 'Open', statusHistory: [{ status: 'Open', at: i2.toISOString(), by: 'John Smith' }] }, demo));
      incidents.forEach((i) => audit(i.at, 'Incident reported', i.type + ' (' + i.severity + ')', i.id));
      audits.push(Object.assign({ id: U.uid('AUD'), at: new Date().toISOString(), user: 'System', role: 'system', action: 'Demo data loaded', siteId: S, subject: '', related: '' }, demo));

      await db.putMany('shifts', shifts);
      await db.putMany('attendance', atts);
      await db.putMany('patrols', patrols);
      await db.putMany('checkpointScans', scans);
      await db.putMany('welfareChecks', welfare);
      await db.putMany('incidents', incidents);
      await db.putMany('instructionAcks', [Object.assign({ id: U.uid('ACK'), siteId: S, guardId: 'G-001', version: 0, at: U.addDays(now, -5).toISOString() }, demo)]);
      await db.putMany('auditLogs', audits);
      await SW.auth.ensureDemoUsers();
    },
  };
})();
