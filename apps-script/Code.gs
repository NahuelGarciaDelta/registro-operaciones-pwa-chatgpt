const TZ = 'America/Argentina/San_Juan';
const DATE_FORMAT = 'dd/MM/yyyy';
const ALLOWED_PROJECTS = ['JOSE MARIA', 'FILO DEL SOL'];
const PROJECT_CONFIG = {
  'JOSE MARIA': {
    mainSheet: 'R_OP02_JM',
    equiposSheet: 'EQUIPOS JM',
    supervisoresSheet: 'SUPERVISORES JM',
    supervisoresClienteSheet: 'SUPERVISOR VIAL CLIENTE JM'
  },
  'FILO DEL SOL': {
    mainSheet: 'R_OP02_FS',
    equiposSheet: 'EQUIPOS FS',
    supervisoresSheet: 'SUPERVISORES FS',
    supervisoresClienteSheet: 'SUPERVISOR VIAL CLIENTE FS'
  }
};

/**
 * Ejecutar UNA VEZ desde el editor de Apps Script vinculado a "Registro para operarios".
 * Configura el ID de la planilla, crea una carpeta de firmas, genera un secreto,
 * fija la zona horaria y normaliza las columnas Fecha de JM y FS.
 */
function setupProject() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Este script debe estar vinculado a la planilla Registro para operarios.');

  ss.setSpreadsheetTimeZone(TZ);

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());

  let secret = props.getProperty('API_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('API_SECRET', secret);
  }

  let folderId = props.getProperty('SIGNATURES_FOLDER_ID');
  if (!folderId) {
    const folder = DriveApp.createFolder('Firmas ROP02 - ' + ss.getName());
    folderId = folder.getId();
    props.setProperty('SIGNATURES_FOLDER_ID', folderId);
  }

  const normalizedDates = normalizeDateColumns_();
  const result = {
    spreadsheetId: ss.getId(),
    signaturesFolderId: folderId,
    apiSecret: secret,
    normalizedDates
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function normalizeDateColumn() {
  const changed = normalizeDateColumns_();
  console.log(JSON.stringify(changed));
  return changed;
}

function doGet(e) {
  try {
    assertSecret_(e.parameter.secret);
    const action = e.parameter.action || 'bootstrap';
    if (action === 'health') return json_({ ok: true });
    if (action === 'bootstrap') return json_(bootstrap_());
    throw new Error('Acción no válida');
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    assertSecret_(body.secret);
    if (body.action === 'createRecord') return json_(createRecord_(body));
    if (body.action === 'checkRecord') return json_(checkRecord_(body.id));
    if (body.action === 'listReceipts') return json_(listReceipts_(body.operator));
    throw new Error('Acción no válida');
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function props_() {
  const p = PropertiesService.getScriptProperties();
  return {
    spreadsheetId: p.getProperty('SPREADSHEET_ID'),
    folderId: p.getProperty('SIGNATURES_FOLDER_ID'),
    secret: p.getProperty('API_SECRET')
  };
}

function assertSecret_(secret) {
  const expected = props_().secret;
  if (!expected) throw new Error('API_SECRET no configurado. Ejecutá setupProject() una vez.');
  if (!secret || secret !== expected) throw new Error('No autorizado');
}

function ss_() {
  const id = props_().spreadsheetId;
  if (!id) throw new Error('SPREADSHEET_ID no configurado. Ejecutá setupProject() una vez.');
  return SpreadsheetApp.openById(id);
}

function rows_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('No existe la hoja: ' + name);
  return sheet.getDataRange().getValues();
}

function clean_(v) { return v == null ? '' : String(v).trim(); }
function unique_(arr) { return [...new Set(arr.filter(Boolean))]; }

function projectConfig_(project) {
  const key = clean_(project);
  const cfg = PROJECT_CONFIG[key];
  if (!cfg) throw new Error('Proyecto inválido. Debe ser JOSE MARIA o FILO DEL SOL.');
  return cfg;
}

function valuesFromSingleColumnSheet_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 1) return [];
  return unique_(sheet.getRange(1, 1, sheet.getLastRow(), 1).getDisplayValues().flat().map(clean_));
}

function equipmentStateFromSheet_(sheetName) {
  const sheet = ss_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 1) return [];
  const main = sheet.getDataRange().getValues();
  if (!main.length) return [];
  const h = headerMap_(main[0]);
  if (h['Interno'] === undefined) return [];

  const states = {};
  main.slice(1).forEach((r, i) => {
    const interno = clean_(r[h['Interno']]);
    if (!interno) return;
    const fecha = dateISO_(r[h['Fecha']]);
    const part = num_(r[h['N° Parte']]);
    const hf = num_(r[h['Horómetro final']]);
    const turno = clean_(r[h['Turno de trabajo']]);
    const prev = states[interno];
    if (!prev || fecha > prev.fechaUltimoRegistro || (fecha === prev.fechaUltimoRegistro && i > prev._i)) {
      states[interno] = {
        interno,
        ultimoNumeroParte: part,
        ultimoHorometroFinal: hf,
        fechaUltimoRegistro: fecha,
        ultimoTurno: turno || null,
        _i: i
      };
    }
  });

  return Object.values(states).map(s => {
    const copy = Object.assign({}, s);
    delete copy._i;
    return copy;
  });
}

function projectCatalog_(project) {
  const cfg = projectConfig_(project);
  const equipos = rows_(cfg.equiposSheet).slice(1)
    .filter(r => clean_(r[0]))
    .map(r => ({ id: clean_(r[0]), equipo: clean_(r[1]) }));

  const supervisoresDelta = unique_(rows_(cfg.supervisoresSheet).slice(1)
    .map(r => clean_(r[1])));

  const supervisoresCliente = valuesFromSingleColumnSheet_(cfg.supervisoresClienteSheet);

  return {
    equipos,
    supervisoresDelta,
    supervisoresCliente,
    equipmentState: equipmentStateFromSheet_(cfg.mainSheet)
  };
}

function bootstrap_() {
  const operadores = unique_(rows_('OPERADORES').slice(1).map(r => clean_(r[1])));
  const tareas = rows_('Tareas').slice(1)
    .filter(r => clean_(r[2]))
    .map(r => ({ id: clean_(r[0]), tipoEquipo: clean_(r[1]), tarea: clean_(r[2]) }));
  let areas = valuesFromSingleColumnSheet_('Area de trabajo');

  if (!areas.length) {
    const fallbackAreas = {};
    ALLOWED_PROJECTS.forEach(project => {
      const cfg = projectConfig_(project);
      const values = rows_(cfg.mainSheet);
      if (!values.length) return;
      const h = headerMap_(values[0]);
      if (h['Area de trabajo'] === undefined) return;
      values.slice(1).forEach(r => {
        const area = clean_(r[h['Area de trabajo']]);
        if (area) fallbackAreas[area] = 1;
      });
    });
    areas = Object.keys(fallbackAreas).sort();
  }

  const jm = projectCatalog_('JOSE MARIA');
  const fs = projectCatalog_('FILO DEL SOL');

  return {
    project: 'JOSE MARIA',
    projects: ALLOWED_PROJECTS,
    projectCatalogs: {
      'JOSE MARIA': jm,
      'FILO DEL SOL': fs
    },
    // Compatibilidad con cachés/frontend anteriores: estos campos representan JM.
    equipos: jm.equipos,
    operadores,
    supervisoresDelta: jm.supervisoresDelta,
    supervisoresCliente: jm.supervisoresCliente,
    tareas,
    unidades: [],
    areas,
    equipmentState: jm.equipmentState
  };
}

function createRecord_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const id = clean_(body.id || (body.payload && body.payload.ID));
    if (!id) throw new Error('ID requerido');

    const p = Object.assign({}, body.payload || {});
    p.ID = id;
    requireText_(p, 'Proyecto');
    p.Proyecto = clean_(p.Proyecto);
    const cfg = projectConfig_(p.Proyecto);

    const sheet = ss_().getSheetByName(cfg.mainSheet);
    if (!sheet) throw new Error('No existe la hoja ' + cfg.mainSheet);
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const idCol = ensureIdColumn_(sheet, headers);
    headers[idCol] = 'ID';
    const h = headerMap_(headers);

    for (let i = 1; i < values.length; i++) {
      if (clean_(values[i][idCol]) === id) {
        return { ok: true, duplicate: true, record: rowToRecord_(headers, values[i]) };
      }
    }

    const legacyMatch = findLegacyPendingRow_(values, h, p, idCol);
    if (legacyMatch !== null) {
      sheet.getRange(legacyMatch + 1, idCol + 1).setValue(id);
      values[legacyMatch][idCol] = id;
      SpreadsheetApp.flush();
      return { ok: true, recoveredLegacy: true, record: rowToRecord_(headers, values[legacyMatch]) };
    }

    [
      'Fecha', 'Interno', 'Equipo', 'Operador', 'Supervisor Delta', 'Supervisor Vial Cliente',
      'Turno de trabajo', 'Area de trabajo', 'Cambio de tareas planificadas',
      'Información sobre Desgaste', 'Combustible', 'Aceite'
    ].forEach(name => requireText_(p, name));

    const validEquipos = rows_(cfg.equiposSheet).slice(1).map(r => clean_(r[0])).filter(Boolean);
    if (validEquipos.indexOf(clean_(p.Interno)) === -1) {
      throw new Error('El equipo ' + clean_(p.Interno) + ' no pertenece al proyecto ' + p.Proyecto + '.');
    }

    const validSupDelta = unique_(rows_(cfg.supervisoresSheet).slice(1).map(r => clean_(r[1])));
    if (validSupDelta.indexOf(clean_(p['Supervisor Delta'])) === -1) {
      throw new Error('Supervisor Delta inválido para el proyecto ' + p.Proyecto + '.');
    }

    const validSupCliente = valuesFromSingleColumnSheet_(cfg.supervisoresClienteSheet);
    if (validSupCliente.indexOf(clean_(p['Supervisor Vial Cliente'])) === -1) {
      throw new Error('Supervisor Vial Cliente inválido para el proyecto ' + p.Proyecto + '.');
    }

    const interno = clean_(p.Interno);
    const fecha = dateISO_(p.Fecha);
    if (!fecha) throw new Error('Fecha inválida.');
    p.Fecha = fecha;

    let best = null;
    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      if (clean_(r[h['Interno']]) !== interno) continue;
      const rf = dateISO_(r[h['Fecha']]);
      if (!rf || rf > fecha) continue;
      if (!best || rf > best.fecha || (rf === best.fecha && i > best.i)) {
        best = {
          fecha: rf,
          i,
          part: num_(r[h['N° Parte']]),
          hf: num_(r[h['Horómetro final']]),
          turno: clean_(r[h['Turno de trabajo']])
        };
      }
    }

    if (!best || best.part == null || best.hf == null) {
      throw new Error('No existe una referencia previa válida de N° Parte y Horómetro final para ' + interno + ' en ' + p.Proyecto + '.');
    }

    const turno = clean_(p['Turno de trabajo']);
    if (['TURNO DIA', 'TURNO NOCHE'].indexOf(turno) === -1) {
      throw new Error('Turno inválido. Debe ser TURNO DIA o TURNO NOCHE.');
    }
    if (turno === 'TURNO NOCHE' && best.turno !== 'TURNO DIA') {
      const anterior = best.turno || 'sin turno informado';
      throw new Error('No se puede cargar TURNO NOCHE para ' + interno + '. El registro anterior debe ser TURNO DIA y actualmente figura como ' + anterior + '.');
    }
    p['Turno de trabajo'] = turno;

    p['N° Parte'] = best.part + 1;
    p['Horómetro inicial'] = best.hf;

    const hi = int_(p['Horómetro inicial']);
    const hf = int_(p['Horómetro final']);
    if (hi == null) throw new Error('Horómetro inicial inválido. Debe ser un número entero.');
    if (hf == null) throw new Error('Horómetro final requerido y debe ser un número entero.');
    if (hf < hi) throw new Error('El horómetro final no puede ser menor al inicial.');
    p['Horómetro inicial'] = hi;
    p['Horómetro final'] = hf;

    if (hf === hi) {
      const estado = clean_(p['OD o FS']);
      if (['OD', 'FS', 'EM'].indexOf(estado) === -1) {
        throw new Error('Como el horómetro inicial y final son iguales, debe indicarse OD, FS o EM.');
      }
      const textos = {
        OD: 'Equipo operativo a disposición',
        FS: 'Equipo fuera de servicio',
        EM: 'Equipo en mantenimiento programado'
      };
      p['OD o FS'] = estado;
      p['Cant. Hs.'] = 0;
      p['Tarea 1'] = textos[estado];
      p['Observaciones 1'] = textos[estado];
      p['Tarea 2'] = '';
      p['Observaciones 2'] = '';
      p['Combustible'] = 'Sin carga';
      p['Aceite'] = 'Sin carga';
    } else {
      p['OD o FS'] = '';
      p['Cant. Hs.'] = hf - hi;
      requireText_(p, 'Tarea 1');
      requireText_(p, 'Observaciones 1');
    }

    if (!body.signatureDataUrl) throw new Error('La firma es obligatoria.');
    p.Firma = saveSignature_(body.signatureDataUrl, fecha, interno, id);

    const dateObj = dateFromISO_(p.Fecha);
    const row = headers.map(raw => {
      const key = clean_(raw);
      if (key === 'Fecha') return dateObj;
      return p[key] !== undefined ? p[key] : '';
    });

    sheet.appendRow(row);
    const appendedRow = sheet.getLastRow();

    if (h['Fecha'] !== undefined) {
      sheet.getRange(appendedRow, h['Fecha'] + 1)
        .setValue(dateObj)
        .setNumberFormat(DATE_FORMAT);
    }

    ['N° Parte', 'Horómetro inicial', 'Horómetro final', 'Cant. Hs.'].forEach(name => {
      if (h[name] !== undefined) sheet.getRange(appendedRow, h[name] + 1).setNumberFormat('0');
    });

    SpreadsheetApp.flush();
    return { ok: true, record: p };
  } finally {
    lock.releaseLock();
  }
}

function checkRecord_(rawId) {
  const id = clean_(rawId);
  if (!id) throw new Error('ID requerido');

  for (const project of ALLOWED_PROJECTS) {
    const cfg = projectConfig_(project);
    const sheet = ss_().getSheetByName(cfg.mainSheet);
    if (!sheet || sheet.getLastRow() < 1) continue;
    const values = sheet.getDataRange().getValues();
    if (!values.length) continue;
    const headers = values[0];
    const idCol = ensureIdColumn_(sheet, headers);
    headers[idCol] = 'ID';

    for (let i = values.length - 1; i >= 1; i--) {
      if (clean_(values[i][idCol]) === id) {
        return { ok: true, found: true, record: rowToRecord_(headers, values[i]) };
      }
    }
  }
  return { ok: true, found: false };
}

function listReceipts_(rawOperator) {
  const operator = clean_(rawOperator);
  if (!operator) throw new Error('Operador requerido para consultar comprobantes.');

  const receipts = [];
  ALLOWED_PROJECTS.forEach((project, projectIndex) => {
    const cfg = projectConfig_(project);
    const sheet = ss_().getSheetByName(cfg.mainSheet);
    if (!sheet || sheet.getLastRow() < 1) return;
    const values = sheet.getDataRange().getValues();
    if (!values.length) return;

    const headers = values[0];
    const idCol = ensureIdColumn_(sheet, headers);
    headers[idCol] = 'ID';
    const h = headerMap_(headers);
    const required = ['Fecha', 'Interno', 'Equipo', 'Operador', 'Turno de trabajo', 'N° Parte', 'Proyecto', 'Area de trabajo', 'Horómetro inicial', 'Horómetro final', 'Cant. Hs.', 'OD o FS'];
    required.forEach(name => {
      if (h[name] === undefined) throw new Error('Falta la columna ' + name + ' en ' + cfg.mainSheet + '.');
    });

    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      if (clean_(r[h['Operador']]) !== operator) continue;
      const record = rowToRecord_(headers, r);
      const interno = clean_(record.Interno);
      const parte = int_(record['N° Parte']);
      if (!interno || parte == null) continue;

      receipts.push({
        id: clean_(record.ID) || (cfg.mainSheet + '-ROW-' + (i + 1)),
        codigo: receiptCode_(record, i + 1, cfg.mainSheet),
        fecha: dateISO_(record.Fecha),
        operador: clean_(record.Operador),
        interno,
        equipo: clean_(record.Equipo),
        turno: clean_(record['Turno de trabajo']),
        parte,
        proyecto: clean_(record.Proyecto) || project,
        area: clean_(record['Area de trabajo']),
        hi: int_(record['Horómetro inicial']),
        hf: int_(record['Horómetro final']),
        horas: num_(record['Cant. Hs.']),
        estado: clean_(record['OD o FS']),
        _rowNumber: i + 1,
        _projectIndex: projectIndex
      });
    }
  });

  receipts.sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    if (a._projectIndex !== b._projectIndex) return b._projectIndex - a._projectIndex;
    return b._rowNumber - a._rowNumber;
  });

  receipts.forEach(r => {
    delete r._rowNumber;
    delete r._projectIndex;
  });
  return { ok: true, operator, receipts };
}

function receiptCode_(record, rowNumber, sheetName) {
  const interno = clean_(record.Interno);
  const parte = int_(record['N° Parte']);
  const compactInternal = interno.replace(/[^A-Za-z0-9]/g, '');
  const id = clean_(record.ID).replace(/-/g, '');
  let token = id ? id.slice(0, 6).toUpperCase() : '';

  if (!token) {
    const source = [
      sheetName || '', dateISO_(record.Fecha), interno, parte == null ? '' : parte,
      clean_(record.Operador), clean_(record['Turno de trabajo']), clean_(record.Proyecto),
      int_(record['Horómetro inicial']), int_(record['Horómetro final']), rowNumber
    ].join('|');
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, source, Utilities.Charset.UTF_8);
    token = digest.slice(0, 3).map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('').toUpperCase();
  }

  return `ROP02-${compactInternal}-${parte == null ? 'SREF' : parte}-${token}`;
}

function ensureIdColumn_(sheet, headers) {
  const h = headerMap_(headers);
  if (h['ID'] !== undefined) return h['ID'];

  const fechaCol = h['Fecha'];
  const internoCol = h['Interno'];
  if (fechaCol !== undefined && internoCol === fechaCol + 2 && !clean_(headers[fechaCol + 1])) {
    const idCol = fechaCol + 1;
    sheet.getRange(1, idCol + 1).setValue('ID');
    return idCol;
  }

  throw new Error('No existe la columna ID ni un espacio vacío entre Fecha e Interno en ' + sheet.getName() + '.');
}

function findLegacyPendingRow_(values, h, p, idCol) {
  const target = {
    fecha: dateISO_(p.Fecha),
    interno: clean_(p.Interno),
    parte: int_(p['N° Parte']),
    hi: int_(p['Horómetro inicial']),
    hf: int_(p['Horómetro final']),
    operador: clean_(p.Operador),
    turno: clean_(p['Turno de trabajo'])
  };

  if (!target.fecha || !target.interno || target.parte == null || target.hi == null || target.hf == null) return null;

  const matches = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (clean_(r[idCol])) continue;
    if (clean_(r[h['Interno']]) !== target.interno) continue;
    if (dateISO_(r[h['Fecha']]) !== target.fecha) continue;
    if (int_(r[h['N° Parte']]) !== target.parte) continue;
    if (int_(r[h['Horómetro inicial']]) !== target.hi) continue;
    if (int_(r[h['Horómetro final']]) !== target.hf) continue;
    if (clean_(r[h['Operador']]) !== target.operador) continue;
    if (clean_(r[h['Turno de trabajo']]) !== target.turno) continue;
    matches.push(i);
  }

  return matches.length === 1 ? matches[0] : null;
}

function requireText_(obj, name) {
  if (!clean_(obj[name])) throw new Error(name + ' es obligatorio.');
}

function saveSignature_(dataUrl, fecha, interno, id) {
  const folderId = props_().folderId;
  if (!folderId) throw new Error('SIGNATURES_FOLDER_ID no configurado.');
  const m = String(dataUrl).match(/^data:image\/png;base64,(.+)$/);
  if (!m) throw new Error('Firma PNG inválida');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[1]), 'image/png', `${fecha}_${interno}_${id}.png`);
  const file = DriveApp.getFolderById(folderId).createFile(blob);
  return file.getId();
}

function headerMap_(headers) {
  const m = {};
  headers.forEach((x, i) => m[clean_(x)] = i);
  return m;
}

function num_(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function int_(v) {
  const n = num_(v);
  return n != null && Number.isInteger(n) ? n : null;
}

function dateFromISO_(iso) {
  const value = dateISO_(iso);
  if (!value) throw new Error('Fecha inválida: ' + clean_(iso));
  return Utilities.parseDate(value + ' 12:00:00', TZ, 'yyyy-MM-dd HH:mm:ss');
}

function dateISO_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }

  const value = clean_(v);
  let m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return '';
}

function normalizeDateColumns_() {
  const result = {};
  ALLOWED_PROJECTS.forEach(project => {
    const cfg = projectConfig_(project);
    result[cfg.mainSheet] = normalizeDateColumnInSheet_(cfg.mainSheet);
  });
  return result;
}

function normalizeDateColumnInSheet_(sheetName) {
  const sheet = ss_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const h = headerMap_(headers);
  if (h['Fecha'] === undefined) throw new Error('No existe la columna Fecha en ' + sheetName + '.');

  const range = sheet.getRange(2, h['Fecha'] + 1, sheet.getLastRow() - 1, 1);
  const values = range.getValues();
  let changed = 0;

  const normalized = values.map(row => {
    const value = row[0];
    if (value instanceof Date && !isNaN(value.getTime())) return [value];
    const iso = dateISO_(value);
    if (!iso) return [value];
    changed++;
    return [dateFromISO_(iso)];
  });

  range.setValues(normalized);
  range.setNumberFormat(DATE_FORMAT);
  SpreadsheetApp.flush();
  return changed;
}

function rowToRecord_(headers, row) {
  const o = {};
  headers.forEach((x, i) => {
    const key = clean_(x);
    o[key] = key === 'Fecha' ? dateISO_(row[i]) : row[i];
  });
  return o;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
