const MAIN_SHEET = 'R_OP02_JM';
const TZ = 'America/Argentina/San_Juan';
const DATE_FORMAT = 'dd/MM/yyyy';
const ALLOWED_PROJECTS = ['JOSE MARIA', 'FILO DEL SOL'];

/**
 * Ejecutar UNA VEZ desde el editor de Apps Script vinculado a "Registro para operarios".
 * Configura el ID de la planilla, crea una carpeta de firmas, genera un secreto,
 * fija la zona horaria y normaliza la columna Fecha a fechas reales dd/MM/yyyy.
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

  const normalizedDates = normalizeDateColumn_();
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
  const changed = normalizeDateColumn_();
  console.log('Fechas normalizadas: ' + changed);
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

function valuesFromSingleColumnSheet_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 1) return [];
  return unique_(sheet.getRange(1, 1, sheet.getLastRow(), 1).getDisplayValues().flat().map(clean_));
}

function bootstrap_() {
  const ss = ss_();

  const equipos = rows_('EQUIPOS').slice(1)
    .filter(r => clean_(r[0]))
    .map(r => ({ id: clean_(r[0]), equipo: clean_(r[1]) }));

  const operadores = unique_(rows_('OPERADORES').slice(1)
    .map(r => clean_(r[1])));

  const supervisoresDelta = unique_(rows_('SUPERVISORES').slice(1)
    .map(r => clean_(r[1])));

  const tareas = rows_('Tareas').slice(1)
    .filter(r => clean_(r[2]))
    .map(r => ({ id: clean_(r[0]), tipoEquipo: clean_(r[1]), tarea: clean_(r[2]) }));

  let areas = valuesFromSingleColumnSheet_('Area de trabajo');
  let supervisoresCliente = valuesFromSingleColumnSheet_('Supervisor vial cliente');

  const mainSheet = ss.getSheetByName(MAIN_SHEET);
  if (!mainSheet) throw new Error('No existe la hoja ' + MAIN_SHEET);
  const main = mainSheet.getDataRange().getValues();
  const h = headerMap_(main[0]);
  const states = {};
  const fallbackAreas = {};
  const fallbackSupCli = {};

  main.slice(1).forEach((r, i) => {
    const interno = clean_(r[h['Interno']]);
    if (!interno) return;
    const fecha = dateISO_(r[h['Fecha']]);
    const part = num_(r[h['N° Parte']]);
    const hf = num_(r[h['Horómetro final']]);

    const area = clean_(r[h['Area de trabajo']]);
    if (area) fallbackAreas[area] = 1;
    const sc = clean_(r[h['Supervisor Vial Cliente']]);
    if (sc) fallbackSupCli[sc] = 1;

    const prev = states[interno];
    if (!prev || fecha > prev.fechaUltimoRegistro || (fecha === prev.fechaUltimoRegistro && i > prev._i)) {
      states[interno] = { interno, ultimoNumeroParte: part, ultimoHorometroFinal: hf, fechaUltimoRegistro: fecha, _i: i };
    }
  });

  if (!areas.length) areas = Object.keys(fallbackAreas).sort();
  if (!supervisoresCliente.length) supervisoresCliente = Object.keys(fallbackSupCli).sort();

  const equipmentState = Object.values(states).map(s => {
    const copy = Object.assign({}, s);
    delete copy._i;
    return copy;
  });

  return {
    project: 'JOSE MARIA',
    projects: ALLOWED_PROJECTS,
    equipos,
    operadores,
    supervisoresDelta,
    supervisoresCliente,
    tareas,
    unidades: [],
    areas,
    equipmentState
  };
}

function createRecord_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ss_().getSheetByName(MAIN_SHEET);
    if (!sheet) throw new Error('No existe la hoja ' + MAIN_SHEET);
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const h = headerMap_(headers);

    const id = clean_(body.id || (body.payload && body.payload.ID));
    if (!id) throw new Error('ID requerido');

    const idCol = h['ID'];
    if (idCol === undefined) throw new Error('No existe la columna ID en ' + MAIN_SHEET + '.');
    for (let i = 1; i < values.length; i++) {
      if (clean_(values[i][idCol]) === id) {
        return { ok: true, duplicate: true, record: rowToRecord_(headers, values[i]) };
      }
    }

    const p = Object.assign({}, body.payload || {});
    p.ID = id;

    [
      'Fecha', 'Interno', 'Equipo', 'Operador', 'Supervisor Delta', 'Supervisor Vial Cliente',
      'Turno de trabajo', 'Proyecto', 'Area de trabajo', 'Cambio de tareas planificadas',
      'Información sobre Desgaste', 'Combustible', 'Aceite'
    ].forEach(name => requireText_(p, name));

    if (ALLOWED_PROJECTS.indexOf(clean_(p.Proyecto)) === -1) {
      throw new Error('Proyecto inválido. Debe ser JOSE MARIA o FILO DEL SOL.');
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
        best = { fecha: rf, i, part: num_(r[h['N° Parte']]), hf: num_(r[h['Horómetro final']]) };
      }
    }

    if (!best || best.part == null || best.hf == null) {
      throw new Error('No existe una referencia previa válida de N° Parte y Horómetro final para ' + interno + '.');
    }

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

  const sheet = ss_().getSheetByName(MAIN_SHEET);
  if (!sheet) throw new Error('No existe la hoja ' + MAIN_SHEET);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return { ok: true, found: false };

  const headers = values[0];
  const h = headerMap_(headers);
  const idCol = h['ID'];
  if (idCol === undefined) throw new Error('No existe la columna ID en ' + MAIN_SHEET + '.');

  for (let i = values.length - 1; i >= 1; i--) {
    if (clean_(values[i][idCol]) === id) {
      return { ok: true, found: true, record: rowToRecord_(headers, values[i]) };
    }
  }
  return { ok: true, found: false };
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

function normalizeDateColumn_() {
  const ss = ss_();
  const sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const h = headerMap_(headers);
  if (h['Fecha'] === undefined) throw new Error('No existe la columna Fecha.');

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
