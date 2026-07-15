/**
 * Shadowloop cloud sync — Google Apps Script backend
 *
 * Stores the app's full JSON snapshot in a sheet named "shadowloop_data",
 * split across rows in column A (a single cell tops out at 50k characters).
 * Column B row 1 holds the last-updated timestamp, for humans.
 *
 * Deploy as a Web App:  execute as "Me", access "Anyone".
 * See SYNC-SETUP.md in the repo root for step-by-step instructions.
 */

var SHEET_NAME = 'shadowloop_data';
var CHUNK = 40000;

function doGet() {
  return jsonOut({ ok: true, data: readData() });
}

function doPost(e) {
  var text = e && e.postData && e.postData.contents;
  if (!text) return jsonOut({ ok: false, error: 'empty body' });
  try { JSON.parse(text); } catch (err) { return jsonOut({ ok: false, error: 'invalid JSON' }); }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    writeData(text);
  } finally {
    lock.releaseLock();
  }
  return jsonOut({ ok: true });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function writeData(text) {
  var sh = getSheet();
  sh.clearContents();
  var rows = [];
  for (var i = 0; i < text.length; i += CHUNK) rows.push([text.slice(i, i + CHUNK)]);
  sh.getRange(1, 1, rows.length, 1).setValues(rows);
  sh.getRange(1, 2).setValue(new Date());
}

function readData() {
  var sh = getSheet();
  var last = sh.getLastRow();
  if (!last) return null;
  var text = sh.getRange(1, 1, last, 1).getValues().map(function (r) { return r[0]; }).join('');
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}
