import { createPoolFromEnv } from "./db-bootstrap.mjs";

function parseDays(rawValue, fallbackDays) {
  const value = Number(rawValue);
  return Number.isInteger(value) && value > 0 ? value : fallbackDays;
}

async function countPrunableRows(pool, tableName, whereSql, values) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS c FROM ${tableName} WHERE ${whereSql}`,
    values
  );
  return Number(result.rows[0]?.c || 0);
}

async function deletePrunableRows(pool, tableName, whereSql, values) {
  const result = await pool.query(
    `DELETE FROM ${tableName} WHERE ${whereSql}`,
    values
  );
  return Number(result.rowCount || 0);
}

async function main() {
  const pool = createPoolFromEnv();
  const apply = process.argv.includes("--apply");
  const realtimeRetentionDays = parseDays(process.env.PRUNE_REALTIME_EVENTS_DAYS, 30);
  const readNotificationsRetentionDays = parseDays(process.env.PRUNE_READ_NOTIFICATIONS_DAYS, 90);
  const auditRetentionDaysRaw = process.env.PRUNE_AUDIT_LOGS_DAYS?.trim();
  const auditRetentionDays = auditRetentionDaysRaw ? parseDays(auditRetentionDaysRaw, 365) : null;

  const plans = [
    {
      tableName: "realtime_events",
      label: "realtimeEvents",
      whereSql: "created_at::timestamptz < NOW() - ($1 || ' days')::interval",
      values: [String(realtimeRetentionDays)],
    },
    {
      tableName: "notifications",
      label: "readNotifications",
      whereSql: "is_read = true AND created_at::timestamptz < NOW() - ($1 || ' days')::interval",
      values: [String(readNotificationsRetentionDays)],
    },
    ...(auditRetentionDays
      ? [{
          tableName: "audit_logs",
          label: "auditLogs",
          whereSql: "created_at::timestamptz < NOW() - ($1 || ' days')::interval",
          values: [String(auditRetentionDays)],
        }]
      : []),
  ];

  try {
    const summary = {};

    for (const plan of plans) {
      const matchingRows = await countPrunableRows(pool, plan.tableName, plan.whereSql, plan.values);
      summary[plan.label] = {
        tableName: plan.tableName,
        retentionDays: Number(plan.values[0]),
        matchingRows,
        deletedRows: 0,
      };

      if (apply && matchingRows > 0) {
        summary[plan.label].deletedRows = await deletePrunableRows(
          pool,
          plan.tableName,
          plan.whereSql,
          plan.values
        );
      }
    }

    console.log(JSON.stringify({
      apply,
      checkedAt: new Date().toISOString(),
      summary,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
