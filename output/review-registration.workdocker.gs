function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, service: "review-registration" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const secret = String(payload.secret || "").trim();
    const expectedSecret = String(PropertiesService.getScriptProperties().getProperty("REVIEW_REGISTRATION_SCRIPT_SECRET") || "").trim();
    if (!secret || !expectedSecret || secret !== expectedSecret) {
      return jsonOutput_({ success: false, error: "Thiếu hoặc sai REVIEW_REGISTRATION_SCRIPT_SECRET." });
    }

    if (String(payload.action || "").trim() !== "registerReviewArticle") {
      return jsonOutput_({ success: false, error: "Action không hợp lệ." });
    }

    const result = registerReviewArticle_(payload);
    return jsonOutput_(result);
  } catch (error) {
    return jsonOutput_({
      success: false,
      error: error && error.message ? error.message : String(error || "Lỗi không xác định."),
    });
  }
}

function jsonOutput_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function registerReviewArticle_(payload) {
  const article = payload.article || {};
  const target = payload.target || {};
  const reviewerLabel = String(target.reviewerLabel || article.reviewerPenName || "").trim();
  const spreadsheetUrl = String(target.spreadsheetUrl || "").trim();
  const sheetName = String(target.sheetName || "").trim();
  const articleLink = String(article.articleLink || "").trim();
  const writerPenName = String(article.writerPenName || "").trim();

  if (!spreadsheetUrl) {
    throw new Error("Thiếu spreadsheetUrl của sheet bài duyệt.");
  }
  if (!sheetName) {
    throw new Error("Thiếu tên tab sheet bài duyệt.");
  }
  if (!articleLink) {
    throw new Error("Bài viết chưa có link để ghi vào sheet bài duyệt.");
  }
  if (!writerPenName) {
    throw new Error("Thiếu tên CTV viết bài.");
  }
  if (!reviewerLabel) {
    throw new Error("Thiếu tên reviewer để ghi vào sheet bài duyệt.");
  }

  const spreadsheet = SpreadsheetApp.openByUrl(spreadsheetUrl);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Không tìm thấy tab sheet "' + sheetName + '".');
  }

  const monthSection = findLatestMonthSection_(sheet);
  if (!monthSection) {
    throw new Error('Không tìm thấy block tháng trong tab "' + sheetName + '".');
  }

  const existingRow = findExistingArticleRow_(sheet, monthSection, articleLink);
  if (existingRow) {
    return {
      success: true,
      sheetUpdated: true,
      message: "Bài viết đã tồn tại trong sheet bài duyệt.",
      sheetName: sheet.getName(),
      rowNumber: existingRow,
      sheetMonth: monthSection.month,
      sheetYear: monthSection.year,
      sheetWrittenAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  const writableRow = ensureWritableRow_(sheet, monthSection, reviewerLabel, String(target.managerLabel || "").trim());
  const articleDateDisplay = formatDateForSheet_(article.articleDate);
  const values = [[
    articleDateDisplay,
    articleLink,
    writerPenName,
    reviewerLabel,
    String(target.managerLabel || "").trim(),
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    "",
  ]];

  sheet.getRange(writableRow, 1, 1, values[0].length).setValues(values);
  sheet.getRange(writableRow, 6, 1, 7).insertCheckboxes();
  sheet.getRange(writableRow, 6, 1, 7).setValues([[true, true, true, true, true, true, true]]);
  SpreadsheetApp.flush();

  return {
    success: true,
    sheetUpdated: true,
    message: "Đã ghi bài duyệt vào sheet.",
    sheetName: sheet.getName(),
    rowNumber: writableRow,
    sheetMonth: monthSection.month,
    sheetYear: monthSection.year,
    sheetWrittenAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

function findLatestMonthSection_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 0) {
    return null;
  }

  const columnA = sheet.getRange(1, 1, lastRow, 1).getDisplayValues().map(function (row) {
    return String(row[0] || "").trim();
  });
  const markers = [];
  for (var index = 0; index < columnA.length; index += 1) {
    var match = /^Tháng\s+(\d{1,2})$/i.exec(columnA[index]);
    if (!match) {
      continue;
    }
    markers.push({
      row: index + 1,
      month: Number(match[1]),
    });
  }

  if (markers.length === 0) {
    return null;
  }

  const latest = markers[markers.length - 1];
  const nextMarker = null;
  return {
    markerRow: latest.row,
    nextMarkerRow: nextMarker,
    startRow: latest.row + 1,
    endRow: lastRow,
    month: latest.month,
    year: resolveMarkerYear_(latest.month),
  };
}

function resolveMarkerYear_(markerMonth) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  if (markerMonth > currentMonth + 1) {
    return currentYear - 1;
  }
  return currentYear;
}

function findExistingArticleRow_(sheet, monthSection, articleLink) {
  if (!articleLink) {
    return null;
  }

  const rowCount = Math.max(monthSection.endRow - monthSection.startRow + 1, 0);
  if (rowCount <= 0) {
    return null;
  }

  const values = sheet.getRange(monthSection.startRow, 2, rowCount, 2).getDisplayValues();
  for (var index = 0; index < values.length; index += 1) {
    var linkValue = String(values[index][0] || "").trim();
    if (linkValue && linkValue === articleLink) {
      return monthSection.startRow + index;
    }
  }

  return null;
}

function ensureWritableRow_(sheet, monthSection, reviewerLabel, managerLabel) {
  const rowCount = Math.max(monthSection.endRow - monthSection.startRow + 1, 0);
  if (rowCount > 0) {
    const values = sheet.getRange(monthSection.startRow, 1, rowCount, 5).getDisplayValues();
    for (var index = 0; index < values.length; index += 1) {
      var dateValue = String(values[index][0] || "").trim();
      var linkValue = String(values[index][1] || "").trim();
      var writerValue = String(values[index][2] || "").trim();
      if (!linkValue && !writerValue) {
        var rowNumber = monthSection.startRow + index;
        primeWritableRow_(sheet, rowNumber, reviewerLabel, managerLabel);
        return rowNumber;
      }
      if (!dateValue && !linkValue && !writerValue) {
        var fallbackRow = monthSection.startRow + index;
        primeWritableRow_(sheet, fallbackRow, reviewerLabel, managerLabel);
        return fallbackRow;
      }
    }
  }

  const insertRow = monthSection.nextMarkerRow || (monthSection.endRow + 1);
  if (monthSection.nextMarkerRow) {
    sheet.insertRowBefore(insertRow);
  } else {
    sheet.insertRowsAfter(monthSection.endRow, 1);
  }
  primeWritableRow_(sheet, insertRow, reviewerLabel, managerLabel);
  return insertRow;
}

function primeWritableRow_(sheet, rowNumber, reviewerLabel, managerLabel) {
  sheet.getRange(rowNumber, 4).setValue(reviewerLabel);
  sheet.getRange(rowNumber, 5).setValue(managerLabel || "");
  sheet.getRange(rowNumber, 6, 1, 7).insertCheckboxes();
  sheet.getRange(rowNumber, 6, 1, 7).setValues([[false, false, false, false, false, false, false]]);
}

function formatDateForSheet_(value) {
  var text = String(value || "").trim();
  if (!text) {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");
  }

  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    return [match[3], match[2], match[1]].join("/");
  }

  return text;
}
