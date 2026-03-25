import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/157reP9SMWXgV47XHPcUJNqo1RicwS6vsqQvOlEW5F8Q/edit?gid=184624696#gid=184624696&range=A4874";
const outputPath = path.resolve(process.cwd(), process.argv[2] || "tmp/review-registration-google-state.json");
const outputBase64Path = path.resolve(process.cwd(), process.argv[3] || "tmp/review-registration-google-state.base64.txt");

const rl = readline.createInterface({ input, output });

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .toLowerCase();
}

const browser = await chromium.launch({
  headless: false,
  slowMo: 50,
});

const context = await browser.newContext({
  locale: "vi-VN",
  viewport: { width: 1440, height: 960 },
});

try {
  const page = await context.newPage();
  await page.goto(SHEET_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  output.write("\nĐăng nhập Google bằng tài khoản có quyền chỉnh sửa sheet “Việt Nguyễn”, chờ sheet mở xong rồi quay lại terminal.\n");
  await rl.question("Nhấn Enter sau khi bạn đã đăng nhập xong và nhìn thấy sheet ở chế độ chỉnh sửa: ");

  const bodyText = foldText(await page.locator("body").innerText().catch(() => ""));
  if (bodyText.includes("dang nhap")) {
    throw new Error("Phiên hiện tại vẫn đang ở trạng thái chưa đăng nhập.");
  }
  if (bodyText.includes("chi xem")) {
    throw new Error("Tài khoản hiện tại mới chỉ có quyền xem sheet, chưa có quyền chỉnh sửa.");
  }

  const storageState = await context.storageState();
  const storageStateJson = JSON.stringify(storageState, null, 2);
  const storageStateBase64 = Buffer.from(storageStateJson, "utf8").toString("base64");

  await ensureParentDir(outputPath);
  await ensureParentDir(outputBase64Path);
  await fs.writeFile(outputPath, storageStateJson, "utf8");
  await fs.writeFile(outputBase64Path, storageStateBase64, "utf8");

  output.write(`\nĐã lưu storage state tại:\n- ${outputPath}\n- ${outputBase64Path}\n`);
  output.write("Bạn có thể dùng file JSON trực tiếp trên VPS hoặc dán base64 vào REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_BASE64.\n");
} finally {
  rl.close();
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
