'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let state = 'idle';       // idle | working | break
let elapsedToday = 0;     // seconds of work logged today (from API)
let activeStart = null;   // Date of current work session start (if working)
let tickInterval = null;

let cfg = { daily_hours: 7, weekly_hours: 35, alert_minutes: 30, hourly_rate: 0 };

// Alert flags so sounds fire once per threshold crossing
let alertFired30 = false;
let alertFired10 = false;
let alertFiredDone = false;

// Calendar state
const _today = new Date();
const _todayStr = `${_today.getFullYear()}-${String(_today.getMonth()+1).padStart(2,'0')}-${String(_today.getDate()).padStart(2,'0')}`;
let calYear = _today.getFullYear();
let calMonth = _today.getMonth() + 1; // 1-12
let calData = {};    // { date_str: seconds }
let calSelected = _todayStr;

// ── Audio ───────────────────────────────────────────────────────────────────
function playBeep(freq = 880, duration = 0.18, type = 'sine') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) {}
}

function playChime() {
  [523, 659, 784].forEach((f, i) => setTimeout(() => playBeep(f, 0.3), i * 180));
}

// ── Formatting ──────────────────────────────────────────────────────────────
function fmtHMS(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}`;
}

function fmtHM(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function fmtEarnings(seconds) {
  const rate = parseFloat(cfg.hourly_rate) || 0;
  if (rate <= 0) return '';
  return '$' + ((seconds / 3600) * rate).toFixed(2);
}

function isoToLocalTime(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function localTimeToIso(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, m] = timeStr.split(':').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0).toISOString();
}

// ── Total worked seconds right now ─────────────────────────────────────────
function totalWorkedNow() {
  if (state === 'working' && activeStart) {
    const extra = (Date.now() - activeStart.getTime()) / 1000;
    return elapsedToday + extra;
  }
  return elapsedToday;
}

// ── UI updates ──────────────────────────────────────────────────────────────
function updateTimerDisplay() {
  const worked = totalWorkedNow();
  document.getElementById('timerDisplay').textContent = fmtHMS(worked);
  updateAlertState(worked);
  updateDayProgress(worked);
}

function updateAlertState(workedSeconds) {
  const dailyGoal = cfg.daily_hours * 3600;
  const remaining = dailyGoal - workedSeconds;
  const alertThresh = cfg.alert_minutes * 60;
  const el = document.getElementById('timerDisplay');

  el.classList.remove('alert-warning', 'alert-danger', 'alert-success');

  if (remaining <= 0) {
    el.classList.add('alert-success');
    document.getElementById('goalBanner').hidden = false;
    if (!alertFiredDone) { alertFiredDone = true; playChime(); }
  } else if (remaining <= 600) {
    el.classList.add('alert-danger');
    document.getElementById('goalBanner').hidden = true;
    if (!alertFired10) { alertFired10 = true; playBeep(660, 0.25); setTimeout(() => playBeep(440, 0.35), 350); }
  } else if (remaining <= alertThresh) {
    el.classList.add('alert-warning');
    document.getElementById('goalBanner').hidden = true;
    if (!alertFired30) { alertFired30 = true; playBeep(880, 0.2); }
  } else {
    document.getElementById('goalBanner').hidden = true;
  }
}

function resetAlertFlags() {
  alertFired30 = false;
  alertFired10 = false;
  alertFiredDone = false;
}

function updateDayProgress(workedSeconds) {
  const goal = cfg.daily_hours * 3600;
  const pct = Math.min(100, (workedSeconds / goal) * 100);
  const bar = document.getElementById('dayBar');
  bar.style.width = pct + '%';
  bar.classList.toggle('full', pct >= 100);
  document.getElementById('dayValue').textContent =
    `${fmtHM(workedSeconds)} / ${cfg.daily_hours}h`;
  const e = fmtEarnings(workedSeconds);
  const el = document.getElementById('dayEarnings');
  el.textContent = e;
  el.hidden = !e;
}

function updateWeekProgress(seconds) {
  const goal = cfg.weekly_hours * 3600;
  const pct = Math.min(100, (seconds / goal) * 100);
  const bar = document.getElementById('weekBar');
  bar.style.width = pct + '%';
  bar.classList.toggle('full', pct >= 100);
  document.getElementById('weekValue').textContent =
    `${fmtHM(seconds)} / ${cfg.weekly_hours}h`;
  const e = fmtEarnings(seconds);
  const el = document.getElementById('weekEarnings');
  el.textContent = e;
  el.hidden = !e;
}

function updateMonthProgress(seconds, workingDays) {
  const goal = workingDays * cfg.daily_hours * 3600;
  const goalH = (workingDays * cfg.daily_hours).toFixed(0);
  const pct = Math.min(100, goal > 0 ? (seconds / goal) * 100 : 0);
  const bar = document.getElementById('monthBar');
  bar.style.width = pct + '%';
  bar.classList.toggle('full', pct >= 100);
  document.getElementById('monthValue').textContent =
    `${fmtHM(seconds)} / ${goalH}h`;
  const e = fmtEarnings(seconds);
  const el = document.getElementById('monthEarnings');
  el.textContent = e;
  el.hidden = !e;
}

function setStatusBadge(s) {
  const el = document.getElementById('statusBadge');
  el.className = 'status-badge ' + s;
  const labels = { idle: 'Idle', working: 'Working', break: 'On Break' };
  el.textContent = labels[s] || s;
}

function setButtons(s) {
  document.getElementById('btnStart').disabled  = s !== 'idle';
  document.getElementById('btnPause').disabled  = s !== 'working';
  document.getElementById('btnStop').disabled   = s === 'idle';

  const pauseBtn = document.getElementById('btnPause');
  if (s === 'break') {
    pauseBtn.textContent = 'Resume';
    pauseBtn.disabled = false;
    pauseBtn.onclick = handleResume;
  } else {
    pauseBtn.textContent = 'Pause';
    pauseBtn.onclick = handlePause;
  }
}

// ── API helpers ─────────────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Controls ────────────────────────────────────────────────────────────────
async function handleStart() {
  await api('/api/sessions/start', 'POST');
  await syncStatus();
  startTick();
}

async function handlePause() {
  await api('/api/sessions/pause', 'POST');
  await syncStatus();
  stopTick();
}

async function handleResume() {
  await api('/api/sessions/resume', 'POST');
  await syncStatus();
  startTick();
}

async function handleStop() {
  await api('/api/sessions/stop', 'POST');
  await syncStatus();
  stopTick();
}

// ── Tick ────────────────────────────────────────────────────────────────────
function startTick() {
  if (tickInterval) return;
  tickInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTick() {
  clearInterval(tickInterval);
  tickInterval = null;
  updateTimerDisplay();
}

// ── Sync with server ─────────────────────────────────────────────────────────
async function syncStatus() {
  const data = await api('/api/status');
  state = data.state;
  elapsedToday = data.elapsed_seconds_today;

  if (state === 'working' && data.active_session_start) {
    activeStart = new Date(data.active_session_start);
    // Subtract the live segment so elapsedToday doesn't double-count
    const liveExtra = (Date.now() - activeStart.getTime()) / 1000;
    elapsedToday = Math.max(0, elapsedToday - liveExtra);
  } else {
    activeStart = null;
  }

  setStatusBadge(state);
  setButtons(state);
  updateTimerDisplay();

  if (state === 'working' && !tickInterval) startTick();
  if (state !== 'working' && tickInterval) stopTick();
}

async function syncWeekMonth() {
  const [week, month] = await Promise.all([
    api('/api/progress/week'),
    api('/api/progress/month'),
  ]);
  updateWeekProgress(week.seconds);
  updateMonthProgress(month.seconds, month.working_days);
}

// ── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  cfg = await api('/api/config');
  cfg.daily_hours   = parseFloat(cfg.daily_hours);
  cfg.weekly_hours  = parseFloat(cfg.weekly_hours);
  cfg.alert_minutes = parseFloat(cfg.alert_minutes);
  cfg.hourly_rate   = parseFloat(cfg.hourly_rate) || 0;

  document.getElementById('cfgDailyHours').value   = cfg.daily_hours;
  document.getElementById('cfgWeeklyHours').value  = cfg.weekly_hours;
  document.getElementById('cfgAlertMinutes').value = cfg.alert_minutes;
  document.getElementById('cfgHourlyRate').value   = cfg.hourly_rate || '';
}

async function saveSettings() {
  const updates = {
    daily_hours:   parseFloat(document.getElementById('cfgDailyHours').value),
    weekly_hours:  parseFloat(document.getElementById('cfgWeeklyHours').value),
    alert_minutes: parseFloat(document.getElementById('cfgAlertMinutes').value),
    hourly_rate:   parseFloat(document.getElementById('cfgHourlyRate').value) || 0,
  };
  const raw = await api('/api/config', 'PUT', updates);
  cfg.daily_hours   = parseFloat(raw.daily_hours);
  cfg.weekly_hours  = parseFloat(raw.weekly_hours);
  cfg.alert_minutes = parseFloat(raw.alert_minutes);
  cfg.hourly_rate   = parseFloat(raw.hourly_rate) || 0;
  resetAlertFlags();

  const msg = document.getElementById('settingsMsg');
  msg.textContent = 'Saved!';
  setTimeout(() => { msg.textContent = ''; }, 2000);

  updateTimerDisplay();
  syncWeekMonth();
  if (calSelected) showDayLog(calSelected);
}

// ── Break time display ────────────────────────────────────────────────────────
async function updateBreakInfo() {
  if (state !== 'break') {
    document.getElementById('breakInfo').textContent = '';
    return;
  }
}

// ── Calendar ──────────────────────────────────────────────────────────────────
async function renderCalendar() {
  calData = await api(`/api/calendar/${calYear}/${calMonth}`);

  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
  const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  document.getElementById('calTitle').textContent =
    `${MONTH_NAMES[calMonth - 1]} ${calYear}`;

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const firstDay = new Date(calYear, calMonth - 1, 1);
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const startDow = (firstDay.getDay() + 6) % 7; // Monday = 0

  let html = '<div class="cal-dow-row">';
  DOW.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
  html += '</div><div class="cal-grid-days">';

  for (let i = 0; i < startDow; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const hasWork = (calData[dateStr] || 0) > 0;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === calSelected;

    let cls = 'cal-day';
    if (hasWork)    cls += ' has-work';
    if (isToday)    cls += ' today';
    if (isSelected) cls += ' selected';

    html += `<div class="${cls}" data-date="${dateStr}">${d}</div>`;
  }

  html += '</div>';
  document.getElementById('calGrid').innerHTML = html;

  document.querySelectorAll('.cal-day[data-date]').forEach(el => {
    el.addEventListener('click', () => showDayLog(el.dataset.date));
  });

  if (calSelected) showDayLog(calSelected);
}

async function showDayLog(dateStr) {
  calSelected = dateStr;

  document.querySelectorAll('.cal-day').forEach(el => {
    el.classList.toggle('selected', el.dataset.date === dateStr);
  });

  const data = await api(`/api/sessions/log/${dateStr}`);
  const panel = document.getElementById('dayLogPanel');
  const dateEl = document.getElementById('dayLogDate');
  const totalEl = document.getElementById('dayLogTotal');
  const sessionsEl = document.getElementById('dayLogSessions');

  const d = new Date(dateStr + 'T12:00:00');
  dateEl.textContent = d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const now = new Date();
  let totalWork = 0;
  data.sessions.forEach(s => {
    if (s.session_type !== 'work') return;
    const start = new Date(s.start_time);
    const end = s.end_time ? new Date(s.end_time) : now;
    totalWork += Math.max(0, (end - start) / 1000);
  });

  const e = fmtEarnings(totalWork);
  totalEl.textContent = e ? `${fmtHM(totalWork)} · ${e}` : fmtHM(totalWork);

  let html = '';
  if (data.sessions.length === 0) {
    html = '<div class="day-log-empty">No sessions recorded</div>';
  } else {
    html = '<div class="day-log-sessions">';
    data.sessions.forEach(s => {
      const start = new Date(s.start_time);
      const end = s.end_time ? new Date(s.end_time) : now;
      const dur = Math.max(0, (end - start) / 1000);
      const startStr = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const endStr   = s.end_time
        ? end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : 'ongoing';
      const earnStr = s.session_type === 'work' ? fmtEarnings(dur) : '';
      const actions = s.end_time
        ? `<span class="session-actions">
             <button class="btn-icon" data-action="edit" data-id="${s.id}" title="Edit">✏</button>
             <button class="btn-icon btn-icon-danger" data-action="delete" data-id="${s.id}" title="Delete">🗑</button>
           </span>`
        : '';
      html += `
        <div class="session-row" data-id="${s.id}">
          <span class="session-type ${s.session_type}">${s.session_type}</span>
          <span class="session-time">${startStr} → ${endStr}</span>
          <span class="session-duration">${fmtHM(dur)}${earnStr ? ' · ' + earnStr : ''}</span>
          ${actions}
        </div>`;
    });
    html += '</div>';
  }
  html += '<button class="btn-add-session" id="btnAddSession">+ Add interval</button>';
  sessionsEl.innerHTML = html;

  sessionsEl.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      const s = data.sessions.find(s => s.id === id);
      const row = sessionsEl.querySelector(`.session-row[data-id="${id}"]`);
      editSession(id, row, dateStr, s);
    });
  });

  sessionsEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteSession(parseInt(btn.dataset.id), dateStr));
  });

  document.getElementById('btnAddSession').addEventListener('click', () => {
    addSessionForm(dateStr, data.sessions);
  });

  panel.hidden = false;
}

function editSession(id, row, dateStr, session) {
  const startVal = isoToLocalTime(session.start_time);
  const endVal   = session.end_time ? isoToLocalTime(session.end_time) : '';
  row.classList.add('session-edit-row');
  row.innerHTML = `
    <select class="session-edit-select">
      <option value="work"  ${session.session_type === 'work'  ? 'selected' : ''}>Work</option>
      <option value="break" ${session.session_type === 'break' ? 'selected' : ''}>Break</option>
    </select>
    <input type="time" class="session-edit-time session-edit-start" value="${startVal}">
    <span style="color:var(--muted)">–</span>
    <input type="time" class="session-edit-time session-edit-end" value="${endVal}">
    <button class="btn-icon btn-save-edit" title="Save">✓</button>
    <button class="btn-icon btn-cancel-edit" title="Cancel">✗</button>
    <span class="session-edit-error"></span>
  `;

  row.querySelector('.btn-save-edit').addEventListener('click', async () => {
    const typeEl  = row.querySelector('.session-edit-select');
    const startEl = row.querySelector('.session-edit-start');
    const endEl   = row.querySelector('.session-edit-end');
    const errEl   = row.querySelector('.session-edit-error');
    if (!startEl.value || !endEl.value) { errEl.textContent = 'Both times are required'; return; }
    const startIso = localTimeToIso(dateStr, startEl.value);
    const endIso   = localTimeToIso(dateStr, endEl.value);
    if (new Date(startIso) >= new Date(endIso)) { errEl.textContent = 'Start must be before end'; return; }
    try {
      await api(`/api/sessions/${id}`, 'PUT', { start_time: startIso, end_time: endIso, session_type: typeEl.value });
      await refreshAfterEdit(dateStr);
    } catch (err) {
      errEl.textContent = 'Save failed';
    }
  });

  row.querySelector('.btn-cancel-edit').addEventListener('click', () => showDayLog(dateStr));
}

async function deleteSession(id, dateStr) {
  if (!confirm('Delete this session?')) return;
  try {
    await api(`/api/sessions/${id}`, 'DELETE');
    await refreshAfterEdit(dateStr);
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

function addSessionForm(dateStr, sessions) {
  if (document.getElementById('addSessionRow')) return;
  document.getElementById('btnAddSession').hidden = true;

  let defaultStart = '09:00';
  let defaultEnd   = '10:00';
  const closed = sessions.filter(s => s.end_time);
  if (closed.length > 0) {
    const lastEnd = new Date(closed[closed.length - 1].end_time);
    const startDt = new Date(lastEnd.getTime() + 30 * 60 * 1000);
    const endDt   = new Date(startDt.getTime() + 60 * 60 * 1000);
    defaultStart = isoToLocalTime(startDt.toISOString());
    defaultEnd   = isoToLocalTime(endDt.toISOString());
  }

  const formRow = document.createElement('div');
  formRow.id = 'addSessionRow';
  formRow.className = 'session-row session-edit-row';
  formRow.innerHTML = `
    <select class="session-edit-select">
      <option value="work" selected>Work</option>
      <option value="break">Break</option>
    </select>
    <input type="time" class="session-edit-time session-edit-start" value="${defaultStart}">
    <span style="color:var(--muted)">–</span>
    <input type="time" class="session-edit-time session-edit-end" value="${defaultEnd}">
    <button class="btn-icon btn-save-add" title="Add">+</button>
    <button class="btn-icon btn-cancel-add" title="Cancel">✗</button>
    <span class="session-edit-error"></span>
  `;

  const addBtn = document.getElementById('btnAddSession');
  addBtn.parentNode.insertBefore(formRow, addBtn);

  formRow.querySelector('.btn-save-add').addEventListener('click', async () => {
    const typeEl  = formRow.querySelector('.session-edit-select');
    const startEl = formRow.querySelector('.session-edit-start');
    const endEl   = formRow.querySelector('.session-edit-end');
    const errEl   = formRow.querySelector('.session-edit-error');
    if (!startEl.value || !endEl.value) { errEl.textContent = 'Both times are required'; return; }
    const startIso = localTimeToIso(dateStr, startEl.value);
    const endIso   = localTimeToIso(dateStr, endEl.value);
    if (new Date(startIso) >= new Date(endIso)) { errEl.textContent = 'Start must be before end'; return; }
    try {
      await api('/api/sessions/manual', 'POST', { date: dateStr, start_time: startIso, end_time: endIso, session_type: typeEl.value });
      await refreshAfterEdit(dateStr);
    } catch (err) {
      errEl.textContent = 'Add failed';
    }
  });

  formRow.querySelector('.btn-cancel-add').addEventListener('click', () => showDayLog(dateStr));
}

async function refreshAfterEdit(dateStr) {
  await Promise.all([syncStatus(), syncWeekMonth(), showDayLog(dateStr)]);
  renderCalendar();
}

function calNavigate(delta) {
  calMonth += delta;
  if (calMonth > 12) { calMonth = 1; calYear++; }
  if (calMonth < 1)  { calMonth = 12; calYear--; }
  const t = new Date();
  if (calYear === t.getFullYear() && calMonth === t.getMonth() + 1) {
    calSelected = _todayStr;
  } else {
    calSelected = null;
    document.getElementById('dayLogPanel').hidden = true;
  }
  renderCalendar();
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings();
  await syncStatus();
  await syncWeekMonth();
  await renderCalendar();

  // Refresh week/month every 60 seconds
  setInterval(syncWeekMonth, 60_000);
}

document.addEventListener('DOMContentLoaded', init);
