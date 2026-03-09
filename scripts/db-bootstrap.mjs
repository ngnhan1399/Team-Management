import { Pool } from "pg";

export const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/ctv_management";

const bootstrapStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'ctv',
    collaborator_id INTEGER,
    must_change_password BOOLEAN NOT NULL DEFAULT true,
    last_login TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  `CREATE TABLE IF NOT EXISTS collaborators (
    id SERIAL PRIMARY KEY,
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
    article_id TEXT,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    pen_name TEXT NOT NULL,
    created_by_user_id INTEGER,
    category TEXT NOT NULL DEFAULT 'ICT',
    article_type TEXT NOT NULL DEFAULT 'Bài SEO ICT',
    content_type TEXT NOT NULL DEFAULT 'Viết mới',
    word_count_range TEXT,
    status TEXT NOT NULL DEFAULT 'Draft',
    link TEXT,
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
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    pen_name TEXT NOT NULL,
    kpi_standard INTEGER NOT NULL DEFAULT 25,
    kpi_actual INTEGER NOT NULL DEFAULT 0,
    evaluation TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
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
  `CREATE TABLE IF NOT EXISTS realtime_events (
    id SERIAL PRIMARY KEY,
    channels TEXT NOT NULL,
    user_scope TEXT NOT NULL DEFAULT '*',
    toast_title TEXT,
    toast_message TEXT,
    toast_variant TEXT DEFAULT 'info',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
  )`,
  "CREATE INDEX IF NOT EXISTS idx_articles_pen_name ON articles(pen_name)",
  "CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(date)",
  "CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status)",
  "CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category)",
  "CREATE INDEX IF NOT EXISTS idx_article_sync_links_source ON article_sync_links(source_url, sheet_name)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_article_sync_links_row_key ON article_sync_links(source_url, sheet_name, source_row_key)",
  "CREATE INDEX IF NOT EXISTS idx_article_sync_links_article_ref ON article_sync_links(article_id_ref)",
  "CREATE INDEX IF NOT EXISTS idx_article_comments_article_id ON article_comments(article_id)",
  "CREATE INDEX IF NOT EXISTS idx_editorial_tasks_assignee ON editorial_tasks(assignee_pen_name)",
  "CREATE INDEX IF NOT EXISTS idx_editorial_tasks_due_date ON editorial_tasks(due_date)",
  "CREATE INDEX IF NOT EXISTS idx_kpi_month_year ON kpi_records(month, year)",
  "CREATE INDEX IF NOT EXISTS idx_payments_month_year ON payments(month, year)",
  "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
  "CREATE INDEX IF NOT EXISTS idx_notifications_to_user ON notifications(to_user_id)",
  "CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(to_user_id, is_read)",
  "CREATE INDEX IF NOT EXISTS idx_article_reviews_article ON article_reviews(article_id)",
  "CREATE INDEX IF NOT EXISTS idx_monthly_budgets_month_year ON monthly_budgets(month, year)",
  "CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_realtime_events_created_at ON realtime_events(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_realtime_events_user_scope ON realtime_events(user_scope)",
];

export function createPoolFromEnv() {
  const connectionString = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
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

export async function initializeDatabase(pool) {
  for (const statement of bootstrapStatements) {
    await pool.query(statement);
  }

  await ensureColumnExists(pool, "payments", "approved_by_user_id", "INTEGER");
  await ensureColumnExists(pool, "payments", "approved_at", "TEXT");
  await ensureColumnExists(pool, "payments", "paid_at", "TEXT");
  await ensureColumnExists(pool, "payments", "updated_at", "TEXT DEFAULT CURRENT_TIMESTAMP::text");
  await ensureColumnExists(pool, "articles", "created_by_user_id", "INTEGER");
}

export async function countRows(pool, tableName) {
  const result = await pool.query(`SELECT COUNT(*)::int AS c FROM ${tableName}`);
  return Number(result.rows[0]?.c || 0);
}
