import { Pool } from "pg";

export const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/ctv_management";
export const DEFAULT_TEAM_NAME = "Team mặc định";
export const BOOTSTRAP_META_KEY = "bootstrap_schema_version";
export const BOOTSTRAP_SCHEMA_VERSION = "9";

function buildConnectionString(baseUrl, user, password) {
  const parsed = new URL(baseUrl);
  if (parsed.username || parsed.password) {
    return baseUrl;
  }
  if (!user || !password) {
    return baseUrl;
  }

  parsed.username = encodeURIComponent(user);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

export function resolveDatabaseUrl() {
  const directUrl = process.env.DATABASE_URL?.trim()
    || process.env.DATABASE_POSTGRES_URL?.trim()
    || process.env.DATABASE_NILEDB_URL?.trim();

  if (directUrl) {
    return directUrl;
  }

  const nileBaseUrl = process.env.DATABASE_NILEDB_POSTGRES_URL?.trim();
  if (nileBaseUrl) {
    return buildConnectionString(
      nileBaseUrl,
      process.env.DATABASE_NILEDB_USER?.trim(),
      process.env.DATABASE_NILEDB_PASSWORD?.trim()
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL must be configured in production.");
  }

  return DEFAULT_DATABASE_URL;
}

const bootstrapStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'ctv',
    is_leader BOOLEAN NOT NULL DEFAULT false,
    collaborator_id INTEGER,
    team_id INTEGER,
    must_change_password BOOLEAN NOT NULL DEFAULT true,
    last_login TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    owner_user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS collaborators (
    id SERIAL PRIMARY KEY,
    team_id INTEGER,
    name TEXT NOT NULL,
    pen_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'writer',
    kpi_standard INTEGER NOT NULL DEFAULT 25,
    email TEXT,
    phone TEXT,
    date_of_birth TEXT,
    cccd TEXT,
    cccd_date TEXT,
    tax_id TEXT,
    bank_account TEXT,
    bank_name TEXT,
    avatar TEXT,
    bio TEXT,
    social_facebook TEXT,
    social_zalo TEXT,
    social_tiktok TEXT,
    deadline TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS articles (
    id SERIAL PRIMARY KEY,
    team_id INTEGER,
    article_id TEXT,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    pen_name TEXT NOT NULL,
    created_by_user_id INTEGER,
    category TEXT NOT NULL DEFAULT 'ICT',
    article_type TEXT NOT NULL DEFAULT 'Bài SEO ICT',
    content_type TEXT NOT NULL DEFAULT 'Viết mới',
    word_count_range TEXT,
    status TEXT NOT NULL DEFAULT 'Submitted',
    link TEXT,
    review_link TEXT,
    reviewer_name TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS article_sync_links (
    id SERIAL PRIMARY KEY,
    source_url TEXT NOT NULL,
    sheet_name TEXT NOT NULL,
    sheet_month INTEGER NOT NULL,
    sheet_year INTEGER NOT NULL,
    source_row_key TEXT NOT NULL,
    article_id_ref INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS content_work_registrations (
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL,
    team_id INTEGER,
    requested_by_user_id INTEGER NOT NULL,
    pen_name TEXT NOT NULL,
    title TEXT NOT NULL,
    article_link TEXT,
    content_work_category TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    external_sheet_name TEXT,
    external_row_number INTEGER,
    automation_message TEXT,
    last_error TEXT,
    form_submitted_at TEXT,
    link_written_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS article_comments (
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    pen_name TEXT NOT NULL,
    content TEXT NOT NULL,
    mentions TEXT,
    attachment_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS editorial_tasks (
    id SERIAL PRIMARY KEY,
    team_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    assignee_pen_name TEXT NOT NULL,
    due_date TEXT NOT NULL,
    remind_at TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS kpi_records (
    id SERIAL PRIMARY KEY,
    team_id INTEGER,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    pen_name TEXT NOT NULL,
    kpi_standard INTEGER NOT NULL DEFAULT 25,
    kpi_actual INTEGER NOT NULL DEFAULT 0,
    evaluation TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS kpi_monthly_targets (
    id SERIAL PRIMARY KEY,
    team_id INTEGER,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    role TEXT NOT NULL,
    target_kpi INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS royalty_rates (
    id SERIAL PRIMARY KEY,
    article_type TEXT NOT NULL,
    content_type TEXT NOT NULL,
    price INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    team_id INTEGER,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    pen_name TEXT NOT NULL,
    total_articles INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL DEFAULT 0,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    approved_by_user_id INTEGER,
    approved_at TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    from_user_id INTEGER,
    to_user_id INTEGER NOT NULL,
    to_pen_name TEXT,
    type TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    related_article_id INTEGER,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS article_reviews (
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL,
    reviewer_user_id INTEGER,
    error_notes TEXT,
    ctv_response TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS monthly_budgets (
    id SERIAL PRIMARY KEY,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    budget_amount INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS feedback_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    collaborator_id INTEGER,
    team_id INTEGER,
    submitter_name TEXT NOT NULL,
    submitter_email TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'improvement',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    page_context TEXT,
    rating INTEGER,
    status TEXT NOT NULL DEFAULT 'new',
    admin_notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS realtime_events (
    id SERIAL PRIMARY KEY,
    channels TEXT NOT NULL,
    user_scope TEXT NOT NULL DEFAULT '*',
    toast_title TEXT,
    toast_message TEXT,
    toast_variant TEXT DEFAULT 'info',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS app_runtime_meta (
    meta_key TEXT PRIMARY KEY,
    meta_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  "CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(status)",
  "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
  "CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id)",
  "CREATE INDEX IF NOT EXISTS idx_collaborators_team_id ON collaborators(team_id)",
  "CREATE INDEX IF NOT EXISTS idx_articles_pen_name ON articles(pen_name)",
  "CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(date)",
  "CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status)",
  "CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category)",
  "CREATE INDEX IF NOT EXISTS idx_articles_team_id ON articles(team_id)",
  "CREATE INDEX IF NOT EXISTS idx_article_sync_links_source ON article_sync_links(source_url, sheet_name)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_article_sync_links_row_key ON article_sync_links(source_url, sheet_name, source_row_key)",
  "CREATE INDEX IF NOT EXISTS idx_article_sync_links_article_ref ON article_sync_links(article_id_ref)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_content_work_registrations_article ON content_work_registrations(article_id)",
  "CREATE INDEX IF NOT EXISTS idx_content_work_registrations_requested_by ON content_work_registrations(requested_by_user_id)",
  "CREATE INDEX IF NOT EXISTS idx_content_work_registrations_status ON content_work_registrations(status)",
  "CREATE INDEX IF NOT EXISTS idx_content_work_registrations_updated_at ON content_work_registrations(updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_content_work_registrations_team_id ON content_work_registrations(team_id)",
  "CREATE INDEX IF NOT EXISTS idx_article_comments_article_id ON article_comments(article_id)",
  "CREATE INDEX IF NOT EXISTS idx_editorial_tasks_assignee ON editorial_tasks(assignee_pen_name)",
  "CREATE INDEX IF NOT EXISTS idx_editorial_tasks_due_date ON editorial_tasks(due_date)",
  "CREATE INDEX IF NOT EXISTS idx_editorial_tasks_team_id ON editorial_tasks(team_id)",
  "CREATE INDEX IF NOT EXISTS idx_kpi_month_year ON kpi_records(month, year)",
  "CREATE INDEX IF NOT EXISTS idx_kpi_team_id ON kpi_records(team_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_monthly_targets_scope ON kpi_monthly_targets(team_id, month, year, role)",
  "CREATE INDEX IF NOT EXISTS idx_kpi_monthly_targets_month_year ON kpi_monthly_targets(month, year)",
  "CREATE INDEX IF NOT EXISTS idx_kpi_monthly_targets_team_id ON kpi_monthly_targets(team_id)",
  "CREATE INDEX IF NOT EXISTS idx_payments_month_year ON payments(month, year)",
  "CREATE INDEX IF NOT EXISTS idx_payments_team_id ON payments(team_id)",
  "CREATE INDEX IF NOT EXISTS idx_notifications_to_user ON notifications(to_user_id)",
  "CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(to_user_id, is_read)",
  "CREATE INDEX IF NOT EXISTS idx_article_reviews_article ON article_reviews(article_id)",
  "CREATE INDEX IF NOT EXISTS idx_monthly_budgets_month_year ON monthly_budgets(month, year)",
  "CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_feedback_entries_status ON feedback_entries(status)",
  "CREATE INDEX IF NOT EXISTS idx_feedback_entries_user_id ON feedback_entries(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_feedback_entries_team_id ON feedback_entries(team_id)",
  "CREATE INDEX IF NOT EXISTS idx_feedback_entries_created_at ON feedback_entries(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_realtime_events_created_at ON realtime_events(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_realtime_events_user_scope ON realtime_events(user_scope)",
];

export function createPoolFromEnv() {
  const connectionString = resolveDatabaseUrl();
  const shouldUseSsl = /sslmode=require/i.test(connectionString) || process.env.DATABASE_SSL === "require";
  return new Pool({
    connectionString,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
  });
}

async function ensureColumnExists(pool, table, column, typeSql) {
  const result = await pool.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [table, column]
  );

  if (result.rowCount === 0) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
  }
}

async function getOrCreateDefaultTeamId(pool) {
  const existingDefault = await pool.query(
    `SELECT id FROM teams WHERE name = $1 ORDER BY id ASC LIMIT 1`,
    [DEFAULT_TEAM_NAME]
  );

  if (existingDefault.rowCount) {
    return Number(existingDefault.rows[0]?.id);
  }

  const insertedDefault = await pool.query(
    `
      INSERT INTO teams (name, description, status, created_at, updated_at)
      VALUES ($1, $2, 'active', CURRENT_TIMESTAMP::text, CURRENT_TIMESTAMP::text)
      RETURNING id
    `,
    [DEFAULT_TEAM_NAME, "Được tạo tự động để tiếp nhận dữ liệu legacy sau khi nâng cấp hệ thống nhiều team."]
  );

  return Number(insertedDefault.rows[0]?.id);
}

export async function initializeDatabase(pool) {
  for (const statement of bootstrapStatements) {
    await pool.query(statement);
  }

  await ensureColumnExists(pool, "users", "is_leader", "BOOLEAN NOT NULL DEFAULT false");
  await ensureColumnExists(pool, "users", "team_id", "INTEGER");
  await ensureColumnExists(pool, "collaborators", "team_id", "INTEGER");
  await ensureColumnExists(pool, "articles", "team_id", "INTEGER");
  await ensureColumnExists(pool, "articles", "created_by_user_id", "INTEGER");
  await ensureColumnExists(pool, "articles", "link_health_status", "TEXT");
  await ensureColumnExists(pool, "articles", "link_health_checked_at", "TEXT");
  await ensureColumnExists(pool, "articles", "link_health_check_slot", "TEXT");
  await ensureColumnExists(pool, "articles", "review_link", "TEXT");
  await ensureColumnExists(pool, "content_work_registrations", "team_id", "INTEGER");
  await ensureColumnExists(pool, "content_work_registrations", "article_link", "TEXT");
  await ensureColumnExists(pool, "content_work_registrations", "content_work_category", "TEXT");
  await ensureColumnExists(pool, "content_work_registrations", "status", "TEXT NOT NULL DEFAULT 'queued'");
  await ensureColumnExists(pool, "content_work_registrations", "attempt_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumnExists(pool, "content_work_registrations", "external_sheet_name", "TEXT");
  await ensureColumnExists(pool, "content_work_registrations", "external_row_number", "INTEGER");
  await ensureColumnExists(pool, "content_work_registrations", "automation_message", "TEXT");
  await ensureColumnExists(pool, "content_work_registrations", "last_error", "TEXT");
  await ensureColumnExists(pool, "content_work_registrations", "form_submitted_at", "TEXT");
  await ensureColumnExists(pool, "content_work_registrations", "link_written_at", "TEXT");
  await ensureColumnExists(pool, "content_work_registrations", "completed_at", "TEXT");
  await ensureColumnExists(pool, "content_work_registrations", "created_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text");
  await ensureColumnExists(pool, "content_work_registrations", "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text");
  await ensureColumnExists(pool, "editorial_tasks", "team_id", "INTEGER");
  await ensureColumnExists(pool, "kpi_records", "team_id", "INTEGER");
  await ensureColumnExists(pool, "kpi_monthly_targets", "team_id", "INTEGER");
  await ensureColumnExists(pool, "kpi_monthly_targets", "month", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumnExists(pool, "kpi_monthly_targets", "year", "INTEGER NOT NULL DEFAULT 2000");
  await ensureColumnExists(pool, "kpi_monthly_targets", "role", "TEXT NOT NULL DEFAULT 'writer'");
  await ensureColumnExists(pool, "kpi_monthly_targets", "target_kpi", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumnExists(pool, "kpi_monthly_targets", "created_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text");
  await ensureColumnExists(pool, "kpi_monthly_targets", "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text");
  await ensureColumnExists(pool, "payments", "team_id", "INTEGER");
  await ensureColumnExists(pool, "payments", "approved_by_user_id", "INTEGER");
  await ensureColumnExists(pool, "payments", "approved_at", "TEXT");
  await ensureColumnExists(pool, "payments", "paid_at", "TEXT");
  await ensureColumnExists(pool, "payments", "updated_at", "TEXT DEFAULT CURRENT_TIMESTAMP::text");
  await ensureColumnExists(pool, "feedback_entries", "team_id", "INTEGER");
}

export async function postImportNormalize(pool) {
  try {
    await pool.query(`ALTER TABLE articles ALTER COLUMN status SET DEFAULT 'Submitted'`);
  } catch (error) {
    if (!/ALTER TABLE/i.test(error.message) && !/not supported/i.test(error.message)) {
      throw error;
    }
  }
  await pool.query(`UPDATE collaborators SET role = 'reviewer' WHERE role = 'editor'`);
  await pool.query(`UPDATE users SET is_leader = true WHERE role = 'admin' AND is_leader = false`);

  const defaultTeamId = await getOrCreateDefaultTeamId(pool);

  await pool.query(`UPDATE users SET team_id = $1 WHERE team_id IS NULL`, [defaultTeamId]);
  await pool.query(`UPDATE collaborators SET team_id = $1 WHERE team_id IS NULL`, [defaultTeamId]);
  await pool.query(`
    WITH unique_pen_name_teams AS (
      SELECT lower(pen_name) AS normalized_pen_name, MIN(team_id) AS team_id
      FROM collaborators
      WHERE team_id IS NOT NULL
      GROUP BY lower(pen_name)
      HAVING COUNT(DISTINCT team_id) = 1
    )
    UPDATE articles
    SET team_id = unique_pen_name_teams.team_id
    FROM unique_pen_name_teams
    WHERE articles.team_id IS NULL
      AND lower(articles.pen_name) = unique_pen_name_teams.normalized_pen_name
  `);
  await pool.query(`
    UPDATE articles
    SET team_id = users.team_id
    FROM users
    WHERE articles.team_id IS NULL
      AND articles.created_by_user_id = users.id
      AND users.team_id IS NOT NULL
  `);
  await pool.query(`UPDATE articles SET team_id = $1 WHERE team_id IS NULL`, [defaultTeamId]);
  await pool.query(`UPDATE editorial_tasks SET team_id = $1 WHERE team_id IS NULL`, [defaultTeamId]);
  await pool.query(`UPDATE kpi_records SET team_id = $1 WHERE team_id IS NULL`, [defaultTeamId]);
  await pool.query(`UPDATE kpi_monthly_targets SET team_id = $1 WHERE team_id IS NULL`, [defaultTeamId]);
  await pool.query(`UPDATE payments SET team_id = $1 WHERE team_id IS NULL`, [defaultTeamId]);
  await pool.query(`UPDATE feedback_entries SET team_id = $1 WHERE team_id IS NULL`, [defaultTeamId]);

  await pool.query(`
    UPDATE articles
    SET created_by_user_id = (
      SELECT audit_logs.user_id
      FROM audit_logs
      WHERE audit_logs.action = 'article_created'
        AND audit_logs.entity = 'article'
        AND audit_logs.entity_id = CAST(articles.id AS TEXT)
      ORDER BY audit_logs.id DESC
      LIMIT 1
    )
    WHERE created_by_user_id IS NULL
  `);

  await pool.query(
    `
      INSERT INTO app_runtime_meta (meta_key, meta_value, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP::text)
      ON CONFLICT (meta_key)
      DO UPDATE SET meta_value = EXCLUDED.meta_value, updated_at = EXCLUDED.updated_at
    `,
    [BOOTSTRAP_META_KEY, BOOTSTRAP_SCHEMA_VERSION]
  );
}

export async function countRows(pool, tableName) {
  const result = await pool.query(`SELECT COUNT(*)::int AS c FROM ${tableName}`);
  return Number(result.rows[0]?.c || 0);
}
