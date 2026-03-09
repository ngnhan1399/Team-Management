import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createPoolFromEnv, initializeDatabase } from "./db-bootstrap.mjs";

const projectRoot = process.cwd();
const criticalApiFiles = [
  "src/app/api/payments/route.ts",
  "src/app/api/editorial-tasks/route.ts",
  "src/app/api/editorial-tasks/reminders/route.ts",
  "src/app/api/articles/comments/route.ts",
  "src/app/api/audit-logs/route.ts",
  "src/app/api/auth/register/route.ts",
];

const requiredTables = [
  "users",
  "collaborators",
  "articles",
  "payments",
  "notifications",
  "article_comments",
  "editorial_tasks",
  "article_reviews",
  "monthly_budgets",
  "audit_logs",
  "realtime_events",
];

const pool = createPoolFromEnv();

async function tableExists(name) {
  const result = await pool.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
      LIMIT 1
    `,
    [name]
  );
  return result.rowCount > 0;
}

async function columnExists(table, column) {
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
  return result.rowCount > 0;
}

async function main() {
  try {
    await initializeDatabase(pool);

    for (const table of requiredTables) {
      assert.equal(await tableExists(table), true, `Missing table: ${table}`);
    }

    const requiredPaymentColumns = ["status", "approved_by_user_id", "approved_at", "paid_at", "updated_at"];
    for (const column of requiredPaymentColumns) {
      assert.equal(await columnExists("payments", column), true, `Missing payments.${column}`);
    }

    for (const rel of criticalApiFiles) {
      assert.equal(fs.existsSync(path.join(projectRoot, rel)), true, `Missing API file: ${rel}`);
    }

    console.log("Smoke test passed: schema + critical APIs are present.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
