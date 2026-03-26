import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function resolveDatabaseUrl() {
  return process.env.DATABASE_URL
    || process.env.DATABASE_POSTGRES_URL
    || process.env.DATABASE_NILEDB_POSTGRES_URL
    || "";
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function repairDateToSheetYear(dateValue, sheetYear) {
  const match = String(dateValue || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) {
    return null;
  }

  const safeDay = Math.min(day, getDaysInMonth(sheetYear, month));
  return `${sheetYear}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

async function main() {
  loadLocalEnv();
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("Không tìm thấy DATABASE_URL hoặc DATABASE_POSTGRES_URL để sửa dữ liệu.");
  }

  const apply = process.argv.includes("--apply");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("thenile.dev") ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();

  const suspectRows = await client.query(`
    select
      a.id,
      a.date,
      a.title,
      a.pen_name as "penName",
      a.link,
      s.id as "syncLinkId",
      s.sheet_name as "sheetName",
      s.sheet_month as "sheetMonth",
      s.sheet_year as "sheetYear"
    from articles a
    join article_sync_links s on s.article_id_ref = a.id
    where a.date > CURRENT_DATE::text
      and s.sheet_year is not null
      and substring(a.date from 1 for 4)::int > s.sheet_year
    order by a.date desc, a.id desc
  `);

  const repairs = suspectRows.rows
    .map((row) => {
      const repairedDate = repairDateToSheetYear(row.date, Number(row.sheetYear));
      if (!repairedDate || repairedDate === row.date) {
        return null;
      }
      return {
        ...row,
        repairedDate,
      };
    })
    .filter(Boolean);

  const summary = {
    totalSuspects: suspectRows.rowCount,
    repairable: repairs.length,
    apply,
    sample: repairs.slice(0, 20),
  };

  if (!apply || repairs.length === 0) {
    console.log(JSON.stringify(summary, null, 2));
    await client.end();
    return;
  }

  const backupDir = path.join(process.cwd(), "tmp", "repair-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `future-sheet-dates-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(backupPath, JSON.stringify(repairs, null, 2), "utf8");

  await client.query("begin");
  try {
    for (const row of repairs) {
      await client.query(
        `update articles set date = $1, updated_at = $2 where id = $3`,
        [row.repairedDate, new Date().toISOString(), row.id]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }

  console.log(JSON.stringify({
    ...summary,
    backupPath,
    updated: repairs.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
