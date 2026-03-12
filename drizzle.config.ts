import { defineConfig } from "drizzle-kit";

function buildConnectionString(baseUrl: string, user?: string, password?: string) {
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

function resolveDatabaseUrl() {
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

  return "postgresql://postgres:postgres@127.0.0.1:5432/ctv_management";
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
});
