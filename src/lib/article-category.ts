function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type ArticleCategory = "ICT" | "Gia dụng" | "Thủ thuật" | "Giải trí" | "Đánh giá" | "Khác";

export function normalizeExplicitArticleCategory(value: unknown): ArticleCategory | null {
  const folded = foldText(String(value || ""));
  if (!folded) return null;
  if (folded.includes("gia dung")) return "Gia dụng";
  if (folded.includes("thu thuat")) return "Thủ thuật";
  if (folded.includes("giai tri")) return "Giải trí";
  if (folded.includes("danh gia")) return "Đánh giá";
  if (folded.includes("khac")) return "Khác";
  if (folded.includes("ict")) return "ICT";
  return null;
}

export function inferArticleCategoryFromType(articleType: unknown): ArticleCategory | null {
  const folded = foldText(String(articleType || ""));
  if (!folded) return null;
  if (folded.includes("gia dung")) return "Gia dụng";
  if (folded.includes("thu thuat")) return "Thủ thuật";
  if (folded.includes("giai tri")) return "Giải trí";
  if (folded.includes("danh gia") || folded.includes("review")) return "Đánh giá";
  if (folded.includes("mo ta")) return "Khác";
  if (folded.includes("ict") || folded.includes("seo")) return "ICT";
  return null;
}

export function resolveArticleCategory(category: unknown, articleType: unknown): ArticleCategory {
  const explicit = normalizeExplicitArticleCategory(category);
  const inferred = inferArticleCategoryFromType(articleType);

  if (inferred && (!explicit || explicit === "ICT" || explicit === "Khác")) {
    return inferred;
  }

  return explicit || inferred || "ICT";
}
