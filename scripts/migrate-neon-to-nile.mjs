import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";
import {
  DEFAULT_DATABASE_URL,
  countRows,
  initializeDatabase,
  postImportNormalize,
  resolveDatabaseUrl,
} from "./db-bootstrap.mjs";

const { Client, Pool } = pg;

const TABLES = [
  { name: "teams", orderBy: "id" },
  { name: "collaborators", orderBy: "id" },
  { name: "users", orderBy: "id", booleanColumns: ["is_leader", "must_change_password"] },
  { name: "articles", orderBy: "id" },
  { name: "article_sync_links", orderBy: "id" },
  { name: "content_work_registrations", orderBy: "id" },
  { name: "article_comments", orderBy: "id" },
  { name: "editorial_tasks", orderBy: "id" },
  { name: "kpi_records", orderBy: "id" },
  { name: "kpi_monthly_targets", orderBy: "id" },
  { name: "royalty_rates", orderBy: "id", booleanColumns: ["is_active"] },
  { name: "payments", orderBy: "id" },
  { name: "notifications", orderBy: "id", booleanColumns: ["is_read"] },
  { name: "article_reviews", orderBy: "id" },
  { name: "monthly_budgets", orderBy: "id" },
  { name: "audit_logs", orderBy: "id" },
  { name: "feedback_entries", orderBy: "id" },
  { name: "realtime_events", orderBy: "id" },
  { name: "app_runtime_meta", orderBy: "meta_key", hasSerialId: false },
];

const HELP_TEXT = `
Usage:
  node scripts/migrate-neon-to-nile.mjs

Supported env vars:
  TARGET_DATABASE_URL  PostgreSQL target URL (recommended for Nile)
  NILE_DATABASE_URL    Alias for TARGET_DATABASE_URL
  DATABASE_URL         Fallback target URL when the aliases above are not set

  SOURCE_DATABASE_URL  PostgreSQL source URL
  NEON_DATABASE_URL    Alias for SOURCE_DATABASE_URL
  SOURCE_SQLITE_PATH   SQLite source path (default: ./data/ctv-management.db)
  SOURCE_JSON_PATH     JSON backup path containing table -> rows
  SOURCE_KIND          One of: postgres, sqlite, json
  EXPORT_JSON_PATH     Optional path to save the extracted source payload
  DATABASE_SSL         Set to require when the target URL needs SSL
  SOURCE_DATABASE_SSL  Set to require when the source PostgreSQL needs SSL

Notes:
  - The script truncates the target tables before importing.
  - Serial IDs are preserved via explicit INSERTs and target sequences are resynced afterward.
  - If the source is legacy SQLite, team-scoped fields are backfilled after import.
`;

function parseEnvFile(content) {
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function loadLocalEnv() {
  for (const relativePath of [".env.local", ".env"]) {
    const fullPath = path.resolve(relativePath);
    if (!fs.existsSync(fullPath)) continue;

    const parsed = parseEnvFile(fs.readFileSync(fullPath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, "\"\"")}"`;
}

function shouldUseSsl(url, envValue) {
  return /sslmode=require/i.test(url) || envValue === "require";
}

function createPostgresClient(connectionString, sslEnvKey) {
  return new Client({
    connectionString,
    ssl: shouldUseSsl(connectionString, process.env[sslEnvKey]) ? { rejectUnauthorized: false } : undefined,
  });
}

function createTargetPool(connectionString) {
  return new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL) ? { rejectUnauthorized: false } : undefined,
  });
}

function maskConnectionString(connectionString) {
  return connectionString.replace(/(postgresql:\/\/)([^:@\s]+)(?::([^@\s]+))?@/i, (_match, prefix, user) => {
    return `${prefix}${user}:***@`;
  });
}

function resolveTargetUrl() {
  return process.env.TARGET_DATABASE_URL?.trim()
    || process.env.NILE_DATABASE_URL?.trim()
    || resolveDatabaseUrl()
    || "";
}

function resolveSourceKind() {
  const explicit = process.env.SOURCE_KIND?.trim().toLowerCase();
  if (explicit) return explicit;

  if (process.env.SOURCE_JSON_PATH?.trim()) return "json";
  if (process.env.SOURCE_DATABASE_URL?.trim() || process.env.NEON_DATABASE_URL?.trim()) return "postgres";
  return "sqlite";
}

function resolveSourceConfig() {
  const kind = resolveSourceKind();

  if (kind === "json") {
    const jsonPath = process.env.SOURCE_JSON_PATH?.trim() || "./neon_backup.json";
    return {
      kind,
      jsonPath,
      jsonPathResolved: path.resolve(jsonPath),
    };
  }

  if (kind === "postgres") {
    const connectionString = process.env.SOURCE_DATABASE_URL?.trim()
      || process.env.NEON_DATABASE_URL?.trim()
      || "";

    if (!connectionString) {
      throw new Error("SOURCE_DATABASE_URL (or NEON_DATABASE_URL) is required when SOURCE_KIND=postgres");
    }

    return { kind, connectionString };
  }

  if (kind === "sqlite") {
    const sqlitePath = process.env.SOURCE_SQLITE_PATH?.trim() || "./data/ctv-management.db";
    return {
      kind,
      sqlitePath,
      sqlitePathResolved: path.resolve(sqlitePath),
    };
  }

  throw new Error(`Unsupported SOURCE_KIND: ${kind}`);
}

function normalizeRow(row, booleanColumns = []) {
  const next = { ...row };

  for (const column of booleanColumns) {
    if (!(column in next)) continue;
    if (next[column] === null || next[column] === undefined) continue;

    if (typeof next[column] === "boolean") continue;
    if (typeof next[column] === "number") {
      next[column] = Boolean(next[column]);
      continue;
    }

    const normalized = String(next[column]).trim().toLowerCase();
    if (["1", "true", "t", "yes"].includes(normalized)) next[column] = true;
    if (["0", "false", "f", "no"].includes(normalized)) next[column] = false;
  }

  return next;
}

async function readPostgresRows(connectionString, table) {
  const client = createPostgresClient(connectionString, "SOURCE_DATABASE_SSL");

  try {
    await client.connect();
    const query = `SELECT * FROM ${quoteIdentifier(table.name)} ORDER BY ${quoteIdentifier(table.orderBy)}`;
    const result = await client.query(query);
    return result.rows.map((row) => normalizeRow(row, table.booleanColumns));
  } catch (error) {
    if (/does not exist/i.test(error.message)) {
      return [];
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function readSqliteRows(sqlitePath, table) {
  try {
    const output = execFileSync(
      "sqlite3",
      ["-json", sqlitePath, `SELECT * FROM ${table.name} ORDER BY ${table.orderBy};`],
      { encoding: "utf8" }
    ).trim();

    const rows = output ? JSON.parse(output) : [];
    return rows.map((row) => normalizeRow(row, table.booleanColumns));
  } catch (error) {
    const message = `${error.stdout || ""}${error.stderr || ""}${error.message || ""}`;
    if (/no such table/i.test(message)) {
      return [];
    }
    throw error;
  }
}

function readJsonRows(jsonData, table) {
  const rows = Array.isArray(jsonData?.[table.name]) ? jsonData[table.name] : [];
  return rows.map((row) => normalizeRow(row, table.booleanColumns));
}

async function exportSource(sourceConfig) {
  const payload = {};

  for (const table of TABLES) {
    if (sourceConfig.kind === "postgres") {
      payload[table.name] = await readPostgresRows(sourceConfig.connectionString, table);
      continue;
    }

    if (sourceConfig.kind === "sqlite") {
      payload[table.name] = readSqliteRows(sourceConfig.sqlitePath, table);
      continue;
    }

    if (!sourceConfig.jsonData) {
      sourceConfig.jsonData = JSON.parse(fs.readFileSync(sourceConfig.jsonPath, "utf8"));
    }
    payload[table.name] = readJsonRows(sourceConfig.jsonData, table);
  }

  return payload;
}

async function truncateTables(pool) {
  const tableNames = TABLES.map((table) => quoteIdentifier(table.name)).join(", ");
  try {
    await pool.query(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY`);
    return;
  } catch (error) {
    if (!/TRUNCATE/i.test(error.message)) {
      throw error;
    }
  }

  for (const table of [...TABLES].reverse()) {
    await pool.query(`DELETE FROM ${quoteIdentifier(table.name)}`);
  }
}

function remapId(mapping, value) {
  if (value === null || value === undefined) return value;
  const mapped = mapping.get(Number(value));
  return mapped ?? value;
}

function remapAuditEntityId(entity, entityId, idMaps) {
  if (!entityId) return entityId;

  const normalizedEntity = String(entity || "").trim().toLowerCase();
  const tableName = normalizedEntity === "article"
    ? "articles"
    : normalizedEntity === "user"
      ? "users"
      : normalizedEntity === "collaborator"
        ? "collaborators"
        : normalizedEntity === "team"
          ? "teams"
          : "";

  if (!tableName) return entityId;

  const mapping = idMaps[tableName];
  if (!mapping) return entityId;

  const mapped = mapping.get(Number(entityId));
  return mapped ? String(mapped) : entityId;
}

function remapRow(tableName, row, idMaps) {
  const next = { ...row };
  const teamsMap = idMaps.teams;
  const collaboratorsMap = idMaps.collaborators;
  const usersMap = idMaps.users;
  const articlesMap = idMaps.articles;

  if (tableName === "collaborators") {
    next.team_id = remapId(teamsMap, next.team_id);
    return next;
  }

  if (tableName === "users") {
    next.collaborator_id = remapId(collaboratorsMap, next.collaborator_id);
    next.team_id = remapId(teamsMap, next.team_id);
    return next;
  }

  if (tableName === "articles") {
    next.team_id = remapId(teamsMap, next.team_id);
    next.created_by_user_id = remapId(usersMap, next.created_by_user_id);
    return next;
  }

  if (tableName === "article_sync_links") {
    next.article_id_ref = remapId(articlesMap, next.article_id_ref);
    return next;
  }

  if (tableName === "content_work_registrations") {
    next.article_id = remapId(articlesMap, next.article_id);
    next.team_id = remapId(teamsMap, next.team_id);
    next.requested_by_user_id = remapId(usersMap, next.requested_by_user_id);
    return next;
  }

  if (tableName === "article_comments") {
    next.article_id = remapId(articlesMap, next.article_id);
    next.user_id = remapId(usersMap, next.user_id);
    return next;
  }

  if (tableName === "editorial_tasks") {
    next.team_id = remapId(teamsMap, next.team_id);
    next.created_by_user_id = remapId(usersMap, next.created_by_user_id);
    return next;
  }

  if (tableName === "kpi_records") {
    next.team_id = remapId(teamsMap, next.team_id);
    return next;
  }

  if (tableName === "kpi_monthly_targets") {
    next.team_id = remapId(teamsMap, next.team_id);
    return next;
  }

  if (tableName === "payments") {
    next.team_id = remapId(teamsMap, next.team_id);
    next.approved_by_user_id = remapId(usersMap, next.approved_by_user_id);
    return next;
  }

  if (tableName === "notifications") {
    next.from_user_id = remapId(usersMap, next.from_user_id);
    next.to_user_id = remapId(usersMap, next.to_user_id);
    next.related_article_id = remapId(articlesMap, next.related_article_id);
    return next;
  }

  if (tableName === "article_reviews") {
    next.article_id = remapId(articlesMap, next.article_id);
    next.reviewer_user_id = remapId(usersMap, next.reviewer_user_id);
    return next;
  }

  if (tableName === "audit_logs") {
    next.user_id = remapId(usersMap, next.user_id);
    next.entity_id = remapAuditEntityId(next.entity, next.entity_id, idMaps);
    return next;
  }

  if (tableName === "feedback_entries") {
    next.user_id = remapId(usersMap, next.user_id);
    next.collaborator_id = remapId(collaboratorsMap, next.collaborator_id);
    next.team_id = remapId(teamsMap, next.team_id);
    return next;
  }

  return next;
}

async function insertRows(pool, table, rows, idMaps) {
  if (rows.length === 0) return 0;

  const batchSize = 50;

  for (let index = 0; index < rows.length; index += batchSize) {
    const batchRows = rows.slice(index, index + batchSize).map((row) => {
      const mappedRow = remapRow(table.name, row, idMaps);
      return {
        originalId: mappedRow.id,
        insertRow: mappedRow,
      };
    });

    const columns = Object.keys(batchRows[0].insertRow);
    const quotedColumns = columns.map(quoteIdentifier).join(", ");
    const values = [];
    const rowPlaceholders = batchRows.map((entry, rowIndex) => {
      const placeholders = columns.map((_column, columnIndex) => {
        values.push(entry.insertRow[columns[columnIndex]]);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const query = `INSERT INTO ${quoteIdentifier(table.name)} (${quotedColumns}) VALUES ${rowPlaceholders.join(", ")}`;
    await pool.query(query, values);

    if (table.hasSerialId !== false) {
      batchRows.forEach((entry) => {
        if (entry.originalId === null || entry.originalId === undefined) {
          return;
        }
        idMaps[table.name].set(Number(entry.originalId), Number(entry.originalId));
      });
    }
  }

  return rows.length;
}

async function resetSerialSequences(pool) {
  for (const table of TABLES) {
    if (table.hasSerialId === false) continue;

    const sequenceResult = await pool.query(
      "SELECT pg_get_serial_sequence($1, 'id') AS sequence_name",
      [table.name]
    );
    const sequenceName = sequenceResult.rows[0]?.sequence_name;
    if (!sequenceName) continue;

    const statsResult = await pool.query(
      `SELECT COALESCE(MAX(id), 0)::bigint AS max_id, COUNT(*)::int AS row_count FROM ${quoteIdentifier(table.name)}`
    );
    const maxId = Number(statsResult.rows[0]?.max_id || 0);
    const hasRows = Number(statsResult.rows[0]?.row_count || 0) > 0;

    await pool.query(
      "SELECT setval($1::regclass, $2, $3)",
      [sequenceName, hasRows ? maxId : 1, hasRows]
    );
  }
}

async function finalizeReferenceFixups(pool, idMaps, payload) {
  if ((payload.teams?.length || 0) > 0) {
    for (const team of payload.teams) {
      if (!team.owner_user_id) continue;
      const mappedTeamId = idMaps.teams.get(Number(team.id));
      const mappedOwnerUserId = idMaps.users.get(Number(team.owner_user_id));
      if (!mappedTeamId || !mappedOwnerUserId) continue;

      await pool.query(
        `UPDATE ${quoteIdentifier("teams")} SET owner_user_id = $1 WHERE id = $2`,
        [mappedOwnerUserId, mappedTeamId]
      );
    }
  }
}

function summarizePayload(payload) {
  let total = 0;
  const lines = [];

  for (const table of TABLES) {
    const count = payload[table.name]?.length || 0;
    total += count;
    lines.push(`${table.name}: ${count}`);
  }

  return { total, lines };
}

async function verifyTarget(pool) {
  const verification = {};

  for (const table of TABLES) {
    verification[table.name] = await countRows(pool, table.name);
  }

  return verification;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP_TEXT.trim());
    return;
  }

  loadLocalEnv();

  const explicitTargetUrl = process.env.TARGET_DATABASE_URL?.trim() || process.env.NILE_DATABASE_URL?.trim() || "";
  const targetUrl = resolveTargetUrl();
  if (!targetUrl) {
    throw new Error("TARGET_DATABASE_URL (or NILE_DATABASE_URL / DATABASE_URL) is required");
  }
  if (!explicitTargetUrl && /neon\.tech/i.test(targetUrl)) {
    throw new Error("DATABASE_URL still points to Neon. Set TARGET_DATABASE_URL or NILE_DATABASE_URL to the Nile connection string.");
  }

  const sourceConfig = resolveSourceConfig();

  if (sourceConfig.kind === "postgres" && sourceConfig.connectionString === targetUrl) {
    throw new Error("Source and target database URLs are identical. Refusing to migrate.");
  }

  if (sourceConfig.kind === "sqlite" && !fs.existsSync(sourceConfig.sqlitePathResolved)) {
    throw new Error(`SQLite source not found: ${sourceConfig.sqlitePathResolved}`);
  }

  if (sourceConfig.kind === "json" && !fs.existsSync(sourceConfig.jsonPathResolved)) {
    throw new Error(`JSON source not found: ${sourceConfig.jsonPathResolved}`);
  }

  console.log("=== Data Migration ===");
  console.log(`Target: ${maskConnectionString(targetUrl || DEFAULT_DATABASE_URL)}`);
  if (sourceConfig.kind === "postgres") {
    console.log(`Source: ${maskConnectionString(sourceConfig.connectionString)}`);
  } else if (sourceConfig.kind === "sqlite") {
    console.log(`Source: ${sourceConfig.sqlitePath}`);
  } else {
    console.log(`Source: ${sourceConfig.jsonPath}`);
  }

  const payload = await exportSource(sourceConfig);
  const summary = summarizePayload(payload);
  console.log(`Rows discovered: ${summary.total}`);
  for (const line of summary.lines) {
    console.log(`  ${line}`);
  }

  if (process.env.EXPORT_JSON_PATH?.trim()) {
    const exportPath = path.resolve(process.env.EXPORT_JSON_PATH.trim());
    fs.writeFileSync(exportPath, JSON.stringify(payload, null, 2));
    console.log(`Exported source snapshot to ${exportPath}`);
  }

  const pool = createTargetPool(targetUrl);

  try {
    const client = await pool.connect();
    const idMaps = Object.fromEntries(
      TABLES.filter((table) => table.hasSerialId !== false).map((table) => [table.name, new Map()])
    );

    try {
      await client.query("BEGIN");
      await initializeDatabase(client);
      await truncateTables(client);

      for (const table of TABLES) {
        const rows = payload[table.name] || [];
        const inserted = await insertRows(client, table, rows, idMaps);
        console.log(`Imported ${inserted} rows into ${table.name}`);
      }

      await finalizeReferenceFixups(client, idMaps, payload);
      await postImportNormalize(client);
      await resetSerialSequences(client);
      const verification = await verifyTarget(client);
      await client.query("COMMIT");

      console.log("Verification:");
      for (const table of TABLES) {
        console.log(`  ${table.name}: ${verification[table.name]}`);
      }
      console.log("Migration completed.");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
