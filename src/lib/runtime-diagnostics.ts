type RuntimeIssue = {
  code: string;
  message: string;
};

type ErrorWithCode = Error & {
  code?: string;
  errno?: number;
};

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
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    return {
      code: "missing_database_url",
      message: "Thiếu DATABASE_URL. Hãy dán chuỗi kết nối PostgreSQL/Neon vào .env.local hoặc môi trường deploy.",
    };
  }

  if (databaseUrl.startsWith("file:")) {
    return {
      code: "invalid_database_url",
      message: "DATABASE_URL hiện đang là SQLite file URL, nhưng app này đang chạy với PostgreSQL/Neon.",
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
        ? "Khong ket noi duoc PostgreSQL tai 127.0.0.1:5432. Thuong do DATABASE_URL production dang thieu hoac sai."
        : "Khong ket noi duoc PostgreSQL. Kiem tra DATABASE_URL, DATABASE_SSL va trang thai database server.",
    };
  }

  if (code === "ENOTFOUND") {
    return {
      code: "database_host_not_found",
      message: "Khong tim thay host PostgreSQL. Kiem tra lai host trong DATABASE_URL.",
    };
  }

  if (code === "28P01" || normalizedMessage.includes("password authentication failed")) {
    return {
      code: "database_auth_failed",
      message: "Xac thuc PostgreSQL that bai. Kiem tra user/password trong DATABASE_URL.",
    };
  }

  if (code === "3D000" || normalizedMessage.includes("does not exist")) {
    return {
      code: "database_missing",
      message: "Database dich khong ton tai hoac chua duoc tao dung ten.",
    };
  }

  if (normalizedMessage.includes("jwt_secret")) {
    return {
      code: "invalid_jwt_secret",
      message: "JWT_SECRET dang thieu hoac khong hop le.",
    };
  }

  return {
    code: "runtime_error",
    message: "He thong gap loi runtime khi khoi tao auth/database.",
  };
}
