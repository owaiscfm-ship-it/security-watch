/* SecureWatch — Management dashboard (overview, charts, staff performance)
 * Every number and chart segment is clickable and opens the matching page or detail.
 */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = SW.util, db = SW.db, Q = SW.q, M = SW.manager;
  const esc = U.esc;
  const C = { green: '#188A52', amber: '#E0A100', red: '#C8293A', blue: '#2F6FE4', navy: '#0E2148', grey: '#D8E0EC', ink2: '#4A5878' };
  const PERIODS = [['today', 'Today'], ['7', '7 days'], ['30', '30 days']];

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const pctTxt = (v) => (v == null ? '—' : v + '%');
  const tone = (v) => (v == null ? C.grey : v >= 95 ? C.green : v >= 75 ? C.amber : C.red);
  const dayLbl = (ymd, o) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, o));

  /* ---------------- data ---------------- */
  function period() {
    const p = (M.filters.dash = M.filters.dash || { p: '7' }).p;
    const to = U.today();
    const from = p === 'today' ? to : U.ymdAdd(to, -(+p - 1));
    return { p, from, to };
  }
  function guardScore(G) {
    const pastShifts = G.worked + G.missedShifts;
    const onTime = pastShifts ? pct(G.worked - G.late, pastShifts) : null;
    const patrol = pct(G.patrols, G.sched);
    const welfare = pct(G.welOk, G.welOk + G.welMiss);
    const parts = [onTime, patrol, welfare].filter((x) => x != null);
    return { onTime, patrol, welfare, score: parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null };
  }
  function hourly(R) {
    // activity heat map: day of week x hour, from checkpoint scans, incidents and welfare confirmations
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const add = (iso) => { if (!iso) return; const p = U.parts(new Date(iso)); const d = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); grid[(d + 6) % 7][p.hour]++; };
    R.scans.forEach((s) => add(s.at));
    R.incidents.forEach((i) => add(i.at));
    R.welfare.forEach((w) => { if (w.status === 'Confirmed') add(w.at); });
    return grid;
  }

  /* ---------------- SVG charts ---------------- */
  function donut(segs, size, centre, sub) {
    const total = segs.reduce((n, s) => n + s.v, 0);
    const r = size / 2 - 10, cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r;
    let off = 0, arcs = '';
    if (!total) arcs = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + C.grey + '" stroke-width="16"/>';
    segs.forEach((s) => {
      if (!s.v) return;
      const len = (s.v / total) * circ;
      arcs += '<circle class="seg" cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + s.c + '" stroke-width="16" stroke-dasharray="' + len + ' ' + (circ - len) + '" stroke-dashoffset="' + -off + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"' + (s.go ? ' data-go="' + esc(s.go) + '"' : '') + '><title>' + esc(s.l + ': ' + s.v) + '</title></circle>';
      off += len;
    });
    return '<svg class="chart-svg donut" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">' + arcs +
      '<text x="' + cx + '" y="' + (cy + 2) + '" text-anchor="middle" class="d-big">' + esc(centre) + '</text>' +
      (sub ? '<text x="' + cx + '" y="' + (cy + 20) + '" text-anchor="middle" class="d-sub">' + esc(sub) + '</text>' : '') + '</svg>';
  }
  function gauge(v, label) {
    const r = 54, circ = Math.PI * r, val = v == null ? 0 : Math.max(0, Math.min(100, v));
    return '<svg class="chart-svg gauge" viewBox="0 0 140 84" width="140" height="84">' +
      '<path d="M16 76 A54 54 0 0 1 124 76" fill="none" stroke="' + C.grey + '" stroke-width="13" stroke-linecap="round"/>' +
      '<path d="M16 76 A54 54 0 0 1 124 76" fill="none" stroke="' + tone(v) + '" stroke-width="13" stroke-linecap="round" stroke-dasharray="' + (circ * val / 100) + ' ' + circ + '"/>' +
      '<text x="70" y="70" text-anchor="middle" class="d-big">' + pctTxt(v) + '</text></svg><div class="g-lbl">' + esc(label) + '</div>';
  }
  function bars(days, key, max) {
    const W = 640, H = 170, padL = 30, padB = 24, n = days.length, slot = (W - padL - 6) / n, bw = Math.max(4, Math.min(30, slot - 6));
    let g = '';
    [0, 50, 100].forEach((t) => { const y = H - padB - (t / 100) * (H - padB - 14); g += '<line x1="' + padL + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#EEF2F8"/><text x="' + (padL - 6) + '" y="' + (y + 4) + '" font-size="10" text-anchor="end" fill="' + C.ink2 + '">' + t + '%</text>'; });
    days.forEach((d, i) => {
      const v = d.sched ? Math.min(100, Math.round((d.patrols / d.sched) * 100)) : null;
      const h = v == null ? 3 : Math.max(3, (v / 100) * (H - padB - 14));
      const x = padL + i * slot + (slot - bw) / 2;
      g += '<rect class="dbar" x="' + x + '" y="' + (H - padB - h) + '" width="' + bw + '" height="' + h + '" rx="3" fill="' + (v == null ? '#EEF2F8' : tone(v)) + '" data-go="day|' + d.date + '"><title>' + dayLbl(d.date, { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + (v == null ? 'no shift' : d.patrols + '/' + d.sched + ' patrols (' + v + '%)') + '</title></rect>';
      if (n <= 14 || i % Math.ceil(n / 12) === 0) g += '<text x="' + (x + bw / 2) + '" y="' + (H - 7) + '" font-size="10" text-anchor="middle" fill="' + C.ink2 + '">' + dayLbl(d.date, n <= 7 ? { weekday: 'short' } : { day: 'numeric' }) + '</text>';
    });
    return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
  }
  function area(points) {
    const W = 640, H = 150, padB = 22, n = points.length;
    const max = Math.max(4, ...points.map((p) => p.v));
    const x = (i) => 10 + (i * (W - 20)) / Math.max(1, n - 1), y = (v) => H - padB - (v / max) * (H - padB - 16);
    const line = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
    let dots = '';
    points.forEach((p, i) => { dots += '<circle class="pt" cx="' + x(i) + '" cy="' + y(p.v) + '" r="4" fill="#fff" stroke="' + C.blue + '" stroke-width="2" data-go="day|' + p.d + '"><title>' + dayLbl(p.d, { day: 'numeric', month: 'short' }) + ': ' + p.v + ' scans</title></circle>'; if (n <= 14 || i % Math.ceil(n / 12) === 0) dots += '<text x="' + x(i) + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="' + C.ink2 + '">' + dayLbl(p.d, n <= 7 ? { weekday: 'short' } : { day: 'numeric' }) + '</text>'; });
    return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '"><defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + C.blue + '" stop-opacity=".35"/><stop offset="1" stop-color="' + C.blue + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + line + ' L' + x(n - 1) + ' ' + (H - padB) + ' L' + x(0) + ' ' + (H - padB) + ' Z" fill="url(#ag)"/><path d="' + line + '" fill="none" stroke="' + C.blue + '" stroke-width="2.5" stroke-linejoin="round"/>' + dots + '</svg>';
  }
  function heat(grid) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const max = Math.max(1, ...grid.flat());
    const cw = 24, ch = 18, L = 34;
    let g = '';
    grid.forEach((row, d) => {
      g += '<text x="' + (L - 6) + '" y="' + (d * ch + 13 + 14) + '" font-size="10" text-anchor="end" fill="' + C.ink2 + '">' + days[d] + '</text>';
      row.forEach((v, h) => { const a = v ? 0.15 + 0.85 * (v / max) : 0; g += '<rect x="' + (L + h * cw) + '" y="' + (d * ch + 14) + '" width="' + (cw - 3) + '" height="' + (ch - 3) + '" rx="3" fill="' + (v ? 'rgba(47,111,228,' + a.toFixed(2) + ')' : '#F2F5FA') + '"><title>' + days[d] + ' ' + U.pad(h) + ':00 — ' + v + ' actions</title></rect>'; });
    });
    for (let h = 0; h < 24; h += 3) g += '<text x="' + (L + h * cw + cw / 2) + '" y="10" font-size="10" text-anchor="middle" fill="' + C.ink2 + '">' + U.pad(h) + '</text>';
    return '<svg class="chart-svg" viewBox="0 0 ' + (L + 24 * cw) + ' ' + (7 * ch + 16) + '">' + g + '</svg>';
  }
  function hbars(items) {
    const max = Math.max(1, ...items.map((i) => i.v));
    return '<div class="hbars">' + items.map((i) => '<button class="hbar" data-go="' + esc(i.go) + '"><span class="hb-l">' + esc(i.l) + '</span><span class="hb-t"><i style="width:' + Math.max(4, (i.v / max) * 100) + '%;background:' + (i.c || C.blue) + '"></i></span><b>' + i.v + '</b></button>').join('') + '</div>';
  }
  function spark(vals) {
    const W = 90, H = 26, n = vals.length;
    if (n < 2) return '';
    const pts = vals.map((v, i) => (4 + (i * (W - 8)) / (n - 1)).toFixed(1) + ',' + (H - 3 - ((v == null ? 0 : v) / 100) * (H - 6)).toFixed(1)).join(' ');
    return '<svg class="chart-svg spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><polyline points="' + pts + '" fill="none" stroke="' + C.blue + '" stroke-width="2" stroke-linejoin="round"/></svg>';
  }

  /* ---------------- tiles ---------------- */
  function tile(o) {
    return '<button class="dtile' + (o.alert ? ' dtile-alert' : '') + '" data-go="' + esc(o.go) + '" style="--tc:' + (o.c || C.blue) + '">' +
      '<span class="dt-ico">' + o.ico + '</span><span class="dt-l">' + esc(o.l) + '</span><b class="dt-v">' + o.v + '</b><span class="dt-s">' + o.s + '</span>' + (o.spark || '') + '<span class="dt-go" aria-hidden="true">›</span></button>';
  }
  const ICO = {
    guard: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/></svg>',
    patrol: '<svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>',
    cp: '<svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2z"/></svg>',
    inc: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3L12 4zm0 6v4m0 3v.5"/></svg>',
    wel: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    hours: '<svg viewBox="0 0 24 24"><path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9"/></svg>',
    sos: '<svg viewBox="0 0 24 24"><path d="M7 20v-5a5 5 0 0110 0v5H7zM5 20h14M12 3v3M5.6 5.6l2.1 2.1M18.4 5.6l-2.1 2.1"/></svg>',
  };

  /* ---------------- the view ---------------- */
  function render(v) {
    const P = period();
    const R = SW.reports.compute(null, P.from, P.to);
    const st = M.status();
    const days = R.perDay;
    const patrolPct = pct(R.done, R.schedPatrols);
    const welPct = pct(R.welOk, R.welOk + R.welMiss);
    const pastShifts = R.shifts.filter((s) => new Date(s.startAt) < new Date());
    const late = R.issues.filter((x) => /Late/.test(x.text)).length, noShow = R.issues.filter((x) => /No clock-in/.test(x.text)).length;
    const onTimePct = pastShifts.length ? pct(pastShifts.length - late - noShow, pastShifts.length) : null;
    const openInc = db.where('incidents', (i) => i.status !== 'Resolved');
    const sosOpen = db.where('sosEvents', (e) => e.status !== 'Resolved').length;
    const trend = days.map((d) => (d.sched ? Math.round((d.patrols / d.sched) * 100) : null));
    const hour = U.parts(new Date()).hour;
    const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const sevs = [['Critical', C.red], ['High', '#E8603C'], ['Medium', C.amber], ['Low', '#8A97B4']];
    const types = {};
    R.incidents.forEach((i) => (types[i.type] = (types[i.type] || 0) + 1));
    const scansPerDay = days.map((d) => ({ d: d.date, v: R.scans.filter((s) => U.ymd(s.at) === d.date).length }));
    const team = R.perGuard.map((G) => Object.assign({ G, g: Q.guard(G.id) }, guardScore(G))).sort((a, b) => (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score));
    const onDutyNames = st.onDuty.map((s) => Q.guardName(s.guardId));

    v.innerHTML =
      M.alertsHtml(null, true) +
      '<section class="dhero">' +
      '<div><p class="dh-hi">' + hello + ', ' + esc(SW.session.displayName.split(' ')[0]) + '</p><h2>' + (st.sh ? '<span class="pulse"></span>' + esc(onDutyNames.join(', ')) + ' on duty' : 'No guard on duty right now') + '</h2>' +
      '<p class="dh-sub">' + (st.active ? 'Patrol in progress · ' + Q.patrolProgress(st.active).done + '/' + Q.patrolProgress(st.active).total + ' checkpoints' : st.sh ? 'No patrol running' : (function () { const n = db.where('shifts', (s) => s.status === 'Scheduled' && new Date(s.endAt) > new Date()).sort((a, b) => (a.startAt > b.startAt ? 1 : -1))[0]; return n ? 'Next shift: ' + esc(Q.guardName(n.guardId)) + ', ' + U.fmtShortDate(n.startAt) + ' ' + esc(n.start) : 'No upcoming shifts'; })()) + '</p></div>' +
      '<div class="dh-right"><div class="seg seg-sm dh-period">' + PERIODS.map((x) => '<label><input type="radio" name="dp" value="' + x[0] + '"' + (x[0] === P.p ? ' checked' : '') + '><span>' + x[1] + '</span></label>').join('') + '</div>' +
      '<button class="btn btn-sm btn-white" data-go="live">Live operations ›</button></div></section>' +

      '<div class="dtiles">' +
      tile({ l: 'Guard status', v: st.sh ? 'On duty' : 'Off duty', s: st.sh ? 'since ' + U.fmtTime(st.sh.actualStart) : 'no one clocked in', ico: ICO.guard, c: st.sh ? C.green : '#8A97B4', go: 'live' }) +
      tile({ l: 'Patrol completion', v: pctTxt(patrolPct), s: R.done + ' of ' + R.schedPatrols + ' patrols', ico: ICO.patrol, c: tone(patrolPct), go: 'patrols', spark: spark(trend) }) +
      tile({ l: 'Checkpoints verified', v: String(R.scans.length), s: R.missedCp ? '<b class="red-text">' + R.missedCp + ' missed</b>' : 'none missed', ico: ICO.cp, c: R.missedCp ? C.amber : C.blue, go: 'checkpoints' }) +
      tile({ l: 'Open incidents', v: String(openInc.length), s: R.incidents.length + ' reported in period', ico: ICO.inc, c: openInc.some((i) => i.severity === 'High' || i.severity === 'Critical') ? C.red : openInc.length ? C.amber : C.green, go: 'incidents|status=open', alert: openInc.some((i) => i.severity === 'Critical') }) +
      tile({ l: 'Welfare compliance', v: pctTxt(welPct), s: R.welMiss ? '<b class="red-text">' + R.welMiss + ' missed</b>' : R.welOk + ' confirmed', ico: ICO.wel, c: tone(welPct), go: R.welMiss ? 'welfare|status=Missed' : 'welfare' }) +
      tile({ l: 'On-time attendance', v: pctTxt(onTimePct), s: late + ' late · ' + noShow + ' no clock-in', ico: ICO.clock, c: tone(onTimePct), go: 'shifts' }) +
      tile({ l: 'Hours on site', v: R.hours.toFixed(1), s: R.shifts.filter((s) => s.actualStart).length + ' shifts worked', ico: ICO.hours, c: C.navy, go: 'reports|' + P.from }) +
      tile({ l: 'SOS alerts', v: String(R.sos.length), s: sosOpen ? '<b class="red-text">' + sosOpen + ' not resolved</b>' : 'all clear', ico: ICO.sos, c: sosOpen ? C.red : C.green, go: 'welfare', alert: sosOpen > 0 }) +
      '</div>' +

      '<div class="dgrid">' +
      '<section class="panel dg-wide"><div class="panel-head"><h2>Patrol completion by day</h2><span class="muted">Click a bar for that day\u2019s report</span></div>' + bars(days) + '<p class="rp-legend"><i style="background:' + C.green + '"></i>95%+ <i style="background:' + C.amber + '"></i>75–94% <i style="background:' + C.red + '"></i>under 75% <i style="background:#EEF2F8"></i>no shift</p></section>' +
      '<section class="panel"><div class="panel-head"><h2>Compliance</h2></div><div class="gauges">' +
      '<button class="gbox" data-go="patrols">' + gauge(patrolPct, 'Patrols') + '</button><button class="gbox" data-go="welfare">' + gauge(welPct, 'Welfare') + '</button><button class="gbox" data-go="shifts">' + gauge(onTimePct, 'On time') + '</button></div></section>' +
      '</div>' +

      '<div class="dgrid">' +
      '<section class="panel"><div class="panel-head"><h2>Incidents by severity</h2></div><div class="donut-wrap">' +
      donut(sevs.map((x) => ({ l: x[0], v: R.sev(x[0]), c: x[1], go: 'incidents|severity=' + x[0] })), 170, String(R.incidents.length), R.incidents.length === 1 ? 'incident' : 'incidents') +
      '<div class="legend">' + sevs.map((x) => '<button data-go="incidents|severity=' + x[0] + '"><i style="background:' + x[1] + '"></i>' + x[0] + '<b>' + R.sev(x[0]) + '</b></button>').join('') + '</div></div></section>' +
      '<section class="panel"><div class="panel-head"><h2>Incidents by type</h2></div>' + (Object.keys(types).length ? hbars(Object.keys(types).sort((a, b) => types[b] - types[a]).slice(0, 6).map((t) => ({ l: t, v: types[t], go: 'incidents|type=' + t, c: C.navy }))) : '<div class="empty"><p>No incidents in this period. 👍</p></div>') + '</section>' +
      '<section class="panel"><div class="panel-head"><h2>Checkpoint scans per day</h2></div>' + area(scansPerDay) + '</section>' +
      '</div>' +

      '<section class="panel"><div class="panel-head"><h2>Staff performance</h2><span class="muted">Click a guard for their full profile</span></div>' +
      (team.length ? '<div class="staff">' + team.map((t, i) => '<button class="staff-row" data-go="guard|' + esc(t.G.id) + '">' +
        '<span class="rank">' + (i + 1) + '</span>' + M.avatar(t.g || { name: Q.guardName(t.G.id) }, 42) +
        '<span class="sr-name"><b>' + esc(Q.guardName(t.G.id)) + '</b><small>' + t.G.worked + '/' + t.G.shifts + ' shifts · ' + t.G.hours.toFixed(1) + ' h · ' + t.G.incidents + ' incident' + (t.G.incidents === 1 ? '' : 's') + '</small></span>' +
        metric('On time', t.onTime) + metric('Patrols', t.patrol) + metric('Welfare', t.welfare) +
        '<span class="score" style="--sc:' + tone(t.score) + '"><b>' + (t.score == null ? '—' : t.score) + '</b><small>score</small></span></button>').join('') + '</div>'
        : '<div class="empty"><p>No shifts in this period.</p></div>') + '</section>' +

      '<div class="dgrid">' +
      '<section class="panel dg-wide"><div class="panel-head"><h2>When work happens</h2><span class="muted">Scans, incidents and welfare checks by day and hour (UK time)</span></div>' + heat(hourly(R)) + '</section>' +
      '<section class="panel"><div class="panel-head"><h2>Needs attention</h2></div>' + attention(R) + '</section>' +
      '</div>';

    bind(v);
  }
  function metric(l, val) { return '<span class="sm"><small>' + l + '</small><span class="sm-bar"><i style="width:' + (val || 0) + '%;background:' + tone(val) + '"></i></span><b>' + pctTxt(val) + '</b></span>'; }
  function attention(R) {
    const items = [];
    db.where('sosEvents', (e) => e.status !== 'Resolved').forEach((e) => items.push({ c: C.red, t: 'SOS ' + e.status.toLowerCase() + ' — ' + Q.guardName(e.guardId), s: U.fmtDateTime(e.at), go: 'welfare' }));
    db.where('incidents', (i) => i.status === 'Open' && (i.severity === 'High' || i.severity === 'Critical')).forEach((i) => items.push({ c: C.red, t: i.severity + ': ' + i.type, s: i.id + ' · ' + U.fmtDateTime(i.at), go: 'inc|' + i.id }));
    R.incomplete.slice(-5).forEach((p) => items.push({ c: C.amber, t: 'Incomplete patrol — ' + Q.guardName(p.guardId), s: p.id + ' · missed ' + (p.missed || []).map((m) => m.name).join(', '), go: 'patrol|' + p.id }));
    R.welfare.filter((w) => w.status === 'Missed').slice(-5).forEach((w) => items.push({ c: C.amber, t: 'Missed welfare check — ' + Q.guardName(w.guardId), s: 'Due ' + U.fmtDateTime(w.dueAt), go: 'welfare|status=Missed' }));
    R.issues.slice(-5).forEach((x) => items.push({ c: '#8A97B4', t: x.text + ' — ' + Q.guardName(x.s.guardId), s: U.fmtShortDate(x.s.startAt) + ' ' + x.s.start, go: 'shifts' }));
    const warn = db.settings().licenceWarnDays;
    db.all('guards').filter((g) => g.status === 'Active').forEach((g) => { const l = U.licenceStatus(g.siaExpiry, warn); if (l.key !== 'valid') items.push({ c: l.key === 'expired' ? C.red : C.amber, t: 'SIA licence ' + l.label.toLowerCase() + ' — ' + g.name, s: 'Expiry ' + U.fmtDate(g.siaExpiry), go: 'guard|' + g.id }); });
    if (!items.length) return '<div class="allclear"><span>✓</span><b>All clear</b><small>Nothing needs your attention.</small></div>';
    return '<ul class="attn">' + items.slice(0, 9).map((i) => '<li><button data-go="' + esc(i.go) + '"><i style="background:' + i.c + '"></i><span><b>' + esc(i.t) + '</b><small>' + esc(i.s) + '</small></span><em>›</em></button></li>').join('') + '</ul>';
  }

  /* ---------------- clicks ---------------- */
  function go(target) {
    const [kind, arg] = target.split('|');
    const [k, val] = (arg || '').split('=');
    if (kind === 'guard') return guardProfile(arg);
    if (kind === 'inc') return M.incidentDetail(db.get('incidents', arg), true);
    if (kind === 'patrol') { M.filters.patrol = { date: '', guard: '', route: '', status: '' }; location.hash = '#/manager/patrols'; return; }
    if (kind === 'day') { SW.reports._state = Object.assign(SW.reports._state || {}, { type: 'day', anchor: arg, guard: '' }); location.hash = '#/manager/reports'; return; }
    if (kind === 'reports') { const P = period(); SW.reports._state = Object.assign(SW.reports._state || {}, P.p === 'today' ? { type: 'day', anchor: P.to } : { type: 'custom', from: P.from, to: P.to, anchor: P.to }); location.hash = '#/manager/reports'; return; }
    if (kind === 'incidents') {
      M.filters.inc = { status: '', severity: '', type: '', site: '' };
      if (k === 'status' && val === 'open') M.filters.inc.status = 'Open'; else if (k) M.filters.inc[k] = val;
    }
    if (kind === 'welfare') M.filters.wel = { status: k === 'status' ? val : '' };
    if (kind === 'patrols') M.filters.patrol = { date: '', guard: '', route: '', status: '' };
    if (location.hash === '#/manager/' + kind) M.render(); else location.hash = '#/manager/' + kind;
  }
  function bind(v) {
    v.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); go(el.dataset.go); }));
    v.querySelectorAll('[name=dp]').forEach((r) => (r.onchange = () => { M.filters.dash.p = r.value; M.render(); }));
    M.bindSos(v);
  }

  /* ---------------- staff profile ---------------- */
  function guardProfile(id) {
    const g = Q.guard(id) || { id, name: Q.guardName(id) };
    const to = U.today(), from = U.ymdAdd(to, -29);
    const R = SW.reports.compute(null, from, to, id);
    const G = R.perGuard.find((x) => x.id === id) || { worked: 0, shifts: 0, hours: 0, late: 0, missedShifts: 0, patrols: 0, sched: 0, incidents: 0, welOk: 0, welMiss: 0 };
    const sc = guardScore(G);
    const l = U.licenceStatus(g.siaExpiry, db.settings().licenceWarnDays);
    const next = db.where('shifts', (s) => s.guardId === id && s.status === 'Scheduled' && new Date(s.endAt) > new Date()).sort((a, b) => (a.startAt > b.startAt ? 1 : -1)).slice(0, 3);
    const recent = R.shifts.filter((s) => new Date(s.startAt) < new Date()).slice(-8).reverse();
    const onDuty = Q.onDutyShifts().find((s) => s.guardId === id);
    U.modal({
      title: g.name, wide: true,
      body: '<div class="gp-head">' + M.avatar(g, 88) + '<div><h3>' + esc(g.name) + '</h3><p>' + (onDuty ? '<span class="pulse"></span> On duty since ' + U.fmtTime(onDuty.actualStart) : 'Off duty') + ' · ' + U.badge(g.status || 'Active', g.status === 'Active' ? 'green' : 'grey') + '</p>' +
        '<p class="muted">SIA •••• ' + esc(String(g.siaNumber || '').slice(-4)) + ' · ' + U.badge(l.icon + ' ' + l.label, l.cls) + ' · expires ' + U.fmtDate(g.siaExpiry) + (g.phone ? ' · ' + esc(g.phone) : '') + '</p></div>' +
        '<span class="score big" style="--sc:' + tone(sc.score) + '"><b>' + (sc.score == null ? '—' : sc.score) + '</b><small>score (30 days)</small></span></div>' +
        '<div class="gp-tiles">' +
        '<div><small>Shifts worked</small><b>' + G.worked + '/' + G.shifts + '</b></div><div><small>Hours on site</small><b>' + G.hours.toFixed(1) + '</b></div>' +
        '<div><small>On time</small><b style="color:' + tone(sc.onTime) + '">' + pctTxt(sc.onTime) + '</b><em>' + G.late + ' late · ' + G.missedShifts + ' no clock-in</em></div>' +
        '<div><small>Patrols</small><b style="color:' + tone(sc.patrol) + '">' + pctTxt(sc.patrol) + '</b><em>' + G.patrols + '/' + G.sched + '</em></div>' +
        '<div><small>Welfare</small><b style="color:' + tone(sc.welfare) + '">' + pctTxt(sc.welfare) + '</b><em>' + G.welMiss + ' missed</em></div>' +
        '<div><small>Incidents reported</small><b>' + G.incidents + '</b></div></div>' +
        '<h3>Patrol completion — last 30 days</h3>' + bars(R.perDay) +
        '<h3>Recent shifts</h3>' + M.table([
          { label: 'Date', html: (s) => U.fmtShortDate(s.startAt) },
          { label: 'Rota', html: (s) => esc(s.start + '–' + s.end) },
          { label: 'Clock in', html: (s) => (s.actualStart ? U.fmtTime(s.actualStart) + (new Date(s.actualStart) - new Date(s.startAt) > 600000 ? ' <span class="amber-text">late</span>' : '') : '<span class="red-text">—</span>') },
          { label: 'Clock out', html: (s) => (s.actualEnd ? U.fmtTime(s.actualEnd) : s.actualStart ? 'on duty' : '—') },
          { label: 'Patrols', html: (s) => R.patrols.filter((p) => p.shiftId === s.id && p.status === 'Complete').length + '/' + Q.scheduledPatrols(s) },
          { label: 'Welfare missed', html: (s) => String(R.welfare.filter((w) => w.shiftId === s.id && w.status === 'Missed').length) },
          { label: 'Incidents', html: (s) => String(R.incidents.filter((i) => i.shiftId === s.id).length) },
        ], recent, 'No shifts in the last 30 days.') +
        '<h3>Next shifts</h3>' + (next.length ? '<ul class="feed">' + next.map((s) => '<li><time>' + U.fmtShortDate(s.startAt) + '</time><div><b>' + esc(s.start + '–' + s.end) + '</b> ' + esc(Q.siteName(s.siteId)) + '</div></li>').join('') + '</ul>' : '<p class="muted">No upcoming shifts.</p>'),
      actions: [{ label: 'Edit guard', value: 'edit' }, { label: 'Monthly report', value: 'report' }, { label: 'Close', cls: 'btn-primary', value: null }],
    }).then((r) => {
      if (r === 'report') { SW.reports._state = Object.assign(SW.reports._state || {}, { type: 'month', anchor: U.today(), guard: id }); location.hash = '#/manager/reports'; }
      if (r === 'edit') { location.hash = '#/manager/guards'; setTimeout(() => { const b = document.querySelector('[data-edit="' + id + '"]'); if (b) b.click(); }, 300); }
    });
  }
  M.guardProfile = guardProfile;

  M.VIEWS.dashboard = function (v) {
    if (!SW.reports || !SW.reports.compute) throw new Error('reports.js is missing or out of date');
    render(v);
  };
})();
