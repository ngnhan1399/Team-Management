const KPI_CONTENT_CLEANUP_OPTIONS = {
  targetDatePrefixes: ["2026-03-25", "25/03/2026", "25/3/2026", "25 thg 3, 2026"],
  employeeCodes: ["NhanND18"],
  requireAllLinksEmpty: true,
  previewLimit: 20,
  backupSheetPrefix: "KPI Content Cleanup Backup",
};

const KPI_CONTENT_ALLOWED_TASKS = {
  social: "Social",
  reviewCtv: "Duyet bai CTV",
  description: "Mo ta san pham",
  news: "Viet bai tin tuc",
  optimizeProduct: "Toi uu san pham",
};

const KPI_CONTENT_ALLOWED_NEWS_DETAILS = [
  "Tin Moi - News AI",
  "SEO AI",
  "Tin Moi - Tin Ngan",
  "Bai dai - kho",
];

const KPI_CONTENT_ALLOWED_DESCRIPTION_DETAILS = [
  "Duyet mo ta dai",
  "Viet mo ta dai",
  "Duyet mo ta ngan",
  "Viet mo ta ngan",
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("KPI Content Cleanup")
    .addItem("Preview dong nghi ngo", "previewSuspiciousKpiContentRows")
    .addItem("Backup va xoa dong nghi ngo", "backupAndDeleteSuspiciousKpiContentRows")
    .addToUi();
}

function normalizeCleanupText_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm:ss");
  }
  return String(value || "").trim();
}

function foldCleanupText_(value) {
  return normalizeCleanupText_(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildHeaderMap_(headers) {
  return headers.reduce(function (accumulator, header, index) {
    const folded = foldCleanupText_(header);
    if (folded) {
      accumulator[folded] = index;
    }
    return accumulator;
  }, {});
}

function firstDefined_() {
  for (var index = 0; index < arguments.length; index += 1) {
    if (typeof arguments[index] !== "undefined") {
      return arguments[index];
    }
  }
  return undefined;
}

function resolveKpiContentResponseColumns_(headers) {
  const headerMap = buildHeaderMap_(headers);
  const linkIndexes = headers
    .map(function (header, index) {
      return { index: index, folded: foldCleanupText_(header) };
    })
    .filter(function (item) {
      return item.folded === "link" || /^link(\s+\d+)?$/.test(item.folded);
    })
    .map(function (item) {
      return item.index;
    });

  return {
    timestampIndex: firstDefined_(
      headerMap["timestamp"],
      headerMap["dau thoi gian"],
      headerMap["ngay"],
      headerMap["thoi gian"]
    ),
    employeeIndex: headerMap["nhan vien content"],
    taskIndex: headerMap["dau viec content"],
    detailIndex: headerMap["chi tiet dau viec"],
    noteIndex: firstDefined_(headerMap["note"], headerMap["note (neu co)"]),
    linkIndexes: linkIndexes,
  };
}

function findKpiContentResponseSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = spreadsheet.getSheets();
  let bestCandidate = null;

  sheets.forEach(function (sheet) {
    const lastColumn = sheet.getLastColumn();
    if (lastColumn === 0) {
      return;
    }

    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const columns = resolveKpiContentResponseColumns_(headers);
    const score =
      (typeof columns.timestampIndex === "number" ? 1 : 0) +
      (typeof columns.taskIndex === "number" ? 1 : 0) +
      (typeof columns.detailIndex === "number" ? 1 : 0) +
      Math.min(columns.linkIndexes.length, 5);

    if (score < 4) {
      return;
    }

    const nameScore = /(form responses|phan hoi|cau tra loi)/i.test(sheet.getName()) ? 2 : 0;
    const finalScore = score + nameScore;

    if (!bestCandidate || finalScore > bestCandidate.score) {
      bestCandidate = {
        sheet: sheet,
        headers: headers,
        columns: columns,
        score: finalScore,
      };
    }
  });

  if (!bestCandidate) {
    throw new Error("Khong tim duoc sheet response KPI Content co du cot can thiet.");
  }

  return bestCandidate;
}

function extractLinks_(row, linkIndexes) {
  return linkIndexes.map(function (columnIndex) {
    return normalizeCleanupText_(row[columnIndex]);
  });
}

function looksBrokenEncoding_(value) {
  const text = normalizeCleanupText_(value);
  return /[\uFFFD]/.test(text) || /\?[A-Za-z]/.test(text) || /(Ã.|Â.|â.)/.test(text);
}

function isAllowedTask_(taskLabel) {
  const folded = foldCleanupText_(taskLabel);
  return Object.keys(KPI_CONTENT_ALLOWED_TASKS).some(function (key) {
    return folded === foldCleanupText_(KPI_CONTENT_ALLOWED_TASKS[key]);
  });
}

function isAllowedTaskDetail_(taskLabel, detailLabel) {
  const taskFolded = foldCleanupText_(taskLabel);
  const detailFolded = foldCleanupText_(detailLabel);

  if (!detailFolded) {
    return false;
  }

  if (taskFolded === foldCleanupText_(KPI_CONTENT_ALLOWED_TASKS.description)) {
    return KPI_CONTENT_ALLOWED_DESCRIPTION_DETAILS.some(function (option) {
      return detailFolded === foldCleanupText_(option);
    });
  }

  if (taskFolded === foldCleanupText_(KPI_CONTENT_ALLOWED_TASKS.news)) {
    return KPI_CONTENT_ALLOWED_NEWS_DETAILS.some(function (option) {
      return detailFolded === foldCleanupText_(option);
    });
  }

  if (
    taskFolded === foldCleanupText_(KPI_CONTENT_ALLOWED_TASKS.social) ||
    taskFolded === foldCleanupText_(KPI_CONTENT_ALLOWED_TASKS.reviewCtv) ||
    taskFolded === foldCleanupText_(KPI_CONTENT_ALLOWED_TASKS.optimizeProduct)
  ) {
    return true;
  }

  return false;
}

function matchesTargetDate_(value) {
  const prefixes = KPI_CONTENT_CLEANUP_OPTIONS.targetDatePrefixes || [];
  if (!prefixes.length) {
    return true;
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    const timezone = Session.getScriptTimeZone() || "Asia/Ho_Chi_Minh";
    const dateVariants = [
      Utilities.formatDate(value, timezone, "yyyy-MM-dd"),
      Utilities.formatDate(value, timezone, "dd/MM/yyyy"),
      Utilities.formatDate(value, timezone, "d/M/yyyy"),
    ];
    return dateVariants.some(function (variant) {
      return prefixes.some(function (prefix) {
        return variant.indexOf(prefix) === 0;
      });
    });
  }

  const text = normalizeCleanupText_(value);
  return prefixes.some(function (prefix) {
    return text.indexOf(prefix) === 0;
  });
}

function matchesEmployeeFilter_(value) {
  const employeeCodes = KPI_CONTENT_CLEANUP_OPTIONS.employeeCodes || [];
  if (!employeeCodes.length) {
    return true;
  }

  const folded = foldCleanupText_(value);
  return employeeCodes.some(function (employeeCode) {
    return folded === foldCleanupText_(employeeCode);
  });
}

function collectSuspiciousKpiContentRows_() {
  const candidate = findKpiContentResponseSheet_();
  const sheet = candidate.sheet;
  const headers = candidate.headers;
  const columns = candidate.columns;
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return {
      sheet: sheet,
      headers: headers,
      matches: [],
    };
  }

  const matches = [];

  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const timestampValue = typeof columns.timestampIndex === "number" ? row[columns.timestampIndex] : "";
    const employeeValue = typeof columns.employeeIndex === "number" ? row[columns.employeeIndex] : "";
    const taskValue = typeof columns.taskIndex === "number" ? row[columns.taskIndex] : "";
    const detailValue = typeof columns.detailIndex === "number" ? row[columns.detailIndex] : "";
    const links = extractLinks_(row, columns.linkIndexes);
    const allLinksEmpty = links.every(function (link) {
      return !normalizeCleanupText_(link);
    });

    if (!matchesTargetDate_(timestampValue)) {
      continue;
    }

    if (typeof columns.employeeIndex === "number" && !matchesEmployeeFilter_(employeeValue)) {
      continue;
    }

    const reasons = [];
    const taskAllowed = isAllowedTask_(taskValue);
    const detailAllowed = isAllowedTaskDetail_(taskValue, detailValue);
    const brokenEncoding = looksBrokenEncoding_(taskValue) || looksBrokenEncoding_(detailValue);

    if (!taskAllowed) {
      reasons.push("dau_viec_khong_hop_le");
    }
    if (!detailAllowed) {
      reasons.push("chi_tiet_khong_hop_le");
    }
    if (brokenEncoding) {
      reasons.push("nghi_loi_ma_hoa");
    }
    if (allLinksEmpty) {
      reasons.push("tat_ca_link_de_trong");
    }

    const invalidTaskOrDetail = !taskAllowed || !detailAllowed || brokenEncoding;
    const shouldMatch = invalidTaskOrDetail && (!KPI_CONTENT_CLEANUP_OPTIONS.requireAllLinksEmpty || allLinksEmpty);

    if (!shouldMatch) {
      continue;
    }

    matches.push({
      rowNumber: rowIndex + 1,
      timestamp: normalizeCleanupText_(timestampValue),
      employeeCode: normalizeCleanupText_(employeeValue),
      taskLabel: normalizeCleanupText_(taskValue),
      detailLabel: normalizeCleanupText_(detailValue),
      links: links,
      note: typeof columns.noteIndex === "number" ? normalizeCleanupText_(row[columns.noteIndex]) : "",
      reasons: reasons,
      rowValues: row,
    });
  }

  return {
    sheet: sheet,
    headers: headers,
    matches: matches,
  };
}

function previewSuspiciousKpiContentRows() {
  const result = collectSuspiciousKpiContentRows_();
  const previewRows = result.matches.slice(0, KPI_CONTENT_CLEANUP_OPTIONS.previewLimit || 20);

  Logger.log(JSON.stringify({
    sheetName: result.sheet.getName(),
    totalSuspiciousRows: result.matches.length,
    previewRows: previewRows,
  }, null, 2));

  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Tim thay " + result.matches.length + " dong KPI Content nghi ngo. Mo Execution log de xem chi tiet.",
    "KPI Content Cleanup",
    10
  );

  return result;
}

function createCleanupBackupSheet_(headers, matches) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Ho_Chi_Minh", "yyyyMMdd-HHmmss");
  const baseName = KPI_CONTENT_CLEANUP_OPTIONS.backupSheetPrefix + " " + timestamp;
  const sheetName = baseName.slice(0, 90);
  const backupSheet = spreadsheet.insertSheet(sheetName, 0);
  const backupHeaders = ["Source Row", "Cleanup Reasons"].concat(headers);
  const backupRows = matches.map(function (match) {
    return [match.rowNumber, match.reasons.join(", ")].concat(match.rowValues);
  });

  backupSheet.getRange(1, 1, 1, backupHeaders.length).setValues([backupHeaders]);
  if (backupRows.length) {
    backupSheet.getRange(2, 1, backupRows.length, backupHeaders.length).setValues(backupRows);
  }
  backupSheet.setFrozenRows(1);

  return backupSheet;
}

function backupAndDeleteSuspiciousKpiContentRows() {
  const result = collectSuspiciousKpiContentRows_();

  if (!result.matches.length) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "Khong tim thay dong KPI Content nghi ngo de xoa.",
      "KPI Content Cleanup",
      8
    );
    return {
      deletedCount: 0,
      backupSheetName: null,
      rowNumbers: [],
    };
  }

  const backupSheet = createCleanupBackupSheet_(result.headers, result.matches);
  const rowNumbers = result.matches
    .map(function (match) {
      return match.rowNumber;
    })
    .sort(function (left, right) {
      return right - left;
    });

  rowNumbers.forEach(function (rowNumber) {
    result.sheet.deleteRow(rowNumber);
  });

  SpreadsheetApp.flush();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Da backup va xoa " + rowNumbers.length + " dong KPI Content nghi ngo.",
    "KPI Content Cleanup",
    10
  );

  return {
    deletedCount: rowNumbers.length,
    backupSheetName: backupSheet.getName(),
    rowNumbers: rowNumbers,
  };
}
