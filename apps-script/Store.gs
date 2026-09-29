/**
 * Document store on top of Google Sheets. Each collection is a tab with columns
 * id | label | updated_at | data, where data is the document as JSON. The label column
 * is only there to make the sheet readable. Cells are plain text so Sheets never turns
 * dates, times or scores into something else.
 */

const MEMELAB_COLLECTIONS = ['templates', 'moments', 'meta'];
const MEMELAB_HEADER = ['id', 'label', 'updated_at', 'data'];

function memelabSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Meme Lab is not set up yet. Run setup() in the Apps Script editor.');
  return SpreadsheetApp.openById(id);
}

function sheetFor_(col) {
  if (MEMELAB_COLLECTIONS.indexOf(col) < 0) throw new Error('Unknown collection: ' + col);
  const sh = memelabSpreadsheet_().getSheetByName(col);
  if (!sh) throw new Error('The "' + col + '" tab is missing. Run setup() again.');
  return sh;
}

function readRows_(sh) {
  const last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, 4).getValues();
}

function parseData_(text) {
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    return null;
  }
}

/** All documents in a collection as [{ id, data }]. Rows with unreadable JSON are skipped. */
function listDocs_(col) {
  return readRows_(sheetFor_(col))
    .filter((r) => r[0] !== '')
    .map((r) => ({ id: String(r[0]), data: parseData_(r[3]) }))
    .filter((d) => d.data);
}

/** Ids only; cheaper than listDocs_ because nothing is parsed. */
function listIds_(col) {
  const sh = sheetFor_(col);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 1).getValues().map((r) => String(r[0])).filter(String);
}

function getDoc_(col, id) {
  return findDoc_(sheetFor_(col), id);
}

function findDoc_(sh, id) {
  const row = readRows_(sh).find((r) => String(r[0]) === id);
  return row ? parseData_(row[3]) : null;
}

function labelFor_(col, id, data) {
  if (col === 'templates') return data.name || '';
  if (col === 'moments') return data.headline || data.description || '';
  return id;
}

/**
 * Writes documents ([{ id, data }]) to a collection tab, replacing ones with the same id.
 * With skipExisting, documents whose id is already there are left alone.
 * Call inside withLock_.
 */
function writeDocs_(sh, col, docs, opts) {
  const skipExisting = !!(opts && opts.skipExisting);
  const rowOf = {};
  readRows_(sh).forEach((r, i) => {
    if (r[0] !== '') rowOf[String(r[0])] = i + 2;
  });
  const now = new Date().toISOString();
  const appends = [];
  const seen = {};
  docs.forEach((d) => {
    if (seen[d.id]) return;
    seen[d.id] = true;
    const row = [d.id, labelFor_(col, d.id, d.data), now, JSON.stringify(d.data)];
    if (rowOf[d.id]) {
      if (!skipExisting) sh.getRange(rowOf[d.id], 1, 1, 4).setNumberFormat('@').setValues([row]);
    } else {
      appends.push(row);
    }
  });
  if (appends.length) {
    const start = sh.getLastRow() + 1;
    const missing = start + appends.length - 1 - sh.getMaxRows();
    if (missing > 0) sh.insertRowsAfter(sh.getMaxRows(), missing);
    sh.getRange(start, 1, appends.length, 4).setNumberFormat('@').setValues(appends);
  }
  return appends.length;
}

/** Call inside withLock_. */
function deleteDoc_(sh, id) {
  const i = readRows_(sh).findIndex((r) => String(r[0]) === id);
  if (i >= 0) sh.deleteRow(i + 2);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}
