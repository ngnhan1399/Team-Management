const CONTENT_WORK_SECRET = 'replace-with-the-same-secret-as-CONTENT_WORK_SCRIPT_SECRET';
const CONTENT_WORK_FORM_ID = '1CRpmylyRwSo1tpc5Xa_ryVy2m_c2xTjXb9t_ESihGdY';
const CONTENT_WORK_SPREADSHEET_ID = '10xgj6260aKTU5tn4WONRF5AccUPRhnoMcWJXyNn023I';
const CONTENT_WORK_TARGET_SHEET_GID = 1639483225;
const CONTENT_WORK_ROW_LOOKUP_ATTEMPTS = 5;
const CONTENT_WORK_ROW_LOOKUP_SLEEP_MS = 1200;

const FORM_FIELD_TITLES = {
  title: 'Tên bài viết - nội dung',
  product: 'Tên sản phẩm',
  source: 'Nguồn',
  assignee: 'Người thực hiện',
  category: 'Tên danh mục',
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
    source: normalizeText_(article.source) || articleLink,
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

function submitContentWorkForm_(input) {
  const form = FormApp.openById(CONTENT_WORK_FORM_ID);
  const response = form.createResponse();
  const items = form.getItems();

  addTextResponseByTitle_(items, response, FORM_FIELD_TITLES.title, input.title, true);
  addTextResponseByTitle_(items, response, FORM_FIELD_TITLES.product, input.productName, false);
  addTextResponseByTitle_(items, response, FORM_FIELD_TITLES.source, input.source, false);
  addTextResponseByTitle_(items, response, FORM_FIELD_TITLES.assignee, input.penName, true);
  addChoiceResponseByTitle_(items, response, FORM_FIELD_TITLES.category, input.category, true);

  response.submit();

  return {
    submitted: true,
    submittedAt: new Date().toISOString(),
  };
}

function addTextResponseByTitle_(items, response, targetTitle, value, required) {
  const normalizedValue = normalizeText_(value);
  if (!normalizedValue && !required) {
    return;
  }

  const item = items.find(function (candidate) {
    return foldText_(candidate.getTitle()) === foldText_(targetTitle);
  });

  if (!item) {
    if (required) {
      throw new Error('Không tìm thấy field bắt buộc trên form: ' + targetTitle);
    }
    return;
  }

  if (item.getType() !== FormApp.ItemType.TEXT) {
    throw new Error('Field text không đúng kiểu trên form: ' + targetTitle);
  }

  response.withItemResponse(item.asTextItem().createResponse(normalizedValue));
}

function addChoiceResponseByTitle_(items, response, targetTitle, value, required) {
  const normalizedValue = normalizeText_(value);
  if (!normalizedValue && !required) {
    return;
  }

  const item = items.find(function (candidate) {
    return foldText_(candidate.getTitle()) === foldText_(targetTitle);
  });

  if (!item) {
    if (required) {
      throw new Error('Không tìm thấy field chọn bắt buộc trên form: ' + targetTitle);
    }
    return;
  }

  if (item.getType() !== FormApp.ItemType.MULTIPLE_CHOICE) {
    throw new Error('Field danh mục không phải multiple choice: ' + targetTitle);
  }

  response.withItemResponse(item.asMultipleChoiceItem().createResponse(normalizedValue));
}

function writeArticleLinkToSheet_(input) {
  const spreadsheet = SpreadsheetApp.openById(CONTENT_WORK_SPREADSHEET_ID);
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
