/* Static, client-side matchmaking site.
   Data lives in ./data.enc encrypted with AES-256-GCM (PBKDF2-SHA256, 200k iters),
   compatible with tools/matchdata.py. Nothing is decrypted without the password. */

'use strict';

const ITER = 200000;
const STATUS_LABELS = { proposed: 'הוצע', in_progress: 'בתהליך', accepted: 'יצא לפועל', rejected: 'נדחה' };
const GENDER_HE = { male: 'זכר', female: 'נקבה' };

const state = {
  password: null,
  data: { candidates: [], matches: [], ai: {} },
  view: 'candidates',
  admin: false,
  dirty: false,
  filters: {},
  sort: 'score',
};

// ---------- crypto ----------
function b64ToBytes(b64) {
  const bin = atob(b64), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
function bytesToB64(buf) {
  const a = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
  return btoa(bin);
}
async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function decryptObj(obj, password) {
  const key = await deriveKey(password, b64ToBytes(obj.salt), obj.iterations || ITER);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(obj.iv) }, key, b64ToBytes(obj.ct));
  return new TextDecoder().decode(pt);
}
async function encryptStr(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITER);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITER, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(ct) };
}

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
function candById(id) { return state.data.candidates.find(c => c.id === id); }
function nextId() { return state.data.candidates.reduce((m, c) => Math.max(m, c.id), 0) + 1; }
function genderIcon(g) { return g === 'female' ? '👩' : g === 'male' ? '👨' : '👤'; }
function photoStyle(c) {
  if (c.photos && c.photos.length) return `background-image:url('${esc(c.photos[0])}')`;
  return '';
}
function markDirty() { state.dirty = true; renderNav(); }

// downscale an image blob/file to a compact JPEG data URI (keeps data.enc small)
function resizeToDataURL(blobOrFile, maxDim = 1000, quality = 0.82) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blobOrFile);
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > maxDim || h > maxDim) {
        if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// ---------- boot / gate ----------
async function tryUnlock(password) {
  const resp = await fetch('data.enc', { cache: 'no-store' });
  if (!resp.ok) throw new Error('קובץ הנתונים לא נמצא');
  const obj = await resp.json();
  const plaintext = await decryptObj(obj, password);   // throws on wrong password
  const data = JSON.parse(plaintext);
  data.candidates = data.candidates || [];
  data.matches = data.matches || [];
  data.ai = data.ai || {};
  state.password = password;
  state.data = data;
}

$('#gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = $('#gate-pass').value;
  const err = $('#gate-err');
  err.textContent = '';
  try {
    await tryUnlock(pass);
    sessionStorage.setItem('mm_pw', pass);
    $('#gate').classList.add('hidden');
    $('#app').classList.remove('hidden');
    renderNav();
    render();
  } catch (ex) {
    err.textContent = (ex && ex.name === 'OperationError') || /operation/i.test(String(ex))
      ? 'סיסמה שגויה' : ('שגיאה: ' + ex.message);
  }
});

// auto-unlock within the same session
window.addEventListener('DOMContentLoaded', async () => {
  const saved = sessionStorage.getItem('mm_pw');
  if (!saved) return;
  try {
    await tryUnlock(saved);
    $('#gate').classList.add('hidden');
    $('#app').classList.remove('hidden');
    renderNav();
    render();
  } catch (_) { sessionStorage.removeItem('mm_pw'); }
});

// ---------- nav ----------
function renderNav() {
  document.querySelectorAll('.nav .tab[data-view]').forEach(t =>
    t.classList.toggle('active', t.dataset.view === state.view));
  const admin = $('#admin-toggle');
  admin.textContent = state.admin ? '🔧 ניהול פעיל' : '🔧 ניהול';
  admin.classList.toggle('active', state.admin);
}

document.querySelectorAll('.nav .tab[data-view]').forEach(t =>
  t.addEventListener('click', () => { state.view = t.dataset.view; renderNav(); render(); }));

$('#admin-toggle').addEventListener('click', () => { state.admin = !state.admin; renderNav(); render(); });

$('#lock-btn').addEventListener('click', () => {
  if (state.dirty && !confirm('יש שינויים שלא יוצאו לקובץ. לנעול בכל זאת?')) return;
  sessionStorage.removeItem('mm_pw');
  location.reload();
});

// ---------- main render ----------
function render() {
  const m = $('#main');
  if (state.view === 'candidates') m.innerHTML = viewCandidates();
  else if (state.view === 'matches') m.innerHTML = viewMatches();
  else m.innerHTML = viewAI();
  wire();
}

// ===== candidates =====
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
    if (f.vip && !c.vip) return false;
    if (f.takiru && !c.takiru) return false;
    return true;
  });
}

function viewCandidates() {
  const list = filteredCandidates();
  const f = state.filters;
  const admin = state.admin ? `
    <button class="btn ok sm" data-action="new">+ מועמד/ת חדש/ה</button>
    <button class="btn sm" data-action="import-zip">📦 ייבוא ZIP מוואטסאפ</button>
    <input id="zip-file" type="file" accept=".zip" class="hidden">
    <button class="btn secondary sm" data-action="export">⬇ שמור (ייצוא מוצפן)</button>
    <button class="btn ghost sm" data-action="import">⬆ ייבוא JSON</button>
    <input id="import-file" type="file" accept=".json,.enc" class="hidden">
    ${state.dirty ? '<span class="pill" style="background:#fef9c3;color:#854d0e">● שינויים לא שמורים</span>' : ''}` : '';

  const cards = list.map(c => `
    <div class="c-card" data-action="open" data-id="${c.id}">
      <div class="c-photo" style="${photoStyle(c)}">
        ${(c.photos && c.photos.length) ? '' : genderIcon(c.gender)}
        <div class="badges">
          ${c.vip ? '<span class="pill vip">VIP</span>' : ''}
          ${c.takiru ? '<span class="pill takiru">תכירו</span>' : ''}
        </div>
      </div>
      <div class="c-body">
        <div class="c-name">${esc(c.name)}</div>
        <div class="c-meta">${c.age ? c.age : ''}${c.gender ? ` · <span class="pill gender-${c.gender}">${GENDER_HE[c.gender]}</span>` : ''}</div>
        <div class="c-meta">${esc(c.religious_level || '')}${c.location ? ' · ' + esc(c.location) : ''}</div>
      </div>
    </div>`).join('');

  return `
    <div class="page-head">
      <h1>מועמדים</h1><span class="subtle">${list.length} מוצגים</span>
      <span class="spacer"></span>${admin}
    </div>
    <form class="card" id="filter-form">
      <div class="filters">
        <label class="field">שם<input name="name" value="${esc(f.name || '')}"></label>
        <label class="field">מין<select name="gender">
          <option value="">הכל</option>
          <option value="male" ${f.gender === 'male' ? 'selected' : ''}>זכר</option>
          <option value="female" ${f.gender === 'female' ? 'selected' : ''}>נקבה</option>
        </select></label>
        <label class="field">רמה דתית<input name="religious" value="${esc(f.religious || '')}"></label>
        <label class="field">מיקום<input name="location" value="${esc(f.location || '')}"></label>
        <label class="field">עדה<input name="ethnicity" value="${esc(f.ethnicity || '')}"></label>
        <label class="field">גיל מ־<input name="age_min" type="number" value="${f.age_min || ''}"></label>
        <label class="field">גיל עד<input name="age_max" type="number" value="${f.age_max || ''}"></label>
      </div>
    </form>
    ${list.length ? `<div class="grid">${cards}</div>` : '<div class="card empty">אין מועמדים תואמים.</div>'}`;
}

// ===== matches =====
function viewMatches() {
  const rows = state.data.matches.map((m, i) => {
    const a = candById(m.a), b = candById(m.b);
    if (!a || !b) return '';
    const sel = Object.entries(STATUS_LABELS).map(([k, v]) =>
      `<option value="${k}" ${m.status === k ? 'selected' : ''}>${v}</option>`).join('');
    return `<tr>
      <td><a data-action="open" data-id="${a.id}" href="#">${esc(a.name)}</a></td>
      <td><a data-action="open" data-id="${b.id}" href="#">${esc(b.name)}</a></td>
      <td>${state.admin
        ? `<select data-action="status" data-idx="${i}">${sel}</select>`
        : esc(STATUS_LABELS[m.status] || m.status)}</td>
      <td class="subtle">${esc(m.notes || '')}</td>
      <td>${state.admin ? `<button class="btn danger sm" data-action="del-match" data-idx="${i}">מחק</button>` : ''}</td>
    </tr>`;
  }).join('');
  return `
    <div class="page-head"><h1>שידוכים</h1><span class="subtle">${state.data.matches.length} הצעות</span></div>
    ${state.data.matches.length
      ? `<div class="card"><table><thead><tr><th>צד א׳</th><th>צד ב׳</th><th>סטטוס</th><th>הערה</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="card empty">אין הצעות שידוך עדיין.</div>'}`;
}

// ===== AI matches =====
function viewAI() {
  const groups = Object.keys(state.data.ai).map(cid => {
    const c = candById(Number(cid));
    if (!c) return null;
    const sugg = (state.data.ai[cid] || []).slice().sort((x, y) => (y.score || 0) - (x.score || 0));
    return { c, sugg };
  }).filter(Boolean);

  if (state.sort === 'name') groups.sort((a, b) => (a.c.name || '').localeCompare(b.c.name || '', 'he'));
  else if (state.sort === 'age') groups.sort((a, b) => (a.c.age || 99) - (b.c.age || 99));
  else groups.sort((a, b) => Math.max(...b.sugg.map(s => s.score || 0), 0) - Math.max(...a.sugg.map(s => s.score || 0), 0));

  const chips = ['score', 'name', 'age'].map(s =>
    `<button class="chip ${state.sort === s ? 'active' : ''}" data-action="sort" data-sort="${s}">${{ score: 'ציון', name: 'שם', age: 'גיל' }[s]}</button>`).join('');

  const body = groups.map(g => `
    <div class="card">
      <h2><a data-action="open" data-id="${g.c.id}" href="#">${esc(g.c.name)}</a>
        ${g.c.age ? `<span class="subtle">(${g.c.age})</span>` : ''}</h2>
      <table><thead><tr><th>הצעה</th><th>גיל</th><th>ציון</th><th>נימוק</th><th></th></tr></thead><tbody>
      ${g.sugg.map(s => {
        const t = candById(s.id); if (!t) return '';
        const sc = s.score || 0, cls = sc >= 8 ? 'high' : sc >= 6 ? 'mid' : 'low';
        return `<tr>
          <td><a data-action="open" data-id="${t.id}" href="#">${esc(t.name)}</a></td>
          <td>${t.age || ''}</td>
          <td><span class="score ${cls}">${sc}</span></td>
          <td class="subtle">${esc(s.reason || '')}</td>
          <td>${state.admin ? `<button class="btn ok sm" data-action="mk-match" data-a="${g.c.id}" data-b="${t.id}">צור שידוך</button>` : ''}</td>
        </tr>`;
      }).join('')}
      </tbody></table>
    </div>`).join('');

  return `
    <div class="page-head"><h1>התאמות AI</h1><span class="subtle">${groups.length} מועמדים</span>
      <span class="spacer"></span><span class="subtle">מיון:</span><div class="chips">${chips}</div></div>
    ${groups.length ? body : '<div class="card empty">אין התאמות AI. הן נטענות מקובץ הנתונים.</div>'}`;
}

// ---------- candidate detail modal ----------
function openCandidate(id) {
  const c = candById(id); if (!c) return;
  const kv = [
    ['גיל', c.age], ['מין', GENDER_HE[c.gender]], ['גובה', c.height ? c.height + ' ס״מ' : ''],
    ['רמה דתית', c.religious_level], ['מיקום', c.location], ['עדה', c.ethnicity],
    ['סטטוס', c.marital_status], ['עיסוק', c.occupation], ['טלפון', c.phone], ['ממליצים', c.references],
  ].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');

  const ai = (state.data.ai[id] || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const aiHtml = ai.length ? `<hr><h2>התאמות AI</h2><table><tbody>${ai.map(s => {
    const t = candById(s.id); if (!t) return '';
    const sc = s.score || 0, cls = sc >= 8 ? 'high' : sc >= 6 ? 'mid' : 'low';
    return `<tr><td><a data-action="open" data-id="${t.id}" href="#">${esc(t.name)}</a> ${t.age ? '(' + t.age + ')' : ''}</td>
      <td><span class="score ${cls}">${sc}</span></td><td class="subtle">${esc(s.reason || '')}</td>
      <td>${state.admin ? `<button class="btn ok sm" data-action="mk-match" data-a="${id}" data-b="${t.id}">שדך</button>` : ''}</td></tr>`;
  }).join('')}</tbody></table>` : '';

  const partners = state.data.matches.filter(m => m.a === id || m.b === id).map(m => {
    const o = candById(m.a === id ? m.b : m.a); return o ? esc(o.name) + ' · ' + (STATUS_LABELS[m.status] || m.status) : '';
  }).filter(Boolean);
  const matchesHtml = partners.length ? `<hr><h2>שידוכים</h2><ul>${partners.map(p => `<li>${p}</li>`).join('')}</ul>` : '';

  const adminBtns = state.admin ? `
    <button class="btn secondary sm" data-action="edit" data-id="${id}">✎ עריכה</button>
    <button class="btn danger sm" data-action="del-cand" data-id="${id}">מחק</button>` : '';

  showModal(`
    <div class="modal-head"><h2 style="margin:0">${esc(c.name)}</h2>
      ${c.vip ? '<span class="pill vip">VIP</span>' : ''}${c.takiru ? '<span class="pill takiru">תכירו</span>' : ''}
      <span class="spacer"></span>${adminBtns}<button class="x" data-action="close">✕</button></div>
    <div class="modal-body">
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <div style="width:180px;height:210px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:4rem;color:#b9c0d4;background:${(c.photos && c.photos.length) ? `center/cover no-repeat url('${esc(c.photos[0])}')` : 'linear-gradient(135deg,#eef1f8,#e3e8f5)'}">${(c.photos && c.photos.length) ? '' : genderIcon(c.gender)}</div>
        <dl class="kv" style="flex:1;min-width:220px">${kv}</dl>
      </div>
      ${c.description ? `<hr><h2>תיאור</h2><div class="prose">${esc(c.description)}</div>` : ''}
      ${c.looking_for ? `<hr><h2>מה מחפש/ת</h2><div class="prose">${esc(c.looking_for)}</div>` : ''}
      ${aiHtml}${matchesHtml}
    </div>`);
}

// ---------- editor modal (admin) ----------
const FORM_FIELDS = [
  ['name', 'שם מלא *', 'text'], ['gender', 'מין', 'gender'], ['age', 'גיל', 'number'],
  ['height', 'גובה (ס״מ)', 'number'], ['religious_level', 'רמה דתית', 'text'], ['location', 'מיקום', 'text'],
  ['ethnicity', 'עדה', 'text'], ['marital_status', 'סטטוס', 'text'], ['occupation', 'עיסוק', 'text'],
  ['phone', 'טלפון', 'text'], ['description', 'תיאור', 'area'], ['looking_for', 'מה מחפש/ת', 'area'],
  ['references', 'ממליצים', 'text'],
];
let editorPhotos = [];  // working copy of the edited candidate's photos (data URIs)

function renderEditorPhotos() {
  const strip = $('#editor-photos');
  if (!strip) return;
  strip.innerHTML = editorPhotos.map((src, i) => `
    <div style="position:relative">
      <img src="${src}" style="width:90px;height:90px;object-fit:cover;border-radius:10px;border:1px solid var(--line)">
      <button type="button" class="x" data-action="rm-photo" data-i="${i}"
        style="position:absolute;top:-6px;inset-inline-start:-6px;width:24px;height:24px;font-size:.8rem">✕</button>
    </div>`).join('') || '<span class="subtle">אין תמונות</span>';
}

function openEditor(id) {
  const c = id ? candById(id) : {};
  editorPhotos = (c.photos || []).slice();
  const fields = FORM_FIELDS.map(([k, label, type]) => {
    const v = c[k] == null ? '' : c[k];
    let input;
    if (type === 'area') input = `<textarea name="${k}">${esc(v)}</textarea>`;
    else if (type === 'gender') input = `<select name="gender"><option value="">—</option>
      <option value="male" ${v === 'male' ? 'selected' : ''}>זכר</option>
      <option value="female" ${v === 'female' ? 'selected' : ''}>נקבה</option></select>`;
    else input = `<input name="${k}" type="${type}" value="${esc(v)}">`;
    return `<label class="field ${type === 'area' ? 'full' : ''}">${label}${input}</label>`;
  }).join('');
  showModal(`
    <div class="modal-head"><h2 style="margin:0">${id ? 'עריכת ' + esc(c.name) : 'מועמד/ת חדש/ה'}</h2>
      <span class="spacer"></span><button class="x" data-action="close">✕</button></div>
    <div class="modal-body">
      <form id="cand-form">
        <div class="form-grid">${fields}
          <label class="field full">
            <div style="display:flex;gap:16px;align-items:center;margin-top:6px">
              <label class="inline"><input type="checkbox" name="vip" ${c.vip ? 'checked' : ''} style="width:auto"> VIP</label>
              <label class="inline"><input type="checkbox" name="takiru" ${c.takiru ? 'checked' : ''} style="width:auto"> תכירו</label>
            </div>
          </label>
          <label class="field full">תמונות
            <input id="editor-photo-input" type="file" accept="image/*" multiple>
            <div id="editor-photos" class="photo-strip" style="margin-top:8px;flex-wrap:wrap;gap:8px;display:flex"></div>
          </label>
        </div>
        <hr><button class="btn ok" type="submit">${id ? 'שמור' : 'הוסף'}</button>
      </form>
    </div>`);
  renderEditorPhotos();
  $('#editor-photo-input').addEventListener('change', async (e) => {
    for (const f of e.target.files) {
      const d = await resizeToDataURL(f);
      if (d) editorPhotos.push(d);
    }
    renderEditorPhotos();
  });
  $('#cand-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const obj = id ? candById(id) : { id: nextId(), photos: [] };
    for (const [k] of FORM_FIELDS) {
      let v = fd.get(k);
      if ((k === 'age' || k === 'height')) v = v ? parseInt(v, 10) : null;
      obj[k] = v;
    }
    obj.vip = fd.get('vip') === 'on';
    obj.takiru = fd.get('takiru') === 'on';
    obj.photos = editorPhotos.slice();
    if (!obj.name) { toast('חובה להזין שם'); return; }
    if (!id) state.data.candidates.push(obj);
    markDirty(); closeModal(); render();
    toast(id ? 'עודכן' : 'נוסף');
  });
}

// ---------- modal plumbing ----------
function showModal(html) {
  $('#modal-root').innerHTML = `<div class="modal-bg" data-action="backdrop"><div class="modal">${html}</div></div>`;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

// ---------- actions / wiring ----------
function mkMatch(a, b) {
  if (a === b) return;
  if (state.data.matches.some(m => (m.a === a && m.b === b) || (m.a === b && m.b === a))) {
    toast('הצעת שידוך כבר קיימת'); return;
  }
  state.data.matches.push({ a, b, status: 'proposed', notes: '' });
  markDirty(); toast('נוצרה הצעת שידוך');
}

async function exportData() {
  const pw = prompt('סיסמה להצפנת הקובץ (השאר/י כפי שהוא לשמירת אותה סיסמה):', state.password);
  if (pw == null) return;
  const enc = await encryptStr(JSON.stringify(state.data, null, 2), pw || state.password);
  const blob = new Blob([JSON.stringify(enc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'data.enc'; a.click();
  URL.revokeObjectURL(url);
  state.password = pw || state.password;
  sessionStorage.setItem('mm_pw', state.password);
  state.dirty = false; renderNav();
  toast('הורד data.enc — העלה/החלף אותו ב-docs שברפו');
}

function importData() { $('#import-file').click(); }

// ---- WhatsApp ZIP import ----
let pendingImport = [];

async function handleZipFile(file) {
  toast('קורא את הקובץ…');
  let zip;
  try { zip = await JSZip.loadAsync(file); }
  catch (e) { toast('קובץ ZIP לא תקין'); return; }

  // find the chat text file
  let chatEntry = null;
  zip.forEach((path, entry) => {
    if (/(^|\/)_chat\.txt$/i.test(path) || (/\.txt$/i.test(path) && !chatEntry)) chatEntry = entry;
  });
  if (!chatEntry) { toast('לא נמצא קובץ צ׳אט (.txt) בתוך ה-ZIP'); return; }

  const chatText = await chatEntry.async('string');
  const parsed = window.parseWhatsappChat(chatText);
  if (!parsed.length) { toast('לא זוהו פרופילים בצ׳אט'); return; }

  // map photo basenames -> zip entries
  const byBase = {};
  zip.forEach((path, entry) => { if (!entry.dir) byBase[path.split('/').pop()] = entry; });

  const existingNames = new Set(state.data.candidates.map(c => c.name));
  toast('מעבד תמונות…');
  const results = [];
  for (const p of parsed) {
    const photos = [];
    for (const fn of (p.photos || [])) {
      const entry = byBase[fn] || byBase[fn.split('/').pop()];
      if (!entry) continue;
      const blob = await entry.async('blob');
      const d = await resizeToDataURL(blob);
      if (d) photos.push(d);
    }
    results.push({
      id: null, name: p.name, age: p.age, gender: p.gender, height: p.height,
      religious_level: p.religious_level, location: p.location, phone: p.phone,
      occupation: p.occupation, description: p.description, looking_for: p.looking_for,
      references: p.references, ethnicity: p.ethnicity, marital_status: p.marital_status,
      vip: false, takiru: false, photos,
      _dup: existingNames.has(p.name),
    });
  }
  pendingImport = results;
  showImportPreview();
}

function showImportPreview() {
  const rows = pendingImport.map((c, i) => `
    <tr style="${c._dup ? 'opacity:.5' : ''}">
      <td><input type="checkbox" data-action="imp-toggle" data-i="${i}" ${c._dup ? '' : 'checked'} style="width:auto"></td>
      <td>${c.photos.length ? `<img src="${c.photos[0]}" style="width:44px;height:44px;object-fit:cover;border-radius:8px">` : '👤'}</td>
      <td>${esc(c.name)}${c._dup ? ' <span class="subtle">(כבר קיים)</span>' : ''}</td>
      <td>${c.age || ''}</td>
      <td>${c.gender ? GENDER_HE[c.gender] : '<span class="subtle">?</span>'}</td>
      <td class="subtle">${esc(c.religious_level || '')}${c.location ? ' · ' + esc(c.location) : ''}</td>
      <td>${c.photos.length}📷</td>
    </tr>`).join('');
  const newCount = pendingImport.filter(c => !c._dup).length;
  showModal(`
    <div class="modal-head"><h2 style="margin:0">ייבוא מוואטסאפ</h2>
      <span class="subtle">זוהו ${pendingImport.length} פרופילים · ${newCount} חדשים</span>
      <span class="spacer"></span>
      <button class="btn ok sm" data-action="imp-confirm">הוסף מסומנים</button>
      <button class="x" data-action="close">✕</button></div>
    <div class="modal-body" style="max-height:70vh;overflow:auto">
      <p class="subtle">בדוק/י את הפרופילים שזוהו. אפשר לבטל סימון של פרופילים שלא לייבא. לאחר ההוספה יש ללחוץ "שמור (ייצוא מוצפן)" כדי לשמור.</p>
      <table><thead><tr><th></th><th></th><th>שם</th><th>גיל</th><th>מין</th><th>פרטים</th><th>תמונות</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`);
}

function confirmImport() {
  let added = 0;
  for (const c of pendingImport) {
    if (c._selected === false) continue;
    if (c._selected === undefined && c._dup) continue; // default: skip dups
    const { _dup, _selected, ...clean } = c;
    clean.id = nextId();
    state.data.candidates.push(clean);
    added++;
  }
  pendingImport = [];
  markDirty(); closeModal(); render();
  toast(`נוספו ${added} מועמדים — אל תשכח/י לייצא כדי לשמור`);
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      let txt = reader.result;
      let obj;
      try { obj = JSON.parse(txt); } catch { obj = null; }
      if (obj && obj.ct && obj.salt) {  // encrypted file -> ask password
        const pw = prompt('סיסמה לפענוח הקובץ שהועלה:');
        if (pw == null) return;
        txt = await decryptObj(obj, pw);
      }
      const data = JSON.parse(txt);
      state.data = { candidates: data.candidates || [], matches: data.matches || [], ai: data.ai || {} };
      markDirty(); render();
      toast('הנתונים יובאו — אל תשכח/י לייצא כדי לשמור');
    } catch (ex) { toast('ייבוא נכשל: ' + ex.message); }
  };
  reader.readAsText(file);
}

function wire() {
  const form = $('#filter-form');
  if (form) {
    form.addEventListener('input', () => {
      const fd = new FormData(form);
      state.filters = {
        name: fd.get('name').trim(), gender: fd.get('gender'),
        religious: fd.get('religious').trim(), location: fd.get('location').trim(),
        ethnicity: fd.get('ethnicity').trim(),
        age_min: parseInt(fd.get('age_min'), 10) || null, age_max: parseInt(fd.get('age_max'), 10) || null,
        vip: state.filters.vip, takiru: state.filters.takiru,
      };
      $('#main').querySelector('.grid, .empty').outerHTML =
        (filteredCandidates().length ? renderGridOnly() : '<div class="card empty">אין מועמדים תואמים.</div>');
      $('.page-head .subtle').textContent = `${filteredCandidates().length} מוצגים`;
    });
  }
  const imp = $('#import-file');
  if (imp) imp.addEventListener('change', e => { if (e.target.files[0]) handleImportFile(e.target.files[0]); });
  const zf = $('#zip-file');
  if (zf) zf.addEventListener('change', e => { if (e.target.files[0]) handleZipFile(e.target.files[0]); });
}

function renderGridOnly() {
  const list = filteredCandidates();
  return `<div class="grid">${list.map(c => `
    <div class="c-card" data-action="open" data-id="${c.id}">
      <div class="c-photo" style="${photoStyle(c)}">${(c.photos && c.photos.length) ? '' : genderIcon(c.gender)}
        <div class="badges">${c.vip ? '<span class="pill vip">VIP</span>' : ''}${c.takiru ? '<span class="pill takiru">תכירו</span>' : ''}</div></div>
      <div class="c-body"><div class="c-name">${esc(c.name)}</div>
        <div class="c-meta">${c.age || ''}${c.gender ? ` · <span class="pill gender-${c.gender}">${GENDER_HE[c.gender]}</span>` : ''}</div>
        <div class="c-meta">${esc(c.religious_level || '')}${c.location ? ' · ' + esc(c.location) : ''}</div></div>
    </div>`).join('')}</div>`;
}

// global click delegation
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  if (a === 'open') { e.preventDefault(); openCandidate(Number(t.dataset.id)); }
  else if (a === 'close' || a === 'backdrop') { if (a === 'backdrop' && e.target !== t) return; closeModal(); }
  else if (a === 'new') openEditor(null);
  else if (a === 'edit') { closeModal(); openEditor(Number(t.dataset.id)); }
  else if (a === 'del-cand') {
    const id = Number(t.dataset.id);
    if (confirm('למחוק את המועמד/ת? יימחקו גם השידוכים וההתאמות שלו/ה.')) {
      state.data.candidates = state.data.candidates.filter(c => c.id !== id);
      state.data.matches = state.data.matches.filter(m => m.a !== id && m.b !== id);
      delete state.data.ai[id];
      Object.keys(state.data.ai).forEach(k => { state.data.ai[k] = state.data.ai[k].filter(s => s.id !== id); });
      markDirty(); closeModal(); render(); toast('נמחק');
    }
  }
  else if (a === 'mk-match') mkMatch(Number(t.dataset.a), Number(t.dataset.b));
  else if (a === 'del-match') { state.data.matches.splice(Number(t.dataset.idx), 1); markDirty(); render(); }
  else if (a === 'sort') { state.sort = t.dataset.sort; render(); }
  else if (a === 'export') exportData();
  else if (a === 'import') importData();
  else if (a === 'import-zip') $('#zip-file').click();
  else if (a === 'rm-photo') { editorPhotos.splice(Number(t.dataset.i), 1); renderEditorPhotos(); }
  else if (a === 'imp-confirm') confirmImport();
});

// import-preview checkboxes
document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-action="imp-toggle"]');
  if (!t) return;
  const c = pendingImport[Number(t.dataset.i)];
  if (c) c._selected = t.checked;
});

// status <select> change (matches table)
document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-action="status"]');
  if (!t) return;
  state.data.matches[Number(t.dataset.idx)].status = t.value;
  markDirty(); toast('הסטטוס עודכן');
});
