import { createPoolFromEnv } from "./db-bootstrap.mjs";

const APPLY = process.argv.includes("--apply");

function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[@._-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildIdentityVariants(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];

  const folded = foldText(raw);
  if (!folded) return [];

  const variants = new Set([folded]);
  const tokens = folded.split(" ").filter(Boolean);

  if (raw.includes("@")) {
    const [localPart] = raw.split("@");
    const localVariant = foldText(localPart);
    if (localVariant) {
      variants.add(localVariant);
    }
  }

  if (tokens.length >= 2) {
    variants.add(tokens.slice(-2).join(" "));
    variants.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  }

  return Array.from(variants);
}

function matchesIdentity(candidates, value) {
  const targetVariants = new Set(buildIdentityVariants(value));
  if (targetVariants.size === 0) return false;

  for (const candidate of candidates) {
    for (const variant of buildIdentityVariants(candidate)) {
      if (targetVariants.has(variant)) {
        return true;
      }
    }
  }

  return false;
}

function canonicalizeSeoArticle(row) {
  const category = String(row.category || "").trim();
  const articleType = String(row.article_type || "").trim();
  const foldedArticleType = foldText(articleType);
  const isSeoIct = category === "ICT" || foldedArticleType.startsWith("bai seo ict");
  const isSeoGiaDung = category === "Gia dụng" || foldedArticleType.startsWith("bai seo gia dung");

  if (!isSeoIct && !isSeoGiaDung) {
    return {
      articleType,
      wordCountRange: row.word_count_range ?? null,
    };
  }

  let wordCountRange = row.word_count_range ?? null;
  if (foldedArticleType.includes("1k5")) {
    wordCountRange = "1500-2000";
  } else if (foldedArticleType.includes("2k")) {
    wordCountRange = "Từ 2000 trở lên";
  }

  let nextArticleType;
  if (isSeoGiaDung) {
    nextArticleType =
      wordCountRange === "Từ 2000 trở lên"
        ? "Bài SEO Gia dụng 2K"
        : wordCountRange === "1500-2000"
          ? "Bài SEO Gia dụng 1K5"
          : "Bài SEO Gia dụng";
  } else {
    nextArticleType =
      wordCountRange === "Từ 2000 trở lên"
        ? "Bài SEO ICT 2K"
        : wordCountRange === "1500-2000"
          ? "Bài SEO ICT 1K5"
          : "Bài SEO ICT";
  }

  return {
    articleType: nextArticleType,
    wordCountRange,
  };
}

function isBudgetEligibleContributor(profile) {
  return profile && profile.role === "writer" && profile.userRole !== "admin";
}

function resolveContributorProfile(penName, profiles) {
  return profiles.find((profile) =>
    matchesIdentity([profile.penName, profile.name, profile.email].filter(Boolean), penName)
  ) || null;
}

async function main() {
  const pool = createPoolFromEnv();

  try {
    const articleResult = await pool.query(`
      select id, category, article_type, word_count_range
      from articles
      where category in ('ICT', 'Gia dụng')
         or article_type like 'Bài SEO ICT%'
         or article_type like 'Bài SEO Gia dụng%'
      order by id
    `);

    const articleFixes = articleResult.rows
      .map((row) => {
        const canonical = canonicalizeSeoArticle(row);
        const hasChanges =
          canonical.articleType !== row.article_type
          || (canonical.wordCountRange ?? null) !== (row.word_count_range ?? null);

        return hasChanges
          ? {
              id: Number(row.id),
              previousArticleType: row.article_type,
              nextArticleType: canonical.articleType,
              previousWordCountRange: row.word_count_range ?? null,
              nextWordCountRange: canonical.wordCountRange ?? null,
            }
          : null;
      })
      .filter(Boolean);

    const pendingPaymentsResult = await pool.query(`
      select id, team_id, pen_name, month, year, status
      from payments
      where status = 'pending'
      order by year, month, id
    `);
    const pendingPayments = pendingPaymentsResult.rows.map((row) => ({
      id: Number(row.id),
      teamId: row.team_id == null ? null : Number(row.team_id),
      penName: String(row.pen_name || "").trim(),
      month: Number(row.month),
      year: Number(row.year),
      status: row.status,
    }));

    const paymentPeriods = Array.from(
      new Set(pendingPayments.map((row) => `${row.teamId ?? 0}|${row.month}|${row.year}`))
    ).map((key) => {
      const [teamIdRaw, monthRaw, yearRaw] = key.split("|");
      return {
        teamId: Number(teamIdRaw) > 0 ? Number(teamIdRaw) : null,
        month: Number(monthRaw),
        year: Number(yearRaw),
      };
    });

    const ratesResult = await pool.query(`
      select article_type, content_type, price
      from royalty_rates
      where is_active = true
    `);
    const rateMap = new Map(
      ratesResult.rows.map((row) => [`${row.article_type}|${row.content_type}`, Number(row.price)])
    );

    const contributorProfilesResult = await pool.query(`
      select c.team_id, c.pen_name, c.name, c.email, c.role, u.role as user_role
      from collaborators c
      left join users u on u.collaborator_id = c.id
    `);
    const contributorProfiles = contributorProfilesResult.rows.map((row) => ({
      teamId: row.team_id == null ? null : Number(row.team_id),
      penName: String(row.pen_name || "").trim(),
      name: row.name ? String(row.name).trim() : null,
      email: row.email ? String(row.email).trim() : null,
      role: row.role ? String(row.role).trim() : null,
      userRole: row.user_role ? String(row.user_role).trim() : null,
    }));

    let paymentUpdates = [];
    let missingPendingCalculations = [];

    if (paymentPeriods.length > 0) {
      const royaltyArticleResult = await pool.query(`
        select id, team_id, pen_name, category, article_type, content_type, word_count_range, date
        from articles
        where status in ('Published', 'Approved')
      `);

      const calculationMap = new Map();
      for (const row of royaltyArticleResult.rows) {
        const contributorProfile = resolveContributorProfile(row.pen_name, contributorProfiles);
        if (!isBudgetEligibleContributor(contributorProfile)) {
          continue;
        }

        const canonical = canonicalizeSeoArticle(row);
        const dateMatch = String(row.date || "").trim().match(/^(\d{4})-(\d{2})-\d{2}/);
        if (!dateMatch) {
          continue;
        }

        const year = Number(dateMatch[1]);
        const month = Number(dateMatch[2]);
        const teamId = contributorProfile?.teamId ?? (row.team_id == null ? null : Number(row.team_id));
        const relevantPeriod = paymentPeriods.find((period) =>
          period.month === month
          && period.year === year
          && Number(period.teamId ?? 0) === Number(teamId ?? 0)
        );
        if (!relevantPeriod) {
          continue;
        }

        const canonicalPenName = contributorProfile?.penName || String(row.pen_name || "").trim();
        const mapKey = `${teamId ?? 0}|${month}|${year}|${foldText(canonicalPenName)}`;
        const price = rateMap.get(`${canonical.articleType}|${row.content_type}`) || 0;

        if (!calculationMap.has(mapKey)) {
          calculationMap.set(mapKey, {
            teamId,
            month,
            year,
            penName: canonicalPenName,
            totalArticles: 0,
            totalAmount: 0,
            details: {},
          });
        }

        const current = calculationMap.get(mapKey);
        current.totalArticles += 1;
        current.totalAmount += price;

        const detailKey = `${canonical.articleType} (${row.content_type})`;
        if (!current.details[detailKey]) {
          current.details[detailKey] = { count: 0, unitPrice: price, total: 0 };
        }
        current.details[detailKey].count += 1;
        current.details[detailKey].total += price;
      }

      const pendingPaymentByKey = new Map(
        pendingPayments.map((payment) => [
          `${payment.teamId ?? 0}|${payment.month}|${payment.year}|${foldText(payment.penName)}`,
          payment,
        ])
      );

      const calculatedRows = Array.from(calculationMap.values()).map((row) => {
        const existing = pendingPaymentByKey.get(
          `${row.teamId ?? 0}|${row.month}|${row.year}|${foldText(row.penName)}`
        ) || null;
        return {
          ...row,
          existingPaymentId: existing?.id ?? null,
        };
      });
      paymentUpdates = calculatedRows.filter((row) => row.existingPaymentId != null);
      missingPendingCalculations = calculatedRows.filter((row) => row.existingPaymentId == null);
    }

    console.log(JSON.stringify({
      apply: APPLY,
      articleFixCount: articleFixes.length,
      paymentUpdateCount: paymentUpdates.length,
      missingPendingCalculationCount: missingPendingCalculations.length,
      sampleArticleFixes: articleFixes.slice(0, 20),
      samplePaymentUpdates: paymentUpdates.slice(0, 20).map((row) => ({
        existingPaymentId: row.existingPaymentId,
        teamId: row.teamId,
        month: row.month,
        year: row.year,
        penName: row.penName,
        totalArticles: row.totalArticles,
        totalAmount: row.totalAmount,
      })),
      sampleMissingPendingCalculations: missingPendingCalculations.slice(0, 20).map((row) => ({
        teamId: row.teamId,
        month: row.month,
        year: row.year,
        penName: row.penName,
        totalArticles: row.totalArticles,
        totalAmount: row.totalAmount,
      })),
    }, null, 2));

    if (!APPLY) {
      return;
    }

    await pool.query("BEGIN");

    for (const fix of articleFixes) {
      await pool.query(
        `
          update articles
          set article_type = $2,
              word_count_range = $3,
              updated_at = CURRENT_TIMESTAMP::text
          where id = $1
        `,
        [fix.id, fix.nextArticleType, fix.nextWordCountRange]
      );
    }

    for (const row of paymentUpdates) {
      const details = JSON.stringify(row.details);
      await pool.query(
        `
          update payments
          set pen_name = $2,
              total_articles = $3,
              total_amount = $4,
              details = $5,
              updated_at = CURRENT_TIMESTAMP::text
          where id = $1
        `,
        [row.existingPaymentId, row.penName, row.totalArticles, row.totalAmount, details]
      );
    }

    await pool.query("COMMIT");
  } catch (error) {
    console.error(error);
    try {
      await pool.query("ROLLBACK");
    } catch {}
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
