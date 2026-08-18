/* Local-first matchmaking app.
   Data lives in a plain JSON file on your Mac (put it in an iCloud/Dropbox folder
   to share between computers). In Chrome/Edge the app opens and auto-saves the file
   directly (File System Access API); other browsers load a copy and save via download.
   Includes WhatsApp ZIP import, photos, and Excel import/export. */
'use strict';

const STATUS_LABELS = { proposed: 'הוצע', in_progress: 'בתהליך', accepted: 'יצא לפועל', rejected: 'נדחה' };
const GENDER_HE = { male: 'זכר', female: 'נקבה' };
const XLSX_HEADERS = ['ID', 'שם', 'גיל', 'מין', 'גובה', 'רמה דתית', 'מיקום', 'טלפון', 'עיסוק',
  'סטטוס', 'עדה', 'VIP', 'תכירו', 'תיאור', 'מחפש/ת', 'ממליצים', 'תמונות'];
const XLSX_FIELD = { 'שם': 'name', 'גיל': 'age', 'מין': 'gender', 'גובה': 'height', 'רמה דתית': 'religious_level',
  'מיקום': 'location', 'טלפון': 'phone', 'עיסוק': 'occupation', 'סטטוס': 'marital_status', 'עדה': 'ethnicity',
  'תיאור': 'description', 'מחפש/ת': 'looking_for', 'ממליצים': 'references' };
const FSA = 'showOpenFilePicker' in window;

const state = {
  data: { candidates: [], matches: [], ai: {} },
  view: 'candidates', admin: false, filters: {}, sort: 'score', aiVipOnly: false,
  fileHandle: null, fileName: '', saveTimer: null, loaded: false,
};

// ---------- tiny helpers ----------
const $ = (s, r = document) => r.querySelector(s);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2400); }
function candById(id) { return state.data.candidates.find(c => c.id === id); }
function nextId() { return state.data.candidates.reduce((m, c) => Math.max(m, c.id || 0), 0) + 1; }
function genderIcon(g) { return g === 'female' ? '👩' : g === 'male' ? '👨' : '👤'; }
function photoStyle(c) { return (c.photos && c.photos.length) ? `background-image:url('${esc(c.photos[0])}')` : ''; }
function stripAge(n) { return String(n).replace(/\s*\(\d+\)\s*$/, '').trim(); }
function findByName(name) {
  name = String(name).trim();
  return state.data.candidates.find(c => c.name === name) || state.data.candidates.find(c => (c.name || '').startsWith(name)) || null;
}

function resizeToDataURL(blobOrFile, maxDim = 1000, quality = 0.82) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blobOrFile);
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > maxDim || h > maxDim) { if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; } else { w = Math.round(w * maxDim / h); h = maxDim; } }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url); resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// ---------- IndexedDB: remember the last file handle ----------
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('shidduchim', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', mode);
      const store = tx.objectStore('kv');
      const r = fn(store);
      tx.oncomplete = () => resolve(r && r.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const idbGet = k => idb('readonly', s => s.get(k)).catch(() => null);
const idbSet = (k, v) => idb('readwrite', s => s.put(v, k)).catch(() => {});

// ---------- file open / save ----------
const JSON_TYPES = [{ description: 'JSON', accept: { 'application/json': ['.json'] } }];

async function verifyPermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}
function normalizeData(d) {
  return { candidates: d.candidates || [], matches: d.matches || [], ai: d.ai || {},
    todo: d.todo || [], tasks: d.tasks || [] };
}
function nextItemId(list) { return (list || []).reduce((m, x) => Math.max(m, x.id || 0), 0) + 1; }
async function loadFromHandle(handle) {
  if (!(await verifyPermission(handle))) { toast('לא ניתנה הרשאה לקובץ'); return false; }
  const file = await handle.getFile();
  const text = await file.text();
  state.data = normalizeData(text.trim() ? JSON.parse(text) : {});
  state.fileHandle = handle; state.fileName = handle.name;
  await idbSet('handle', handle);
  enterApp(); return true;
}
async function openDatabase() {
  try { const [h] = await window.showOpenFilePicker({ types: JSON_TYPES }); await loadFromHandle(h); }
  catch (e) { if (e.name !== 'AbortError') toast('פתיחה נכשלה: ' + e.message); }
}
async function newDatabase() {
  try {
    const h = await window.showSaveFilePicker({ suggestedName: 'shidduchim.json', types: JSON_TYPES });
    state.data = { candidates: [], matches: [], ai: {}, todo: [], tasks: [] };
    state.fileHandle = h; state.fileName = h.name;
    await saveNow(); await idbSet('handle', h);
    state.admin = true; enterApp();
  } catch (e) { if (e.name !== 'AbortError') toast('יצירה נכשלה: ' + e.message); }
}
function openFallback() { $('#open-fallback').click(); }
function loadFallbackFile(file) {
  const rd = new FileReader();
  rd.onload = () => { try { state.data = normalizeData(JSON.parse(rd.result)); state.fileHandle = null; state.fileName = file.name; enterApp(); } catch (e) { toast('קובץ לא תקין'); } };
  rd.readAsText(file);
}
function downloadJSON() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = state.fileName || 'shidduchim.json'; a.click(); URL.revokeObjectURL(a.href);
  setStatus('נשמר ✓');
}
async function saveNow() {
  if (!state.fileHandle) { setStatus('לא נשמר — הורד/י גיבוי'); return; }
  try {
    const w = await state.fileHandle.createWritable();
    await w.write(JSON.stringify(state.data, null, 2)); await w.close();
    setStatus('נשמר ✓');
  } catch (e) { setStatus('שמירה נכשלה'); toast('שמירה נכשלה: ' + e.message); }
}
function setStatus(t) { const s = $('#save-status'); if (s) s.textContent = t; }
function markDirty() {
  renderNav();
  if (state.fileHandle) {
    setStatus('שומר…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 700);
  } else setStatus('לא נשמר — הורד/י גיבוי');
}

// ---------- start screen ----------
async function initStart() {
  const note = $('#start-note');
  if (!FSA) note.innerHTML = 'הדפדפן הזה לא תומך בשמירה אוטומטית לקובץ. מומלץ <b>Chrome</b>. אפשר עדיין לצפות/לערוך ולשמור עם כפתור הורדה.';
  else note.innerHTML = 'טיפ: שמור/י את הקובץ בתיקיית <b>iCloud Drive</b> משותפת — כך שני המחשבים רואים את אותו מאגר.';
  $('#btn-open').onclick = FSA ? openDatabase : openFallback;
  $('#btn-new').onclick = FSA ? newDatabase : () => { state.data = { candidates: [], matches: [], ai: {} }; state.fileHandle = null; state.fileName = 'shidduchim.json'; state.admin = true; enterApp(); };
  $('#btn-demo').onclick = () => { state.data = JSON.parse(JSON.stringify(SAMPLE)); state.fileHandle = null; state.fileName = ''; enterApp(); };
  $('#open-fallback').onchange = e => { if (e.target.files[0]) loadFallbackFile(e.target.files[0]); };
  if (FSA) {
    const h = await idbGet('handle');
    if (h) {
      const btn = $('#btn-resume');
      btn.textContent = '↩︎ המשך: ' + h.name;
      btn.classList.remove('hidden');
      btn.onclick = () => loadFromHandle(h);
    }
  }
}

function enterApp() {
  state.loaded = true;
  $('#start').classList.add('hidden');
  $('#app').classList.remove('hidden');
  setStatus(state.fileHandle ? 'נשמר ✓' : (state.fileName ? 'תצוגה — לשמירה הורד/י גיבוי' : 'נתוני דוגמה'));
  renderNav(); render();
}

// ---------- nav ----------
function renderNav() {
  document.querySelectorAll('.nav .tab[data-view]').forEach(t => t.classList.toggle('active', t.dataset.view === state.view));
  const a = $('#admin-toggle'); a.textContent = state.admin ? '🔧 ניהול פעיל' : '🔧 ניהול'; a.classList.toggle('active', state.admin);
}
document.querySelectorAll('.nav .tab[data-view]').forEach(t => t.addEventListener('click', () => { state.view = t.dataset.view; renderNav(); render(); }));
$('#admin-toggle').addEventListener('click', () => { state.admin = !state.admin; renderNav(); render(); });
$('#close-btn').addEventListener('click', () => location.reload());

// ---------- render ----------
function render() {
  const m = $('#main');
  m.innerHTML = state.view === 'candidates' ? viewCandidates()
    : state.view === 'matches' ? viewMatches()
    : state.view === 'ai' ? viewAI()
    : state.view === 'todo' ? viewTodo()
    : viewTasks();
  wire();
}

function cardHTML(c) {
  return `<div class="c-card" data-action="open" data-id="${c.id}">
    <div class="c-photo" style="${photoStyle(c)}">${(c.photos && c.photos.length) ? '' : genderIcon(c.gender)}
      <div class="badges">${c.vip ? '<span class="pill vip">VIP</span>' : ''}${c.takiru ? '<span class="pill takiru">תכירו</span>' : ''}</div></div>
    <div class="c-body"><div class="c-name">${esc(c.name)}</div>
      <div class="c-meta">${c.age || ''}${c.gender ? ` · <span class="pill gender-${c.gender}">${GENDER_HE[c.gender]}</span>` : ''}</div>
      <div class="c-meta">${esc(c.religious_level || '')}${c.location ? ' · ' + esc(c.location) : ''}</div></div>
  </div>`;
}

function filteredCandidates() {
  const f = state.filters;
  return state.data.candidates.filter(c => {
    if (f.name && !(c.name || '').includes(f.name)) return false;
    if (f.gender && c.gender !== f.gender) return false;
    if (f.religious && !(c.religious_level || '').includes(f.religious)) return false;
    if (f.location && !(c.location || '').includes(f.location)) return false;
    if (f.ethnicity && !(c.ethnicity || '').includes(f.ethnicity)) return false;
    if (f.age_min && !(c.age >= f.age_min)) return false;
    if (f.age_max && !(c.age <= f.age_max)) return false;
    if (f.height_min && !(c.height >= f.height_min)) return false;
    if (f.height_max && !(c.height <= f.height_max)) return false;
    if (f.vip && !c.vip) return false;
    return true;
  });
}

function viewCandidates() {
  const list = filteredCandidates(), f = state.filters;
  const admin = state.admin ? `
    <button class="btn ok sm" data-action="new">+ מועמד/ת</button>
    <button class="btn sm" data-action="import-zip">📦 ייבוא וואטסאפ</button>
    <button class="btn secondary sm" data-action="xls-cands-in">⬆ ייבוא אקסל מועמדים</button>
    <button class="btn secondary sm" data-action="xls-matches-in">⬆ ייבוא אקסל הצעות</button>
    <button class="btn ghost sm" data-action="xls-cands-out">⬇ ייצוא אקסל</button>
    ${!state.fileHandle ? '<button class="btn warn sm" data-action="download">💾 שמור קובץ</button>' : ''}
    <input id="zip-file" type="file" accept=".zip" class="hidden">
    <input id="xls-cands-file" type="file" accept=".xlsx" class="hidden">
    <input id="xls-matches-file" type="file" accept=".xlsx" class="hidden">` : '';
  const cards = list.map(cardHTML).join('');
  return `
    <div class="page-head"><h1>מועמדים</h1><span class="subtle">${list.length} מוצגים</span>
      <span class="spacer"></span>${admin}</div>
    <form class="card" id="filter-form"><div class="filters">
      <label class="field">שם<input name="name" value="${esc(f.name || '')}"></label>
      <label class="field">מין<select name="gender"><option value="">הכל</option>
        <option value="male" ${f.gender === 'male' ? 'selected' : ''}>זכר</option>
        <option value="female" ${f.gender === 'female' ? 'selected' : ''}>נקבה</option></select></label>
      <label class="field">רמה דתית<input name="religious" value="${esc(f.religious || '')}"></label>
      <label class="field">מיקום<input name="location" value="${esc(f.location || '')}"></label>
      <label class="field">עדה<input name="ethnicity" value="${esc(f.ethnicity || '')}"></label>
      <label class="field">גיל מ־<input name="age_min" type="number" value="${f.age_min || ''}"></label>
      <label class="field">גיל עד<input name="age_max" type="number" value="${f.age_max || ''}"></label>
      <label class="field">גובה מ־<input name="height_min" type="number" value="${f.height_min || ''}"></label>
      <label class="field">גובה עד<input name="height_max" type="number" value="${f.height_max || ''}"></label>
      <label class="field">VIP<span style="display:flex;align-items:center;height:38px"><input name="vip" type="checkbox" ${f.vip ? 'checked' : ''} style="width:auto"> <span style="margin-inline-start:6px" class="subtle">רק VIP</span></span></label>
    </div></form>
    ${list.length ? `<div class="grid">${cards}</div>` : '<div class="card empty">אין מועמדים תואמים.</div>'}`;
}

function viewMatches() {
  const rows = state.data.matches.map((m, i) => {
    const a = candById(m.a), b = candById(m.b); if (!a || !b) return '';
    const sel = Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${v}</option>`).join('');
    return `<tr>
      <td><a data-action="open" data-id="${a.id}" href="#">${esc(a.name)}</a></td>
      <td><a data-action="open" data-id="${b.id}" href="#">${esc(b.name)}</a></td>
      <td>${state.admin ? `<select data-action="status" data-idx="${i}">${sel}</select>` : esc(STATUS_LABELS[m.status] || m.status)}</td>
      <td class="subtle">${esc(m.notes || '')}</td>
      <td>${state.admin ? `<button class="btn danger sm" data-action="del-match" data-idx="${i}">מחק</button>` : ''}</td></tr>`;
  }).join('');
  return `<div class="page-head"><h1>שידוכים</h1><span class="subtle">${state.data.matches.length} הצעות</span></div>
    ${state.data.matches.length ? `<div class="card"><table><thead><tr><th>צד א׳</th><th>צד ב׳</th><th>סטטוס</th><th>הערה</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="card empty">אין הצעות שידוך.</div>'}`;
}

function viewAI() {
  const groups = Object.keys(state.data.ai).map(cid => {
    const c = candById(Number(cid)); if (!c) return null;
    if (state.aiVipOnly && !c.vip) return null;
    const sugg = (state.data.ai[cid] || []).slice().sort((x, y) => (y.score || 0) - (x.score || 0));
    return { c, sugg };
  }).filter(Boolean);
  if (state.sort === 'name') groups.sort((a, b) => (a.c.name || '').localeCompare(b.c.name || '', 'he'));
  else if (state.sort === 'age') groups.sort((a, b) => (a.c.age || 99) - (b.c.age || 99));
  else groups.sort((a, b) => Math.max(...b.sugg.map(s => s.score || 0), 0) - Math.max(...a.sugg.map(s => s.score || 0), 0));
  const chips = ['score', 'name', 'age'].map(s => `<button class="chip ${state.sort === s ? 'active' : ''}" data-action="sort" data-sort="${s}">${{ score: 'ציון', name: 'שם', age: 'גיל' }[s]}</button>`).join('');
  const body = groups.map(g => `<div class="card">
    <h2><a data-action="open" data-id="${g.c.id}" href="#">${esc(g.c.name)}</a> ${g.c.age ? `<span class="subtle">(${g.c.age})</span>` : ''}</h2>
    <table><thead><tr><th>הצעה</th><th>גיל</th><th>ציון</th><th>נימוק</th><th></th></tr></thead><tbody>
    ${g.sugg.map(s => { const t = candById(s.id); if (!t) return ''; const sc = s.score || 0, cl = sc >= 8 ? 'high' : sc >= 6 ? 'mid' : 'low';
      return `<tr><td><a data-action="open" data-id="${t.id}" href="#">${esc(t.name)}</a></td><td>${t.age || ''}</td>
        <td><span class="score ${cl}">${sc}</span></td><td class="subtle">${esc(s.reason || '')}</td>
        <td class="row-actions">${state.admin ? `<button class="btn ok sm" data-action="mk-match" data-a="${g.c.id}" data-b="${t.id}">שדך</button><button class="btn danger sm" data-action="ai-del" data-cid="${g.c.id}" data-sid="${t.id}">✕ מחק</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div>`).join('');
  return `<div class="page-head"><h1>התאמות</h1><span class="subtle">${groups.length} מועמדים</span>
    <span class="spacer"></span>
    <button class="chip ${state.aiVipOnly ? 'active' : ''}" data-action="ai-vip">⭐ VIP בלבד</button>
    <span class="subtle">מיון:</span><div class="chips">${chips}</div>
    ${state.admin && groups.length ? '<button class="btn danger sm" data-action="ai-del-all">🗑 מחק את כל ההתאמות</button>' : ''}</div>
    ${groups.length ? body : '<div class="card empty">אין התאמות. ייבא/י אקסל הצעות (במצב ניהול).</div>'}`;
}

// ---------- people to add (todo list) ----------
function viewTodo() {
  const list = state.data.todo || [];
  const addForm = state.admin ? `
    <form class="card" id="todo-form"><div class="filters">
      <label class="field" style="flex:2">שם<input name="name" placeholder="שם האדם" required></label>
      <label class="field" style="flex:3">הערה / מאיפה<input name="note" placeholder="טלפון, ממליץ, פרטים..."></label>
      <label class="field">&nbsp;<button class="btn ok" type="submit">הוסף לרשימה</button></label>
    </div></form>` : '';
  const rows = list.map(t => `<tr style="${t.done ? 'opacity:.5' : ''}">
    <td><input type="checkbox" data-action="todo-done" data-id="${t.id}" ${t.done ? 'checked' : ''} style="width:auto" ${state.admin ? '' : 'disabled'}></td>
    <td style="${t.done ? 'text-decoration:line-through' : 'font-weight:600'}">${esc(t.name)}</td>
    <td class="subtle">${esc(t.note || '')}</td>
    <td class="row-actions">${state.admin ? `<button class="btn ok sm" data-action="todo-to-cand" data-id="${t.id}">➕ הוסף כמועמד</button><button class="btn danger sm" data-action="todo-del" data-id="${t.id}">מחק</button>` : ''}</td>
  </tr>`).join('');
  const open = list.filter(t => !t.done).length;
  return `<div class="page-head"><h1>אנשים להוסיף</h1><span class="subtle">${open} ממתינים${list.length - open ? ` · ${list.length - open} טופלו` : ''}</span></div>
    ${addForm}
    ${list.length ? `<div class="card"><table><thead><tr><th></th><th>שם</th><th>הערה</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="card empty">הרשימה ריקה. הוסף/י אנשים שכדאי להכניס למאגר.</div>'}`;
}

// ---------- tasks (to-do) ----------
function viewTasks() {
  const list = state.data.tasks || [];
  const addForm = state.admin ? `
    <form class="card" id="task-form"><div class="filters">
      <label class="field" style="flex:5">משימה חדשה<input name="text" placeholder="מה צריך לעשות?" required></label>
      <label class="field">&nbsp;<button class="btn ok" type="submit">הוסף</button></label>
    </div></form>` : '';
  const rows = list.map(t => `<tr style="${t.done ? 'opacity:.5' : ''}">
    <td><input type="checkbox" data-action="task-done" data-id="${t.id}" ${t.done ? 'checked' : ''} style="width:auto" ${state.admin ? '' : 'disabled'}></td>
    <td style="${t.done ? 'text-decoration:line-through' : ''}">${esc(t.text)}</td>
    <td class="row-actions">${state.admin ? `<button class="btn danger sm" data-action="task-del" data-id="${t.id}">מחק</button>` : ''}</td>
  </tr>`).join('');
  const open = list.filter(t => !t.done).length;
  return `<div class="page-head"><h1>משימות</h1><span class="subtle">${open} פתוחות${list.length - open ? ` · ${list.length - open} בוצעו` : ''}</span></div>
    ${addForm}
    ${list.length ? `<div class="card"><table><tbody>${rows}</tbody></table></div>` : '<div class="card empty">אין משימות. הוסף/י מה שצריך לעשות.</div>'}`;
}

// ---------- candidate detail ----------
function openCandidate(id) {
  const c = candById(id); if (!c) return;
  const kv = [['גיל', c.age], ['מין', GENDER_HE[c.gender]], ['גובה', c.height ? c.height + ' ס״מ' : ''], ['רמה דתית', c.religious_level],
    ['מיקום', c.location], ['עדה', c.ethnicity], ['סטטוס', c.marital_status], ['עיסוק', c.occupation], ['טלפון', c.phone], ['ממליצים', c.references]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  const ai = (state.data.ai[id] || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const aiHtml = ai.length ? `<hr><h2>התאמות</h2><table><tbody>${ai.map(s => { const t = candById(s.id); if (!t) return ''; const sc = s.score || 0, cl = sc >= 8 ? 'high' : sc >= 6 ? 'mid' : 'low';
    return `<tr><td><a data-action="open" data-id="${t.id}" href="#">${esc(t.name)}</a> ${t.age ? '(' + t.age + ')' : ''}</td><td><span class="score ${cl}">${sc}</span></td><td class="subtle">${esc(s.reason || '')}</td><td>${state.admin ? `<button class="btn ok sm" data-action="mk-match" data-a="${id}" data-b="${t.id}">שדך</button>` : ''}</td></tr>`; }).join('')}</tbody></table>` : '';
  const partners = state.data.matches.filter(m => m.a === id || m.b === id).map(m => { const o = candById(m.a === id ? m.b : m.a); return o ? esc(o.name) + ' · ' + (STATUS_LABELS[m.status] || m.status) : ''; }).filter(Boolean);
  const matchesHtml = partners.length ? `<hr><h2>שידוכים</h2><ul>${partners.map(p => `<li>${p}</li>`).join('')}</ul>` : '';
  const photos = (c.photos && c.photos.length > 1) ? `<hr><h2>תמונות</h2><div class="photo-strip">${c.photos.map(p => `<img src="${esc(p)}" style="width:90px;height:90px;object-fit:cover;border-radius:10px;border:1px solid var(--line)">`).join('')}</div>` : '';
  const adminBtns = state.admin ? `<button class="btn secondary sm" data-action="edit" data-id="${id}">✎ עריכה</button><button class="btn danger sm" data-action="del-cand" data-id="${id}">מחק</button>` : '';
  const mainPhoto = (c.photos && c.photos.length) ? `center/cover no-repeat url('${esc(c.photos[0])}')` : 'linear-gradient(135deg,#eef1f8,#e3e8f5)';
  showModal(`<div class="modal-head"><h2 style="margin:0">${esc(c.name)}</h2>${c.vip ? '<span class="pill vip">VIP</span>' : ''}${c.takiru ? '<span class="pill takiru">תכירו</span>' : ''}<span class="spacer"></span>${adminBtns}<button class="x" data-action="close">✕</button></div>
    <div class="modal-body"><div style="display:flex;gap:18px;flex-wrap:wrap">
      <div style="width:180px;height:210px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:4rem;color:#b9c0d4;background:${mainPhoto}">${(c.photos && c.photos.length) ? '' : genderIcon(c.gender)}</div>
      <dl class="kv" style="flex:1;min-width:220px">${kv}</dl></div>
      ${c.description ? `<hr><h2>תיאור</h2><div class="prose">${esc(c.description)}</div>` : ''}
      ${c.looking_for ? `<hr><h2>מה מחפש/ת</h2><div class="prose">${esc(c.looking_for)}</div>` : ''}
      ${aiHtml}${matchesHtml}${photos}
      ${state.admin ? `<hr><form id="mk-match-form" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap"><label class="field" style="flex:1;min-width:200px">צור שידוך עם<select name="other">
        <option value="">בחר/י…</option>${state.data.candidates.filter(o => o.id !== id && o.gender !== c.gender).map(o => `<option value="${o.id}">${esc(o.name)}${o.age ? ' (' + o.age + ')' : ''}</option>`).join('')}
      </select></label><button class="btn" type="submit">צור</button></form>` : ''}
    </div>`);
  const mf = $('#mk-match-form');
  if (mf) mf.addEventListener('submit', e => { e.preventDefault(); const oid = Number(new FormData(e.target).get('other')); if (oid) { mkMatch(id, oid); closeModal(); } });
}

// ---------- editor ----------
const FORM_FIELDS = [['name', 'שם מלא *', 'text'], ['gender', 'מין', 'gender'], ['age', 'גיל', 'number'], ['height', 'גובה (ס״מ)', 'number'],
  ['religious_level', 'רמה דתית', 'text'], ['location', 'מיקום', 'text'], ['ethnicity', 'עדה', 'text'], ['marital_status', 'סטטוס', 'text'],
  ['occupation', 'עיסוק', 'text'], ['phone', 'טלפון', 'text'], ['description', 'תיאור', 'area'], ['looking_for', 'מה מחפש/ת', 'area'], ['references', 'ממליצים', 'text']];
let editorPhotos = [];
function renderEditorPhotos() {
  const s = $('#editor-photos'); if (!s) return;
  s.innerHTML = editorPhotos.map((src, i) => `<div style="position:relative"><img src="${src}" style="width:90px;height:90px;object-fit:cover;border-radius:10px;border:1px solid var(--line)"><button type="button" class="x" data-action="rm-photo" data-i="${i}" style="position:absolute;top:-6px;inset-inline-start:-6px;width:24px;height:24px;font-size:.8rem">✕</button></div>`).join('') || '<span class="subtle">אין תמונות</span>';
}
function openEditor(id, prefill) {
  const c = id ? candById(id) : (prefill || {});
  editorPhotos = (c.photos || []).slice();
  const fields = FORM_FIELDS.map(([k, label, type]) => {
    const v = c[k] == null ? '' : c[k]; let input;
    if (type === 'area') input = `<textarea name="${k}">${esc(v)}</textarea>`;
    else if (type === 'gender') input = `<select name="gender"><option value="">—</option><option value="male" ${v === 'male' ? 'selected' : ''}>זכר</option><option value="female" ${v === 'female' ? 'selected' : ''}>נקבה</option></select>`;
    else input = `<input name="${k}" type="${type}" value="${esc(v)}">`;
    return `<label class="field ${type === 'area' ? 'full' : ''}">${label}${input}</label>`;
  }).join('');
  showModal(`<div class="modal-head"><h2 style="margin:0">${id ? 'עריכת ' + esc(c.name) : 'מועמד/ת חדש/ה'}</h2><span class="spacer"></span><button class="x" data-action="close">✕</button></div>
    <div class="modal-body"><form id="cand-form"><div class="form-grid">${fields}
      <label class="field full"><div style="display:flex;gap:16px;align-items:center;margin-top:6px">
        <label class="inline"><input type="checkbox" name="vip" ${c.vip ? 'checked' : ''} style="width:auto"> VIP</label>
        <label class="inline"><input type="checkbox" name="takiru" ${c.takiru ? 'checked' : ''} style="width:auto"> תכירו</label></div></label>
      <label class="field full">תמונות<input id="editor-photo-input" type="file" accept="image/*" multiple>
        <div id="editor-photos" class="photo-strip" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px"></div></label>
    </div><hr><button class="btn ok" type="submit">${id ? 'שמור' : 'הוסף'}</button></form></div>`);
  renderEditorPhotos();
  $('#editor-photo-input').addEventListener('change', async e => { for (const f of e.target.files) { const d = await resizeToDataURL(f); if (d) editorPhotos.push(d); } renderEditorPhotos(); });
  $('#cand-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const obj = id ? candById(id) : { id: nextId(), photos: [] };
    for (const [k] of FORM_FIELDS) { let v = fd.get(k); if (k === 'age' || k === 'height') v = v ? parseInt(v, 10) : null; obj[k] = v; }
    obj.vip = fd.get('vip') === 'on'; obj.takiru = fd.get('takiru') === 'on'; obj.photos = editorPhotos.slice();
    if (!obj.name) { toast('חובה להזין שם'); return; }
    if (!id) state.data.candidates.push(obj);
    if (!id && state._todoConvertId != null) {   // came from "add as candidate"
      const t = (state.data.todo || []).find(x => x.id === state._todoConvertId);
      if (t) t.done = true;
      state._todoConvertId = null;
    }
    markDirty(); closeModal(); render(); toast(id ? 'עודכן' : 'נוסף');
  });
}

// ---------- modal ----------
function showModal(html) { $('#modal-root').innerHTML = `<div class="modal-bg" data-action="backdrop"><div class="modal">${html}</div></div>`; }
function closeModal() { $('#modal-root').innerHTML = ''; }

// ---------- matches ----------
function mkMatch(a, b) {
  if (a === b) return;
  if (state.data.matches.some(m => (m.a === a && m.b === b) || (m.a === b && m.b === a))) { toast('כבר קיים'); return; }
  state.data.matches.push({ a, b, status: 'proposed', notes: '' });
  markDirty(); toast('נוצרה הצעת שידוך');
}

// ---------- WhatsApp ZIP import ----------
let pendingImport = [];
async function handleZipFile(file) {
  toast('קורא…'); let zip;
  try { zip = await JSZip.loadAsync(file); } catch { toast('קובץ ZIP לא תקין'); return; }
  let chatEntry = null;
  zip.forEach((p, e) => { if (/(^|\/)_chat\.txt$/i.test(p) || (/\.txt$/i.test(p) && !chatEntry)) chatEntry = e; });
  if (!chatEntry) { toast('לא נמצא קובץ צ׳אט'); return; }
  const parsed = window.parseWhatsappChat(await chatEntry.async('string'));
  if (!parsed.length) { toast('לא זוהו פרופילים'); return; }
  const byBase = {}; zip.forEach((p, e) => { if (!e.dir) byBase[p.split('/').pop()] = e; });
  const existing = new Set(state.data.candidates.map(c => c.name));
  toast('מעבד תמונות…');
  const results = [];
  for (const p of parsed) {
    const photos = [];
    for (const fn of (p.photos || [])) { const en = byBase[fn] || byBase[fn.split('/').pop()]; if (!en) continue; const d = await resizeToDataURL(await en.async('blob')); if (d) photos.push(d); }
    results.push({ id: null, name: p.name, age: p.age, gender: p.gender, height: p.height, religious_level: p.religious_level, location: p.location, phone: p.phone, occupation: p.occupation, description: p.description, looking_for: p.looking_for, references: p.references, ethnicity: p.ethnicity, marital_status: p.marital_status, vip: false, takiru: false, photos, _dup: existing.has(p.name) });
  }
  pendingImport = results; showImportPreview();
}
function showImportPreview() {
  const rows = pendingImport.map((c, i) => `<tr style="${c._dup ? 'opacity:.5' : ''}">
    <td><input type="checkbox" data-action="imp-toggle" data-i="${i}" ${c._dup ? '' : 'checked'} style="width:auto"></td>
    <td>${c.photos.length ? `<img src="${c.photos[0]}" style="width:44px;height:44px;object-fit:cover;border-radius:8px">` : '👤'}</td>
    <td>${esc(c.name)}${c._dup ? ' <span class="subtle">(קיים)</span>' : ''}</td><td>${c.age || ''}</td>
    <td>${c.gender ? GENDER_HE[c.gender] : '<span class="subtle">?</span>'}</td>
    <td class="subtle">${esc(c.religious_level || '')}${c.location ? ' · ' + esc(c.location) : ''}</td><td>${c.photos.length}📷</td></tr>`).join('');
  const newCount = pendingImport.filter(c => !c._dup).length;
  showModal(`<div class="modal-head"><h2 style="margin:0">ייבוא מוואטסאפ</h2><span class="subtle">זוהו ${pendingImport.length} · ${newCount} חדשים</span><span class="spacer"></span><button class="btn ok sm" data-action="imp-confirm">הוסף מסומנים</button><button class="x" data-action="close">✕</button></div>
    <div class="modal-body" style="max-height:70vh;overflow:auto"><p class="subtle">בדוק/י ובטל/י סימון למי שלא לייבא. כפילויות (לפי שם) מדולגות.</p>
    <table><thead><tr><th></th><th></th><th>שם</th><th>גיל</th><th>מין</th><th>פרטים</th><th>📷</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}
function confirmImport() {
  let added = 0;
  for (const c of pendingImport) {
    if (c._selected === false) continue;
    if (c._selected === undefined && c._dup) continue;
    const { _dup, _selected, ...clean } = c; clean.id = nextId(); state.data.candidates.push(clean); added++;
  }
  pendingImport = []; markDirty(); closeModal(); render(); toast(`נוספו ${added} מועמדים`);
}

// ---------- Excel ----------
function exportCandidatesXlsx() {
  const aoa = [XLSX_HEADERS];
  for (const c of state.data.candidates) aoa.push([
    c.id, c.name, c.age || '', GENDER_HE[c.gender] || '', c.height || '', c.religious_level || '', c.location || '',
    c.phone || '', c.occupation || '', c.marital_status || '', c.ethnicity || '', c.vip ? 'כן' : '', c.takiru ? 'כן' : '',
    c.description || '', c.looking_for || '', c.references || '', (c.photos || []).length]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [8, 22, 6, 8, 7, 16, 16, 14, 22, 12, 14, 6, 6, 44, 36, 26, 8].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'מועמדים');
  XLSX.writeFile(wb, 'candidates.xlsx');
  toast('הורד candidates.xlsx');
}
async function importCandidatesXlsx(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  let created = 0, updated = 0;
  for (const r of rows) {
    const data = {};
    for (const [heb, field] of Object.entries(XLSX_FIELD)) {
      let v = r[heb];
      if (field === 'gender') v = v === 'זכר' ? 'male' : v === 'נקבה' ? 'female' : null;
      else if (field === 'age' || field === 'height') v = v ? parseInt(v, 10) : null;
      data[field] = v === '' ? null : v;
    }
    if (!data.name) continue;
    const vip = ['כן', '1', 'true', 'yes'].includes(String(r['VIP']).trim().toLowerCase());
    const takiru = ['כן', '1', 'true', 'yes'].includes(String(r['תכירו']).trim().toLowerCase());
    const rid = parseInt(r['ID'], 10);
    let c = rid ? candById(rid) : null;
    if (c) { Object.assign(c, data); c.vip = vip; c.takiru = takiru; updated++; }
    else { state.data.candidates.push({ id: rid || nextId(), ...data, vip, takiru, photos: [] }); created++; }
  }
  markDirty(); render(); toast(`אקסל מועמדים: ${created} נוספו, ${updated} עודכנו`);
}
async function importMatchesXlsx(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false });
  let added = 0; const notFound = new Set();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row || !row[0]) continue;
    const main = findByName(stripAge(row[0])); if (!main) { notFound.add(stripAge(row[0])); continue; }
    const picks = [];
    for (let i = 1; i < row.length; i += 2) {
      if (!row[i]) continue;
      const sug = findByName(stripAge(row[i]));
      const score = row[i + 1] != null && row[i + 1] !== '' ? Number(row[i + 1]) : 0;
      if (sug) { picks.push({ id: sug.id, score }); added++; } else notFound.add(stripAge(row[i]));
    }
    if (picks.length) state.data.ai[main.id] = picks;
  }
  markDirty(); state.view = 'ai'; renderNav(); render();
  let msg = `נוספו ${added} הצעות`;
  if (notFound.size) msg += ` · לא נמצאו: ${[...notFound].slice(0, 6).join(', ')}`;
  toast(msg);
}

// ---------- events ----------
function wire() {
  const form = $('#filter-form');
  if (form) {
    const applyFilters = () => {
      const fd = new FormData(form);
      state.filters = { name: fd.get('name').trim(), gender: fd.get('gender'), religious: fd.get('religious').trim(),
        location: fd.get('location').trim(), ethnicity: fd.get('ethnicity').trim(),
        age_min: parseInt(fd.get('age_min'), 10) || null, age_max: parseInt(fd.get('age_max'), 10) || null,
        height_min: parseInt(fd.get('height_min'), 10) || null, height_max: parseInt(fd.get('height_max'), 10) || null,
        vip: fd.get('vip') === 'on' };
      const target = $('#main .grid, #main .empty');
      if (target) target.outerHTML = filteredCandidates().length ? `<div class="grid">${filteredCandidates().map(cardHTML).join('')}</div>` : '<div class="card empty">אין מועמדים תואמים.</div>';
      const sub = $('.page-head .subtle'); if (sub) sub.textContent = `${filteredCandidates().length} מוצגים`;
    };
    form.addEventListener('input', applyFilters);
    form.addEventListener('change', applyFilters);
  }
  const bind = (sel, handler) => { const el = $(sel); if (el) el.addEventListener('change', e => { if (e.target.files[0]) handler(e.target.files[0]); }); };
  bind('#zip-file', handleZipFile);
  bind('#xls-cands-file', importCandidatesXlsx);
  bind('#xls-matches-file', importMatchesXlsx);
  const tf = $('#todo-form');
  if (tf) tf.addEventListener('submit', e => {
    e.preventDefault(); const fd = new FormData(e.target);
    const name = (fd.get('name') || '').trim(); if (!name) return;
    state.data.todo.push({ id: nextItemId(state.data.todo), name, note: (fd.get('note') || '').trim(), done: false });
    markDirty(); render();
  });
  const kf = $('#task-form');
  if (kf) kf.addEventListener('submit', e => {
    e.preventDefault(); const fd = new FormData(e.target);
    const text = (fd.get('text') || '').trim(); if (!text) return;
    state.data.tasks.push({ id: nextItemId(state.data.tasks), text, done: false });
    markDirty(); render();
  });
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]'); if (!t) return;
  const a = t.dataset.action;
  if (a === 'open') { e.preventDefault(); openCandidate(Number(t.dataset.id)); }
  else if (a === 'close' || a === 'backdrop') { if (a === 'backdrop' && e.target !== t) return; closeModal(); }
  else if (a === 'new') openEditor(null);
  else if (a === 'edit') { closeModal(); openEditor(Number(t.dataset.id)); }
  else if (a === 'del-cand') { const id = Number(t.dataset.id); if (confirm('למחוק את המועמד/ת?')) { state.data.candidates = state.data.candidates.filter(c => c.id !== id); state.data.matches = state.data.matches.filter(m => m.a !== id && m.b !== id); delete state.data.ai[id]; Object.keys(state.data.ai).forEach(k => state.data.ai[k] = state.data.ai[k].filter(s => s.id !== id)); markDirty(); closeModal(); render(); } }
  else if (a === 'mk-match') mkMatch(Number(t.dataset.a), Number(t.dataset.b));
  else if (a === 'del-match') { state.data.matches.splice(Number(t.dataset.idx), 1); markDirty(); render(); }
  else if (a === 'sort') { state.sort = t.dataset.sort; render(); }
  else if (a === 'ai-vip') { state.aiVipOnly = !state.aiVipOnly; render(); }
  else if (a === 'import-zip') $('#zip-file').click();
  else if (a === 'xls-cands-in') $('#xls-cands-file').click();
  else if (a === 'xls-matches-in') $('#xls-matches-file').click();
  else if (a === 'xls-cands-out') exportCandidatesXlsx();
  else if (a === 'download') downloadJSON();
  else if (a === 'rm-photo') { editorPhotos.splice(Number(t.dataset.i), 1); renderEditorPhotos(); }
  else if (a === 'imp-confirm') confirmImport();
  else if (a === 'todo-del') { state.data.todo = state.data.todo.filter(x => x.id !== Number(t.dataset.id)); markDirty(); render(); }
  else if (a === 'todo-to-cand') { const it = state.data.todo.find(x => x.id === Number(t.dataset.id)); if (it) { state._todoConvertId = it.id; openEditor(null, { name: it.name, description: it.note || '' }); } }
  else if (a === 'task-del') { state.data.tasks = state.data.tasks.filter(x => x.id !== Number(t.dataset.id)); markDirty(); render(); }
  else if (a === 'ai-del') {
    const cid = Number(t.dataset.cid), sid = Number(t.dataset.sid);
    if (state.data.ai[cid]) {
      state.data.ai[cid] = state.data.ai[cid].filter(s => s.id !== sid);
      if (!state.data.ai[cid].length) delete state.data.ai[cid];
      markDirty(); render(); toast('ההתאמה נמחקה');
    }
  }
  else if (a === 'ai-del-all') {
    const n = Object.keys(state.data.ai).length;
    if (confirm(`למחוק את כל ההתאמות (${n} מועמדים)? פעולה זו אינה הפיכה.`)) {
      state.data.ai = {}; markDirty(); render(); toast('כל ההתאמות נמחקו');
    }
  }
});
document.addEventListener('change', e => {
  const s = e.target.closest('[data-action="status"]');
  if (s) { state.data.matches[Number(s.dataset.idx)].status = s.value; markDirty(); return; }
  const t = e.target.closest('[data-action="imp-toggle"]');
  if (t) { const c = pendingImport[Number(t.dataset.i)]; if (c) c._selected = t.checked; return; }
  const td = e.target.closest('[data-action="todo-done"]');
  if (td) { const it = state.data.todo.find(x => x.id === Number(td.dataset.id)); if (it) { it.done = e.target.checked; markDirty(); render(); } return; }
  const tk = e.target.closest('[data-action="task-done"]');
  if (tk) { const it = state.data.tasks.find(x => x.id === Number(tk.dataset.id)); if (it) { it.done = e.target.checked; markDirty(); render(); } }
});

// ---------- sample ----------
const SAMPLE = { candidates: [
  { id: 1, name: 'דוד לוי', age: 29, gender: 'male', height: 178, religious_level: 'דתי לאומי', location: 'ירושלים', occupation: 'מהנדס תוכנה', ethnicity: 'ספרדי', marital_status: 'רווק', description: 'בחור שמח ורציני, אוהב טיולים ולימוד.', looking_for: 'בחורה חמה ומשפחתית', vip: true, takiru: false, photos: [] },
  { id: 2, name: 'נועה כהן', age: 27, gender: 'female', height: 165, religious_level: 'דתי לאומי', location: 'מודיעין', occupation: 'מורה', ethnicity: 'אשכנזי', marital_status: 'רווקה', description: 'רגישה, אכפתית ואוהבת אנשים.', looking_for: 'בחור עם ערכים ולב טוב', vip: false, takiru: false, photos: [] },
  { id: 3, name: 'אבי מזרחי', age: 33, gender: 'male', height: 182, religious_level: 'דתי תורני', location: 'פתח תקווה', occupation: 'רואה חשבון', ethnicity: 'תימני', marital_status: 'רווק', description: 'יסודי, נאמן ובעל שאיפות.', looking_for: 'בחורה תורנית ושמחה', vip: false, takiru: true, photos: [] },
  { id: 4, name: 'שירה פרץ', age: 31, gender: 'female', height: 170, religious_level: 'דתי תורני', location: 'רמת גן', occupation: 'עורכת דין', ethnicity: 'מרוקאי', marital_status: 'רווקה', description: 'חכמה, עצמאית ובעלת חוש הומור.', looking_for: 'בחור יציב ורגוע', vip: false, takiru: false, photos: [] },
], matches: [{ a: 1, b: 2, status: 'proposed', notes: 'דוגמה' }], ai: { '1': [{ id: 2, score: 9, reason: 'התאמת ערכים, גיל ומיקום מצוינת.' }, { id: 4, score: 7.5, reason: 'רמה דתית קרובה ואופי משלים.' }], '3': [{ id: 4, score: 8.5, reason: 'שניהם תורניים עם שאיפה לבית של תורה.' }] },
  todo: [{ id: 1, name: 'מירי כהן', note: 'ממליצה: דודה שרה', done: false }], tasks: [{ id: 1, text: 'להתקשר לשדכן על אבי מזרחי', done: false }] };

initStart();
