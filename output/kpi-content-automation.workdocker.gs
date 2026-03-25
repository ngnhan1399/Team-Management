// Optional proxy script for KPI Content.
// The app can submit the Google Form directly when KPI_CONTENT_SCRIPT_* is not configured.
const KPI_CONTENT_SECRET = "replace-with-the-same-secret-as-KPI_CONTENT_SCRIPT_SECRET";
const KPI_CONTENT_FORM_PUBLIC_ID = "1FAIpQLScS-CMH8FwKAQQ_dcAGRzF__2l7G_dYo2Z4UxR5h--3XOF1_w";
const KPI_CONTENT_FORM_VIEW_URL = "https://docs.google.com/forms/d/e/" + KPI_CONTENT_FORM_PUBLIC_ID + "/viewform";
const KPI_CONTENT_FORM_RESPONSE_URL = "https://docs.google.com/forms/d/e/" + KPI_CONTENT_FORM_PUBLIC_ID + "/formResponse";
const KPI_CONTENT_BATCH_MAX_SIZE = 5;

const KPI_CONTENT_FORM_ENTRY_IDS = {
  employeeCode: "entry.2063490353",
  task: "entry.1997176339",
  newsDetail: "entry.1511448067",
  descriptionDetail: "entry.1417839557",
  link1: "entry.1708619375",
  link2: "entry.115890814",
  link3: "entry.1057708020",
  link4: "entry.779972713",
  link5: "entry.1418536144",
};

const KPI_CONTENT_FORM_PAGE_HISTORY = {
  news: "0,4,6",
  description: "0,3,6",
};

const KPI_CONTENT_TASKS = {
  news: "Vi\u1ebft b\u00e0i tin t\u1ee9c",
  description: "M\u00f4 t\u1ea3 s\u1ea3n ph\u1ea9m",
};

const KPI_CONTENT_NEWS_DETAILS = {
  seoAi: "SEO AI",
  hardLong: "B\u00e0i d\u00e0i - kh\u00f3",
};

const KPI_CONTENT_DESCRIPTION_DETAILS = {
  long: "Vi\u1ebft m\u00f4 t\u1ea3 d\u00e0i",
  short: "Vi\u1ebft m\u00f4 t\u1ea3 ng\u1eafn",
};

function doPost(e) {
  try {
    const payload = parseJsonBody_(e);
    if (payload.secret !== KPI_CONTENT_SECRET) {
      return jsonResponse_({ success: false, error: "Secret khong hop le." });
    }
    if (payload.action !== "registerKpiContent") {
      return jsonResponse_({ success: false, error: "Action khong hop le." });
    }

    return jsonResponse_(registerKpiContent_(payload));
  } catch (error) {
    return jsonResponse_({
      success: false,
      error: error && error.message ? error.message : String(error || "Unknown error"),
    });
  }
}

function parseJsonBody_(e) {
  const rawBody = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
  return JSON.parse(rawBody);
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeText_(value) {
  return String(value || "").trim();
}

function foldText_(value) {
  return normalizeText_(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isDescriptionTask_(taskLabel) {
  const folded = foldText_(taskLabel);
  return folded === foldText_(KPI_CONTENT_TASKS.description) || folded.includes("mo ta");
}

function resolveTaskOption_(taskLabel) {
  if (isDescriptionTask_(taskLabel)) {
    return KPI_CONTENT_TASKS.description;
  }
  return KPI_CONTENT_TASKS.news;
}

function resolveDetailOption_(taskLabel, detailLabel) {
  const foldedDetail = foldText_(detailLabel);

  if (isDescriptionTask_(taskLabel)) {
    if (foldedDetail.includes("ngan")) {
      return KPI_CONTENT_DESCRIPTION_DETAILS.short;
    }
    return KPI_CONTENT_DESCRIPTION_DETAILS.long;
  }

  if (foldedDetail.includes("bai dai") || foldedDetail.includes("kho")) {
    return KPI_CONTENT_NEWS_DETAILS.hardLong;
  }

  return KPI_CONTENT_NEWS_DETAILS.seoAi;
}

function getEntryIdNumber_(entryName) {
  return Number(String(entryName || "").replace("entry.", ""));
}

function resolveFormBranch_(taskLabel, detailLabel) {
  const taskOption = resolveTaskOption_(taskLabel);
  const detailOption = resolveDetailOption_(taskLabel, detailLabel);

  if (taskOption === KPI_CONTENT_TASKS.description) {
    return {
      taskOption: taskOption,
      detailOption: detailOption,
      detailEntryName: KPI_CONTENT_FORM_ENTRY_IDS.descriptionDetail,
      pageHistory: KPI_CONTENT_FORM_PAGE_HISTORY.description,
    };
  }

  return {
    taskOption: taskOption,
    detailOption: detailOption,
    detailEntryName: KPI_CONTENT_FORM_ENTRY_IDS.newsDetail,
    pageHistory: KPI_CONTENT_FORM_PAGE_HISTORY.news,
  };
}

function normalizeArticles_(articles) {
  if (!Array.isArray(articles)) {
    return [];
  }

  return articles
    .map(function (article, index) {
      return {
        articleId: normalizeText_(article && article.articleId),
        title: normalizeText_(article && article.title) || ("Bai " + (index + 1)),
        articleLink: normalizeText_(article && article.articleLink),
        articleDate: normalizeText_(article && article.articleDate),
        penName: normalizeText_(article && article.penName),
        position: Number(article && article.position) || index + 1,
      };
    })
    .filter(function (article) {
      return Boolean(article.articleLink);
    })
    .slice(0, KPI_CONTENT_BATCH_MAX_SIZE);
}

function registerKpiContent_(payload) {
  const batch = payload && payload.batch ? payload.batch : {};
  const articles = normalizeArticles_(payload && payload.articles);
  const employeeCode = normalizeText_(batch.employeeCode);
  const taskLabel = normalizeTaskLabel_(batch.taskLabel);
  const detailLabel = normalizeText_(batch.detailLabel);

  if (!employeeCode || !taskLabel || !detailLabel) {
    throw new Error("Thieu du lieu bat buoc de dang ky KPI Content.");
  }
  if (articles.length === 0) {
    throw new Error("KPI Content can it nhat 1 link hop le.");
  }

  const formState = fetchKpiContentFormState_();
  const taskOption = resolveTaskOption_(taskLabel);
  const detailOption = resolveDetailOption_(taskLabel, detailLabel);
  const finalResult = submitKpiContentForm_(formState, {
    employeeCode: employeeCode,
    taskOption: taskOption,
    detailOption: detailOption,
    articles: articles,
  });

  return {
    success: true,
    message: "Da gui KPI Content form thanh cong.",
    formSubmitted: true,
    submittedAt: new Date().toISOString(),
    batchId: normalizeText_(batch.batchId) || null,
    batchSize: articles.length,
    employeeCode: employeeCode,
    taskLabel: taskOption,
    detailLabel: detailOption,
    articleCount: articles.length,
    finalResponseCode: finalResult.responseCode,
  };
}

function normalizeTaskLabel_(value) {
  const folded = foldText_(value);
  if (folded.includes("mo ta")) {
    return KPI_CONTENT_TASKS.description;
  }
  return KPI_CONTENT_TASKS.news;
}

function fetchKpiContentFormState_() {
  const response = UrlFetchApp.fetch(KPI_CONTENT_FORM_VIEW_URL, {
    method: "get",
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  const html = response.getContentText();

  if (statusCode >= 400 || !html) {
    throw new Error("Khong tai duoc Google Form KPI Content de lay token submit.");
  }

  const fbzxMatch = html.match(/name="fbzx"\s+value="([^"]+)"/i);

  if (!fbzxMatch || !fbzxMatch[1]) {
    throw new Error("Khong lay duoc token fbzx cua Google Form KPI Content.");
  }

  return {
    fbzx: fbzxMatch[1],
  };
}

function buildFinalPayload_(formState, input) {
  const branch = resolveFormBranch_(input.taskOption, input.detailOption);
  const payload = {
    fvv: "1",
    pageHistory: branch.pageHistory,
    fbzx: formState.fbzx,
    partialResponse: JSON.stringify([
      [
        [null, getEntryIdNumber_(KPI_CONTENT_FORM_ENTRY_IDS.employeeCode), [input.employeeCode], 0],
        [null, getEntryIdNumber_(KPI_CONTENT_FORM_ENTRY_IDS.task), [branch.taskOption], 0],
        [null, getEntryIdNumber_(branch.detailEntryName), [branch.detailOption], 0],
      ],
      null,
      formState.fbzx,
    ]),
    submissionTimestamp: String(new Date().getTime()),
  };

  const linkKeys = [
    KPI_CONTENT_FORM_ENTRY_IDS.link1,
    KPI_CONTENT_FORM_ENTRY_IDS.link2,
    KPI_CONTENT_FORM_ENTRY_IDS.link3,
    KPI_CONTENT_FORM_ENTRY_IDS.link4,
    KPI_CONTENT_FORM_ENTRY_IDS.link5,
  ];

  for (var index = 0; index < linkKeys.length; index += 1) {
    payload[linkKeys[index]] = input.articles[index] ? input.articles[index].articleLink : "";
  }

  return payload;
}

function submitKpiContentForm_(formState, input) {
  const payload = buildFinalPayload_(formState, input);
  const response = UrlFetchApp.fetch(KPI_CONTENT_FORM_RESPONSE_URL, {
    method: "post",
    payload: payload,
    followRedirects: true,
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  const body = response.getContentText() || "";

  if (
    statusCode >= 400 ||
    /data-validation-failed="true"/i.test(body) ||
    /da xay ra loi/i.test(body) ||
    /vui long thu lai/i.test(body)
  ) {
    throw new Error("Gui KPI Content form that bai (HTTP " + statusCode + ").");
  }

  return {
    responseCode: statusCode,
    body: body,
  };
}
