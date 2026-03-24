import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import {
  DEFAULT_TEAM_NAME,
  countRows,
  createPoolFromEnv,
  initializeDatabase,
  postImportNormalize,
} from "./db-bootstrap.mjs";

const ROYALTY_DATA = [
  ["Mô tả SP ngắn", "Viết mới", 80000],
  ["Mô tả SP ngắn", "Viết lại", 40000],
  ["Mô tả SP dài", "Viết mới", 120000],
  ["Mô tả SP dài", "Viết lại", 60000],
  ["Bài dịch Review SP", "Viết lại", 80000],
  ["Bài SEO ICT", "Viết mới", 100000],
  ["Bài SEO ICT", "Viết lại", 50000],
  ["Bài SEO Gia dụng", "Viết mới", 100000],
  ["Bài SEO Gia dụng", "Viết lại", 50000],
  ["Bài SEO ICT 1K5", "Viết mới", 160000],
  ["Bài SEO ICT 1K5", "Viết lại", 80000],
  ["Bài SEO Gia dụng 1K5", "Viết mới", 140000],
  ["Bài SEO Gia dụng 1K5", "Viết lại", 70000],
  ["Bài SEO ICT 2K", "Viết mới", 200000],
  ["Bài SEO ICT 2K", "Viết lại", 100000],
  ["Bài SEO Gia dụng 2K", "Viết mới", 180000],
  ["Bài SEO Gia dụng 2K", "Viết lại", 90000],
  ["Thủ thuật", "Viết mới", 120000],
];

const CTV_DATA = [
  ["CTV Demo 01", "Bút Danh 01", "writer", 25, "writer01@demo.local", "0900000001", "Demo Bank"],
  ["CTV Demo 02", "Bút Danh 02", "writer", 25, "writer02@demo.local", "0900000002", "Demo Bank"],
  ["CTV Demo 03", "Bút Danh 03", "writer", 25, "writer03@demo.local", "0900000003", "Demo Bank"],
  ["CTV Demo 04", "Bút Danh 04", "writer", 25, "writer04@demo.local", "0900000004", "Demo Bank"],
  ["CTV Demo 05", "Bút Danh 05", "writer", 25, "writer05@demo.local", "0900000005", "Demo Bank"],
  ["CTV Demo 06", "Bút Danh 06", "writer", 25, "writer06@demo.local", "0900000006", "Demo Bank"],
  ["CTV Demo 07", "Bút Danh 07", "writer", 25, "writer07@demo.local", "0900000007", "Demo Bank"],
  ["CTV Demo 08", "Bút Danh 08", "writer", 25, "writer08@demo.local", "0900000008", "Demo Bank"],
  ["Admin Demo", "Quản trị Demo", "reviewer", 100, "admin@demo.local", "", ""],
];

function resolveSeedMode() {
  const rawValue = process.env.SEED_MODE?.trim().toLowerCase();
  return rawValue === "admin-only" ? "admin-only" : "demo";
}

async function getDefaultTeamId(pool) {
  const defaultTeam = await pool.query(
    "SELECT id FROM teams WHERE name = $1 ORDER BY id ASC LIMIT 1",
    [DEFAULT_TEAM_NAME]
  );

  if (defaultTeam.rowCount) {
    return Number(defaultTeam.rows[0]?.id);
  }

  const firstTeam = await pool.query("SELECT id FROM teams ORDER BY id ASC LIMIT 1");
  return Number(firstTeam.rows[0]?.id || 1);
}

const pool = createPoolFromEnv();

async function main() {
  const seedMode = resolveSeedMode();
  const shouldSeedDemoData = seedMode === "demo";

  try {
    await initializeDatabase(pool);
    await postImportNormalize(pool);

    const defaultTeamId = await getDefaultTeamId(pool);

    if (await countRows(pool, "royalty_rates") === 0) {
      for (const [articleType, contentType, price] of ROYALTY_DATA) {
        await pool.query(
          "INSERT INTO royalty_rates (article_type, content_type, price, is_active) VALUES ($1, $2, $3, true)",
          [articleType, contentType, price]
        );
      }
      console.log(`Seeded ${ROYALTY_DATA.length} royalty rates`);
    }

    if (shouldSeedDemoData && await countRows(pool, "collaborators") === 0) {
      for (const [name, penName, role, kpiStandard, email, phone, bankName] of CTV_DATA) {
        await pool.query(
          `
            INSERT INTO collaborators (team_id, name, pen_name, role, kpi_standard, email, phone, bank_name, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
          `,
          [defaultTeamId, name, penName, role, kpiStandard, email, phone, bankName]
        );
      }
      console.log(`Seeded ${CTV_DATA.length} demo collaborators`);
    }

    const adminExists = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (adminExists.rowCount === 0) {
      const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || "admin@demo.local";
      const adminPassword = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");
      const passwordHash = bcrypt.hashSync(adminPassword, 10);
      const collaboratorResult = shouldSeedDemoData
        ? await pool.query(
            "SELECT id FROM collaborators WHERE pen_name = $1 LIMIT 1",
            ["Quản trị Demo"]
          )
        : { rows: [] };
      const collaboratorId = collaboratorResult.rows[0]?.id ?? null;

      await pool.query(
        `
          INSERT INTO users (email, password_hash, role, is_leader, collaborator_id, team_id, must_change_password)
          VALUES ($1, $2, 'admin', true, $3, $4, true)
        `,
        [adminEmail, passwordHash, collaboratorId, defaultTeamId]
      );

      console.log(`Seeded admin user: ${adminEmail}`);
      console.log(`Temporary admin password: ${adminPassword}`);
      console.log("First login will require a password change.");
    }

    console.log(`Database seed completed in ${seedMode} mode.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
