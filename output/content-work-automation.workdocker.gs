const CONTENT_WORK_SECRET = 'replace-with-the-same-secret-as-CONTENT_WORK_SCRIPT_SECRET';
const CONTENT_WORK_FORM_PUBLIC_ID = '1FAIpQLScoByE6SGbpYCJ8H0yPtXr-1pQp3QUhtb9RpFd-Q3VmvztKUQ';
const CONTENT_WORK_FORM_VIEW_URL = 'https://docs.google.com/forms/d/e/' + CONTENT_WORK_FORM_PUBLIC_ID + '/viewform';
const CONTENT_WORK_FORM_RESPONSE_URL = 'https://docs.google.com/forms/d/e/' + CONTENT_WORK_FORM_PUBLIC_ID + '/formResponse';
const CONTENT_WORK_SPREADSHEET_ID = '10xgj6260aKTU5tn4WONRF5AccUPRhnoMcWJXyNn023I';
const CONTENT_WORK_TARGET_SHEET_GID = 1639483225;
const CONTENT_WORK_ROW_LOOKUP_ATTEMPTS = 5;
const CONTENT_WORK_ROW_LOOKUP_SLEEP_MS = 1200;

const CONTENT_WORK_FORM_ENTRY_IDS = {
  title: 'entry.767085369',
  product: 'entry.1545925642',
  source: 'entry.2011085220',
  assignee: 'entry.105616812',
  category: 'entry.487953478',
};

function doPost(e) {
  try {
    const payload = parseJsonBody_(e);
    if (payload.secret !== CONTENT_WORK_SECRET) {
      return jsonResponse_({ success: false, error: 'Secret không hợp lệ.' });
    }

    if (payload.action !== 'registerContentWork') {
      return jsonResponse_({ success: false, error: 'Action không hợp lệ.' });
    }

    return jsonResponse_(registerContentWork_(payload));
  } catch (error) {
    return jsonResponse_({
      success: false,
      error: error && error.message ? error.message : String(error || 'Unknown error'),
    });
  }
}

function parseJsonBody_(e) {
  const rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  return JSON.parse(rawBody);
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeText_(value) {
  return String(value || '').trim();
}

function foldText_(value) {
  return normalizeText_(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function registerContentWork_(payload) {
  const article = payload && payload.article ? payload.article : {};
  const title = normalizeText_(article.title);
  const penName = normalizeText_(article.penName);
  const articleLink = normalizeText_(article.articleLink);
  const contentWorkCategory = normalizeText_(article.contentWorkCategory);

  if (!title || !penName || !contentWorkCategory) {
    throw new Error('Thiếu dữ liệu bắt buộc để đăng ký Content Work.');
  }
  if (!articleLink) {
    throw new Error('Thiếu link bài viết để điền vào Content Work.');
  }

  const formResult = submitContentWorkForm_({
    title: title,
    productName: normalizeText_(article.productName),
    source: normalizeText_(article.source),
    penName: penName,
    category: contentWorkCategory,
  });

  const sheetResult = writeArticleLinkToSheet_({
    title: title,
    penName: penName,
    category: contentWorkCategory,
    articleLink: articleLink,
  });

  const success = Boolean(formResult.submitted);
  const message = sheetResult.updated
    ? 'Đã gửi form và điền link Content Work thành công.'
    : 'Đã gửi form nhưng chưa tìm thấy đúng dòng trống để điền link Content Work.';

  return {
    success: success,
    message: message,
    formSubmitted: Boolean(formResult.submitted),
    formSubmittedAt: formResult.submittedAt,
    sheetUpdated: Boolean(sheetResult.updated),
    sheetName: sheetResult.sheetName || null,
    rowNumber: sheetResult.rowNumber || null,
    linkWrittenAt: sheetResult.linkWrittenAt || null,
    completedAt: sheetResult.updated ? new Date().toISOString() : null,
  };
}

function fetchContentWorkFormState_() {
  const response = UrlFetchApp.fetch(CONTENT_WORK_FORM_VIEW_URL, {
    method: 'get',
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  const html = response.getContentText();

  if (statusCode >= 400 || !html) {
    throw new Error('Không tải được Google Form Content Work để lấy token submit.');
  }

  const fbzxMatch = html.match(/name="fbzx"\s+value="([^"]+)"/i);
  const partialResponseMatch = html.match(/name="partialResponse"\s+value="([^"]*)"/i);

  if (!fbzxMatch || !fbzxMatch[1]) {
    throw new Error('Không lấy được token fbzx của Google Form Content Work.');
  }

  return {
    fbzx: fbzxMatch[1],
    partialResponse: partialResponseMatch && partialResponseMatch[1] ? partialResponseMatch[1] : '',
  };
}

function submitContentWorkForm_(input) {
  const formState = fetchContentWorkFormState_();
  const payload = {};

  payload[CONTENT_WORK_FORM_ENTRY_IDS.title] = input.title;
  payload[CONTENT_WORK_FORM_ENTRY_IDS.assignee] = input.penName;
  payload[CONTENT_WORK_FORM_ENTRY_IDS.category] = input.category;
  payload[CONTENT_WORK_FORM_ENTRY_IDS.category + '_sentinel'] = '';

  if (normalizeText_(input.productName)) {
    payload[CONTENT_WORK_FORM_ENTRY_IDS.product] = input.productName;
  }

  if (normalizeText_(input.source)) {
    payload[CONTENT_WORK_FORM_ENTRY_IDS.source] = input.source;
  }

  payload.fvv = '1';
  payload.pageHistory = '0';
  payload.fbzx = formState.fbzx;

  if (formState.partialResponse) {
    payload.partialResponse = formState.partialResponse;
  }

  const response = UrlFetchApp.fetch(CONTENT_WORK_FORM_RESPONSE_URL, {
    method: 'post',
    payload: payload,
    followRedirects: true,
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  const body = response.getContentText() || '';

  if (
    statusCode >= 400 ||
    /Đã xảy ra lỗi\./i.test(body) ||
    /Vui lòng thử lại\./i.test(body)
  ) {
    throw new Error('Gửi form Content Work thất bại (HTTP ' + statusCode + ').');
  }

  return {
    submitted: true,
    submittedAt: new Date().toISOString(),
  };
}

function writeArticleLinkToSheet_(input) {
  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(CONTENT_WORK_SPREADSHEET_ID);
  } catch (error) {
    throw new Error('Tài khoản đang chạy Apps Script chưa có quyền chỉnh sửa Google Sheet Content Work.');
  }
  const sheet = findSheetByGid_(spreadsheet, CONTENT_WORK_TARGET_SHEET_GID);
  if (!sheet) {
    throw new Error('Không tìm thấy tab sheet Content Work theo gid đã cấu hình.');
  }

  const headerInfo = detectContentWorkHeaders_(sheet);
  if (!headerInfo.titleColumn || !headerInfo.penNameColumn || !headerInfo.linkColumn) {
    throw new Error('Không tìm thấy đủ cột tiêu đề / người thực hiện / link trong sheet Content Work.');
  }

  for (var attempt = 0; attempt < CONTENT_WORK_ROW_LOOKUP_ATTEMPTS; attempt += 1) {
    const match = findLatestRegistrationRow_(sheet, headerInfo, input);
    if (match) {
      sheet.getRange(match.rowNumber, headerInfo.linkColumn).setValue(input.articleLink);
      return {
        updated: true,
        sheetName: sheet.getName(),
        rowNumber: match.rowNumber,
        linkWrittenAt: new Date().toISOString(),
      };
    }

    Utilities.sleep(CONTENT_WORK_ROW_LOOKUP_SLEEP_MS);
  }

  return {
    updated: false,
    sheetName: sheet.getName(),
    rowNumber: null,
    linkWrittenAt: null,
  };
}

function findSheetByGid_(spreadsheet, targetGid) {
  var sheets = spreadsheet.getSheets();
  for (var index = 0; index < sheets.length; index += 1) {
    if (sheets[index].getSheetId() === targetGid) {
      return sheets[index];
    }
  }
  return null;
}

function detectContentWorkHeaders_(sheet) {
  var scanRows = Math.min(sheet.getLastRow(), 5);
  var scanColumns = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, Math.max(scanRows, 1), Math.max(scanColumns, 1)).getDisplayValues();
  var best = {
    headerRow: 1,
    titleColumn: 0,
    penNameColumn: 0,
    categoryColumn: 0,
    linkColumn: 0,
    score: -1,
  };

  for (var rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    var row = values[rowIndex];
    var current = {
      headerRow: rowIndex + 1,
      titleColumn: 0,
      penNameColumn: 0,
      categoryColumn: 0,
      linkColumn: 0,
      score: 0,
    };

    for (var columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      var folded = foldText_(row[columnIndex]);
      if (!folded) continue;

      if (!current.titleColumn && (folded === 'ten bai viet - noi dung' || folded === 'ten bai viet' || folded === 'noi dung')) {
        current.titleColumn = columnIndex + 1;
        current.score += 2;
        continue;
      }

      if (!current.penNameColumn && (folded === 'nguoi thuc hien' || folded === 'but danh')) {
        current.penNameColumn = columnIndex + 1;
        current.score += 2;
        continue;
      }

      if (!current.categoryColumn && folded === 'ten danh muc') {
        current.categoryColumn = columnIndex + 1;
        current.score += 1;
        continue;
      }

      if (!current.linkColumn && (folded === 'link bai viet' || folded === 'link' || folded === 'link content work')) {
        current.linkColumn = columnIndex + 1;
        current.score += 2;
      }
    }

    if (current.score > best.score) {
      best = current;
    }
  }

  return best;
}

function findLatestRegistrationRow_(sheet, headerInfo, input) {
  var firstDataRow = headerInfo.headerRow + 1;
  var lastRow = sheet.getLastRow();
  if (lastRow < firstDataRow) {
    return null;
  }

  var values = sheet.getRange(firstDataRow, 1, lastRow - headerInfo.headerRow, sheet.getLastColumn()).getDisplayValues();
  for (var index = values.length - 1; index >= 0; index -= 1) {
    var row = values[index];
    var titleValue = foldText_(row[headerInfo.titleColumn - 1]);
    var penNameValue = foldText_(row[headerInfo.penNameColumn - 1]);
    var linkValue = foldText_(row[headerInfo.linkColumn - 1]);
    var categoryValue = headerInfo.categoryColumn ? foldText_(row[headerInfo.categoryColumn - 1]) : '';

    if (titleValue !== foldText_(input.title)) continue;
    if (penNameValue !== foldText_(input.penName)) continue;
    if (linkValue) continue;
    if (headerInfo.categoryColumn && categoryValue && categoryValue !== foldText_(input.category)) continue;

    return {
      rowNumber: firstDataRow + index,
    };
  }

  return null;
}

function authorizeContentWorkScopes() {
  UrlFetchApp.fetch('https://www.google.com/generate_204', {
    method: 'get',
    muteHttpExceptions: true,
  });

  SpreadsheetApp.openById(CONTENT_WORK_SPREADSHEET_ID).getId();

  return 'authorized';
}
