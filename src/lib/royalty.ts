import { matchesIdentityCandidate } from "@/lib/auth";
import { resolvePreferredCollaboratorPenName } from "@/lib/collaborator-identity";

const ROYALTY_ELIGIBLE_STATUSES = new Set(["Published", "Approved"]);

export type RoyaltyContributorProfile = {
  teamId?: number | null;
  penName: string;
  name?: string | null;
  role?: string | null;
  linkedUserRole?: string | null;
};

export type RoyaltyContributorRole = "writer" | "reviewer";
export const REVIEWER_ROYALTY_PRICE = 15000;

export type RoyaltyScopedArticle = {
  teamId?: number | null;
  penName: string;
  reviewerName?: string | null;
  articleType: string;
  contentType: string;
  date: string;
};

export type RoyaltyContentBalance = {
  newArticles: number;
  rewriteArticles: number;
  totalArticles: number;
  newPercentage: number;
  rewritePercentage: number;
  differencePercentage: number;
  thresholdPercentage: number;
  dominantType: "new" | "rewrite" | null;
  isImbalanced: boolean;
  warningMessage: string | null;
};

export function isRoyaltyEligibleArticleStatus(status: unknown) {
  return ROYALTY_ELIGIBLE_STATUSES.has(String(status || "").trim());
}

export type RoyaltyDateParts = {
  year: number;
  month: number;
  day: number;
  normalized: string;
};

export function parseRoyaltyDateParts(value: unknown): RoyaltyDateParts | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const isoTimestamp = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[tT ].*)?$/);
  if (isoTimestamp) {
    const year = Number(isoTimestamp[1]);
    const month = Number(isoTimestamp[2]);
    const day = Number(isoTimestamp[3]);
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      return {
        year,
        month,
        day,
        normalized: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    }
  }

  const dmy = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      return {
        year,
        month,
        day,
        normalized: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  const month = parsed.getMonth() + 1;
  const day = parsed.getDate();
  return {
    year,
    month,
    day,
    normalized: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function matchesRoyaltyMonthYear(value: unknown, month: number, year: number) {
  const parts = parseRoyaltyDateParts(value);
  return Boolean(parts && parts.year === year && parts.month === month);
}

export function isBudgetEligibleContributor(
  profile: RoyaltyContributorProfile | null | undefined,
  allowedRoles: RoyaltyContributorRole[] = ["writer"]
) {
  if (!profile) return false;
  const normalizedRole = String(profile.role || "").trim() as RoyaltyContributorRole;
  return allowedRoles.includes(normalizedRole) && String(profile.linkedUserRole || "").trim() !== "admin";
}

export function resolveRoyaltyContributionPrice(role: RoyaltyContributorRole, writerPrice: number) {
  return role === "reviewer" ? REVIEWER_ROYALTY_PRICE : writerPrice;
}

export function resolveRoyaltyContributorProfile(
  articlePenName: unknown,
  profiles: RoyaltyContributorProfile[]
) {
  const articleIdentity = String(articlePenName || "").trim();
  if (!articleIdentity) return null;

  return profiles.find((profile) =>
    matchesIdentityCandidate(
      [profile.penName, profile.name || ""].filter(Boolean) as string[],
      articleIdentity
    )
  ) || null;
}

export function resolveRoyaltyContributorPenName(
  articlePenName: unknown,
  profiles: RoyaltyContributorProfile[]
) {
  const profile = resolveRoyaltyContributorProfile(articlePenName, profiles);
  return resolvePreferredCollaboratorPenName(
    [profile?.penName, profile?.name, articlePenName],
    profile?.penName ?? String(articlePenName || "").trim()
  );
}

export function filterBudgetEligibleRoyaltyArticles<T extends RoyaltyScopedArticle>(
  articles: T[],
  profiles: RoyaltyContributorProfile[]
) {
  return articles.filter((article) => isBudgetEligibleContributor(resolveRoyaltyContributorProfile(article.penName, profiles)));
}

export function summarizeRoyaltyContentBalance(
  articles: Array<Pick<RoyaltyScopedArticle, "contentType">>,
  thresholdPercentage = 10
): RoyaltyContentBalance {
  let newArticles = 0;
  let rewriteArticles = 0;

  for (const article of articles) {
    const contentType = String(article.contentType || "").trim();
    if (contentType === "Viết lại") {
      rewriteArticles += 1;
      continue;
    }
    if (contentType === "Viết mới") {
      newArticles += 1;
    }
  }

  const totalArticles = newArticles + rewriteArticles;
  const newPercentage = totalArticles > 0 ? Math.round((newArticles / totalArticles) * 100) : 0;
  const rewritePercentage = totalArticles > 0 ? Math.round((rewriteArticles / totalArticles) * 100) : 0;
  const differencePercentage = Math.abs(newPercentage - rewritePercentage);
  const dominantType = newArticles === rewriteArticles ? null : newArticles > rewriteArticles ? "new" : "rewrite";
  const isImbalanced = totalArticles > 0 && differencePercentage >= thresholdPercentage;
  const warningMessage = isImbalanced
    ? dominantType === "new"
      ? `Bài viết mới đang cao hơn bài viết lại ${differencePercentage}%.`
      : `Bài viết lại đang cao hơn bài viết mới ${differencePercentage}%.`
    : null;

  return {
    newArticles,
    rewriteArticles,
    totalArticles,
    newPercentage,
    rewritePercentage,
    differencePercentage,
    thresholdPercentage,
    dominantType,
    isImbalanced,
    warningMessage,
  };
}
