/* SecureWatch — period reports: daily, weekly, monthly or custom range */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = SW.util, db = SW.db, Q = SW.q;
  const esc = U.esc;

  const TYPES = [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['custom', 'Custom']];
  const dow = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); };
  const monthEnd = (ymd) => { const [y, m] = ymd.split('-').map(Number); const d = new Date(Date.UTC(y, m, 0, 12)); return d.toISOString().slice(0, 10); };
  const label = (ymd, o) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, o));

  /* Work out the from/to dates for a period */
  function range(type, anchor, from, to) {
    anchor = anchor || U.today();
    if (type === 'day') return { from: anchor, to: anchor, title: 'Daily security report', name: label(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
    if (type === 'week') { const f = U.ymdAdd(anchor, -((dow(anchor) + 6) % 7)); const t = U.ymdAdd(f, 6); return { from: f, to: t, title: 'Weekly security report', name: label(f, { day: 'numeric', month: 'short' }) + ' – ' + label(t, { day: 'numeric', month: 'short', year: 'numeric' }) }; }
    if (type === 'month') { const f = anchor.slice(0, 8) + '01'; return { from: f, to: monthEnd(f), title: 'Monthly security report', name: label(f, { month: 'long', year: 'numeric' }) }; }
    from = from || U.ymdAdd(anchor, -6); to = to || anchor;
    if (to < from) { const x = from; from = to; to = x; }
    return { from, to, title: 'Security report', name: label(from, { day: 'numeric', month: 'short', year: 'numeric' }) + ' – ' + label(to, { day: 'numeric', month: 'short', year: 'numeric' }) };
  }
  function step(type, anchor, n) {
    if (type === 'day') return U.ymdAdd(anchor, n);
    if (type === 'week') return U.ymdAdd(anchor, 7 * n);
    if (type === 'month') { const [y, m] = anchor.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1, 12)); return d.toISOString().slice(0, 10); }
    return anchor;
  }

  /* Gather all numbers for a period */
  function compute(siteId, from, to, guardId) {
    const now = Date.now();
    const shifts = db.where('shifts', (s) => (!siteId || s.siteId === siteId) && (!guardId || s.guardId === guardId) && s.date >= from && s.date <= to).sort((a, b) => (a.startAt > b.startAt ? 1 : -1));
    const ids = new Set(shifts.map((s) => s.id));
    const patrols = db.where('patrols', (p) => ids.has(p.shiftId));
    const pids = new Set(patrols.map((p) => p.id));
    const scans = db.where('checkpointScans', (s) => pids.has(s.patrolId) && s.status === 'Valid');
    const incidents = db.where('incidents', (i) => ids.has(i.shiftId)).sort((a, b) => (a.at > b.at ? 1 : -1));
    const welfare = db.where('welfareChecks', (w) => ids.has(w.shiftId));
    const sos = db.where('sosEvents', (e) => ids.has(e.shiftId));
    const issues = [];
    let hours = 0, schedPatrols = 0;
    const perGuard = {}, perDay = {};
    const g = (id) => (perGuard[id] = perGuard[id] || { id, shifts: 0, worked: 0, hours: 0, late: 0, missedShifts: 0, patrols: 0, sched: 0, incidents: 0, welMiss: 0, welOk: 0 });
    for (let d = from; d <= to; d = U.ymdAdd(d, 1)) perDay[d] = { date: d, shifts: 0, worked: 0, patrols: 0, sched: 0, incidents: 0, welMiss: 0 };
    shifts.forEach((s) => {
      const sp = Q.scheduledPatrols(s); schedPatrols += sp;
      const G = g(s.guardId); G.shifts++; G.sched += sp;
      const D = perDay[s.date]; if (D) { D.shifts++; D.sched += sp; }
      if (s.actualStart) {
        const h = Math.max(0, ((s.actualEnd ? new Date(s.actualEnd).getTime() : now) - new Date(s.actualStart).getTime()) / 3600000);
        hours += h; G.hours += h; G.worked++; if (D) D.worked++;
        const late = Math.round((new Date(s.actualStart) - new Date(s.startAt)) / 60000);
        if (late > 10) { G.late++; issues.push({ s, text: 'Late start (' + late + ' min)' }); }
        if (s.actualEnd) { const early = Math.round((new Date(s.endAt) - new Date(s.actualEnd)) / 60000); if (early > 10) issues.push({ s, text: 'Left early (' + early + ' min)' }); }
      } else if (new Date(s.startAt).getTime() < now) { G.missedShifts++; issues.push({ s, text: 'No clock-in recorded' }); }
    });
    patrols.forEach((p) => { if (p.status === 'Complete') { g(p.guardId).patrols++; const sh = db.get('shifts', p.shiftId); if (sh && perDay[sh.date]) perDay[sh.date].patrols++; } });
    incidents.forEach((i) => { g(i.guardId).incidents++; const sh = db.get('shifts', i.shiftId); if (sh && perDay[sh.date]) perDay[sh.date].incidents++; });
    welfare.forEach((w) => { const G = g(w.guardId); if (w.status === 'Missed') { G.welMiss++; const sh = db.get('shifts', w.shiftId); if (sh && perDay[sh.date]) perDay[sh.date].welMiss++; } else G.welOk++; });
    const done = patrols.filter((p) => p.status === 'Complete').length;
    return {
      shifts, patrols, scans, incidents, welfare, sos, issues, hours, schedPatrols, done,
      incomplete: patrols.filter((p) => p.status === 'Incomplete'),
      missedCp: patrols.reduce((n, p) => n + (p.missed || []).filter((m) => m.required).length, 0),
      welOk: welfare.filter((w) => w.status === 'Confirmed').length, welMiss: welfare.filter((w) => w.status === 'Missed').length,
      sev: (x) => incidents.filter((i) => i.severity === x).length,
      perGuard: Object.values(perGuard).sort((a, b) => (Q.guardName(a.id) > Q.guardName(b.id) ? 1 : -1)),
      perDay: Object.values(perDay),
    };
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');

  function barChart(days) {
    if (days.length < 2) return '';
    const W = 640, H = 150, pad = 24, bw = Math.max(3, Math.min(28, (W - pad * 2) / days.length - 4));
    const x = (i) => pad + i * ((W - pad * 2) / days.length) + 2;
    let bars = '';
    days.forEach((d, i) => {
      const v = d.sched ? Math.min(1, d.patrols / d.sched) : 0;
      const h = Math.round(v * (H - 40));
      const col = !d.sched ? '#D8E0EC' : v >= 0.95 ? '#188A52' : v >= 0.7 ? '#E0A100' : '#C8293A';
      bars += '<rect x="' + x(i) + '" y="' + (H - 22 - h) + '" width="' + bw + '" height="' + Math.max(h, d.sched ? 2 : 1) + '" rx="2" fill="' + col + '"><title>' + d.date + ': ' + d.patrols + '/' + d.sched + ' patrols</title></rect>';
      if (days.length <= 14 || i % Math.ceil(days.length / 10) === 0) bars += '<text x="' + (x(i) + bw / 2) + '" y="' + (H - 8) + '" font-size="10" text-anchor="middle" fill="#4A5878">' + label(d.date, days.length <= 8 ? { weekday: 'short' } : { day: 'numeric' }) + '</text>';
    });
    return '<div class="rp-chart"><p class="rp-chart-t">Patrol completion by day</p><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Patrol completion by day">' +
      '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + (H - 22) + '" y2="' + (H - 22) + '" stroke="#D8E0EC"/>' + bars + '</svg>' +
      '<p class="rp-legend"><i style="background:#188A52"></i>95%+ <i style="background:#E0A100"></i>70–94% <i style="background:#C8293A"></i>under 70% <i style="background:#D8E0EC"></i>no shift</p></div>';
  }

  const SECTIONS = [
    ['kpis', 'Summary numbers'], ['chart', 'Patrol chart'], ['guards', 'Guard summary table'], ['days', 'Day-by-day table'],
    ['incidents', 'Incidents'], ['attendance', 'Attendance issues (late / no clock-in)'], ['incomplete', 'Incomplete patrols'],
    ['welfare', 'Missed welfare checks'], ['sos', 'SOS alerts'],
  ];
  function sections(forClient) {
    const s = Object.assign({ kpis: true, chart: true, guards: true, days: true, incidents: true, attendance: true, incomplete: true, welfare: true, sos: true }, db.settings().reportSections || {});
    const isClient = forClient || (SW.session && SW.session.role === 'client');
    if (isClient && SW.manager && SW.manager.clientView) {
      const cv = SW.manager.clientView();
      if (!cv.incidents) s.incidents = false;
      if (!cv.welfare) s.welfare = false;
      if (!cv.missed) s.incomplete = false;
      if (!cv.sos) s.sos = false;
      if (!cv.attendance) s.attendance = false;
      if (!cv.guardNames) s.guards = false;
    }
    return s;
  }
  SW.reports = SW.reports || {};
  SW.reports.SECTIONS = SECTIONS;
  SW.reports.range = range;
  SW.reports.compute = compute;

  /* Full printable report HTML */
  SW.reports.period = function (siteId, r, guardId, forClient) {
    const S = sections(forClient);
    const site = Q.site(siteId);
    if (!site) return '<div class="empty"><p>Choose a site.</p></div>';
    const R = compute(siteId, r.from, r.to, guardId);
    const s = db.settings();
    const row = (l, v) => '<tr><th>' + l + '</th><td>' + v + '</td></tr>';
    const tbl = (heads, rows, empty) => rows.length ? '<table class="rp-tbl"><thead><tr>' + heads.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map((x) => '<tr>' + x.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>' : '<p>' + (empty || 'None.') + '</p>';
    const dt = (iso) => label(U.ymd(iso), { day: '2-digit', month: 'short' }) + ' ' + U.fmtTime(iso);
    const multiDay = r.from !== r.to;
    return '<article class="report">' +
      '<header class="rp-head"><div><p class="rp-brand">SECUREWATCH</p><h1>' + esc(r.title) + '</h1></div><div class="rp-co">' + esc(s.companyName) + '<br>Generated ' + U.fmtDateTime(new Date()) + '</div></header>' +
      '<table class="rp-kv">' + row('Site', esc(site.name)) + row('Client', esc(site.client || '—')) + row('Period', esc(r.name) + (multiDay ? ' <span class="muted">(' + label(r.from, { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' to ' + label(r.to, { day: '2-digit', month: '2-digit', year: 'numeric' }) + ')</span>' : '')) + (guardId ? row('Guard', esc(Q.guardName(guardId))) : '') + '</table>' +
      (S.kpis ? '<div class="rp-kpis">' +
      '<div><span>Shifts worked</span><b>' + R.shifts.filter((x) => x.actualStart).length + ' / ' + R.shifts.length + '</b></div>' +
      '<div><span>Hours on site</span><b>' + R.hours.toFixed(1) + '</b></div>' +
      '<div><span>Patrols completed</span><b>' + R.done + ' / ' + R.schedPatrols + '</b><em>' + pct(R.done, R.schedPatrols) + '</em></div>' +
      '<div><span>Checkpoints verified</span><b>' + R.scans.length + '</b><em>' + (R.missedCp ? R.missedCp + ' missed' : 'none missed') + '</em></div>' +
      '<div><span>Incidents</span><b>' + R.incidents.length + '</b><em>' + R.sev('Critical') + ' critical · ' + R.sev('High') + ' high</em></div>' +
      (S.welfare ? '<div><span>Welfare checks</span><b>' + R.welOk + ' / ' + (R.welOk + R.welMiss) + '</b><em>' + (R.welMiss ? R.welMiss + ' missed' : 'none missed') + '</em></div>' : '') +
      '</div>' : '') +
      (multiDay && S.chart ? barChart(R.perDay) : '') +
      (!S.guards ? '' : '<h2>Guards</h2>' + tbl(['Guard', 'Shifts', 'Hours', 'Late starts', 'No clock-in', 'Patrols', 'Incidents', 'Welfare missed'], R.perGuard.map((G) => [esc(Q.guardName(G.id)), G.worked + '/' + G.shifts, G.hours.toFixed(1), G.late, G.missedShifts, G.patrols + '/' + G.sched + ' (' + pct(G.patrols, G.sched) + ')', G.incidents, G.welMiss]), 'No shifts in this period.')) +
      (multiDay && S.days ? '<h2>Day by day</h2>' + tbl(['Date', 'Shifts', 'Patrols', 'Completion', 'Incidents', 'Welfare missed'], R.perDay.filter((d) => d.shifts).map((d) => [label(d.date, { weekday: 'short', day: '2-digit', month: 'short' }), d.worked + '/' + d.shifts, d.patrols + '/' + d.sched, pct(d.patrols, d.sched), d.incidents, d.welMiss])) : '') +
      (!S.incidents ? '' : '<h2>Incidents</h2>' + tbl(['Incident', 'When', 'Type', 'Severity', 'Status', 'Guard', 'Summary'], R.incidents.map((i) => [esc(i.id), dt(i.at), esc(i.type), esc(i.severity), esc(i.status), esc(Q.guardName(i.guardId)), esc(String(i.description || '').slice(0, 160)) + (String(i.description || '').length > 160 ? '…' : '')]), 'No incidents reported.')) +
      (!S.attendance ? '' : '<h2>Attendance issues</h2>' + tbl(['Date', 'Guard', 'Rota', 'Issue'], R.issues.map((x) => [label(x.s.date, { weekday: 'short', day: '2-digit', month: 'short' }), esc(Q.guardName(x.s.guardId)), esc(x.s.start + '–' + x.s.end), esc(x.text)]), 'No attendance issues.')) +
      (!S.incomplete ? '' : '<h2>Incomplete patrols</h2>' + tbl(['Patrol', 'When', 'Guard', 'Missed', 'Explanation'], R.incomplete.map((p) => [esc(p.id), dt(p.startAt), esc(Q.guardName(p.guardId)), esc((p.missed || []).map((m) => m.name).join(', ')), esc(p.explanation || '—')]), 'None.')) +
      (!S.welfare ? '' : '<h2>Missed welfare checks</h2>' + tbl(['Due', 'Guard'], R.welfare.filter((w) => w.status === 'Missed').map((w) => [dt(w.dueAt), esc(Q.guardName(w.guardId))]), 'None.')) +
      (S.sos && R.sos.length ? '<h2>SOS alerts</h2>' + tbl(['When', 'Guard', 'Status'], R.sos.map((e) => [dt(e.at), esc(Q.guardName(e.guardId)), esc(e.status)])) : '') +
      '<footer class="rp-foot">Generated by SecureWatch (by Syed Owais). Times are UK time. GPS positions come from the guard\u2019s phone and depend on its accuracy.</footer>' +
      '</article>';
  };

  /* CSV for the period: one row per shift */
  SW.reports.periodCsv = function (siteId, r, guardId) {
    const R = compute(siteId, r.from, r.to, guardId);
    if (!R.shifts.length) { U.toast('No shifts in this period.', 'info'); return; }
    const rows = R.shifts.map((s) => {
      const h = s.actualStart ? Math.max(0, ((s.actualEnd ? new Date(s.actualEnd) : new Date()) - new Date(s.actualStart)) / 3600000) : 0;
      const sp = R.patrols.filter((p) => p.shiftId === s.id);
      return { s, h, done: sp.filter((p) => p.status === 'Complete').length, inc: R.incidents.filter((i) => i.shiftId === s.id).length, wm: R.welfare.filter((w) => w.shiftId === s.id && w.status === 'Missed').length };
    });
    const csv = U.csv(rows, [
      { label: 'Date', value: (x) => x.s.date }, { label: 'Guard', value: (x) => Q.guardName(x.s.guardId) }, { label: 'Site', value: (x) => Q.siteName(x.s.siteId) },
      { label: 'Rota start', value: (x) => x.s.start }, { label: 'Rota end', value: (x) => x.s.end },
      { label: 'Clock in', value: (x) => (x.s.actualStart ? U.fmtTime(x.s.actualStart) : '') }, { label: 'Clock out', value: (x) => (x.s.actualEnd ? U.fmtTime(x.s.actualEnd) : '') },
      { label: 'Hours', value: (x) => (x.h ? x.h.toFixed(2) : '') }, { label: 'Patrols completed', value: (x) => x.done }, { label: 'Patrols scheduled', value: (x) => Q.scheduledPatrols(x.s) },
      { label: 'Incidents', value: (x) => x.inc }, { label: 'Welfare missed', value: (x) => x.wm }, { label: 'Status', value: (x) => x.s.status },
    ]);
    U.download('securewatch-' + r.from + '-to-' + r.to + '.csv', csv);
    db.audit('Report CSV exported', { siteId, subject: r.from + ' to ' + r.to });
  };

  /* Reusable report panel (manager Reports page and client portal) */
  SW.reports.panel = function (host, opts) {
    opts = opts || {};
    const st = (SW.reports._state = SW.reports._state || { type: 'week', anchor: U.today(), from: '', to: '', site: '', guard: '' });
    const sites = db.all('sites').filter((s) => !opts.siteIds || !opts.siteIds.length || opts.siteIds.includes(s.id));
    if (!sites.some((s) => s.id === st.site)) st.site = (sites[0] || {}).id || '';
    const r = range(st.type, st.anchor, st.from, st.to);
    const o = (v, l, sel) => '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(l) + '</option>';
    host.innerHTML =
      '<div class="rp-bar">' +
      '<div class="seg seg-sm" role="tablist">' + TYPES.map((t) => '<label><input type="radio" name="rp-type" value="' + t[0] + '"' + (t[0] === st.type ? ' checked' : '') + '><span>' + t[1] + '</span></label>').join('') + '</div>' +
      (st.type === 'custom'
        ? '<label class="fld fld-inline"><span>From</span><input type="date" id="rp-from" value="' + esc(r.from) + '"></label><label class="fld fld-inline"><span>To</span><input type="date" id="rp-to" value="' + esc(r.to) + '"></label>'
        : '<div class="rp-nav"><button class="icon-btn" id="rp-prev" aria-label="Previous">‹</button><label class="fld fld-inline"><span>' + (st.type === 'day' ? 'Shift date' : st.type === 'week' ? 'Any day in the week' : 'Any day in the month') + '</span><input type="date" id="rp-anchor" value="' + esc(st.anchor) + '"></label><button class="icon-btn" id="rp-next" aria-label="Next">›</button></div>') +
      (sites.length > 1 ? '<label class="fld fld-inline"><span>Site</span><select id="rp-site">' + sites.map((s) => o(s.id, s.name, st.site)).join('') + '</select></label>' : '') +
      (opts.guards ? '<label class="fld fld-inline"><span>Guard</span><select id="rp-guard">' + o('', 'All guards', st.guard) + db.all('guards').map((g) => o(g.id, g.name, st.guard)).join('') + '</select></label>' : '') +
      '<span class="grow"></span>' + (SW.session && SW.session.role === 'manager' && !opts.client ? '<button class="btn btn-ghost" id="rp-cust">⚙ Customise</button>' : '') + '<button class="btn btn-secondary" id="rp-csv">Download CSV</button><button class="btn btn-secondary" id="rp-print">Print</button><button class="btn btn-primary" id="rp-pdf">Download PDF</button></div>' +
      '<p class="muted rp-hint">' + esc(r.name) + ' — shifts that start in this period. "Download PDF" opens the print window: choose <b>Save as PDF</b>.</p>' +
      '<div class="report-preview">' + SW.reports.period(st.site, r, opts.guards ? st.guard : '', opts.client) + '</div>';
    const rerender = () => SW.reports.panel(host, opts);
    host.querySelectorAll('[name=rp-type]').forEach((x) => (x.onchange = () => { st.type = x.value; rerender(); }));
    const a = host.querySelector('#rp-anchor'); if (a) a.onchange = () => { st.anchor = a.value || U.today(); rerender(); };
    const pv = host.querySelector('#rp-prev'); if (pv) pv.onclick = () => { st.anchor = step(st.type, st.anchor, -1); rerender(); };
    const nx = host.querySelector('#rp-next'); if (nx) nx.onclick = () => { st.anchor = step(st.type, st.anchor, 1); rerender(); };
    const fr = host.querySelector('#rp-from'); if (fr) fr.onchange = () => { st.from = fr.value; rerender(); };
    const to = host.querySelector('#rp-to'); if (to) to.onchange = () => { st.to = to.value; rerender(); };
    const si = host.querySelector('#rp-site'); if (si) si.onchange = () => { st.site = si.value; rerender(); };
    const gu = host.querySelector('#rp-guard'); if (gu) gu.onchange = () => { st.guard = gu.value; rerender(); };
    const cur = () => range(st.type, st.anchor, st.from, st.to);
    const print = () => SW.app.print(SW.reports.period(st.site, cur(), opts.guards ? st.guard : '', opts.client), cur().title);
    const cu = host.querySelector('#rp-cust');
    if (cu) cu.onclick = async () => {
      const S = sections(false);
      const res = await U.modal({
        title: 'Customise reports',
        body: '<p>Choose what appears in reports (on screen, PDF and the emailed report). Client reports also follow the Client Portal settings.</p><div class="cv-grid">' + SECTIONS.map((x) => '<label class="cv-opt"><span class="switch"><input type="checkbox" name="' + x[0] + '"' + (S[x[0]] ? ' checked' : '') + '><span></span></span><span><b>' + esc(x[1]) + '</b></span></label>').join('') + '</div>',
        actions: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'btn-primary', onClick: (m) => { const o = {}; SECTIONS.forEach((x) => (o[x[0]] = m.querySelector('[name=' + x[0] + ']').checked)); return o; } }],
      });
      if (res) { await db.saveSettings({ reportSections: res }); await db.audit('Report contents changed'); U.toast('Report contents saved', 'ok'); rerender(); }
    };
    host.querySelector('#rp-print').onclick = print;
    host.querySelector('#rp-pdf').onclick = () => { U.toast('In the print window choose "Save as PDF"', 'info', 4000); setTimeout(print, 300); };
    host.querySelector('#rp-csv').onclick = () => SW.reports.periodCsv(st.site, cur(), opts.guards ? st.guard : '');
  };
})();
