import { resolveArticleCategory } from "./article-category";

export type AppArticleCategory = "ICT" | "Gia dụng" | "Thủ thuật" | "Giải trí" | "Đánh giá" | "SEO AI" | "Khác";
export type AppContentType = "Viết mới" | "Viết lại";
export type AppWordCountRange = "800-1000" | "1000-1500" | "1500-2000" | "Từ 2000 trở lên";
export type AppArticleType =
  | "Mô tả SP ngắn"
  | "Mô tả SP dài"
  | "Bài dịch Review SP"
  | "Bài SEO ICT"
  | "Bài SEO Gia dụng"
  | "Bài SEO ICT 1K5"
  | "Bài SEO Gia dụng 1K5"
  | "Bài SEO ICT 2K"
  | "Bài SEO Gia dụng 2K"
  | "Thủ thuật"
  | "SEO AI";

const GOOGLE_SHEET_WORD_COUNT_LABELS: Record<AppWordCountRange, string> = {
  "800-1000": "800 - 1000 chữ",
  "1000-1500": "1000 - 1500 chữ",
  "1500-2000": "1500 - 2000 chữ",
  "Từ 2000 trở lên": "Từ 2000 chữ trở lên",
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

export function foldGoogleSheetArticleText(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNumericText(value: string) {
  return value
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/(?<=\d)\s+(?=\d)/g, "");
}

function extractNumberTokens(value: string) {
  return Array.from(
    new Set(
      (normalizeNumericText(value).match(/\d{3,4}/g) || [])
        .map((token) => Number(token))
        .filter((token) => Number.isInteger(token) && token > 0)
    )
  );
}

function inferSpecialSeoWordCountRangeFromArticleType(value: string): AppWordCountRange | null {
  const compact = value.replace(/\s+/g, "");
  if (compact.includes("1k5")) return "1500-2000";
  if (compact.includes("2k")) return "Từ 2000 trở lên";
  return null;
}

function inferWordCountRangeFromFoldedText(value: string): AppWordCountRange | null {
  if (!value) return null;

  const inferredFromArticleType = inferSpecialSeoWordCountRangeFromArticleType(value);
  if (inferredFromArticleType) return inferredFromArticleType;

  const numericTokens = extractNumberTokens(value);
  if (numericTokens.includes(800) && numericTokens.includes(1000)) return "800-1000";
  if (numericTokens.includes(1000) && numericTokens.includes(1500)) return "1000-1500";
  if (numericTokens.includes(1500) && numericTokens.includes(2000)) return "1500-2000";
  if (numericTokens.includes(1500)) return "1500-2000";

  const hasUpperBoundHint =
    value.includes("tro len")
    || value.includes("tren")
    || value.includes(">=")
    || value.includes("+")
    || value.includes("plus");
  if (numericTokens.includes(2000) && hasUpperBoundHint) return "Từ 2000 trở lên";

  return null;
}

export function normalizeAppContentType(value: unknown): AppContentType {
  const folded = foldGoogleSheetArticleText(value);
  if (folded.includes("viet lai") || folded.includes("rewrite") || folded.includes("rework")) {
    return "Viết lại";
  }

  return "Viết mới";
}

export function normalizeWordCountRangeToApp(value: unknown): AppWordCountRange | null {
  const folded = foldGoogleSheetArticleText(value);
  if (!folded) return null;

  if (folded === "800-1000") return "800-1000";
  if (folded === "1000-1500") return "1000-1500";
  if (folded === "1500-2000") return "1500-2000";
  if (folded === "tu 2000 tro len") return "Từ 2000 trở lên";

  return inferWordCountRangeFromFoldedText(folded);
}

function mapSeoArticleType(category: AppArticleCategory, wordCountRange: AppWordCountRange | null): AppArticleType {
  if (category === "Gia dụng") {
    if (wordCountRange === "Từ 2000 trở lên") return "Bài SEO Gia dụng 2K";
    if (wordCountRange === "1500-2000") return "Bài SEO Gia dụng 1K5";
    return "Bài SEO Gia dụng";
  }

  if (wordCountRange === "Từ 2000 trở lên") return "Bài SEO ICT 2K";
  if (wordCountRange === "1500-2000") return "Bài SEO ICT 1K5";
  return "Bài SEO ICT";
}

function resolveCanonicalWordCountRange(input: {
  articleType: unknown;
  wordCountRange?: unknown;
}) {
  const foldedArticleType = foldGoogleSheetArticleText(input.articleType);
  return (
    normalizeWordCountRangeToApp(input.wordCountRange)
    ?? inferSpecialSeoWordCountRangeFromArticleType(foldedArticleType)
    ?? inferWordCountRangeFromFoldedText(foldedArticleType)
  );
}

export function resolveAppArticleFields(input: {
  articleType: unknown;
  category?: unknown;
  wordCountRange?: unknown;
  contentType?: unknown;
}) {
  const foldedArticleType = foldGoogleSheetArticleText(input.articleType);
  const inferredWordCountRange = resolveCanonicalWordCountRange(input);
  const inferredContentType = normalizeAppContentType(input.contentType || input.articleType);
  const category = resolveArticleCategory(input.category, input.articleType) as AppArticleCategory;

  if (foldedArticleType.includes("seo ai") || category === "SEO AI") {
    return {
      category: "SEO AI" as const,
      articleType: "SEO AI" as const,
      contentType: inferredContentType,
      wordCountRange: inferredWordCountRange,
    };
  }

  if (foldedArticleType.includes("thu thuat")) {
    return {
      category: "Thủ thuật" as const,
      articleType: "Thủ thuật" as const,
      contentType: inferredContentType,
      wordCountRange: inferredWordCountRange,
    };
  }

  if (foldedArticleType.includes("mo ta")) {
    return {
      category: "Khác" as const,
      articleType: foldedArticleType.includes("ngan") ? "Mô tả SP ngắn" as const : "Mô tả SP dài" as const,
      contentType: inferredContentType,
      wordCountRange: inferredWordCountRange,
    };
  }

  if (foldedArticleType.includes("review") || foldedArticleType.includes("dich")) {
    return {
      category: "Đánh giá" as const,
      articleType: "Bài dịch Review SP" as const,
      contentType: inferredContentType,
      wordCountRange: inferredWordCountRange,
    };
  }

  const seoCategory: AppArticleCategory =
    foldedArticleType.includes("gia dung") || category === "Gia dụng"
      ? "Gia dụng"
      : "ICT";

  if (
    !foldedArticleType
    || foldedArticleType.includes("seo")
    || foldedArticleType.includes("ict")
    || foldedArticleType.includes("gia dung")
    || foldedArticleType.includes("viet moi")
    || foldedArticleType.includes("viet lai")
    || category === "ICT"
    || category === "Gia dụng"
  ) {
    return {
      category: seoCategory,
      articleType: mapSeoArticleType(seoCategory, inferredWordCountRange),
      contentType: inferredContentType,
      wordCountRange: inferredWordCountRange,
    };
  }

  return {
    category,
    articleType: mapSeoArticleType(seoCategory, inferredWordCountRange),
    contentType: inferredContentType,
    wordCountRange: inferredWordCountRange,
  };
}

export function mapGoogleSheetArticleToApp(input: {
  articleType: unknown;
  category?: unknown;
  wordCountRange?: unknown;
  contentType?: unknown;
}) {
  return resolveAppArticleFields(input);
}

export function formatWordCountRangeForGoogleSheet(value: unknown) {
  const normalized = normalizeWordCountRangeToApp(value);
  return normalized ? GOOGLE_SHEET_WORD_COUNT_LABELS[normalized] : "";
}

export function mapAppArticleToGoogleSheet(input: {
  articleType: unknown;
  contentType?: unknown;
  category?: unknown;
  wordCountRange?: unknown;
}) {
  const canonical = resolveAppArticleFields({
    articleType: input.articleType,
    category: input.category,
    contentType: input.contentType,
    wordCountRange: input.wordCountRange,
  });
  const articleType = normalizeText(canonical.articleType);
  const foldedArticleType = foldGoogleSheetArticleText(articleType);
  const contentType = canonical.contentType;
  const wordCountRange = canonical.wordCountRange;

  if (foldedArticleType.includes("seo ai")) {
    return {
      articleType: "SEO AI",
      wordCountRange: formatWordCountRangeForGoogleSheet(wordCountRange),
    };
  }

  if (foldedArticleType.includes("thu thuat")) {
    return {
      articleType: "Thủ thuật",
      wordCountRange: formatWordCountRangeForGoogleSheet(wordCountRange),
    };
  }

  if (foldedArticleType.includes("mo ta") && foldedArticleType.includes("ngan")) {
    return {
      articleType: "Mô tả ngắn",
      wordCountRange: formatWordCountRangeForGoogleSheet(wordCountRange),
    };
  }

  if (foldedArticleType.includes("mo ta")) {
    return {
      articleType: "Mô tả dài",
      wordCountRange: formatWordCountRangeForGoogleSheet(wordCountRange),
    };
  }

  if (foldedArticleType.includes("review") || foldedArticleType.includes("dich")) {
    return {
      articleType: "Bài dịch Review SP",
      wordCountRange: formatWordCountRangeForGoogleSheet(wordCountRange),
    };
  }

  if (foldedArticleType.includes("gia dung")) {
    return {
      articleType: contentType === "Viết lại" ? "Gia dụng Viết lại" : "Gia dụng Viết mới",
      wordCountRange: formatWordCountRangeForGoogleSheet(wordCountRange),
    };
  }

  if (foldedArticleType.includes("ict") || foldedArticleType.includes("seo") || !foldedArticleType) {
    return {
      articleType: contentType === "Viết lại" ? "ICT Viết lại" : "ICT Viết mới",
      wordCountRange: formatWordCountRangeForGoogleSheet(wordCountRange),
    };
  }

  return {
    articleType,
    wordCountRange: formatWordCountRangeForGoogleSheet(wordCountRange),
  };
}
