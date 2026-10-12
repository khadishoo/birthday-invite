// Этот код вставляется в Google Таблицу: Расширения → Apps Script.
// Подробные шаги — в файле ИНСТРУКЦИЯ.md.

var SHEET_RSVP = 'Ответы';
var SHEET_GIFTS = 'Подарки';

function doGet(e) {
  return json_(state_((e.parameter && e.parameter.token) || ''));
}

function doPost(e) {
  // блокировка: два гостя не могут занять один подарок одновременно
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var d = JSON.parse(e.postData.contents);
    var token = clean_(d.token, 80);
    var result = { ok: true };

    if (d.action === 'rsvp') rsvp_(d, token);
    else if (d.action === 'claim') result = claim_(d, token);
    else if (d.action === 'unclaim') unclaim_(d, token);
    else result = { ok: false, error: 'unknown' };

    var st = state_(token);
    st.ok = result.ok;
    if (result.error) st.error = result.error;
    return json_(st);
  } catch (err) {
    return json_({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

function rsvp_(d, token) {
  var sh = sheet_(SHEET_RSVP, ['Дата', 'Имя', 'Ответ', 'Сообщение', 'Код гостя']);
  var row = [new Date(), clean_(d.name, 60), d.attending === 'yes' ? 'Приду' : 'Не приду', clean_(d.message, 600), token];
  var rows = sh.getDataRange().getValues();
  // если гость меняет ответ — обновляем его строку, а не добавляем новую
  for (var i = 1; i < rows.length; i++) {
    if (token && rows[i][4] === token) {
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  sh.appendRow(row);
}

function claim_(d, token) {
  var sh = sheet_(SHEET_GIFTS, ['Код подарка', 'Подарок', 'Кто дарит', 'Дата', 'Код гостя']);
  var id = clean_(d.giftId, 60);
  if (!id || !token) return { ok: false, error: 'bad' };
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === id) {
      return rows[i][4] === token ? { ok: true } : { ok: false, error: 'taken' };
    }
  }
  sh.appendRow([id, clean_(d.giftTitle, 120), clean_(d.name, 60), new Date(), token]);
  return { ok: true };
}

function unclaim_(d, token) {
  var sh = sheet_(SHEET_GIFTS, ['Код подарка', 'Подарок', 'Кто дарит', 'Дата', 'Код гостя']);
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(d.giftId) && rows[i][4] === token) sh.deleteRow(i + 1);
  }
}

// гостям отдаём только коды занятых подарков — без имён
function state_(token) {
  var sh = sheet_(SHEET_GIFTS, ['Код подарка', 'Подарок', 'Кто дарит', 'Дата', 'Код гостя']);
  var rows = sh.getDataRange().getValues();
  var claimed = [], mine = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    claimed.push(String(rows[i][0]));
    if (token && rows[i][4] === token) mine.push(String(rows[i][0]));
  }
  return { ok: true, claimed: claimed, mine: mine };
}

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

// обрезаем длину и не даём тексту гостя превратиться в формулу
function clean_(v, max) {
  var s = String(v == null ? '' : v).trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
