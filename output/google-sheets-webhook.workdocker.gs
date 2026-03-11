const WEBHOOK_URL = 'https://www.workdocker.com/api/articles/google-sync/webhook';
const WEBHOOK_SECRET = 'cv5d6JixkyfbHUphMrnGge9QESqDZwRITPVWmYzA';
const SOURCE_URL = 'https://docs.google.com/spreadsheets/d/1Uj8iA0R5oWmONenkESHZ8i7Hc1D8UOk6ES6olZGTbH8/edit?gid=75835251#gid=75835251';

function normalizeSheetName_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function foldText_(value) {
  return normalizeSheetName_(value).toLowerCase();
}

function parseMonthlySheetName_(sheetName) {
  const normalized = normalizeSheetName_(sheetName);
  const withoutCopyPrefix = normalized.replace(/^Ban sao cua\s+/i, '').trim();

  const match =
    withoutCopyPrefix.match(/^Thang\s*(\d{1,2})(\d{4})$/i)
    || withoutCopyPrefix.match(/^Thang\s*(\d{1,2})[\s/._-]+(\d{4})$/i)
    || withoutCopyPrefix.match(/^Thang[\s/._-]+(\d{1,2})[\s/._-]+(\d{4})$/i);

  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const year = Number(match[2]);

  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    return null;
  }

  return {
    originalName: sheetName,
    month,
    year,
    isCopy: /^Ban sao cua\s+/i.test(normalized),
  };
}

function buildPayloadForSheet_(sheet) {
  if (!sheet) {
    return null;
  }

  const parsed = parseMonthlySheetName_(sheet.getName());
  if (!parsed) {
    return null;
  }

  return {
    sourceUrl: SOURCE_URL,
    sheetName: parsed.originalName,
    month: parsed.month,
    year: parsed.year,
  };
}

function sendWebhookPayload_(payload) {
  if (!payload) {
    return;
  }

  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-google-sheets-secret': WEBHOOK_SECRET,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

function normalizeLinkKey_(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDateKey_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  const raw = String(value).trim();
  if (!raw) return '';

  const dmy = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${String(Number(dmy[2])).padStart(2, '0')}-${String(Number(dmy[1])).padStart(2, '0')}`;
  }

  const ymd = raw.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${String(Number(ymd[2])).padStart(2, '0')}-${String(Number(ymd[3])).padStart(2, '0')}`;
  }

  return raw;
}

function normalizeCompositeKey_(title, penName, date) {
  return `${foldText_(title)}|||${foldText_(penName)}|||${normalizeDateKey_(date)}`;
}

function normalizeTitlePenNameKey_(title, penName) {
  return `${foldText_(title)}|||${foldText_(penName)}`;
}

function resolveFieldFromHeader_(header) {
  const folded = foldText_(header);
  if (folded.indexOf('id bai viet') >= 0 || folded === 'id bai') return 'articleId';
  if (folded.indexOf('ngay viet') >= 0) return 'date';
  if (folded.indexOf('ten bai viet') >= 0 || folded === 'ten bai') return 'title';
  if (folded.indexOf('loai bai viet') >= 0) return 'articleType';
  if (folded.indexOf('do dai') >= 0 || folded.indexOf('so tu') >= 0 || folded.indexOf('khoang tu') >= 0) return 'wordCountRange';
  if (folded.indexOf('but danh') >= 0) return 'penName';
  if (folded.indexOf('tinh trang duyet') >= 0 || folded.indexOf('trang thai duyet') >= 0) return 'status';
  if (folded.indexOf('nguoi duyet') >= 0) return 'reviewerName';
  if (folded.indexOf('link bai viet') >= 0 || folded === 'link') return 'link';
  if (folded.indexOf('noi dung sua') >= 0 || folded === 'note' || folded === 'notes') return 'notes';
  return null;
}

function findHeaderInfo_(sheet) {
  const lastRow = Math.min(sheet.getLastRow(), 12);
  const lastColumn = sheet.getLastColumn();
  if (!lastRow || !lastColumn) return null;

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  let best = null;

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const mapping = {};
    let score = 0;

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const field = resolveFieldFromHeader_(row[columnIndex]);
      if (!field || mapping[field]) continue;
      mapping[field] = columnIndex + 1;
      score += ['title', 'penName', 'status'].indexOf(field) >= 0 ? 4 : 1;
    }

    if (!mapping.title || !mapping.penName) continue;
    if (!best || score > best.score) {
      best = {
        rowNumber: rowIndex + 1,
        mapping,
        score,
      };
    }
  }

  return best;
}

function buildSourceRowKeyFromArticle_(article) {
  const articleId = String(article.articleId || '').trim();
  const link = String(article.link || '').trim();

  if (articleId) return `articleId:${articleId}`;
  if (link) return `link:${normalizeLinkKey_(link)}`;
  return `composite:${normalizeCompositeKey_(article.title, article.penName, article.date)}`;
}

function findArticleRowNumber_(sheet, headerInfo, article, sourceRowKey) {
  const firstDataRow = headerInfo.rowNumber + 1;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < firstDataRow || !lastColumn) return 0;

  const values = sheet.getRange(firstDataRow, 1, lastRow - headerInfo.rowNumber, lastColumn).getDisplayValues();
  const mapping = headerInfo.mapping;
  const articleId = String(article.articleId || '').trim();
  const link = String(article.link || '').trim();
  const compositeKey = normalizeCompositeKey_(article.title, article.penName, article.date);
  const normalizedSourceRowKey = String(sourceRowKey || buildSourceRowKeyFromArticle_(article)).trim();

  function getCell(row, field) {
    const columnIndex = mapping[field];
    return columnIndex ? row[columnIndex - 1] : '';
  }

  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    const rowArticleId = String(getCell(row, 'articleId') || '').trim();
    if (normalizedSourceRowKey.indexOf('articleId:') === 0 && rowArticleId && normalizedSourceRowKey === `articleId:${rowArticleId}`) {
      return firstDataRow + index;
    }
  }

  if (articleId) {
    for (let index = 0; index < values.length; index += 1) {
      const row = values[index];
      const rowArticleId = String(getCell(row, 'articleId') || '').trim();
      if (rowArticleId && rowArticleId === articleId) {
        return firstDataRow + index;
      }
    }
  }

  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    const rowLink = normalizeLinkKey_(getCell(row, 'link'));
    if (normalizedSourceRowKey.indexOf('link:') === 0 && rowLink && normalizedSourceRowKey === `link:${rowLink}`) {
      return firstDataRow + index;
    }
  }

  if (link) {
    const normalizedLink = normalizeLinkKey_(link);
    for (let index = 0; index < values.length; index += 1) {
      const row = values[index];
      const rowLink = normalizeLinkKey_(getCell(row, 'link'));
      if (rowLink && rowLink === normalizedLink) {
        return firstDataRow + index;
      }
    }
  }

  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    const rowComposite = normalizeCompositeKey_(getCell(row, 'title'), getCell(row, 'penName'), getCell(row, 'date'));
    if (normalizedSourceRowKey.indexOf('composite:') === 0 && rowComposite && normalizedSourceRowKey === `composite:${rowComposite}`) {
      return firstDataRow + index;
    }
  }

  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    const rowComposite = normalizeCompositeKey_(getCell(row, 'title'), getCell(row, 'penName'), getCell(row, 'date'));
    if (rowComposite && rowComposite === compositeKey) {
      return firstDataRow + index;
    }
  }

  return 0;
}

function setFieldValue_(sheet, rowNumber, columnNumber, value) {
  if (!columnNumber) return false;
  sheet.getRange(rowNumber, columnNumber).setValue(String(value || '').trim());
  return true;
}

function setDateFieldValue_(sheet, rowNumber, columnNumber, value) {
  if (!columnNumber) return false;
  const normalized = normalizeDateKey_(value);
  if (!normalized) {
    sheet.getRange(rowNumber, columnNumber).setValue('');
    return true;
  }

  const parts = normalized.split('-').map(Number);
  const dateValue = new Date(parts[0], parts[1] - 1, parts[2]);
  sheet.getRange(rowNumber, columnNumber).setValue(dateValue);
  sheet.getRange(rowNumber, columnNumber).setNumberFormat('dd/MM/yyyy');
  return true;
}

function updateArticleRow_(sheet, rowNumber, headerInfo, article) {
  const mapping = headerInfo.mapping;
  const updatedFields = [];

  if (setFieldValue_(sheet, rowNumber, mapping.status, article.sheetStatus || '')) {
    updatedFields.push('status');
  }
  if (setFieldValue_(sheet, rowNumber, mapping.reviewerName, article.reviewerName || '')) {
    updatedFields.push('reviewerName');
  }
  if (setFieldValue_(sheet, rowNumber, mapping.notes, article.notes || '')) {
    updatedFields.push('notes');
  }
  if (setFieldValue_(sheet, rowNumber, mapping.link, article.link || '')) {
    updatedFields.push('link');
  }

  return updatedFields;
}

function findLastArticleRowNumber_(sheet, headerInfo) {
  const firstDataRow = headerInfo.rowNumber + 1;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < firstDataRow || !lastColumn) {
    return headerInfo.rowNumber;
  }

  const values = sheet.getRange(firstDataRow, 1, lastRow - headerInfo.rowNumber, lastColumn).getDisplayValues();
  const mapping = headerInfo.mapping;

  for (let index = values.length - 1; index >= 0; index -= 1) {
    const row = values[index];
    const hasMeaningfulData = [
      mapping.articleId,
      mapping.date,
      mapping.title,
      mapping.penName,
      mapping.articleType,
      mapping.wordCountRange,
      mapping.status,
      mapping.link,
    ].some(function (columnIndex) {
      return columnIndex && String(row[columnIndex - 1] || '').trim() !== '';
    });

    if (hasMeaningfulData) {
      return firstDataRow + index;
    }
  }

  return headerInfo.rowNumber;
}

function copyTemplateRow_(sheet, templateRowNumber, targetRowNumber) {
  const lastColumn = sheet.getLastColumn();
  if (!lastColumn) return;

  const sourceRange = sheet.getRange(templateRowNumber, 1, 1, lastColumn);
  const targetRange = sheet.getRange(targetRowNumber, 1, 1, lastColumn);
  sourceRange.copyTo(targetRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sourceRange.copyTo(targetRange, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  targetRange.clearContent();
}

function appendArticleRow_(sheet, headerInfo, article) {
  const insertAfterRow = findLastArticleRowNumber_(sheet, headerInfo);
  sheet.insertRowAfter(insertAfterRow);
  const targetRowNumber = insertAfterRow + 1;
  const templateRowNumber = Math.max(headerInfo.rowNumber + 1, insertAfterRow);
  copyTemplateRow_(sheet, templateRowNumber, targetRowNumber);

  const mapping = headerInfo.mapping;
  setFieldValue_(sheet, targetRowNumber, mapping.articleId, article.articleId || '');
  setDateFieldValue_(sheet, targetRowNumber, mapping.date, article.date || '');
  setFieldValue_(sheet, targetRowNumber, mapping.title, article.title || '');
  setFieldValue_(sheet, targetRowNumber, mapping.articleType, article.articleType || '');
  setFieldValue_(sheet, targetRowNumber, mapping.wordCountRange, article.wordCountRange || '');
  setFieldValue_(sheet, targetRowNumber, mapping.penName, article.penName || '');
  setFieldValue_(sheet, targetRowNumber, mapping.status, article.sheetStatus || '');
  setFieldValue_(sheet, targetRowNumber, mapping.notes, article.notes || '');
  setFieldValue_(sheet, targetRowNumber, mapping.reviewerName, article.reviewerName || '');
  setFieldValue_(sheet, targetRowNumber, mapping.link, article.link || '');

  return targetRowNumber;
}

function deleteArticleRow_(sheet, rowNumber) {
  if (!rowNumber || rowNumber < 1) return false;
  sheet.deleteRow(rowNumber);
  return true;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function readJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    return { _parseError: String(error) };
  }
}

function findMonthlySheet_(spreadsheet, month, year, preferredSheetName) {
  if (preferredSheetName) {
    const direct = spreadsheet.getSheetByName(preferredSheetName);
    if (direct) return direct;
  }

  const candidates = [];
  const sheets = spreadsheet.getSheets();

  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    const parsed = parseMonthlySheetName_(sheet.getName());
    if (!parsed) continue;
    if (month && year && (parsed.month !== Number(month) || parsed.year !== Number(year))) continue;
    candidates.push({ sheet, parsed });
  }

  candidates.sort(function(left, right) {
    if (left.parsed.year !== right.parsed.year) return right.parsed.year - left.parsed.year;
    if (left.parsed.month !== right.parsed.month) return right.parsed.month - left.parsed.month;
    if (left.parsed.isCopy !== right.parsed.isCopy) return Number(left.parsed.isCopy) - Number(right.parsed.isCopy);
    return right.sheet.getName().localeCompare(left.sheet.getName());
  });

  return candidates.length ? candidates[0].sheet : null;
}

function listMonthlySheets_(spreadsheet) {
  const candidates = [];
  const sheets = spreadsheet.getSheets();

  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    const parsed = parseMonthlySheetName_(sheet.getName());
    if (!parsed) continue;
    candidates.push({ sheet, parsed });
  }

  candidates.sort(function(left, right) {
    if (left.parsed.year !== right.parsed.year) return right.parsed.year - left.parsed.year;
    if (left.parsed.month !== right.parsed.month) return right.parsed.month - left.parsed.month;
    if (left.parsed.isCopy !== right.parsed.isCopy) return Number(left.parsed.isCopy) - Number(right.parsed.isCopy);
    return right.sheet.getName().localeCompare(left.sheet.getName());
  });

  return candidates;
}

function buildLookupCandidateSheets_(spreadsheet, month, year, preferredSheetName) {
  const ordered = [];
  const seen = {};
  const monthlySheets = listMonthlySheets_(spreadsheet);

  function pushSheetEntry(entry) {
    if (!entry || !entry.sheet) return;
    const name = entry.sheet.getName();
    if (seen[name]) return;
    seen[name] = true;
    ordered.push(entry);
  }

  if (preferredSheetName) {
    const direct = spreadsheet.getSheetByName(preferredSheetName);
    const parsed = direct ? parseMonthlySheetName_(direct.getName()) : null;
    if (direct && parsed) {
      pushSheetEntry({ sheet: direct, parsed });
    }
  }

  if (month && year) {
    monthlySheets
      .filter(function(entry) {
        return entry.parsed.month === Number(month) && entry.parsed.year === Number(year);
      })
      .forEach(pushSheetEntry);
  }

  monthlySheets.forEach(pushSheetEntry);
  return ordered;
}

function findArticleLocationAcrossWorkbook_(spreadsheet, article, sourceRowKey, preferredSheetName, month, year) {
  const candidates = buildLookupCandidateSheets_(spreadsheet, month, year, preferredSheetName);
  const matches = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const headerInfo = findHeaderInfo_(candidate.sheet);
    if (!headerInfo) continue;

    const rowNumber = findArticleRowNumber_(candidate.sheet, headerInfo, article, sourceRowKey);
    if (!rowNumber) continue;

    matches.push({
      sheet: candidate.sheet,
      parsed: candidate.parsed,
      rowNumber: rowNumber,
      headerInfo: headerInfo,
    });
  }

  if (matches.length === 0) {
    return {
      match: null,
      ambiguous: false,
      searchedSheets: candidates.length,
      matches: [],
    };
  }

  if (preferredSheetName) {
    const exactPreferredMatch = matches.find(function(entry) {
      return entry.sheet.getName() === preferredSheetName;
    });
    if (exactPreferredMatch) {
      return {
        match: exactPreferredMatch,
        ambiguous: false,
        searchedSheets: candidates.length,
        matches: [
          {
            sheetName: exactPreferredMatch.sheet.getName(),
            rowNumber: exactPreferredMatch.rowNumber,
          },
        ],
      };
    }
  }

  if (matches.length === 1) {
    return {
      match: matches[0],
      ambiguous: false,
      searchedSheets: candidates.length,
      matches: [
        {
          sheetName: matches[0].sheet.getName(),
          rowNumber: matches[0].rowNumber,
        },
      ],
    };
  }

  const exactPeriodNonCopyMatches = matches.filter(function(entry) {
    if (!month || !year) return false;
    return entry.parsed.month === Number(month) && entry.parsed.year === Number(year) && !entry.parsed.isCopy;
  });

  if (exactPeriodNonCopyMatches.length === 1) {
    return {
      match: exactPeriodNonCopyMatches[0],
      ambiguous: false,
      searchedSheets: candidates.length,
      matches: [
        {
          sheetName: exactPeriodNonCopyMatches[0].sheet.getName(),
          rowNumber: exactPeriodNonCopyMatches[0].rowNumber,
        },
      ],
    };
  }

  return {
    match: null,
    ambiguous: true,
    searchedSheets: candidates.length,
    matches: matches.map(function(entry) {
      return {
        sheetName: entry.sheet.getName(),
        rowNumber: entry.rowNumber,
      };
    }),
  };
}

function resolveSourceRowKey_(article) {
  const articleId = String(article.articleId || '').trim();
  if (articleId) return `articleId:${articleId}`;

  const link = String(article.link || '').trim();
  if (link) return `link:${normalizeLinkKey_(link)}`;

  return `composite:${normalizeCompositeKey_(article.title, article.penName, article.date)}`;
}

function onEdit(e) {
  const sheet = e && e.range ? e.range.getSheet() : SpreadsheetApp.getActiveSheet();
  sendWebhookPayload_(buildPayloadForSheet_(sheet));
}

function onChange(e) {
  const spreadsheet = e && e.source ? e.source : SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = spreadsheet ? spreadsheet.getActiveSheet() : null;
  sendWebhookPayload_(buildPayloadForSheet_(activeSheet));
}

function doPost(e) {
  const body = readJsonBody_(e);
  if (body._parseError) {
    return jsonResponse_({ success: false, error: body._parseError });
  }

  if (String(body.secret || '').trim() !== WEBHOOK_SECRET) {
    return jsonResponse_({ success: false, error: 'Webhook secret không hợp lệ.' });
  }

  if (
    String(body.action || '') !== 'mirrorArticleUpdate'
    && String(body.action || '') !== 'upsertArticle'
    && String(body.action || '') !== 'deleteArticle'
  ) {
    return jsonResponse_({ success: false, error: 'Action không được hỗ trợ.' });
  }

  const article = body.article || {};
  const spreadsheet = SpreadsheetApp.openByUrl(String(body.sourceUrl || SOURCE_URL));
  const lookup = findArticleLocationAcrossWorkbook_(
    spreadsheet,
    article,
    body.sourceRowKey,
    body.sheetName,
    body.month,
    body.year
  );

  if (lookup.ambiguous) {
    return jsonResponse_({
      success: false,
      error: 'Tìm thấy nhiều dòng khớp trong workbook, chưa thể xóa/cập nhật an toàn.',
      matches: lookup.matches,
      searchedSheets: lookup.searchedSheets,
    });
  }

  const sheet = lookup.match ? lookup.match.sheet : findMonthlySheet_(spreadsheet, body.month, body.year, body.sheetName);
  if (!sheet) {
    return jsonResponse_({ success: false, error: 'Không tìm thấy tab Google Sheet phù hợp.' });
  }

  const headerInfo = lookup.match ? lookup.match.headerInfo : findHeaderInfo_(sheet);
  if (!headerInfo) {
    return jsonResponse_({ success: false, error: `Không xác định được hàng header trong tab ${sheet.getName()}.` });
  }

  let rowNumber = lookup.match ? lookup.match.rowNumber : 0;
  if (!rowNumber && String(body.action || '') === 'upsertArticle') {
    rowNumber = appendArticleRow_(sheet, headerInfo, article);
  }

  if (!rowNumber) {
    if (String(body.action || '') === 'deleteArticle') {
      const parsedSheet = parseMonthlySheetName_(sheet.getName());
      const sourceRowKey = String(body.sourceRowKey || resolveSourceRowKey_(article)).trim();

      return jsonResponse_({
        success: true,
        message: `Không tìm thấy dòng cho bài "${article.title || article.articleId || ''}" trên toàn workbook.`,
        rowNumber: null,
        deleted: false,
        notFoundAcrossWorkbook: true,
        sheetName: sheet.getName(),
        sourceUrl: String(body.sourceUrl || SOURCE_URL),
        month: parsedSheet ? parsedSheet.month : body.month,
        year: parsedSheet ? parsedSheet.year : body.year,
        sourceRowKey,
        searchedSheets: lookup.searchedSheets,
      });
    }

    return jsonResponse_({
      success: false,
      error: `Không tìm thấy dòng tương ứng cho bài "${article.title || article.articleId || ''}" trong tab ${sheet.getName()}.`,
    });
  }

  if (String(body.action || '') === 'deleteArticle') {
    deleteArticleRow_(sheet, rowNumber);
    SpreadsheetApp.flush();
    const parsedSheet = parseMonthlySheetName_(sheet.getName());
    const sourceRowKey = String(body.sourceRowKey || resolveSourceRowKey_(article)).trim();

    return jsonResponse_({
      success: true,
      message: `Đã xóa dòng ${rowNumber} trong tab ${sheet.getName()}.`,
      rowNumber,
      deleted: true,
      notFoundAcrossWorkbook: false,
      sheetName: sheet.getName(),
      sourceUrl: String(body.sourceUrl || SOURCE_URL),
      month: parsedSheet ? parsedSheet.month : body.month,
      year: parsedSheet ? parsedSheet.year : body.year,
      sourceRowKey,
      searchedSheets: lookup.searchedSheets,
    });
  }

  const updatedFields = updateArticleRow_(sheet, rowNumber, headerInfo, article);
  SpreadsheetApp.flush();
  const parsedSheet = parseMonthlySheetName_(sheet.getName());
  const sourceRowKey = resolveSourceRowKey_(article);

  return jsonResponse_({
    success: true,
    message: `Đã cập nhật dòng ${rowNumber} trong tab ${sheet.getName()}.`,
    rowNumber,
    sheetName: sheet.getName(),
    sourceUrl: String(body.sourceUrl || SOURCE_URL),
    month: parsedSheet ? parsedSheet.month : body.month,
    year: parsedSheet ? parsedSheet.year : body.year,
    sourceRowKey,
    updatedFields,
  });
}
