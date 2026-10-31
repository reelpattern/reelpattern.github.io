'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

/* ---------- Storage (IndexedDB, on this phone) ---------- */
const DB = new Promise((res, rej) => {
  const r = indexedDB.open('reelpattern', 1);
  r.onupgradeneeded = () => {
    const d = r.result;
    d.createObjectStore('catches', { keyPath: 'id' });
    d.createObjectStore('spots', { keyPath: 'id' });
    d.createObjectStore('kv');
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function tx(store, mode, fn) {
  const d = await DB;
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
    t.onerror = () => rej(t.error);
  });
}
const getAll = s => tx(s, 'readonly', st => st.getAll());
const put = (s, v) => tx(s, 'readwrite', st => st.put(v));
const putMany = (s, arr) => tx(s, 'readwrite', st => { arr.forEach(v => st.put(v)); });
const remove = (s, id) => tx(s, 'readwrite', st => st.delete(id));
const kvGet = k => tx('kv', 'readonly', st => st.get(k));
const kvSet = (k, v) => tx('kv', 'readwrite', st => st.put(v, k));

/* ---------- Helpers ---------- */
function distMi(a, b) {
  const R = 3958.8, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pad = n => String(n).padStart(2, '0');
const ymd = d => { d = new Date(d); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`; };
const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDate = t => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const compass = d => d == null ? '' : ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(d / 22.5) % 16];
const fmtDur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

function getPos() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), acc: Math.round(p.coords.accuracy) }),
      () => res(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}

/* ---------- Conditions ---------- */
const MOON_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
function moonAt(t) {
  const syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((t - ref) / 864e5) % syn + syn) % syn, ph = age / syn;
  return { name: MOON_NAMES[Math.round(ph * 8) % 8], illum: Math.round((1 - Math.cos(2 * Math.PI * ph)) / 2 * 100), age: +age.toFixed(1) };
}

async function fetchJSON(url, ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function nearestHour(j, t) {
  const off = (j.utc_offset_seconds || 0) * 1000;
  const times = j.hourly.time.map(s => Date.parse(s + ':00Z') - off);
  let best = 0;
  times.forEach((x, i) => { if (Math.abs(x - t) < Math.abs(times[best] - t)) best = i; });
  return best;
}
const daysBack = t => Math.min(92, Math.max(1, Math.ceil((Date.now() - t) / 864e5) + 1));

async function weatherAt(lat, lon, t) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,pressure_msl,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation&temperature_unit=fahrenheit&wind_speed_unit=kn&precipitation_unit=inch&timezone=auto&past_days=${daysBack(t)}&forecast_days=2`;
  const j = await fetchJSON(u);
  const i = nearestHour(j, t), h = j.hourly;
  const p = h.pressure_msl[i], p3 = h.pressure_msl[Math.max(0, i - 3)];
  const diff = p != null && p3 != null ? p - p3 : null;
  return {
    air: h.temperature_2m[i] != null ? Math.round(h.temperature_2m[i]) : null,
    wind: h.wind_speed_10m[i] != null ? Math.round(h.wind_speed_10m[i]) : null,
    gust: h.wind_gusts_10m[i] != null ? Math.round(h.wind_gusts_10m[i]) : null,
    windDir: h.wind_direction_10m[i],
    cloud: h.cloud_cover[i],
    rain: h.precipitation[i],
    pressure: p != null ? +(p * 0.02953).toFixed(2) : null,
    pressureTrend: diff == null ? '' : diff > 1 ? 'Rising' : diff < -1 ? 'Falling' : 'Steady',
  };
}

async function marineAt(lat, lon, t) {
  const u = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=sea_surface_temperature,wave_height,wave_period&timezone=auto&past_days=${daysBack(t)}&forecast_days=2`;
  const j = await fetchJSON(u);
  const i = nearestHour(j, t), h = j.hourly;
  const sst = h.sea_surface_temperature && h.sea_surface_temperature[i];
  const wh = h.wave_height && h.wave_height[i];
  return {
    water: sst != null ? Math.round(sst * 9 / 5 + 32) : null,
    waves: wh != null ? +(wh * 3.281).toFixed(1) : null,
    wavePeriod: h.wave_period && h.wave_period[i] != null ? Math.round(h.wave_period[i]) : null,
  };
}

async function tideStations() {
  const cached = await kvGet('tideStations');
  if (cached && Date.now() - cached.t < 30 * 864e5) return cached.list;
  const j = await fetchJSON('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions', 30000);
  const list = (j.stations || []).map(s => ({ id: s.id, name: s.name, lat: +s.lat, lon: +s.lng })).filter(s => isFinite(s.lat) && isFinite(s.lon));
  await kvSet('tideStations', { t: Date.now(), list });
  return list;
}

async function tideAt(lat, lon, t) {
  const stations = await tideStations();
  let st = null, best = Infinity;
  for (const s of stations) { const d = distMi({ lat, lon }, s); if (d < best) { best = d; st = s; } }
  if (!st || best > 60) return null;
  const u = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=ReelPattern&begin_date=${ymd(t - 864e5)}&end_date=${ymd(t + 864e5)}&datum=MLLW&station=${st.id}&time_zone=gmt&units=english&interval=hilo&format=json`;
  const j = await fetchJSON(u);
  const preds = (j.predictions || []).map(p => ({ t: Date.parse(p.t.replace(' ', 'T') + ':00Z'), v: +p.v, type: p.type }));
  let prev = null, next = null;
  for (const p of preds) { if (p.t <= t) prev = p; else { next = p; break; } }
  if (!prev || !next) return { station: st.name, stationMi: +best.toFixed(1) };
  const frac = (t - prev.t) / (next.t - prev.t);
  const height = prev.v + (next.v - prev.v) * (1 - Math.cos(Math.PI * frac)) / 2;
  return {
    station: st.name, stationMi: +best.toFixed(1),
    stage: next.type === 'H' ? 'Incoming' : 'Outgoing',
    frac: +frac.toFixed(2),
    height: +height.toFixed(1),
    nextType: next.type === 'H' ? 'High' : 'Low', nextAt: next.t, nextV: next.v,
    upcoming: preds.filter(p => p.t > t).slice(0, 4),
  };
}

async function conditionsAt(lat, lon, t) {
  const c = { moon: moonAt(t), at: t };
  const [w, m, tide] = await Promise.allSettled([weatherAt(lat, lon, t), marineAt(lat, lon, t), tideAt(lat, lon, t)]);
  if (w.status === 'fulfilled') Object.assign(c, w.value);
  if (m.status === 'fulfilled') Object.assign(c, m.value);
  if (tide.status === 'fulfilled' && tide.value) c.tide = tide.value;
  c.pending = w.status !== 'fulfilled' && m.status !== 'fulfilled' && tide.status !== 'fulfilled';
  return c;
}

function condChips(c) {
  if (!c) return '<span class="chip warn">Conditions pending</span>';
  const x = [];
  if (c.tide && c.tide.stage) x.push(`${c.tide.stage} tide`);
  if (c.water != null) x.push(`Water ${c.water}°F`);
  if (c.air != null) x.push(`Air ${c.air}°F`);
  if (c.wind != null) x.push(`${compass(c.windDir)} ${c.wind} kt`);
  if (c.pressure != null) x.push(`${c.pressure} inHg ${c.pressureTrend ? c.pressureTrend.toLowerCase() : ''}`.trim());
  if (c.cloud != null) x.push(`${c.cloud}% clouds`);
  if (c.waves != null) x.push(`Seas ${c.waves} ft`);
  if (c.moon) x.push(`${c.moon.name}`);
  let html = x.map(s => `<span class="chip">${esc(s)}</span>`).join('');
  if (c.pending) html += '<span class="chip warn">Weather and tide fill in when you have signal</span>';
  return html;
}

/* ---------- Tabs ---------- */
const views = ['log', 'now', 'history', 'spots'];
function show(v) {
  views.forEach(n => { $('#view-' + n).hidden = n !== v; });
  document.querySelectorAll('nav button').forEach(b => {
    if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (v === 'now') loadNow();
  if (v === 'history') renderHistory();
  if (v === 'spots') renderSpots();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

/* ---------- Voice ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, baseText = '';
const micBtn = $('#micBtn'), micLbl = $('#micLbl'), note = $('#note');
if (!SR) {
  micLbl.textContent = 'Type or use keyboard mic below';
  micBtn.addEventListener('click', () => note.focus());
} else {
  micBtn.addEventListener('click', () => listening ? rec.stop() : startListening());
}
function startListening() {
  rec = new SR();
  rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
  baseText = note.value ? note.value.trim() + ' ' : '';
  rec.onresult = e => {
    let txt = '';
    for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
    note.value = baseText + txt;
  };
  rec.onend = () => { listening = false; micBtn.classList.remove('on'); micLbl.textContent = 'Tap and talk'; onNoteChange(); };
  rec.onerror = e => { if (e.error === 'not-allowed') toast('Microphone is blocked. Use the keyboard mic instead.'); };
  try { rec.start(); listening = true; micBtn.classList.add('on'); micLbl.textContent = 'Listening… tap to stop'; }
  catch (err) { toast('Voice did not start. Use the keyboard mic instead.'); }
}

/* ---------- Log flow ---------- */
let currentPos = null, photoBlob = null, spotsCache = [];
let parseTimer = null;
note.addEventListener('input', () => { clearTimeout(parseTimer); parseTimer = setTimeout(onNoteChange, 400); });

async function refreshPos() {
  $('#posLine').textContent = 'Getting your location…';
  currentPos = await getPos();
  updatePosLine();
  return currentPos;
}
function updatePosLine() {
  if (!currentPos) { $('#posLine').textContent = 'Location off. Pick a saved spot, or allow location for Safari in Settings.'; return; }
  $('#posLine').textContent = `GPS ${currentPos.lat.toFixed(4)}, ${currentPos.lon.toFixed(4)} (±${currentPos.acc} m)`;
}

async function onNoteChange() {
  const text = note.value.trim();
  if (!text) { $('#parsedCard').hidden = true; return; }
  const p = RP.parseCatch(text);
  $('#f-species').value = p.fish.map(f => `${f.species} ×${f.count}`).join(', ');
  $('#f-len').value = p.length ?? '';
  $('#f-wt').value = p.weight ?? '';
  $('#f-bait').value = p.bait;
  $('#f-kept').value = p.kept === true ? 'kept' : p.kept === false ? 'released' : '';
  await fillSpotSelect(p.spotName);
  $('#parsedCard').hidden = false;
}

async function fillSpotSelect(spokenName) {
  spotsCache = await getAll('spots');
  const sel = $('#f-spot');
  let choice = '__here';
  if (spokenName) {
    const s = spokenName.toLowerCase();
    const hit = spotsCache.find(x => x.name.toLowerCase() === s) || spotsCache.find(x => x.name.toLowerCase().includes(s) || s.includes(x.name.toLowerCase()));
    if (hit) choice = hit.id; else choice = '__new';
  } else if (currentPos) {
    let best = null, bd = Infinity;
    spotsCache.forEach(x => { const d = distMi(currentPos, x); if (d < bd) { bd = d; best = x; } });
    if (best && bd < 0.25) choice = best.id;
  }
  const near = currentPos ? spotsCache.map(x => ({ x, d: distMi(currentPos, x) })).sort((a, b) => a.d - b.d).slice(0, 30) : spotsCache.slice(0, 30).map(x => ({ x, d: null }));
  if (choice !== '__here' && choice !== '__new' && !near.some(n => n.x.id === choice)) near.unshift({ x: spotsCache.find(s => s.id === choice), d: null });
  sel.innerHTML =
    `<option value="__here">Right here (GPS)</option>` +
    (spokenName ? `<option value="__new">New spot here: "${esc(spokenName)}"</option>` : '') +
    near.map(n => `<option value="${esc(n.x.id)}">${esc(n.x.name)}${n.d != null ? ` · ${n.d < 10 ? n.d.toFixed(1) : Math.round(n.d)} mi` : ''}</option>`).join('');
  sel.value = choice;
}

$('#photo').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    photoBlob = await shrinkImage(f, 1400);
    const prev = $('#photoPrev');
    prev.src = URL.createObjectURL(photoBlob); prev.hidden = false;
    $('#photoName').textContent = 'Photo added';
  } catch (err) { toast('Could not read that photo.'); }
});
function shrinkImage(file, max) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b ? res(b) : rej(new Error('no blob')), 'image/jpeg', 0.82);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

function parseSpeciesField(v) {
  return v.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^(.*?)(?:\s*[×x*]\s*(\d+))?$/i);
    return { species: m[1].trim(), count: m[2] ? +m[2] : 1 };
  });
}

$('#saveBtn').addEventListener('click', async () => {
  const text = note.value.trim();
  if (!text && !photoBlob) { toast('Say or type what you caught first.'); return; }
  if ($('#parsedCard').hidden) await onNoteChange();
  const btn = $('#saveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const t = Date.now();
    if (!currentPos) await refreshPos();
    let spotId = $('#f-spot').value, spot = null;
    if (spotId === '__new') {
      const name = RP.parseCatch(text).spotName || 'New spot';
      if (!currentPos) { toast('Need GPS to save a new spot. Pick a saved spot instead.'); return; }
      spot = { id: uid(), name: name.replace(/\b\w/g, c => c.toUpperCase()), lat: currentPos.lat, lon: currentPos.lon, type: RP.guessType(name).type, typeHow: 'name', source: 'log', added: t };
      await put('spots', spot); spotId = spot.id;
    } else if (spotId && spotId !== '__here') {
      spot = (await getAll('spots')).find(s => s.id === spotId) || null;
    }
    const pos = spot ? { lat: spot.lat, lon: spot.lon } : currentPos;
    const rec = {
      id: uid(), t, note: text,
      fish: parseSpeciesField($('#f-species').value),
      length: $('#f-len').value ? +$('#f-len').value : null,
      weight: $('#f-wt').value ? +$('#f-wt').value : null,
      bait: $('#f-bait').value.trim(),
      kept: $('#f-kept').value || '',
      spotId: spot ? spot.id : null, spotName: spot ? spot.name : '',
      pos: pos || null, gps: currentPos,
      photo: photoBlob || null,
      cond: { moon: moonAt(t), at: t, pending: true },
    };
    await put('catches', rec);
    resetLog();
    toast('Catch saved. Pulling conditions…');
    if (pos) {
      conditionsAt(pos.lat, pos.lon, t).then(async c => { rec.cond = c; await put('catches', rec); if (!$('#view-history').hidden) renderHistory(); });
    }
    show('history');
  } finally { btn.disabled = false; btn.textContent = 'Save catch'; }
});

function resetLog() {
  note.value = ''; photoBlob = null;
  $('#photo').value = ''; $('#photoPrev').hidden = true; $('#photoName').textContent = '';
  $('#parsedCard').hidden = true;
}

/* ---------- Backfill conditions saved without signal ---------- */
let backfilling = false;
async function backfill() {
  if (backfilling || !navigator.onLine) return;
  backfilling = true;
  try {
    const all = await getAll('catches');
    for (const c of all.filter(x => x.pos && (!x.cond || x.cond.pending))) {
      const cond = await conditionsAt(c.pos.lat, c.pos.lon, c.t);
      if (!cond.pending) { c.cond = cond; await put('catches', c); }
    }
  } finally { backfilling = false; }
}
window.addEventListener('online', () => { updateNet(); backfill(); });
window.addEventListener('offline', updateNet);
function updateNet() { $('#netState').textContent = navigator.onLine ? '' : 'Offline · saving on phone'; }

/* ---------- Now ---------- */
async function loadNow() {
  const body = $('#nowBody');
  $('#nowWhere').textContent = 'Getting your location…';
  const pos = await getPos() || currentPos;
  if (pos) currentPos = pos;
  if (!pos) { $('#nowWhere').textContent = 'Location is off. In iPhone Settings, allow location for Safari (or this app), then tap Refresh.'; body.innerHTML = ''; return; }
  $('#nowWhere').textContent = `${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)} · loading…`;
  const c = await conditionsAt(pos.lat, pos.lon, Date.now());
  const near = (await getAll('spots')).map(s => ({ s, d: distMi(pos, s) })).sort((a, b) => a.d - b.d)[0];
  $('#nowWhere').textContent = near && near.d < 0.5 ? `At ${near.s.name}` : `${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}`;
  const stat = (k, v, s) => `<div class="stat"><div class="k">${k}</div><div class="v">${v ?? '–'}</div><div class="s">${s || ''}</div></div>`;
  let tideHtml = '';
  if (c.tide && c.tide.stage) {
    tideHtml = `<div class="card" style="margin-top:12px;padding:12px">
      <div class="row" style="justify-content:space-between"><strong>${c.tide.stage} tide</strong><span class="muted">${c.tide.nextType} at ${fmtTime(c.tide.nextAt)} · in ${fmtDur(c.tide.nextAt - Date.now())}</span></div>
      <div class="tide-bar" aria-hidden="true"><i style="width:${Math.round(c.tide.frac * 100)}%"></i></div>
      <p class="muted" style="margin:8px 0 0">${c.tide.upcoming.map(p => `${p.type === 'H' ? 'High' : 'Low'} ${fmtTime(p.t)} (${p.v.toFixed(1)} ft)`).join(' · ')}</p>
      <p class="muted" style="margin:4px 0 0">NOAA station: ${esc(c.tide.station)}, ${c.tide.stationMi} mi away</p></div>`;
  }
  body.innerHTML = `<div class="grid">
      ${stat('Water', c.water != null ? c.water + '°F' : null, 'Sea surface')}
      ${stat('Air', c.air != null ? c.air + '°F' : null, c.cloud != null ? c.cloud + '% clouds' : '')}
      ${stat('Wind', c.wind != null ? `${compass(c.windDir)} ${c.wind} kt` : null, c.gust != null ? `Gusts ${c.gust} kt` : '')}
      ${stat('Pressure', c.pressure, c.pressure != null ? `inHg · ${c.pressureTrend.toLowerCase()}` : '')}
      ${stat('Seas', c.waves != null ? c.waves + ' ft' : null, c.wavePeriod != null ? c.wavePeriod + ' s period' : '')}
      ${stat('Moon', c.moon.name, c.moon.illum + '% lit')}
    </div>${tideHtml}${c.pending ? '<p class="note" style="margin-top:12px">No signal right now. Your catches still save, and conditions fill in later.</p>' : ''}`;
}
$('#refreshNow').addEventListener('click', loadNow);

/* ---------- History ---------- */
const objectUrls = [];
async function renderHistory() {
  objectUrls.splice(0).forEach(u => URL.revokeObjectURL(u));
  const list = (await getAll('catches')).sort((a, b) => b.t - a.t);
  const el = $('#historyList');
  if (!list.length) { el.innerHTML = '<p class="empty">No catches yet. Head to Log, tap the mic, and tell it what you caught.</p>'; return; }
  el.innerHTML = list.map(c => {
    let img = '<div class="thumb" aria-hidden="true"></div>';
    if (c.photo) { const u = URL.createObjectURL(c.photo); objectUrls.push(u); img = `<img class="thumb" src="${u}" alt="Catch photo">`; }
    const fish = c.fish && c.fish.length ? c.fish.map(f => `${f.species}${f.count > 1 ? ' ×' + f.count : ''}`).join(', ') : 'Catch';
    const size = [c.length ? c.length + '"' : '', c.weight ? c.weight + ' lb' : ''].filter(Boolean).join(' · ');
    return `<div class="catch">${img}<div>
      <div class="t">${esc(fish)}${size ? ` <span class="muted">· ${esc(size)}</span>` : ''}</div>
      <div class="muted">${esc(c.spotName || (c.pos ? `${c.pos.lat.toFixed(3)}, ${c.pos.lon.toFixed(3)}` : 'No location'))} · ${fmtDate(c.t)} ${fmtTime(c.t)}</div>
      ${c.bait || c.kept ? `<div class="muted">${esc([c.bait, c.kept].filter(Boolean).join(' · '))}</div>` : ''}
      <div class="chips" style="margin-top:6px">${condChips(c.cond)}</div>
      <details style="margin-top:6px"><summary>Note and options</summary><p class="muted">${esc(c.note || '')}</p><button class="small ghost" data-del="${esc(c.id)}" type="button">Delete catch</button></details>
    </div></div>`;
  }).join('');
}
$('#historyList').addEventListener('click', async e => {
  const id = e.target.dataset && e.target.dataset.del;
  if (!id) return;
  if (e.target.dataset.confirm !== '1') { e.target.dataset.confirm = '1'; e.target.textContent = 'Tap again to delete'; return; }
  await remove('catches', id); renderHistory(); toast('Catch deleted.');
});

/* ---------- Spots ---------- */
const BRAND_HELP = {
  garmin: '<strong>Wireless:</strong> install the free Garmin ActiveCaptain app, connect it to your chartplotter over Wi-Fi, and sync. Then export your waypoints as a GPX file and Share it to Files.<br><strong>SD card:</strong> on the unit, open User Data, export to the card as GPX, then plug the card into your iPhone with a card reader.',
  lowrance: '<strong>Wireless:</strong> in the Lowrance (or Simrad) app, sync with your display, then export waypoints as GPX and save to Files.<br><strong>SD card:</strong> on the unit, open Waypoints, choose Export, and pick GPX if offered (USR files are coming soon here).',
  humminbird: 'Humminbird exports by SD card only. Insert a blank card, open the Nav menu, and export your waypoints. Humminbird saves .HWR files, which this app cannot read yet. Convert to GPX with HumminbirdPC on a computer for now.',
  raymarine: 'Insert an SD card, open My Data, choose Import/Export, and save your waypoints to the card as GPX. Plug the card into your iPhone with a card reader.',
};
$('#brand').addEventListener('change', e => {
  const h = BRAND_HELP[e.target.value];
  $('#brandHelp').hidden = !h; $('#brandHelp').innerHTML = h || '';
});

$('#gpx').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  const msg = $('#importMsg');
  try {
    if (!/\.gpx$/i.test(f.name)) { msg.textContent = 'That file is not a GPX file. GPX works today; USR and HWR are coming.'; return; }
    const pts = RP.parseGPX(await f.text());
    if (!pts.length) { msg.textContent = 'No waypoints found in that file.'; return; }
    const existing = await getAll('spots');
    const key = s => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`;
    const have = new Set(existing.map(key));
    const fresh = pts.filter(p => !have.has(key(p))).map(p => {
      const g = RP.guessType(p.name, p.sym);
      return { id: uid(), name: p.name, lat: p.lat, lon: p.lon, sym: p.sym, note: p.note, type: g.type, typeHow: g.how, depthFt: null, zone: '', source: 'import', added: Date.now() };
    });
    await putMany('spots', fresh);
    const typed = fresh.filter(s => s.type).length;
    msg.textContent = `Imported ${fresh.length} spots (${pts.length - fresh.length} already saved). Tagged ${typed} from their names and icons. Looking up depths…`;
    renderSpots();
    guessDepths(fresh).then(n => { msg.textContent = `Imported ${fresh.length} spots. Tagged ${typed} by name or icon, and sorted ${n} by depth into inshore, nearshore, or offshore.`; renderSpots(); });
  } catch (err) { msg.textContent = 'Could not read that file. Make sure it is a GPX export.'; }
  finally { e.target.value = ''; }
});

async function depthAt(lat, lon) {
  const u = `https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.json?altitude%5B(${lat})%5D%5B(${lon})%5D`;
  const j = await fetchJSON(u, 20000);
  const alt = j.table.rows[0][2];
  return alt < 0 ? Math.round(-alt * 3.281) : 0;
}
async function guessDepths(spots) {
  let done = 0, i = 0;
  const queue = spots.slice(0, 400);
  async function worker() {
    while (i < queue.length) {
      const s = queue[i++];
      try { s.depthFt = await depthAt(s.lat, s.lon); s.zone = RP.zoneFromDepth(s.depthFt); await put('spots', s); done++; } catch (err) { /* leave unknown */ }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return done;
}

$('#addHere').addEventListener('click', async () => {
  const pos = await refreshPos();
  if (!pos) { toast('Location is off. Allow location for Safari in Settings.'); return; }
  const n = (await getAll('spots')).length + 1;
  const s = { id: uid(), name: `My spot ${n}`, lat: pos.lat, lon: pos.lon, type: '', typeHow: '', depthFt: null, zone: '', source: 'pin', added: Date.now() };
  await put('spots', s);
  toast('Spot saved. Rename it below.');
  renderSpots();
  guessDepths([s]).then(renderSpots);
});

const TYPE_OPTIONS = ['', 'Flat', 'Oyster bed', 'Mangrove line', 'Dock / bridge', 'River / creek', 'Artificial reef', 'Ledge / hard bottom', 'Wreck', 'Rig / platform', 'Other'];
async function renderSpots() {
  const all = await getAll('spots');
  const q = $('#spotFilter').value.trim().toLowerCase();
  const pos = currentPos;
  let list = all.filter(s => !q || s.name.toLowerCase().includes(q) || (s.type || '').toLowerCase().includes(q) || (s.zone || '').toLowerCase().includes(q));
  list = pos ? list.map(s => ({ s, d: distMi(pos, s) })).sort((a, b) => a.d - b.d) : list.sort((a, b) => a.name.localeCompare(b.name)).map(s => ({ s, d: null }));
  $('#spotCount').textContent = `${all.length} saved`;
  const el = $('#spotList');
  if (!all.length) { el.innerHTML = '<p class="empty">No spots yet. Import a file from your boat unit, or tap "Save this spot" when you are on the water.</p>'; return; }
  const shown = list.slice(0, 150);
  el.innerHTML = shown.map(({ s, d }) => `<div class="spot">
      <div><input value="${esc(s.name)}" data-rename="${esc(s.id)}" aria-label="Spot name" style="padding:6px 8px;font-weight:600"></div>
      <select data-type="${esc(s.id)}" aria-label="Spot type">${TYPE_OPTIONS.map(o => `<option${o === (s.type || '') ? ' selected' : ''} value="${esc(o)}">${o || 'Type?'}</option>`).join('')}</select>
      <div class="chips" style="grid-column:1/-1">
        ${s.zone ? `<span class="chip">${esc(s.zone)}${s.depthFt ? ' · ~' + s.depthFt + ' ft' : ''}</span>` : ''}
        ${s.type && s.typeHow && s.typeHow !== 'you' ? `<span class="chip">Guessed from ${esc(s.typeHow)}</span>` : ''}
        ${d != null ? `<span class="chip">${d < 10 ? d.toFixed(1) : Math.round(d)} mi away</span>` : ''}
        <button class="small ghost" data-delspot="${esc(s.id)}" type="button" style="margin-left:auto">Delete</button>
      </div></div>`).join('') + (list.length > shown.length ? `<p class="muted">Showing the closest 150 of ${list.length}. Search to find others.</p>` : '');
}
$('#spotFilter').addEventListener('input', () => renderSpots());
$('#spotList').addEventListener('change', async e => {
  const all = await getAll('spots');
  if (e.target.dataset.type) {
    const s = all.find(x => x.id === e.target.dataset.type); if (!s) return;
    s.type = e.target.value; s.typeHow = 'you'; await put('spots', s); renderSpots();
  } else if (e.target.dataset.rename) {
    const s = all.find(x => x.id === e.target.dataset.rename); if (!s) return;
    s.name = e.target.value.trim() || s.name; await put('spots', s);
  }
});
$('#spotList').addEventListener('click', async e => {
  const id = e.target.dataset && e.target.dataset.delspot;
  if (!id) return;
  if (e.target.dataset.confirm !== '1') { e.target.dataset.confirm = '1'; e.target.textContent = 'Tap again'; return; }
  await remove('spots', id); renderSpots();
});

/* ---------- Backup ---------- */
function blobToDataURL(b) { return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }
$('#exportBtn').addEventListener('click', async () => {
  const catches = await getAll('catches');
  const out = [];
  for (const c of catches) out.push({ ...c, photo: c.photo ? await blobToDataURL(c.photo) : null });
  const data = { app: 'Reel Pattern', version: 1, exported: new Date().toISOString(), catches: out, spots: await getAll('spots') };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = `reel-pattern-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Reel Pattern backup' }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
$('#restore').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || !Array.isArray(data.catches) || !Array.isArray(data.spots)) throw new Error('bad');
    const catches = [];
    for (const c of data.catches) catches.push({ ...c, photo: c.photo ? await dataURLToBlob(c.photo) : null });
    await putMany('spots', data.spots); await putMany('catches', catches);
    toast(`Restored ${catches.length} catches and ${data.spots.length} spots.`);
    renderSpots();
  } catch (err) { toast('That file is not a Reel Pattern backup.'); }
  finally { e.target.value = ''; }
});

/* ---------- Start ---------- */
updateNet();
refreshPos().then(() => { if (note.value.trim()) onNoteChange(); });
backfill();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
