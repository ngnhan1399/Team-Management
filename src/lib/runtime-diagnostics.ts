type RuntimeIssue = {
  code: string;
  message: string;
};

type ErrorWithCode = Error & {
  code?: string;
  errno?: number;
};

function buildConnectionString(baseUrl: string, user?: string, password?: string) {
  try {
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
  } catch {
    return baseUrl;
  }
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

  return "";
}

export function validateJwtSecret(): RuntimeIssue | null {
  const jwtSecret = process.env.JWT_SECRET?.trim();

  if (!jwtSecret) {
    return {
      code: "missing_jwt_secret",
      message: "Thiếu JWT_SECRET trên môi trường chạy.",
    };
  }

  if (jwtSecret.length < 32) {
    return {
      code: "invalid_jwt_secret",
      message: "JWT_SECRET phải có ít nhất 32 ký tự.",
    };
  }

  return null;
}

export function validateDatabaseUrl(): RuntimeIssue | null {
  const databaseUrl = resolveDatabaseUrl();

  if (!databaseUrl) {
    return {
      code: "missing_database_url",
      message: "Thiếu cấu hình PostgreSQL. Hãy đặt DATABASE_URL hoặc bộ biến Nile trong môi trường chạy.",
    };
  }

  if (databaseUrl.startsWith("file:")) {
    return {
      code: "invalid_database_url",
      message: "Cấu hình database hiện đang là SQLite file URL, nhưng app này đang chạy với PostgreSQL.",
    };
  }

  if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    return {
      code: "invalid_database_url",
      message: "DATABASE_URL không đúng định dạng PostgreSQL.",
    };
  }

  return null;
}

function looksLikeLocalFallback(message: string) {
  return message.includes("127.0.0.1:5432") || message.includes("localhost:5432");
}

export function diagnoseRuntimeError(error: unknown): RuntimeIssue {
  const err = error as ErrorWithCode | undefined;
  const message = String(err?.message || error || "");
  const normalizedMessage = message.toLowerCase();
  const code = String(err?.code || "").toUpperCase();

  if (code === "ECONNREFUSED" || looksLikeLocalFallback(message)) {
    return {
      code: "database_unreachable",
      message: looksLikeLocalFallback(message)
        ? "Không kết nối được PostgreSQL tại 127.0.0.1:5432. Thường do DATABASE_URL production đang thiếu hoặc sai."
        : "Không kết nối được PostgreSQL. Kiểm tra DATABASE_URL hoặc bộ biến Nile, DATABASE_SSL và trạng thái database server.",
    };
  }

  if (code === "ENOTFOUND") {
    return {
      code: "database_host_not_found",
      message: "Không tìm thấy host PostgreSQL. Kiểm tra lại host trong DATABASE_URL.",
    };
  }

  if (code === "28P01" || normalizedMessage.includes("password authentication failed")) {
    return {
      code: "database_auth_failed",
      message: "Xác thực PostgreSQL thất bại. Kiểm tra user/password trong DATABASE_URL hoặc bộ biến Nile.",
    };
  }

  if (code === "3D000" || normalizedMessage.includes("does not exist")) {
    return {
      code: "database_missing",
      message: "Database đích không tồn tại hoặc chưa được tạo đúng tên.",
    };
  }

  if (normalizedMessage.includes("jwt_secret")) {
    return {
      code: "invalid_jwt_secret",
      message: "JWT_SECRET đang thiếu hoặc không hợp lệ.",
    };
  }

  return {
    code: "runtime_error",
    message: "He thong gap loi runtime khi khoi tao auth/database.",
  };
}

