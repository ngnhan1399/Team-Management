import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function parseEnvFile(filePath) {
  const resolved = path.resolve(repoRoot, filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  const env = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

function buildConnectionString(baseUrl, user, password) {
  const parsed = new URL(baseUrl);
  if (parsed.username || parsed.password || !user || !password) {
    return baseUrl;
  }

  parsed.username = encodeURIComponent(user);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

function resolveDatabaseUrl(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.DATABASE_POSTGRES_URL) return env.DATABASE_POSTGRES_URL;
  if (env.DATABASE_NILEDB_URL) return env.DATABASE_NILEDB_URL;
  if (env.DATABASE_NILEDB_POSTGRES_URL) {
    return buildConnectionString(
      env.DATABASE_NILEDB_POSTGRES_URL,
      env.DATABASE_NILEDB_USER,
      env.DATABASE_NILEDB_PASSWORD,
    );
  }
  throw new Error("Không tìm thấy DATABASE_URL trong env file.");
}

const envFileArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envFile = envFileArg ? envFileArg.slice("--env-file=".length) : ".env.local";
const env = parseEnvFile(envFile);
const databaseUrl = resolveDatabaseUrl(env);
const shouldUseSsl = /sslmode=require/i.test(databaseUrl) || env.DATABASE_SSL === "require";

const statements = [
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
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_content_work_registrations_article ON content_work_registrations(article_id)",
  "CREATE INDEX IF NOT EXISTS idx_content_work_registrations_requested_by ON content_work_registrations(requested_by_user_id)",
  "CREATE INDEX IF NOT EXISTS idx_content_work_registrations_status ON content_work_registrations(status)",
  "CREATE INDEX IF NOT EXISTS idx_content_work_registrations_updated_at ON content_work_registrations(updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_content_work_registrations_team_id ON content_work_registrations(team_id)",
];

async function ensureColumnExists(pool, column, typeSql) {
  const result = await pool.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'content_work_registrations'
        AND column_name = $1
      LIMIT 1
    `,
    [column],
  );

  if (result.rowCount === 0) {
    await pool.query(`ALTER TABLE content_work_registrations ADD COLUMN ${column} ${typeSql}`);
  }
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
});

try {
  for (const statement of statements) {
    await pool.query(statement);
  }

  await ensureColumnExists(pool, "team_id", "INTEGER");
  await ensureColumnExists(pool, "article_link", "TEXT");
  await ensureColumnExists(pool, "content_work_category", "TEXT");
  await ensureColumnExists(pool, "status", "TEXT NOT NULL DEFAULT 'queued'");
  await ensureColumnExists(pool, "attempt_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumnExists(pool, "external_sheet_name", "TEXT");
  await ensureColumnExists(pool, "external_row_number", "INTEGER");
  await ensureColumnExists(pool, "automation_message", "TEXT");
  await ensureColumnExists(pool, "last_error", "TEXT");
  await ensureColumnExists(pool, "form_submitted_at", "TEXT");
  await ensureColumnExists(pool, "link_written_at", "TEXT");
  await ensureColumnExists(pool, "completed_at", "TEXT");
  await ensureColumnExists(pool, "created_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text");
  await ensureColumnExists(pool, "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text");

  console.log(`Content Work schema ready using env file: ${envFile}`);
} finally {
  await pool.end();
}
