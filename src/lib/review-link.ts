const CMS_ADMIN_ORIGIN = "https://cms-ecom.fptshop.com.vn";
const CMS_LOGIN_PATH = "/admin/auth/login";

function decodeRepeatedly(value: string) {
  let current = value;

  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }

  return current;
}

function resolveCmsUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    try {
      return new URL(trimmed, CMS_ADMIN_ORIGIN).toString();
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

export function normalizeArticleReviewLink(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const resolved = resolveCmsUrl(raw);

  try {
    const url = new URL(resolved);
    if (url.origin !== CMS_ADMIN_ORIGIN || url.pathname !== CMS_LOGIN_PATH) {
      return resolved;
    }

    const redirectTo = url.searchParams.get("redirectTo");
    if (!redirectTo) {
      return resolved;
    }

    const normalizedRedirect = resolveCmsUrl(decodeRepeatedly(redirectTo));
    return normalizedRedirect || resolved;
  } catch {
    return resolved;
  }
}

export function getPreferredArticleNavigationLink(article: Pick<{ reviewLink?: string | null; link?: string | null }, "reviewLink" | "link">) {
  return normalizeArticleReviewLink(article.reviewLink) || String(article.link || "").trim() || "";
}
