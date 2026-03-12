import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { initializeDatabase, resolveDatabaseUrl } from "./db-bootstrap.mjs";

const SQLITE_PATH = process.env.SQLITE_PATH?.trim() || "./data/ctv-management.db";
const DATABASE_URL = resolveDatabaseUrl();

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const TABLES = [
  {
    name: "users",
    booleanColumns: ["must_change_password"],
  },
  {
    name: "collaborators",
  },
  {
    name: "articles",
  },
  {
    name: "article_comments",
  },
  {
    name: "editorial_tasks",
  },
  {
    name: "kpi_records",
  },
  {
    name: "royalty_rates",
    booleanColumns: ["is_active"],
  },
  {
    name: "payments",
  },
  {
    name: "notifications",
    booleanColumns: ["is_read"],
  },
  {
    name: "article_reviews",
  },
  {
    name: "monthly_budgets",
  },
  {
    name: "audit_logs",
  },
  {
    name: "realtime_events",
  },
];

function readSqliteRows(tableName) {
  const output = execFileSync(
    "sqlite3",
    ["-json", SQLITE_PATH, `SELECT * FROM ${tableName};`],
    { encoding: "utf8" }
  ).trim();

  return output ? JSON.parse(output) : [];
}

function normalizeRow(row, booleanColumns = []) {
  const next = { ...row };
  for (const column of booleanColumns) {
    if (column in next && next[column] !== null && next[column] !== undefined) {
      next[column] = Boolean(next[column]);
    }
  }
  return next;
}

async function truncateTables(pool) {
  const tableNames = TABLES.map((table) => table.name).join(", ");
  await pool.query(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY`);
}

async function syncSequence(pool, tableName) {
  await pool.query(
    `
      SELECT setval(
        pg_get_serial_sequence($1, 'id'),
        COALESCE((SELECT MAX(id) FROM ${tableName}), 1),
        (SELECT EXISTS (SELECT 1 FROM ${tableName}))
      )
    `,
    [tableName]
  );
}

async function insertRows(pool, tableName, rows) {
  if (rows.length === 0) return 0;

  const columns = Object.keys(rows[0]);
  const quotedColumns = columns.map((column) => `"${column}"`).join(", ");

  for (const row of rows) {
    const values = columns.map((column) => row[column]);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    await pool.query(
      `INSERT INTO ${tableName} (${quotedColumns}) VALUES (${placeholders})`,
      values
    );
  }

  return rows.length;
}

async function main() {
  const shouldUseSsl = /sslmode=require/i.test(DATABASE_URL) || process.env.DATABASE_SSL === "require";
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await initializeDatabase(pool);
    await truncateTables(pool);

    for (const table of TABLES) {
      const rawRows = readSqliteRows(table.name);
      const rows = rawRows.map((row) => normalizeRow(row, table.booleanColumns));
      const inserted = await insertRows(pool, table.name, rows);
      await syncSequence(pool, table.name);
      console.log(`Imported ${inserted} rows into ${table.name}`);
    }

    console.log("SQLite to PostgreSQL migration completed.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
