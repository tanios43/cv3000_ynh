/**
 * CV-3000 Web Interface — app.js
 */
import {
  CV3000Serial,
  fmtDiopter, fmtPrescription, buildCopyString,
  buildRmStd1Frame,
} from './serial.js';

const PREFIX = document.querySelector('meta[name="app-prefix"]')?.content || '';

// ── Parseur RX ────────────────────────────────────────────────
function parseRxString(text) {
  text = text.trim().replace(/,/g, '.').replace(/°|deg/g, '');
  const eyePat =
    '([+-]?\\d+\\.?\\d*)' +
    '(?:' +
      '\\s*\\(\\s*([+-]?\\d+\\.?\\d*)\\s*\\)\\s*(\\d{1,3})' +
      '|' +
      '\\s+([+-]?\\d+\\.?\\d*)\\s+(\\d{1,3})' +
    ')?' +
    '(?:\\s*[Aa]dd\\s*([+-]?\\d+\\.?\\d*))?';
  const re = new RegExp('^\\s*' + eyePat + '\\s*/\\s*' + eyePat + '\\s*$');
  const m = text.match(re);
  if (!m) throw new Error(
    'Format non reconnu.\nExemples :\n  -2.25(-0.75)180 / -1.75(-1.00)10\n  -1 -1.50 90 / +0.5 -0.75 30\n  -1.25 / -0.75'
  );
  const buildEye = (sphS, cylPar, axPar, cylSpc, axSpc, addS) => {
    const sph = parseFloat(sphS);
    let cyl = null, ax = null;
    if (cylPar != null)      { cyl = parseFloat(cylPar); ax = parseInt(axPar, 10); }
    else if (cylSpc != null) { cyl = parseFloat(cylSpc); ax = parseInt(axSpc, 10); }
    const add = addS != null ? parseFloat(addS) : null;
    if (cyl != null && (ax < 0 || ax > 180))
      throw new Error(`Axe hors limites (${ax}°) — doit être entre 0 et 180`);
    return { sph, cyl, ax, add, pd: null };
  };
  return {
    od: buildEye(m[1],  m[2],  m[3],  m[4],  m[5],  m[6]),
    os: buildEye(m[7],  m[8],  m[9],  m[10], m[11], m[12]),
  };
}


// ═══════════════════════════════════════════════════════════
// ÉTAT GLOBAL
// ═══════════════════════════════════════════════════════════
let currentData     = null;
let history         = [];
let selectedHistIdx = -1;
let baudRate        = 2400;
let currentUser     = 'anonymous';

const serial = new CV3000Serial({
  onMeasurement: handleMeasurement,
  onRaw:         (txt) => log(`[RAW] ${txt}`, 'raw'),
  onLog:         (msg, lvl) => log(msg, lvl),
  onStatus:      updateConnectionState,
});


// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  checkWebSerialSupport();
  await loadUser();
  await loadHistory();
  bindAll();
});

function checkWebSerialSupport() {
  if (!('serial' in navigator)) {
    showBanner(
      '⚠ Web Serial API non disponible. Utilisez Chrome ou Edge ≥ 89.',
      'warn'
    );
    document.getElementById('btn-connect').disabled = true;
  }
}

async function loadUser() {
  try {
    const r = await fetch(PREFIX + '/api/me').then(r => r.json());
    currentUser = r.user || 'anonymous';
    // Afficher dans le header
    const el = document.getElementById('user-badge');
    if (el) {
      el.textContent = currentUser === 'anonymous' ? '👤 Non connecté' : `👤 ${currentUser}`;
      el.className   = currentUser === 'anonymous' ? 'user-badge user-anon' : 'user-badge user-logged';
    }
    // Afficher dans l'historique
    const hl = document.getElementById('hist-user-label');
    if (hl) hl.textContent = `Historique de ${currentUser}`;
  } catch {}
}


// ═══════════════════════════════════════════════════════════
// CONNEXION SÉRIE
// ═══════════════════════════════════════════════════════════
async function toggleConnection() {
  if (serial.isConnected) {
    await serial.disconnect();
  } else {
    baudRate = parseInt(document.getElementById('baud-select').value, 10) || 2400;
    try { await serial.connect(baudRate); } catch {}
  }
}

function updateConnectionState(connected) {
  const btn   = document.getElementById('btn-connect');
  const badge = document.getElementById('status-badge');
  const dot   = document.getElementById('status-dot');
  btn.textContent       = connected ? 'Déconnecter' : 'Connecter le port série';
  btn.dataset.connected = connected ? '1' : '';
  badge.textContent     = connected ? `Connecté · ${baudRate} bauds` : 'Déconnecté';
  dot.className         = 'status-dot ' + (connected ? 'dot-on' : 'dot-off');
}


// ═══════════════════════════════════════════════════════════
// AFFICHAGE MESURES
// ═══════════════════════════════════════════════════════════
function handleMeasurement(parsed) {
  currentData = parsed;
  renderEyes(parsed.OD, parsed.OS);
  document.getElementById('ts-label').textContent =
    `Dernière mesure : ${parsed.timestamp} [${parsed.format}]`;
  log(`✓ Mesure reçue à ${parsed.timestamp} [${parsed.format}]`, 'data');
  const entry = document.getElementById('rx-input');
  if (!entry.value.trim()) {
    entry.value = buildCopyString(parsed.OD, parsed.OS);
    liveParseRx();
  }
}

function renderEyes(od, os) {
  fillEye('od', od);
  fillEye('os', os);
  document.getElementById('prescription-text').textContent =
    buildCopyString(od ?? {}, os ?? {});
  ['panel-od', 'panel-os'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  });
}

function fillEye(prefix, eye) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '—'; };
  if (!eye || eye.sph == null) {
    ['sph','cyl','ax','add','pd'].forEach(f => set(`${prefix}-${f}`, null));
    return;
  }
  set(`${prefix}-sph`, fmtDiopter(eye.sph));
  set(`${prefix}-cyl`, fmtDiopter(eye.cyl));
  set(`${prefix}-ax`,  eye.ax  != null ? `${eye.ax}°` : null);
  set(`${prefix}-add`, fmtDiopter(eye.add));
  set(`${prefix}-pd`,  eye.pd  != null ? `${eye.pd} mm` : null);
}

function clearDisplay() {
  ['od','os'].forEach(p => fillEye(p, null));
  document.getElementById('prescription-text').textContent = '—';
  document.getElementById('ts-label').textContent = 'Aucune mesure reçue';
  currentData = null;
}


// ═══════════════════════════════════════════════════════════
// COPIE PRESCRIPTION
// ═══════════════════════════════════════════════════════════
async function copyPrescription() {
  const txt = document.getElementById('prescription-text').textContent;
  if (!txt || txt === '—') { toast('Aucune mesure à copier'); return; }
  try {
    await navigator.clipboard.writeText(txt);
    const el = document.getElementById('prescription-text');
    const orig = el.textContent;
    el.textContent = '✓ Copié !';
    log(`✓ Copié : ${orig}`, 'ok');
    setTimeout(() => el.textContent = orig, 1400);
    toast('Prescription copiée !', 'ok');
  } catch { toast('Erreur copie', 'err'); }
}


// ═══════════════════════════════════════════════════════════
// HISTORIQUE
// ═══════════════════════════════════════════════════════════
async function loadHistory() {
  try {
    const r = await fetch(PREFIX + '/api/history').then(r => r.json());
    history = r.history ?? [];
    renderHistory();
  } catch {}
}

function renderHistory() {
  const ul = document.getElementById('history-list');
  ul.innerHTML = '';
  if (!history.length) {
    ul.innerHTML = '<li class="hist-empty">Aucune mesure enregistrée</li>';
    return;
  }
  [...history].reverse().forEach((m, revIdx) => {
    const realIdx = history.length - 1 - revIdx;
    const od  = m.OD ?? {};
    const sph = od.sph != null ? fmtDiopter(od.sph) : '?';
    const li  = document.createElement('li');
    li.className = 'hist-item' + (realIdx === selectedHistIdx ? ' selected' : '');
    li.innerHTML = `
      <span class="hist-ts">${(m.timestamp ?? '').slice(0, 16)}</span>
      <span class="hist-od">OD ${sph}</span>
      <button class="hist-del" data-idx="${realIdx}" title="Supprimer">✕</button>`;
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('hist-del')) return;
      selectHistory(realIdx);
    });
    li.querySelector('.hist-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistoryItem(realIdx);
    });
    ul.appendChild(li);
  });
}

function selectHistory(idx) {
  selectedHistIdx = idx;
  const m = history[idx];
  currentData = m;
  renderEyes(m.OD ?? null, m.OS ?? null);
  document.getElementById('ts-label').textContent = `Historique : ${m.timestamp ?? ''}`;
  renderHistory();
}

async function saveMeasurement() {
  if (!currentData) { toast('Aucune mesure à enregistrer'); return; }
  try {
    await fetch(PREFIX + '/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentData),
    });
    await loadHistory();
    toast('Mesure enregistrée', 'ok');
    log(`✓ Mesure enregistrée (${currentData.timestamp ?? ''})`, 'ok');
  } catch { toast('Erreur sauvegarde', 'err'); }
}

async function deleteHistoryItem(idx) {
  await fetch(PREFIX + `/api/history/${idx}`, { method: 'DELETE' });
  if (selectedHistIdx === idx) selectedHistIdx = -1;
  await loadHistory();
}

async function clearHistory() {
  if (!confirm('Vider tout l\'historique ?')) return;
  await fetch(PREFIX + '/api/history', { method: 'DELETE' });
  history = []; selectedHistIdx = -1;
  renderHistory();
  toast('Historique vidé');
}

function exportCSV() {
  window.location = PREFIX + '/api/export_csv';
  log('✓ Export CSV lancé', 'ok');
}


// ═══════════════════════════════════════════════════════════
// ENVOI VERS CV-3000
// ═══════════════════════════════════════════════════════════
function liveParseRx() {
  const txt     = document.getElementById('rx-input').value.trim();
  const preview = document.getElementById('rx-preview');
  if (!txt) { preview.textContent = ''; preview.className = 'rx-preview'; return; }
  try {
    const { od, os } = parseRxString(txt);
    preview.textContent = `✓  OD : ${fmtPrescription(od) ?? '?'}   |   OS : ${fmtPrescription(os) ?? '?'}`;
    preview.className = 'rx-preview rx-ok';
  } catch (e) {
    preview.textContent = `✗  ${e.message.split('\n')[0]}`;
    preview.className = 'rx-preview rx-err';
  }
}

async function sendToCV3000() {
  const txt = document.getElementById('rx-input').value.trim();
  const statusEl = document.getElementById('send-status');
  if (!txt) { toast('Saisissez une prescription'); return; }
  let od, os;
  try {
    ({ od, os } = parseRxString(txt));
  } catch (e) {
    statusEl.textContent = `✗ ${e.message.split('\n')[0]}`;
    statusEl.className = 'send-err';
    setTimeout(() => statusEl.textContent = '', 4000);
    return;
  }
  if (!serial.isConnected) { toast('Connectez d\'abord le port série', 'warn'); return; }
  try {
    await serial.send(buildRmStd1Frame(od, os));
    statusEl.textContent = '✓ Données envoyées !';
    statusEl.className = 'send-ok';
    toast('Envoyé au CV-3000', 'ok');
  } catch (e) {
    statusEl.textContent = `✗ ${e.message}`;
    statusEl.className = 'send-err';
    log(`✗ Erreur envoi : ${e.message}`, 'err');
  }
  setTimeout(() => statusEl.textContent = '', 3000);
}

function prefillFromReceived() {
  if (!currentData) { toast('Aucune mesure disponible'); return; }
  const presc = document.getElementById('prescription-text').textContent;
  if (presc && presc !== '—') {
    document.getElementById('rx-input').value = presc;
    liveParseRx();
    log('✓ Champ pré-rempli depuis la dernière mesure', 'data');
  }
}


// ═══════════════════════════════════════════════════════════
// JOURNAL
// ═══════════════════════════════════════════════════════════
function log(msg, level = 'info') {
  const area = document.getElementById('log-area');
  const ts   = new Date().toLocaleTimeString('fr-FR');
  const div  = document.createElement('div');
  div.className = `log-line log-${level}`;
  div.textContent = `${ts}  ${msg}`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  while (area.children.length > 400) area.removeChild(area.firstChild);
}

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast-${type} toast-show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('toast-show'), 2800);
}

function showBanner(msg, type = 'warn') {
  const el = document.getElementById('compat-banner');
  el.textContent = msg;
  el.className = `compat-banner banner-${type}`;
  el.style.display = 'block';
}


// ═══════════════════════════════════════════════════════════
// BINDING
// ═══════════════════════════════════════════════════════════
function bindAll() {
  document.getElementById('btn-connect').addEventListener('click', toggleConnection);
  document.getElementById('btn-copy').addEventListener('click', copyPrescription);
  document.getElementById('btn-save').addEventListener('click', saveMeasurement);
  document.getElementById('btn-clear').addEventListener('click', clearDisplay);
  document.getElementById('btn-send').addEventListener('click', sendToCV3000);
  document.getElementById('btn-prefill').addEventListener('click', prefillFromReceived);
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-clear-history').addEventListener('click', clearHistory);

  const rxInput = document.getElementById('rx-input');
  rxInput.addEventListener('input', liveParseRx);
  rxInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendToCV3000(); });

  document.getElementById('baud-select').addEventListener('change', e => {
    baudRate = parseInt(e.target.value, 10);
    localStorage.setItem('cv3000_baud', baudRate);
  });

  const savedBaud = localStorage.getItem('cv3000_baud');
  if (savedBaud) {
    document.getElementById('baud-select').value = savedBaud;
    baudRate = parseInt(savedBaud, 10);
  }
}
