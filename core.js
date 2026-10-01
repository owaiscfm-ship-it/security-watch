/* SecureWatch — domain logic (auth, operations, demo data) */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = SW.util;
  const db = SW.db;

  /* =========================================================
   * AUTH
   * With the server (Supabase): real accounts, checked by the server.
   * Without it: logins listed in config.js as salted PBKDF2 hashes (prototype only).
   * ========================================================= */
  const SESSION_KEY = 'sw_session';
  SW.session = null;
  const users = () => ((window.SW_CONFIG && window.SW_CONFIG.users) || []);
  const fails = { n: 0, until: 0 };
  const remote = () => SW.remote && SW.remote.enabled;

  SW.auth = {
    users,
    async login(username, password) {
      if (Date.now() < fails.until) return { ok: false, error: 'Too many attempts. Wait ' + Math.ceil((fails.until - Date.now()) / 1000) + ' seconds and try again.' };
      username = U.clean(username, 80).toLowerCase();
      if (remote()) {
        let p;
        try { p = await SW.remote.login(username, password || ''); }
        catch (e) { fails.n++; if (fails.n >= 5) { fails.until = Date.now() + 60000; fails.n = 0; } return { ok: false, error: e.message }; }
        fails.n = 0;
        SW.session = { userId: p.user_id, username: p.username, role: p.role, displayName: p.display_name || p.username, guardId: p.guard_id || null, siteIds: p.site_ids || [], at: Date.now(), remote: true };
        localStorage.setItem(SESSION_KEY, JSON.stringify(SW.session));
        try { await SW.remote.pull(); } catch (e) { console.warn('First sync failed', e); }
        if (p.role === 'guard') {
          const g = db.get('guards', p.guard_id);
          if (g && g.status !== 'Active') { await SW.auth.logout(); return { ok: false, error: 'This guard is marked ' + g.status + '. Contact your manager.' }; }
          if (g) SW.session.displayName = g.name;
        }
        localStorage.setItem(SESSION_KEY, JSON.stringify(SW.session));
        await db.audit('Signed in', { subject: p.role });
        return { ok: true, session: SW.session };
      }
      const u = users().find((x) => x.username === username);
      let good = false;
      try {
        const h = await U.pbkdf2(password || '', u ? u.salt : 'no-such-user', u ? u.iterations : 150000);
        good = !!u && h === u.hash;
      } catch (e) { return { ok: false, error: e.message }; }
      if (!good) {
        fails.n++;
        if (fails.n >= 5) { fails.until = Date.now() + 60000; fails.n = 0; }
        return { ok: false, error: 'Username or password is incorrect.' };
      }
      fails.n = 0;
      if (u.role === 'guard') {
        const g = db.get('guards', u.guardId);
        if (!g) return { ok: false, error: 'This login is not linked to a guard record.' };
        if (g.status !== 'Active') return { ok: false, error: 'This guard is marked ' + g.status + '. Contact your manager.' };
      }
      SW.session = { userId: u.username, username: u.username, role: u.role, displayName: u.role === 'guard' ? (db.get('guards', u.guardId) || {}).name || u.displayName : u.displayName, guardId: u.guardId || null, siteIds: u.siteIds || [], at: Date.now(), hash: u.hash.slice(0, 12) };
      localStorage.setItem(SESSION_KEY, JSON.stringify(SW.session));
      await db.audit('Signed in', { subject: u.role });
      return { ok: true, session: SW.session };
    },
    restore() {
      try {
        const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        if (remote()) {
          // stays signed in (also offline) until signing out or the server rejects the login
          if (s && s.remote && SW.remote.hasTokens()) { SW.session = s; return s; }
        } else {
          const u = s && users().find((x) => x.username === s.username);
          if (s && u && u.hash.slice(0, 12) === s.hash && Date.now() - s.at < 14 * 3600 * 1000) { SW.session = s; return s; }
        }
      } catch (_) { /* ignore */ }
      localStorage.removeItem(SESSION_KEY);
      return null;
    },
    async logout() {
      if (SW.session) await db.audit('Signed out', { subject: SW.session.role });
      if (remote() && SW.session) { try { await SW.remote.sync(); } catch (_) { /* best effort */ } await SW.remote.logout(); }
      SW.session = null;
      localStorage.removeItem(SESSION_KEY);
    },
  };

  /* IDs shown to people (INC-2026-0001, PATROL-0001, SOS-0001). With the server these come
   * from a shared counter so two phones never create the same number. */
  SW.newId = async function (store, prefix, year) {
    const pre = prefix + (year ? '-' + year : '');
    if (remote() && SW.session && SW.session.remote) return SW.remote.nextId(pre);
    return seq(store, prefix, year);
  };

  /* =========================================================
   * SETUP from config.js (only used without the server)
   * ========================================================= */
  const CONFIG_STORES = ['sites', 'guards', 'patrolRoutes', 'checkpoints', 'siteInstructions', 'shifts'];
  const KEEP_SHIFT = ['status', 'actualStart', 'actualEnd', 'clockInId', 'clockOutId'];
  SW.setup = {
    async apply(force) {
      const C = window.SW_CONFIG;
      if (!C || remote() || !C.shifts) return false;
      const cur = db.settings();
      if (!force && cur.configVersion === C.version) return false;
      for (const store of CONFIG_STORES) {
        const incoming = C[store] || [];
        const ids = new Set(incoming.map((r) => r.id));
        for (const r of incoming) {
          const old = db.get(store, r.id);
          const rec = Object.assign({}, old || {}, r, { source: 'config' });
          if (store === 'shifts') {
            if (old) KEEP_SHIFT.forEach((k) => { if (old[k] !== undefined) rec[k] = old[k]; });
            if (!rec.status) rec.status = 'Scheduled';
          }
          if (store === 'guards' && old && old.siaCheckedAt) rec.siaCheckedAt = old.siaCheckedAt;
          await db.put(store, rec);
        }
        for (const old of db.all(store).slice()) {
          if (old.source === 'config' && !ids.has(old.id) && !(store === 'shifts' && old.status !== 'Scheduled')) await db.remove(store, old.id);
        }
      }
      await db.saveSettings(Object.assign({}, C.settings || {}, { configVersion: C.version, demoMode: false }));
      await db.audit('Setup loaded', { user: 'System', role: 'system', subject: 'config ' + C.version });
      return true;
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
        id: await SW.newId('patrols', 'PATROL'),
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
      const id = await SW.newId('incidents', 'INC', U.parts(at).year);
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
          const miss = { id: 'WEL-MISS-' + shift.id + '-' + dueIso.replace(/\D/g, '').slice(0, 12), shiftId: shift.id, guardId: shift.guardId, siteId: shift.siteId, dueAt: dueIso, at: null, status: 'Missed', gps: null, source: 'device' };
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
      const rec = { id: await SW.newId('sosEvents', 'SOS'), at, guardId: shift.guardId, siteId: shift.siteId, shiftId: shift.id, gps: { ok: false, error: 'Locating…' }, status: 'Active', source: 'device' };
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
      const items = db.pending().map((q) => Object.assign({}, q));
      if (!items.length) return 0;
      const ids = await SW.syncAdapter.push(items);
      for (const q of items) {
        if (!ids.includes(q.id)) continue;
        const cur = db.get('syncQueue', q.id);
        if (cur && cur.v === q.v) await db.remove('syncQueue', q.id); // unchanged since upload: done
        else if (cur && !cur.v) await db.remove('syncQueue', q.id);
      }
      if (!SW.syncAdapter.remote) await db.audit('Offline records synced', { user: 'System', role: 'system', subject: ids.length + ' record(s) — ' + SW.syncAdapter.name });
      return ids.length;
    },
  };

  /* Simulated position for training scans (only when training mode is switched on) */
  SW.demo = {
    fakeGpsNear(cp) {
      const j = () => (Math.random() - 0.5) * 0.00012;
      return { ok: true, lat: +((cp.lat || 51.5) + j()).toFixed(6), lng: +((cp.lng || -3.1) + j()).toFixed(6), accuracy: 6 + Math.round(Math.random() * 10), at: new Date().toISOString(), simulated: true };
    },
  };
})();
