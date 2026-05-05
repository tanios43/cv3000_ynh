/**
 * cv3000-serial.js
 * Gère la communication série via Web Serial API (Chrome/Edge).
 * Parseurs KB-1DS et STD1 portés fidèlement depuis cv3000_interface.pyw.
 */

// ═══════════════════════════════════════════════════════════
// PARSEURS — portage JS depuis Python
// ═══════════════════════════════════════════════════════════

function _parseKb1dsValue(s) {
  if (s == null) return null;
  s = s.trim().replace(/\s/g, '');
  if (!s || s === '-' || s === '+') return null;
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

function _isPd(valStr) {
  if (valStr == null) return false;
  const v = parseFloat(valStr);
  return !valStr.startsWith('+') && v >= 20;
}

function _parseSection(lines) {
  const od = {}, os = {};
  let pd = null;

  const PAT_FULL = /^(FR|FL|NR|NL)\s*([+-]?\s*\d+\.\d{2})([+-]\s*\d+\.\d{2})\s*(\d{1,3})\s*$/i;
  const PAT_SPH  = /^(FR|FL|NR|NL)\s*([+-]?\s*\d+\.\d+)\s*$/i;
  const PAT_PD   = /^PD\s*([0-9.]+)/i;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // PD
    const mPd = line.match(PAT_PD);
    if (mPd) {
      const v = _parseKb1dsValue(mPd[1]);
      if (v != null && v >= 20) pd = v;
      continue;
    }

    // Sphère + cylindre + axe
    const m = line.match(PAT_FULL);
    if (m) {
      const tag = m[1].toUpperCase();
      const sph = _parseKb1dsValue(m[2]);
      const cyl = _parseKb1dsValue(m[3]);
      const ax  = parseInt(m[4], 10);
      if (sph == null) continue;
      if      (tag === 'FR') { od.sph = sph; od.cyl = cyl; od.ax = ax; }
      else if (tag === 'FL') { os.sph = sph; os.cyl = cyl; os.ax = ax; }
      else if (tag === 'NR' && od.sph != null) {
        const add = Math.round((sph - od.sph) * 100) / 100;
        if (add > 0) od.add = add;
      }
      else if (tag === 'NL' && os.sph != null) {
        const add = Math.round((sph - os.sph) * 100) / 100;
        if (add > 0) os.add = add;
      }
      continue;
    }

    // Sphère seule
    const m2 = line.match(PAT_SPH);
    if (m2) {
      const tag = m2[1].toUpperCase();
      const sph = _parseKb1dsValue(m2[2]);
      if (sph == null) continue;
      if      (tag === 'FR') { od.sph = sph; }
      else if (tag === 'FL') { os.sph = sph; }
      else if (tag === 'NR' && od.sph != null) {
        const add = Math.round((sph - od.sph) * 100) / 100;
        if (add > 0) od.add = add;
      }
      else if (tag === 'NL' && os.sph != null) {
        const add = Math.round((sph - os.sph) * 100) / 100;
        if (add > 0) os.add = add;
      }
    }
  }

  return { od, os, pd };
}

export function parseKb1ds(rawText) {
  const lines = rawText.replace(/\r/g, '\n').split('\n');
  const sections = {};
  let i = 0;

  while (i < lines.length) {
    if (lines[i].trim() === '*' && i + 1 < lines.length) {
      const tag = lines[i + 1].trim().toUpperCase();
      if (tag && tag.length <= 4 && tag !== '\x04') {
        const sectionLines = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim() !== '*') {
          sectionLines.push(lines[j]);
          j++;
        }
        sections[tag] = sectionLines;
        i = j;
        continue;
      }
    }
    i++;
  }

  if (Object.keys(sections).length === 0) return null;

  let od = {}, os = {}, pd = null;

  for (const tag of ['CV', 'FC', 'RM']) {
    if (sections[tag]) {
      const res = _parseSection(sections[tag]);
      if (Object.keys(res.od).length || Object.keys(res.os).length) {
        od = res.od; os = res.os;
        if (res.pd != null) pd = res.pd;
        break;
      }
    }
  }

  // Chercher PD dans toutes les sections si absent
  if (pd == null) {
    for (const tag of ['CV', 'FC', 'RM']) {
      if (sections[tag]) {
        const res = _parseSection(sections[tag]);
        if (res.pd != null) { pd = res.pd; break; }
      }
    }
  }

  if (!Object.keys(od).length && !Object.keys(os).length) return null;

  if (pd != null) {
    if (Object.keys(od).length) od.pd = Math.round(pd / 2 * 10) / 10;
    if (Object.keys(os).length) os.pd = Math.round(pd / 2 * 10) / 10;
  }

  for (const eye of [od, os]) {
    if (!('cyl' in eye)) eye.cyl = null;
    if (!('ax'  in eye)) eye.ax  = null;
    if (!('add' in eye)) eye.add = null;
    if (!('pd'  in eye)) eye.pd  = null;
  }

  return {
    OD: od, OS: os, raw: rawText,
    timestamp: _now(),
    format: 'KB-1DS',
  };
}

export function parseStd1(rawText) {
  const result = { OD: {}, OS: {}, raw: rawText, timestamp: _now(), format: 'STD1' };
  const PAT_OD = /^(?:OD|R)\s+([+-]?\d+\.?\d*)\s+([+-]?\d+\.?\d*)\s+(\d+)(?:\s+([+-]?\d+\.?\d*))?(?:\s+(\d+\.?\d*))?/i;
  const PAT_OS = /^(?:OS|L)\s+([+-]?\d+\.?\d*)\s+([+-]?\d+\.?\d*)\s+(\d+)(?:\s+([+-]?\d+\.?\d*))?(?:\s+(\d+\.?\d*))?/i;

  for (let line of rawText.replace(/\r/g, '\n').split('\n')) {
    line = line.trim();
    for (const [pat, key] of [[PAT_OD, 'OD'], [PAT_OS, 'OS']]) {
      const m = line.match(pat);
      if (!m) continue;
      const g4 = m[4], g5 = m[5];
      let addVal = null, pdVal = null;
      if (g5 != null)       { addVal = parseFloat(g4); pdVal = parseFloat(g5); }
      else if (g4 != null)  { if (_isPd(g4)) pdVal = parseFloat(g4); else addVal = parseFloat(g4); }
      result[key] = {
        sph: parseFloat(m[1]), cyl: parseFloat(m[2]),
        ax:  parseInt(m[3], 10), add: addVal, pd: pdVal,
      };
    }
  }

  return (result.OD && Object.keys(result.OD).length) ||
         (result.OS && Object.keys(result.OS).length) ? result : null;
}

export function parseAny(rawText) {
  if (/\*[\r\n]+(?:CV|RM|FC|KR|CL)[\r\n]/i.test(rawText)) {
    const r = parseKb1ds(rawText);
    if (r) return r;
  }
  return parseStd1(rawText);
}


// ═══════════════════════════════════════════════════════════
// FORMATAGE
// ═══════════════════════════════════════════════════════════

export function fmtDiopter(val) {
  if (val == null) return null;
  return val >= 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
}

export function fmtPrescription(eye) {
  if (!eye || eye.sph == null) return null;
  const sph = fmtDiopter(eye.sph);
  let txt = sph;
  if (eye.cyl != null && eye.ax != null)
    txt += `(${fmtDiopter(eye.cyl)})${eye.ax}°`;
  if (eye.add != null)
    txt += ` Add${fmtDiopter(eye.add)}`;
  return txt;
}

export function buildCopyString(od, os) {
  return `${fmtPrescription(od) ?? '?'}/${fmtPrescription(os) ?? '?'}`;
}


// ═══════════════════════════════════════════════════════════
// CONSTRUCTION TRAME ENVOI (émulation KR/RM)
// ═══════════════════════════════════════════════════════════

export function buildRmStd1Frame(od, os) {
  const fv = v => {
    const sign = v < 0 ? '-' : '+';
    const a = Math.abs(v);
    return a < 10 ? `${sign} ${a.toFixed(2).padStart(4,'0')}` : `${sign}${a.toFixed(2).padStart(5,'0')}`;
  };

  const eyeLine = (tag, data) => {
    if (!data || data.sph == null) return `${tag}${' '.repeat(15)}`;
    let s = fv(data.sph);
    if (data.cyl != null && data.ax != null)
      s += `${fv(data.cyl)}${String(Math.round(data.ax)).padStart(3)}`;
    return `${tag}${s.slice(0, 15).padEnd(15)}`;
  };

  const pdOd = od?.pd, pdOs = os?.pd;
  const pdTotal = (pdOd != null && pdOs != null)
    ? (Math.round((pdOd + pdOs) * 10) / 10).toFixed(1) : null;

  return [
    '@SETRM\r', '*\r', 'RM\r',
    eyeLine('FR', od) + '\r',
    eyeLine('FL', os) + '\r',
    'G  \r',
    (pdTotal ? `PD${pdTotal}` : 'PD').padEnd(10) + '\r',
    'PR            \r', 'PL            \r',
    'NR               \r', 'NL               \r',
    'pR            \r', 'pL            \r',
    '    \r', '*\r', '\x04',
  ].join('');
}


// ═══════════════════════════════════════════════════════════
// WEB SERIAL API
// ═══════════════════════════════════════════════════════════

export class CV3000Serial {
  constructor({ onMeasurement, onRaw, onLog, onStatus }) {
    this._onMeasurement = onMeasurement;
    this._onRaw         = onRaw;
    this._onLog         = onLog;
    this._onStatus      = onStatus;

    this._port    = null;
    this._reader  = null;
    this._reading = false;
    this._buffer  = '';
  }

  get isConnected() {
    return this._port != null && this._port.readable != null;
  }

  /** Ouvre le sélecteur de port natif du navigateur et connecte. */
  async connect(baudRate = 2400) {
    if (!('serial' in navigator)) {
      throw new Error(
        'Web Serial API non disponible. Utilisez Chrome ou Edge (version ≥ 89).'
      );
    }
    try {
      this._port = await navigator.serial.requestPort();
      await this._port.open({
        baudRate,
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        flowControl: 'none',
      });
      this._log(`✓ Port ouvert à ${baudRate} bauds (8N1)`, 'ok');
      this._onStatus(true);
      this._startReading();
    } catch (e) {
      this._port = null;
      if (e.name === 'NotFoundError') {
        this._log('Sélection annulée.', 'warn');
      } else {
        this._log(`✗ Erreur ouverture : ${e.message}`, 'err');
        throw e;
      }
    }
  }

  async disconnect() {
    this._reading = false;
    if (this._reader) {
      try { await this._reader.cancel(); } catch {}
      this._reader = null;
    }
    if (this._port) {
      try { await this._port.close(); } catch {}
      this._port = null;
    }
    this._buffer = '';
    this._onStatus(false);
    this._log('Déconnecté.', 'warn');
  }

  async send(frameStr) {
    if (!this.isConnected) throw new Error('Non connecté.');
    const writer = this._port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(frameStr));
      this._log('✓ Trame envoyée au CV-3000', 'ok');
    } finally {
      writer.releaseLock();
    }
  }

  // ── Lecture continue ─────────────────────────────────────
  async _startReading() {
    this._reading = true;
    const decoder = new TextDecoderStream();
    this._port.readable.pipeTo(decoder.writable).catch(() => {});
    this._reader = decoder.readable.getReader();

    try {
      while (this._reading) {
        const { value, done } = await this._reader.read();
        if (done) break;
        if (value) {
          this._buffer += value;
          this._onRaw(JSON.stringify(value));   // affichage debug

          if (this._buffer.includes('\x04') || this._buffer.includes('#END')) {
            const parsed = parseAny(this._buffer);
            if (parsed) {
              this._onMeasurement(parsed);
            } else {
              this._log('⚠ Trame reçue mais non parsée — voir journal [RAW]', 'warn');
            }
            this._buffer = '';
          }
        }
      }
    } catch (e) {
      if (this._reading) this._log(`✗ Erreur lecture : ${e.message}`, 'err');
    } finally {
      this._onStatus(false);
    }
  }

  _log(msg, level = 'info') {
    this._onLog(msg, level);
  }
}

// ── Utilitaire ───────────────────────────────────────────────
function _now() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
