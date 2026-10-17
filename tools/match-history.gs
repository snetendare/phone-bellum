// Match history for No Mans Land, as a Google Apps Script web app bound to a Google Sheet.
// Setup: in the sheet, Extensions > Apps Script, paste this file, save, then Deploy > New deployment >
// Web app, Execute as: Me, Who has access: Anyone. Put the /exec URL in HISTORY_URL in src/site-template.html.
//
// POST (from the hosting phone, once per round): a JSON row, appended to the sheet.
// GET ?n=40: the latest n rows as JSON, newest first.

const COLUMNS = ['time', 'code', 'round', 'map', 'hostChar', 'guestChar', 'winner', 'timeout', 'seconds',
  'dmgHost', 'dmgGuest', 'hpHost', 'hpGuest', 'over', 'matchWinner', 'hostArmy', 'guestArmy', 'hostSkills', 'guestSkills'];
const MAX_CELL = 5000; // keep one junk post from filling a cell

function sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(COLUMNS);
  return sh;
}

function doPost(e) {
  let row;
  try { row = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false }); }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet_().appendRow(COLUMNS.map(k => {
      const v = k === 'time' ? new Date().toISOString() : row[k];
      const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
      return typeof s === 'string' ? s.slice(0, MAX_CELL) : s;
    }));
  } finally { lock.releaseLock(); }
  return out_({ ok: true });
}

function doGet(e) {
  const n = Math.max(1, Math.min(200, Number(e && e.parameter && e.parameter.n) || 40));
  const sh = sheet_(), last = sh.getLastRow();
  if (last < 2) return out_({ rows: [] });
  const first = Math.max(2, last - n + 1);
  const values = sh.getRange(first, 1, last - first + 1, COLUMNS.length).getValues();
  const rows = values.reverse().map(v => Object.fromEntries(COLUMNS.map((k, i) => [k, v[i] instanceof Date ? v[i].toISOString() : v[i]])));
  return out_({ rows });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
