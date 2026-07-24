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

function doGet(e) {
  // ?meta=<page url> — read a podcast episode page server-side (no browser CORS)
  // and hand back its title, cover image and playable audio URL.
  if (e && e.parameter && e.parameter.meta) {
    return jsonOut({ ok: true, meta: fetchMeta(e.parameter.meta) });
  }
  return jsonOut({ ok: true, data: readData() });
}

function fetchMeta(pageUrl) {
  try {
    var resp = UrlFetchApp.fetch(pageUrl, { muteHttpExceptions: true, followRedirects: true });
    var html = resp.getContentText();
    return {
      title: metaContent(html, 'og:title') || titleTag(html) || '',
      image: absUrl(pageUrl, metaContent(html, 'og:image')),
      audio: absUrl(pageUrl, metaContent(html, 'og:audio:secure_url') ||
                            metaContent(html, 'og:audio') ||
                            firstAudioUrl(html))
    };
  } catch (err) {
    return { error: String(err) };
  }
}

// Pull a <meta property|name="<prop>" content="..."> value, either attribute order.
function metaContent(html, prop) {
  var p = prop.replace(/[:.]/g, '\\$&');
  var m = new RegExp('<meta[^>]+(?:property|name)\\s*=\\s*["\']' + p + '["\'][^>]*?content\\s*=\\s*["\']([^"\']*)["\']', 'i').exec(html);
  if (!m) m = new RegExp('<meta[^>]+content\\s*=\\s*["\']([^"\']*)["\'][^>]*?(?:property|name)\\s*=\\s*["\']' + p + '["\']', 'i').exec(html);
  return m ? decodeEntities(m[1]) : '';
}

function titleTag(html) {
  var m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1].replace(/\s+/g, ' ').trim()) : '';
}

// Last-resort: first direct audio file linked anywhere in the markup.
function firstAudioUrl(html) {
  var m = /https?:\/\/[^"'\s<>]+\.(?:mp3|m4a|aac|ogg|opus)(?:\?[^"'\s<>]*)?/i.exec(html);
  return m ? m[0] : '';
}

function absUrl(base, u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  try {
    var root = base.match(/^https?:\/\/[^\/]+/)[0];
    if (u.charAt(0) === '/') return root + u;
    var dir = base.replace(/[?#].*$/, '').replace(/\/[^\/]*$/, '/');
    return dir + u;
  } catch (e) { return u; }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
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
